import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { bookingApi, errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { Field, inputClass } from '../components/Field';
import { money } from '../lib/format';
import type { BookingDetails } from '../api/types';

interface ManageState {
  confirmationNumber?: string;
  email?: string;
}

export function ManageBooking() {
  const { state } = useLocation();
  const prefill = (state ?? {}) as ManageState;

  const [confirmationNumber, setConfirmationNumber] = useState(prefill.confirmationNumber ?? '');
  const [email, setEmail] = useState(prefill.email ?? '');
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const lookup = useMutation({
    mutationFn: () => bookingApi.getBooking(confirmationNumber.trim()),
    onSuccess: (b) => {
      setBooking(b);
      setCancelled(false);
    },
    onError: () => setBooking(null),
  });

  const cancel = useMutation({
    mutationFn: () => bookingApi.cancelBooking(confirmationNumber.trim(), 'Cancelled by guest'),
    onSuccess: () => {
      setCancelled(true);
      setBooking((b) => (b ? { ...b, status: 'cancelled' } : b));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmationNumber.trim()) lookup.mutate();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Manage your booking</h1>

      <form onSubmit={submit} className="space-y-4 rounded-md border border-gray-200 bg-white p-6">
        <Field label="Confirmation number" htmlFor="cn" required>
          <input
            id="cn"
            className={inputClass}
            placeholder="HAIP-XXXXXXXX"
            value={confirmationNumber}
            onChange={(e) => setConfirmationNumber(e.target.value)}
          />
        </Field>
        <Field label="Email on booking" htmlFor="email">
          <input
            id="email"
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={lookup.isPending}>
          {lookup.isPending ? 'Looking up…' : 'Find booking'}
        </Button>
        {lookup.isError && (
          <p className="text-sm text-red-600">{errorMessage(lookup.error)}</p>
        )}
      </form>

      {booking && (
        <div className="space-y-4 rounded-md border border-gray-200 bg-white p-6 text-sm">
          <Row label="Confirmation" value={booking.confirmationNumber} />
          <Row label="Guest" value={booking.guestName} />
          <Row label="Status" value={booking.status} />
          <Row label="Room" value={booking.roomType} />
          <Row label="Check-in" value={booking.checkIn} />
          <Row label="Check-out" value={booking.checkOut} />
          <Row label="Total" value={money(booking.rateAmount, booking.currencyCode)} />
          {booking.folioBalance != null && (
            <Row label="Balance" value={money(booking.folioBalance, booking.currencyCode)} />
          )}

          {cancelled ? (
            <p className="rounded-md border border-green-200 bg-green-50 p-3 text-green-700">
              This booking has been cancelled.
            </p>
          ) : booking.status !== 'cancelled' ? (
            <div className="pt-2">
              <Button
                variant="secondary"
                className="w-full border-red-300 text-red-600 hover:bg-red-50"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
              >
                {cancel.isPending ? 'Cancelling…' : 'Cancel booking'}
              </Button>
              {cancel.isError && (
                <p className="mt-2 text-sm text-red-600">{errorMessage(cancel.error)}</p>
              )}
            </div>
          ) : null}
        </div>
      )}
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
