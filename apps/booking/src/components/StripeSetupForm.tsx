import { useEffect, useRef, useState } from 'react';
import {
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Button } from './Button';
import { requestCardConsent } from '../lib/requestCardConsent';

export function StripeSetupForm({
  propertyName,
  submitting,
  onConfirmed,
  onSkip,
}: {
  propertyName: string;
  submitting: boolean;
  onConfirmed: (setupIntentId: string, consentText: string) => void;
  onSkip?: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const consentText = requestCardConsent(propertyName);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements || !consentAccepted || confirming || submitting) return;

    setConfirming(true);
    setError(undefined);
    const result = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });
    if (!mounted.current) return;
    setConfirming(false);

    if (result.error) {
      setError(result.error.message ?? 'The payment method could not be saved.');
      return;
    }
    if (!result.setupIntent || result.setupIntent.status !== 'succeeded') {
      setError('The payment method setup did not complete. Please try again.');
      return;
    }
    onConfirmed(result.setupIntent.id, consentText);
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={confirming || submitting}>
      <div className="rounded-brand border border-[#D0D5DD] p-3">
        <PaymentElement options={{ readOnly: confirming || submitting }} />
      </div>
      <div className="rounded-brand border border-[#B7E3DD] bg-[#F0F9F7] p-3 text-xs leading-5 text-[#29655E]">
        Card details are handled directly by Stripe and never pass through the hotel.
      </div>
      <label className="flex items-start gap-3 text-sm leading-6 text-[#344054]">
        <input
          type="checkbox"
          className="mt-1"
          checked={consentAccepted}
          disabled={confirming || submitting}
          onChange={(event) => setConsentAccepted(event.target.checked)}
        />
        <span>{consentText}</span>
      </label>
      {error && (
        <p role="alert" className="rounded-brand border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Button
          type="submit"
          className="w-full"
          disabled={!stripe || !elements || !consentAccepted || confirming || submitting}
        >
          {confirming || submitting
            ? 'Submitting request…'
            : error
              ? 'Retry saving card and submit request'
              : 'Save card and submit booking request'}
        </Button>
        {error && onSkip && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={onSkip}
            disabled={confirming || submitting}
          >
            Continue without a card
          </Button>
        )}
      </div>
    </form>
  );
}
