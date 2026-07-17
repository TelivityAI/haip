import { useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Radio, Plus, ChevronLeft, RefreshCw, Zap, Image as ImageIcon } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../components/ui/Toast';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import { useTranslation } from 'react-i18next';

interface Connection {
  id: string;
  channelCode: string;
  channelName?: string;
  adapterType?: string;
  status: string;
  syncDirection?: string;
  lastSyncAt?: string;
  config?: Record<string, unknown>;
}

// Only adapters the backend factory actually supports (channel-adapter.factory.ts).
const ADAPTER_OPTIONS = [
  { value: 'booking_com', label: 'Booking.com' },
  { value: 'expedia', label: 'Expedia' },
  { value: 'siteminder', label: 'SiteMinder' },
  { value: 'derbysoft', label: 'DerbySoft' },
  { value: 'mock', label: 'Demo (mock)' },
];

function errMsg(e: unknown): string {
  const anyE = e as { response?: { data?: { message?: string } }; message?: string };
  const m = anyE?.response?.data?.message ?? anyE?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

// ---- Connection List ----
function ConnectionList() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [adapterType, setAdapterType] = useState('booking_com');
  const [channelCode, setChannelCode] = useState('booking_com');
  const [channelName, setChannelName] = useState('');
  const [hotelId, setHotelId] = useState('');

  const { data } = useQuery({
    queryKey: ['channels', propertyId],
    queryFn: () => api.get('/v1/channels/connections', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const connections: Connection[] = data?.data ?? data ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/v1/channels/connections', {
        propertyId,
        channelCode: channelCode || adapterType,
        channelName: channelName || ADAPTER_OPTIONS.find((a) => a.value === adapterType)?.label || adapterType,
        adapterType,
        config: hotelId ? { hotelId } : {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      setCreateOpen(false);
      setChannelName('');
      setHotelId('');
      toast('success', t('channels.connectionCreated'));
    },
    onError: (e) => toast('error', `${t('channels.couldNotCreateConnection')}: ${errMsg(e)}`),
  });

  function onAdapterChange(value: string) {
    setAdapterType(value);
    setChannelCode(value);
  }

  if (!propertyId) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('channels.selectProperty')}</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Radio size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('channels.title')}</h1>
        <div className="ml-auto flex gap-2">
          <button onClick={() => navigate('/channels/rate-parity')} className="border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey">{t('channels.rateParity')}</button>
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold"><Plus size={16} /> {t('channels.addConnection')}</button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('channels.channel')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('channels.code')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('channels.direction')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('channels.lastSync')}</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((c, i) => (
              <tr key={c.id} onClick={() => navigate(`/channels/${c.id}`)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{c.channelName ?? c.channelCode}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{c.channelCode}</td>
                <td className="px-4 py-3"><StatusBadge status={c.status === 'active' ? 'success' : c.status} label={t(`channels.statuses.${c.status}`, { defaultValue: c.status })} /></td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{c.syncDirection ?? 'both'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{c.lastSyncAt ?? '—'}</td>
              </tr>
            ))}
            {connections.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('channels.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('channels.addConnection')}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('channels.adapter')}</label>
            <select value={adapterType} onChange={(e) => onAdapterChange(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              {ADAPTER_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('channels.code')}</label>
            <input type="text" value={channelCode} onChange={(e) => setChannelCode(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('channels.displayName')}</label>
            <input type="text" value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder={t('channels.optional')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('channels.hotelPropertyId')} <span className="text-telivity-mid-grey/70">({t('channels.optional').toLowerCase()})</span></label>
            <input type="text" value={hotelId} onChange={(e) => setHotelId(e.target.value)} placeholder={t('channels.providerPropertyId')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('channels.createConnection')}</button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Sync logs table (shared by Content + ARI tabs) ----
interface SyncLog {
  id: string;
  action?: string;
  status?: string;
  errorMessage?: string | null;
  createdAt?: string;
}

export function SyncLogsTable({ logs }: { logs: SyncLog[] }) {
  const { t } = useTranslation();
  if (logs.length === 0) {
    return <p className="text-sm text-telivity-mid-grey text-center py-6">{t('channels.noSyncLogs')}</p>;
  }
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-gray-100">
          <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate">{t('channels.time')}</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate">{t('channels.action')}</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate">{t('common.status')}</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate">{t('channels.detail')}</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((l) => (
          <tr key={l.id} className="border-b border-gray-50">
            <td className="px-3 py-2 text-xs text-telivity-slate">{l.createdAt ? new Date(l.createdAt).toLocaleString() : '—'}</td>
            <td className="px-3 py-2 text-xs text-telivity-slate">{l.action ?? '—'}</td>
            <td className="px-3 py-2"><StatusBadge status={l.status === 'success' ? 'success' : 'error'} label={l.status ?? 'unknown'} /></td>
            <td className="px-3 py-2 text-xs text-telivity-mid-grey">{l.errorMessage ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Connection Detail ----
function ConnectionDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [logsTab, setLogsTab] = useState<'content' | 'ari'>('content');

  const { data } = useQuery({
    queryKey: ['channels', id],
    queryFn: () => api.get(`/v1/channels/connections/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const conn: Connection | null = data?.data ?? data ?? null;

  const contentLogsQuery = useQuery({
    queryKey: ['content-logs', id],
    queryFn: () => api.get(`/v1/channels/content-sync-logs/${id}`, { params: { propertyId, limit: 20 } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });
  const ariLogsQuery = useQuery({
    queryKey: ['ari-logs', id],
    queryFn: () => api.get(`/v1/channels/sync-logs/${id}`, { params: { propertyId, limit: 20 } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const ariStart = format(new Date(), 'yyyy-MM-dd');
  const ariEnd = format(addDays(new Date(), 30), 'yyyy-MM-dd');

  const syncMutation = useMutation({
    mutationFn: (action: string) =>
      api.post(`/v1/channels/push/${action}`, {
        propertyId,
        channelConnectionId: id,
        startDate: ariStart,
        endDate: ariEnd,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      queryClient.invalidateQueries({ queryKey: ['ari-logs', id] });
      toast('success', t('channels.ariPushSubmitted'));
    },
    onError: (e) => toast('error', `${t('channels.ariPushFailed')}: ${errMsg(e)}`),
  });

  const contentMutation = useMutation({
    mutationFn: () => api.post('/v1/channels/push/content', { propertyId, channelConnectionId: id }).then((r) => r.data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['content-logs', id] });
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      const results = res?.data ?? res ?? [];
      if (Array.isArray(results) && results.length === 0) {
        toast('info', t('channels.noMappedRoomTypes'));
      } else {
        toast('success', t('channels.contentPushSubmitted'));
      }
    },
    onError: (e) => toast('error', `${t('channels.contentPushFailed')}: ${errMsg(e)}`),
  });

  const testMutation = useMutation({
    mutationFn: () => api.post(`/v1/channels/connections/${id}/test`).then((r) => r.data),
    onSuccess: (res) => {
      const r = res?.data ?? res ?? {};
      toast(r.connected ? 'success' : 'error', r.message ?? (r.connected ? t('channels.connected') : t('channels.connectionTestFailed')));
    },
    onError: (e) => toast('error', `${t('channels.testFailed')}: ${errMsg(e)}`),
  });

  if (!conn) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.loading')}</div>;

  const contentLogs: SyncLog[] = contentLogsQuery.data?.data ?? contentLogsQuery.data ?? [];
  const ariLogs: SyncLog[] = ariLogsQuery.data?.data ?? ariLogsQuery.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/channels')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <Radio size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{conn.channelName ?? conn.channelCode}</h1>
        <StatusBadge status={conn.status === 'active' ? 'success' : conn.status} label={t(`channels.statuses.${conn.status}`, { defaultValue: conn.status })} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-telivity-navy">{t('channels.connectionInfo')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs text-telivity-mid-grey">{t('channels.code')}</p><p className="text-sm font-medium">{conn.channelCode}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">{t('channels.adapter')}</p><p className="text-sm font-medium">{conn.adapterType ?? '—'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">{t('channels.direction')}</p><p className="text-sm font-medium">{conn.syncDirection ?? 'both'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">{t('channels.lastSync')}</p><p className="text-sm font-medium">{conn.lastSyncAt ?? t('channels.never')}</p></div>
          </div>
          <button onClick={() => testMutation.mutate()} disabled={testMutation.isPending} className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey disabled:opacity-50">
            {testMutation.isPending ? t('channels.testing') : t('channels.testConnection')}
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('channels.syncActions')}</h2>
          <div className="space-y-2">
            {[
              { action: 'availability', label: t('channels.pushAvailability'), icon: RefreshCw },
              { action: 'rates', label: t('channels.pushRates'), icon: RefreshCw },
              { action: 'full', label: t('channels.pushFullAri'), icon: Zap },
            ].map(({ action, label, icon: Icon }) => (
              <button
                key={action}
                onClick={() => syncMutation.mutate(action)}
                disabled={syncMutation.isPending}
                className="w-full flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium hover:border-telivity-teal hover:bg-telivity-teal/5 transition-colors disabled:opacity-50"
              >
                <Icon size={14} /> {label}
              </button>
            ))}
            <button
              onClick={() => contentMutation.mutate()}
              disabled={contentMutation.isPending}
              className="w-full flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium hover:border-telivity-teal hover:bg-telivity-teal/5 transition-colors disabled:opacity-50"
            >
              <ImageIcon size={14} /> {contentMutation.isPending ? t('channels.pushingContent') : t('channels.pushContent')}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 mt-6">
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-sm font-semibold text-telivity-navy">{t('channels.syncLogs')}</h2>
          <div className="flex gap-1 ml-auto">
            {(['content', 'ari'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setLogsTab(tab)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold ${logsTab === tab ? 'bg-telivity-teal text-white' : 'text-telivity-slate hover:bg-telivity-light-grey'}`}
              >
                {tab === 'content' ? t('channels.content') : 'ARI'}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <SyncLogsTable logs={logsTab === 'content' ? contentLogs : ariLogs} />
        </div>
      </div>
    </div>
  );
}

// ---- Rate Parity ----
function RateParity() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['channels', 'rate-parity', propertyId],
    queryFn: () => api.get('/v1/channels/rate-parity', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const parity = data?.data ?? data ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/channels')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <Radio size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('channels.rateParity')}</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        {Array.isArray(parity) && parity.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate">{t('channels.ratePlan')}</th>
                  {/* Dynamic channel columns would go here */}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate">{t('channels.pmsRate')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {(parity as { ratePlanName: string; pmsRate: number; inParity: boolean }[]).map((p, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{p.ratePlanName}</td>
                    <td className="px-4 py-3 text-sm text-right">${Number(p.pmsRate).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.inParity ? 'success' : 'warning'} label={p.inParity ? t('channels.inParity') : t('channels.violation')} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-telivity-mid-grey text-center py-8">{t('channels.noParity')}</p>
        )}
      </div>
    </div>
  );
}

export default function Channels() {
  return (
    <Routes>
      <Route index element={<ConnectionList />} />
      <Route path="rate-parity" element={<RateParity />} />
      <Route path=":id" element={<ConnectionDetail />} />
    </Routes>
  );
}
