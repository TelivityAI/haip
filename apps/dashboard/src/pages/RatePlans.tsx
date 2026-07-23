import { useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign, Plus, ChevronLeft, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import { useTranslation } from 'react-i18next';

interface RatePlan {
  id: string;
  name: string;
  code: string;
  type: string;
  roomTypeId?: string;
  roomTypeName?: string;
  baseAmount?: number;
  currency?: string;
  currencyCode?: string;
  parentRatePlanId?: string;
  derivedAdjustmentType?: string;
  derivedAdjustmentValue?: string | number;
  derivationRule?: { type: string; value: number };
  isActive?: boolean;
}

interface RateRestriction {
  id: string;
  startDate: string;
  endDate: string;
  minLos?: number | null;
  maxLos?: number | null;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  isClosed?: boolean;
  dayOfWeekOverrides?: Record<string, number> | null;
}

interface RestrictionForm {
  startDate: string;
  endDate: string;
  minLos: string;
  maxLos: string;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  isClosed: boolean;
  dayOfWeekOverridesJson: string;
}

const emptyRestrictionForm = (): RestrictionForm => ({
  startDate: '',
  endDate: '',
  minLos: '',
  maxLos: '',
  closedToArrival: false,
  closedToDeparture: false,
  isClosed: false,
  dayOfWeekOverridesJson: '',
});

function parseOverrides(json: string): Record<string, number> | undefined {
  const trimmed = json.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as Record<string, number>;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid');
  }
  return parsed;
}

function buildRestrictionBody(form: RestrictionForm) {
  const body: Record<string, unknown> = {
    startDate: form.startDate,
    endDate: form.endDate,
    closedToArrival: form.closedToArrival,
    closedToDeparture: form.closedToDeparture,
    isClosed: form.isClosed,
  };
  if (form.minLos !== '') body.minLos = Number(form.minLos);
  if (form.maxLos !== '') body.maxLos = Number(form.maxLos);
  const overrides = parseOverrides(form.dayOfWeekOverridesJson);
  if (overrides) body.dayOfWeekOverrides = overrides;
  return body;
}

