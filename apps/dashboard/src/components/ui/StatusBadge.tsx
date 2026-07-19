import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  // Reservation statuses
  confirmed: 'bg-telivity-dark-teal text-white',
  checked_in: 'bg-telivity-deep-blue text-white',
  checked_out: 'bg-telivity-mid-grey text-white',
  cancelled: 'bg-telivity-mid-grey text-white',
  no_show: 'bg-telivity-orange text-white',
  pending: 'bg-telivity-orange text-white',

  // Room statuses
  occupied: 'bg-telivity-teal text-white',
  vacant_clean: 'bg-telivity-dark-teal text-white',
  vacant_dirty: 'bg-telivity-orange text-white',
  clean: 'bg-telivity-dark-teal text-white',
  inspected: 'bg-telivity-dark-teal text-white',
  guest_ready: 'bg-telivity-dark-teal text-white',
  out_of_order: 'bg-telivity-orange text-white',
  out_of_service: 'bg-telivity-mid-grey text-white',

  // Housekeeping statuses
  assigned: 'bg-telivity-deep-blue text-white',
  in_progress: 'bg-telivity-teal text-white',
  completed: 'bg-telivity-dark-teal text-white',
  skipped: 'bg-telivity-mid-grey text-white',

  // VIP
  gold: 'bg-telivity-yellow text-telivity-navy',
  platinum: 'bg-telivity-purple text-white',
  diamond: 'bg-telivity-deep-blue text-white',

  // Generic
  success: 'bg-telivity-dark-teal text-white',
  warning: 'bg-telivity-orange text-white',
  info: 'bg-telivity-deep-blue text-white',
  error: 'bg-telivity-orange text-white',
};

function formatLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

export default function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
  const { t } = useTranslation();
  const colors = STATUS_COLORS[status] ?? 'bg-telivity-mid-grey text-white';
  
  const defaultLabel = formatLabel(status);
  const resolvedLabel = label ?? t([
    `dashboard.roomStatuses.${status}`,
    `housekeeping.statuses.${status}`,
    `reservations.statuses.${status}`,
    `channels.statuses.${status}`,
    `communications.statuses.${status}`,
  ], { defaultValue: defaultLabel });

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${colors} ${className}`}
    >
      {resolvedLabel}
    </span>
  );
}
