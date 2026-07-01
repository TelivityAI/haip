import { useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign, Plus, ChevronLeft } from 'lucide-react';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';

interface RatePlan {
  id: string;
  name: string;
  code: string;
  type: string;
  roomTypeId?: string;
  roomTypeName?: string;
  baseAmount?: number;
  currency?: string;
  parentRatePlanId?: string;
  derivationRule?: { type: string; value: number };
  isActive?: boolean;
}

// ---- Rate Plan List ----
function RatePlanList() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState('bar');
  const [baseAmount, setBaseAmount] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');

  const { data } = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.get('/v1/rate-plans', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: typesData } = useQuery({
    queryKey: ['rooms', 'types', propertyId],
    queryFn: () => api.get('/v1/rooms/types', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const plans: RatePlan[] = data?.data ?? data ?? [];
  const roomTypes = typesData?.data ?? typesData ?? [];

  const createMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/rate-plans', {
        propertyId,
        name,
        code,
        type,
        baseAmount: moneyString(baseAmount),
        roomTypeId,
        currencyCode: 'USD',
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['rate-plans'] }); setCreateOpen(false); },
  });

  if (!propertyId) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <BadgeDollarSign size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Rate Plans</h1>
        <button onClick={() => setCreateOpen(true)} className="ml-auto flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">
          <Plus size={16} /> New Rate Plan
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Code</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Room Type</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Base Rate</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p, i) => (
              <tr key={p.id} onClick={() => navigate(`/rate-plans/${p.id}`)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{p.name}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{p.code}</td>
                <td className="px-4 py-3"><StatusBadge status={p.type === 'bar' ? 'info' : p.type === 'derived' ? 'warning' : 'success'} label={p.type} /></td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{p.roomTypeName ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-right font-medium">{p.baseAmount != null ? `$${Number(p.baseAmount).toFixed(2)}` : '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={p.isActive !== false ? 'success' : 'completed'} label={p.isActive !== false ? 'Active' : 'Inactive'} /></td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No rate plans</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Rate Plan" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Name *</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Code *</label><input type="text" value={code} onChange={(e) => setCode(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
                <option value="bar">BAR</option><option value="derived">Derived</option><option value="negotiated">Negotiated</option><option value="package">Package</option>
              </select>
            </div>
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Base Amount</label><input type="number" step="0.01" value={baseAmount} onChange={(e) => setBaseAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Room Type</label>
            <select value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              <option value="">Select</option>
              {(roomTypes as { id: string; name: string }[]).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button onClick={() => createMutation.mutate()} disabled={!name || !code || createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Create Rate Plan</button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Rate Plan Detail ----
function RatePlanDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [testDate, setTestDate] = useState('');
  const [effectiveRate, setEffectiveRate] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ['rate-plans', id],
    queryFn: () => api.get(`/v1/rate-plans/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const plan: RatePlan | null = data?.data ?? data ?? null;

  const testMutation = useMutation({
    mutationFn: () => api.get(`/v1/rate-plans/${id}/effective-rate`, { params: { date: testDate } }),
    onSuccess: (res) => setEffectiveRate(res.data?.rate ?? res.data?.data?.rate ?? null),
  });

  if (!plan) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Loading...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/rate-plans')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <BadgeDollarSign size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{plan.name}</h1>
        <StatusBadge status={plan.type === 'bar' ? 'info' : 'warning'} label={plan.type} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-3">
          <h2 className="text-sm font-semibold text-telivity-navy">Plan Details</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs text-telivity-mid-grey">Code</p><p className="text-sm font-medium">{plan.code}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">Base Amount</p><p className="text-sm font-medium">{plan.baseAmount != null ? `$${Number(plan.baseAmount).toFixed(2)}` : '—'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">Room Type</p><p className="text-sm font-medium">{plan.roomTypeName ?? '—'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">Currency</p><p className="text-sm font-medium">{plan.currency ?? 'USD'}</p></div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-telivity-navy mb-3">Effective Rate Calculator</h2>
          <div className="flex gap-2">
            <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            <button onClick={() => testMutation.mutate()} disabled={!testDate || testMutation.isPending} className="bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Calculate</button>
          </div>
          {effectiveRate != null && (
            <div className="mt-4 bg-telivity-light-grey rounded-lg p-4 text-center">
              <p className="text-xs text-telivity-mid-grey">Effective Rate for {testDate}</p>
              <p className="text-2xl font-semibold text-telivity-navy">${Number(effectiveRate).toFixed(2)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RatePlans() {
  return (
    <Routes>
      <Route index element={<RatePlanList />} />
      <Route path=":id" element={<RatePlanDetail />} />
    </Routes>
  );
}
