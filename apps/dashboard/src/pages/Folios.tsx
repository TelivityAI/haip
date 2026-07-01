import { useState } from 'react';
import { Routes, Route, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, ChevronLeft, Plus, Lock, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
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
  isReversed?: boolean;
  createdAt: string;
}

interface Payment {
  id: string;
  amount: number;
  method: string;
  status: string;
  gatewayReference?: string;
  createdAt: string;
}

// ---- Folio List ----
function FolioList() {
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
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Receipt size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Folios & Billing</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="settled">Settled</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Folio #</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Guest</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Balance</th>
            </tr>
          </thead>
          <tbody>
            {folios.map((f, i) => (
              <tr key={f.id} onClick={() => navigate(`/folios/${f.id}`)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{f.folioNumber}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{f.guestName ?? '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={f.type === 'guest' ? 'info' : 'warning'} label={f.type} /></td>
                <td className="px-4 py-3"><StatusBadge status={f.status === 'open' ? 'pending' : f.status === 'settled' ? 'success' : 'completed'} label={f.status} /></td>
                <td className="px-4 py-3 text-sm font-medium text-right">${Number(f.balance ?? 0).toFixed(2)}</td>
              </tr>
            ))}
            {folios.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No folios found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Folio Detail ----
function FolioDetail() {
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [chargeOpen, setChargeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
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

  const folio: Folio | null = folioData?.data ?? folioData ?? null;
  const charges: Charge[] = chargesData?.data ?? chargesData ?? [];
  const payments: Payment[] = paymentsData?.data ?? paymentsData ?? [];
  const currencyCode = (folio as { currencyCode?: string } | null)?.currencyCode ?? 'USD';

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

  const settleMutation = useMutation({ mutationFn: () => api.patch(`/v1/folios/${id}/settle`), onSuccess: invalidate });
  const closeMutation = useMutation({ mutationFn: () => api.patch(`/v1/folios/${id}/close`), onSuccess: invalidate });

  if (!folio) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Loading...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/folios')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <Receipt size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{folio.folioNumber}</h1>
        <StatusBadge status={folio.status === 'open' ? 'pending' : 'success'} label={folio.status} />
        <div className="ml-auto text-right">
          <p className="text-xs text-telivity-mid-grey">Balance</p>
          <p className="text-2xl font-semibold text-telivity-navy">${Number(folio.balance ?? 0).toFixed(2)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Charges */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-telivity-navy">Charges</h2>
            {folio.status === 'open' && (
              <button onClick={() => setChargeOpen(true)} className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold">
                <Plus size={14} /> Post Charge
              </button>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">Date</th>
                <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">Description</th>
                <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">Type</th>
                <th className="pb-2 text-right text-xs font-medium text-telivity-mid-grey">Amount</th>
                <th className="pb-2 text-right text-xs font-medium text-telivity-mid-grey"></th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id} className={`border-b border-gray-50 ${c.isReversed ? 'opacity-50 line-through' : ''}`}>
                  <td className="py-2 text-sm text-telivity-slate">{c.serviceDate}</td>
                  <td className="py-2 text-sm text-telivity-navy">{c.description} {c.isLocked && <Lock size={12} className="inline text-telivity-mid-grey" />}</td>
                  <td className="py-2 text-sm text-telivity-slate">{c.type}</td>
                  <td className="py-2 text-sm text-right font-medium">${Number(c.amount).toFixed(2)}</td>
                  <td className="py-2 text-right">
                    {!c.isReversed && !c.isLocked && folio.status === 'open' && (
                      <button onClick={() => { if (confirm('Reverse this charge?')) reverseMutation.mutate(c.id); }} className="text-telivity-orange text-xs hover:underline">
                        <RotateCcw size={12} className="inline" /> Reverse
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {charges.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-sm text-telivity-mid-grey">No charges</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Payments + Actions */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-telivity-navy">Payments</h2>
              {folio.status === 'open' && (
                <button onClick={() => setPaymentOpen(true)} className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold">
                  <Plus size={14} /> Record
                </button>
              )}
            </div>
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-telivity-navy">${Number(p.amount).toFixed(2)}</p>
                  <p className="text-xs text-telivity-mid-grey">{p.method} &middot; {p.createdAt?.split('T')[0]}</p>
                </div>
                <StatusBadge status={p.status === 'captured' ? 'success' : p.status} label={p.status} />
              </div>
            ))}
            {payments.length === 0 && <p className="text-sm text-telivity-mid-grey">No payments</p>}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 space-y-2">
            <h2 className="text-sm font-semibold text-telivity-navy mb-3">Actions</h2>
            {folio.status === 'open' && (
              <button onClick={() => settleMutation.mutate()} disabled={settleMutation.isPending} className="w-full bg-telivity-dark-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                Settle Folio
              </button>
            )}
            {folio.status === 'settled' && (
              <button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending} className="w-full bg-telivity-deep-blue text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                Close Folio
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Post Charge Modal */}
      <Modal open={chargeOpen} onClose={() => setChargeOpen(false)} title="Post Charge">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Type</label>
            <select value={chargeType} onChange={(e) => setChargeType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              <option value="room">Room</option><option value="food_beverage">F&B</option><option value="minibar">Minibar</option><option value="laundry">Laundry</option><option value="parking">Parking</option><option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Amount</label>
            <input type="number" step="0.01" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Description</label>
            <input type="text" value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button onClick={() => postChargeMutation.mutate()} disabled={!chargeAmount || postChargeMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Post Charge</button>
        </div>
      </Modal>

      {/* Record Payment Modal */}
      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Record Payment">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Method</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              <option value="cash">Cash</option><option value="credit_card">Credit Card</option><option value="debit_card">Debit Card</option><option value="bank_transfer">Bank Transfer</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Amount</label>
            <input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button onClick={() => recordPaymentMutation.mutate()} disabled={!payAmount || recordPaymentMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Record Payment</button>
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
