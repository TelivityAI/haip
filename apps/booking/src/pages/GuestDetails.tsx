import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { Field, inputClass } from '../components/Field';
import { PriceBreakdown } from '../components/PriceBreakdown';
import { useBookingFlow } from '../context/BookingFlowContext';

export function GuestDetails() {
  const navigate = useNavigate();
  const { criteria, roomType, quote, guest, setGuest } = useBookingFlow();

  useEffect(() => {
    if (!criteria || !roomType || !quote) navigate('/', { replace: true });
  }, [criteria, roomType, quote, navigate]);

  const [firstName, setFirstName] = useState(guest?.firstName ?? '');
  const [lastName, setLastName] = useState(guest?.lastName ?? '');
  const [email, setEmail] = useState(guest?.email ?? '');
  const [phone, setPhone] = useState(guest?.phone ?? '');
  const [specialRequests, setSpecialRequests] = useState(guest?.specialRequests ?? '');
  const [error, setError] = useState<string | null>(null);

  if (!quote) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setError('First name, last name and email are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setError(null);
    setGuest({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      specialRequests: specialRequests.trim() || undefined,
    });
    navigate('/payment');
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={() => navigate('/room')}>
        ← Back
      </Button>
      <h1 className="text-xl font-semibold text-gray-900">Guest details</h1>

      <form onSubmit={submit} className="space-y-4 rounded-md border border-gray-200 bg-white p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" required>
            <input id="firstName" className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Last name" htmlFor="lastName" required>
            <input id="lastName" className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <Field label="Email" htmlFor="email" required>
          <input id="email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <input id="phone" type="tel" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Special requests" htmlFor="requests">
          <textarea
            id="requests"
            rows={3}
            className={inputClass}
            value={specialRequests}
            onChange={(e) => setSpecialRequests(e.target.value)}
          />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" className="w-full">
          Continue to payment
        </Button>
      </form>

      <PriceBreakdown quote={quote} />
    </div>
  );
}
