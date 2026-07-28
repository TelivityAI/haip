import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Search,
  Plus,
  ChevronLeft,
  AlertTriangle,
  Trash2,
  MapPin,
  CreditCard,
  Clock,
  ShieldCheck,
  User,
  ShieldAlert,
} from 'lucide-react';
import {
  formatCpf,
  calculateAge,
  checkFnrhComplete,
} from '@telivityhaip/shared';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import CreateGuestModal from '../components/guests/CreateGuestModal';
import type { Guest } from '../types/guest';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const { data: propertyData } = useQuery({
    queryKey: ['properties', propertyId],
    queryFn: () => api.get(`/v1/properties/${propertyId}`).then((r) => r.data),
    enabled: !!propertyId,
  });
  const property = propertyData?.data ?? propertyData;

  const defaultCountry = property?.countryCode ?? 'US';
  const isBR = defaultCountry.toUpperCase() === 'BR';
  const minorGuardianRequired =
    property?.guestRegistrationConfig?.minorGuardianIdentificationRequired ??
    property?.settings?.minorGuardianIdentificationRequired !== false;

  const { data } = useQuery({
    queryKey: ['guests', propertyId, searchTerm],
    queryFn: () =>
      api
        .get('/v1/guests', { params: { propertyId, ...guestListSearchParams(searchTerm) } })
        .then((r) => r.data),
    enabled: !!propertyId,
  });

  const guests: Guest[] = data?.data ?? data ?? [];

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('guests.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Users size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('guests.title')}</h1>
        <button
          onClick={() => setCreateOpen(true)}
          className="ml-auto flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors"
        >
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
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.labels.taxId')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">VIP</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.loyaltyNumber')}</th>
              {isBR && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.registrationStatus')}</th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.flags')}</th>
            </tr>
          </thead>
          <tbody>
            {guests.map((g, i) => {
              const isFnrhOk = isBR ? checkFnrhComplete(g, minorGuardianRequired) : null;
              const guestAge = calculateAge(g.dateOfBirth);
              const gIsMinor = (guestAge !== null && guestAge < 18) || (g.registrationData as any)?.isMinor;

              return (
                <tr
                  key={g.id}
                  className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-telivity-light-grey/50 transition-colors cursor-pointer`}
                  onClick={() => navigate(`/guests/${g.id}`)}
                >
                  <td className="px-4 py-3 text-sm font-medium text-telivity-navy flex items-center gap-2">
                    {g.firstName} {g.lastName}
                    {gIsMinor && (
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                        {t('guests.minorBadge', { age: guestAge ?? '?' })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{g.email ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{g.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate font-mono">{g.taxId ? (isBR ? formatCpf(g.taxId) : g.taxId) : (g.idNumber ?? '—')}</td>
                  <td className="px-4 py-3">
                    {g.vipLevel && g.vipLevel !== 'none' ? <StatusBadge status={g.vipLevel} /> : <span className="text-sm text-telivity-mid-grey">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{g.loyaltyNumber ?? '—'}</td>
                  {isBR && (
                    <td className="px-4 py-3 text-sm">
                      {isFnrhOk ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          {t('guests.registrationComplete')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                          {t('guests.registrationIncomplete')}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {g.isDnr && <StatusBadge status="error" label="DNR" />}
                  </td>
                </tr>
              );
            })}
            {guests.length === 0 && (
              <tr><td colSpan={isBR ? 8 : 7} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('guests.noGuestsFound')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* COMPLETE NEW GUEST MODAL */}
      <CreateGuestModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

// ---- Guest Detail ----
function GuestDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: propertyData } = useQuery({
    queryKey: ['properties', propertyId],
    queryFn: () => api.get(`/v1/properties/${propertyId}`).then((r) => r.data),
    enabled: !!propertyId,
  });
  const property = propertyData?.data ?? propertyData;

  const defaultCountry = property?.countryCode ?? 'US';
  const isBR = defaultCountry.toUpperCase() === 'BR';
  const minorGuardianRequired =
    property?.guestRegistrationConfig?.minorGuardianIdentificationRequired ??
    property?.settings?.minorGuardianIdentificationRequired !== false;

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [profession, setProfession] = useState('');
  const [nationality, setNationality] = useState(defaultCountry);

  // Guardian State
  const [guardianName, setGuardianName] = useState('');
  const [guardianTaxId, setGuardianTaxId] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianRelationship, setGuardianRelationship] = useState('parent');
  const [hasMinorAuthorization, setHasMinorAuthorization] = useState(false);

  const [taxId, setTaxId] = useState('');
  const [idType, setIdType] = useState(isBR ? 'cpf' : 'passport');
  const [idNumber, setIdNumber] = useState('');
  const [idIssuer, setIdIssuer] = useState('');
  const [idIssuerState, setIdIssuerState] = useState('');
  const [idCountry, setIdCountry] = useState(defaultCountry);
  const [idExpiry, setIdExpiry] = useState('');

  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [stateProvince, setStateProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [countryCode, setCountryCode] = useState(defaultCountry);

  const [vipLevel, setVipLevel] = useState('none');
  const [loyaltyNumber, setLoyaltyNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [notes, setNotes] = useState('');
  const [gdprConsentMarketing, setGdprConsentMarketing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const age = calculateAge(dateOfBirth);
  const isMinor = age !== null && age < 18;

  const { data: guest } = useQuery<Guest>({
    queryKey: ['guest', id, propertyId],
    queryFn: () => api.get(`/v1/guests/${id}`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const { data: stays = [] } = useQuery({
    queryKey: ['guest-stays', id, propertyId],
    queryFn: () => api.get(`/v1/guests/${id}/stays`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch(`/v1/guests/${id}`, {
        propertyId,
        firstName,
        lastName,
        email: email || undefined,
        phone: phone || undefined,
        dateOfBirth: dateOfBirth || undefined,
        gender: gender || undefined,
        profession: profession || undefined,
        nationality: nationality || undefined,
        taxId: taxId || undefined,
        idType: idType || undefined,
        idNumber: idNumber || undefined,
        idCountry: idCountry || undefined,
        idExpiry: idExpiry || undefined,
        addressLine1: addressLine1 || undefined,
        addressLine2: addressLine2 || undefined,
        city: city || undefined,
        stateProvince: stateProvince || undefined,
        postalCode: postalCode || undefined,
        countryCode: countryCode || undefined,
        vipLevel: vipLevel !== 'none' ? vipLevel : undefined,
        loyaltyNumber: loyaltyNumber || undefined,
        companyName: companyName || undefined,
        notes: notes || undefined,
        gdprConsentMarketing,
        registrationData: {
          ...((idIssuer || idIssuerState || neighborhood) ? { idIssuer, idIssuerState, neighborhood } : {}),
          ...(isMinor ? {
            isMinor: true,
            guardianName: guardianName || undefined,
            guardianTaxId: guardianTaxId || undefined,
            guardianPhone: guardianPhone || undefined,
            guardianRelationship: guardianRelationship || 'parent',
            hasMinorAuthorization,
          } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guest', id] });
      setEditing(false);
    },
  });

  const dnrMutation = useMutation({
    mutationFn: () =>
      api.patch(`/v1/guests/${id}`, {
        propertyId,
        isDnr: !guest?.isDnr,
        dnrReason: !guest?.isDnr ? 'Flagged via staff dashboard' : null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guest', id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/v1/guests/${id}`, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      navigate('/guests');
    },
  });

  function startEdit() {
    if (!guest) return;
    const reg = (guest.registrationData as Record<string, any>) || {};
    setFirstName(guest.firstName ?? '');
    setLastName(guest.lastName ?? '');
    setEmail(guest.email ?? '');
    setPhone(guest.phone ?? '');
    setDateOfBirth(guest.dateOfBirth ? guest.dateOfBirth.slice(0, 10) : '');
    setGender(guest.gender ?? '');
    setProfession(guest.profession ?? '');
    setNationality(guest.nationality ?? defaultCountry);

    setGuardianName(reg.guardianName ?? '');
    setGuardianTaxId(reg.guardianTaxId ?? '');
    setGuardianPhone(reg.guardianPhone ?? '');
    setGuardianRelationship(reg.guardianRelationship ?? 'parent');
    setHasMinorAuthorization(!!reg.hasMinorAuthorization);

    setTaxId(guest.taxId ?? '');
    setIdType(guest.idType ?? (isBR ? 'cpf' : 'passport'));
    setIdNumber(guest.idNumber ?? '');
    setIdIssuer(reg.idIssuer ?? '');
    setIdIssuerState(reg.idIssuerState ?? '');
    setIdCountry(guest.idCountry ?? defaultCountry);
    setIdExpiry(guest.idExpiry ? guest.idExpiry.slice(0, 10) : '');

    setAddressLine1(guest.addressLine1 ?? '');
    setAddressLine2(guest.addressLine2 ?? '');
    setNeighborhood(reg.neighborhood ?? '');
    setCity(guest.city ?? '');
    setStateProvince(guest.stateProvince ?? '');
    setPostalCode(guest.postalCode ?? '');
    setCountryCode(guest.countryCode ?? defaultCountry);

    setVipLevel(guest.vipLevel ?? 'none');
    setLoyaltyNumber(guest.loyaltyNumber ?? '');
    setCompanyName(guest.companyName ?? '');
    setNotes(guest.notes ?? '');
    setGdprConsentMarketing(!!guest.gdprConsentMarketing);
    setEditing(true);
  }

  if (!guest) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.loading')}</div>;
  }

  const regData = (guest.registrationData as Record<string, any>) || {};
  const isFnrhOk = isBR ? checkFnrhComplete(guest, minorGuardianRequired) : null;
  const detailAge = calculateAge(guest.dateOfBirth);
  const detailIsMinor = (detailAge !== null && detailAge < 18) || regData.isMinor;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/guests')} className="p-1.5 rounded hover:bg-telivity-light-grey">
          <ChevronLeft size={20} />
        </button>
        <Users size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy flex items-center gap-2">
          {guest.firstName} {guest.lastName}
          {detailIsMinor && (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
              {t('guests.minorBadge', { age: detailAge ?? '?' })}
            </span>
          )}
        </h1>
        {guest.vipLevel && guest.vipLevel !== 'none' && <StatusBadge status={guest.vipLevel} />}
        {guest.isDnr && <StatusBadge status="error" label="DNR" />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card & Complete Data */}
        <div className="bg-white rounded-xl shadow-sm p-6 lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between border-b border-gray-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-telivity-navy">{t('guests.profile')}</h2>
              <p className="text-xs text-telivity-mid-grey">Guest details & registration profile</p>
            </div>
            {!editing ? (
              <button onClick={startEdit} className="px-4 py-1.5 bg-telivity-teal text-white text-xs font-semibold rounded-lg hover:bg-telivity-light-teal transition-all">
                {t('common.edit')}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 border border-gray-200 text-telivity-slate text-xs font-semibold rounded-lg hover:bg-gray-100">
                  {t('common.cancel')}
                </button>
                <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending || (isMinor && minorGuardianRequired && (!guardianName || !guardianTaxId))} className="px-4 py-1.5 bg-telivity-teal text-white text-xs font-semibold rounded-lg hover:bg-telivity-light-teal disabled:opacity-50">
                  {updateMutation.isPending ? t('common.saving') : t('common.save')}
                </button>
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-6">
              {/* Edit Section 1 */}
              <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
                <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">{t('guests.sections.personal')}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={`${t('guests.firstName')} (Ex: ${t('guests.placeholders.firstName')})`} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={`${t('guests.lastName')} (Ex: ${t('guests.placeholders.lastName')})`} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('guests.placeholders.email')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('guests.placeholders.phone')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  <select value={gender} onChange={(e) => setGender(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white">
                    <option value="">{t('guests.gender')}</option>
                    <option value="male">{t('guests.genderOptions.male')}</option>
                    <option value="female">{t('guests.genderOptions.female')}</option>
                    <option value="other">{t('guests.genderOptions.other')}</option>
                  </select>
                  <input type="text" maxLength={2} value={nationality} onChange={(e) => setNationality(e.target.value.toUpperCase())} placeholder={t('guests.labels.nationality')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white" />
                </div>

                {isMinor && (
                  <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 space-y-3">
                    <p className="text-xs font-bold text-purple-900">
                      {t('guests.guardian.title', { age })} {minorGuardianRequired ? '*' : `(${t('guests.guardian.badgeOptional')})`}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder={`${t('guests.guardian.name')} ${minorGuardianRequired ? '*' : ''}`} className="border border-purple-200 rounded-lg px-3 py-2 text-sm bg-white" />
                      <input type="text" value={guardianTaxId} onChange={(e) => setGuardianTaxId(e.target.value)} placeholder={`${t('guests.guardian.taxId')} ${minorGuardianRequired ? '*' : ''}`} className="border border-purple-200 rounded-lg px-3 py-2 text-sm bg-white" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="tel" value={guardianPhone} onChange={(e) => setGuardianPhone(e.target.value)} placeholder={t('guests.guardian.phone')} className="border border-purple-200 rounded-lg px-3 py-2 text-sm bg-white" />
                      <select value={guardianRelationship} onChange={(e) => setGuardianRelationship(e.target.value)} className="border border-purple-200 rounded-lg px-3 py-2 text-sm bg-white">
                        <option value="parent">{t('guests.guardian.relationshipOptions.parent')}</option>
                        <option value="legal_guardian">{t('guests.guardian.relationshipOptions.legal_guardian')}</option>
                        <option value="authorized_adult">{t('guests.guardian.relationshipOptions.authorized_adult')}</option>
                      </select>
                    </div>
                  </div>
                )}

                <input type="text" value={profession} onChange={(e) => setProfession(e.target.value)} placeholder={t('guests.placeholders.profession')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
              </div>

              {/* Edit Section 2 */}
              <div className="p-4 bg-telivity-teal/5 rounded-xl border border-telivity-teal/10 space-y-3">
                <h3 className="text-xs font-semibold text-telivity-teal uppercase tracking-wider">{isBR ? t('guests.sections.identificationFnrh') : t('guests.sections.identification')}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <select value={idType} onChange={(e) => setIdType(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white">
                    {isBR && <option value="cpf">{t('guests.idTypeOptions.cpf')}</option>}
                    {isBR && <option value="rg">{t('guests.idTypeOptions.rg')}</option>}
                    <option value="passport">{t('frontDesk.passport')}</option>
                    <option value="drivers_license">{t('frontDesk.driversLicense')}</option>
                    <option value="national_id">{t('frontDesk.nationalId')}</option>
                    {!isBR && <option value="tax_id">{t('guests.labels.taxId')}</option>}
                  </select>
                  <input type="text" value={idType === 'cpf' ? taxId : idNumber} onChange={(e) => idType === 'cpf' ? setTaxId(e.target.value) : setIdNumber(e.target.value)} placeholder={t('guests.labels.idNumber')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                {idType !== 'cpf' && isBR && (
                  <input type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder={t('guests.labels.cpfOptional')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                )}
                {isBR && (
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" value={idIssuer} onChange={(e) => setIdIssuer(e.target.value)} placeholder={t('guests.placeholders.idIssuer')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                    <input type="text" maxLength={2} value={idIssuerState} onChange={(e) => setIdIssuerState(e.target.value.toUpperCase())} placeholder={t('guests.placeholders.idIssuerState')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" maxLength={2} value={idCountry} onChange={(e) => setIdCountry(e.target.value.toUpperCase())} placeholder={t('guests.labels.idCountry')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="date" value={idExpiry} onChange={(e) => setIdExpiry(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
              </div>

              {/* Edit Section 3 */}
              <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
                <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">{t('guests.sections.address')}</h3>
                <input type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder={`${t('guests.labels.addressLine1')} (Ex: ${t('guests.placeholders.address')})`} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                <div className={`grid ${isBR ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                  <input type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder={t('guests.placeholders.addressLine2')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  {isBR && (
                    <input type="text" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder={t('guests.placeholders.neighborhood')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder={`${t('guests.labels.city')} (${t('guests.placeholders.city')})`} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="text" maxLength={isBR ? 2 : 50} value={stateProvince} onChange={(e) => setStateProvince(isBR ? e.target.value.toUpperCase() : e.target.value)} placeholder={t('guests.placeholders.state')} className={`border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white ${isBR ? 'uppercase' : ''}`} />
                  <input type="text" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder={t('guests.placeholders.postalCode')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <input type="text" maxLength={2} value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} placeholder={t('guests.labels.countryCode')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white" />
              </div>

              {/* Edit Section 4 */}
              <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
                <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">{t('guests.sections.preferences')}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <select value={vipLevel} onChange={(e) => setVipLevel(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white">
                    <option value="none">{t('guests.none')}</option>
                    <option value="gold">Gold</option>
                    <option value="platinum">Platinum</option>
                    <option value="diamond">Diamond</option>
                  </select>
                  <input type="text" value={loyaltyNumber} onChange={(e) => setLoyaltyNumber(e.target.value)} placeholder={t('guests.loyaltyNumber')} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder={t('guests.company')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('guests.placeholders.notes')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                <label className="flex items-center gap-2 text-xs text-telivity-navy">
                  <input type="checkbox" checked={gdprConsentMarketing} onChange={(e) => setGdprConsentMarketing(e.target.checked)} className="rounded border-gray-300" />
                  {t('guests.marketingConsent')} (LGPD/GDPR)
                </label>
              </div>
            </div>
          ) : (
            /* Read View - ALL Database Fields Organized */
            <div className="space-y-6">
              {/* Group 1: Personal Details */}
              <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100 space-y-2">
                <h3 className="text-xs font-bold text-telivity-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <User size={14} className="text-telivity-teal" /> {t('guests.sections.personal')}
                </h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <DetailRow label={t('common.email')} value={guest.email ?? '—'} />
                  <DetailRow label={t('common.phone')} value={guest.phone ?? '—'} />
                  <DetailRow label={t('guests.labels.dateOfBirth')} value={guest.dateOfBirth ? `${new Date(guest.dateOfBirth).toLocaleDateString(i18n.language || 'pt-BR')}${detailAge !== null ? ` (${t('guests.ageYears', { age: detailAge })})` : ''}` : '—'} />
                  <DetailRow label={t('guests.gender')} value={guest.gender ? (t(`guests.genderOptions.${guest.gender}`, { defaultValue: guest.gender })) : '—'} />
                  <DetailRow label={t('guests.labels.nationality')} value={guest.nationality ?? defaultCountry} />
                  <DetailRow label={t('guests.profession')} value={guest.profession ?? '—'} />
                </div>
              </div>

              {/* GUARDIAN CARD IF MINOR */}
              {detailIsMinor && (
                <div className="bg-purple-50/70 p-4 rounded-xl border border-purple-200 space-y-2">
                  <h3 className="text-xs font-bold text-purple-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-purple-600" /> {t('guests.guardian.title', { age: detailAge ?? '?' })}
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <DetailRow label={t('guests.guardian.name')} value={regData.guardianName ?? '—'} />
                    <DetailRow label={t('guests.guardian.taxId')} value={regData.guardianTaxId ? (isBR ? formatCpf(regData.guardianTaxId) : regData.guardianTaxId) : '—'} />
                    <DetailRow label={t('guests.guardian.phone')} value={regData.guardianPhone ?? '—'} />
                    <DetailRow
                      label={t('guests.guardian.relationship')}
                      value={
                        regData.guardianRelationship ? t(`guests.guardian.relationshipOptions.${regData.guardianRelationship}`, { defaultValue: regData.guardianRelationship }) : '—'
                      }
                    />
                    <DetailRow
                      label={t('guests.guardian.authLabel')}
                      value={regData.hasMinorAuthorization ? t('guests.guardian.authPresented') : t('guests.guardian.authPending')}
                    />
                  </div>
                </div>
              )}

              {/* Group 2: Document & Registration */}
              <div className="bg-telivity-teal/5 p-4 rounded-xl border border-telivity-teal/10 space-y-2">
                <h3 className="text-xs font-bold text-telivity-teal uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CreditCard size={14} /> {isBR ? t('guests.sections.identificationFnrh') : t('guests.sections.identification')}
                </h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <DetailRow label={t('guests.labels.taxId')} value={guest.taxId ? (isBR ? formatCpf(guest.taxId) : guest.taxId) : '—'} />
                  <DetailRow label={t('guests.labels.idType')} value={guest.idType ? (t(`guests.idTypeOptions.${guest.idType}`, { defaultValue: guest.idType.toUpperCase() })) : '—'} />
                  <DetailRow label={t('guests.labels.idNumber')} value={guest.idNumber ?? '—'} />
                  {(regData.idIssuer || regData.idIssuerState) && (
                    <DetailRow label={t('guests.labels.idIssuerAndState')} value={`${regData.idIssuer ?? '—'} / ${regData.idIssuerState ?? '—'}`} />
                  )}
                  <DetailRow label={t('guests.labels.idCountry')} value={guest.idCountry ?? defaultCountry} />
                  <DetailRow label={t('guests.labels.idExpiry')} value={guest.idExpiry ? new Date(guest.idExpiry).toLocaleDateString(i18n.language || 'pt-BR') : '—'} />
                  {isBR && (
                    <DetailRow
                      label={t('guests.registrationStatus')}
                      value={isFnrhOk ? t('guests.registrationComplete') : t('guests.registrationIncomplete')}
                    />
                  )}
                </div>
              </div>

              {/* Group 3: Complete Address */}
              <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100 space-y-2">
                <h3 className="text-xs font-bold text-telivity-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MapPin size={14} className="text-telivity-teal" /> {t('guests.sections.address')}
                </h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <DetailRow label={t('guests.labels.addressLine1')} value={guest.addressLine1 ?? '—'} />
                  <DetailRow label={t('guests.labels.addressLine2')} value={guest.addressLine2 ?? '—'} />
                  {regData.neighborhood && <DetailRow label={t('guests.neighborhood')} value={regData.neighborhood} />}
                  <DetailRow label={t('guests.labels.cityAndState')} value={`${guest.city ?? '—'} - ${guest.stateProvince ?? '—'}`} />
                  <DetailRow label={t('guests.labels.postalCode')} value={guest.postalCode ?? '—'} />
                  <DetailRow label={t('guests.labels.countryCode')} value={guest.countryCode ?? defaultCountry} />
                </div>
              </div>

              {/* Group 4: Profile, VIP & LGPD */}
              <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100 space-y-2">
                <h3 className="text-xs font-bold text-telivity-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-telivity-teal" /> {t('guests.sections.preferences')}
                </h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <DetailRow label={t('guests.vipLevel')} value={guest.vipLevel ?? t('guests.none')} />
                  <DetailRow label={t('guests.loyaltyNumber')} value={guest.loyaltyNumber ?? '—'} />
                  <DetailRow label={t('guests.company')} value={guest.companyName ?? '—'} />
                  <DetailRow label={t('guests.consentLabel')} value={guest.gdprConsentMarketing ? t('guests.consentAuthorized') : t('guests.consentUnauthorized')} />
                  {guest.gdprConsentDate && <DetailRow label={t('guests.consentDateLabel')} value={new Date(guest.gdprConsentDate).toLocaleDateString(i18n.language || 'pt-BR')} />}
                  <DetailRow label={t('guests.createdAtLabel')} value={guest.createdAt ? new Date(guest.createdAt).toLocaleDateString(i18n.language || 'pt-BR') : '—'} />
                  <DetailRow label={t('guests.updatedAtLabel')} value={guest.updatedAt ? new Date(guest.updatedAt).toLocaleDateString(i18n.language || 'pt-BR') : '—'} />
                </div>
                {guest.notes && (
                  <div className="mt-3 border-t border-gray-200/60 pt-2">
                    <span className="text-xs text-telivity-mid-grey block font-medium">{t('guests.labels.notes')}:</span>
                    <p className="text-xs text-telivity-navy mt-1 bg-white p-2.5 rounded-lg border border-gray-100">{guest.notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar: Stay History & Actions */}
        <div className="space-y-6">
          {/* Stay History Card */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-sm font-semibold text-telivity-navy mb-4 flex items-center gap-2">
              <Clock size={16} className="text-telivity-teal" /> {t('guests.stayHistory')} ({guest.totalStays ?? stays.length})
            </h2>
            {(stays as { id: string; confirmationNumber: string; arrivalDate: string; departureDate: string; status: string; roomNumber?: string }[]).length > 0 ? (
              <div className="space-y-3">
                {(stays as { id: string; confirmationNumber: string; arrivalDate: string; departureDate: string; status: string; roomNumber?: string }[]).map((s) => (
                  <div key={s.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-telivity-navy">{s.confirmationNumber}</p>
                      <p className="text-[11px] text-telivity-mid-grey">{s.arrivalDate} → {s.departureDate} {s.roomNumber ? `• ${t('guests.roomNumber', { number: s.roomNumber })}` : ''}</p>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-telivity-mid-grey">{t('guests.noStayHistory')}</p>
            )}
          </div>

          {/* Danger / Governance Zone */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-telivity-orange/20 space-y-4">
            <h2 className="text-sm font-semibold text-telivity-navy">{t('common.actions')}</h2>

            {guest.isDnr && (
              <div className="p-3 bg-red-50 rounded-lg border border-red-100 text-xs text-red-800 space-y-1">
                <p className="font-bold flex items-center gap-1"><AlertTriangle size={14} /> {t('guests.dnrFlagged')}</p>
                {guest.dnrReason && <p>{t('guests.dnrReasonLabel')}: {guest.dnrReason}</p>}
                {guest.dnrDate && <p>{t('guests.dnrDateLabel')}: {new Date(guest.dnrDate).toLocaleDateString(i18n.language || 'pt-BR')}</p>}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={() => { if (confirm(t(guest.isDnr ? 'guests.dnrConfirmRemove' : 'guests.dnrConfirmAdd', { name: `${guest.firstName} ${guest.lastName}` }))) dnrMutation.mutate(); }}
                className={`w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${guest.isDnr ? 'bg-telivity-dark-teal text-white' : 'bg-telivity-orange text-white'}`}
              >
                <AlertTriangle size={14} />
                {guest.isDnr ? t('guests.removeDnr') : t('guests.markDnr')}
              </button>
              <button
                onClick={() => setDeleteConfirm(true)}
                className="w-full flex items-center justify-center gap-2 border border-telivity-orange text-telivity-orange rounded-lg px-4 py-2 text-xs font-semibold hover:bg-telivity-orange/5"
              >
                <Trash2 size={14} />
                {t('guests.deleteGuest')}
              </button>
            </div>
          </div>
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
    <div className="flex justify-between items-center py-0.5">
      <span className="text-xs text-telivity-mid-grey">{label}</span>
      <span className="text-xs font-medium text-telivity-navy">{value}</span>
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
