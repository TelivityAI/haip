import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { useBookingFlow } from '../context/BookingFlowContext';

export function RequestReceived() {
  const navigate = useNavigate();
  const { guest, requestAcknowledgement, reset } = useBookingFlow();

  useEffect(() => {
    if (!requestAcknowledgement) navigate('/', { replace: true });
  }, [navigate, requestAcknowledgement]);

  if (!requestAcknowledgement) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="rounded-brand border border-[#F2D49B] bg-[#FFF7E8] p-6 text-center sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7A4F01]">
          Request received · Pending review
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-[#183153]">
          The hotel will review your stay
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#667085]">
          {requestAcknowledgement.message} This is not a confirmed reservation.
        </p>
      </div>

      <div className="rounded-brand border border-[#D0D5DD] bg-white p-6 text-sm leading-6 text-[#344054]">
        <h2 className="font-semibold text-[#183153]">What happens next</h2>
        <p className="mt-2">
          The hotel will review availability, your details, and the quoted stay. A
          response will be sent by email{guest?.email ? ` to ${guest.email}` : ''}.
        </p>
        <p className="mt-3 text-[#667085]">
          You have not been charged and submitting this request did not create a
          booking.
        </p>
      </div>

      <Button
        className="w-full"
        onClick={() => {
          reset();
          navigate('/');
        }}
      >
        Start a new search
      </Button>
    </div>
  );
}
