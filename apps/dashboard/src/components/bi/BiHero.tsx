import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import PeriodChips, { type BiPeriod } from './PeriodChips';

interface BiHeroProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  dateLabel: string;
  icon: LucideIcon;
  period?: BiPeriod;
  onPeriodChange?: (p: BiPeriod) => void;
  periodLabels?: Record<BiPeriod, string>;
  actions?: ReactNode;
}

export default function BiHero({
  eyebrow,
  title,
  subtitle,
  dateLabel,
  icon: Icon,
  period,
  onPeriodChange,
  periodLabels,
  actions,
}: BiHeroProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl mb-6 bi-hero">
      <div className="absolute inset-0 bg-gradient-to-br from-telivity-navy via-[#2a3050] to-[#0d5c6e]" />
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(6,189,180,0.45), transparent 45%), radial-gradient(circle at 85% 10%, rgba(242,100,27,0.25), transparent 40%), radial-gradient(circle at 70% 80%, rgba(1,100,145,0.4), transparent 45%)',
        }}
      />
      <div className="relative px-5 sm:px-6 py-6 sm:py-7 flex flex-col lg:flex-row lg:items-end gap-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-telivity-light-teal text-xs font-semibold uppercase tracking-[0.14em] mb-2">
            <Icon size={14} />
            <span>{eyebrow}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">{title}</h1>
          <p className="text-sm text-white/70 mt-1.5 max-w-2xl">{subtitle}</p>
          <p className="text-xs text-white/50 mt-3 font-medium">{dateLabel}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {period && onPeriodChange && periodLabels && (
            <PeriodChips value={period} onChange={onPeriodChange} labels={periodLabels} />
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
