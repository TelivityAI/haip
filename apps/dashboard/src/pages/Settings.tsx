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
import { useTranslation } from 'react-i18next';

type Tab = 'property' | 'users' | 'roles' | 'webhooks' | 'booking-engine';

const TABS: { key: Tab; labelKey: string; icon: typeof Building }[] = [
  { key: 'property', labelKey: 'settings.tabs.property', icon: Building },
  { key: 'users', labelKey: 'settings.tabs.users', icon: Shield },
  { key: 'roles', labelKey: 'settings.tabs.roles', icon: ShieldCheck },
  { key: 'webhooks', labelKey: 'settings.tabs.webhooks', icon: Link2 },
  { key: 'booking-engine', labelKey: 'settings.tabs.bookingEngine', icon: Globe },
];

export default function Settings() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'property';
  const [tab, setTab] = useState<Tab>(
    TABS.some((t) => t.key === initialTab) ? initialTab : 'property',
  );

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('settings.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('settings.title')}</h1>
      </div>

      <div className="flex gap-1 bg-white rounded-xl shadow-sm p-1 mb-4">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              tab === tabItem.key ? 'bg-telivity-teal text-white' : 'text-telivity-slate hover:bg-telivity-light-grey'
            }`}
          >
            <tabItem.icon size={16} />
            {t(tabItem.labelKey)}
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
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [checkInTime, setCheckInTime] = useState('15:00');
  const [checkOutTime, setCheckOutTime] = useState('11:00');
  const [staffDisplayName, setStaffDisplayName] = useState('');
  const [staffLogoMediaId, setStaffLogoMediaId] = useState('');
  const [staffPrimaryColor, setStaffPrimaryColor] = useState('');
  const [staffAccentColor, setStaffAccentColor] = useState('');
  const [occWarnBelow, setOccWarnBelow] = useState('');
  const [adrWarnBelow, setAdrWarnBelow] = useState('');
  const [revparWarnBelow, setRevparWarnBelow] = useState('');

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
      setAddress(property.addressLine1 ?? property.address ?? '');
      setPhone(property.phone ?? '');
      setEmail(property.email ?? '');
      setTimezone(property.timezone ?? '');
      setCurrency(property.currencyCode ?? property.currency ?? 'USD');
      setCheckInTime(property.checkInTime ?? '15:00');
      setCheckOutTime(property.checkOutTime ?? '11:00');
      setStaffDisplayName(property.staffDisplayName ?? '');
      setStaffLogoMediaId(property.staffLogoMediaId ?? '');
      setStaffPrimaryColor(property.staffPrimaryColor ?? '');
      setStaffAccentColor(property.staffAccentColor ?? '');
      const thr = property.settings?.kpiThresholds ?? {};
      setOccWarnBelow(thr.occupancyRate?.warnBelow != null ? String(thr.occupancyRate.warnBelow) : '');
      setAdrWarnBelow(thr.adr?.warnBelow != null ? String(thr.adr.warnBelow) : '');
      setRevparWarnBelow(thr.revpar?.warnBelow != null ? String(thr.revpar.warnBelow) : '');
    }
  }, [property]);

  const updateMutation = useMutation({
    mutationFn: () => {
      const kpiThresholds: Record<string, { warnBelow?: number }> = {};
      if (occWarnBelow !== '') {
        kpiThresholds.occupancyRate = { warnBelow: Number(occWarnBelow) };
      }
      if (adrWarnBelow !== '') {
        kpiThresholds.adr = { warnBelow: Number(adrWarnBelow) };
      }
      if (revparWarnBelow !== '') {
        kpiThresholds.revpar = { warnBelow: Number(revparWarnBelow) };
      }
      return api.patch(`/v1/properties/${propertyId}`, {
        name,
        code,
        addressLine1: address || undefined,
        phone,
        email,
        timezone,
        currencyCode: currency,
        checkInTime,
        checkOutTime,
        staffDisplayName: staffDisplayName || undefined,
        staffLogoMediaId: staffLogoMediaId || undefined,
        staffPrimaryColor: staffPrimaryColor || undefined,
        staffAccentColor: staffAccentColor || undefined,
        settings: {
          ...(property?.settings ?? {}),
          kpiThresholds,
        },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  });

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('settings.propertyInformation')}</h2>
      <div className="space-y-4 max-w-xl">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.name')}</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.code')}</label><input type="text" value={code} onChange={(e) => setCode(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
        </div>
        <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.address')}</label><input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.phone')}</label><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.email')}</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.timezone')}</label><input type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.currency')}</label><input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.checkInTime')}</label><input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.checkOutTime')}</label><input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
        </div>

        <div className="border-t border-gray-100 pt-4 mt-2">
          <h3 className="text-sm font-semibold text-telivity-navy mb-3">{t('settings.staffDashboardBranding')}</h3>
          <p className="text-xs text-telivity-mid-grey mb-3">{t('settings.staffDashboardBrandingDescription')}</p>
          <div className="space-y-3">
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.displayName')}</label><input type="text" value={staffDisplayName} onChange={(e) => setStaffDisplayName(e.target.value)} placeholder={t('settings.displayNamePlaceholder')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.logoMediaId')}</label><input type="text" value={staffLogoMediaId} onChange={(e) => setStaffLogoMediaId(e.target.value)} placeholder={t('settings.logoMediaIdPlaceholder')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal font-mono text-xs" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.primaryColor')}</label><input type="text" value={staffPrimaryColor} onChange={(e) => setStaffPrimaryColor(e.target.value)} placeholder="#016491" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
              <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.accentColor')}</label><input type="text" value={staffAccentColor} onChange={(e) => setStaffAccentColor(e.target.value)} placeholder="#06bdb4" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 mt-2">
          <h3 className="text-sm font-semibold text-telivity-navy mb-3">{t('settings.kpiWarningThresholds')}</h3>
          <p className="text-xs text-telivity-mid-grey mb-3">{t('settings.kpiWarningThresholdsDescription')}</p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.occupancyWarnBelow')}</label><input type="number" step="0.01" min="0" max="1" value={occWarnBelow} onChange={(e) => setOccWarnBelow(e.target.value)} placeholder="0.60" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.adrWarnBelow')}</label><input type="number" step="0.01" value={adrWarnBelow} onChange={(e) => setAdrWarnBelow(e.target.value)} placeholder="150" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
            <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('settings.revparWarnBelow')}</label><input type="number" step="0.01" value={revparWarnBelow} onChange={(e) => setRevparWarnBelow(e.target.value)} placeholder="100" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          </div>
        </div>

        <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="bg-telivity-teal text-white rounded-lg px-6 py-2 text-sm font-semibold disabled:opacity-50">
          {updateMutation.isPending ? t('settings.saving') : t('settings.saveChanges')}
        </button>
        {updateMutation.isSuccess && <p className="text-sm text-telivity-dark-teal">{t('settings.saved')}</p>}
      </div>

      <div className="mt-8 border-t border-gray-100 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <ImageIcon size={16} className="text-telivity-teal" />
          <h2 className="text-sm font-semibold text-telivity-navy">{t('settings.propertyPhotos')}</h2>
        </div>
        <MediaGallery propertyId={propertyId} ownerType="property" ownerId={propertyId} />
      </div>
    </div>
  );
}

function WebhookSettings({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['connect', 'subscriptions', propertyId],
    queryFn: () => api.get('/v1/connect/subscriptions', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const subs = data?.data ?? data ?? [];

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-telivity-navy">{t('settings.agentWebhookSubscriptions')}</h2>
      </div>
      <table className="w-full">
        <thead>
          <tr className="bg-telivity-teal/5 border-b border-gray-100">
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('settings.subscriber')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('settings.callbackUrl')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('settings.events')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('settings.active')}</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('settings.failures')}</th>
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
            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('settings.noWebhookSubscriptions')}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