// ---- Rate Plan List ----
function RatePlanList() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState('bar');
  const [baseAmount, setBaseAmount] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [parentRatePlanId, setParentRatePlanId] = useState('');
  const [derivedAdjustmentType, setDerivedAdjustmentType] = useState('percentage');
  const [derivedAdjustmentValue, setDerivedAdjustmentValue] = useState('');

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
      const payload: Record<string, unknown> = {
        propertyId,
        name,
        code,
        type,
        baseAmount: moneyString(baseAmount || '0'),
        roomTypeId,
        currencyCode: 'USD',
      };
      if (type === 'derived') {
        payload.parentRatePlanId = parentRatePlanId;
        payload.derivedAdjustmentType = derivedAdjustmentType;
        payload.derivedAdjustmentValue = derivedAdjustmentValue;
      }
      return api.post('/v1/rate-plans', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rate-plans'] });
      setCreateOpen(false);
      setName('');
      setCode('');
      setType('bar');
      setBaseAmount('');
      setRoomTypeId('');
      setParentRatePlanId('');
      setDerivedAdjustmentType('percentage');
      setDerivedAdjustmentValue('');
    },
  });

  const derivedReady =
    type !== 'derived' || (!!parentRatePlanId && derivedAdjustmentValue !== '');

  if (!propertyId) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('ratePlans.selectProperty')}</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <BadgeDollarSign size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('ratePlans.title')}</h1>
        <button onClick={() => setCreateOpen(true)} className="ml-auto flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">
          <Plus size={16} /> {t('ratePlans.new')}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.name')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.code')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.type')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.roomType')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.baseRate')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th>
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
                <td className="px-4 py-3"><StatusBadge status={p.isActive !== false ? 'success' : 'completed'} label={p.isActive !== false ? t('common.active') : t('common.inactive')} /></td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('ratePlans.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('ratePlans.new')} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.nameRequired')}</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.codeRequired')}</label><input type="text" value={code} onChange={(e) => setCode(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.type')}</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
                <option value="bar">BAR</option><option value="derived">Derived</option><option value="negotiated">Negotiated</option><option value="package">Package</option>
              </select>
            </div>
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.baseAmount')}</label><input type="number" step="0.01" value={baseAmount} onChange={(e) => setBaseAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.roomType')}</label>
            <select value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              <option value="">{t('ratePlans.select')}</option>
              {(roomTypes as { id: string; name: string }[]).map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
            </select>
          </div>
          {type === 'derived' && (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.parentRatePlan')}</label>
                <select value={parentRatePlanId} onChange={(e) => setParentRatePlanId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
                  <option value="">{t('ratePlans.select')}</option>
                  {plans.filter((p) => p.type !== 'derived').map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.adjustmentType')}</label>
                  <select value={derivedAdjustmentType} onChange={(e) => setDerivedAdjustmentType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
                    <option value="percentage">{t('ratePlans.percentage')}</option>
                    <option value="fixed">{t('ratePlans.fixed')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.adjustmentValue')}</label>
                  <input type="text" value={derivedAdjustmentValue} onChange={(e) => setDerivedAdjustmentValue(e.target.value)} placeholder="-10.00" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
                </div>
              </div>
            </div>
          )}
          <button onClick={() => createMutation.mutate()} disabled={!name || !code || !roomTypeId || !derivedReady || createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('ratePlans.create')}</button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Restrictions panel ----
function RestrictionsPanel({ ratePlanId }: { ratePlanId: string }) {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RestrictionForm>(emptyRestrictionForm);
  const [formError, setFormError] = useState('');

  const { data } = useQuery({
    queryKey: ['rate-restrictions', ratePlanId, propertyId],
    queryFn: () =>
      api.get(`/v1/rate-plans/${ratePlanId}/restrictions`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!ratePlanId && !!propertyId,
  });

  const restrictions: RateRestriction[] = data?.data ?? data ?? [];

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyRestrictionForm());
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (r: RateRestriction) => {
    setEditingId(r.id);
    setForm({
      startDate: r.startDate ?? '',
      endDate: r.endDate ?? '',
      minLos: r.minLos != null ? String(r.minLos) : '',
      maxLos: r.maxLos != null ? String(r.maxLos) : '',
      closedToArrival: !!r.closedToArrival,
      closedToDeparture: !!r.closedToDeparture,
      isClosed: !!r.isClosed,
      dayOfWeekOverridesJson: r.dayOfWeekOverrides
        ? JSON.stringify(r.dayOfWeekOverrides)
        : '',
    });
    setFormError('');
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      requirePropertyId(propertyId);
      let body: Record<string, unknown>;
      try {
        body = buildRestrictionBody(form);
      } catch {
        throw new Error('overrides');
      }
      if (editingId) {
        return api.patch(
          `/v1/rate-plans/${ratePlanId}/restrictions/${editingId}`,
          body,
          { params: { propertyId } },
        );
      }
      return api.post(`/v1/rate-plans/${ratePlanId}/restrictions`, {
        propertyId,
        ...body,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rate-restrictions', ratePlanId] });
      setFormOpen(false);
      setFormError('');
    },
    onError: (err: Error) => {
      setFormError(
        err.message === 'overrides'
          ? t('ratePlans.overridesInvalid')
          : t('ratePlans.saveFailed'),
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (restrictionId: string) => {
      requirePropertyId(propertyId);
      return api.delete(`/v1/rate-plans/${ratePlanId}/restrictions/${restrictionId}`, {
        params: { propertyId },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rate-restrictions', ratePlanId] });
    },
  });

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 mt-6">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-semibold text-telivity-navy">{t('ratePlans.restrictions')}</h2>
        <button
          onClick={openCreate}
          className="ml-auto flex items-center gap-1.5 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold"
        >
          <Plus size={14} /> {t('ratePlans.addRestriction')}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-2 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.startDate')}</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.endDate')}</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.minLos')}</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.maxLos')}</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.cta')}</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.ctd')}</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.isClosed')}</th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.dayOfWeekOverrides')}</th>
              <th className="px-2 py-2 text-right text-xs font-semibold text-telivity-slate uppercase">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {restrictions.map((r) => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="px-2 py-2 text-sm">{r.startDate}</td>
                <td className="px-2 py-2 text-sm">{r.endDate}</td>
                <td className="px-2 py-2 text-sm">{r.minLos ?? '—'}</td>
                <td className="px-2 py-2 text-sm">{r.maxLos ?? '—'}</td>
                <td className="px-2 py-2 text-sm">{r.closedToArrival ? t('common.yes') : t('common.no')}</td>
                <td className="px-2 py-2 text-sm">{r.closedToDeparture ? t('common.yes') : t('common.no')}</td>
                <td className="px-2 py-2 text-sm">{r.isClosed ? t('common.yes') : t('common.no')}</td>
                <td className="px-2 py-2 text-xs font-mono text-telivity-slate max-w-[10rem] truncate">
                  {r.dayOfWeekOverrides ? JSON.stringify(r.dayOfWeekOverrides) : '—'}
                </td>
                <td className="px-2 py-2 text-right">
                  <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-telivity-light-grey inline-flex" title={t('common.edit')}>
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(t('ratePlans.confirmDeleteRestriction'))) {
                        deleteMutation.mutate(r.id);
                      }
                    }}
                    className="p-1.5 rounded hover:bg-telivity-light-grey inline-flex text-red-600"
                    title={t('common.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {restrictions.length === 0 && (
              <tr>
                <td colSpan={9} className="px-2 py-6 text-center text-sm text-telivity-mid-grey">
                  {t('ratePlans.noRestrictions')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? t('ratePlans.editRestriction') : t('ratePlans.addRestriction')}
        wide
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.startDate')}</label>
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.endDate')}</label>
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.minLos')}</label>
              <input type="number" min={1} value={form.minLos} onChange={(e) => setForm({ ...form, minLos: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.maxLos')}</label>
              <input type="number" min={1} value={form.maxLos} onChange={(e) => setForm({ ...form, maxLos: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.closedToArrival} onChange={(e) => setForm({ ...form, closedToArrival: e.target.checked })} />
              {t('ratePlans.cta')}
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.closedToDeparture} onChange={(e) => setForm({ ...form, closedToDeparture: e.target.checked })} />
              {t('ratePlans.ctd')}
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.isClosed} onChange={(e) => setForm({ ...form, isClosed: e.target.checked })} />
              {t('ratePlans.isClosed')}
            </label>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('ratePlans.dayOfWeekOverrides')}</label>
            <input
              type="text"
              value={form.dayOfWeekOverridesJson}
              onChange={(e) => setForm({ ...form, dayOfWeekOverridesJson: e.target.value })}
              placeholder='{"friday":20,"saturday":30}'
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-telivity-mid-grey mt-1">{t('ratePlans.dayOfWeekOverridesHint')}</p>
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!form.startDate || !form.endDate || saveMutation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {editingId ? t('common.save') : t('ratePlans.createRestriction')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Rate Plan Detail ----
function RatePlanDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const [testDate, setTestDate] = useState('');
  const [effectiveRate, setEffectiveRate] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ['rate-plans', id, propertyId],
    queryFn: () => api.get(`/v1/rate-plans/${id}`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const plan: RatePlan | null = data?.data ?? data ?? null;

  const testMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.get(`/v1/rate-plans/${id}/effective-rate`, {
        params: { propertyId, date: testDate || undefined },
      });
    },
    onSuccess: (res) => {
      const payload = res.data?.data ?? res.data;
      setEffectiveRate(payload?.effectiveRate ?? null);
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('ratePlans.selectProperty')}</div>;
  }

  if (!plan) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.loading')}</div>;

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
          <h2 className="text-sm font-semibold text-telivity-navy">{t('ratePlans.details')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs text-telivity-mid-grey">{t('ratePlans.code')}</p><p className="text-sm font-medium">{plan.code}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">{t('ratePlans.baseAmount')}</p><p className="text-sm font-medium">{plan.baseAmount != null ? `$${Number(plan.baseAmount).toFixed(2)}` : '—'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">{t('ratePlans.roomType')}</p><p className="text-sm font-medium">{plan.roomTypeName ?? '—'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">{t('ratePlans.currency')}</p><p className="text-sm font-medium">{plan.currency ?? plan.currencyCode ?? 'USD'}</p></div>
            {plan.type === 'derived' && (
              <>
                <div><p className="text-xs text-telivity-mid-grey">{t('ratePlans.parentRatePlan')}</p><p className="text-sm font-medium font-mono">{plan.parentRatePlanId ?? '—'}</p></div>
                <div>
                  <p className="text-xs text-telivity-mid-grey">{t('ratePlans.adjustment')}</p>
                  <p className="text-sm font-medium">
                    {plan.derivedAdjustmentType ?? plan.derivationRule?.type ?? '—'}
                    {' '}
                    {plan.derivedAdjustmentValue ?? plan.derivationRule?.value ?? ''}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-telivity-navy mb-3">{t('ratePlans.calculator')}</h2>
          <div className="flex gap-2">
            <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            <button onClick={() => testMutation.mutate()} disabled={testMutation.isPending} className="bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('ratePlans.calculate')}</button>
          </div>
          {effectiveRate != null && (
            <div className="mt-4 bg-telivity-light-grey rounded-lg p-4 text-center">
              <p className="text-xs text-telivity-mid-grey">{t('ratePlans.effectiveRateFor', { date: testDate || '—' })}</p>
              <p className="text-2xl font-semibold text-telivity-navy">${Number(effectiveRate).toFixed(2)}</p>
            </div>
          )}
        </div>
      </div>

      {id && <RestrictionsPanel ratePlanId={id} />}
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
