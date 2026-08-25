import { useBookingFlow } from '../context/BookingFlowContext';
import { calendarDate, money } from '../lib/format';

const REQUEST_STEPS = ['Stay', 'Your details', 'Payment details'];

export function RequestSteps({ active }: { active: 2 | 3 }) {
  return (
    <nav aria-label="Booking request progress" className="mb-6">
      <ol className="grid grid-cols-3 overflow-hidden rounded-brand border border-[#D0D5DD] bg-white text-center text-xs sm:text-sm">
        {REQUEST_STEPS.map((step, index) => {
          const number = index + 1;
          const current = number === active;
          const complete = number < active;
          return (
            <li
              key={step}
              aria-current={current ? 'step' : undefined}
              className={`border-r border-[#D0D5DD] px-2 py-2.5 last:border-r-0 ${
                current
                  ? 'font-semibold text-[var(--haip-primary,#0D9488)]'
                  : complete
                    ? 'font-medium text-[#183153]'
                    : 'text-[#667085]'
              }`}
            >
              <span className="hidden sm:inline">{number}. </span>
              {step}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function RequestStayDocket() {
  const { criteria, roomType, quote } = useBookingFlow();
  if (!criteria || !roomType || !quote) return null;

  return (
    <aside
      aria-label="Your request"
      className="order-first rounded-brand border border-[#D0D5DD] bg-[#F7FAFC] p-4 text-sm lg:order-last lg:sticky lg:top-6 lg:h-fit"
    >
      <p className="font-semibold text-[#183153]">Your request</p>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 lg:block">
        <p className="font-medium text-[#183153]">
          {roomType.roomTypeName ?? roomType.name ?? 'Selected room'}
        </p>
        <p className="text-right font-semibold tabular-nums text-[#183153] lg:hidden">
          {money(quote.grandTotal, quote.currencyCode)}
        </p>
        <p className="col-span-2 text-xs text-[#667085] lg:mt-1">
          {calendarDate(criteria.checkIn)}–{calendarDate(criteria.checkOut)} ·{' '}
          {quote.nights} night
          {quote.nights === 1 ? '' : 's'}
        </p>
      </div>

      <div className="mt-4 hidden space-y-1 border-t border-[#D0D5DD] pt-4 text-[#667085] lg:block">
        <div className="flex justify-between gap-3">
          <span>Room</span>
          <span className="tabular-nums">{money(quote.roomTotal, quote.currencyCode)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Taxes & fees</span>
          <span className="tabular-nums">{money(quote.taxTotal, quote.currencyCode)}</span>
        </div>
        <div className="flex justify-between gap-3 pt-2 font-semibold text-[#183153]">
          <span>Quoted total</span>
          <span className="tabular-nums">{money(quote.grandTotal, quote.currencyCode)}</span>
        </div>
      </div>

      <div className="mt-4 rounded-brand border border-[#F2D49B] bg-[#FFF7E8] p-3">
        <p className="font-semibold text-[#7A4F01]">Request only</p>
        <p className="mt-0.5 text-xs leading-5 text-[#667085]">
          The hotel reviews your request and confirms the final price by email.
        </p>
      </div>
    </aside>
  );
}

export function RequestFlowFrame({
  active,
  children,
}: {
  active: 2 | 3;
  children: React.ReactNode;
}) {
  return (
    <div>
      <RequestSteps active={active} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
        <section className="order-last min-w-0 lg:order-first">{children}</section>
        <RequestStayDocket />
      </div>
    </div>
  );
}
