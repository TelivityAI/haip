import { useMemo } from 'react';
import { CheckCircle2, CircleDollarSign, FileCheck2, Mail } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { bookingRequestKeys } from './queryKeys';
import type {
  BookingRequestDetail,
  BookingRequestEmailDelivery,
  BookingRequestPaymentsResponse,
} from './types';

interface AuditEntry {
  key: string;
  title: string;
  description: string;
  timestamp: string;
  actor?: string | null;
  icon: typeof FileCheck2;
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
  const paymentsQuery = useQuery({
    queryKey: bookingRequestKeys.payments(propertyId, request.id),
    queryFn: () => api.get(`/v1/booking-requests/${request.id}/payments`, { params: { propertyId } })
      .then((response) => response.data?.data ?? response.data),
  });
  const messagesQuery = useQuery({
    queryKey: bookingRequestKeys.messages(propertyId, request.id),
    queryFn: () => api.get(`/v1/booking-requests/${request.id}/emails`, { params: { propertyId } })
      .then((response) => response.data?.data ?? response.data ?? []),
  });
  const paymentData = paymentsQuery.data as BookingRequestPaymentsResponse | undefined;
  const messages = Array.isArray(messagesQuery.data)
    ? messagesQuery.data as BookingRequestEmailDelivery[]
    : [];
  const entries: AuditEntry[] = [
    {
      key: 'submitted',
      title: t('bookingRequests.audit.submitted'),
      description: t('bookingRequests.audit.submittedDescription'),
      timestamp: request.createdAt,
      icon: FileCheck2,
    },
    ...(request.decidedAt ? [{
      key: 'decision',
      title: request.status === 'accepted'
        ? t('bookingRequests.audit.accepted')
        : t('bookingRequests.audit.denied'),
      description: request.status === 'accepted'
        ? t('bookingRequests.audit.acceptedDescription', {
          amount: formatMoney(request.acceptedTotal, request.currencyCode),
          source: request.acceptedPriceSource
            ? t(`bookingRequests.priceSources.${request.acceptedPriceSource}`)
            : '—',
        })
        : t('bookingRequests.audit.deniedDescription'),
      timestamp: request.decidedAt,
      actor: request.decidedBy,
      icon: CheckCircle2,
    } satisfies AuditEntry] : []),
    ...(paymentData?.movements ?? []).map((movement): AuditEntry => ({
      key: `movement-${movement.id}`,
      title: movement.status === 'failed'
        ? t('bookingRequests.audit.paymentFailed')
        : movement.originalPaymentId
          ? t('bookingRequests.audit.paymentReturned')
          : t('bookingRequests.audit.paymentCaptured'),
      description: t('bookingRequests.audit.paymentDescription', {
        amount: formatMoney(movement.amount, movement.currencyCode),
        method: t(`bookingRequests.methods.${movement.method}`, { defaultValue: movement.method }),
      }),
      timestamp: movement.processedAt ?? movement.createdAt,
      icon: CircleDollarSign,
    })),
    ...(paymentData?.resolutions ?? []).map((resolution): AuditEntry => ({
      key: `resolution-${resolution.id}`,
      title: t(`bookingRequests.audit.resolutions.${resolution.type}`),
      description: t('bookingRequests.audit.resolutionDescription', {
        amount: formatMoney(resolution.amount, request.currencyCode),
      }),
      timestamp: resolution.resolvedAt ?? resolution.createdAt,
      actor: resolution.resolvedBy,
      icon: CircleDollarSign,
    })),
    ...messages.map((message): AuditEntry => ({
      key: `message-${message.id}`,
      title: t('bookingRequests.audit.message', { kind: t(`bookingRequests.messageKinds.${message.kind}`) }),
      description: t('bookingRequests.audit.messageDescription', {
        status: t(`bookingRequests.messageStatuses.${message.status}`),
      }),
      timestamp: message.sentAt ?? message.lastAttemptAt ?? message.createdAt,
      icon: Mail,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const formatDate = (value: string) => dateFormatter.format(new Date(value));

  return (
    <section aria-labelledby="request-audit-title" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="request-audit-title" className="font-semibold text-telivity-navy">{t('bookingRequests.audit.title')}</h2>
      <p className="mt-1 text-sm text-telivity-slate">{t('bookingRequests.audit.description')}</p>
      <ol className="mt-6 space-y-0">
        {entries.map((entry, index) => {
          const Icon = entry.icon;
          return (
            <li key={entry.key} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0">
              {index < entries.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-[0.9375rem] top-8 w-px bg-slate-200" /> : null}
              <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-telivity-deep-blue/10 text-telivity-deep-blue">
                <Icon size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0 pt-1">
                <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
                  <h3 className="font-semibold text-telivity-navy">{entry.title}</h3>
                  <time className="text-xs text-telivity-slate">{formatDate(entry.timestamp)}</time>
                </div>
                <p className="mt-1 text-sm text-telivity-slate">{entry.description}</p>
                {entry.actor ? <p className="mt-1 text-xs text-telivity-slate">{t('bookingRequests.audit.actor', { actor: entry.actor })}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
