import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  Check,
  ClipboardList,
  CreditCard,
  Search,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Link,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import { useAuth } from '../context/AuthContext';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import AcceptRequestModal from '../components/booking-requests/AcceptRequestModal';
import DenyRequestModal from '../components/booking-requests/DenyRequestModal';
import PaymentActionModal, { type PaymentAction } from '../components/booking-requests/PaymentActionModal';
import RequestAudit from '../components/booking-requests/RequestAudit';
import RequestMessages from '../components/booking-requests/RequestMessages';
import RequestOverview from '../components/booking-requests/RequestOverview';
import RequestPayments from '../components/booking-requests/RequestPayments';
import { bookingRequestKeys } from '../components/booking-requests/queryKeys';
import {
  quoteTotal,
  unresolvedPayments,
  type BookingRequestDetail,
  type BookingRequestListItem,
  type BookingRequestPaymentsResponse,
} from '../components/booking-requests/types';

type DetailTab = 'overview' | 'payments' | 'messages' | 'audit';

function queueSortParams(sort: string) {
  if (sort === 'amount_desc') return { sortBy: 'requestedTotal', sortOrder: 'desc' };
  if (sort === 'arrival') return { sortBy: 'arrivalDate', sortOrder: 'asc' };
  if (sort === 'guest') return { sortBy: 'guestName', sortOrder: 'asc' };
  return { sortBy: 'createdAt', sortOrder: 'desc' };
}

function GuardMessage({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof ClipboardList;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[22rem] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-telivity-deep-blue/10 text-telivity-deep-blue">
          <Icon size={22} aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-telivity-navy">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-telivity-slate">{description}</p>
      </div>
    </div>
  );
}

