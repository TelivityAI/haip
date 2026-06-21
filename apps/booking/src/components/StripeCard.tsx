import { useCallback, useState } from 'react';
import { CardElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Button } from './Button';

export interface PaymentResult {
  paymentToken: string;
  cardLastFour?: string;
  cardBrand?: string;
}

/**
 * Real Stripe card entry. Renders inside <Elements> (see Payment.tsx). On submit
 * it creates a PaymentMethod client-side and returns its id as `paymentToken`.
 * Card data never touches HAIP servers (PCI DSS).
 */
export function StripeCard({
  onPaid,
  submitting,
}: {
  onPaid: (r: PaymentResult) => void;
  submitting: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [cardError, setCardError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!stripe || !elements) return;
      const card = elements.getElement(CardElement);
      if (!card) return;

      setCreating(true);
      setCardError(null);
      const { error, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card,
      });
      setCreating(false);

      if (error) {
        setCardError(error.message ?? 'Card validation failed');
        return;
      }
      if (paymentMethod) {
        onPaid({
          paymentToken: paymentMethod.id,
          cardLastFour: paymentMethod.card?.last4,
          cardBrand: paymentMethod.card?.brand,
        });
      }
    },
    [stripe, elements, onPaid],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-md border border-gray-300 p-3">
        <CardElement options={{ hidePostalCode: true }} />
      </div>
      {cardError && <p className="text-sm text-red-600">{cardError}</p>}
      <Button type="submit" className="w-full" disabled={!stripe || creating || submitting}>
        {creating || submitting ? 'Processing…' : 'Pay & confirm booking'}
      </Button>
    </form>
  );
}
