import { useState } from 'react';
import {
  ArrowDownToLine,
  Banknote,
  CalendarClock,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import StatusBadge from '../ui/StatusBadge';
import PaymentActionModal, { type PaymentAction } from './PaymentActionModal';
import { bookingRequestKeys } from './queryKeys';
import { validateMoneyInput, validatePercentageInput } from './moneyInput';
import {
  apiErrorMessage,
  quoteTotal,
  type BookingRequestDetail,
  type BookingRequestInstallment,
  type BookingRequestPayment,
  type BookingRequestPaymentsResponse,
  type FolioSummary,
} from './types';

interface RequestPaymentsProps {
  request: BookingRequestDetail;
  propertyId: string;
  canWrite: boolean;
}

function InstallmentEditor({
  requestId,
  propertyId,
  currencyCode,
  installment,
  nextSortOrder,
  onClose,
}: {
  requestId: string;
  propertyId: string;
  currencyCode: string;
  installment?: BookingRequestInstallment;
  nextSortOrder: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(installment?.label ?? '');
  const [amountKind, setAmountKind] = useState<'fixed' | 'percentage'>(
    installment?.percentage ? 'percentage' : 'fixed',
  );
  const [amount, setAmount] = useState(installment?.percentage ?? installment?.fixedAmount ?? '');
  const [milestone, setMilestone] = useState<BookingRequestInstallment['dueMilestone']>(
    installment?.dueMilestone ?? 'manual',
  );
  const [dueDate, setDueDate] = useState(installment?.dueDate ?? '');
  const amountValidation = amountKind === 'fixed'
    ? validateMoneyInput(amount, currencyCode)
    : validatePercentageInput(amount);
  const valid = label.trim().length > 0
    && amountValidation.canonical != null
    && (milestone !== 'date' || Boolean(dueDate));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        label: label.trim(),
        sortOrder: installment?.sortOrder ?? nextSortOrder,
        ...(amountKind === 'fixed'
          ? { fixedAmount: amountValidation.canonical! }
          : { percentage: amountValidation.canonical! }),
        dueMilestone: milestone,
        ...(milestone === 'date' ? { dueDate } : {}),
      };
      const config = { params: { propertyId } };
      return installment
        ? api.patch(
          `/v1/booking-requests/${requestId}/installments/${installment.id}`,
          payload,
          config,
        )
        : api.post(`/v1/booking-requests/${requestId}/installments`, payload, config);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: bookingRequestKeys.installments(propertyId, requestId) });
      onClose();
    },
  });

  return (
    <div className="rounded-xl border border-telivity-deep-blue/30 bg-telivity-deep-blue/5 p-4">
      <h3 className="font-semibold text-telivity-navy">
        {installment ? t('bookingRequests.payments.editInstallment') : t('bookingRequests.payments.addInstallment')}
      </h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-medium text-telivity-slate sm:col-span-2">
          {t('bookingRequests.payments.installmentLabel')}
          <input value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
        </label>
        <label className="text-sm font-medium text-telivity-slate">
          {t('bookingRequests.payments.amountType')}
          <select value={amountKind} onChange={(event) => setAmountKind(event.target.value as 'fixed' | 'percentage')} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue">
            <option value="fixed">{t('bookingRequests.payments.fixedAmount')}</option>
            <option value="percentage">{t('bookingRequests.payments.percentage')}</option>
          </select>
        </label>
        <label className="text-sm font-medium text-telivity-slate">
          {t('bookingRequests.paymentActions.amount')}
          <input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
          {amount !== '' && amountValidation.error ? <span className="mt-1 block text-xs font-medium text-telivity-orange">{t(`bookingRequests.validation.${amountValidation.error}`)}</span> : null}
        </label>
        <label className="text-sm font-medium text-telivity-slate">
          {t('bookingRequests.payments.milestone')}
          <select value={milestone} onChange={(event) => setMilestone(event.target.value as BookingRequestInstallment['dueMilestone'])} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue">
            {(['manual', 'arrival', 'checkout', 'date'] as const).map((value) => (
              <option key={value} value={value}>{t(`bookingRequests.milestones.${value}`)}</option>
            ))}
          </select>
        </label>
        {milestone === 'date' ? (
          <label className="text-sm font-medium text-telivity-slate">
            {t('bookingRequests.payments.dueDate')}
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
          </label>
        ) : null}
      </div>
      {save.isError ? <p role="alert" className="mt-3 text-sm text-telivity-orange">{apiErrorMessage(save.error, t('bookingRequests.payments.installmentError'))}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={save.isPending} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-telivity-slate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:opacity-50">{t('bookingRequests.common.cancel')}</button>
        <button type="button" onClick={() => save.mutate()} disabled={!valid || save.isPending} className="rounded-lg bg-telivity-deep-blue px-3 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue focus-visible:ring-offset-2 disabled:opacity-50">{t('bookingRequests.payments.saveInstallment')}</button>
      </div>
    </div>
  );
}

