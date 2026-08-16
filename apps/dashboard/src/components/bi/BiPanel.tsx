import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface BiPanelProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Soft atmospheric wash behind content */
  tone?: 'default' | 'navy' | 'teal';
}

export default function BiPanel({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  className = '',
  tone = 'default',
}: BiPanelProps) {
  const toneClass =
    tone === 'navy'
      ? 'bg-gradient-to-br from-telivity-navy to-[#2c3150] text-white'
      : tone === 'teal'
        ? 'bg-gradient-to-br from-telivity-teal/10 via-white to-white'
        : 'bg-white';

  const titleClass = tone === 'navy' ? 'text-white' : 'text-telivity-navy';
  const subClass = tone === 'navy' ? 'text-white/70' : 'text-telivity-mid-grey';

  return (
    <section
      className={`rounded-2xl shadow-sm border border-black/[0.03] overflow-hidden bi-enter ${toneClass} ${className}`}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <div
              className={`p-2 rounded-xl shrink-0 ${
                tone === 'navy' ? 'bg-white/10' : 'bg-telivity-teal/10'
              }`}
            >
              <Icon size={18} className={tone === 'navy' ? 'text-telivity-light-teal' : 'text-telivity-teal'} />
            </div>
          )}
          <div className="min-w-0">
            <h2 className={`text-sm font-semibold tracking-tight ${titleClass}`}>{title}</h2>
            {subtitle && <p className={`text-xs mt-0.5 ${subClass}`}>{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}
