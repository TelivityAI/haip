import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Field, inputClass } from '../components/Field';
import { useBookingFlow } from '../context/BookingFlowContext';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function Search() {
  const navigate = useNavigate();
  const { setCriteria } = useBookingFlow();

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);

  const [checkIn, setCheckIn] = useState(isoDate(tomorrow));
  const [checkOut, setCheckOut] = useState(isoDate(new Date(today.getTime() + 2 * 86_400_000)));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [promoCode, setPromoCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (new Date(checkOut) <= new Date(checkIn)) {
      setError('Check-out must be after check-in.');
      return;
    }
    setError(null);
    setCriteria({
      checkIn,
      checkOut,
      adults,
      children,
      promoCode: promoCode.trim() || undefined,
    });
    navigate('/results');
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-gray-200 bg-white p-6">
      <h1 className="text-xl font-semibold text-gray-900">Find a room</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Check-in" htmlFor="checkIn" required>
          <input
            id="checkIn"
            type="date"
            className={inputClass}
            value={checkIn}
            min={isoDate(today)}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </Field>
        <Field label="Check-out" htmlFor="checkOut" required>
          <input
            id="checkOut"
            type="date"
            className={inputClass}
            value={checkOut}
            min={checkIn}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </Field>
        <Field label="Adults" htmlFor="adults" required>
          <input
            id="adults"
            type="number"
            min={1}
            className={inputClass}
            value={adults}
            onChange={(e) => setAdults(Math.max(1, Number(e.target.value)))}
          />
        </Field>
        <Field label="Children" htmlFor="children">
          <input
            id="children"
            type="number"
            min={0}
            className={inputClass}
            value={children}
            onChange={(e) => setChildren(Math.max(0, Number(e.target.value)))}
          />
        </Field>
      </div>

      <Field label="Promo code" htmlFor="promo">
        <input
          id="promo"
          type="text"
          className={inputClass}
          value={promoCode}
          placeholder="Optional"
          onChange={(e) => setPromoCode(e.target.value)}
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="submit" className="w-full">
        Search availability
      </Button>
    </form>
  );
}
