import { useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus, ChevronLeft } from 'lucide-react';
import { api } from '../lib/api';
import { requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import Modal from '../components/ui/Modal';
import { useTranslation } from 'react-i18next';

/** Standing commercial account types (KB 14.3) — excludes event allotment-only. */
const COMMERCIAL_TYPES = ['corporate', 'travel_agent', 'wholesale'] as const;

interface CommercialProfile {
  id: string;
  name: string;
  type: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  billingAddress?: string;
  paymentTermsDays?: string;
  notes?: string;
}

function CommercialList() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('corporate');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState('NET30');
  const [billingAddress, setBillingAddress] = useState('');

  const { data } = useQuery({
    queryKey: ['commercial-profiles', propertyId],
    queryFn: async () => {
      const results = await Promise.all(
        COMMERCIAL_TYPES.map((profileType) =>
          api
            .get('/v1/groups/profiles', { params: { propertyId, type: profileType, limit: 100 } })
            .then((r) => r.data?.data ?? r.data ?? []),
        ),
      );
      return (results.flat() as CommercialProfile[]).sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!propertyId,
  });

  const profiles = data ?? [];

  const createMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/groups/profiles', {
        propertyId,
        name,
        type,
        contactName: contactName || undefined,
        contactEmail: contactEmail || undefined,
        paymentTermsDays: paymentTermsDays || undefined,
        billingAddress: billingAddress || undefined,
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['commercial-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setCreateOpen(false);
      setName('');
      const id = res.data?.id ?? res.data?.data?.id;
      if (id) navigate(`/commercial/${id}`);
    },
  });

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        {t('commercial.selectProperty')}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Briefcase size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('commercial.title')}</h1>
        <button
          onClick={() => setCreateOpen(true)}
          className="ml-auto flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey"
        >
          <Plus size={16} /> {t('commercial.newProfile')}
        </button>
      </div>

      <p className="text-sm text-telivity-mid-grey mb-4">{t('commercial.subtitle')}</p>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.name')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('commercial.type')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('commercial.terms')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('commercial.contact')}</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p, i) => (
              <tr
                key={p.id}
                onClick={() => navigate(`/commercial/${p.id}`)}
                className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}
              >
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{p.name}</td>
                <td className="px-4 py-3 text-sm capitalize">{p.type.replace('_', ' ')}</td>
                <td className="px-4 py-3 text-sm">{p.paymentTermsDays ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-mid-grey">{p.contactName ?? p.contactEmail ?? '—'}</td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">
                  {t('commercial.noProfiles')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('commercial.createProfile')}>
        <div className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('common.name')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {COMMERCIAL_TYPES.map((opt) => (
              <option key={opt} value={opt}>
                {t(`commercial.types.${opt}`)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder={t('commercial.contactName')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder={t('commercial.contactEmail')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={paymentTermsDays}
            onChange={(e) => setPaymentTermsDays(e.target.value)}
            placeholder={t('commercial.terms')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <textarea
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            placeholder={t('commercial.billingAddress')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            rows={2}
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name || createMutation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('common.create')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function CommercialDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [arOpen, setArOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['commercial', id, propertyId],
    queryFn: () =>
      api.get(`/v1/groups/profiles/${id}/commercial`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const payload = data?.data ?? data;
  const profile: CommercialProfile | undefined = payload?.profile;
  const arLedgers: { id: string; name: string; balance?: string; status?: string }[] =
    payload?.arLedgers ?? [];
  const ratePlans: { id: string; name: string; code?: string; type?: string }[] =
    payload?.ratePlans ?? [];

  const createAr = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/ar/ledgers', {
        propertyId,
        name: profile!.name,
        paymentTermsDays: profile?.paymentTermsDays,
        currencyCode: 'USD',
        groupProfileId: id,
        description: `Direct bill — ${profile!.name}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commercial', id] });
      queryClient.invalidateQueries({ queryKey: ['ar-ledgers'] });
      setArOpen(false);
    },
  });

  if (!profile) {
    return <div className="text-telivity-mid-grey p-8">{t('common.loading')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/commercial')} className="p-1.5 rounded hover:bg-telivity-light-grey">
          <ChevronLeft size={20} />
        </button>
        <Briefcase size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{profile.name}</h1>
        <span className="text-sm text-telivity-mid-grey capitalize">{profile.type.replace('_', ' ')}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl shadow-sm p-5 text-sm space-y-2">
          <h2 className="text-sm font-semibold text-telivity-navy mb-2">{t('commercial.billing')}</h2>
          <p>
            <span className="text-telivity-mid-grey">{t('commercial.terms')}: </span>
            {profile.paymentTermsDays ?? '—'}
          </p>
          <p>
            <span className="text-telivity-mid-grey">{t('commercial.billingAddress')}: </span>
            {profile.billingAddress ?? '—'}
          </p>
          <p>
            <span className="text-telivity-mid-grey">{t('commercial.contact')}: </span>
            {[profile.contactName, profile.contactEmail, profile.contactPhone].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-telivity-navy">{t('commercial.arLedgers')}</h2>
            <button
              onClick={() => setArOpen(true)}
              className="text-xs font-semibold text-telivity-teal hover:underline"
            >
              {t('commercial.createArLedger')}
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            {arLedgers.map((l) => (
              <li key={l.id} className="flex justify-between border-b border-gray-50 py-1">
                <span>{l.name}</span>
                <span className="font-medium">${Number(l.balance ?? 0).toFixed(2)}</span>
              </li>
            ))}
            {arLedgers.length === 0 && (
              <li className="text-telivity-mid-grey">{t('commercial.noArLedgers')}</li>
            )}
          </ul>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-telivity-navy mb-3">{t('commercial.linkedRates')}</h2>
          <ul className="space-y-2 text-sm">
            {ratePlans.map((rp) => (
              <li key={rp.id} className="flex justify-between border-b border-gray-50 py-1">
                <span>
                  {rp.name} <span className="font-mono text-xs text-telivity-mid-grey">{rp.code}</span>
                </span>
                <span className="capitalize text-telivity-mid-grey">{rp.type}</span>
              </li>
            ))}
            {ratePlans.length === 0 && (
              <li className="text-telivity-mid-grey">{t('commercial.noLinkedRates')}</li>
            )}
          </ul>
        </div>
      </div>

      <Modal open={arOpen} onClose={() => setArOpen(false)} title={t('commercial.createArLedger')}>
        <div className="space-y-4">
          <p className="text-sm text-telivity-mid-grey">
            {t('commercial.createArHint', { name: profile.name })}
          </p>
          <button
            onClick={() => createAr.mutate()}
            disabled={createAr.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('common.create')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default function Commercial() {
  return (
    <Routes>
      <Route index element={<CommercialList />} />
      <Route path=":id" element={<CommercialDetail />} />
    </Routes>
  );
}
