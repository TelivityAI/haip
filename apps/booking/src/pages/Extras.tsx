import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { bookingApi, errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { PriceBreakdown } from '../components/PriceBreakdown';
import { useBookingFlow } from '../context/BookingFlowContext';
import { money } from '../lib/format';
import type { SellableService } from '../api/types';

function postingLabel(rule: string, nights: number): string {
  switch (rule) {
    case 'per_night':
      return `per night × ${nights}`;
    case 'on_consumption':
      return 'pay at property';
    default:
      return 'once';
  }
}

export function Extras() {
  const navigate = useNavigate();
  const {
    criteria,
    roomType,
    rate,
    quote,
    serviceIds,
    setServiceIds,
    setQuote,
  } = useBookingFlow();
  const [selected, setSelected] = useState<string[]>(serviceIds);

  useEffect(() => {
    if (!criteria || !roomType || !rate || !quote) {
      navigate('/', { replace: true });
    }
  }, [criteria, roomType, rate, quote, navigate]);

  const servicesQuery = useQuery({
    queryKey: ['booking-services'],
    queryFn: () => bookingApi.listServices(),
  });

  const quoteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      bookingApi.quote({
        roomTypeId: roomType!.roomTypeId,
        ratePlanId: rate!.ratePlanId,
        checkIn: criteria!.checkIn,
        checkOut: criteria!.checkOut,
        adults: criteria!.adults,
        children: criteria!.children,
        serviceIds: ids.length ? ids : undefined,
      }),
    onSuccess: (q) => setQuote(q),
  });

  const toggle = (svc: SellableService) => {
    const next = selected.includes(svc.id)
      ? selected.filter((id) => id !== svc.id)
      : [...selected, svc.id];
    setSelected(next);
    setServiceIds(next);
    quoteMutation.mutate(next);
  };

  if (!criteria || !roomType || !rate || !quote) return null;

  const services = servicesQuery.data?.data ?? [];
  const nights = quote.nights;

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={() => navigate('/room')}>
        ← Back to rates
      </Button>
      <h1 className="text-xl font-semibold text-gray-900">Enhance your stay</h1>
      <p className="text-sm text-gray-600">
        Optional extras. You can skip this step.
      </p>

      {servicesQuery.isLoading && (
        <p className="text-sm text-gray-500">Loading extras…</p>
      )}
      {servicesQuery.isError && (
        <p className="text-sm text-red-600">{errorMessage(servicesQuery.error)}</p>
      )}

      {services.length > 0 && (
        <div className="space-y-2">
          {services.map((svc) => {
            const active = selected.includes(svc.id);
            return (
              <label
                key={svc.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 transition ${
                  active
                    ? 'border-gray-900 bg-gray-50'
                    : 'border-gray-200 bg-white hover:border-gray-400'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={active}
                  onChange={() => toggle(svc)}
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{svc.name}</div>
                  {svc.description && (
                    <div className="mt-0.5 text-xs text-gray-500">{svc.description}</div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    {postingLabel(svc.postingRule, nights)}
                  </div>
                </div>
                <div className="text-right font-semibold text-gray-900">
                  {money(svc.price, svc.currencyCode)}
                </div>
              </label>
            );
          })}
        </div>
      )}

      {!servicesQuery.isLoading && services.length === 0 && (
        <p className="text-sm text-gray-500">No extras available for this stay.</p>
      )}

      {quoteMutation.isPending && (
        <p className="text-sm text-gray-500">Updating price…</p>
      )}
      {quoteMutation.isError && (
        <p className="text-sm text-red-600">{errorMessage(quoteMutation.error)}</p>
      )}

      <PriceBreakdown quote={quote} />

      <Button
        className="w-full"
        onClick={() => navigate('/guest')}
        disabled={quoteMutation.isPending}
      >
        Continue to guest details
      </Button>
    </div>
  );
}
