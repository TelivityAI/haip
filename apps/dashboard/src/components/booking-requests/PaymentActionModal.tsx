import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import Modal from '../ui/Modal';
import { bookingRequestKeys } from './queryKeys';
import { validateMoneyInput } from './moneyInput';
import { apiErrorMessage, type BookingRequestPayment } from './types';

export type PaymentAction = 'charge' | 'external' | 'refund' | 'external_return' | 'retain';

interface PaymentActionModalProps {
  action: PaymentAction;
  requestId: string;
  propertyId: string;
  currencyCode: string;
  payment?: BookingRequestPayment;
  initialAmount?: string;
  onClose: () => void;
}

function newIdentity(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function PaymentActionModal({
  action,
  requestId,
  propertyId,
  currencyCode,
  payment,
  initialAmount = '',
  onClose,
}: PaymentActionModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(initialAmount);
  const [method, setMethod] = useState('cash');
  const [processedAt, setProcessedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [provider, setProvider] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [idempotencyKey] = useState(newIdentity);
  const amountValidation = validateMoneyInput(amount, currencyCode);
  const hasAmountError = amount !== '' && amountValidation.error != null;

  const title = t(`bookingRequests.paymentActions.${action}.title`);
  const actionLabel = t(`bookingRequests.paymentActions.${action}.action`);
  const needsReference = action === 'external' || action === 'external_return';
  const isReady = amountValidation.canonical != null
    && (!needsReference || reference.trim().length > 0)
    && (action !== 'retain' || reason.trim().length > 0);

  const mutation = useMutation({
    mutationFn: () => {
      const base = `/v1/booking-requests/${requestId}/payments`;
      const config = { params: { propertyId } };
      if (action === 'charge') {
        return api.post(`${base}/charge`, { amount: amountValidation.canonical!, idempotencyKey }, config);
      }
      if (action === 'external') {
        return api.post(`${base}/external`, {
          amount: amountValidation.canonical!,
          currencyCode,
          method,
          processedAt: new Date(processedAt).toISOString(),
          ...(provider.trim() ? { provider: provider.trim() } : {}),
          reference: reference.trim(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }, config);
      }
      if (!payment) throw new Error(t('bookingRequests.paymentActions.paymentRequired'));
      if (action === 'refund') {
        return api.post(`${base}/${payment.id}/refunds`, {
          amount: amountValidation.canonical!,
          idempotencyKey,
        }, config);
      }
      if (action === 'external_return') {
        return api.post(`${base}/${payment.id}/external-returns`, {
          amount: amountValidation.canonical!,
          processedAt: new Date(processedAt).toISOString(),
          reference: reference.trim(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }, config);
      }
      return api.post(`${base}/${payment.id}/retentions`, {
        amount: amountValidation.canonical!,
        reason: reason.trim(),
      }, config);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.root(propertyId) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.payments(propertyId, requestId) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.installments(propertyId, requestId) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.messages(propertyId, requestId) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.audit(propertyId, requestId) }),
        queryClient.invalidateQueries({ queryKey: ['folios', propertyId] }),
      ]);
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={title}>
      <p className="mb-4 text-sm leading-6 text-telivity-slate">
        {t(`bookingRequests.paymentActions.${action}.description`)}
      </p>

      <div className="space-y-4">
        <label className="block text-sm font-medium text-telivity-slate">
          {t('bookingRequests.paymentActions.amount')}
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            aria-invalid={hasAmountError}
            onChange={(event) => setAmount(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
          />
          {hasAmountError ? (
            <span className="mt-1 block text-xs font-medium text-telivity-orange">
              {t(`bookingRequests.validation.${amountValidation.error}`)}
            </span>
          ) : null}
        </label>

        {action === 'external' ? (
          <>
            <label className="block text-sm font-medium text-telivity-slate">
              {t('bookingRequests.paymentActions.method')}
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
              >
                {['credit_card', 'debit_card', 'cash', 'bank_transfer', 'pix', 'other'].map((value) => (
                  <option key={value} value={value}>{t(`bookingRequests.methods.${value}`)}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-telivity-slate">
              {t('bookingRequests.paymentActions.provider')}
              <input value={provider} onChange={(event) => setProvider(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
            </label>
          </>
        ) : null}

        {(action === 'external' || action === 'external_return') ? (
          <>
            <label className="block text-sm font-medium text-telivity-slate">
              {t('bookingRequests.paymentActions.processedAt')}
              <input type="datetime-local" value={processedAt} onChange={(event) => setProcessedAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
            </label>
            <label className="block text-sm font-medium text-telivity-slate">
              {t('bookingRequests.paymentActions.reference')}
              <input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
            </label>
            <label className="block text-sm font-medium text-telivity-slate">
              {t('bookingRequests.paymentActions.notes')}
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
            </label>
          </>
        ) : null}

        {action === 'retain' ? (
          <label className="block text-sm font-medium text-telivity-slate">
            {t('bookingRequests.paymentActions.retain.reason')}
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
          </label>
        ) : null}
      </div>

      {mutation.isError ? (
        <div role="alert" className="mt-4 rounded-lg border border-telivity-orange/40 bg-telivity-orange/10 p-3 text-sm text-telivity-navy">
          {apiErrorMessage(mutation.error, t('bookingRequests.paymentActions.error'))}
        </div>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} disabled={mutation.isPending} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-telivity-slate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:opacity-50">
          {t('bookingRequests.common.cancel')}
        </button>
        <button type="button" onClick={() => mutation.mutate()} disabled={!isReady || mutation.isPending} className="rounded-lg bg-telivity-deep-blue px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          {mutation.isPending ? t('bookingRequests.paymentActions.saving') : actionLabel}
        </button>
      </div>
    </Modal>
  );
}
