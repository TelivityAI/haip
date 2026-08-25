import { useMemo } from 'react';
import { CheckCircle2, CircleDollarSign, FileCheck2, Mail } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { bookingRequestKeys } from './queryKeys';
import type {
  BookingRequestAuditHistoryItem,
  BookingRequestDetail,
} from './types';

function auditIcon(summary: string) {
  if (summary.startsWith('payment.') || summary.startsWith('resolution.') || summary.startsWith('allocation.')) {
    return CircleDollarSign;
  }
  if (summary.startsWith('email.')) return Mail;
  if (summary === 'request.accepted' || summary === 'request.denied') return CheckCircle2;
  return FileCheck2;
}

export default function RequestAudit({
  request,
  propertyId,
}: {
  request: BookingRequestDetail;
  propertyId: string;
}) {
  const { t, i18n } = useTranslation();
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }), [i18n.language]);
  const historyQuery = useQuery({
    queryKey: bookingRequestKeys.audit(propertyId, request.id),
    queryFn: () => api.get(
      `/v1/booking-requests/${request.id}/audit-history`,
      { params: { propertyId } },
    ).then((response) => response.data?.data ?? response.data ?? []),
  });
  const entries = (Array.isArray(historyQuery.data)
    ? historyQuery.data
    : []) as BookingRequestAuditHistoryItem[];

  const amountFor = (entry: BookingRequestAuditHistoryItem) => {
    const amount = entry.details['acceptedTotal']
      ?? entry.details['amount']
      ?? entry.details['fixedAmount'];
    return typeof amount === 'string' || typeof amount === 'number'
      ? formatMoney(amount, request.currencyCode)
      : null;
  };

  return (
    <section aria-labelledby="request-audit-title" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="request-audit-title" className="font-semibold text-telivity-navy">{t('bookingRequests.audit.title')}</h2>
      <p className="mt-1 text-sm text-telivity-slate">{t('bookingRequests.audit.description')}</p>

      {historyQuery.isLoading ? (
        <p className="mt-6 text-sm text-telivity-slate">{t('bookingRequests.common.loading')}</p>
      ) : historyQuery.isError ? (
        <div role="alert" className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-telivity-orange/40 bg-telivity-orange/10 p-3 text-sm text-telivity-navy">
          <span>{t('bookingRequests.audit.loadError')}</span>
          <button type="button" onClick={() => historyQuery.refetch()} className="font-semibold text-telivity-deep-blue underline underline-offset-2">
            {t('bookingRequests.common.retry')}
          </button>
        </div>
      ) : entries.length === 0 ? (
        <p className="mt-6 text-sm text-telivity-slate">{t('bookingRequests.audit.empty')}</p>
      ) : (
        <ol className="mt-6 space-y-0">
          {entries.map((entry, index) => {
            const Icon = auditIcon(entry.summary);
            const amount = amountFor(entry);
            const label = entry.details['label'];
            return (
              <li key={entry.id} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0">
                {index < entries.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-[0.9375rem] top-8 w-px bg-slate-200" /> : null}
                <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-telivity-deep-blue/10 text-telivity-deep-blue">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <div className="min-w-0 pt-1">
                  <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
                    <h3 className="font-semibold text-telivity-navy">
                      {t(`bookingRequests.audit.events.${entry.summary.replace('.', '_')}`)}
                    </h3>
                    <time className="text-xs text-telivity-slate">{dateFormatter.format(new Date(entry.occurredAt))}</time>
                  </div>
                  {amount || typeof label === 'string' ? (
                    <p className="mt-1 text-sm text-telivity-slate">
                      {[typeof label === 'string' ? label : null, amount].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-telivity-slate">
                    {t('bookingRequests.audit.actor', { actor: entry.actorDisplay })}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
