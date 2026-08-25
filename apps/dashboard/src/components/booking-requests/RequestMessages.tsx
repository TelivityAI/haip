import { useMemo } from 'react';
import { Mail, RotateCcw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import StatusBadge from '../ui/StatusBadge';
import { bookingRequestKeys } from './queryKeys';
import { apiErrorMessage, type BookingRequestEmailDelivery } from './types';

interface RequestMessagesProps {
  requestId: string;
  propertyId: string;
  canWrite: boolean;
}

export default function RequestMessages({ requestId, propertyId, canWrite }: RequestMessagesProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }), [i18n.language]);
  const { data, isLoading, isError } = useQuery({
    queryKey: bookingRequestKeys.messages(propertyId, requestId),
    queryFn: () => api.get(
      `/v1/booking-requests/${requestId}/emails`,
      { params: { propertyId } },
    ).then((response) => response.data?.data ?? response.data ?? []),
  });
  const deliveries = Array.isArray(data) ? data as BookingRequestEmailDelivery[] : [];

  const retry = useMutation({
    mutationFn: (deliveryId: string) => api.post(
      `/v1/booking-requests/${requestId}/emails/${deliveryId}/retry`,
      undefined,
      { params: { propertyId } },
    ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.messages(propertyId, requestId) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.audit(propertyId, requestId) }),
      ]);
    },
  });
  const formatDate = (value: string | null) => value
    ? dateFormatter.format(new Date(value))
    : '—';

  if (isLoading) return <p className="text-sm text-telivity-slate">{t('bookingRequests.messages.loading')}</p>;
  if (isError) return <p role="alert" className="text-sm text-telivity-orange">{t('bookingRequests.messages.loadError')}</p>;

  return (
    <section aria-labelledby="request-messages-title" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 id="request-messages-title" className="flex items-center gap-2 font-semibold text-telivity-navy">
          <Mail size={18} className="text-telivity-deep-blue" aria-hidden="true" />
          {t('bookingRequests.messages.title')}
        </h2>
        <p className="mt-1 text-sm text-telivity-slate">{t('bookingRequests.messages.description')}</p>
      </div>

      {deliveries.length ? (
        <ul className="divide-y divide-slate-100">
          {deliveries.map((delivery) => (
            <li key={delivery.id} className="p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-telivity-navy">{delivery.subject}</h3>
                    <StatusBadge status={delivery.status} label={t(`bookingRequests.messageStatuses.${delivery.status}`)} />
                  </div>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-telivity-slate">
                    {t(`bookingRequests.messageKinds.${delivery.kind}`)} · {formatDate(delivery.sentAt ?? delivery.lastAttemptAt ?? delivery.createdAt)}
                  </p>
                </div>
                {canWrite && delivery.status === 'failed' ? (
                  <button
                    type="button"
                    onClick={() => retry.mutate(delivery.id)}
                    disabled={retry.isPending && retry.variables === delivery.id}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:opacity-50"
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    {t('bookingRequests.messages.retry')}
                  </button>
                ) : null}
              </div>
              <p className="mt-4 whitespace-pre-wrap rounded-lg bg-telivity-light-grey/60 p-4 text-sm leading-6 text-telivity-navy">{delivery.bodyText}</p>
              {delivery.errorMessage ? <p className="mt-2 text-sm text-telivity-orange">{delivery.errorMessage}</p> : null}
              <p className="mt-2 text-xs text-telivity-slate">{t('bookingRequests.messages.attempts', { count: delivery.attempts })}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-8 text-center text-sm text-telivity-slate">{t('bookingRequests.messages.empty')}</p>
      )}

      {retry.isError ? (
        <p role="alert" className="m-5 rounded-lg bg-telivity-orange/10 p-3 text-sm text-telivity-navy">
          {apiErrorMessage(retry.error, t('bookingRequests.messages.retryError'))}
        </p>
      ) : null}
      {canWrite ? <p className="border-t border-slate-100 px-5 py-3 text-xs text-telivity-slate">{t('bookingRequests.messages.actorNote')}</p> : null}
    </section>
  );
}
