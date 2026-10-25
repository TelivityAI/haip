import { useEffect, useId, useState } from 'react';
import { bookingApi, errorMessage } from '../api/client';
import { loadWorldlineTokenizer, type WorldlineTokenizer } from '../lib/worldline-tokenizer';
import { Button } from './Button';
import type { PaymentResult } from './StripeCard';

/**
 * In-page card field. The tokenizer script mounts an iframe from the payment
 * host. Submit returns a hosted tokenization id. The card number never reaches HAIP.
 */
type WorldlineSession = {
  tokenizerScriptUrl: string;
  hostedTokenizationUrl: string;
  sri?: string;
};

export function WorldlineCard({
  onPaid,
  submitting,
  getSession,
  submitLabel = 'Pay & confirm booking',
}: {
  onPaid: (r: PaymentResult & { returnUrl: string }) => void;
  submitting: boolean;
  /** Override session source (e.g. guest check-in magic-token API). */
  getSession?: () => Promise<WorldlineSession>;
  submitLabel?: string;
}) {
  const reactId = useId();
  const elementId = `worldline-card-${reactId.replace(/:/g, '')}`;
  const [tokenizer, setTokenizer] = useState<WorldlineTokenizer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await (getSession ?? (() => bookingApi.worldlineTokenization()))();
        if (cancelled) return;
        await loadWorldlineTokenizer(session.tokenizerScriptUrl, session.sri ?? null);
        if (cancelled || !window.Tokenizer) return;
        const next = new window.Tokenizer(session.hostedTokenizationUrl, elementId, {
          hideCardholderName: false,
        });
        await next.initialize();
        if (!cancelled) setTokenizer(next);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [elementId, getSession]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenizer) return;
    setCreating(true);
    setError(null);
    try {
      const result = await tokenizer.submitTokenization();
      if (!result.success || !result.hostedTokenizationId) {
        setError(result.error?.message || 'Card could not be checked');
        return;
      }
      onPaid({
        paymentToken: result.hostedTokenizationId,
        returnUrl: window.location.href,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div id={elementId} className="min-h-40 rounded-md border border-gray-300 p-3" />
      {!tokenizer && !error && <p className="text-sm text-gray-500">Loading card field…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={!tokenizer || creating || submitting}>
        {creating || submitting ? 'Processing…' : submitLabel}
      </Button>
    </form>
  );
}
