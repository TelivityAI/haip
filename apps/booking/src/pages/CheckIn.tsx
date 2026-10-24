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
import { money, stayDateRange } from '../lib/format';
import { checkInCopy, resolveCheckInLocale } from '../lib/checkInCopy';
import { resizeImageToDataUrl } from '../lib/resizeImage';
import { submitRedirectNextAction } from '../lib/submit-redirect-next-action';

type Step = 'reg' | 'id' | 'upsell' | 'pay' | 'ready' | 'access';

const SLATE = '#444863';
const LABEL = '#8a8ca0';
const TEAL = '#06bdb4';
const BORDER = '#e4e4ec';
const CANVAS = '#f0f0f6';

function checkInReturnUrl(token: string): string {
  const path = window.location.pathname.includes('/booking')
    ? '/booking/check-in'
    : '/check-in';
  return `${window.location.origin}${path}?token=${encodeURIComponent(token)}&step=ready`;
}

function walletAsset(name: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${base}/wallet/${name}`;
}

export function CheckIn() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const queryClient = useQueryClient();
  const copy = useMemo(() => checkInCopy(resolveCheckInLocale()), []);
  const bootstrapped = useRef(false);

  const [step, setStep] = useState<Step>('reg');
  const [access, setAccess] = useState<RoomAccess | null>(null);
  const [offers, setOffers] = useState<UpsellOffer[]>([]);
  const [showRequestLink, setShowRequestLink] = useState(false);
  const [reqConfirmation, setReqConfirmation] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [reqDone, setReqDone] = useState(false);

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
    setFirstName((v) => v || session.guest?.firstName || '');
    setLastName((v) => v || session.guest?.lastName || '');
    setEmail((v) => v || session.guest?.email || '');
    setPhone((v) => v || session.guest?.phone || '');
    setNationality((v) => v || session.guest?.nationality || '');
    if (session.folioBalance > 0) setPayAmount(String(session.folioBalance.toFixed(2)));

    if (bootstrapped.current) return;
    bootstrapped.current = true;

    const stepParam = params.get('step');
    if (session.steps.checkedIn) {
      setStep('access');
      checkInApi.access().then(setAccess).catch(() => undefined);
    } else if (
      stepParam === 'pay' &&
      session.registrationComplete &&
      session.folioBalance > 0.009
    ) {
      setStep('pay');
    } else if (session.registrationComplete) {
      if (session.folioBalance > 0.009 && session.config.requirePaymentWhenBalanceDue) {
        setStep('pay');
      } else {
        setStep('ready');
      }
    }
  }, [session, params]);

  const goAfterExtras = useCallback(
    (s: CheckInSession) => {
      if (s.folioBalance > 0.009 && s.config.requirePaymentWhenBalanceDue) {
        setStep('pay');
      } else {
        setStep('ready');
      }
    },
    [],
  );

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
      checkInApi.upsells().then((r) => setOffers(r.offers)).catch(() => undefined);
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

  const requestLink = useMutation({
    mutationFn: () =>
      checkInApi.requestLink({
        confirmationNumber: reqConfirmation,
        email: reqEmail,
      }),
    onSuccess: () => setReqDone(true),
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

  const statusLine = useMemo(() => {
    if (!session) return null;
    if (session.canSelfCheckIn.allowed) return null;
    const reason = session.canSelfCheckIn.reason || '';
    if (/outstanding balance|must be paid/i.test(reason) && session.folioBalance > 0.009) {
      return 'pay' as const;
    }
    if (/opens on arrival|tomorrow|arrival day/i.test(reason)) {
      return copy.opensTomorrow(session.config.checkInStartTime);
    }
    if (/opens at/i.test(reason)) {
      return copy.opensAt(session.config.checkInStartTime);
    }
    if (/not ready|housekeeping|preparing|waiting for room/i.test(reason)) {
      return copy.preparingRoom;
    }
    return reason || copy.preparingRoom;
  }, [session, copy]);

  if (!token || sessionQuery.isError || (!sessionQuery.isLoading && !session)) {
    return (
      <div className="space-y-4 rounded-2xl border bg-white p-6" style={{ borderColor: BORDER, color: SLATE }}>
        <h1 className="text-xl font-semibold" style={{ color: SLATE }}>
          {copy.linkExpired}
        </h1>
        {!showRequestLink ? (
          <Button className="w-full" onClick={() => setShowRequestLink(true)}>
            {copy.sendNewLink}
          </Button>
        ) : reqDone ? (
          <p className="text-sm" style={{ color: LABEL }}>
            {copy.requestLinkSent}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: LABEL }}>
              {copy.requestLinkHint}
            </p>
            <Field label={copy.confirmationNumber} required>
              <input
                className={inputClass}
                value={reqConfirmation}
                onChange={(e) => setReqConfirmation(e.target.value)}
              />
            </Field>
            <Field label={copy.email} required>
              <input
                className={inputClass}
                type="email"
                value={reqEmail}
                onChange={(e) => setReqEmail(e.target.value)}
              />
            </Field>
            <Button
              className="w-full"
              disabled={!reqConfirmation.trim() || !reqEmail.trim() || requestLink.isPending}
              onClick={() => requestLink.mutate()}
            >
              {copy.requestLink}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (sessionQuery.isLoading || !session) {
    return (
      <p className="text-sm" style={{ color: LABEL }}>
        {copy.loading}
      </p>
    );
  }

  const progressCurrent =
    step === 'upsell' ? 'upsell' : step === 'ready' ? 'ready' : step === 'access' ? 'access' : step;

  return (
    <div className="space-y-5" style={{ color: SLATE }}>
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: LABEL }}>
          {copy.onlineCheckIn}
        </p>
        <h1 className="text-2xl font-semibold" style={{ color: SLATE }}>
          {brandName}
        </h1>
        <p className="text-sm" style={{ color: LABEL }}>
          {session.reservation.confirmationNumber} ·{' '}
          {stayDateRange(session.reservation.arrivalDate, session.reservation.departureDate)}
          {session.reservation.roomTypeName ? ` · ${session.reservation.roomTypeName}` : ''}
        </p>
      </header>

      <Progress
        labels={{
          reg: copy.stepDetails,
          id: copy.stepId,
          upsell: copy.stepExtras,
          pay: copy.stepPay,
          ready: copy.stepRoom,
          access: copy.stepRoom,
        }}
        done={{
          reg: session.steps.registration || ['id', 'upsell', 'pay', 'ready', 'access'].includes(step),
          id: session.steps.id || ['upsell', 'pay', 'ready', 'access'].includes(step),
          upsell: ['pay', 'ready', 'access'].includes(step),
          pay: session.steps.payment || ['ready', 'access'].includes(step),
          ready: session.steps.checkedIn,
        }}
        current={progressCurrent}
      />

      {step === 'reg' && (
        <section className="space-y-4 rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
          <h2 className="text-lg font-semibold">{copy.registration}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={copy.firstName} required>
              <input className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label={copy.lastName} required>
              <input className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
            <Field label={copy.email}>
              <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label={copy.phone}>
              <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label={copy.nationality}>
              <input
                className={inputClass}
                placeholder="FR"
                maxLength={2}
                value={nationality}
                onChange={(e) => setNationality(e.target.value.toUpperCase())}
              />
            </Field>
            <Field label={copy.address}>
              <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            {session.francePackEnabled && nationality && nationality !== 'FR' && (
              <>
                <Field label={copy.dateOfBirth} required>
                  <input
                    className={inputClass}
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                  />
                </Field>
                <Field label={copy.placeOfBirth} required>
                  <input
                    className={inputClass}
                    value={placeOfBirth}
                    onChange={(e) => setPlaceOfBirth(e.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm" style={{ color: SLATE }}>
            <input
              type="checkbox"
              className="mt-1"
              checked={signed}
              onChange={(e) => setSigned(e.target.checked)}
            />
            <span>{copy.terms}</span>
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
            {copy.continueToId}
          </Button>
        </section>
      )}

      {step === 'id' && (
        <section className="space-y-4 rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
          <h2 className="text-lg font-semibold">{copy.photoId}</h2>
          <p className="text-sm" style={{ color: LABEL }}>
            {copy.idWhy}{' '}
            {session.privacyPolicyUrl && (
              <a
                href={session.privacyPolicyUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
                style={{ color: SLATE }}
              >
                {copy.privacyLink}
              </a>
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={copy.idType}>
              <select className={inputClass} value={idType} onChange={(e) => setIdType(e.target.value)}>
                <option value="passport">{copy.passport}</option>
                <option value="drivers_license">{copy.driversLicense}</option>
                <option value="national_id">{copy.nationalId}</option>
              </select>
            </Field>
            <Field label={copy.idNumber}>
              <input className={inputClass} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </Field>
            <Field label={copy.idCountry}>
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
                setIdImage(await resizeImageToDataUrl(file));
              }}
            />
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => fileRef.current?.click()}
            >
              {idImage ? copy.retakePhoto : copy.takePhoto}
            </Button>
            {idImage && (
              <img
                src={idImage}
                alt="ID preview"
                className="max-h-48 w-full rounded-2xl border object-contain"
                style={{ borderColor: BORDER, background: CANVAS }}
              />
            )}
          </div>
          {preRegister.isError && (
            <p className="text-sm text-red-600">{errorMessage(preRegister.error)}</p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setStep('reg')}>
              {copy.back}
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
              {preRegister.isPending ? copy.saving : copy.saveContinue}
            </Button>
          </div>
        </section>
      )}

      {step === 'upsell' && (
        <section className="space-y-4 rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
          <h2 className="text-lg font-semibold">{copy.extras}</h2>
          {offers.length === 0 ? (
            <p className="text-sm" style={{ color: LABEL }}>
              {copy.noExtras}
            </p>
          ) : (
            <ul className="space-y-3">
              {offers.map((o) => (
                <li
                  key={o.campaignId}
                  className="flex items-start justify-between gap-3 rounded-2xl border p-3"
                  style={{ borderColor: BORDER }}
                >
                  <div>
                    <p className="font-medium">{o.name}</p>
                    <p className="text-sm" style={{ color: LABEL }}>
                      {o.description}
                    </p>
                    <p className="mt-1 text-sm font-semibold">
                      +{money(String(o.priceDelta), o.currencyCode)}
                      {o.type === 'room_upgrade' ? ' / night' : ''}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={acceptUpsell.isPending || o.alreadyAccepted}
                    onClick={() => acceptUpsell.mutate(o.campaignId)}
                  >
                    {o.alreadyAccepted ? copy.added : copy.add}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => goAfterExtras(session)}>
              {copy.skip}
            </Button>
            <Button className="flex-1" onClick={() => goAfterExtras(session)}>
              {copy.continue}
            </Button>
          </div>
        </section>
      )}

      {step === 'pay' && (
        <section className="space-y-4 rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
          <h2 className="text-lg font-semibold">{copy.payment}</h2>
          <p className="text-sm" style={{ color: LABEL }}>
            {copy.outstanding}:{' '}
            <strong style={{ color: SLATE }}>
              {money(String(session.folioBalance), session.reservation.currencyCode)}
            </strong>
          </p>
          <Field label={copy.amountToPay} required>
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
                  returnUrl: checkInReturnUrl(token),
                })
              }
            >
              {pay.isPending ? copy.redirecting : copy.payRedsys}
            </Button>
          ) : session.payment?.clientMode === 'worldline' ? (
            <WorldlineCard
              submitting={pay.isPending}
              getSession={worldlineSession}
              submitLabel={copy.payNow}
              onPaid={(p) =>
                pay.mutate({
                  ...p,
                  gatewayProvider: 'worldline',
                  returnUrl: checkInReturnUrl(token),
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
            <Button
              className="w-full"
              disabled={pay.isPending || !Number(payAmount)}
              onClick={() => pay.mutate({ paymentToken: 'tok_demo', gatewayProvider: 'mock' })}
            >
              {pay.isPending ? copy.processing : copy.payDemo}
            </Button>
          ) : (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {copy.paymentNotConfigured}
            </p>
          )}
        </section>
      )}

      {step === 'ready' && (
        <section className="space-y-4 rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
          <h2 className="text-lg font-semibold">{copy.preCheckedIn}</h2>
          {statusLine === 'pay' ||
          (session.folioBalance > 0.009 && session.config.requirePaymentWhenBalanceDue) ? (
            <Button className="w-full" onClick={() => setStep('pay')}>
              {copy.payToFinish(
                money(String(session.folioBalance), session.reservation.currencyCode),
              )}
            </Button>
          ) : session.canSelfCheckIn.allowed ? (
            <>
              {selfCheckIn.isError && (
                <p className="text-sm text-red-600">{errorMessage(selfCheckIn.error)}</p>
              )}
              <Button
                className="w-full"
                disabled={selfCheckIn.isPending}
                onClick={() => selfCheckIn.mutate()}
              >
                {selfCheckIn.isPending ? copy.checkingIn : copy.checkInGetAccess}
              </Button>
            </>
          ) : (
            <p className="text-sm" style={{ color: LABEL }}>
              {typeof statusLine === 'string' ? statusLine : copy.preparingRoom}
            </p>
          )}
        </section>
      )}

      {step === 'access' && access && (
        <section className="space-y-4 rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
          <h2 className="text-lg font-semibold">{copy.roomAccess}</h2>
          <div
            className="p-5"
            style={{
              background: '#fff',
              border: `1px solid ${BORDER}`,
              borderRadius: 16,
              boxShadow: '0 1px 3px rgba(68, 72, 99, 0.08)',
            }}
          >
            <p
              className="font-semibold"
              style={{ color: SLATE, fontSize: 32, lineHeight: 1.2 }}
            >
              {copy.room} {access.roomNumber ?? '—'}
            </p>
            <p
              className="mt-4"
              style={{
                color: TEAL,
                fontSize: 40,
                fontWeight: 300,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '0.12em',
              }}
            >
              {access.accessCode ?? '······'}
            </p>
            <p className="mt-2 text-sm" style={{ color: LABEL }}>
              {copy.accessCode}
            </p>
            {access.instructions && (
              <p className="mt-4 text-sm" style={{ color: LABEL }}>
                {access.instructions}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                const text = `Room ${access.roomNumber} · Code ${access.accessCode}`;
                void navigator.clipboard?.writeText(text);
              }}
            >
              {copy.copyCode}
            </Button>
            {access.wallet?.google?.available && access.wallet.google.saveUrl && (
              <a href={access.wallet.google.saveUrl} target="_blank" rel="noreferrer" className="inline-flex justify-center">
                <img
                  src={walletAsset('add-to-google-wallet.svg')}
                  alt="Add to Google Wallet"
                  height={40}
                />
              </a>
            )}
            {access.wallet?.apple?.available && access.wallet.apple.downloadPath && (
              <a href={access.wallet.apple.downloadPath} className="inline-flex justify-center">
                <img
                  src={walletAsset('add-to-apple-wallet.svg')}
                  alt="Add to Apple Wallet"
                  height={40}
                />
              </a>
            )}
            {access.mobileKey?.deepLink && (
              <a
                className="inline-flex flex-1 items-center justify-center rounded-brand px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: TEAL }}
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
  labels,
  done,
  current,
}: {
  labels: Record<string, string>;
  done: Record<string, boolean>;
  current: string;
}) {
  const order = ['reg', 'id', 'upsell', 'pay', 'ready'] as const;
  const currentIdx = order.indexOf(
    (current === 'access' ? 'ready' : current) as (typeof order)[number],
  );

  return (
    <ol className="flex gap-1.5">
      {order.map((id, idx) => {
        const isDone = done[id] || (currentIdx > idx && id !== 'ready');
        const isCurrent = idx === currentIdx || (current === 'access' && id === 'ready');
        return (
          <li
            key={id}
            className="flex-1 rounded-full px-2 py-1.5 text-center text-[11px] font-medium"
            style={{
              background: isDone || isCurrent ? '#e8e8ef' : '#f0f0f6',
              color: isDone || isCurrent ? SLATE : LABEL,
            }}
          >
            {isDone && !isCurrent ? '✓ ' : ''}
            {labels[id]}
          </li>
        );
      })}
    </ol>
  );
}
