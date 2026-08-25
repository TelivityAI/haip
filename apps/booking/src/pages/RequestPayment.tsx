import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useNavigate } from 'react-router-dom';
import { bookingApi, errorMessage } from '../api/client';
import type {
  RequestPaymentMethodSetupRequest,
  RequestPaymentMethodSetupResponse,
} from '../api/types';
import { Button } from '../components/Button';
import { RequestFlowFrame } from '../components/RequestStayDocket';
import { StripeSetupForm } from '../components/StripeSetupForm';
import { useBookingFlow } from '../context/BookingFlowContext';
import { useConfig } from '../context/ConfigContext';
import { REQUEST_CARD_CONSENT_VERSION } from '../lib/requestCardConsent';
import { requestPayload } from '../lib/requestPayload';

function effectiveStripeAppearance(config: {
  primaryColor?: string | null;
}) {
  const widget = document.querySelector<HTMLElement>('.haip-booking');
  const source = widget ?? document.documentElement;
  const computed = getComputedStyle(source);
  const token = (name: string, fallback: string) =>
    source.style.getPropertyValue(name).trim() ||
    computed.getPropertyValue(name).trim() ||
    fallback;

  return {
    variables: {
      colorPrimary:
        source.style.getPropertyValue('--haip-primary').trim() ||
        config.primaryColor?.trim() ||
        computed.getPropertyValue('--haip-primary').trim() ||
        '#0D9488',
      colorText: token('--haip-text', '#183153'),
      colorBackground: token('--haip-surface', '#FFFFFF'),
      colorDanger: '#B42318',
      borderRadius: token('--haip-radius', '0.375rem'),
    },
  };
}

function RequestPaymentHeading({ optional }: { optional: boolean }) {
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">
        Step 3 of 3 · Payment details
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[#183153]">
        Secure your request
      </h1>
      <p className="mt-2 text-sm leading-6 text-[#667085]">
        {optional
          ? 'If you add a card, it will be securely saved by Stripe. '
          : 'Your card will be securely saved by Stripe. '}
        <strong className="text-[#183153]">You will not be charged now.</strong>{' '}
        The hotel reviews every request before confirming.
      </p>
    </div>
  );
}

interface SetupRequestState {
  status: 'idle' | 'pending' | 'success' | 'error';
  data?: RequestPaymentMethodSetupResponse;
  error?: unknown;
}

function useRequestPaymentSetup() {
  const [state, setState] = useState<SetupRequestState>({ status: 'idle' });
  const generation = useRef(0);
  const inFlight = useRef<{
    key: string;
    promise: Promise<RequestPaymentMethodSetupResponse>;
  }>();

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const mutate = useCallback((request: RequestPaymentMethodSetupRequest) => {
    const requestGeneration = ++generation.current;
    setState({ status: 'pending' });
    const promise =
      inFlight.current?.key === request.idempotencyKey
        ? inFlight.current.promise
        : bookingApi.createRequestPaymentMethodSetup(request);
    inFlight.current = { key: request.idempotencyKey, promise };
    const clearSettledRequest = () => {
      if (inFlight.current?.promise === promise) inFlight.current = undefined;
    };
    void promise.then(
      (data) => {
        clearSettledRequest();
        if (generation.current === requestGeneration) {
          setState({ status: 'success', data });
        }
      },
      (error: unknown) => {
        clearSettledRequest();
        if (generation.current === requestGeneration) {
          setState({ status: 'error', error });
        }
      },
    );
  }, []);

  const reset = useCallback(() => {
    generation.current += 1;
    setState({ status: 'idle' });
  }, []);

  return {
    data: state.data,
    error: state.error,
    isError: state.status === 'error',
    isPending: state.status === 'pending',
    isSuccess: state.status === 'success',
    mutate,
    reset,
  };
}

export function RequestPayment() {
  const navigate = useNavigate();
  const { config, isLoading } = useConfig();
  const flow = useBookingFlow();
  const [optionalCardSelected, setOptionalCardSelected] = useState(false);
  const collectCard =
    config?.paymentMethodCollection === 'required' || optionalCardSelected;

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

  const setupMutation = useRequestPaymentSetup();

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
      setupMutation.isError
    ) {
      return;
    }
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
    void flow
      .submitRequest(
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
      )
      .catch(() => undefined);
  };

  const propertyName = config.displayName?.trim() || 'the hotel';
  const setup = setupMutation.data;
  const pageError = setupMutation.isError
    ? errorMessage(setupMutation.error)
    : flow.requestSubmissionStatus === 'error'
      ? errorMessage(flow.requestSubmissionError)
      : undefined;
  const isSubmitting = flow.requestSubmissionStatus === 'pending';
  const skipCard = () => {
    setupMutation.reset();
    setOptionalCardSelected(false);
    submitRequest();
  };
  const retrySetup = () => {
    if (!idempotencyKey || !flow.guest?.email) return;
    setupMutation.reset();
    setupMutation.mutate({
      guestEmail: flow.guest.email,
      idempotencyKey,
    });
  };

  return (
    <RequestFlowFrame active={3}>
      <Button
        variant="ghost"
        onClick={() => navigate('/request/application')}
        disabled={isSubmitting}
      >
        ← Back to your details
      </Button>
      <RequestPaymentHeading
        optional={config.paymentMethodCollection === 'optional'}
      />

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
                onClick={() => setOptionalCardSelected(true)}
                disabled={isSubmitting}
              >
                Add a card
              </Button>
              <Button
                className="flex-1"
                onClick={skipCard}
                disabled={isSubmitting}
              >
                {isSubmitting
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
              disabled={isSubmitting}
            >
              {isSubmitting
                ? 'Submitting request…'
                : 'Submit booking request'}
            </Button>
          </div>
        ) : setupMutation.isPending || !idempotencyKey ? (
          <p className="text-sm text-[#667085]">Preparing secure card entry…</p>
        ) : setupMutation.isError ? (
          <div>
            <p role="alert" className="rounded-brand border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorMessage(setupMutation.error)}
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={retrySetup}
                disabled={isSubmitting}
              >
                Retry secure card entry
              </Button>
              {config.paymentMethodCollection === 'optional' && (
                <Button
                  className="flex-1"
                  onClick={skipCard}
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? 'Submitting request…'
                    : 'Continue without a card'}
                </Button>
              )}
            </div>
          </div>
        ) : setup && stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: setup.clientSecret,
              appearance: effectiveStripeAppearance(config),
            }}
          >
            <StripeSetupForm
              propertyName={propertyName}
              submitting={isSubmitting}
              onSkip={
                config.paymentMethodCollection === 'optional'
                  ? skipCard
                  : undefined
              }
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
