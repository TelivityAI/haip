import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { bookingApi } from '../api/client';
import { Button } from '../components/Button';
import { money } from '../lib/format';
import type { BookResponse, CheckoutStatus } from '../api/types';

interface ConfirmationState {
  booking?: BookResponse;
  email?: string;
}

const PENDING_KEY = 'haip.booking.pendingConfirmation';

function readPendingConfirmation(): ConfirmationState | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConfirmationState;
    if (!parsed?.booking) return null;
    return parsed;
  } catch {
    return null;
  }
}

function bookingFromCheckout(checkout: CheckoutStatus): BookResponse {
  const authorized =
    checkout.paymentStatus === 'authorized' || checkout.paymentStatus === 'captured';
  return {
    success: true,
    confirmationNumber: checkout.confirmationNumber,
    reservationId: checkout.reservationId,
    status: checkout.reservationStatus,
    currencyCode: checkout.currencyCode,
    grandTotal: checkout.amount,
    deposit: {
      paymentId: checkout.paymentId,
      amount: checkout.amount,
      status:
        checkout.depositStatus ??
        (authorized
          ? 'held'
          : checkout.paymentStatus === 'failed'
            ? 'failed'
            : 'pending_redirect'),
      checkoutToken: checkout.checkoutToken,
    },
    lineItems: [],
    cancellationPolicy: 'See rate plan cancellation policy.',
  };
}

export function Confirmation() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [searchParams] = useSearchParams();
  const fromState = (state ?? {}) as ConfirmationState;
  const checkoutToken = searchParams.get('haip_checkout');
  const redsysOk = searchParams.get('redsys') === 'ok';

  const checkoutQuery = useQuery({
    queryKey: ['booking-checkout', checkoutToken],
    queryFn: () => bookingApi.getCheckout(checkoutToken!),
    enabled: Boolean(checkoutToken),
    refetchInterval: (query) => {
      const status = query.state.data?.paymentStatus;
      if (!status || status === 'pending') return 2000;
      return false;
    },
  });

  const [pending] = useState(() =>
    redsysOk && !fromState.booking ? readPendingConfirmation() : null,
  );

  useEffect(() => {
    if (fromState.booking || checkoutQuery.data || pending?.booking) {
      sessionStorage.removeItem(PENDING_KEY);
    }
  }, [fromState.booking, checkoutQuery.data, pending?.booking]);

  const resolved = useMemo(() => {
    if (fromState.booking) return fromState;
    if (checkoutQuery.data) {
      return { booking: bookingFromCheckout(checkoutQuery.data) };
    }
    if (pending?.booking) return pending;
    return fromState;
  }, [fromState, checkoutQuery.data, pending]);

  const { booking, email } = resolved;
  const paymentStatus = checkoutQuery.data?.paymentStatus;
  const awaitingNotification =
    Boolean(booking) && redsysOk && (!paymentStatus || paymentStatus === 'pending');
  const paymentFailed = paymentStatus === 'failed';

  if (checkoutToken && checkoutQuery.isLoading && !booking) {
    return (
      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">Restoring your booking…</p>
      </div>
    );
  }

  if (checkoutToken && checkoutQuery.isError && !booking) {
    return (
      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">
          We could not restore this checkout. If you completed payment, keep any
          confirmation email from the hotel and contact the front desk.
        </p>
        <Button onClick={() => navigate('/')}>Start a new search</Button>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">No booking to display.</p>
        <Button onClick={() => navigate('/')}>Start a new search</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className={`rounded-md border p-6 text-center ${
          paymentFailed ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
        }`}
      >
        <p
          className={`text-sm font-medium ${
            paymentFailed ? 'text-red-700' : 'text-green-700'
          }`}
        >
          {paymentFailed
            ? 'Payment not completed'
            : awaitingNotification
              ? 'Booking received — confirming payment'
              : 'Booking confirmed'}
        </p>
        <p className="mt-2 text-3xl font-bold tracking-wide text-gray-900">
          {booking.confirmationNumber}
        </p>
        <p className="mt-1 text-sm text-gray-600">
          {paymentFailed
            ? 'Your reservation is held pending payment. You can retry from payment or contact the hotel.'
            : awaitingNotification
              ? 'Redsys is notifying the hotel of your payment. Keep this confirmation number.'
              : 'Keep this confirmation number to manage your booking.'}
        </p>
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-6 text-sm">
        <Row label="Status" value={booking.status} />
        <Row label="Total" value={money(booking.grandTotal, booking.currencyCode)} />
        {booking.deposit && (
          <Row
            label={awaitingNotification ? 'Deposit' : 'Deposit paid'}
            value={`${money(booking.deposit.amount, booking.currencyCode)}${
              awaitingNotification || paymentFailed ? ` (${booking.deposit.status})` : ''
            }`}
          />
        )}
        <Row label="Cancellation" value={booking.cancellationPolicy} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          to="/manage"
          state={{ confirmationNumber: booking.confirmationNumber, email }}
          className="flex-1"
        >
          <Button variant="secondary" className="w-full">
            Manage this booking
          </Button>
        </Link>
        <Button className="flex-1" onClick={() => navigate('/')}>
          Book another stay
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-gray-100 py-2 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  );
}
