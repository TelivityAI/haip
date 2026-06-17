import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { bookingApi, errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { PriceBreakdown } from '../components/PriceBreakdown';
import { useBookingFlow } from '../context/BookingFlowContext';
import { money } from '../lib/format';
import type { SearchRate } from '../api/types';

export function RoomSelect() {
  const navigate = useNavigate();
  const { criteria, roomType, rate, quote, setSelection, setQuote } = useBookingFlow();
  const [selectedRateId, setSelectedRateId] = useState(rate?.ratePlanId);

  useEffect(() => {
    if (!criteria || !roomType) navigate('/', { replace: true });
  }, [criteria, roomType, navigate]);

  const quoteMutation = useMutation({
    mutationFn: (r: SearchRate) =>
      bookingApi.quote({
        roomTypeId: roomType!.roomTypeId,
        ratePlanId: r.ratePlanId,
        checkIn: criteria!.checkIn,
        checkOut: criteria!.checkOut,
        adults: criteria!.adults,
        children: criteria!.children,
      }),
    onSuccess: (q) => setQuote(q),
  });

  const pickRate = (r: SearchRate) => {
    setSelectedRateId(r.ratePlanId);
    setSelection(roomType!, r);
    setQuote(undefined);
    quoteMutation.mutate(r);
  };

  // Auto-quote the pre-selected (cheapest) rate on first render.
  const autoRatePlanId = rate?.ratePlanId;
  useEffect(() => {
    if (roomType && rate && !quote && quoteMutation.isIdle) {
      quoteMutation.mutate(rate);
    }
    // Only re-run when the pre-selected room/rate identity changes.
  }, [roomType, autoRatePlanId]);

  if (!criteria || !roomType) return null;

  const rates = roomType.rates ?? [];

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={() => navigate('/results')}>
        ← Back to rooms
      </Button>
      <h1 className="text-xl font-semibold text-gray-900">
        {roomType.roomTypeName ?? roomType.name ?? 'Room'}
      </h1>

      <div className="space-y-2">
        {rates.map((r) => {
          const active = r.ratePlanId === selectedRateId;
          return (
            <button
              key={r.ratePlanId}
              type="button"
              onClick={() => pickRate(r)}
              className={`flex w-full items-center justify-between rounded-md border p-4 text-left transition ${
                active ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white hover:border-gray-400'
              }`}
            >
              <div>
                <div className="font-medium text-gray-900">{r.ratePlanName ?? 'Standard rate'}</div>
                {r.cancellationPolicy?.description && (
                  <div className="mt-1 text-xs text-gray-500">
                    {r.cancellationPolicy.description}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="font-semibold text-gray-900">
                  {money(r.totalAmount, r.currencyCode ?? 'USD')}
                </div>
                <div className="text-xs text-gray-400">total</div>
              </div>
            </button>
          );
        })}
        {rates.length === 0 && (
          <p className="text-sm text-gray-500">No rates available for this room.</p>
        )}
      </div>

      {quoteMutation.isPending && <p className="text-sm text-gray-500">Calculating price…</p>}
      {quoteMutation.isError && (
        <p className="text-sm text-red-600">{errorMessage(quoteMutation.error)}</p>
      )}

      {quote && (
        <>
          <PriceBreakdown quote={quote} />
          <Button className="w-full" onClick={() => navigate('/guest')}>
            Continue to guest details
          </Button>
        </>
      )}
    </div>
  );
}
