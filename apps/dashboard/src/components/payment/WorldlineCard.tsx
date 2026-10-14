import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { loadWorldlineTokenizer, type WorldlineTokenizer } from '../../lib/worldline-tokenizer';

interface TokenizationSession {
  hostedTokenizationUrl: string;
  sri: string | null;
  tokenizerScriptUrl: string;
}

/**
 * In-page card field for a folio hold. The iframe is served by the payment host.
 * Submit returns a hosted tokenization id. The card number never reaches HAIP.
 */
export function WorldlineCard({
  propertyId,
  disabled = false,
  submitLabel,
  onToken,
  onError,
}: {
  propertyId: string;
  disabled?: boolean;
  submitLabel: string;
  onToken: (hostedTokenizationId: string) => void;
  onError?: (message: string) => void;
}) {
  const reactId = useId();
  const elementId = `worldline-card-${reactId.replace(/:/g, '')}`;
  const [tokenizer, setTokenizer] = useState<WorldlineTokenizer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.post<TokenizationSession>(
          '/v1/payments/worldline/tokenization',
          null,
          { params: { propertyId } },
        );
        if (cancelled) return;
        await loadWorldlineTokenizer(data.tokenizerScriptUrl, data.sri);
        if (cancelled || !window.Tokenizer) return;
        const next = new window.Tokenizer(data.hostedTokenizationUrl, elementId, {
          hideCardholderName: false,
        });
        await next.initialize();
        if (!cancelled) setTokenizer(next);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Card field failed to load';
        setError(message);
        onErrorRef.current?.(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [elementId, propertyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenizer) return;
    setCreating(true);
    setError(null);
    try {
      const result = await tokenizer.submitTokenization();
      if (!result.success || !result.hostedTokenizationId) {
        const message = result.error?.message || 'Card could not be checked';
        setError(message);
        onError?.(message);
        return;
      }
      onToken(result.hostedTokenizationId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Card could not be checked';
      setError(message);
      onError?.(message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div id={elementId} className="min-h-40 rounded-md border border-gray-300 p-3" />
      {!tokenizer && !error && <p className="text-sm text-gray-500">Loading card field…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={disabled || creating || !tokenizer}
        className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {creating || disabled ? 'Processing...' : submitLabel}
      </button>
    </form>
  );
}
