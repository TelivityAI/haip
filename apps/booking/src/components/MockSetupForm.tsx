import { useState } from 'react';
import { Button } from './Button';
import { requestCardConsent } from '../lib/requestCardConsent';

export function MockSetupForm({
  propertyName,
  setupIntentId,
  submitting,
  onConfirmed,
}: {
  propertyName: string;
  setupIntentId: string;
  submitting: boolean;
  onConfirmed: (setupIntentId: string, consentText: string) => void;
}) {
  const [consentAccepted, setConsentAccepted] = useState(false);
  const consentText = requestCardConsent(propertyName);

  return (
    <div className="space-y-4">
      <div className="rounded-brand border border-[#B7E3DD] bg-[#F0F9F7] p-4">
        <p className="font-semibold text-[#183153]">Local payment simulation</p>
        <p className="mt-1 text-sm leading-6 text-[#667085]">
          Development mode will save a simulated Visa ending in 4242. No card
          details are collected and no payment is made.
        </p>
      </div>
      <label className="flex items-start gap-3 text-sm leading-6 text-[#344054]">
        <input
          type="checkbox"
          className="mt-1"
          checked={consentAccepted}
          disabled={submitting}
          onChange={(event) => setConsentAccepted(event.target.checked)}
        />
        <span>{consentText}</span>
      </label>
      <Button
        type="button"
        className="w-full"
        disabled={!consentAccepted || submitting}
        onClick={() => onConfirmed(setupIntentId, consentText)}
      >
        {submitting
          ? 'Submitting request…'
          : 'Save test card and submit booking request'}
      </Button>
    </div>
  );
}
