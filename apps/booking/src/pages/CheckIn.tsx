import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import {
  checkInApi,
  errorMessage,
  setCheckInToken,
  type CheckInSession,
  type RoomAccess,
  type UpsellOffer,
} from '../api/checkInClient';
import { Button } from '../components/Button';
import { Field, inputClass } from '../components/Field';
import { StripeCard, type PaymentResult } from '../components/StripeCard';
import { WorldlineCard } from '../components/WorldlineCard';
import { money } from '../lib/format';
import { submitRedirectNextAction } from '../lib/submit-redirect-next-action';

type Step = 'reg' | 'id' | 'upsell' | 'pay' | 'ready' | 'access';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function CheckIn() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('reg');
  const [access, setAccess] = useState<RoomAccess | null>(null);
  const [offers, setOffers] = useState<UpsellOffer[]>([]);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nationality, setNationality] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [placeOfBirth, setPlaceOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [signed, setSigned] = useState(false);
  const [idType, setIdType] = useState('passport');
  const [idNumber, setIdNumber] = useState('');
  const [idCountry, setIdCountry] = useState('');
  const [idImage, setIdImage] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (token) setCheckInToken(token);
  }, [token]);

  const sessionQuery = useQuery({
    queryKey: ['check-in-session', token],
    queryFn: () => checkInApi.session(),
    enabled: Boolean(token),
    refetchInterval: (q) => {
      const s = q.state.data as CheckInSession | undefined;
      if (!s) return false;
      if (s.steps.checkedIn) return false;
      if (s.registrationComplete && !s.canSelfCheckIn.allowed) return 15_000;
      return false;
    },
  });

  const session = sessionQuery.data;

  useEffect(() => {
    if (!session) return;
    const root = document.documentElement;
    if (session.property.branding.primaryColor) {
      root.style.setProperty('--haip-primary', session.property.branding.primaryColor);
    }
    if (session.property.branding.accentColor) {
      root.style.setProperty('--haip-accent', session.property.branding.accentColor);
    }
    setFirstName((v) => v || session.guest?.firstName || '');
    setLastName((v) => v || session.guest?.lastName || '');
    setEmail((v) => v || session.guest?.email || '');
    setPhone((v) => v || session.guest?.phone || '');
    setNationality((v) => v || session.guest?.nationality || '');
    if (session.folioBalance > 0) setPayAmount(String(session.folioBalance.toFixed(2)));
    const stepParam = params.get('step');
    if (session.steps.checkedIn) {
      setStep('access');
      checkInApi.access().then(setAccess).catch(() => undefined);
    } else if (
      stepParam === 'pay' &&
      session.registrationComplete &&
      session.folioBalance > 0.009
    ) {
      // Return URL / deep-link into the pay step (Redsys/Worldline mid-flow).
      setStep('pay');
    } else if (session.registrationComplete) {
      setStep('ready');
    }
  }, [session, params]);

  const preRegister = useMutation({
    mutationFn: () =>
      checkInApi.preRegister({
        registrationSigned: signed,
        registrationData: {
          firstName,
          lastName,
          email,
          phone,
          nationality,
          address,
          ...(dateOfBirth ? { dateOfBirth } : {}),
          ...(placeOfBirth ? { placeOfBirth } : {}),
        },
        idType,
        idNumber: idNumber || undefined,
        idCountry: idCountry || undefined,
        idImageBase64: idImage || undefined,
      }),
    onSuccess: (s) => {
      queryClient.setQueryData(['check-in-session', token], s);
      setStep('upsell');
      checkInApi.upsells().then((r) => setOffers(r.offers)).catch(() => setOffers([]));
    },
  });

  const acceptUpsell = useMutation({
    mutationFn: (campaignId: string) => checkInApi.acceptUpsell(campaignId),
    onSuccess: (s) => {
      queryClient.setQueryData(['check-in-session', token], s);
      if (s.folioBalance > 0.009) setPayAmount(String(s.folioBalance.toFixed(2)));
    },
  });

  const pay = useMutation({
    mutationFn: (payment: PaymentResult & { returnUrl?: string; gatewayProvider?: string }) =>
      checkInApi.pay({
        amount: Number(payAmount),
        paymentMethodId: payment.paymentToken?.startsWith('pm_')
          ? payment.paymentToken
          : undefined,
        gatewayPaymentToken: payment.paymentToken,
        gatewayProvider: payment.gatewayProvider,
        cardLastFour: payment.cardLastFour,
        cardBrand: payment.cardBrand,
        returnUrl: payment.returnUrl,
      }),
    onSuccess: (s) => {
      if (s.nextAction?.type === 'redirect') {
        submitRedirectNextAction(s.nextAction);
        return;
      }
      queryClient.setQueryData(['check-in-session', token], s);
      setStep('ready');
    },
  });

  const worldlineSession = useCallback(() => checkInApi.worldlineTokenization(), []);

  const stripePromise = useMemo(() => {
    const key = session?.stripePublishableKey?.trim();
    return key ? loadStripe(key) : null;
  }, [session?.stripePublishableKey]);

  const selfCheckIn = useMutation({
    mutationFn: () => checkInApi.selfCheckIn(),
    onSuccess: (a) => {
      setAccess(a);
      setStep('access');
      queryClient.invalidateQueries({ queryKey: ['check-in-session', token] });
    },
  });

  const brandName = useMemo(
    () => session?.property.branding.displayName || session?.property.name || 'Check-in',
    [session],
  );

  if (!token) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Open the check-in link from your pre-arrival email or SMS to continue.
      </div>
    );
  }

  if (sessionQuery.isLoading) {
    return <p className="text-sm text-gray-600">Loading your stay…</p>;
  }

  if (sessionQuery.isError || !session) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {errorMessage(sessionQuery.error) || 'This check-in link is invalid or expired.'}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Online check-in</p>
        <h1 className="text-2xl font-semibold text-gray-900">{brandName}</h1>
        <p className="text-sm text-gray-600">
          {session.reservation.confirmationNumber} · {session.reservation.arrivalDate} →{' '}
          {session.reservation.departureDate} · {session.reservation.roomTypeName}
        </p>
      </header>

      <Progress
        steps={[
          { id: 'reg', label: 'Details', done: session.steps.registration },
          { id: 'id', label: 'ID', done: session.steps.id },
          { id: 'pay', label: 'Pay', done: session.steps.payment },
          { id: 'access', label: 'Room', done: session.steps.checkedIn },
        ]}
        current={step}
      />

      {step === 'reg' && (
        <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">Registration</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" required>
              <input className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label="Last name" required>
              <input className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
            <Field label="Email">
              <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Phone">
              <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Nationality">
              <input
                className={inputClass}
                placeholder="FR"
                maxLength={2}
                value={nationality}
                onChange={(e) => setNationality(e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Address">
              <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            {session.francePackEnabled && nationality && nationality !== 'FR' && (
              <>
                <Field label="Date of birth" required>
                  <input
                    className={inputClass}
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                  />
                </Field>
                <Field label="Place of birth" required>
                  <input
                    className={inputClass}
                    value={placeOfBirth}
                    onChange={(e) => setPlaceOfBirth(e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={signed}
              onChange={(e) => setSigned(e.target.checked)}
            />
            <span>I confirm these details are accurate and agree to the property terms.</span>
          </label>
          <Button
            className="w-full"
            disabled={
              !firstName ||
              !lastName ||
              !signed ||
              (Boolean(session.francePackEnabled) &&
                Boolean(nationality) &&
                nationality !== 'FR' &&
                (!dateOfBirth || !placeOfBirth || !address || !phone || !email))
            }
            onClick={() => setStep('id')}
          >
            Continue to ID
          </Button>
        </section>
      )}

      {step === 'id' && (
        <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">Photo ID</h2>
          <p className="text-sm text-gray-600">
            Take a clear photo of your passport or ID with your phone. No desk scanner needed.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ID type">
              <select className={inputClass} value={idType} onChange={(e) => setIdType(e.target.value)}>
                <option value="passport">Passport</option>
                <option value="drivers_license">Driver&apos;s license</option>
                <option value="national_id">National ID</option>
              </select>
            </Field>
            <Field label="ID number">
              <input className={inputClass} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </Field>
            <Field label="Issuing country">
              <input
                className={inputClass}
                placeholder="FR"
                maxLength={2}
                value={idCountry}
                onChange={(e) => setIdCountry(e.target.value.toUpperCase())}
              />
            </Field>
          </div>
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setIdImage(await fileToDataUrl(file));
              }}
            />
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => fileRef.current?.click()}
            >
              {idImage ? 'Retake / replace photo' : 'Take or upload ID photo'}
            </Button>
            {idImage && (
              <img
                src={idImage}
                alt="ID preview"
                className="max-h-48 w-full rounded-md border border-gray-200 object-contain"
              />
            )}
          </div>
          {preRegister.isError && (
            <p className="text-sm text-red-600">{errorMessage(preRegister.error)}</p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setStep('reg')}>
              Back
            </Button>
            <Button
              className="flex-1"
              disabled={
                preRegister.isPending ||
                (session.config.requireIdPhoto && !idImage) ||
                !signed
              }
              onClick={() => preRegister.mutate()}
            >
              {preRegister.isPending ? 'Saving…' : 'Save & continue'}
            </Button>
          </div>
        </section>
      )}

      {step === 'upsell' && (
        <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">Enhance your stay</h2>
          {offers.length === 0 ? (
            <p className="text-sm text-gray-600">No upgrades available right now.</p>
          ) : (
            <ul className="space-y-3">
              {offers.map((o) => (
                <li
                  key={o.campaignId}
                  className="flex items-start justify-between gap-3 rounded-md border border-gray-100 p-3"
                >
                  <div>
                    <p className="font-medium text-gray-900">{o.name}</p>
                    <p className="text-sm text-gray-600">{o.description}</p>
                    <p className="mt-1 text-sm font-semibold text-gray-800">
                      +{money(String(o.priceDelta), o.currencyCode)}
                      {o.type === 'room_upgrade' ? ' / night' : ''}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={acceptUpsell.isPending}
                    onClick={() => acceptUpsell.mutate(o.campaignId)}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            className="w-full"
            onClick={() => {
              if (session.folioBalance > 0.009 && session.config.requirePaymentWhenBalanceDue) {
                setStep('pay');
              } else {
                setStep('ready');
              }
            }}
          >
            Continue
          </Button>
        </section>
      )}

      {step === 'pay' && (
        <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">Payment</h2>
          <p className="text-sm text-gray-600">
            Outstanding balance:{' '}
            <strong>{money(String(session.folioBalance), session.reservation.currencyCode)}</strong>
          </p>
          <Field label="Amount to pay" required>
            <input
              className={inputClass}
              type="number"
              min="0.01"
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
          </Field>
          {pay.isError && <p className="text-sm text-red-600">{errorMessage(pay.error)}</p>}
          {session.payment?.clientMode === 'redsys' ? (
            <Button
              className="w-full"
              disabled={pay.isPending || !Number(payAmount)}
              onClick={() =>
                pay.mutate({
                  paymentToken: 'redsys_redirect',
                  gatewayProvider: 'redsys',
                  returnUrl: `${window.location.origin}/check-in?token=${encodeURIComponent(token)}&step=ready`,
                })
              }
            >
              {pay.isPending ? 'Redirecting…' : 'Pay securely via Redsys'}
            </Button>
          ) : session.payment?.clientMode === 'worldline' ? (
            <WorldlineCard
              submitting={pay.isPending}
              getSession={worldlineSession}
              submitLabel="Pay now"
              onPaid={(p) =>
                pay.mutate({
                  ...p,
                  gatewayProvider: 'worldline',
                  returnUrl: `${window.location.origin}/check-in?token=${encodeURIComponent(token)}&step=ready`,
                })
              }
            />
          ) : session.payment?.clientMode === 'stripe' && stripePromise ? (
            <Elements stripe={stripePromise}>
              <StripeCard
                submitting={pay.isPending}
                onPaid={(p) => pay.mutate({ ...p, gatewayProvider: 'stripe' })}
              />
            </Elements>
          ) : session.payment?.clientMode === 'mock' ? (
            <>
              <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                Demo gateway — uses the mock payment token (same as booking demo mode).
              </p>
              <Button
                className="w-full"
                disabled={pay.isPending || !Number(payAmount)}
                onClick={() =>
                  pay.mutate({ paymentToken: 'tok_demo', gatewayProvider: 'mock' })
                }
              >
                {pay.isPending ? 'Processing…' : 'Pay (demo)'}
              </Button>
            </>
          ) : (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Payment is not configured for this property. Contact the front desk to settle your balance.
            </p>
          )}
        </section>
      )}

      {step === 'ready' && (
        <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">You&apos;re pre-checked in</h2>
          <p className="text-sm text-gray-600">
            Registration is complete. When your room is ready on arrival day, tap below to finish check-in
            and get your room access on this phone.
          </p>
          <ul className="space-y-1 text-sm text-gray-700">
            <li>Check-in from: {session.config.checkInStartTime}</li>
            <li>Room ready: {session.roomReady ? 'Yes' : 'Waiting on housekeeping'}</li>
            <li>
              Self check-in:{' '}
              {session.canSelfCheckIn.allowed
                ? 'Ready'
                : session.canSelfCheckIn.reason || 'Not yet available'}
            </li>
          </ul>
          {selfCheckIn.isError && (
            <p className="text-sm text-red-600">{errorMessage(selfCheckIn.error)}</p>
          )}
          <Button
            className="w-full"
            disabled={!session.canSelfCheckIn.allowed || selfCheckIn.isPending}
            onClick={() => selfCheckIn.mutate()}
          >
            {selfCheckIn.isPending ? 'Checking in…' : 'Check in & get room access'}
          </Button>
        </section>
      )}

      {step === 'access' && access && (
        <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">Your room access</h2>
          <div className="rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 p-5 text-white shadow-lg">
            <p className="text-xs uppercase tracking-wider text-slate-300">{brandName}</p>
            <p className="mt-3 text-3xl font-semibold">Room {access.roomNumber ?? '—'}</p>
            <p className="mt-4 font-mono text-4xl tracking-[0.3em]">{access.accessCode ?? '······'}</p>
            <p className="mt-2 text-sm text-slate-300">Access code</p>
            {access.instructions && (
              <p className="mt-4 text-sm text-slate-200">{access.instructions}</p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                const text = `Room ${access.roomNumber} · Code ${access.accessCode}`;
                void navigator.clipboard?.writeText(text);
              }}
            >
              Copy access code
            </Button>
            {access.wallet?.google?.available && access.wallet.google.saveUrl && (
              <a
                className="inline-flex flex-1 items-center justify-center rounded-brand border border-gray-300 px-4 py-2 text-sm font-semibold"
                href={access.wallet.google.saveUrl}
                target="_blank"
                rel="noreferrer"
              >
                Add to Google Wallet
              </a>
            )}
            {access.wallet?.apple?.available && access.wallet.apple.downloadPath && (
              <a
                className="inline-flex flex-1 items-center justify-center rounded-brand border border-gray-300 px-4 py-2 text-sm font-semibold"
                href={access.wallet.apple.downloadPath}
              >
                Add to Apple Wallet
              </a>
            )}
            {access.mobileKey?.deepLink && (
              <a
                className="inline-flex flex-1 items-center justify-center rounded-brand px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--haip-primary, #06bdb4)' }}
                href={access.mobileKey.deepLink}
              >
                {access.mobileKey.label || 'Open mobile key'}
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Progress({
  steps,
  current,
}: {
  steps: Array<{ id: string; label: string; done: boolean }>;
  current: string;
}) {
  return (
    <ol className="flex gap-2">
      {steps.map((s) => {
        const active = current === s.id || (current === 'upsell' && s.id === 'reg') || (current === 'id' && s.id === 'reg');
        return (
          <li
            key={s.id}
            className={`flex-1 rounded-full px-2 py-1 text-center text-xs font-medium ${
              s.done || active
                ? 'bg-[color-mix(in_srgb,var(--haip-primary,#06bdb4)_18%,white)] text-gray-900'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