function BookingRequestQueue({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [guest, setGuest] = useState('');
  const [card, setCard] = useState('');
  const [arrivalFrom, setArrivalFrom] = useState('');
  const [arrivalTo, setArrivalTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const filters = useMemo(() => ({ status, guest, card, arrivalFrom, arrivalTo, sort, page }), [
    arrivalFrom,
    arrivalTo,
    card,
    guest,
    page,
    sort,
    status,
  ]);
  const params = useMemo(() => ({
    propertyId,
    page,
    limit: 20,
    ...queueSortParams(sort),
    ...(status ? { status } : {}),
    ...(guest.trim() ? { guest: guest.trim() } : {}),
    ...(card ? { hasCard: card === 'true' } : {}),
    ...(arrivalFrom ? { arrivalDateFrom: arrivalFrom } : {}),
    ...(arrivalTo ? { arrivalDateTo: arrivalTo } : {}),
  }), [arrivalFrom, arrivalTo, card, guest, page, propertyId, sort, status]);

  const listQuery = useQuery({
    queryKey: bookingRequestKeys.list(propertyId, filters),
    queryFn: () => api.get('/v1/booking-requests', { params }).then((response) => response.data),
  });
  const payload = listQuery.data?.data ?? listQuery.data ?? {};
  const listed = (Array.isArray(payload) ? payload : payload.data ?? []) as BookingRequestListItem[];
  const rows = listed.filter((row) => row.propertyId === propertyId);
  const total = Array.isArray(payload) ? payload.length : Number(payload.total ?? rows.length);
  const hasMore = !Array.isArray(payload) && Boolean(payload.hasMore);

  return (
    <div>
      <header className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-telivity-deep-blue/10 text-telivity-deep-blue">
          <ClipboardList size={22} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold text-telivity-navy">{t('bookingRequests.queue.title')}</h1>
          <p className="mt-1 text-sm text-telivity-slate">{t('bookingRequests.queue.description')}</p>
        </div>
      </header>

      <section aria-label={t('bookingRequests.queue.filters')} className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_10rem_10rem_10rem_10rem_11rem_auto]">
          <label className="relative text-xs font-semibold uppercase tracking-wide text-telivity-slate">
            {t('bookingRequests.queue.guest')}
            <Search size={15} aria-hidden="true" className="absolute bottom-2.5 left-3 text-telivity-slate" />
            <input
              type="search"
              value={guest}
              onChange={(event) => { setGuest(event.target.value); setPage(1); }}
              className="mt-1 w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm font-normal normal-case tracking-normal text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-telivity-slate">
            {t('bookingRequests.common.status')}
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue">
              <option value="">{t('bookingRequests.queue.allStatuses')}</option>
              {['pending', 'accepted', 'denied'].map((value) => <option key={value} value={value}>{t(`bookingRequests.statuses.${value}`)}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-telivity-slate">
            {t('bookingRequests.queue.card')}
            <select value={card} onChange={(event) => { setCard(event.target.value); setPage(1); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue">
              <option value="">{t('bookingRequests.queue.anyCard')}</option>
              <option value="true">{t('bookingRequests.queue.cardSaved')}</option>
              <option value="false">{t('bookingRequests.queue.noCard')}</option>
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-telivity-slate">
            {t('bookingRequests.queue.arrivalFrom')}
            <input type="date" value={arrivalFrom} onChange={(event) => { setArrivalFrom(event.target.value); setPage(1); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-telivity-slate">
            {t('bookingRequests.queue.arrivalTo')}
            <input type="date" value={arrivalTo} onChange={(event) => { setArrivalTo(event.target.value); setPage(1); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue" />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-telivity-slate">
            {t('bookingRequests.queue.sort')}
            <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-telivity-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue">
              <option value="newest">{t('bookingRequests.queue.sortOptions.newest')}</option>
              <option value="arrival">{t('bookingRequests.queue.sortOptions.arrival')}</option>
              <option value="guest">{t('bookingRequests.queue.sortOptions.guest')}</option>
              <option value="amount_desc">{t('bookingRequests.queue.sortOptions.amountDesc')}</option>
            </select>
          </label>
          {(status || guest || card || arrivalFrom || arrivalTo) ? (
            <button type="button" onClick={() => { setStatus(''); setGuest(''); setCard(''); setArrivalFrom(''); setArrivalTo(''); setPage(1); }} className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-telivity-slate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"><X size={15} aria-hidden="true" />{t('bookingRequests.queue.clear')}</button>
          ) : <span />}
        </div>
      </section>

      {listQuery.isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-telivity-slate">{t('bookingRequests.queue.loading')}</div>
      ) : listQuery.isError ? (
        <div role="alert" className="rounded-xl border border-telivity-orange/30 bg-telivity-orange/10 p-6 text-sm text-telivity-navy">{t('bookingRequests.queue.loadError')}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label={t('bookingRequests.queue.title')} className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-slate-200 bg-telivity-deep-blue/5">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-telivity-slate">{t('bookingRequests.queue.guest')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-telivity-slate">{t('bookingRequests.queue.stay')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-telivity-slate">{t('bookingRequests.common.status')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-telivity-slate">{t('bookingRequests.queue.card')}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-telivity-slate">{t('bookingRequests.queue.amount')}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-telivity-slate">{t('bookingRequests.amounts.accepted')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((request) => {
                return (
                  <tr key={request.id} className="border-b border-slate-100 last:border-0 hover:bg-telivity-light-grey/40 focus-within:bg-telivity-light-grey/40">
                    <td className="px-4 py-3">
                      <Link to={`/booking-requests/${request.id}?propertyId=${encodeURIComponent(propertyId)}`} className="font-semibold text-telivity-navy underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue hover:underline">
                        {request.guestFirstName} {request.guestLastName}
                      </Link>
                      <p className="mt-0.5 text-xs text-telivity-slate">{request.guestEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-telivity-navy"><span className="inline-flex items-center gap-2"><CalendarDays size={15} className="text-telivity-deep-blue" aria-hidden="true" />{request.arrivalDate} → {request.departureDate}</span></td>
                    <td className="px-4 py-3"><StatusBadge status={request.status === 'accepted' ? 'success' : request.status === 'denied' ? 'error' : 'pending'} label={t(`bookingRequests.statuses.${request.status}`)} /></td>
                    <td className="px-4 py-3 text-sm text-telivity-slate">{request.hasCard ? <span className="inline-flex items-center gap-2"><Check size={15} className="text-telivity-dark-teal" aria-hidden="true" />{t('bookingRequests.queue.cardSaved')}</span> : t('bookingRequests.queue.noCard')}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-telivity-navy">{formatMoney(request.submittedTotal, request.currencyCode)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-telivity-navy">{formatMoney(request.acceptedTotal, request.currencyCode)}</td>
                  </tr>
                );
              })}
              {!rows.length ? <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-telivity-slate">{t('bookingRequests.queue.empty')}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-telivity-slate">
          <span>{t('bookingRequests.queue.total', { count: total })}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:opacity-40">{t('bookingRequests.queue.previous')}</button>
            <button type="button" onClick={() => setPage((value) => value + 1)} disabled={!hasMore} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:opacity-40">{t('bookingRequests.queue.next')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BookingRequestDetailPage({ propertyId, canWrite }: { propertyId: string; canWrite: boolean }) {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab: DetailTab = ['overview', 'payments', 'messages', 'audit'].includes(requestedTab ?? '')
    ? requestedTab as DetailTab
    : 'overview';
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);
  const [paymentAction, setPaymentAction] = useState<PaymentAction | null>(null);
  const detailQuery = useQuery({
    queryKey: bookingRequestKeys.detail(propertyId, id),
    queryFn: () => api.get(`/v1/booking-requests/${id}`, { params: { propertyId } })
      .then((response) => response.data?.data ?? response.data),
    enabled: Boolean(id),
  });
  const paymentsQuery = useQuery({
    queryKey: bookingRequestKeys.payments(propertyId, id),
    queryFn: () => api.get(`/v1/booking-requests/${id}/payments`, { params: { propertyId } })
      .then((response) => response.data?.data ?? response.data ?? { movements: [], allocations: [], resolutions: [] }),
    enabled: Boolean(id),
  });
  const request = detailQuery.data as BookingRequestDetail | undefined;
  const scopedRequest = request?.propertyId === propertyId && request.id === id ? request : undefined;
  const paymentData = paymentsQuery.data as BookingRequestPaymentsResponse | undefined;
  const moneyStateVerified = paymentsQuery.isSuccess && paymentData != null;
  const scopedPaymentData: BookingRequestPaymentsResponse = {
    movements: (paymentData?.movements ?? []).filter((row) => row.propertyId === propertyId && row.bookingRequestId === id),
    allocations: (paymentData?.allocations ?? []).filter((row) => row.propertyId === propertyId && row.bookingRequestId === id),
    resolutions: (paymentData?.resolutions ?? []).filter((row) => row.propertyId === propertyId && row.bookingRequestId === id),
  };
  const unresolved = unresolvedPayments(scopedPaymentData);
  const unresolvedTotal = unresolved.reduce((sum, entry) => sum + entry.amount, 0);

  const setTab = (tab: DetailTab) => {
    setSearchParams((current) => {
      current.set('propertyId', propertyId);
      if (tab === 'overview') current.delete('tab');
      else current.set('tab', tab);
      return current;
    }, { replace: true });
  };

  if (detailQuery.isLoading) return <div className="py-16 text-center text-sm text-telivity-slate">{t('bookingRequests.common.loading')}</div>;
  if (detailQuery.isError || !scopedRequest) {
    return <GuardMessage icon={ClipboardList} title={t('bookingRequests.notFound.title')} description={t('bookingRequests.notFound.description')} />;
  }

  const submittedTotal = quoteTotal(scopedRequest.submittedQuoteSnapshot);
  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview', label: t('bookingRequests.tabs.overview') },
    { id: 'payments', label: t('bookingRequests.tabs.payments') },
    { id: 'messages', label: t('bookingRequests.tabs.messages') },
    { id: 'audit', label: t('bookingRequests.tabs.audit') },
  ];

  return (
    <div>
      <Link to={`/booking-requests?propertyId=${encodeURIComponent(propertyId)}`} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue">
        <ArrowLeft size={16} aria-hidden="true" /> {t('bookingRequests.detail.back')}
      </Link>

      <header className="sticky top-0 z-20 rounded-xl border border-slate-200 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/90">
        <div className="grid gap-5 p-5 xl:grid-cols-[minmax(14rem,1fr)_auto_minmax(22rem,auto)] xl:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold text-telivity-navy">{scopedRequest.guestFirstName} {scopedRequest.guestLastName}</h1>
              <StatusBadge status={scopedRequest.status === 'accepted' ? 'success' : scopedRequest.status === 'denied' ? 'error' : 'pending'} label={t(`bookingRequests.statuses.${scopedRequest.status}`)} />
            </div>
            <p className="mt-1 text-sm text-telivity-slate">{t('bookingRequests.detail.reference', { reference: scopedRequest.id.slice(0, 8), date: scopedRequest.createdAt.slice(0, 10) })}</p>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-y border-slate-200 py-3 text-sm xl:border-x xl:border-y-0 xl:px-6 xl:py-0">
            <div><dt className="text-xs uppercase tracking-wide text-telivity-slate">{t('bookingRequests.amounts.quoted')}</dt><dd className="mt-1 font-semibold text-telivity-navy">{formatMoney(submittedTotal, scopedRequest.currencyCode)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-telivity-slate">{t('bookingRequests.amounts.accepted')}</dt><dd className="mt-1 font-semibold text-telivity-navy">{formatMoney(scopedRequest.acceptedTotal, scopedRequest.currencyCode)}</dd></div>
          </dl>

          {canWrite && scopedRequest.status !== 'denied' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-telivity-slate">{t('bookingRequests.detail.decisionActions')}</p>
                <div className="flex gap-2">
                  {scopedRequest.status === 'pending' ? (
                    <>
                      <button type="button" onClick={() => setAcceptOpen(true)} className="flex-1 rounded-lg bg-telivity-deep-blue px-3 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue focus-visible:ring-offset-2">{t('bookingRequests.actions.accept')}</button>
                      <button type="button" onClick={() => setDenyOpen(true)} disabled={!moneyStateVerified} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-telivity-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-orange disabled:cursor-not-allowed disabled:opacity-50">{t('bookingRequests.actions.deny')}</button>
                    </>
                  ) : <p className="text-sm font-medium text-telivity-slate">{t('bookingRequests.detail.decisionComplete')}</p>}
                </div>
                {!moneyStateVerified ? (
                  <div role={paymentsQuery.isError ? 'alert' : 'status'} className="mt-2 text-xs text-telivity-slate">
                    <span>{paymentsQuery.isError
                      ? t('bookingRequests.deny.moneyLoadError')
                      : t('bookingRequests.deny.moneyLoading')}</span>
                    {paymentsQuery.isError ? (
                      <button type="button" onClick={() => paymentsQuery.refetch()} className="ml-2 font-semibold text-telivity-deep-blue underline underline-offset-2">
                        {t('bookingRequests.deny.retryMoney')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-telivity-slate">{t('bookingRequests.detail.moneyActions')}</p>
                <div className="flex gap-2">
                  {scopedRequest.card ? <button type="button" aria-label={t('bookingRequests.actions.charge')} onClick={() => setPaymentAction('charge')} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"><CreditCard size={15} aria-hidden="true" className="mx-auto sm:mr-1 sm:inline" /><span className="hidden sm:inline">{t('bookingRequests.actions.charge')}</span></button> : null}
                  <button type="button" aria-label={t('bookingRequests.actions.record')} onClick={() => setPaymentAction('external')} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-telivity-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue"><Banknote size={15} aria-hidden="true" className="mx-auto sm:mr-1 sm:inline" /><span className="hidden sm:inline">{t('bookingRequests.actions.record')}</span></button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <p className="border-t border-slate-100 px-5 py-2 text-xs font-medium text-telivity-slate">{t('bookingRequests.detail.independence')}</p>
      </header>

      <div className="mt-4 overflow-x-auto border-b border-slate-200" role="tablist" aria-label={t('bookingRequests.tabs.label')}>
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`booking-request-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls="booking-request-tabpanel"
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setTab(tab.id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const currentIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
                const nextIndex = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                const next = tabs[nextIndex];
                if (!next) return;
                setTab(next.id);
                document.getElementById(`booking-request-tab-${next.id}`)?.focus();
              }}
              className={`border-b-2 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-telivity-deep-blue ${activeTab === tab.id ? 'border-telivity-deep-blue text-telivity-deep-blue' : 'border-transparent text-telivity-slate hover:text-telivity-navy'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div id="booking-request-tabpanel" aria-labelledby={`booking-request-tab-${activeTab}`} className="mt-4" role="tabpanel">
        {activeTab === 'overview' ? <RequestOverview request={scopedRequest} propertyId={propertyId} canWrite={canWrite} /> : null}
        {activeTab === 'payments' ? <RequestPayments request={scopedRequest} propertyId={propertyId} canWrite={canWrite} /> : null}
        {activeTab === 'messages' ? <RequestMessages requestId={scopedRequest.id} propertyId={propertyId} canWrite={canWrite} /> : null}
        {activeTab === 'audit' ? <RequestAudit request={scopedRequest} propertyId={propertyId} /> : null}
      </div>

      {acceptOpen ? <AcceptRequestModal request={scopedRequest} propertyId={propertyId} onClose={() => setAcceptOpen(false)} /> : null}
      {denyOpen ? <DenyRequestModal requestId={scopedRequest.id} propertyId={propertyId} currencyCode={scopedRequest.currencyCode} unresolvedAmount={unresolvedTotal} onClose={() => setDenyOpen(false)} onResolveMoney={() => { setDenyOpen(false); setTab('payments'); }} /> : null}
      {paymentAction ? <PaymentActionModal action={paymentAction} requestId={scopedRequest.id} propertyId={propertyId} currencyCode={scopedRequest.currencyCode} reservationId={scopedRequest.acceptedReservationId} onClose={() => setPaymentAction(null)} /> : null}
    </div>
  );
}

export default function BookingRequests() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { propertyId, isPortfolioMode } = useProperty();
  const canRead = hasPermission('reservations.read');
  const canWrite = hasPermission('reservations.write');

  if (!canRead) {
    return <GuardMessage icon={X} title={t('bookingRequests.access.title')} description={t('bookingRequests.access.description')} />;
  }
  if (!propertyId || isPortfolioMode) {
    return <GuardMessage icon={ClipboardList} title={t('bookingRequests.property.title')} description={t('bookingRequests.property.description')} />;
  }

  return (
    <Routes>
      <Route index element={<BookingRequestQueue propertyId={propertyId} />} />
      <Route path=":id" element={<BookingRequestDetailPage propertyId={propertyId} canWrite={canWrite} />} />
    </Routes>
  );
}
