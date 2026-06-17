import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings as SettingsIcon, Building, Link2, Shield, ShieldCheck, Image as ImageIcon, Globe } from 'lucide-react';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import MediaGallery from '../components/media/MediaGallery';
import UserSettings from '../components/admin/UserSettings';
import RolesSettings from '../components/admin/RolesSettings';
import BookingEngineSettings from '../components/admin/BookingEngineSettings';

type Tab = 'property' | 'users' | 'roles' | 'webhooks' | 'booking-engine';

const TABS: { key: Tab; label: string; icon: typeof Building }[] = [
  { key: 'property', label: 'Property', icon: Building },
  { key: 'users', label: 'Users', icon: Shield },
  { key: 'roles', label: 'Roles', icon: ShieldCheck },
  { key: 'webhooks', label: 'Webhooks', icon: Link2 },
  { key: 'booking-engine', label: 'Booking Engine', icon: Globe },
];

export default function Settings() {
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'property';
  const [tab, setTab] = useState<Tab>(
    TABS.some((t) => t.key === initialTab) ? initialTab : 'property',
  );

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Settings</h1>
      </div>

      <div className="flex gap-1 bg-white rounded-xl shadow-sm p-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-telivity-teal text-white' : 'text-telivity-slate hover:bg-telivity-light-grey'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'property' && <PropertySettings propertyId={propertyId} queryClient={queryClient} />}
      {tab === 'users' && <UserSettings propertyId={propertyId} />}
      {tab === 'roles' && <RolesSettings propertyId={propertyId} />}
      {tab === 'webhooks' && <WebhookSettings propertyId={propertyId} />}
      {tab === 'booking-engine' && <BookingEngineSettings propertyId={propertyId} />}
    </div>
  );
}

function PropertySettings({ propertyId, queryClient }: { propertyId: string; queryClient: ReturnType<typeof useQueryClient> }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [checkInTime, setCheckInTime] = useState('15:00');
  const [checkOutTime, setCheckOutTime] = useState('11:00');

  const { data } = useQuery({
    queryKey: ['properties', propertyId],
    queryFn: () => api.get(`/v1/properties/${propertyId}`).then((r) => r.data),
    enabled: !!propertyId,
  });

  const property = data?.data ?? data;

  useEffect(() => {
    if (property) {
      setName(property.name ?? '');
      setCode(property.code ?? '');
      setAddress(property.address ?? '');
      setPhone(property.phone ?? '');
      setEmail(property.email ?? '');
      setTimezone(property.timezone ?? '');
      setCurrency(property.currency ?? 'USD');
      setCheckInTime(property.checkInTime ?? '15:00');
      setCheckOutTime(property.checkOutTime ?? '11:00');
    }
  }, [property]);

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/v1/properties/${propertyId}`, { name, code, address, phone, email, timezone, currency, checkInTime, checkOutTime }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  });

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h2 className="text-sm font-semibold text-telivity-navy mb-4">Property Information</h2>
      <div className="space-y-4 max-w-xl">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Code</label><input type="text" value={code} onChange={(e) => setCode(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
        </div>
        <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Address</label><input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Phone</label><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Timezone</label><input type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Currency</label><input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Check-in Time</label><input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Check-out Time</label><input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
        </div>
        <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="bg-telivity-teal text-white rounded-lg px-6 py-2 text-sm font-semibold disabled:opacity-50">
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
        {updateMutation.isSuccess && <p className="text-sm text-telivity-dark-teal">Settings saved.</p>}
      </div>

      <div className="mt-8 border-t border-gray-100 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <ImageIcon size={16} className="text-telivity-teal" />
          <h2 className="text-sm font-semibold text-telivity-navy">Property Photos</h2>
        </div>
        <MediaGallery propertyId={propertyId} ownerType="property" ownerId={propertyId} />
      </div>
    </div>
  );
}

function WebhookSettings({ propertyId }: { propertyId: string }) {
  const { data } = useQuery({
    queryKey: ['connect', 'subscriptions', propertyId],
    queryFn: () => api.get('/v1/connect/subscriptions', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const subs = data?.data ?? data ?? [];

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-telivity-navy">Agent Webhook Subscriptions</h2>
      </div>
      <table className="w-full">
        <thead>
          <tr className="bg-telivity-teal/5 border-b border-gray-100">
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Subscriber</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Callback URL</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Events</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Active</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Failures</th>
          </tr>
        </thead>
        <tbody>
          {(subs as { id: string; subscriberId: string; subscriberName?: string; callbackUrl: string; events: string[]; isActive: boolean; failureCount: number }[]).map((s, i) => (
            <tr key={s.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
              <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{s.subscriberName ?? s.subscriberId}</td>
              <td className="px-4 py-3 text-sm text-telivity-slate truncate max-w-[200px]">{s.callbackUrl}</td>
              <td className="px-4 py-3 text-sm text-telivity-slate">{s.events.join(', ')}</td>
              <td className="px-4 py-3">{s.isActive ? <span className="w-2 h-2 bg-telivity-dark-teal rounded-full inline-block" /> : <span className="w-2 h-2 bg-telivity-mid-grey rounded-full inline-block" />}</td>
              <td className="px-4 py-3 text-sm text-right">{s.failureCount}</td>
            </tr>
          ))}
          {subs.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No webhook subscriptions</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

