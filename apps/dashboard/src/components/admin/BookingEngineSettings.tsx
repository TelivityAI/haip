import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Copy, Check, Trash2, Image as ImageIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../ui/Toast';
import MediaGallery from '../media/MediaGallery';

type DepositType = 'none' | 'first_night' | 'percentage' | 'full';

interface DepositPolicy {
  type: DepositType;
  percentage?: number;
  refundable: boolean;
}

interface BookingEngineConfig {
  id: string;
  propertyId: string;
  isEnabled: boolean;
  displayName: string | null;
  logoMediaId: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  sellableRoomTypeIds: string[];
  sellableRatePlanIds: string[];
  depositPolicy: DepositPolicy;
  autoConfirm: boolean;
  stripePublishableKey: string | null;
}

interface PublishableKey {
  id: string;
  label: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface RoomType {
  id: string;
  name: string;
  code: string;
}

interface RatePlan {
  id: string;
  name: string;
  code: string;
}

const DEFAULT_DEPOSIT: DepositPolicy = { type: 'none', refundable: true };

export default function BookingEngineSettings({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: configData } = useQuery({
    queryKey: ['booking-engine', 'config', propertyId],
    queryFn: () => api.get('/v1/admin/booking-engine/config', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const config: BookingEngineConfig | undefined = configData?.data ?? configData;

  // ---- Editable form state ----
  const [isEnabled, setIsEnabled] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [logoMediaId, setLogoMediaId] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState('#0d9488');
  const [accentColor, setAccentColor] = useState('#f97316');
  const [sellableRoomTypeIds, setSellableRoomTypeIds] = useState<string[]>([]);
  const [sellableRatePlanIds, setSellableRatePlanIds] = useState<string[]>([]);
  const [depositPolicy, setDepositPolicy] = useState<DepositPolicy>(DEFAULT_DEPOSIT);
  const [autoConfirm, setAutoConfirm] = useState(false);

  useEffect(() => {
    if (config) {
      setIsEnabled(config.isEnabled ?? false);
      setDisplayName(config.displayName ?? '');
      setLogoMediaId(config.logoMediaId ?? null);
      setPrimaryColor(config.primaryColor ?? '#0d9488');
      setAccentColor(config.accentColor ?? '#f97316');
      setSellableRoomTypeIds(config.sellableRoomTypeIds ?? []);
      setSellableRatePlanIds(config.sellableRatePlanIds ?? []);
      setDepositPolicy(config.depositPolicy ?? DEFAULT_DEPOSIT);
      setAutoConfirm(config.autoConfirm ?? false);
    }
  }, [config]);

  // ---- Inventory sources ----
  const { data: typesData } = useQuery({
    queryKey: ['rooms', 'types', propertyId],
    queryFn: () => api.get('/v1/rooms/types', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });
  const { data: ratePlansData } = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.get('/v1/rate-plans', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const roomTypes: RoomType[] = typesData?.data ?? typesData ?? [];
  const ratePlans: RatePlan[] = ratePlansData?.data ?? ratePlansData ?? [];

  // ---- Publishable keys ----
  const { data: keysData } = useQuery({
    queryKey: ['booking-engine', 'keys', propertyId],
    queryFn: () => api.get('/v1/admin/booking-engine/keys', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });
  const keys: PublishableKey[] = keysData?.data ?? keysData ?? [];

  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createKey = useMutation({
    mutationFn: (label: string) =>
      api.post('/v1/admin/booking-engine/keys', { label }, { params: { propertyId } }).then((r) => r.data),
    onSuccess: (res) => {
      const created = res?.data ?? res;
      setNewKey(created?.key ?? null);
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ['booking-engine', 'keys'] });
      toast('success', 'Publishable key generated');
    },
    onError: () => toast('error', 'Failed to generate key'),
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/admin/booking-engine/keys/${id}`, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking-engine', 'keys'] });
      toast('success', 'Key revoked');
    },
    onError: () => toast('error', 'Failed to revoke key'),
  });

  const saveConfig = useMutation({
    mutationFn: () =>
      api.patch('/v1/admin/booking-engine/config', {
        isEnabled,
        displayName: displayName || null,
        logoMediaId,
        primaryColor,
        accentColor,
        sellableRoomTypeIds,
        sellableRatePlanIds,
        depositPolicy,
        autoConfirm,
      }, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking-engine', 'config'] });
      toast('success', 'Booking engine settings saved');
    },
    onError: () => toast('error', 'Failed to save settings'),
  });

  const generateKey = () => {
    const label = window.prompt('Label for this publishable key (e.g. "Marketing site")');
    if (label && label.trim()) createKey.mutate(label.trim());
  };

  const copyKey = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="space-y-4">
      {/* 1. Enable toggle */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-telivity-navy">Direct Booking Engine</h2>
            <p className="text-xs text-telivity-mid-grey mt-1">
              Let guests book directly from your website, commission-free.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
            <span className="text-xs font-medium text-telivity-slate">{isEnabled ? 'Enabled' : 'Disabled'}</span>
            <button
              type="button"
              role="switch"
              aria-checked={isEnabled}
              onClick={() => setIsEnabled((v) => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors ${isEnabled ? 'bg-telivity-teal' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isEnabled ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        </div>
      </div>

      {/* 2. Publishable keys */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-telivity-navy">Publishable Keys</h2>
          <button
            onClick={generateKey}
            disabled={createKey.isPending}
            className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          >
            <KeyRound size={15} /> Generate key
          </button>
        </div>

        {newKey && (
          <div className="m-4 border-l-4 border-telivity-orange bg-telivity-orange/5 rounded-xl p-4">
            <p className="text-xs font-semibold text-telivity-orange mb-2">
              Copy this key now — you won&apos;t be able to see it again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-telivity-navy break-all">
                {newKey}
              </code>
              <button
                onClick={copyKey}
                className="flex items-center gap-1.5 bg-telivity-teal text-white rounded-lg px-3 py-2 text-sm font-semibold shrink-0"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => setNewKey(null)}
                className="text-xs text-telivity-mid-grey hover:text-telivity-slate shrink-0"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Label</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Key</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Created</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k, i) => (
              <tr key={k.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{k.label}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate font-mono">{k.keyPrefix}••••</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    k.isActive ? 'bg-telivity-dark-teal/10 text-telivity-dark-teal' : 'bg-gray-100 text-telivity-mid-grey'
                  }`}>{k.isActive ? 'active' : 'revoked'}</span>
                </td>
                <td className="px-4 py-3 text-sm text-telivity-slate">
                  {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  {k.isActive && (
                    <button
                      onClick={() => revokeKey.mutate(k.id)}
                      disabled={revokeKey.isPending}
                      className="inline-flex items-center gap-1 text-red-500 hover:text-red-600 text-sm font-medium disabled:opacity-50"
                    >
                      <Trash2 size={14} /> Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No publishable keys yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 3. Sellable inventory */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-sm font-semibold text-telivity-navy mb-1">Sellable Inventory</h2>
        <p className="text-xs text-telivity-mid-grey mb-4">Only checked room types and rate plans are publicly bookable.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-2">Room Types</label>
            <div className="space-y-1 max-h-56 overflow-y-auto border border-gray-100 rounded-lg p-2">
              {roomTypes.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sellableRoomTypeIds.includes(t.id)}
                    onChange={() => setSellableRoomTypeIds((s) => toggleId(s, t.id))}
                    className="accent-telivity-teal"
                  />
                  <span className="font-medium text-telivity-navy">{t.name}</span>
                  <span className="text-[10px] text-telivity-mid-grey uppercase tracking-wide">{t.code}</span>
                </label>
              ))}
              {roomTypes.length === 0 && <p className="text-xs text-telivity-mid-grey py-1">No room types</p>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-2">Rate Plans</label>
            <div className="space-y-1 max-h-56 overflow-y-auto border border-gray-100 rounded-lg p-2">
              {ratePlans.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sellableRatePlanIds.includes(p.id)}
                    onChange={() => setSellableRatePlanIds((s) => toggleId(s, p.id))}
                    className="accent-telivity-teal"
                  />
                  <span className="font-medium text-telivity-navy">{p.name}</span>
                  <span className="text-[10px] text-telivity-mid-grey uppercase tracking-wide">{p.code}</span>
                </label>
              ))}
              {ratePlans.length === 0 && <p className="text-xs text-telivity-mid-grey py-1">No rate plans</p>}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Branding */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-sm font-semibold text-telivity-navy mb-4">Branding</h2>
        <div className="space-y-4 max-w-xl">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Shown to guests on the booking page"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Primary Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-9 w-12 border border-gray-200 rounded-lg cursor-pointer" />
                <input type="text" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-telivity-teal" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Accent Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-9 w-12 border border-gray-200 rounded-lg cursor-pointer" />
                <input type="text" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-telivity-teal" />
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ImageIcon size={16} className="text-telivity-teal" />
              <label className="text-xs font-medium text-telivity-mid-grey">Logo</label>
            </div>
            <MediaGallery propertyId={propertyId} ownerType="property" ownerId={propertyId} />
          </div>
        </div>
      </div>

      {/* 5. Deposit policy */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-sm font-semibold text-telivity-navy mb-4">Deposit Policy</h2>
        <div className="space-y-4 max-w-xl">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Type</label>
              <select
                value={depositPolicy.type}
                onChange={(e) => setDepositPolicy((d) => ({ ...d, type: e.target.value as DepositType }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
              >
                <option value="none">No deposit</option>
                <option value="first_night">First night</option>
                <option value="percentage">Percentage</option>
                <option value="full">Full amount</option>
              </select>
            </div>
            {depositPolicy.type === 'percentage' && (
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Percentage</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={depositPolicy.percentage ?? 0}
                  onChange={(e) => setDepositPolicy((d) => ({ ...d, percentage: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                />
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={depositPolicy.refundable}
              onChange={(e) => setDepositPolicy((d) => ({ ...d, refundable: e.target.checked }))}
              className="accent-telivity-teal"
            />
            <span className="text-telivity-navy">Refundable deposit</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={autoConfirm}
              onChange={(e) => setAutoConfirm(e.target.checked)}
              className="accent-telivity-teal"
            />
            <span className="text-telivity-navy">Auto-confirm paid bookings</span>
          </label>
        </div>
      </div>

      {/* 6. Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => saveConfig.mutate()}
          disabled={saveConfig.isPending}
          className="bg-telivity-teal text-white rounded-lg px-6 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {saveConfig.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
