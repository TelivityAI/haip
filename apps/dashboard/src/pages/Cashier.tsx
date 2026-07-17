import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, Plus, ChevronLeft, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import { useTranslation } from 'react-i18next';

interface CashDrawer {
  id: string;
  name: string;
  startingFloat?: string;
}

function getStoredDrawerIds(propertyId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`haip-drawers-${propertyId}`) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function storeDrawerId(propertyId: string, id: string) {
  const ids = getStoredDrawerIds(propertyId);
  if (!ids.includes(id)) {
    localStorage.setItem(`haip-drawers-${propertyId}`, JSON.stringify([...ids, id]));
  }
}

function CashierHome() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerName, setDrawerName] = useState('');
  const [startingFloat, setStartingFloat] = useState('200.00');
  const [drawerIds, setDrawerIds] = useState<string[]>([]);

  useEffect(() => {
    if (propertyId) setDrawerIds(getStoredDrawerIds(propertyId));
  }, [propertyId]);

  const { data: drawers } = useQuery({
    queryKey: ['cash', 'drawers', propertyId, drawerIds],
    queryFn: async () => {
      const results = await Promise.all(
        drawerIds.map((id) =>
          api.get(`/v1/cash/drawers/${id}`, { params: { propertyId } }).then((r) => r.data?.data ?? r.data).catch(() => null),
        ),
      );
      return results.filter(Boolean) as CashDrawer[];
    },
    enabled: !!propertyId && drawerIds.length > 0,
  });

  const createDrawer = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/cash/drawers', {
        propertyId,
        name: drawerName,
        startingFloat: moneyString(startingFloat),
      });
    },
    onSuccess: (res) => {
      const id = res.data?.id ?? res.data?.data?.id;
      if (id && propertyId) {
        storeDrawerId(propertyId, id);
        setDrawerIds(getStoredDrawerIds(propertyId));
      }
      queryClient.invalidateQueries({ queryKey: ['cash'] });
      setDrawerOpen(false);
      setDrawerName('');
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('cashier.selectProperty')}</div>;
  }

  const drawerList = drawers ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Banknote size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('cashier.title')}</h1>
        <button onClick={() => setDrawerOpen(true)} className="ml-auto flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey">
          <Plus size={16} /> {t('cashier.newDrawer')}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.name')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('cashier.startingFloat')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {drawerList.map((d, i) => (
              <tr key={d.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{d.name}</td>
                <td className="px-4 py-3 text-sm text-right">${Number(d.startingFloat ?? 0).toFixed(2)}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => navigate(`/cashier/sessions/${d.id}`)} className="text-xs font-semibold text-telivity-teal hover:underline">{t('cashier.openSession')}</button>
                </td>
              </tr>
            ))}
            {drawerList.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('cashier.noDrawers')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('cashier.createDrawer')}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('common.name')}</label>
            <input type="text" value={drawerName} onChange={(e) => setDrawerName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('cashier.startingFloat')}</label>
            <input type="number" step="0.01" value={startingFloat} onChange={(e) => setStartingFloat(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={() => createDrawer.mutate()} disabled={!drawerName || createDrawer.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('common.create')}</button>
        </div>
      </Modal>
    </div>
  );
}

