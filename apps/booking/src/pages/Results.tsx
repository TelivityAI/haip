import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { bookingApi, errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { applyBranding } from '../context/ConfigContext';
import { useBookingFlow } from '../context/BookingFlowContext';
import { lowestRate, money } from '../lib/format';
import type { SearchRoomType } from '../api/types';

export function Results() {
  const navigate = useNavigate();
  const { criteria, setBranding, setSelection } = useBookingFlow();

  useEffect(() => {
    if (!criteria) navigate('/', { replace: true });
  }, [criteria, navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['search', criteria],
    enabled: !!criteria,
    queryFn: () =>
      bookingApi.search({
        checkIn: criteria!.checkIn,
        checkOut: criteria!.checkOut,
        adults: criteria!.adults,
        children: criteria!.children,
        promoCode: criteria!.promoCode,
      }),
  });

  useEffect(() => {
    if (data?.branding) {
      setBranding(data.branding);
      applyBranding(data.branding);
    }
  }, [data, setBranding]);

  if (!criteria) return null;

  // Flatten all room types across the (typically single) property result.
  const roomTypes = (data?.results ?? []).flatMap((p) => p.roomTypes ?? []);

  const choose = (rt: SearchRoomType) => {
    const cheapest = [...(rt.rates ?? [])].sort((a, b) => a.totalAmount - b.totalAmount)[0];
    if (cheapest) setSelection(rt, cheapest);
    navigate('/room');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Available rooms</h1>
        <Button variant="ghost" onClick={() => navigate('/')}>
          Change dates
        </Button>
      </div>
      <p className="text-sm text-gray-500">
        {criteria.checkIn} → {criteria.checkOut} · {criteria.adults} adult
        {criteria.adults === 1 ? '' : 's'}
        {criteria.children > 0 ? `, ${criteria.children} children` : ''}
      </p>

      {isLoading && <p className="text-sm text-gray-500">Searching availability…</p>}
      {error && <p className="text-sm text-red-600">{errorMessage(error)}</p>}
      {!isLoading && !error && roomTypes.length === 0 && (
        <p className="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-500">
          No rooms available for these dates. Try different dates.
        </p>
      )}

      <ul className="space-y-3">
        {roomTypes.map((rt) => {
          const from = lowestRate(rt.rates);
          const currency = rt.rates?.[0]?.currencyCode ?? 'USD';
          const photo = rt.images?.[0];
          return (
            <li
              key={rt.roomTypeId}
              className="flex flex-col gap-4 rounded-md border border-gray-200 bg-white p-4 sm:flex-row"
            >
              <div className="h-32 w-full shrink-0 overflow-hidden rounded bg-gray-100 sm:w-48">
                {photo ? (
                  <img src={photo} alt={rt.roomTypeName ?? rt.name ?? 'Room'} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-400">
                    No photo
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col">
                <h2 className="font-semibold text-gray-900">
                  {rt.roomTypeName ?? rt.name ?? 'Room'}
                </h2>
                {rt.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-gray-500">{rt.description}</p>
                )}
                <div className="mt-auto flex items-end justify-between pt-3">
                  <div>
                    {from != null && (
                      <>
                        <span className="text-xs text-gray-400">from</span>
                        <div className="text-lg font-semibold text-gray-900">
                          {money(from, currency)}
                        </div>
                      </>
                    )}
                  </div>
                  <Button onClick={() => choose(rt)}>Select</Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
