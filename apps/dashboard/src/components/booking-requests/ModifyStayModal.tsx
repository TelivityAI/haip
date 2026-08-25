import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import Modal from '../ui/Modal';
import { validateMoneyInput } from './moneyInput';
import { bookingRequestKeys } from './queryKeys';
import {
  apiErrorMessage,
  type BookingRequestDetail,
  type BookingRequestStayAmendmentPreview,
  type StayAmendmentPriceSource,
} from './types';

type ModifyStayModalProps = {
  request: BookingRequestDetail;
  propertyId: string;
  onClose: () => void;
};

function newIdempotencyKey(requestId: string): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `stay-amendment:${requestId}:${suffix}`;
}

export default function ModifyStayModal({
  request,
  propertyId,
  onClose,
}: ModifyStayModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const customTotalErrorId = useId();
  const operational = request.operationalReservation!;
  const [arrivalDate, setArrivalDate] = useState(operational.arrivalDate);
  const [departureDate, setDepartureDate] = useState(operational.departureDate);
  const [priceSource, setPriceSource] = useState<StayAmendmentPriceSource>('prior');
  const [customTotal, setCustomTotal] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [idempotencyKey] = useState(() => newIdempotencyKey(request.id));
  const datesValid = /^\d{4}-\d{2}-\d{2}$/.test(arrivalDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(departureDate)
    && departureDate > arrivalDate;

  const previewQuery = useQuery({
    queryKey: bookingRequestKeys.stayAmendmentPreview(
      propertyId,
      request.id,
      arrivalDate,
      departureDate,
    ),
    queryFn: () => api.get(
      `/v1/booking-requests/${request.id}/stay-amendment-preview`,
      { params: { propertyId, arrivalDate, departureDate } },
    ).then((response) => response.data?.data ?? response.data),
    enabled: datesValid,
  });
  const candidate = previewQuery.data as BookingRequestStayAmendmentPreview | undefined;
  const preview = candidate?.requestId === request.id
    && candidate.reservationId === operational.id
    && candidate.arrivalDate === arrivalDate
    && candidate.departureDate === departureDate
    && candidate.currencyCode === operational.currencyCode
    ? candidate
    : undefined;
  const customValidation = validateMoneyInput(customTotal, operational.currencyCode);
  const customReady = priceSource !== 'custom'
    || (customValidation.canonical != null && customReason.trim().length > 0);
  const customError = priceSource === 'custom'
    && customTotal !== ''
    && customValidation.error != null;

  const mutation = useMutation({
    mutationFn: () => api.post(
      `/v1/booking-requests/${request.id}/stay-amendments`,
      {
        arrivalDate,
        departureDate,
        priceSource,
        previewToken: preview?.previewToken,
        idempotencyKey,
        ...(priceSource === 'custom' ? {
          customTotal: customValidation.canonical!,
          customReason: customReason.trim(),
        } : {}),
      },
      { params: { propertyId } },
    ),
    onError: async (error) => {
      if ((error as { response?: { status?: number } })?.response?.status === 409) {
        await previewQuery.refetch();
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.root(propertyId) }),
        queryClient.invalidateQueries({ queryKey: ['reservations', propertyId] }),
        queryClient.invalidateQueries({ queryKey: ['availability', propertyId] }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.genericFoliosRoot(propertyId) }),
        queryClient.invalidateQueries({
          queryKey: bookingRequestKeys.folioWorkspace(
            propertyId,
            request.id,
            operational.id,
          ),
        }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.payments(propertyId, request.id) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.audit(propertyId, request.id) }),
      ]);
      onClose();
    },
  });

  const options: Array<{
    value: StayAmendmentPriceSource;
    label: string;
    amount: string;
    description: string;
  }> = [
    {
      value: 'prior',
      label: t('bookingRequests.modifyStay.prior'),
      amount: preview
        ? formatMoney(preview.priorTotal, operational.currencyCode)
        : t('bookingRequests.modifyStay.awaitingQuote'),
      description: t('bookingRequests.modifyStay.priorDescription'),
    },
    {
      value: 'current',
      label: t('bookingRequests.modifyStay.current'),
      amount: preview
        ? formatMoney(preview.currentTotal, operational.currencyCode)
        : t('bookingRequests.modifyStay.awaitingQuote'),
      description: t('bookingRequests.modifyStay.currentDescription'),
    },
    {
      value: 'custom',
      label: t('bookingRequests.modifyStay.custom'),
      amount: t('bookingRequests.modifyStay.enterAmount'),
      description: t('bookingRequests.modifyStay.customDescription'),
    },
  ];

  return (
    <Modal open onClose={onClose} title={t('bookingRequests.modifyStay.title')} wide>
      <div className="mb-5 grid items-center gap-3 rounded-xl border border-slate-200 bg-telivity-light-grey/50 p-4 sm:grid-cols-[1fr_auto_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-telivity-slate">
            {t('bookingRequests.modifyStay.activeStay')}
          </p>
          <p className="mt-1 font-semibold text-telivity-navy">
            {operational.arrivalDate} → {operational.departureDate}
          </p>
          <p className="mt-1 text-sm text-telivity-slate">
            {formatMoney(operational.totalAmount, operational.currencyCode)}
          </p>
        </div>
        <ArrowRight className="hidden text-telivity-deep-blue sm:block" aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-telivity-slate">
            {t('bookingRequests.modifyStay.proposedStay')}
          </p>
          <p className="mt-1 font-semibold text-telivity-navy">{arrivalDate} → {departureDate}</p>
          <p className="mt-1 text-sm text-telivity-slate">
            {preview && priceSource === 'custom' && customValidation.canonical
              ? formatMoney(customValidation.canonical, preview.currencyCode)
              : preview && priceSource !== 'custom'
                ? formatMoney(
                  priceSource === 'current' ? preview.currentTotal : preview.priorTotal,
                  preview.currencyCode,
                )
                : t('bookingRequests.modifyStay.awaitingQuote')}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-telivity-slate">
          {t('bookingRequests.modifyStay.arrivalDate')}
          <input
            type="date"
            value={arrivalDate}
            onChange={(event) => setArrivalDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
          />
        </label>
        <label className="text-sm font-medium text-telivity-slate">
          {t('bookingRequests.modifyStay.departureDate')}
          <input
            type="date"
            value={departureDate}
            min={arrivalDate}
            onChange={(event) => setDepartureDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
          />
        </label>
      </div>
      {!datesValid ? (
        <p role="alert" className="mt-3 text-sm font-medium text-telivity-orange">
          {t('bookingRequests.modifyStay.invalidDates')}
        </p>
      ) : previewQuery.isLoading || previewQuery.isFetching ? (
        <p role="status" className="mt-3 text-sm text-telivity-slate">
          {t('bookingRequests.modifyStay.checking')}
        </p>
      ) : previewQuery.isError || !preview ? (
        <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-telivity-orange/40 bg-telivity-orange/10 p-3 text-sm text-telivity-navy">
          <span>{t('bookingRequests.modifyStay.previewError')}</span>
          <button type="button" onClick={() => previewQuery.refetch()} className="font-semibold text-telivity-deep-blue underline underline-offset-2">
            {t('bookingRequests.common.retry')}
          </button>
        </div>
      ) : null}

      <fieldset className="mt-5 space-y-3">
        <legend className="mb-2 text-sm font-semibold text-telivity-navy">
          {t('bookingRequests.modifyStay.priceChoice')}
        </legend>
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
              name="stay-amendment-price-source"
              value={option.value}
              checked={priceSource === option.value}
              onChange={() => setPriceSource(option.value)}
              className="mt-1 text-telivity-deep-blue focus:ring-telivity-deep-blue"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-2 font-semibold text-telivity-navy">
                <span>{option.label}</span><span>{option.amount}</span>
              </span>
              <span className="mt-1 block text-sm text-telivity-slate">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {priceSource === 'custom' ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-telivity-slate">
            {t('bookingRequests.modifyStay.customTotal')}
            <input
              type="text"
              inputMode="decimal"
              value={customTotal}
              aria-invalid={customError}
              aria-describedby={customError ? customTotalErrorId : undefined}
              onChange={(event) => setCustomTotal(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
            />
            {customError ? (
              <span id={customTotalErrorId} className="mt-1 block text-xs font-medium text-telivity-orange">
                {t(`bookingRequests.validation.${customValidation.error}`)}
              </span>
            ) : null}
          </label>
          <label className="text-sm font-medium text-telivity-slate">
            {t('bookingRequests.modifyStay.customReason')}
            <input
              type="text"
              required
              maxLength={2000}
              value={customReason}
              onChange={(event) => setCustomReason(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
            />
          </label>
        </div>
      ) : null}

      {mutation.isError ? (
        <div role="alert" className="mt-4 rounded-lg border border-telivity-orange/40 bg-telivity-orange/10 p-3 text-sm text-telivity-navy">
          {apiErrorMessage(mutation.error, t('bookingRequests.modifyStay.commitError'))}
        </div>
      ) : null}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} disabled={mutation.isPending} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-telivity-slate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:opacity-50">
          {t('bookingRequests.common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!preview || !customReady || mutation.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-telivity-deep-blue px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarRange size={16} aria-hidden="true" />
          {mutation.isPending
            ? t('bookingRequests.modifyStay.applying')
            : t('bookingRequests.modifyStay.apply')}
        </button>
      </div>
    </Modal>
  );
}
