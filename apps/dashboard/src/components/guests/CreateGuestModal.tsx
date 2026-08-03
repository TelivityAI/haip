import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { validateCpf, calculateAge } from '@telivityhaip/shared';
import { api } from '../../lib/api';
import type { ParsedIdDocument } from '../../lib/id-document-swipe';
import { useProperty } from '../../context/PropertyContext';
import Modal from '../ui/Modal';
import IdSwipeCapture from './IdSwipeCapture';
import type { Guest } from '../../types/guest';

export interface CreateGuestModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (newGuest: Guest) => void;
  initialSearchTerm?: string;
}

export default function CreateGuestModal({
  open,
  onClose,
  onSuccess,
  initialSearchTerm = '',
}: CreateGuestModalProps) {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();

  const { data: propertyData } = useQuery({
    queryKey: ['properties', propertyId],
    queryFn: () => api.get(`/v1/properties/${propertyId}`).then((r) => r.data),
    enabled: !!propertyId && open,
  });
  const property = propertyData?.data ?? propertyData;

  const defaultCountry = property?.countryCode ?? 'US';
  const isBR = defaultCountry.toUpperCase() === 'BR';
  const minorGuardianRequired =
    property?.guestRegistrationConfig?.minorGuardianIdentificationRequired ??
    property?.settings?.minorGuardianIdentificationRequired !== false;

  // Complete Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [profession, setProfession] = useState('');
  const [nationality, setNationality] = useState(defaultCountry);

  // Minor & Guardian State
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

  // Synchronize initial search term when modal opens
  useEffect(() => {
    if (open) {
      if (initialSearchTerm.trim()) {
        const parts = initialSearchTerm.trim().split(/\s+/);
        if (parts.length === 1) {
          setFirstName(parts[0]);
          setLastName('');
        } else if (parts.length > 1) {
          setFirstName(parts[0]);
          setLastName(parts.slice(1).join(' '));
        }
      }
      setNationality(defaultCountry);
      setIdCountry(defaultCountry);
      setCountryCode(defaultCountry);
      setIdType(isBR ? 'cpf' : 'passport');
    }
  }, [open, initialSearchTerm, defaultCountry, isBR]);

  const age = calculateAge(dateOfBirth);
  const isMinor = age !== null && age < 18;

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setDateOfBirth('');
    setGender('');
    setProfession('');
    setNationality(defaultCountry);
    setGuardianName('');
    setGuardianTaxId('');
    setGuardianPhone('');
    setGuardianRelationship('parent');
    setHasMinorAuthorization(false);
    setTaxId('');
    setIdType(isBR ? 'cpf' : 'passport');
    setIdNumber('');
    setIdIssuer('');
    setIdIssuerState('');
    setIdCountry(defaultCountry);
    setIdExpiry('');
    setAddressLine1('');
    setAddressLine2('');
    setNeighborhood('');
    setCity('');
    setStateProvince('');
    setPostalCode('');
    setCountryCode(defaultCountry);
    setVipLevel('none');
    setLoyaltyNumber('');
    setCompanyName('');
    setNotes('');
    setGdprConsentMarketing(false);
  };

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
        registrationData: {
          ...(idIssuer || idIssuerState || neighborhood
            ? { idIssuer, idIssuerState, neighborhood }
            : {}),
          ...(isMinor
            ? {
              isMinor: true,
              guardianName: guardianName || undefined,
              guardianTaxId: guardianTaxId || undefined,
              guardianPhone: guardianPhone || undefined,
              guardianRelationship: guardianRelationship || 'parent',
              hasMinorAuthorization,
            }
            : {}),
        },
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      const createdGuest = res.data?.data ?? res.data;
      resetForm();
      if (onSuccess) {
        onSuccess(createdGuest);
      }
      onClose();
    },
  });

  const isCpfValid = taxId ? validateCpf(taxId) : true;
  const isGuardianCpfValid = guardianTaxId ? validateCpf(guardianTaxId) : true;

  function applyIdSwipe(doc: ParsedIdDocument) {
    if (doc.firstName) setFirstName(doc.firstName);
    if (doc.lastName) setLastName(doc.lastName);
    if (doc.dateOfBirth) setDateOfBirth(doc.dateOfBirth);
    if (doc.gender) setGender(doc.gender);
    if (doc.nationality) setNationality(doc.nationality);
    if (doc.idType) setIdType(doc.idType);
    if (doc.idNumber) setIdNumber(doc.idNumber);
    if (doc.idCountry) {
      setIdCountry(doc.idCountry);
      setCountryCode(doc.idCountry);
    }
    if (doc.idExpiry) setIdExpiry(doc.idExpiry);
    if (doc.addressLine1) setAddressLine1(doc.addressLine1);
    if (doc.city) setCity(doc.city);
    if (doc.stateProvince) setStateProvince(doc.stateProvince);
    if (doc.postalCode) setPostalCode(doc.postalCode);
  }

  return (
    <Modal open={open} onClose={onClose} title={t('guests.newGuest')} wide>
      <div className="space-y-6">
        <IdSwipeCapture active={open} onParsed={applyIdSwipe} />

        {/* Section 1: Personal Details */}
        <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
          <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">
            {t('guests.sections.personal')}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.firstName')} *
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={`Ex: ${t('guests.placeholders.firstName')}`}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.lastName')} *
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={`Ex: ${t('guests.placeholders.lastName')}`}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('common.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('guests.placeholders.email')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('common.phone')}
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('guests.placeholders.phone')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1 flex items-center justify-between">
                <span>{t('guests.labels.dateOfBirth')}</span>
                {age !== null && (
                  <span
                    className={`text-[11px] font-bold ${isMinor ? 'text-purple-700' : 'text-slate-500'}`}
                  >
                    {t('guests.ageYears', { age })}{' '}
                    {isMinor ? `(${t('guests.minorBadgeShort')})` : ''}
                  </span>
                )}
              </label>
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none bg-white ${isMinor
                  ? 'border-purple-300 focus:border-purple-600'
                  : 'border-gray-200 focus:border-telivity-teal'
                  }`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.gender')}
              </label>
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
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.labels.nationality')}
              </label>
              <input
                type="text"
                maxLength={2}
                value={nationality}
                onChange={(e) => setNationality(e.target.value.toUpperCase())}
                placeholder={defaultCountry}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
          </div>

          {/* GUARDIAN BLOCK WHEN MINOR DETECTED */}
          {isMinor && (
            <div className="p-4 bg-purple-50 rounded-xl border border-purple-200 space-y-3.5 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                  <ShieldAlert size={16} className="text-purple-600" />{' '}
                  {t('guests.guardian.title', { age })}{' '}
                  {minorGuardianRequired ? '*' : ''}
                </span>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${minorGuardianRequired
                    ? 'text-purple-800 bg-purple-100 border border-purple-200'
                    : 'text-slate-700 bg-slate-100'
                    }`}
                >
                  {minorGuardianRequired
                    ? t('guests.guardian.badgeRequired')
                    : t('guests.guardian.badgeOptional')}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-purple-900 mb-1">
                    {t('guests.guardian.name')}{' '}
                    {minorGuardianRequired ? '*' : ''}
                  </label>
                  <input
                    type="text"
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                    placeholder={t('guests.guardian.namePlaceholder')}
                    className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-600 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-purple-900 mb-1 flex items-center justify-between">
                    <span>
                      {t('guests.guardian.taxId')}{' '}
                      {minorGuardianRequired ? '*' : ''}
                    </span>
                    {isBR && guardianTaxId && (
                      <span
                        className={`text-[10px] font-semibold ${isGuardianCpfValid
                          ? 'text-green-700'
                          : 'text-amber-700'
                          }`}
                      >
                        {isGuardianCpfValid
                          ? t('guests.guardian.validCpf')
                          : t('guests.guardian.invalidCpf')}
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={guardianTaxId}
                    onChange={(e) => setGuardianTaxId(e.target.value)}
                    placeholder={t('guests.placeholders.taxId')}
                    className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-600 bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-purple-900 mb-1">
                    {t('guests.guardian.phone')}
                  </label>
                  <input
                    type="tel"
                    value={guardianPhone}
                    onChange={(e) => setGuardianPhone(e.target.value)}
                    placeholder={t('guests.placeholders.phone')}
                    className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-600 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-purple-900 mb-1">
                    {t('guests.guardian.relationship')}
                  </label>
                  <select
                    value={guardianRelationship}
                    onChange={(e) => setGuardianRelationship(e.target.value)}
                    className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-600 bg-white font-medium"
                  >
                    <option value="parent">
                      {t('guests.guardian.relationshipOptions.parent')}
                    </option>
                    <option value="legal_guardian">
                      {t('guests.guardian.relationshipOptions.legal_guardian')}
                    </option>
                    <option value="authorized_adult">
                      {t('guests.guardian.relationshipOptions.authorized_adult')}
                    </option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-purple-950 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasMinorAuthorization}
                  onChange={(e) => setHasMinorAuthorization(e.target.checked)}
                  className="rounded border-purple-300 text-purple-600 focus:ring-purple-600"
                />
                {t('guests.guardian.authorizationCheckbox')}
              </label>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
              {t('guests.profession')}
            </label>
            <input
              type="text"
              value={profession}
              onChange={(e) => setProfession(e.target.value)}
              placeholder={t('guests.placeholders.profession')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
            />
          </div>
        </div>

        {/* Section 2: Identification */}
        <div className="p-4 bg-telivity-teal/5 rounded-xl border border-telivity-teal/10 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-telivity-teal uppercase tracking-wider">
              {isBR
                ? t('guests.sections.identificationFnrh')
                : t('guests.sections.identification')}
            </h3>
            {isBR && (idType === 'cpf' ? taxId : taxId || idNumber) && (
              <span
                className={`text-xs font-medium ${(idType === 'cpf' ? taxId : taxId)
                  ? isCpfValid
                    ? 'text-green-700'
                    : 'text-amber-700'
                  : 'text-telivity-mid-grey'
                  }`}
              >
                {taxId
                  ? isCpfValid
                    ? t('guests.guardian.validCpf')
                    : t('guests.guardian.invalidCpf')
                  : ''}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.labels.idType')} *
              </label>
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
                {isBR && (
                  <option value="cpf">{t('guests.idTypeOptions.cpf')}</option>
                )}
                {isBR && (
                  <option value="rg">{t('guests.idTypeOptions.rg')}</option>
                )}
                <option value="passport">{t('frontDesk.passport')}</option>
                <option value="drivers_license">
                  {t('frontDesk.driversLicense')}
                </option>
                <option value="national_id">{t('frontDesk.nationalId')}</option>
                {!isBR && (
                  <option value="tax_id">{t('guests.labels.taxId')}</option>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {idType === 'cpf'
                  ? 'CPF'
                  : idType === 'rg'
                    ? 'RG'
                    : idType === 'passport'
                      ? t('frontDesk.passport')
                      : idType === 'drivers_license'
                        ? t('frontDesk.driversLicense')
                        : t('guests.labels.taxId')}{' '}
                *
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
                  idType === 'cpf'
                    ? '000.000.000-00'
                    : idType === 'rg'
                      ? '00.000.000-0'
                      : idType === 'passport'
                        ? 'A12345678'
                        : t('guests.placeholders.taxId')
                }
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white ${idType === 'cpf' && taxId && !isCpfValid
                  ? 'border-amber-300'
                  : 'border-gray-200'
                  }`}
              />
            </div>
          </div>

          {idType !== 'cpf' && isBR && (
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.labels.cpfOptional')}
              </label>
              <input
                type="text"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="000.000.000-00"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
          )}

          {/* SHOW RG ISSUER ONLY FOR BRAZIL */}
          {isBR && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                  {t('guests.idIssuer')}
                </label>
                <input
                  type="text"
                  value={idIssuer}
                  onChange={(e) => setIdIssuer(e.target.value)}
                  placeholder={t('guests.placeholders.idIssuer')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                  {t('guests.idIssuerState')}
                </label>
                <input
                  type="text"
                  maxLength={2}
                  value={idIssuerState}
                  onChange={(e) =>
                    setIdIssuerState(e.target.value.toUpperCase())
                  }
                  placeholder={t('guests.placeholders.idIssuerState')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.labels.idCountry')}
              </label>
              <input
                type="text"
                maxLength={2}
                value={idCountry}
                onChange={(e) => setIdCountry(e.target.value.toUpperCase())}
                placeholder={defaultCountry}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.labels.idExpiry')}
              </label>
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
            {t('guests.sections.address')}
          </h3>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
              {t('guests.labels.addressLine1')}
            </label>
            <input
              type="text"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder={`Ex: ${t('guests.placeholders.address')}`}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
            />
          </div>

          <div
            className={`grid ${isBR ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}
          >
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.labels.addressLine2')}
              </label>
              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder={t('guests.placeholders.addressLine2')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
            {isBR && (
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                  {t('guests.neighborhood')}
                </label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder={t('guests.placeholders.neighborhood')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.labels.city')}
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={t('guests.placeholders.city')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.labels.state')}
              </label>
              <input
                type="text"
                maxLength={isBR ? 2 : 50}
                value={stateProvince}
                onChange={(e) =>
                  setStateProvince(
                    isBR ? e.target.value.toUpperCase() : e.target.value
                  )
                }
                placeholder={t('guests.placeholders.state')}
                className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white ${isBR ? 'uppercase' : ''
                  }`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.labels.postalCode')}
              </label>
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder={t('guests.placeholders.postalCode')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
              {t('guests.labels.countryCode')}
            </label>
            <input
              type="text"
              maxLength={2}
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              placeholder={defaultCountry}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-telivity-teal bg-white"
            />
          </div>
        </div>

        {/* Section 4: Preferences, VIP & Governance */}
        <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
          <h3 className="text-xs font-semibold text-telivity-navy uppercase tracking-wider">
            {t('guests.sections.preferences')}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.vipLevel')}
              </label>
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
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('guests.loyaltyNumber')}
              </label>
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
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
              {t('guests.company')}
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={t('guests.company')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
              {t('guests.labels.notes')}
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('guests.placeholders.notes')}
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
            {t('guests.marketingConsent')} (LGPD/GDPR)
          </label>
        </div>

        {isMinor && minorGuardianRequired && (!guardianName || !guardianTaxId) && (
          <p className="text-xs text-purple-700 font-semibold bg-purple-100 p-2.5 rounded-lg border border-purple-200">
            {t('guests.guardian.fillRequiredNotice')}
          </p>
        )}

        <button
          onClick={() => createMutation.mutate()}
          disabled={
            !firstName ||
            !lastName ||
            (isMinor &&
              minorGuardianRequired &&
              (!guardianName || !guardianTaxId)) ||
            createMutation.isPending
          }
          className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-telivity-light-teal disabled:opacity-50 transition-colors"
        >
          {createMutation.isPending
            ? t('common.creating')
            : t('guests.createGuest')}
        </button>
      </div>
    </Modal>
  );
}
