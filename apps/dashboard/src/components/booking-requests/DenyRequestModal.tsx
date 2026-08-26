import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import Modal from '../ui/Modal';
import { bookingRequestKeys } from './queryKeys';
import { apiErrorMessage } from './types';

interface DenyRequestModalProps {
  requestId: string;
  propertyId: string;
  currencyCode: string;
  unresolvedAmount: number;
  onClose: () => void;
  onResolveMoney: () => void;
}

export default function DenyRequestModal({
  requestId,
  propertyId,
  currencyCode,
  unresolvedAmount,
  onClose,
  onResolveMoney,
}: DenyRequestModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const hasUnresolvedMoney = unresolvedAmount > 0.000001;
  const mutation = useMutation({
    mutationFn: () => api.post(
      `/v1/booking-requests/${requestId}/deny`,
      { reason: reason.trim() },
      { params: { propertyId } },
    ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.root(propertyId) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.payments(propertyId, requestId) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.messages(propertyId, requestId) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.audit(propertyId, requestId) }),
      ]);
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={t('bookingRequests.deny.title')}>
      {hasUnresolvedMoney ? (
        <div role="alert" className="mb-4 rounded-lg border border-telivity-orange/40 bg-telivity-orange/10 p-4 text-sm text-telivity-navy">
          <p className="font-semibold">
            {t('bookingRequests.deny.unresolved', {
              amount: formatMoney(unresolvedAmount, currencyCode),
            })}
          </p>
          <p className="mt-1 text-telivity-slate">{t('bookingRequests.deny.unresolvedDirection')}</p>
          <button
            type="button"
            onClick={onResolveMoney}
            className="mt-3 font-semibold text-telivity-deep-blue underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
          >
            {t('bookingRequests.deny.resolveFirst')}
          </button>
        </div>
      ) : null}

      <label className="text-sm font-medium text-telivity-slate">
        {t('bookingRequests.deny.reason')}
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
        />
      </label>

      {mutation.isError ? (
        <div role="alert" className="mt-4 rounded-lg border border-telivity-orange/40 bg-telivity-orange/10 p-3 text-sm text-telivity-navy">
          {apiErrorMessage(mutation.error, t('bookingRequests.deny.error'))}
        </div>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={mutation.isPending}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-telivity-slate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:opacity-50"
        >
          {t('bookingRequests.common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={hasUnresolvedMoney || !reason.trim() || mutation.isPending}
          className="rounded-lg bg-telivity-orange px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-orange focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? t('bookingRequests.deny.denying') : t('bookingRequests.deny.confirm')}
        </button>
      </div>
    </Modal>
  );
}
