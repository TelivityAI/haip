import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useMutation } from '@tanstack/react-query';
import { bookingApi, errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { PriceBreakdown } from '../components/PriceBreakdown';
import { StripeCard, type PaymentResult } from '../components/StripeCard';
import { useConfig } from '../context/ConfigContext';
import { useBookingFlow } from '../context/BookingFlowContext';
import { money } from '../lib/format';
import type { BookResponse } from '../api/types';

export function Payment() {
  const navigate = useNavigate();
  const { config } = useConfig();
  const { criteria, roomType, rate, quote, guest, serviceIds } = useBookingFlow();

  useEffect(() => {
    if (!criteria || !roomType || !rate || !quote || !guest) {
      navigate('/', { replace: true });
    }
  }, [criteria, roomType, rate, quote, guest, navigate]);

  const bookMutation = useMutation({
    mutationFn: (payment?: PaymentResult) =>
      bookingApi.book({
        roomTypeId: roomType!.roomTypeId,
        ratePlanId: rate!.ratePlanId,
        checkIn: criteria!.checkIn,
        checkOut: criteria!.checkOut,
        adults: criteria!.adults,
        children: criteria!.children,
        guestFirstName: guest!.firstName,
        guestLastName: guest!.lastName,
        guestEmail: guest!.email,
        guestPhone: guest!.phone,
        specialRequests: guest!.specialRequests,
        paymentToken: payment?.paymentToken,
        cardLastFour: payment?.cardLastFour,
        cardBrand: payment?.cardBrand,
        serviceIds: serviceIds.length ? serviceIds : undefined,
      }),
    onSuccess: (res: BookResponse) => {
      navigate('/confirmation', { state: { booking: res, email: guest!.email } });
    },
  });

  const publishableKey = config?.stripePublishableKey?.trim();
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  if (!quote || !guest) return null;

  const depositDue = Number(quote.depositDue);
  const needsPayment = depositDue > 0;

  // Mock / demo mode (no Stripe key): submit the well-known MockGateway token.
  const payDemo = () => bookMutation.mutate({ paymentToken: 'tok_demo' });
  const payNoDeposit = () => bookMutation.mutate(undefined);

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={() => navigate('/guest')}>
        ← Back
      </Button>
      <h1 className="text-xl font-semibold text-gray-900">Payment</h1>

      <PriceBreakdown quote={quote} />

      {bookMutation.isError && (
        <p className="text-sm text-red-600">{errorMessage(bookMutation.error)}</p>
      )}

      <div className="rounded-md border border-gray-200 bg-white p-6">
        {!needsPayment ? (
          <>
            <p className="mb-4 text-sm text-gray-600">
              No deposit is required. You'll pay at the property.
            </p>
            <Button className="w-full" onClick={payNoDeposit} disabled={bookMutation.isPending}>
              {bookMutation.isPending ? 'Confirming…' : 'Confirm booking'}
            </Button>
          </>
        ) : stripePromise ? (
          <>
            <p className="mb-4 text-sm text-gray-600">
              Deposit due now: <strong>{money(quote.depositDue, quote.currencyCode)}</strong>
            </p>
            <Elements stripe={stripePromise}>
              <StripeCard
                onPaid={(p) => bookMutation.mutate(p)}
                submitting={bookMutation.isPending}
              />
            </Elements>
          </>
        ) : (
          <>
            <p className="mb-2 text-sm text-gray-600">
              Deposit due now: <strong>{money(quote.depositDue, quote.currencyCode)}</strong>
            </p>
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              Demo mode — no live card processing. A placeholder payment token will be used.
            </p>
            <Button className="w-full" onClick={payDemo} disabled={bookMutation.isPending}>
              {bookMutation.isPending ? 'Confirming…' : 'Pay (demo) & confirm booking'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