function AllocationEditor({
  requestId,
  propertyId,
  installment,
  payments,
  onClose,
}: {
  requestId: string;
  propertyId: string;
  installment: BookingRequestInstallment;
  payments: BookingRequestPayment[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const selectedPayment = payments.find((payment) => payment.id === paymentId);
  const amountValidation = validateMoneyInput(
    amount,
    selectedPayment?.currencyCode ?? 'XXX',
  );
  const maximumAmount = Math.min(
    Number(selectedPayment?.availableToAllocate ?? 0),
    Math.max(0, Number(installment.resolvedAmount) - Number(installment.allocatedAmount)),
  );
  const mutation = useMutation({
    mutationFn: () => api.post(
      `/v1/booking-requests/${requestId}/installments/${installment.id}/allocations`,
      { paymentId, amount: amountValidation.canonical! },
      { params: { propertyId } },
    ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.installments(propertyId, requestId) }),
        queryClient.invalidateQueries({ queryKey: bookingRequestKeys.payments(propertyId, requestId) }),
      ]);
      onClose();
    },
  });

  return (
    <div className="mt-3 rounded-lg bg-telivity-light-grey/70 p-3">
      <p className="text-sm font-semibold text-telivity-navy">{t('bookingRequests.payments.allocateTo', { label: installment.label })}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
        <label className="text-xs font-medium text-telivity-slate">
          {t('bookingRequests.payments.movement')}
          <select value={paymentId} onChange={(event) => setPaymentId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            {payments.map((payment) => (
              <option key={payment.id} value={payment.id}>
                {t('bookingRequests.payments.availableForAllocation', {
                  available: formatMoney(payment.availableToAllocate, payment.currencyCode),
                  allocated: formatMoney(payment.allocatedAmount, payment.currencyCode),
                  method: t(`bookingRequests.methods.${payment.method}`, { defaultValue: payment.method }),
                })}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-telivity-slate">
          {t('bookingRequests.paymentActions.amount')}
          <input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          {amount !== '' && amountValidation.error ? <span className="mt-1 block text-xs font-medium text-telivity-orange">{t(`bookingRequests.validation.${amountValidation.error}`)}</span> : null}
        </label>
        <div className="flex items-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-telivity-slate">{t('bookingRequests.common.cancel')}</button>
          <button type="button" onClick={() => mutation.mutate()} disabled={!paymentId || amountValidation.canonical == null || Number(amountValidation.canonical) > maximumAmount || mutation.isPending} className="rounded-lg bg-telivity-deep-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('bookingRequests.payments.allocate')}</button>
        </div>
      </div>
      {mutation.isError ? <p role="alert" className="mt-2 text-sm text-telivity-orange">{apiErrorMessage(mutation.error, t('bookingRequests.payments.allocationError'))}</p> : null}
    </div>
  );
}

export default function RequestPayments({ request, propertyId, canWrite }: RequestPaymentsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<BookingRequestInstallment | 'new' | null>(null);
  const [allocating, setAllocating] = useState<BookingRequestInstallment | null>(null);
  const [paymentAction, setPaymentAction] = useState<{
    action: PaymentAction;
    payment?: BookingRequestPayment;
    amount?: string;
  } | null>(null);

  const installmentsQuery = useQuery({
    queryKey: bookingRequestKeys.installments(propertyId, request.id),
    queryFn: () => api.get(`/v1/booking-requests/${request.id}/installments`, { params: { propertyId } })
      .then((response) => response.data?.data ?? response.data ?? []),
  });
  const paymentsQuery = useQuery({
    queryKey: bookingRequestKeys.payments(propertyId, request.id),
    queryFn: () => api.get(`/v1/booking-requests/${request.id}/payments`, { params: { propertyId } })
      .then((response) => response.data?.data ?? response.data ?? { movements: [], allocations: [], resolutions: [] }),
  });
  const folioQuery = useQuery({
    queryKey: request.acceptedFolioId
      ? bookingRequestKeys.folio(
        propertyId,
        request.id,
        request.acceptedReservationId,
        request.acceptedFolioId,
      )
      : bookingRequestKeys.folioWorkspace(propertyId, request.id, null),
    queryFn: () => api.get(`/v1/folios/${request.acceptedFolioId}`, { params: { propertyId } })
      .then((response) => response.data?.data ?? response.data),
    enabled: Boolean(request.acceptedFolioId),
  });

  const installments = (Array.isArray(installmentsQuery.data)
    ? installmentsQuery.data as BookingRequestInstallment[]
    : []).filter((item) => item.propertyId === propertyId && item.bookingRequestId === request.id)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const rawPayments = paymentsQuery.data as BookingRequestPaymentsResponse | undefined;
  const payments: BookingRequestPaymentsResponse = {
    movements: (rawPayments?.movements ?? []).filter((item) => item.propertyId === propertyId && item.bookingRequestId === request.id),
    allocations: (rawPayments?.allocations ?? []).filter((item) => item.propertyId === propertyId && item.bookingRequestId === request.id),
    resolutions: (rawPayments?.resolutions ?? []).filter((item) => item.propertyId === propertyId && item.bookingRequestId === request.id),
  };
  const folio = folioQuery.data as FolioSummary | undefined;
  const originalCaptured = payments.movements.filter((movement) =>
    !movement.originalPaymentId
    && ['captured', 'settled', 'partially_refunded', 'refunded'].includes(movement.status)
    && Number(movement.amount) > 0);
  const allocatablePayments = originalCaptured.filter((movement) =>
    Number(movement.availableToAllocate) > 0);
  const captured = originalCaptured.reduce((sum, movement) => sum + Number(movement.netCapturedAmount), 0);
  const returned = originalCaptured.reduce((sum, movement) => sum + Number(movement.returnedAmount), 0);
  const retained = originalCaptured.reduce((sum, movement) => sum + Number(movement.retainedAmount), 0);
  const availableResolutionByPayment = new Map(originalCaptured.map((payment) => [
    payment.id,
    Number(payment.availableToResolve),
  ]));
  const requestedTotal = quoteTotal(request.submittedQuoteSnapshot);

  const remove = useMutation({
    mutationFn: (installmentId: string) => api.delete(
      `/v1/booking-requests/${request.id}/installments/${installmentId}`,
      { params: { propertyId } },
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookingRequestKeys.installments(propertyId, request.id) }),
  });
  const reorder = useMutation({
    mutationFn: async ({ from, to }: { from: number; to: number }) => {
      const next = [...installments];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      await api.patch(
        `/v1/booking-requests/${request.id}/installments/reorder`,
        { installmentIds: next.map((installment) => installment.id) },
        { params: { propertyId } },
      );
    },
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: bookingRequestKeys.installments(propertyId, request.id),
    }),
  });

  const milestoneLabel = (installment: BookingRequestInstallment) => installment.dueMilestone === 'date'
    ? t('bookingRequests.milestones.dateValue', { date: installment.dueDate })
    : t(`bookingRequests.milestones.${installment.dueMilestone}`);
  const provenance = (payment: BookingRequestPayment) => payment.source === 'saved_card'
    ? t('bookingRequests.payments.savedCardProvenance', {
      brand: payment.cardBrand || t('bookingRequests.overview.cardGeneric'),
      lastFour: payment.cardLastFour || '••••',
    })
    : t('bookingRequests.payments.externalProvenance', {
      method: t(`bookingRequests.methods.${payment.method}`, { defaultValue: payment.method }),
      reference: payment.reference || '—',
    });

  if (installmentsQuery.isError || paymentsQuery.isError) {
    return <p role="alert" className="rounded-lg bg-telivity-orange/10 p-4 text-sm text-telivity-navy">{t('bookingRequests.payments.loadError')}</p>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <h2 className="font-semibold text-telivity-navy">{t('bookingRequests.payments.requestSummary')}</h2>
            <p className="mt-1 text-sm text-telivity-slate">{t('bookingRequests.payments.independence')}</p>
          </div>
          {canWrite && request.status !== 'denied' ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              {request.card ? (
                <button type="button" onClick={() => setPaymentAction({ action: 'charge' })} className="inline-flex items-center justify-center gap-2 rounded-lg bg-telivity-deep-blue px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue focus-visible:ring-offset-2">
                  <CreditCard size={16} aria-hidden="true" /> {t('bookingRequests.paymentActions.charge.action')}
                </button>
              ) : null}
              <button type="button" onClick={() => setPaymentAction({ action: 'external' })} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue">
                <Banknote size={16} aria-hidden="true" /> {t('bookingRequests.paymentActions.external.action')}
              </button>
            </div>
          ) : null}
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [t('bookingRequests.amounts.submitted'), formatMoney(requestedTotal, request.currencyCode)],
            [t('bookingRequests.amounts.captured'), formatMoney(captured, request.currencyCode)],
            [t('bookingRequests.amounts.returned'), formatMoney(returned, request.currencyCode)],
            [t('bookingRequests.amounts.retained'), formatMoney(retained, request.currencyCode)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-telivity-light-grey/60 p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-telivity-slate">{label}</dt>
              <dd className="mt-1 text-lg font-semibold text-telivity-navy">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {request.status === 'accepted' && request.acceptedFolioId ? (
        <section className="rounded-xl border border-telivity-dark-teal/30 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ArrowDownToLine size={18} className="text-telivity-dark-teal" aria-hidden="true" />
            <h2 className="font-semibold text-telivity-navy">{t('bookingRequests.payments.folioSummary')}</h2>
          </div>
          {folioQuery.isLoading ? <p className="mt-3 text-sm text-telivity-slate">{t('bookingRequests.common.loading')}</p> : folio ? (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div><dt className="text-xs uppercase tracking-wide text-telivity-slate">{t('bookingRequests.payments.acceptedDeal')}</dt><dd className="mt-1 font-semibold text-telivity-navy">{formatMoney(request.acceptedTotal, request.currencyCode)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-telivity-slate">{t('bookingRequests.payments.activeStayTotal')}</dt><dd className="mt-1 font-semibold text-telivity-navy">{formatMoney(request.operationalReservation?.totalAmount, request.operationalReservation?.currencyCode ?? request.currencyCode)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-telivity-slate">{t('bookingRequests.payments.folioCharges')}</dt><dd className="mt-1 font-semibold text-telivity-navy">{formatMoney(folio.totalCharges, folio.currencyCode)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-telivity-slate">{t('bookingRequests.payments.folioPayments')}</dt><dd className="mt-1 font-semibold text-telivity-navy">{formatMoney(folio.totalPayments, folio.currencyCode)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-telivity-slate">{t('bookingRequests.payments.balanceDue')}</dt><dd className="mt-1 text-lg font-semibold text-telivity-navy">{formatMoney(folio.balance, folio.currencyCode)}</dd></div>
            </dl>
          ) : <p role="alert" className="mt-3 text-sm text-telivity-orange">{t('bookingRequests.payments.folioError')}</p>}
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-telivity-navy"><CalendarClock size={18} className="text-telivity-deep-blue" aria-hidden="true" />{t('bookingRequests.payments.plan')}</h2>
            <p className="mt-1 text-sm text-telivity-slate">
              <strong className="font-medium">{t('bookingRequests.payments.noAutomaticTitle')}</strong>{' '}
              {t('bookingRequests.payments.noAutomaticDescription')}
            </p>
          </div>
          {canWrite && request.status !== 'denied' ? (
            <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"><Plus size={16} aria-hidden="true" />{t('bookingRequests.payments.addInstallment')}</button>
          ) : null}
        </div>

        {editing ? (
          <div className="mt-4">
            <InstallmentEditor requestId={request.id} propertyId={propertyId} currencyCode={request.currencyCode} installment={editing === 'new' ? undefined : editing} nextSortOrder={installments.length} onClose={() => setEditing(null)} />
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {installments.map((installment, index) => (
            <article key={installment.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-telivity-navy">{installment.label}</h3>
                    <StatusBadge status={installment.status} label={t(`bookingRequests.installmentStatuses.${installment.status}`)} />
                  </div>
                  <p className="mt-1 text-sm text-telivity-slate">{milestoneLabel(installment)}</p>
                  <p className="mt-1 text-sm text-telivity-slate">
                    {t('bookingRequests.payments.allocated', {
                      allocated: formatMoney(installment.allocatedAmount, request.currencyCode),
                      total: formatMoney(installment.resolvedAmount, request.currencyCode),
                    })}
                  </p>
                </div>
                {canWrite && request.status !== 'denied' ? (
                  <div className="flex flex-wrap gap-2">
                    {allocatablePayments.length && Number(installment.allocatedAmount) < Number(installment.resolvedAmount) ? <button type="button" aria-label={t('bookingRequests.payments.allocateLabel', { label: installment.label })} onClick={() => setAllocating(installment)} className="rounded-lg border border-slate-300 p-2 text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"><ArrowDownToLine size={16} aria-hidden="true" /></button> : null}
                    <button type="button" aria-label={t('bookingRequests.payments.moveUp', { label: installment.label })} onClick={() => reorder.mutate({ from: index, to: index - 1 })} disabled={index === 0 || reorder.isPending} className="rounded-lg border border-slate-300 p-2 text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:opacity-40"><ChevronUp size={16} aria-hidden="true" /></button>
                    <button type="button" aria-label={t('bookingRequests.payments.moveDown', { label: installment.label })} onClick={() => reorder.mutate({ from: index, to: index + 1 })} disabled={index === installments.length - 1 || reorder.isPending} className="rounded-lg border border-slate-300 p-2 text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:opacity-40"><ChevronDown size={16} aria-hidden="true" /></button>
                    <button type="button" aria-label={t('bookingRequests.payments.editLabel', { label: installment.label })} onClick={() => setEditing(installment)} disabled={Number(installment.allocatedAmount) > 0} className="rounded-lg border border-slate-300 p-2 text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:opacity-40"><Pencil size={16} aria-hidden="true" /></button>
                    <button type="button" aria-label={t('bookingRequests.payments.deleteLabel', { label: installment.label })} onClick={() => remove.mutate(installment.id)} disabled={Number(installment.allocatedAmount) > 0 || remove.isPending} className="rounded-lg border border-slate-300 p-2 text-telivity-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-orange disabled:opacity-40"><Trash2 size={16} aria-hidden="true" /></button>
                  </div>
                ) : null}
              </div>
              {allocating?.id === installment.id ? <AllocationEditor requestId={request.id} propertyId={propertyId} installment={installment} payments={allocatablePayments} onClose={() => setAllocating(null)} /> : null}
            </article>
          ))}
          {!installments.length && !installmentsQuery.isLoading ? <p className="py-6 text-center text-sm text-telivity-slate">{t('bookingRequests.payments.noInstallments')}</p> : null}
          {reorder.isError ? <p role="alert" className="text-sm text-telivity-orange">{t('bookingRequests.payments.reorderError')}</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-telivity-navy">{t('bookingRequests.payments.movements')}</h2>
        <div className="mt-4 space-y-3">
          {payments.movements.map((payment) => {
            const remaining = availableResolutionByPayment.get(payment.id) ?? 0;
            return (
              <article key={payment.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-telivity-navy">{formatMoney(payment.amount, payment.currencyCode)}</p>
                      <StatusBadge status={payment.status} label={t(`bookingRequests.paymentStatuses.${payment.status}`, { defaultValue: payment.status })} />
                    </div>
                    <p className="mt-1 text-sm text-telivity-slate">{provenance(payment)}</p>
                    {!payment.originalPaymentId ? (
                      <p className="mt-1 text-xs text-telivity-slate">
                        {t('bookingRequests.payments.allocationAvailability', {
                          available: formatMoney(payment.availableToAllocate, payment.currencyCode),
                          allocated: formatMoney(payment.allocatedAmount, payment.currencyCode),
                        })}
                      </p>
                    ) : null}
                    {payment.notes ? <p className="mt-1 text-xs text-telivity-slate">{payment.notes}</p> : null}
                  </div>
                  {canWrite && !payment.originalPaymentId && remaining > 0 && request.status !== 'denied' ? (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setPaymentAction({ action: payment.source === 'saved_card' ? 'refund' : 'external_return', payment, amount: String(remaining) })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue">
                        {payment.source === 'saved_card' ? t('bookingRequests.paymentActions.refund.action') : t('bookingRequests.paymentActions.external_return.action')}
                      </button>
                      {request.status === 'pending' ? <button type="button" onClick={() => setPaymentAction({ action: 'retain', payment, amount: String(remaining) })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-telivity-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-orange">{t('bookingRequests.paymentActions.retain.open')}</button> : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!payments.movements.length && !paymentsQuery.isLoading ? <p className="py-6 text-center text-sm text-telivity-slate">{t('bookingRequests.payments.noMovements')}</p> : null}
        </div>
      </section>

      {paymentAction ? (
        <PaymentActionModal
          action={paymentAction.action}
          requestId={request.id}
          propertyId={propertyId}
          currencyCode={request.currencyCode}
          reservationId={request.acceptedReservationId}
          payment={paymentAction.payment}
          initialAmount={paymentAction.amount}
          onClose={() => setPaymentAction(null)}
        />
      ) : null}
    </div>
  );
}
