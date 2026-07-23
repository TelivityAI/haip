import { useState, useEffect, useMemo } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Radio, Plus, ChevronLeft, RefreshCw, Zap, Image as ImageIcon, Trash2 } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../components/ui/Toast';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import { useTranslation } from 'react-i18next';

interface RoomTypeMappingRow {
  roomTypeId: string;
  channelRoomCode: string;
}

interface RatePlanMappingRow {
  ratePlanId: string;
  channelRateCode: string;
}

interface Connection {
  id: string;
  channelCode: string;
  channelName?: string;
  adapterType?: string;
  status: string;
  syncDirection?: string;
  lastSyncAt?: string;
  config?: Record<string, unknown>;
  roomTypeMapping?: RoomTypeMappingRow[];
  ratePlanMapping?: RatePlanMappingRow[];
}

interface ParityChannel {
  channelConnectionId: string;
  channelCode: string;
  channelName: string;
  channelRateCode: string;
  effectiveRate: number;
  hasOverride: boolean;
  isParity: boolean;
  variance: number;
}

interface RateParityRow {
  ratePlanId: string;
  ratePlanName: string;
  baseAmount: number;
  channels: ParityChannel[];
  parityViolations: number;
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

function contentPushErrorMessages(results: unknown[]): string[] {
  const messages: string[] = [];
  for (const entry of results) {
    const row = entry as {
      result?: { success?: boolean; errors?: { message?: string }[] };
      success?: boolean;
      errors?: { message?: string }[];
    };
    const result = row.result ?? row;
    if (result.errors?.length) {
      for (const e of result.errors) {
        if (e.message) messages.push(e.message);
      }
    } else if (result.success === false) {
      messages.push('Push failed');
    }
  }
  return messages;
}

function formatMoney(amount: number): string {
  return `$${Number(amount).toFixed(2)}`;
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
  const [roomTypeMapping, setRoomTypeMapping] = useState<RoomTypeMappingRow[]>([]);
  const [ratePlanMapping, setRatePlanMapping] = useState<RatePlanMappingRow[]>([]);

  const { data } = useQuery({
    queryKey: ['channels', id, propertyId],
    queryFn: () => api.get(`/v1/channels/connections/${id}`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const conn: Connection | null = data?.data ?? data ?? null;

  const { data: roomTypesData } = useQuery({
    queryKey: ['room-types', propertyId],
    queryFn: () => api.get('/v1/room-types', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });
  const { data: ratePlansData } = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.get('/v1/rate-plans', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const roomTypes: { id: string; name: string; code?: string }[] = roomTypesData?.data ?? roomTypesData ?? [];
  const ratePlans: { id: string; name: string; code?: string }[] = ratePlansData?.data ?? ratePlansData ?? [];

  useEffect(() => {
    if (!conn) return;
    setRoomTypeMapping(conn.roomTypeMapping?.length ? [...conn.roomTypeMapping] : []);
    setRatePlanMapping(conn.ratePlanMapping?.length ? [...conn.ratePlanMapping] : []);
  }, [conn]);

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

  const mappingMutation = useMutation({
    mutationFn: () =>
      api.patch(`/v1/channels/connections/${id}`, { roomTypeMapping, ratePlanMapping }, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      toast('success', t('channels.mappingsUpdated'));
    },
    onError: (e) => toast('error', `${t('channels.mappingsUpdateFailed')}: ${errMsg(e)}`),
  });

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
      const results = Array.isArray(res?.data ?? res) ? (res?.data ?? res) : [];
      const errors = contentPushErrorMessages(results);
      if (errors.length > 0) {
        toast('error', errors.join(' '));
      } else if (results.length === 0) {
        toast('info', t('channels.noMappedRoomTypes'));
      } else {
        toast('success', t('channels.contentPushSubmitted'));
      }
    },
    onError: (e) => toast('error', `${t('channels.contentPushFailed')}: ${errMsg(e)}`),
  });

  const testMutation = useMutation({
    mutationFn: () => api.post(`/v1/channels/connections/${id}/test`, null, { params: { propertyId } }).then((r) => r.data),
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

      <div className="bg-white rounded-xl shadow-sm p-6 mt-6 space-y-6">
        <h2 className="text-sm font-semibold text-telivity-navy">{t('channels.channelMappings')}</h2>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-telivity-slate uppercase">{t('channels.roomTypeMappings')}</h3>
            <button
              type="button"
              onClick={() => setRoomTypeMapping((rows) => [...rows, { roomTypeId: '', channelRoomCode: '' }])}
              className="text-xs font-semibold text-telivity-teal hover:underline"
            >
              + {t('channels.addMappingRow')}
            </button>
          </div>
          <div className="space-y-2">
            {roomTypeMapping.map((row, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <select
                  value={row.roomTypeId}
                  onChange={(e) => setRoomTypeMapping((rows) => rows.map((r, i) => (i === idx ? { ...r, roomTypeId: e.target.value } : r)))}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                >
                  <option value="">{t('channels.selectRoomType')}</option>
                  {roomTypes.map((rt) => (
                    <option key={rt.id} value={rt.id}>{rt.name}{rt.code ? ` (${rt.code})` : ''}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={row.channelRoomCode}
                  onChange={(e) => setRoomTypeMapping((rows) => rows.map((r, i) => (i === idx ? { ...r, channelRoomCode: e.target.value } : r)))}
                  placeholder={t('channels.channelRoomCode')}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                />
                <button
                  type="button"
                  onClick={() => setRoomTypeMapping((rows) => rows.filter((_, i) => i !== idx))}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                  aria-label={t('channels.removeMappingRow')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {roomTypeMapping.length === 0 && (
              <p className="text-xs text-telivity-mid-grey">{t('channels.noMappingsYet')}</p>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-telivity-slate uppercase">{t('channels.ratePlanMappings')}</h3>
            <button
              type="button"
              onClick={() => setRatePlanMapping((rows) => [...rows, { ratePlanId: '', channelRateCode: '' }])}
              className="text-xs font-semibold text-telivity-teal hover:underline"
            >
              + {t('channels.addMappingRow')}
            </button>
          </div>
          <div className="space-y-2">
            {ratePlanMapping.map((row, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <select
                  value={row.ratePlanId}
                  onChange={(e) => setRatePlanMapping((rows) => rows.map((r, i) => (i === idx ? { ...r, ratePlanId: e.target.value } : r)))}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                >
                  <option value="">{t('channels.selectRatePlan')}</option>
                  {ratePlans.map((rp) => (
                    <option key={rp.id} value={rp.id}>{rp.name}{rp.code ? ` (${rp.code})` : ''}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={row.channelRateCode}
                  onChange={(e) => setRatePlanMapping((rows) => rows.map((r, i) => (i === idx ? { ...r, channelRateCode: e.target.value } : r)))}
                  placeholder={t('channels.channelRateCode')}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                />
                <button
                  type="button"
                  onClick={() => setRatePlanMapping((rows) => rows.filter((_, i) => i !== idx))}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                  aria-label={t('channels.removeMappingRow')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {ratePlanMapping.length === 0 && (
              <p className="text-xs text-telivity-mid-grey">{t('channels.noMappingsYet')}</p>
            )}
          </div>
        </div>

        <button
          onClick={() => mappingMutation.mutate()}
          disabled={mappingMutation.isPending}
          className="bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {mappingMutation.isPending ? t('common.saving') : t('channels.saveMappings')}
        </button>
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [channelConnectionId, setChannelConnectionId] = useState('');
  const [ratePlanId, setRatePlanId] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'percentage' | 'fixed'>('percentage');
  const [adjustmentValue, setAdjustmentValue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const { data: connectionsData } = useQuery({
    queryKey: ['channels', propertyId],
    queryFn: () => api.get('/v1/channels/connections', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data } = useQuery({
    queryKey: ['channels', 'rate-parity', propertyId],
    queryFn: () => api.get('/v1/channels/rate-parity', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const connections: Connection[] = connectionsData?.data ?? connectionsData ?? [];
  const parity: RateParityRow[] = data?.data ?? data ?? [];

  const channelColumns = useMemo(() => {
    const seen = new Map<string, { channelConnectionId: string; channelName: string }>();
    for (const row of parity) {
      for (const ch of row.channels) {
        if (!seen.has(ch.channelConnectionId)) {
          seen.set(ch.channelConnectionId, {
            channelConnectionId: ch.channelConnectionId,
            channelName: ch.channelName || ch.channelCode,
          });
        }
      }
    }
    return Array.from(seen.values());
  }, [parity]);

  const overrideMutation = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/channels/rate-parity/override',
        {
          ratePlanId,
          adjustmentType,
          adjustmentValue: Number(adjustmentValue),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          ...(reason ? { reason } : {}),
        },
        { params: { propertyId, channelConnectionId } },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels', 'rate-parity'] });
      setOverrideOpen(false);
      setAdjustmentValue('');
      setStartDate('');
      setEndDate('');
      setReason('');
      toast('success', t('channels.overrideSaved'));
    },
    onError: (e) => toast('error', `${t('channels.overrideSaveFailed')}: ${errMsg(e)}`),
  });

  const removeOverrideMutation = useMutation({
    mutationFn: () =>
      api.delete('/v1/channels/rate-parity/override', {
        params: {
          propertyId,
          channelConnectionId,
          ratePlanId,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels', 'rate-parity'] });
      toast('success', t('channels.overrideRemoved'));
    },
    onError: (e) => toast('error', `${t('channels.overrideRemoveFailed')}: ${errMsg(e)}`),
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('channels.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/channels')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <Radio size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('channels.rateParity')}</h1>
        <button
          onClick={() => setOverrideOpen(true)}
          className="ml-auto border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey"
        >
          {t('channels.setRateOverride')}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        {Array.isArray(parity) && parity.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate">{t('channels.ratePlan')}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate">{t('channels.baseAmount')}</th>
                  {channelColumns.map((col) => (
                    <th key={col.channelConnectionId} className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate">
                      {col.channelName}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-semibold text-telivity-slate">{t('channels.parityViolations')}</th>
                </tr>
              </thead>
              <tbody>
                {parity.map((row) => (
                  <tr key={row.ratePlanId} className="border-b border-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{row.ratePlanName}</td>
                    <td className="px-4 py-3 text-sm text-right text-telivity-slate">{formatMoney(row.baseAmount)}</td>
                    {channelColumns.map((col) => {
                      const ch = row.channels.find((c) => c.channelConnectionId === col.channelConnectionId);
                      if (!ch) {
                        return <td key={col.channelConnectionId} className="px-4 py-3 text-sm text-center text-telivity-mid-grey">—</td>;
                      }
                      return (
                        <td key={col.channelConnectionId} className="px-4 py-3 text-right">
                          <div className="text-sm text-telivity-slate">{formatMoney(ch.effectiveRate)}</div>
                          <div className="flex items-center justify-end gap-1 mt-0.5">
                            <StatusBadge
                              status={ch.isParity ? 'success' : 'warning'}
                              label={ch.isParity ? t('channels.inParity') : t('channels.violation')}
                            />
                            {ch.hasOverride && (
                              <span className="text-[10px] text-telivity-mid-grey uppercase">{t('channels.override')}</span>
                            )}
                          </div>
                          {!ch.isParity && (
                            <div className="text-[10px] text-amber-600 mt-0.5">
                              {t('channels.variance')}: {formatMoney(ch.variance)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center">
                      {row.parityViolations > 0 ? (
                        <span className="text-sm font-semibold text-amber-600">{row.parityViolations}</span>
                      ) : (
                        <span className="text-sm text-telivity-mid-grey">0</span>
                      )}
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

      <Modal open={overrideOpen} onClose={() => setOverrideOpen(false)} title={t('channels.setRateOverride')} wide>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('channels.channel')}</label>
            <select
              value={channelConnectionId}
              onChange={(e) => setChannelConnectionId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
            >
              <option value="">{t('channels.selectChannel')}</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>{c.channelName ?? c.channelCode}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('channels.ratePlan')}</label>
            <select
              value={ratePlanId}
              onChange={(e) => setRatePlanId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
            >
              <option value="">{t('channels.selectRatePlan')}</option>
              {parity.map((p) => (
                <option key={p.ratePlanId} value={p.ratePlanId}>{p.ratePlanName}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('channels.adjustmentType')}</label>
              <select
                value={adjustmentType}
                onChange={(e) => setAdjustmentType(e.target.value as 'percentage' | 'fixed')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
              >
                <option value="percentage">{t('channels.adjustmentPercentage')}</option>
                <option value="fixed">{t('channels.adjustmentFixed')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('channels.adjustmentValue')}</label>
              <input
                type="number"
                step="0.01"
                value={adjustmentValue}
                onChange={(e) => setAdjustmentValue(e.target.value)}
                placeholder={adjustmentType === 'percentage' ? '-10' : '15.00'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('common.date')} ({t('channels.optional').toLowerCase()})</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('channels.endDate')} ({t('channels.optional').toLowerCase()})</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('channels.overrideReason')} ({t('channels.optional').toLowerCase()})</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => overrideMutation.mutate()}
              disabled={!channelConnectionId || !ratePlanId || !adjustmentValue || overrideMutation.isPending}
              className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {overrideMutation.isPending ? t('common.saving') : t('channels.saveOverride')}
            </button>
            <button
              onClick={() => removeOverrideMutation.mutate()}
              disabled={!channelConnectionId || !ratePlanId || removeOverrideMutation.isPending}
              className="border border-red-200 text-red-600 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
            >
              {t('channels.removeOverride')}
            </button>
          </div>
        </div>
      </Modal>
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
