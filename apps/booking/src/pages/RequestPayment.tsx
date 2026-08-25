import { useEffect, useMemo, useRef, useState } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { bookingApi, errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { RequestFlowFrame } from '../components/RequestStayDocket';
import {
  REQUEST_CARD_CONSENT_VERSION,
  StripeSetupForm,
} from '../components/StripeSetupForm';
import { useBookingFlow } from '../context/BookingFlowContext';
import { useConfig } from '../context/ConfigContext';
import { requestPayload } from '../lib/requestPayload';

export function RequestPayment() {
  const navigate = useNavigate();
  const { config, isLoading } = useConfig();
  const flow = useBookingFlow();
  const [collectCard, setCollectCard] = useState(
    config?.paymentMethodCollection === 'required',
  );
  const requestedSetupKey = useRef<string>();

  useEffect(() => {
    if (
      !flow.criteria ||
      !flow.roomType ||
      !flow.rate ||
      !flow.quote ||
      !flow.guest
    ) {
      navigate('/', { replace: true });
    }
  }, [
    flow.criteria,
    flow.roomType,
    flow.rate,
    flow.quote,
    flow.guest,
    navigate,
  ]);

  useEffect(() => {
    if (!isLoading && config?.bookingMode !== 'request') {
      navigate('/payment', { replace: true });
    } else if (!isLoading && config?.paymentMethodCollection === 'disabled') {
      navigate('/request/application', { replace: true });
    }
  }, [
    config?.bookingMode,
    config?.paymentMethodCollection,
    isLoading,
    navigate,
  ]);

  useEffect(() => {
    if (config?.paymentMethodCollection === 'required') setCollectCard(true);
  }, [config?.paymentMethodCollection]);

  const setupMutation = useMutation({
    mutationFn: bookingApi.createRequestPaymentMethodSetup,
  });
  const submitMutation = useMutation({
    mutationFn: bookingApi.submitRequest,
  });

  const idempotencyKey = flow.requestIdempotencyKey;
  useEffect(() => {
    if (!idempotencyKey) flow.ensureRequestIdempotencyKey();
  }, [flow, idempotencyKey]);

  useEffect(() => {
    if (
      !collectCard ||
      !idempotencyKey ||
      !flow.guest?.email ||
      setupMutation.isPending ||
      setupMutation.isSuccess ||
      requestedSetupKey.current === idempotencyKey
    ) {
      return;
    }
    requestedSetupKey.current = idempotencyKey;
    setupMutation.mutate({
      guestEmail: flow.guest.email,
      idempotencyKey,
    });
  }, [
    collectCard,
    flow.guest?.email,
    idempotencyKey,
    setupMutation,
  ]);

  const publishableKey = config?.stripePublishableKey?.trim();
  const stripePromise = useMemo(
    () => (collectCard && publishableKey ? loadStripe(publishableKey) : null),
    [collectCard, publishableKey],
  );

  if (
    isLoading ||
    config?.bookingMode !== 'request' ||
    config.paymentMethodCollection === 'disabled' ||
    !flow.criteria ||
    !flow.roomType ||
    !flow.rate ||
    !flow.quote ||
    !flow.guest
  ) {
    return null;
  }

  const submitRequest = (
    card?: { setupIntentId: string; consentText: string },
  ) => {
    const stableKey = flow.requestIdempotencyKey ?? flow.ensureRequestIdempotencyKey();
    submitMutation.mutate(
      requestPayload(
        {
          idempotencyKey: stableKey,
          criteria: flow.criteria!,
          roomType: flow.roomType!,
          rate: flow.rate!,
          guest: flow.guest!,
          serviceIds: flow.serviceIds,
          applicationAnswers: flow.applicationAnswers,
        },
        card
          ? {
              ...card,
              consentVersion: REQUEST_CARD_CONSENT_VERSION,
            }
          : undefined,
      ),
      {
        onSuccess: (acknowledgement) => {
          flow.setRequestAcknowledgement(acknowledgement);
          navigate('/request/received');
        },
      },
    );
  };

  const propertyName = config.displayName?.trim() || 'the hotel';
  const setup = setupMutation.data;
  const pageError = setupMutation.isError
    ? errorMessage(setupMutation.error)
    : submitMutation.isError
      ? errorMessage(submitMutation.error)
      : undefined;

  return (
    <RequestFlowFrame active={3}>
      <Button variant="ghost" onClick={() => navigate('/request/application')}>
        ← Back to your details
      </Button>
      <div className="mt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">
          Step 3 of 3 · Payment details
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[#183153]">
          Secure your request
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#667085]">
          Your card will be securely saved by Stripe.{' '}
          <strong className="text-[#183153]">You will not be charged now.</strong>{' '}
          The hotel reviews every request before confirming.
        </p>
      </div>

      <div className="mt-5 rounded-brand border border-[#D0D5DD] bg-white p-5 sm:p-6">
        {config.paymentMethodCollection === 'optional' && !collectCard ? (
          <div>
            <h2 className="text-base font-semibold text-[#183153]">
              Add a payment method?
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#667085]">
              Adding a card can help the hotel process an approved request. It is
              optional and nothing is charged when you submit.
            </p>
            {pageError && (
              <p role="alert" className="mt-4 rounded-brand border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {pageError}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setCollectCard(true)}
                disabled={submitMutation.isPending}
              >
                Add a card
              </Button>
              <Button
                className="flex-1"
                onClick={() => submitRequest()}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending
                  ? 'Submitting request…'
                  : 'Continue without a card'}
              </Button>
            </div>
          </div>
        ) : flow.setupIntentId ? (
          <div>
            <h2 className="text-base font-semibold text-[#183153]">
              Payment method securely saved
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#667085]">
              No charge has been made. Submit your request for hotel review.
            </p>
            {pageError && (
              <p role="alert" className="mt-4 rounded-brand border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {pageError}
              </p>
            )}
            <Button
              className="mt-5 w-full"
              onClick={() =>
                submitRequest({
                  setupIntentId: flow.setupIntentId!,
                  consentText: flow.setupIntentConsentText!,
                })
              }
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending
                ? 'Submitting request…'
                : 'Submit booking request'}
            </Button>
          </div>
        ) : setupMutation.isPending || !idempotencyKey ? (
          <p className="text-sm text-[#667085]">Preparing secure card entry…</p>
        ) : setupMutation.isError ? (
          <p role="alert" className="rounded-brand border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMessage(setupMutation.error)}
          </p>
        ) : setup && stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: setup.clientSecret,
              appearance: {
                variables: {
                  colorPrimary: config.primaryColor?.trim() || '#0D9488',
                  colorText: '#183153',
                  colorDanger: '#B42318',
                  borderRadius: '6px',
                },
              },
            }}
          >
            <StripeSetupForm
              propertyName={propertyName}
              submitting={submitMutation.isPending}
              onConfirmed={(setupIntentId, consentText) => {
                flow.setSetupIntentId(setupIntentId);
                flow.setSetupIntentConsentText(consentText);
                submitRequest({ setupIntentId, consentText });
              }}
            />
          </Elements>
        ) : (
          <p role="alert" className="rounded-brand border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Secure card collection is unavailable. Please contact the hotel.
          </p>
        )}

        {pageError && collectCard && !setupMutation.isError && !flow.setupIntentId && (
          <p role="alert" className="mt-4 rounded-brand border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {pageError}
          </p>
        )}
      </div>
    </RequestFlowFrame>
  );
}
