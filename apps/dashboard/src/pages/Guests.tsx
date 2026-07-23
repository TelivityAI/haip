import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Search, Plus, ChevronLeft, AlertTriangle, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';

interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  vipLevel?: string;
  isDnr?: boolean;
  totalStays?: number;
  lastVisit?: string;
  preferences?: Record<string, unknown>;
  notes?: string;
  createdAt?: string;
  companyName?: string;
  idType?: string;
  idNumber?: string;
  idCountry?: string;
  gdprConsentMarketing?: boolean;
  loyaltyNumber?: string;
}

function guestListSearchParams(term: string): { search?: string; loyaltyNumber?: string } {
  const trimmed = term.trim();
  if (!trimmed) return {};
  if (/^[A-Za-z0-9-]+$/.test(trimmed) && !trimmed.includes('@') && trimmed.length >= 2) {
    return { loyaltyNumber: trimmed };
  }
  return { search: trimmed };
}

// ---- Guest List ----
function GuestList() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loyaltyNumber, setLoyaltyNumber] = useState('');

  const { data } = useQuery({
    queryKey: ['guests', propertyId, searchTerm],
    queryFn: () =>
      api
        .get('/v1/guests', { params: { propertyId, ...guestListSearchParams(searchTerm) } })
        .then((r) => r.data),
    enabled: !!propertyId,
  });

  const guests: Guest[] = data?.data ?? data ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/v1/guests', {
        firstName,
        lastName,
        email: email || undefined,
        phone: phone || undefined,
        loyaltyNumber: loyaltyNumber || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setCreateOpen(false);
      setFirstName(''); setLastName(''); setEmail(''); setPhone(''); setLoyaltyNumber('');
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('guests.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Users size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('guests.title')}</h1>
        <button onClick={() => setCreateOpen(true)} className="ml-auto flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors">
          <Plus size={16} /> {t('guests.newGuest')}
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-telivity-mid-grey" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('guests.searchPlaceholder')}
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-telivity-teal"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('common.name')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('common.email')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('common.phone')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">VIP</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.loyaltyNumber')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.stays')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.lastVisit')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.flags')}</th>
            </tr>
          </thead>
          <tbody>
            {guests.map((g, i) => (
              <tr
                key={g.id}
                className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-telivity-light-grey/50 transition-colors cursor-pointer`}
                onClick={() => navigate(`/guests/${g.id}`)}
              >
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{g.firstName} {g.lastName}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{g.email ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{g.phone ?? '—'}</td>
                <td className="px-4 py-3">
                  {g.vipLevel && g.vipLevel !== 'none' ? <StatusBadge status={g.vipLevel} /> : <span className="text-sm text-telivity-mid-grey">—</span>}
                </td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{g.loyaltyNumber ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{g.totalStays ?? 0}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{g.lastVisit ?? '—'}</td>
                <td className="px-4 py-3">
                  {g.isDnr && <StatusBadge status="error" label="DNR" />}
                </td>
              </tr>
            ))}
            {guests.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('guests.noGuestsFound')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Guest Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('guests.newGuest')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.firstName')} *</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.lastName')} *</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('common.email')}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('common.phone')}</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.loyaltyNumber')}</label>
            <input type="text" value={loyaltyNumber} onChange={(e) => setLoyaltyNumber(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!firstName || !lastName || createMutation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal disabled:opacity-50"
          >
            {createMutation.isPending ? t('common.creating') : t('guests.createGuest')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Guest Detail ----
function GuestDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [vipLevel, setVipLevel] = useState('none');
  const [loyaltyNumber, setLoyaltyNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [gdprConsentMarketing, setGdprConsentMarketing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const { data: guestData } = useQuery({
    queryKey: ['guests', id],
    queryFn: () => api.get(`/v1/guests/${id}`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!id,
  });

  const { data: stayHistory } = useQuery({
    queryKey: ['reservations', 'guest', id],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, guestId: id } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const guest: Guest | null = guestData?.data ?? guestData ?? null;
  const stays = stayHistory?.data ?? stayHistory ?? [];

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch(
        `/v1/guests/${id}`,
        {
          firstName,
          lastName,
          email: email || undefined,
          phone: phone || undefined,
          vipLevel,
          loyaltyNumber: loyaltyNumber || undefined,
          companyName: companyName || undefined,
          gdprConsentMarketing,
        },
        { params: { propertyId } },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setEditing(false);
    },
  });

  const dnrMutation = useMutation({
    mutationFn: () => api.patch(`/v1/guests/${id}`, { isDnr: !guest?.isDnr }, { params: { propertyId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guests'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/v1/guests/${id}`, { params: { propertyId } }),
    onSuccess: () => navigate('/guests'),
  });

  function startEdit() {
    if (!guest) return;
    setFirstName(guest.firstName);
    setLastName(guest.lastName);
    setEmail(guest.email ?? '');
    setPhone(guest.phone ?? '');
    setVipLevel(guest.vipLevel ?? 'none');
    setLoyaltyNumber(guest.loyaltyNumber ?? '');
    setCompanyName(guest.companyName ?? '');
    setGdprConsentMarketing(!!guest.gdprConsentMarketing);
    setEditing(true);
  }

  if (!guest) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.loading')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/guests')} className="p-1.5 rounded hover:bg-telivity-light-grey">
          <ChevronLeft size={20} />
        </button>
        <Users size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{guest.firstName} {guest.lastName}</h1>
        {guest.vipLevel && guest.vipLevel !== 'none' && <StatusBadge status={guest.vipLevel} />}
        {guest.isDnr && <StatusBadge status="error" label="DNR" />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-telivity-navy">{t('guests.profile')}</h2>
            {!editing && (
              <button onClick={startEdit} className="text-sm text-telivity-teal font-medium hover:underline">{t('common.edit')}</button>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={t('guests.firstName')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={t('guests.lastName')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.vipLevel')}</label>
                <select value={vipLevel} onChange={(e) => setVipLevel(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
                  <option value="none">{t('guests.none')}</option>
                  <option value="gold">Gold</option>
                  <option value="platinum">Platinum</option>
                  <option value="diamond">Diamond</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.loyaltyNumber')}</label>
                <input type="text" value={loyaltyNumber} onChange={(e) => setLoyaltyNumber(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder={t('guests.company')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              <label className="flex items-center gap-2 text-xs text-telivity-navy">
                <input type="checkbox" checked={gdprConsentMarketing} onChange={(e) => setGdprConsentMarketing(e.target.checked)} className="rounded border-gray-300" />
                {t('guests.marketingConsent')}
              </label>
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold">{t('common.cancel')}</button>
                <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="flex-1 bg-telivity-teal text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">{t('common.save')}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <DetailRow label={t('common.email')} value={guest.email ?? '—'} />
              <DetailRow label={t('common.phone')} value={guest.phone ?? '—'} />
              <DetailRow label={t('guests.vipLevel')} value={guest.vipLevel ?? t('guests.none')} />
              <DetailRow label={t('guests.loyaltyNumber')} value={guest.loyaltyNumber ?? '—'} />
              <DetailRow label={t('guests.company')} value={guest.companyName ?? '—'} />
              <DetailRow label={t('guests.idDocument')} value={guest.idType ? `${guest.idType}${guest.idCountry ? ` (${guest.idCountry})` : ''}` : '—'} />
              <DetailRow label={t('guests.marketingConsent')} value={guest.gdprConsentMarketing ? t('common.yes') : t('common.no')} />
              <DetailRow label={t('guests.totalStays')} value={String(guest.totalStays ?? 0)} />
            </div>
          )}
        </div>

        {/* Stay History */}
        <div className="bg-white rounded-xl shadow-sm p-6 lg:col-span-2">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('guests.stayHistory')}</h2>
          {(stays as { id: string; confirmationNumber: string; arrivalDate: string; departureDate: string; status: string; roomNumber?: string }[]).length > 0 ? (
            <div className="space-y-2">
              {(stays as { id: string; confirmationNumber: string; arrivalDate: string; departureDate: string; status: string; roomNumber?: string }[]).map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-telivity-navy">{s.confirmationNumber}</p>
                    <p className="text-xs text-telivity-mid-grey">{s.arrivalDate} → {s.departureDate} {s.roomNumber ? `• ${t('guests.roomNumber', { number: s.roomNumber })}` : ''}</p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-telivity-mid-grey">{t('guests.noStayHistory')}</p>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="mt-6 bg-white rounded-xl shadow-sm p-6 border border-telivity-orange/20">
        <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('common.actions')}</h2>
        <div className="flex gap-3">
          <button
            onClick={() => { if (confirm(`${guest.isDnr ? 'Remove' : 'Set'} DNR flag for ${guest.firstName} ${guest.lastName}?`)) dnrMutation.mutate(); }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${guest.isDnr ? 'bg-telivity-dark-teal text-white' : 'bg-telivity-orange text-white'}`}
          >
            <AlertTriangle size={14} />
            {guest.isDnr ? t('guests.removeDnr') : t('guests.markDnr')}
          </button>
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-2 border border-telivity-orange text-telivity-orange rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-orange/5"
          >
            <Trash2 size={14} />
            {t('guests.deleteGuest')}
          </button>
        </div>
      </div>

      {/* Delete Confirmation */}
      <Modal open={deleteConfirm} onClose={() => setDeleteConfirm(false)} title={t('guests.confirmDeletion')}>
        <div className="space-y-4">
          <div className="bg-telivity-orange/10 rounded-lg p-4">
            <p className="text-sm text-telivity-orange font-medium">{t('guests.irreversible')}</p>
            <p className="text-sm text-telivity-slate mt-1">
              {t('guests.deletionDescription', { name: `${guest.firstName} ${guest.lastName}` })}
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setDeleteConfirm(false)} className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold">{t('common.cancel')}</button>
            <button
              onClick={() => { if (confirm(t('guests.confirmDeletionPrompt'))) deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
              className="flex-1 bg-telivity-orange text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {deleteMutation.isPending ? t('common.deleting') : t('guests.permanentlyDelete')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-xs text-telivity-mid-grey">{label}</span>
      <span className="text-sm text-telivity-navy">{value}</span>
    </div>
  );
}

// ---- Router ----
export default function Guests() {
  return (
    <Routes>
      <Route index element={<GuestList />} />
      <Route path=":id" element={<GuestDetail />} />
    </Routes>
  );
}
