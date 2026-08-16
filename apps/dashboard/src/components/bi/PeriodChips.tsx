import { format, startOfMonth, subDays } from 'date-fns';

export type BiPeriod = 'today' | 'yesterday' | '7d' | '30d' | 'mtd';

const PERIODS: BiPeriod[] = ['today', 'yesterday', '7d', '30d', 'mtd'];

interface PeriodChipsProps {
  value: BiPeriod;
  onChange: (period: BiPeriod) => void;
  labels: Record<BiPeriod, string>;
}

export function periodRange(period: BiPeriod, now = new Date()): {
  date: string;
  startDate: string;
  endDate: string;
  compareDate: string;
} {
  const today = format(now, 'yyyy-MM-dd');
  const yesterday = format(subDays(now, 1), 'yyyy-MM-dd');

  switch (period) {
    case 'yesterday':
      return {
        date: yesterday,
        startDate: yesterday,
        endDate: yesterday,
        compareDate: format(subDays(now, 2), 'yyyy-MM-dd'),
      };
    case '7d':
      return {
        date: today,
        startDate: format(subDays(now, 6), 'yyyy-MM-dd'),
        endDate: today,
        compareDate: yesterday,
      };
    case '30d':
      return {
        date: today,
        startDate: format(subDays(now, 29), 'yyyy-MM-dd'),
        endDate: today,
        compareDate: yesterday,
      };
    case 'mtd':
      return {
        date: today,
        startDate: format(startOfMonth(now), 'yyyy-MM-dd'),
        endDate: today,
        compareDate: yesterday,
      };
    case 'today':
    default:
      return {
        date: today,
        startDate: today,
        endDate: today,
        compareDate: yesterday,
      };
  }
}

export default function PeriodChips({ value, onChange, labels }: PeriodChipsProps) {
  return (
    <div className="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-white/60 border border-black/[0.04] backdrop-blur-sm">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
            value === p
              ? 'bg-telivity-navy text-white shadow-sm'
              : 'text-telivity-slate hover:bg-white hover:text-telivity-navy'
          }`}
        >
          {labels[p]}
        </button>
      ))}
    </div>
  );
}
