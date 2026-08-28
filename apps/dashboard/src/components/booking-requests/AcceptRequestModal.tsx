import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import Modal from '../ui/Modal';
import { bookingRequestKeys } from './queryKeys';
import { validateMoneyInput } from './moneyInput';
import {
  apiErrorMessage,
  quoteTotal,
  type BookingRequestAcceptancePreview,
  type BookingRequestDetail,
  type BookingRequestPriceSource,
} from './types';

interface AcceptRequestModalProps {
  request: BookingRequestDetail;
  propertyId: string;
  onClose: () => void;
}

export default function AcceptRequestModal({
  request,
  propertyId,
  onClose,
}: AcceptRequestModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [priceSource, setPriceSource] = useState<Exclude<BookingRequestPriceSource, null>>('submitted');
  const [customTotal, setCustomTotal] = useState('');
  const [customReason, setCustomReason] = useState('');
  const submittedTotal = quoteTotal(request.submittedQuoteSnapshot);
  const previewQuery = useQuery({
    queryKey: bookingRequestKeys.acceptancePreview(propertyId, request.id),
    queryFn: () => api.get(
      `/v1/booking-requests/${request.id}/acceptance-preview`,
      { params: { propertyId } },
    ).then((response) => response.data?.data ?? response.data),
  });
  const candidatePreview = previewQuery.data as BookingRequestAcceptancePreview | undefined;
  const preview = candidatePreview?.requestId === request.id
    ? candidatePreview
    : undefined;
  const currentTotal = preview?.currentTotal;
  const customValidation = validateMoneyInput(customTotal, request.currencyCode);
  const customAmountError = priceSource === 'custom'
    && customTotal !== ''
    && customValidation.error != null;
  const customReady = priceSource !== 'custom'
    || (customValidation.canonical != null && customReason.trim().length > 0);

  const mutation = useMutation({
    mutationFn: () => api.post(
      `/v1/booking-requests/${request.id}/accept`,
      {
        priceSource,
        previewToken: preview?.previewToken,
        ...(priceSource === 'custom' ? {
          customTotal: customValidation.canonical!,
          customReason: customReason.trim(),
        } : {}),
      },
      { params: { propertyId } },
    ),
    onError: async (error) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) await previewQuery.refetch();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.root(propertyId) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.payments(propertyId, request.id) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.installments(propertyId, request.id) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.messages(propertyId, request.id) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.audit(propertyId, request.id) }),
        queryClient.invalidateQueries({ queryKey: ['reservations', propertyId] }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.genericFoliosRoot(propertyId) }),
        queryClient.invalidateQueries({ queryKey: ['payments', propertyId] }),
      ]);
      onClose();
    },
  });

  const options: Array<{
    value: Exclude<BookingRequestPriceSource, null>;
    label: string;
    amount: string;
    description: string;
  }> = [
    {
      value: 'submitted',
      label: t('bookingRequests.accept.submitted'),
      amount: formatMoney(submittedTotal, request.currencyCode),
      description: t('bookingRequests.accept.submittedDescription'),
    },
    {
      value: 'current',
      label: t('bookingRequests.accept.current'),
      amount: currentTotal
        ? formatMoney(currentTotal, request.currencyCode)
        : t('bookingRequests.accept.recheckedOnAccept'),
      description: t('bookingRequests.accept.currentDescription'),
    },
    {
      value: 'custom',
      label: t('bookingRequests.accept.custom'),
      amount: t('bookingRequests.accept.enterAmount'),
      description: t('bookingRequests.accept.customDescription'),
    },
  ];

  return (
    <Modal open onClose={onClose} title={t('bookingRequests.accept.title')} wide>
      <p className="mb-5 text-sm leading-6 text-telivity-slate">
        {t('bookingRequests.accept.independence')}
      </p>

      {previewQuery.isLoading ? (
        <div className="mb-4 rounded-lg border border-slate-200 bg-telivity-light-grey/40 p-3 text-sm text-telivity-slate">
          {t('bookingRequests.common.loading')}
        </div>
      ) : previewQuery.isError || !preview ? (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-telivity-orange/40 bg-telivity-orange/10 p-3 text-sm text-telivity-navy">
          <span>{t('bookingRequests.accept.error')}</span>
          <button type="button" onClick={() => previewQuery.refetch()} className="font-semibold text-telivity-deep-blue underline underline-offset-2">
            {t('bookingRequests.common.retry')}
          </button>
        </div>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="sr-only">{t('bookingRequests.accept.priceChoice')}</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer gap-3 rounded-xl border p-4 focus-within:ring-2 focus-within:ring-telivity-deep-blue ${
              priceSource === option.value
                ? 'border-telivity-deep-blue bg-telivity-deep-blue/5'
                : 'border-slate-300 bg-white'
            }`}
          >
            <input
              type="radio"
              name="price-source"
              value={option.value}
              checked={priceSource === option.value}
              onChange={() => setPriceSource(option.value)}
              className="mt-1 text-telivity-deep-blue focus:ring-telivity-deep-blue"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-2 font-semibold text-telivity-navy">
                <span>{option.label}</span>
                <span>{option.amount}</span>
              </span>
              <span className="mt-1 block text-sm text-telivity-slate">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {priceSource === 'custom' ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-telivity-slate">
            {t('bookingRequests.accept.customTotal')}
            <input
              type="text"
              inputMode="decimal"
              aria-label={t('bookingRequests.accept.customTotal')}
              aria-invalid={customAmountError}
              value={customTotal}
              onChange={(event) => setCustomTotal(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
            />
            {customAmountError ? (
              <span className="mt-1 block text-xs font-medium text-telivity-orange">
                {t(`bookingRequests.validation.${customValidation.error}`)}
              </span>
            ) : null}
          </label>
          <label className="text-sm font-medium text-telivity-slate">
            {t('bookingRequests.accept.customReason')}
            <input
              type="text"
              value={customReason}
              onChange={(event) => setCustomReason(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
            />
          </label>
        </div>
      ) : null}

      {mutation.isError ? (
        <div role="alert" className="mt-4 rounded-lg border border-telivity-orange/40 bg-telivity-orange/10 p-3 text-sm text-telivity-navy">
          {apiErrorMessage(mutation.error, t('bookingRequests.accept.error'))}
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
          disabled={!preview || !customReady || mutation.isPending}
          className="rounded-lg bg-telivity-deep-blue px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? t('bookingRequests.accept.accepting') : t('bookingRequests.actions.accept')}
        </button>
      </div>
    </Modal>
  );
}
