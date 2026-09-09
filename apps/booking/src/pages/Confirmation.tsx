import { useMemo } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { money } from '../lib/format';
import type { BookResponse } from '../api/types';

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

export function Confirmation() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [searchParams] = useSearchParams();
  const fromState = (state ?? {}) as ConfirmationState;

  const resolved = useMemo(() => {
    if (fromState.booking) {
      sessionStorage.removeItem(PENDING_KEY);
      return fromState;
    }
    // Browser return from Redsys loses location.state — restore the book response.
    if (searchParams.get('redsys') === 'ok') {
      const pending = readPendingConfirmation();
      if (pending?.booking) {
        sessionStorage.removeItem(PENDING_KEY);
        return pending;
      }
    }
    return fromState;
  }, [fromState, searchParams]);

  const { booking, email } = resolved;
  const awaitingNotification =
    Boolean(booking) && searchParams.get('redsys') === 'ok';

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
      <div className="rounded-md border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-sm font-medium text-green-700">
          {awaitingNotification ? 'Booking received — confirming payment' : 'Booking confirmed'}
        </p>
        <p className="mt-2 text-3xl font-bold tracking-wide text-gray-900">
          {booking.confirmationNumber}
        </p>
        <p className="mt-1 text-sm text-gray-600">
          {awaitingNotification
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
              awaitingNotification ? ` (${booking.deposit.status})` : ''
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