function CashierSession() {
  const { t } = useTranslation();
  const { drawerId } = useParams<{ drawerId: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [movementType, setMovementType] = useState('payment');
  const [movementAmount, setMovementAmount] = useState('');
  const [countedBalance, setCountedBalance] = useState('');
  const [cashierUserId, setCashierUserId] = useState('');

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users', propertyId],
    queryFn: () => api.get('/v1/admin/users', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });
  const users: { id: string; name: string }[] = usersData ?? [];

  const openSession = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/cash/sessions', {
        propertyId,
        cashDrawerId: drawerId,
        cashierUserId,
        openingFloat: '200.00',
      });
    },
    onSuccess: (res) => setSessionId(res.data?.id ?? res.data?.data?.id),
  });

  const recordMovement = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/cash/sessions/${sessionId}/movements`, {
        propertyId,
        type: movementType,
        amount: moneyString(movementAmount),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash'] });
      setMovementAmount('');
    },
  });

  const closeSession = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/cash/sessions/${sessionId}/close`, {
        propertyId,
        countedBalance: moneyString(countedBalance || movementAmount || '0'),
      });
    },
    onSuccess: () => navigate(`/cashier/report/${sessionId}`),
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/cashier')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <Banknote size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('cashier.session')}</h1>
        {sessionId && <StatusBadge status="success" label="Open" />}
        {sessionId && (
          <button onClick={() => navigate(`/cashier/report/${sessionId}`)} className="ml-auto flex items-center gap-1 text-xs font-semibold text-telivity-teal">
            <FileText size={14} /> {t('cashier.viewReport')}
          </button>
        )}
      </div>

      {!sessionId ? (
        <div className="bg-white rounded-xl shadow-sm p-6 max-w-md space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('cashier.cashier')}</label>
            <select value={cashierUserId} onChange={(e) => setCashierUserId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">{t('cashier.selectUser')}</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <button onClick={() => openSession.mutate()} disabled={!cashierUserId || openSession.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('cashier.openSession')}</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-6 max-w-md space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('cashier.movementType')}</label>
            <select value={movementType} onChange={(e) => setMovementType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="payment">{t('cashier.payment')}</option>
              <option value="refund">{t('cashier.refund')}</option>
              <option value="paid_out">{t('cashier.paidOut')}</option>
              <option value="drop">{t('cashier.drop')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('cashier.amount')}</label>
            <input type="number" step="0.01" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={() => recordMovement.mutate()} disabled={!movementAmount || recordMovement.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('cashier.recordMovement')}</button>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('cashier.countedBalance')}</label>
            <input type="number" step="0.01" value={countedBalance} onChange={(e) => setCountedBalance(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={() => closeSession.mutate()} disabled={closeSession.isPending} className="w-full border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold">{t('cashier.closeSession')}</button>
        </div>
      )}
    </div>
  );
}

function SessionReport() {
  const { t } = useTranslation();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['cash', 'report', sessionId, propertyId],
    queryFn: () => api.get(`/v1/cash/sessions/${sessionId}/report`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!sessionId && !!propertyId,
  });

  const report = data?.data ?? data;
  const session = report?.session;
  const summary = report?.movementSummary ?? {};

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/cashier')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <FileText size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('cashier.sessionReport')}</h1>
        {session?.status && <StatusBadge status={session.status === 'closed' ? 'completed' : 'success'} label={session.status} />}
      </div>

      {!report ? (
        <div className="text-telivity-mid-grey">{t('common.loading')}</div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-xs text-telivity-mid-grey">{t('cashier.openingFloat')}</p><p className="font-semibold">${session?.openingFloat ?? '0.00'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">{t('cashier.expected')}</p><p className="font-semibold">${report.expectedBalance ?? '0.00'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">{t('cashier.counted')}</p><p className="font-semibold">${session?.countedBalance ?? '—'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">{t('cashier.variance')}</p><p className="font-semibold">${session?.variance ?? '0.00'}</p></div>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-telivity-navy">{t('cashier.movementSummary')}</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr className="bg-telivity-teal/5 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('cashier.type')}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('cashier.count')}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('cashier.total')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary as Record<string, { count: number; total: string }>).map(([type, row]) => (
                  <tr key={type} className="border-b border-gray-50">
                    <td className="px-4 py-3 text-sm capitalize">{type.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-sm text-right">{row.count}</td>
                    <td className="px-4 py-3 text-sm text-right">${Number(row.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Cashier() {
  return (
    <Routes>
      <Route index element={<CashierHome />} />
      <Route path="sessions/:drawerId" element={<CashierSession />} />
      <Route path="report/:sessionId" element={<SessionReport />} />
    </Routes>
  );
}
