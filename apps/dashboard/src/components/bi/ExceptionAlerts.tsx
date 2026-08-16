import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  Wallet,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface ExceptionItem {
  id: string;
  severity: 'critical' | 'warn' | 'ok' | 'info';
  title: string;
  detail?: string;
  href?: string;
}

const SEVERITY: Record<
  ExceptionItem['severity'],
  { wrap: string; icon: LucideIcon; iconClass: string }
> = {
  critical: {
    wrap: 'border-telivity-orange/30 bg-telivity-orange/5',
    icon: AlertTriangle,
    iconClass: 'text-telivity-orange',
  },
  warn: {
    wrap: 'border-telivity-yellow/40 bg-telivity-yellow/10',
    icon: FileWarning,
    iconClass: 'text-telivity-yellow',
  },
  ok: {
    wrap: 'border-telivity-dark-teal/20 bg-telivity-dark-teal/5',
    icon: CheckCircle2,
    iconClass: 'text-telivity-dark-teal',
  },
  info: {
    wrap: 'border-telivity-deep-blue/20 bg-telivity-deep-blue/5',
    icon: ClipboardList,
    iconClass: 'text-telivity-deep-blue',
  },
};

interface ExceptionAlertsProps {
  items: ExceptionItem[];
  emptyLabel: string;
}

export function buildFinanceExceptions(input: {
  outstandingBalance?: number;
  openFolios?: number;
  lastAuditStatus?: string | null;
  auditErrors?: number;
  ooo?: number;
  pendingDecisions?: number;
  currencyFmt: (n: number) => string;
  labels: {
    openBalances: string;
    openBalancesDetail: string;
    auditOk: string;
    auditFail: string;
    auditFailDetail: string;
    ooo: string;
    oooDetail: string;
    pendingAgents: string;
    pendingAgentsDetail: string;
  };
}): ExceptionItem[] {
  const items: ExceptionItem[] = [];
  if ((input.outstandingBalance ?? 0) > 0) {
    items.push({
      id: 'balances',
      severity: 'warn',
      title: input.labels.openBalances,
      detail: input.labels.openBalancesDetail
        .replace('{{amount}}', input.currencyFmt(input.outstandingBalance!))
        .replace('{{count}}', String(input.openFolios ?? 0)),
      href: '/folios',
    });
  }
  if (input.lastAuditStatus) {
    const failed = input.lastAuditStatus !== 'completed' && input.lastAuditStatus !== 'success';
    items.push({
      id: 'audit',
      severity: failed || (input.auditErrors ?? 0) > 0 ? 'critical' : 'ok',
      title: failed || (input.auditErrors ?? 0) > 0 ? input.labels.auditFail : input.labels.auditOk,
      detail:
        failed || (input.auditErrors ?? 0) > 0
          ? input.labels.auditFailDetail.replace('{{count}}', String(input.auditErrors ?? 0))
          : undefined,
      href: '/night-audit',
    });
  }
  if ((input.ooo ?? 0) > 0) {
    items.push({
      id: 'ooo',
      severity: 'info',
      title: input.labels.ooo,
      detail: input.labels.oooDetail.replace('{{count}}', String(input.ooo)),
      href: '/rooms',
    });
  }
  if ((input.pendingDecisions ?? 0) > 0) {
    items.push({
      id: 'agents',
      severity: 'info',
      title: input.labels.pendingAgents,
      detail: input.labels.pendingAgentsDetail.replace('{{count}}', String(input.pendingDecisions)),
      href: '/revenue',
    });
  }
  return items;
}

export default function ExceptionAlerts({ items, emptyLabel }: ExceptionAlertsProps) {
  const navigate = useNavigate();

  if (!items.length) {
    return (
      <div className="flex items-center gap-2 text-xs text-telivity-dark-teal bg-telivity-dark-teal/5 border border-telivity-dark-teal/15 rounded-xl px-4 py-3">
        <CheckCircle2 size={16} />
        <span className="font-medium">{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {items.map((item) => {
        const cfg = SEVERITY[item.severity];
        const Icon = item.id === 'balances' ? Wallet : cfg.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => item.href && navigate(item.href)}
            className={`text-left rounded-xl border px-4 py-3 transition-transform hover:-translate-y-0.5 ${cfg.wrap} ${
              item.href ? 'cursor-pointer' : 'cursor-default'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <Icon size={16} className={`mt-0.5 shrink-0 ${cfg.iconClass}`} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-telivity-navy truncate">{item.title}</p>
                {item.detail && (
                  <p className="text-xs text-telivity-slate mt-0.5 line-clamp-2">{item.detail}</p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
