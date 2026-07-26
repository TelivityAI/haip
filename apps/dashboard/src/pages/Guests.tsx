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
  Calendar,
  MapPin,
  CreditCard,
  Building2,
  Globe,
  FileText,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Award,
  Briefcase,
  User,
} from 'lucide-react';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';

function validateCpf(cpfRaw: string): boolean {
  if (!cpfRaw) return false;
  const clean = cpfRaw.replace(/\D/g, '');
  if (clean.length !== 11 || /^(\d)\1{10}$/.test(clean)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(clean[i], 10) * (10 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  if (rem !== parseInt(clean[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(clean[i], 10) * (11 - i);
  rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  return rem === parseInt(clean[10], 10);
}

function formatCpf(cpfRaw: string): string {
  if (!cpfRaw) return '—';
  const clean = cpfRaw.replace(/\D/g, '');
  if (clean.length !== 11) return cpfRaw;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
}

interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  vipLevel?: string;
  isDnr?: boolean;
  dnrReason?: string;
  dnrDate?: string;
  totalStays?: number;
  lastVisit?: string;
  preferences?: Record<string, unknown>;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  companyName?: string;
  idType?: string;
  idNumber?: string;
  idCountry?: string;
  idExpiry?: string;
  gender?: string;
  profession?: string;
  taxId?: string;
  registrationData?: Record<string, any>;
  gdprConsentMarketing?: boolean;
  gdprConsentDate?: string;
  loyaltyNumber?: string;
  dateOfBirth?: string;
  nationality?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  countryCode?: string;
}

function checkFnrhComplete(g: Guest): boolean {
  const reg = (g.registrationData as Record<string, any>) || {};
  return Boolean(
    g.firstName &&
    g.lastName &&
    (g.taxId || g.idNumber) &&
    (g.gender || reg.gender)
  );
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

  // Complete Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [profession, setProfession] = useState('');
  const [nationality, setNationality] = useState('BR');

  const [taxId, setTaxId] = useState('');
  const [idType, setIdType] = useState('cpf');
  const [idNumber, setIdNumber] = useState('');
  const [idIssuer, setIdIssuer] = useState('');
  const [idIssuerState, setIdIssuerState] = useState('');
  const [idCountry, setIdCountry] = useState('BR');
  const [idExpiry, setIdExpiry] = useState('');

  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [stateProvince, setStateProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [countryCode, setCountryCode] = useState('BR');

  const [vipLevel, setVipLevel] = useState('none');
  const [loyaltyNumber, setLoyaltyNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [notes, setNotes] = useState('');
  const [gdprConsentMarketing, setGdprConsentMarketing] = useState(false);

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
        companyName: companyName || undefined,
        loyaltyNumber: loyaltyNumber || undefined,
        notes: notes || undefined,
        gdprConsentMarketing,
        registrationData: (idIssuer || idIssuerState || neighborhood) ? { idIssuer, idIssuerState, neighborhood } : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setCreateOpen(false);
      // Reset form
      setFirstName(''); setLastName(''); setEmail(''); setPhone(''); setDateOfBirth(''); setGender(''); setProfession(''); setNationality('BR');
      setTaxId(''); setIdType('cpf'); setIdNumber(''); setIdIssuer(''); setIdIssuerState(''); setIdCountry('BR'); setIdExpiry('');
      setAddressLine1(''); setAddressLine2(''); setNeighborhood(''); setCity(''); setStateProvince(''); setPostalCode(''); setCountryCode('BR');
      setVipLevel('none'); setLoyaltyNumber(''); setCompanyName(''); setNotes(''); setGdprConsentMarketing(false);
    },
  });

  const isCpfValid = taxId ? validateCpf(taxId) : true;

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
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.taxId')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">VIP</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.loyaltyNumber')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.fnrhStatus')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('guests.flags')}</th>
            </tr>
          </thead>
          <tbody>
            {guests.map((g, i) => {
              const isFnrhOk = checkFnrhComplete(g);
              return (
                <tr
                  key={g.id}
                  className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-telivity-light-grey/50 transition-colors cursor-pointer`}
                  onClick={() => navigate(`/guests/${g.id}`)}
                >
                  <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{g.firstName} {g.lastName}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{g.email ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{g.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate font-mono">{g.taxId ? formatCpf(g.taxId) : (g.idNumber ?? '—')}</td>
                  <td className="px-4 py-3">
                    {g.vipLevel && g.vipLevel !== 'none' ? <StatusBadge status={g.vipLevel} /> : <span className="text-sm text-telivity-mid-grey">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{g.loyaltyNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">
                    {isFnrhOk ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                        {t('guests.fnrhComplete')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                        {t('guests.fnrhIncomplete')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {g.isDnr && <StatusBadge status="error" label="DNR" />}
                  </td>
                </tr>
              );
            })}
            {guests.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('guests.noGuestsFound')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* COMPLETE NEW GUEST MODAL — SINGLE SCROLLBAR */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('guests.newGuest')} wide>
        <div className="space-y-6">
          {/* Section 1: Personal Details */}
          <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
            <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">
              1. Dados Pessoais & Contato
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.firstName')} *</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Ex: Carlos"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.lastName')} *</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Ex: Silva"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('common.email')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="hospede@email.com"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('common.phone')}</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+55 (11) 99999-9999"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Data de Nascimento</label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.gender')}</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                >
                  <option value="">{t('guests.none')}</option>
                  <option value="male">{t('guests.genderOptions.male')}</option>
                  <option value="female">{t('guests.genderOptions.female')}</option>
                  <option value="other">{t('guests.genderOptions.other')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Nacionalidade (ISO)</label>
                <input
                  type="text"
                  maxLength={2}
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value.toUpperCase())}
                  placeholder="BR"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.profession')} (Profissão FNRH)</label>
              <input
                type="text"
                value={profession}
                onChange={(e) => setProfession(e.target.value)}
                placeholder="Ex: Engenheiro, Médico..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
          </div>

          {/* Section 2: Identification & FNRH */}
          <div className="p-4 bg-telivity-teal/5 rounded-xl border border-telivity-teal/10 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-telivity-teal uppercase tracking-wider">
                2. Documento de Identificação & FNRH (Embratur)
              </h3>
              {(idType === 'cpf' ? taxId : (taxId || idNumber)) && (
                <span className={`text-xs font-medium ${(idType === 'cpf' ? taxId : taxId) ? (isCpfValid ? 'text-green-700' : 'text-amber-700') : 'text-telivity-mid-grey'}`}>
                  {taxId ? (isCpfValid ? '✓ CPF Válido' : '⚠️ CPF inválido') : ''}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Tipo de Documento *</label>
                <select
                  value={idType}
                  onChange={(e) => {
                    const newType = e.target.value;
                    setIdType(newType);
                    if (newType === 'cpf' && !taxId && idNumber) {
                      setTaxId(idNumber);
                    }
                  }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                >
                  <option value="cpf">CPF (Cadastro de Pessoas Físicas)</option>
                  <option value="rg">RG (Carteira de Identidade)</option>
                  <option value="passport">{t('frontDesk.passport')}</option>
                  <option value="drivers_license">{t('frontDesk.driversLicense')}</option>
                  <option value="national_id">{t('frontDesk.nationalId')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                  {idType === 'cpf' ? 'CPF (Documento de Identificação)' :
                   idType === 'rg' ? 'RG (Carteira de Identidade)' :
                   idType === 'passport' ? 'Número do Passaporte' :
                   idType === 'drivers_license' ? 'Número da CNH' :
                   'Documento de Identificação'} *
                </label>
                <input
                  type="text"
                  value={idType === 'cpf' ? taxId : idNumber}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (idType === 'cpf') {
                      setTaxId(val);
                      setIdNumber(val);
                    } else {
                      setIdNumber(val);
                    }
                  }}
                  placeholder={
                    idType === 'cpf' ? '000.000.000-00' :
                    idType === 'rg' ? '00.000.000-0' :
                    idType === 'passport' ? 'EX123456' :
                    idType === 'drivers_license' ? '00000000000' :
                    'Número do documento'
                  }
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white ${
                    idType === 'cpf' && taxId && !isCpfValid ? 'border-amber-300' : 'border-gray-200'
                  }`}
                />
              </div>
            </div>

            {idType !== 'cpf' && (
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">CPF / Tax ID (Opcional)</label>
                <input
                  type="text"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="000.000.000-00"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.idIssuer')} (Órgão Expedidor)</label>
                <input
                  type="text"
                  value={idIssuer}
                  onChange={(e) => setIdIssuer(e.target.value)}
                  placeholder="SSP, DETRAN..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.idIssuerState')} (UF Expedidora)</label>
                <input
                  type="text"
                  maxLength={2}
                  value={idIssuerState}
                  onChange={(e) => setIdIssuerState(e.target.value.toUpperCase())}
                  placeholder="SP"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">País Emissor (ISO)</label>
                <input
                  type="text"
                  maxLength={2}
                  value={idCountry}
                  onChange={(e) => setIdCountry(e.target.value.toUpperCase())}
                  placeholder="BR"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Validade do Documento</label>
                <input
                  type="date"
                  value={idExpiry}
                  onChange={(e) => setIdExpiry(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Complete Address */}
          <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
            <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">
              3. Endereço Residencial
            </h3>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Logradouro / Endereço (Linha 1)</label>
              <input
                type="text"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="Ex: Av. Paulista, 1000"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Complemento (Linha 2)</label>
                <input
                  type="text"
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                  placeholder="Apto 42, Bloco B"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.neighborhood')} (Bairro FNRH)</label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="Bela Vista"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Cidade</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="São Paulo"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Estado / UF</label>
                <input
                  type="text"
                  maxLength={2}
                  value={stateProvince}
                  onChange={(e) => setStateProvince(e.target.value.toUpperCase())}
                  placeholder="SP"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">CEP</label>
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="01310-100"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">País de Residência (ISO)</label>
              <input
                type="text"
                maxLength={2}
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                placeholder="BR"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
          </div>

          {/* Section 4: Preferences, VIP & Governance */}
          <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
            <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">
              4. Preferências, Empresa & Fidelidade
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.vipLevel')}</label>
                <select
                  value={vipLevel}
                  onChange={(e) => setVipLevel(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                >
                  <option value="none">{t('guests.none')}</option>
                  <option value="gold">Gold</option>
                  <option value="platinum">Platinum</option>
                  <option value="diamond">Diamond</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.loyaltyNumber')}</label>
                <input
                  type="text"
                  value={loyaltyNumber}
                  onChange={(e) => setLoyaltyNumber(e.target.value)}
                  placeholder="HAIP-1234"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('guests.company')}</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Empresa Ltda"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Observações Internas</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Preferências de quarto, restrições..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-telivity-navy pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={gdprConsentMarketing}
                onChange={(e) => setGdprConsentMarketing(e.target.checked)}
                className="rounded border-gray-300 text-telivity-teal focus:ring-telivity-teal"
              />
              {t('guests.marketingConsent')} (LGPD)
            </label>
          </div>

          <button
            onClick={() => createMutation.mutate()}
            disabled={!firstName || !lastName || createMutation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-telivity-light-teal disabled:opacity-50 transition-colors"
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
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [profession, setProfession] = useState('');
  const [nationality, setNationality] = useState('BR');

  const [taxId, setTaxId] = useState('');
  const [idType, setIdType] = useState('cpf');
  const [idNumber, setIdNumber] = useState('');
  const [idIssuer, setIdIssuer] = useState('');
  const [idIssuerState, setIdIssuerState] = useState('');
  const [idCountry, setIdCountry] = useState('BR');
  const [idExpiry, setIdExpiry] = useState('');

  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [stateProvince, setStateProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [countryCode, setCountryCode] = useState('BR');

  const [vipLevel, setVipLevel] = useState('none');
  const [loyaltyNumber, setLoyaltyNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [notes, setNotes] = useState('');
  const [gdprConsentMarketing, setGdprConsentMarketing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

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
        registrationData: (idIssuer || idIssuerState || neighborhood) ? { idIssuer, idIssuerState, neighborhood } : undefined,
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
    setNationality(guest.nationality ?? 'BR');

    setTaxId(guest.taxId ?? '');
    setIdType(guest.idType ?? 'cpf');
    setIdNumber(guest.idNumber ?? '');
    setIdIssuer(reg.idIssuer ?? '');
    setIdIssuerState(reg.idIssuerState ?? '');
    setIdCountry(guest.idCountry ?? 'BR');
    setIdExpiry(guest.idExpiry ? guest.idExpiry.slice(0, 10) : '');

    setAddressLine1(guest.addressLine1 ?? '');
    setAddressLine2(guest.addressLine2 ?? '');
    setNeighborhood(reg.neighborhood ?? '');
    setCity(guest.city ?? '');
    setStateProvince(guest.stateProvince ?? '');
    setPostalCode(guest.postalCode ?? '');
    setCountryCode(guest.countryCode ?? 'BR');

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
  const isFnrhOk = checkFnrhComplete(guest);

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
        {/* Profile Card & Complete Data */}
        <div className="bg-white rounded-xl shadow-sm p-6 lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between border-b border-gray-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-telivity-navy">{t('guests.profile')}</h2>
              <p className="text-xs text-telivity-mid-grey">Ficha completa e dados cadastrais no banco de dados</p>
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
                <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="px-4 py-1.5 bg-telivity-teal text-white text-xs font-semibold rounded-lg hover:bg-telivity-light-teal disabled:opacity-50">
                  {updateMutation.isPending ? t('common.saving') : t('common.save')}
                </button>
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-6">
              {/* Edit Section 1 */}
              <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
                <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">1. Dados Pessoais</h3>
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Nome" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Sobrenome" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  <select value={gender} onChange={(e) => setGender(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white">
                    <option value="">{t('guests.gender')}</option>
                    <option value="male">{t('guests.genderOptions.male')}</option>
                    <option value="female">{t('guests.genderOptions.female')}</option>
                    <option value="other">{t('guests.genderOptions.other')}</option>
                  </select>
                  <input type="text" maxLength={2} value={nationality} onChange={(e) => setNationality(e.target.value.toUpperCase())} placeholder="Nacionalidade (ISO)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <input type="text" value={profession} onChange={(e) => setProfession(e.target.value)} placeholder="Profissão FNRH" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
              </div>

              {/* Edit Section 2 */}
              <div className="p-4 bg-telivity-teal/5 rounded-xl border border-telivity-teal/10 space-y-3">
                <h3 className="text-xs font-semibold text-telivity-teal uppercase tracking-wider">2. Documento de Identificação</h3>
                <div className="grid grid-cols-2 gap-3">
                  <select value={idType} onChange={(e) => setIdType(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white">
                    <option value="cpf">CPF (Cadastro de Pessoas Físicas)</option>
                    <option value="rg">RG (Carteira de Identidade)</option>
                    <option value="passport">Passaporte</option>
                    <option value="drivers_license">CNH</option>
                    <option value="national_id">Documento Nacional</option>
                  </select>
                  <input type="text" value={idType === 'cpf' ? taxId : idNumber} onChange={(e) => idType === 'cpf' ? setTaxId(e.target.value) : setIdNumber(e.target.value)} placeholder="Número do Documento" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                {idType !== 'cpf' && (
                  <input type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="CPF (Opcional)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={idIssuer} onChange={(e) => setIdIssuer(e.target.value)} placeholder="Órgão Expedidor (SSP)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="text" maxLength={2} value={idIssuerState} onChange={(e) => setIdIssuerState(e.target.value.toUpperCase())} placeholder="UF Expedidora" className="border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" maxLength={2} value={idCountry} onChange={(e) => setIdCountry(e.target.value.toUpperCase())} placeholder="País Emissor (ISO)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="date" value={idExpiry} onChange={(e) => setIdExpiry(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
              </div>

              {/* Edit Section 3 */}
              <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
                <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">3. Endereço</h3>
                <input type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Logradouro / Endereço" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="Complemento" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="text" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Bairro FNRH" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cidade" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="text" maxLength={2} value={stateProvince} onChange={(e) => setStateProvince(e.target.value.toUpperCase())} placeholder="UF" className="border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white" />
                  <input type="text" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="CEP" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <input type="text" maxLength={2} value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} placeholder="País de Residência (ISO)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white" />
              </div>

              {/* Edit Section 4 */}
              <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
                <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">4. Preferências & Governança</h3>
                <div className="grid grid-cols-2 gap-3">
                  <select value={vipLevel} onChange={(e) => setVipLevel(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white">
                    <option value="none">{t('guests.none')}</option>
                    <option value="gold">Gold</option>
                    <option value="platinum">Platinum</option>
                    <option value="diamond">Diamond</option>
                  </select>
                  <input type="text" value={loyaltyNumber} onChange={(e) => setLoyaltyNumber(e.target.value)} placeholder="Nº Fidelidade" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                </div>
                <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Empresa" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações Internas" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white" />
                <label className="flex items-center gap-2 text-xs text-telivity-navy">
                  <input type="checkbox" checked={gdprConsentMarketing} onChange={(e) => setGdprConsentMarketing(e.target.checked)} className="rounded border-gray-300" />
                  Consentimento Marketing (LGPD)
                </label>
              </div>
            </div>
          ) : (
            /* Read View - ALL Database Fields Organized */
            <div className="space-y-6">
              {/* Group 1: Personal Details */}
              <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100 space-y-2">
                <h3 className="text-xs font-bold text-telivity-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <User size={14} className="text-telivity-teal" /> Dados Pessoais & Contato
                </h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <DetailRow label={t('common.email')} value={guest.email ?? '—'} />
                  <DetailRow label={t('common.phone')} value={guest.phone ?? '—'} />
                  <DetailRow label="Data de Nascimento" value={guest.dateOfBirth ? new Date(guest.dateOfBirth).toLocaleDateString('pt-BR') : '—'} />
                  <DetailRow label={t('guests.gender')} value={guest.gender ? (t(`guests.genderOptions.${guest.gender}`, { defaultValue: guest.gender })) : '—'} />
                  <DetailRow label="Nacionalidade" value={guest.nationality ?? 'BR'} />
                  <DetailRow label={t('guests.profession')} value={guest.profession ?? '—'} />
                </div>
              </div>

              {/* Group 2: Document & FNRH */}
              <div className="bg-telivity-teal/5 p-4 rounded-xl border border-telivity-teal/10 space-y-2">
                <h3 className="text-xs font-bold text-telivity-teal uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CreditCard size={14} /> Identificação & Ficha FNRH (Embratur)
                </h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <DetailRow label={t('guests.taxId')} value={guest.taxId ? formatCpf(guest.taxId) : '—'} />
                  <DetailRow label="Tipo de Documento" value={guest.idType ? guest.idType.toUpperCase() : '—'} />
                  <DetailRow label="Número do Documento" value={guest.idNumber ?? '—'} />
                  <DetailRow label="Órgão Expedidor / UF" value={`${regData.idIssuer ?? '—'} / ${regData.idIssuerState ?? '—'}`} />
                  <DetailRow label="País Emissor" value={guest.idCountry ?? 'BR'} />
                  <DetailRow label="Validade do Documento" value={guest.idExpiry ? new Date(guest.idExpiry).toLocaleDateString('pt-BR') : '—'} />
                  <DetailRow label="Status FNRH" value={isFnrhOk ? t('guests.fnrhComplete') : t('guests.fnrhIncomplete')} />
                </div>
              </div>

              {/* Group 3: Complete Address */}
              <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100 space-y-2">
                <h3 className="text-xs font-bold text-telivity-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MapPin size={14} className="text-telivity-teal" /> Endereço Residencial
                </h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <DetailRow label="Logradouro" value={guest.addressLine1 ?? '—'} />
                  <DetailRow label="Complemento" value={guest.addressLine2 ?? '—'} />
                  <DetailRow label="Bairro (FNRH)" value={regData.neighborhood ?? '—'} />
                  <DetailRow label="Cidade / UF" value={`${guest.city ?? '—'} - ${guest.stateProvince ?? '—'}`} />
                  <DetailRow label="CEP" value={guest.postalCode ?? '—'} />
                  <DetailRow label="País de Residência" value={guest.countryCode ?? 'BR'} />
                </div>
              </div>

              {/* Group 4: Profile, VIP & LGPD */}
              <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-100 space-y-2">
                <h3 className="text-xs font-bold text-telivity-navy uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-telivity-teal" /> Preferências, Governança & LGPD
                </h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <DetailRow label={t('guests.vipLevel')} value={guest.vipLevel ?? t('guests.none')} />
                  <DetailRow label={t('guests.loyaltyNumber')} value={guest.loyaltyNumber ?? '—'} />
                  <DetailRow label={t('guests.company')} value={guest.companyName ?? '—'} />
                  <DetailRow label="Consentimento LGPD" value={guest.gdprConsentMarketing ? 'Autorizado' : 'Não autorizado'} />
                  {guest.gdprConsentDate && <DetailRow label="Data Consentimento" value={new Date(guest.gdprConsentDate).toLocaleDateString('pt-BR')} />}
                  <DetailRow label="Data de Cadastro" value={guest.createdAt ? new Date(guest.createdAt).toLocaleDateString('pt-BR') : '—'} />
                  <DetailRow label="Última Atualização" value={guest.updatedAt ? new Date(guest.updatedAt).toLocaleDateString('pt-BR') : '—'} />
                </div>
                {guest.notes && (
                  <div className="mt-3 border-t border-gray-200/60 pt-2">
                    <span className="text-xs text-telivity-mid-grey block font-medium">Observações Internas:</span>
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
                      <p className="text-[11px] text-telivity-mid-grey">{s.arrivalDate} → {s.departureDate} {s.roomNumber ? `• Quarto ${s.roomNumber}` : ''}</p>
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
                <p className="font-bold flex items-center gap-1"><AlertTriangle size={14} /> Hóspede Marcado como DNR</p>
                {guest.dnrReason && <p>Motivo: {guest.dnrReason}</p>}
                {guest.dnrDate && <p>Data: {new Date(guest.dnrDate).toLocaleDateString('pt-BR')}</p>}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={() => { if (confirm(`${guest.isDnr ? 'Remover' : 'Adicionar'} flag DNR para ${guest.firstName} ${guest.lastName}?`)) dnrMutation.mutate(); }}
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
