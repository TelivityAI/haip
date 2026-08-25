import { useEffect, useRef, useState } from 'react';
import {
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Button } from './Button';

export const REQUEST_CARD_CONSENT_VERSION = 'request-card-v1';

export function requestCardConsent(propertyName: string): string {
  return `I authorize ${propertyName} to securely save this payment method and charge amounts explicitly recorded against this stay. I understand no charge is made when submitting.`;
}

export function StripeSetupForm({
  propertyName,
  submitting,
  onConfirmed,
}: {
  propertyName: string;
  submitting: boolean;
  onConfirmed: (setupIntentId: string, consentText: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const consentText = requestCardConsent(propertyName);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

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
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-brand border border-[#D0D5DD] p-3">
        <PaymentElement />
      </div>
      <div className="rounded-brand border border-[#B7E3DD] bg-[#F0F9F7] p-3 text-xs leading-5 text-[#29655E]">
        Card details are handled directly by Stripe and never pass through the hotel.
      </div>
      <label className="flex items-start gap-3 text-sm leading-6 text-[#344054]">
        <input
          type="checkbox"
          className="mt-1"
          checked={consentAccepted}
          onChange={(event) => setConsentAccepted(event.target.checked)}
        />
        <span>{consentText}</span>
      </label>
      {error && (
        <p role="alert" className="rounded-brand border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={!stripe || !elements || !consentAccepted || confirming || submitting}
      >
        {confirming || submitting
          ? 'Submitting request…'
          : 'Save card and submit booking request'}
      </Button>
    </form>
  );
}
