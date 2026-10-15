import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { bookingApi } from '../api/client';
import { Button } from '../components/Button';

/** Payment state comes exclusively from the API, including after OK/KO navigation. */
export function PaymentReturn() {
  const [params] = useSearchParams();
  const reference = params.get('reference') ?? '';
  const payment = useQuery({
    queryKey: ['payment-return', reference],
    queryFn: () => bookingApi.paymentReturnStatus(reference),
    retry: false,
    refetchInterval: (query) => query.state.data?.status === 'processing' ? 3000 : false,
  });
  const status = payment.data?.status;
  const reservationStatus = payment.data?.reservationStatus;
  const bookingConfirmed = status === 'succeeded' && reservationStatus === 'confirmed';
  const reservationCancelled = reservationStatus === 'cancelled';
  const title = payment.isError ? 'We could not check your payment'
    : bookingConfirmed ? 'Booking confirmed'
      : status === 'succeeded' ? 'Payment authorized'
        : status === 'failed' ? 'Payment was not completed'
          : status === 'cancelled' ? 'Payment was cancelled'
            : status === 'unavailable' ? 'Contact the hotel about your payment'
              : 'Confirming your payment';
  const detail = bookingConfirmed
    ? 'Your booking is confirmed. Contact the hotel for your booking details.'
    : status === 'succeeded' && !payment.isError
      ? 'The hotel has received your payment authorization. Contact the hotel for your booking details.'
      : status === 'failed' && reservationCancelled
        ? 'This booking was cancelled because the payment did not complete. You can start again.'
        : status === 'failed' || status === 'cancelled'
          ? 'Please contact the hotel before trying again to avoid a duplicate booking or payment.'
          : 'Your payment status is being checked with the hotel. If you cancelled or your payment did not complete, contact the hotel before trying again to avoid a duplicate booking or payment.';
  return (
    <div className="space-y-4 rounded-md border border-gray-200 bg-white p-6 text-center" aria-live="polite">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      <p className="text-sm text-gray-600">{detail}</p>
      {status !== 'succeeded' && (
        <Button onClick={() => void payment.refetch()} disabled={payment.isFetching}>
          Check payment status
        </Button>
      )}
    </div>
  );
}
