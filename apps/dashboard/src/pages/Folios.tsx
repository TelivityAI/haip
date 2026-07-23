import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, ChevronLeft, Plus, Lock, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../components/ui/Toast';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';

interface Folio {
  id: string;
  folioNumber: string;
  type: string;
  status: string;
  guestName?: string;
  guestId?: string;
  reservationId?: string;
  balance: number;
  totalCharges?: number;
  totalPayments?: number;
}

interface Charge {
  id: string;
  description: string;
  type: string;
  amount: number;
  serviceDate: string;
  isLocked?: boolean;
  isReversal?: boolean;
  originalChargeId?: string;
  createdAt: string;
}

interface Payment {
  id: string;
  amount: number;
  method: string;
  status: string;
  gatewayReference?: string;
  originalPaymentId?: string;
  createdAt: string;
}

function errMsg(e: unknown): string {
  const anyE = e as { response?: { data?: { message?: string } }; message?: string };
  const m = anyE?.response?.data?.message ?? anyE?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

const REFUNDABLE_STATUSES = new Set(['captured', 'settled', 'partially_refunded']);

// ---- Folio List ----
function FolioList() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState('');

  const resId = searchParams.get('reservationId');

  const { data } = useQuery({
    queryKey: ['folios', propertyId, statusFilter, resId],
    queryFn: () => api.get('/v1/folios', {
      params: { propertyId, status: statusFilter || undefined, reservationId: resId || undefined },
    }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const folios: Folio[] = data?.data ?? data ?? [];

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Receipt size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('folios.title')}</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('folios.allStatus')}</option>
          <option value="open">{t('folios.open')}</option>
          <option value="settled">{t('folios.settled')}</option>
          <option value="closed">{t('folios.closed')}</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('folios.folioNumber')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('folios.guest')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('folios.type')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('folios.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {folios.map((f, i) => (
              <tr key={f.id} onClick={() => navigate(`/folios/${f.id}`)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{f.folioNumber}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{f.guestName ?? '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={f.type === 'guest' ? 'info' : 'warning'} label={t(`folios.${f.type}`, { defaultValue: f.type })} /></td>
                <td className="px-4 py-3"><StatusBadge status={f.status === 'open' ? 'pending' : f.status === 'settled' ? 'success' : 'completed'} label={t(`folios.${f.status}`, { defaultValue: f.status })} /></td>
                <td className="px-4 py-3 text-sm font-medium text-right">${Number(f.balance ?? 0).toFixed(2)}</td>
              </tr>
            ))}
            {folios.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('folios.noFoliosFound')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Folio Detail ----
function FolioDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [chargeOpen, setChargeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [arTransferOpen, setArTransferOpen] = useState(false);
  const [arLedgerId, setArLedgerId] = useState('');
  const [chargeType, setChargeType] = useState('room');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDesc, setChargeDesc] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payAmount, setPayAmount] = useState('');

  const { data: folioData } = useQuery({
    queryKey: ['folios', id],
    queryFn: () => api.get(`/v1/folios/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: chargesData } = useQuery({
    queryKey: ['folios', id, 'charges'],
    queryFn: () => api.get(`/v1/folios/${id}/charges`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: paymentsData } = useQuery({
    queryKey: ['payments', 'folio', id],
    queryFn: () => api.get('/v1/payments', { params: { folioId: id } }).then((r) => r.data),
    enabled: !!id,
  });

  const { data: arLedgersData } = useQuery({
    queryKey: ['ar-ledgers', propertyId, 'open'],
    queryFn: () =>
      api.get('/v1/ar/ledgers', { params: { propertyId, status: 'open' } }).then((r) => r.data),
    enabled: !!propertyId && arTransferOpen,
  });
  const arLedgers: { id: string; name: string; balance?: string }[] =
    arLedgersData?.data ?? arLedgersData ?? [];

  const folio: Folio | null = folioData?.data ?? folioData ?? null;
  const charges: Charge[] = chargesData?.data ?? chargesData ?? [];
  const payments: Payment[] = paymentsData?.data ?? paymentsData ?? [];
  const currencyCode = (folio as { currencyCode?: string } | null)?.currencyCode ?? 'USD';

  const reversedIds = new Set(
    charges.filter((c) => c.isReversal && c.originalChargeId).map((c) => c.originalChargeId!),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['folios'] });
    queryClient.invalidateQueries({ queryKey: ['payments'] });
  };

  const postChargeMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/folios/${id}/charges`, {
        propertyId,
        type: chargeType,
        amount: moneyString(chargeAmount),
        currencyCode,
        description: chargeDesc,
        serviceDate: new Date().toISOString().split('T')[0],
      });
    },
    onSuccess: () => { invalidate(); setChargeOpen(false); setChargeAmount(''); setChargeDesc(''); },
  });

  const reverseMutation = useMutation({
    mutationFn: (chargeId: string) => api.post(`/v1/folios/${id}/charges/${chargeId}/reverse`),
    onSuccess: invalidate,
    onError: (e) => toast('error', `${t('folios.reverseFailed')}: ${errMsg(e)}`),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/payments', {
        folioId: id,
        propertyId,
        method: payMethod,
        amount: moneyString(payAmount),
        currencyCode,
      });
    },
    onSuccess: () => { invalidate(); setPaymentOpen(false); setPayAmount(''); },
  });

  const refundMutation = useMutation({
    mutationFn: (paymentId: string) => api.post(`/v1/payments/${paymentId}/refund`, {}),
    onSuccess: () => {
      invalidate();
      toast('success', t('folios.refundSuccess'));
    },
    onError: (e) => toast('error', `${t('folios.refundFailed')}: ${errMsg(e)}`),
  });

  const settleMutation = useMutation({ mutationFn: () => api.patch(`/v1/folios/${id}/settle`), onSuccess: invalidate });
  const closeMutation = useMutation({ mutationFn: () => api.patch(`/v1/folios/${id}/close`), onSuccess: invalidate });

  const transferToArMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/ar/transfer', {
        propertyId,
        folioId: id,
        arLedgerId,
      });
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['ar-ledgers'] });
      setArTransferOpen(false);
      setArLedgerId('');
      toast('success', t('folios.transferredToAr'));
    },
    onError: (e) => toast('error', `${t('folios.transferToArFailed')}: ${errMsg(e)}`),
  });

  if (!folio) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.loading')}</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/folios')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <Receipt size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{folio.folioNumber}</h1>
        <StatusBadge status={folio.status === 'open' ? 'pending' : 'success'} label={t(`folios.${folio.status}`, { defaultValue: folio.status })} />
        <div className="ml-auto text-right">
          <p className="text-xs text-telivity-mid-grey">{t('folios.balance')}</p>
          <p className="text-2xl font-semibold text-telivity-navy">${Number(folio.balance ?? 0).toFixed(2)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Charges */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-telivity-navy">{t('folios.charges')}</h2>
            {folio.status === 'open' && (
              <button onClick={() => setChargeOpen(true)} className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold">
                <Plus size={14} /> {t('folios.postCharge')}
              </button>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">{t('common.date')}</th>
                <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">{t('folios.description')}</th>
                <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">{t('folios.type')}</th>
                <th className="pb-2 text-right text-xs font-medium text-telivity-mid-grey">{t('folios.amount')}</th>
                <th className="pb-2 text-right text-xs font-medium text-telivity-mid-grey"></th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id} className={`border-b border-gray-50 ${reversedIds.has(c.id) ? 'opacity-50 line-through' : ''}`}>
                  <td className="py-2 text-sm text-telivity-slate">{c.serviceDate}</td>
                  <td className="py-2 text-sm text-telivity-navy">{c.description} {c.isLocked && <Lock size={12} className="inline text-telivity-mid-grey" />}</td>
                  <td className="py-2 text-sm text-telivity-slate">{t(`folios.chargeTypes.${c.type}`, { defaultValue: c.type })}</td>
                  <td className="py-2 text-sm text-right font-medium">${Number(c.amount).toFixed(2)}</td>
                  <td className="py-2 text-right">
                    {!c.isReversal && !reversedIds.has(c.id) && !c.isLocked && folio.status === 'open' && (
                      <button onClick={() => { if (confirm('Reverse this charge?')) reverseMutation.mutate(c.id); }} className="text-telivity-orange text-xs hover:underline">
                        <RotateCcw size={12} className="inline" /> {t('folios.reverse')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {charges.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-sm text-telivity-mid-grey">{t('folios.noCharges')}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Payments + Actions */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-telivity-navy">{t('folios.payments')}</h2>
              {folio.status === 'open' && (
                <button onClick={() => setPaymentOpen(true)} className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold">
                  <Plus size={14} /> {t('folios.record')}
                </button>
              )}
            </div>
            {payments.map((p) => {
              const canRefund =
                folio.status === 'open' &&
                Number(p.amount) > 0 &&
                !p.originalPaymentId &&
                REFUNDABLE_STATUSES.has(p.status);

              return (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0 gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-telivity-navy">${Number(p.amount).toFixed(2)}</p>
                    <p className="text-xs text-telivity-mid-grey">{t(`folios.paymentMethods.${p.method}`, { defaultValue: p.method })} &middot; {p.createdAt?.split('T')[0]}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canRefund && (
                      <button
                        onClick={() => {
                          if (confirm(t('folios.confirmRefund'))) refundMutation.mutate(p.id);
                        }}
                        disabled={refundMutation.isPending}
                        className="text-telivity-orange text-xs hover:underline disabled:opacity-50"
                      >
                        {t('folios.refund')}
                      </button>
                    )}
                    <StatusBadge status={p.status === 'captured' ? 'success' : p.status} label={t(`folios.paymentStatuses.${p.status}`, { defaultValue: p.status })} />
                  </div>
                </div>
              );
            })}
            {payments.length === 0 && <p className="text-sm text-telivity-mid-grey">{t('folios.noPayments')}</p>}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 space-y-2">
            <h2 className="text-sm font-semibold text-telivity-navy mb-3">{t('common.actions')}</h2>
            {folio.status === 'open' && Number(folio.balance ?? 0) !== 0 && (
              <button
                onClick={() => setArTransferOpen(true)}
                className="w-full border border-gray-200 text-telivity-navy rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey"
              >
                {t('folios.transferToAr')}
              </button>
            )}
            {folio.status === 'open' && (
              <button onClick={() => settleMutation.mutate()} disabled={settleMutation.isPending} className="w-full bg-telivity-dark-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {t('folios.settleFolio')}
              </button>
            )}
            {folio.status === 'settled' && (
              <button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending} className="w-full bg-telivity-deep-blue text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {t('folios.closeFolio')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Post Charge Modal */}
      <Modal open={chargeOpen} onClose={() => setChargeOpen(false)} title={t('folios.postCharge')}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.type')}</label>
            <select value={chargeType} onChange={(e) => setChargeType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              <option value="room">{t('folios.chargeTypes.room')}</option><option value="food_beverage">{t('folios.chargeTypes.food_beverage')}</option><option value="minibar">{t('folios.chargeTypes.minibar')}</option><option value="laundry">{t('folios.chargeTypes.laundry')}</option><option value="parking">{t('folios.chargeTypes.parking')}</option><option value="other">{t('folios.chargeTypes.other')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.amount')}</label>
            <input type="number" step="0.01" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.description')}</label>
            <input type="text" value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button onClick={() => postChargeMutation.mutate()} disabled={!chargeAmount || postChargeMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('folios.postCharge')}</button>
        </div>
      </Modal>

      {/* Record Payment Modal */}
      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={t('folios.recordPayment')}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.method')}</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              <option value="cash">{t('folios.paymentMethods.cash')}</option><option value="credit_card">{t('folios.paymentMethods.credit_card')}</option><option value="debit_card">{t('folios.paymentMethods.debit_card')}</option><option value="bank_transfer">{t('folios.paymentMethods.bank_transfer')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.amount')}</label>
            <input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button onClick={() => recordPaymentMutation.mutate()} disabled={!payAmount || recordPaymentMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('folios.recordPayment')}</button>
        </div>
      </Modal>

      <Modal open={arTransferOpen} onClose={() => setArTransferOpen(false)} title={t('folios.transferToAr')}>
        <div className="space-y-4">
          <p className="text-sm text-telivity-mid-grey">
            {t('folios.transferToArHint', { balance: Number(folio.balance ?? 0).toFixed(2) })}
          </p>
          <select
            value={arLedgerId}
            onChange={(e) => setArLedgerId(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">{t('folios.selectArLedger')}</option>
            {arLedgers.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          {arLedgers.length === 0 && (
            <p className="text-xs text-telivity-mid-grey">{t('folios.noOpenArLedgers')}</p>
          )}
          <button
            onClick={() => transferToArMutation.mutate()}
            disabled={!arLedgerId || transferToArMutation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('folios.transferBalance')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default function Folios() {
  return (
    <Routes>
      <Route index element={<FolioList />} />
      <Route path=":id" element={<FolioDetail />} />
    </Routes>
  );
}
