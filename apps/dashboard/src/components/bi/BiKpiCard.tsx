import type { LucideIcon } from 'lucide-react';
import Sparkline from './Sparkline';
import { BI } from './chartTheme';

interface BiKpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  sparkline?: number[];
  sparkColor?: string;
  numericValue?: number;
  threshold?: { warnBelow?: number; goodAbove?: number };
  onClick?: () => void;
}

function thresholdStatus(
  numericValue: number | undefined,
  threshold?: { warnBelow?: number; goodAbove?: number },
): 'ok' | 'warn' | 'neutral' {
  if (numericValue == null || !threshold) return 'neutral';
  if (threshold.warnBelow != null && numericValue < threshold.warnBelow) return 'warn';
  if (threshold.goodAbove != null && numericValue >= threshold.goodAbove) return 'ok';
  if (threshold.warnBelow == null && threshold.goodAbove == null) return 'neutral';
  return 'ok';
}

export default function BiKpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  sparkline,
  sparkColor,
  numericValue,
  threshold,
  onClick,
}: BiKpiCardProps) {
  const status = thresholdStatus(numericValue, threshold);
  const valueClass =
    status === 'warn'
      ? 'text-telivity-orange'
      : status === 'ok'
        ? 'text-telivity-dark-teal'
        : 'text-telivity-navy';
  const iconWrap =
    status === 'warn'
      ? 'bg-telivity-orange/10'
      : status === 'ok'
        ? 'bg-telivity-dark-teal/10'
        : 'bg-telivity-teal/10';
  const iconColor =
    status === 'warn'
      ? 'text-telivity-orange'
      : status === 'ok'
        ? 'text-telivity-dark-teal'
        : 'text-telivity-teal';

  const body = (
    <>
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-telivity-teal via-telivity-deep-blue to-telivity-orange opacity-80" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-telivity-mid-grey font-semibold">
            {title}
          </p>
          <p className={`text-2xl font-semibold mt-1.5 tabular-nums tracking-tight ${valueClass}`}>
            {value}
          </p>
          {subtitle && <p className="text-xs text-telivity-mid-grey mt-1">{subtitle}</p>}
          {trend && (
            <p
              className={`text-xs mt-1.5 font-semibold ${
                trend.value >= 0 ? 'text-telivity-dark-teal' : 'text-telivity-orange'
              }`}
            >
              {trend.value >= 0 ? '▲' : '▼'} {Math.abs(trend.value).toFixed(1)}% {trend.label}
            </p>
          )}
        </div>
        <div className={`p-2.5 rounded-xl shrink-0 ${iconWrap}`}>
          <Icon size={18} className={iconColor} />
        </div>
      </div>
      {sparkline && sparkline.length > 1 && (
        <div className="mt-3 -mx-1">
          <Sparkline data={sparkline} color={sparkColor ?? BI.teal} height={40} />
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`relative overflow-hidden bg-white rounded-2xl shadow-sm border border-black/[0.03] p-5 text-left w-full bi-enter hover:ring-2 hover:ring-telivity-teal/25 transition-all cursor-pointer`}
      >
        {body}
      </button>
    );
  }

  return (
    <div className="relative overflow-hidden bg-white rounded-2xl shadow-sm border border-black/[0.03] p-5 text-left w-full bi-enter">
      {body}
    </div>
  );
}
