import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Copy, Image as ImageIcon, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../ui/Toast';
import MediaGallery from '../media/MediaGallery';
import BookingQuestionBuilder from './BookingQuestionBuilder';
import { bookingQuestionsAreValid, type BookingFormQuestion } from './booking-request-config';

type DepositType = 'none' | 'first_night' | 'percentage' | 'full';
type BookingMode = 'instant' | 'request';
type PaymentMethodCollection = 'required' | 'optional' | 'disabled';

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
  bookingMode?: BookingMode;
  paymentMethodCollection?: PaymentMethodCollection;
  formQuestions?: BookingFormQuestion[];
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

interface RoomType { id: string; name: string; code: string }
interface RatePlan { id: string; name: string; code: string }

interface BookingEngineFormState {
  isEnabled: boolean;
  displayName: string;
  logoMediaId: string | null;
  primaryColor: string;
  accentColor: string;
  sellableRoomTypeIds: string[];
  sellableRatePlanIds: string[];
  depositPolicy: DepositPolicy;
  autoConfirm: boolean;
  stripePublishableKey: string;
  bookingMode: BookingMode;
  paymentMethodCollection: PaymentMethodCollection;
  formQuestions: BookingFormQuestion[];
}

interface BookingEngineUpdatePayload {
  isEnabled: boolean;
  displayName: string | null;
  logoMediaId: string | null;
  primaryColor: string;
  accentColor: string;
  sellableRoomTypeIds: string[];
  sellableRatePlanIds: string[];
  depositPolicy: DepositPolicy;
  autoConfirm: boolean;
  stripePublishableKey: string | null;
  bookingMode: BookingMode;
  paymentMethodCollection: PaymentMethodCollection;
  formQuestions: BookingFormQuestion[];
}

const DEFAULT_DEPOSIT: DepositPolicy = { type: 'none', refundable: true };
const DEFAULT_FORM: BookingEngineFormState = {
  isEnabled: false,
  displayName: '',
  logoMediaId: null,
  primaryColor: '#0d9488',
  accentColor: '#f97316',
  sellableRoomTypeIds: [],
  sellableRatePlanIds: [],
  depositPolicy: DEFAULT_DEPOSIT,
  autoConfirm: false,
  stripePublishableKey: '',
  bookingMode: 'instant',
  paymentMethodCollection: 'disabled',
  formQuestions: [],
};

function cloneQuestions(questions: BookingFormQuestion[]) {
  return questions.map((question) => ({
    id: question.id,
    label: question.label,
    type: question.type,
    ...(question.options ? { options: [...question.options] } : {}),
    order: question.order,
    isActive: question.isActive,
    isRequired: question.isRequired,
  }));
}

function formFromConfig(config: BookingEngineConfig): BookingEngineFormState {
  return {
    isEnabled: config.isEnabled ?? false,
    displayName: config.displayName ?? '',
    logoMediaId: config.logoMediaId ?? null,
    primaryColor: config.primaryColor ?? '#0d9488',
    accentColor: config.accentColor ?? '#f97316',
    sellableRoomTypeIds: [...(config.sellableRoomTypeIds ?? [])],
    sellableRatePlanIds: [...(config.sellableRatePlanIds ?? [])],
    depositPolicy: { ...(config.depositPolicy ?? DEFAULT_DEPOSIT) },
    autoConfirm: config.autoConfirm ?? false,
    stripePublishableKey: config.stripePublishableKey ?? '',
    bookingMode: config.bookingMode ?? 'instant',
    paymentMethodCollection: config.paymentMethodCollection ?? 'disabled',
    formQuestions: cloneQuestions(config.formQuestions ?? []),
  };
}

function cloneForm(form: BookingEngineFormState): BookingEngineFormState {
  return {
    ...form,
    sellableRoomTypeIds: [...form.sellableRoomTypeIds],
    sellableRatePlanIds: [...form.sellableRatePlanIds],
    depositPolicy: { ...form.depositPolicy },
    formQuestions: cloneQuestions(form.formQuestions),
  };
}

function payloadFromForm(form: BookingEngineFormState): BookingEngineUpdatePayload {
  return {
    isEnabled: form.isEnabled,
    displayName: form.displayName || null,
    logoMediaId: form.logoMediaId,
    primaryColor: form.primaryColor,
    accentColor: form.accentColor,
    sellableRoomTypeIds: [...form.sellableRoomTypeIds],
    sellableRatePlanIds: [...form.sellableRatePlanIds],
    depositPolicy: { ...form.depositPolicy },
    autoConfirm: form.autoConfirm,
    stripePublishableKey: form.stripePublishableKey.trim() || null,
    bookingMode: form.bookingMode,
    paymentMethodCollection: form.paymentMethodCollection,
    formQuestions: cloneQuestions(form.formQuestions),
  };
}

function formsEqual(left: BookingEngineFormState, right: BookingEngineFormState) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toggleId(list: string[], id: string) {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export default function BookingEngineSettings({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const configQuery = useQuery({
    queryKey: ['booking-engine', 'config', propertyId],
    queryFn: () => api.get('/v1/admin/booking-engine/config', { params: { propertyId } }).then((response) => response.data),
    enabled: !!propertyId,
  });
  const configData = configQuery.data;
  const config: BookingEngineConfig | undefined = configData?.data ?? configData;
  const [form, setForm] = useState<BookingEngineFormState>(DEFAULT_FORM);
  const [baseline, setBaseline] = useState<BookingEngineFormState | null>(null);
  const formRef = useRef(form);
  const baselineRef = useRef<BookingEngineFormState | null>(null);
  const loadedPropertyRef = useRef<string | null>(null);

  const syncForm = useCallback((next: BookingEngineFormState) => {
    const cloned = cloneForm(next);
    formRef.current = cloned;
    baselineRef.current = cloneForm(cloned);
    loadedPropertyRef.current = propertyId;
    setForm(cloned);
    setBaseline(cloneForm(cloned));
  }, [propertyId]);

  const updateForm = useCallback((update: (current: BookingEngineFormState) => BookingEngineFormState) => {
    const next = update(formRef.current);
    formRef.current = next;
    setForm(next);
  }, []);

  useEffect(() => {
    if (!config) return;
    const canApplyServerState = loadedPropertyRef.current !== propertyId
      || baselineRef.current === null
      || formsEqual(formRef.current, baselineRef.current);
    if (canApplyServerState) syncForm(formFromConfig(config));
  }, [config, propertyId, syncForm]);

  const { data: typesData } = useQuery({
    queryKey: ['rooms', 'types', propertyId],
    queryFn: () => api.get('/v1/rooms/types', { params: { propertyId } }).then((response) => response.data),
    enabled: !!propertyId,
  });
  const { data: ratePlansData } = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.get('/v1/rate-plans', { params: { propertyId } }).then((response) => response.data),
    enabled: !!propertyId,
  });
  const roomTypes: RoomType[] = typesData?.data ?? typesData ?? [];
  const ratePlans: RatePlan[] = ratePlansData?.data ?? ratePlansData ?? [];
  const { data: keysData } = useQuery({
    queryKey: ['booking-engine', 'keys', propertyId],
    queryFn: () => api.get('/v1/admin/booking-engine/keys', { params: { propertyId } }).then((response) => response.data),
    enabled: !!propertyId,
  });
  const keys: PublishableKey[] = keysData?.data ?? keysData ?? [];
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createKey = useMutation({
    mutationFn: (label: string) => api.post('/v1/admin/booking-engine/keys', { label }, { params: { propertyId } }).then((response) => response.data),
    onSuccess: (result) => {
      const created = result?.data ?? result;
      setNewKey(created?.key ?? null);
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ['booking-engine', 'keys', propertyId] });
      toast('success', t('bookingEngine.toasts.keyGenerated'));
    },
    onError: () => toast('error', t('bookingEngine.toasts.keyGenerationFailed')),
  });
  const revokeKey = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/admin/booking-engine/keys/${id}`, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking-engine', 'keys', propertyId] });
      toast('success', t('bookingEngine.toasts.keyRevoked'));
    },
    onError: () => toast('error', t('bookingEngine.toasts.keyRevocationFailed')),
  });
  const saveConfig = useMutation({
    mutationFn: ({ payload }: { payload: BookingEngineUpdatePayload; savedForm: BookingEngineFormState }) => api.patch(
      '/v1/admin/booking-engine/config', payload, { params: { propertyId } },
    ),
    onSuccess: (_result, variables) => {
      syncForm(variables.savedForm);
      queryClient.invalidateQueries({ queryKey: ['booking-engine', 'config', propertyId] });
      toast('success', t('bookingEngine.toasts.settingsSaved'));
    },
    onError: () => toast('error', t('bookingEngine.toasts.settingsSaveFailed')),
  });

  const generateKey = () => {
    const label = window.prompt(t('bookingEngine.promptLabel'));
    if (label?.trim()) createKey.mutate(label.trim());
  };
  const copyKey = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const dirty = baseline !== null && !formsEqual(form, baseline);
  const missingRequiredCardKey = form.bookingMode === 'request'
    && form.paymentMethodCollection === 'required'
    && form.stripePublishableKey.trim().length === 0;
  const questionsValid = bookingQuestionsAreValid(form.formQuestions);
  const save = () => {
    if (!dirty || missingRequiredCardKey || !questionsValid || saveConfig.isPending) return;
    const savedForm = cloneForm(formRef.current);
    saveConfig.mutate({ payload: payloadFromForm(savedForm), savedForm });
  };

  if (configQuery.isError || !config) {
    if (configQuery.isLoading) {
      return <div role="status" className="bg-white rounded-xl shadow-sm p-8 text-center text-sm text-telivity-mid-grey">{t('bookingEngine.requestSettings.loading')}</div>;
    }
    return (
      <div role="alert" className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-telivity-orange mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-telivity-navy">{t('bookingEngine.requestSettings.loadError')}</p>
            <button type="button" onClick={() => configQuery.refetch()} className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-telivity-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-teal rounded">
              <RefreshCw size={14} aria-hidden="true" /> {t('bookingEngine.requestSettings.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (configQuery.isLoading || loadedPropertyRef.current !== propertyId) {
    return <div role="status" className="bg-white rounded-xl shadow-sm p-8 text-center text-sm text-telivity-mid-grey">{t('bookingEngine.requestSettings.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      <fieldset disabled={saveConfig.isPending} className="min-w-0 space-y-4 disabled:opacity-90">
        <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-telivity-navy">{t('bookingEngine.title')}</h2>
              <p className="text-xs text-telivity-mid-grey mt-1">{t('bookingEngine.description')}</p>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
              <span className="text-xs font-medium text-telivity-slate">{form.isEnabled ? t('bookingEngine.enabled') : t('bookingEngine.disabled')}</span>
              <button type="button" role="switch" aria-checked={form.isEnabled} aria-label={t('bookingEngine.requestSettings.engineToggle')} onClick={() => updateForm((current) => ({ ...current, isEnabled: !current.isEnabled }))} className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-teal focus-visible:ring-offset-2 motion-reduce:transition-none ${form.isEnabled ? 'bg-telivity-teal' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform motion-reduce:transition-none ${form.isEnabled ? 'translate-x-5' : ''}`} />
              </button>
            </label>
          </div>

          <div className="border-t border-gray-100 mt-5 pt-5">
            <h3 className="text-sm font-semibold text-telivity-navy">{t('bookingEngine.requestSettings.title')}</h3>
            <p className="text-xs text-telivity-mid-grey mt-1 max-w-2xl">{t('bookingEngine.requestSettings.description')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 max-w-3xl">
              <div>
                <label htmlFor="booking-mode" className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('bookingEngine.requestSettings.bookingMode')}</label>
                <select id="booking-mode" value={form.bookingMode} onChange={(event) => updateForm((current) => ({ ...current, bookingMode: event.target.value as BookingMode }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal focus-visible:ring-2 focus-visible:ring-telivity-teal/20">
                  <option value="instant">{t('bookingEngine.requestSettings.modes.instant')}</option>
                  <option value="request">{t('bookingEngine.requestSettings.modes.request')}</option>
                </select>
                <p className="text-[11px] text-telivity-mid-grey mt-1">{t(`bookingEngine.requestSettings.modeDescriptions.${form.bookingMode}`)}</p>
              </div>
              <div>
                <label htmlFor="card-collection" className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('bookingEngine.requestSettings.cardCollection')}</label>
                <select id="card-collection" value={form.paymentMethodCollection} onChange={(event) => updateForm((current) => ({ ...current, paymentMethodCollection: event.target.value as PaymentMethodCollection }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal focus-visible:ring-2 focus-visible:ring-telivity-teal/20">
                  <option value="disabled">{t('bookingEngine.requestSettings.cardPolicies.disabled')}</option>
                  <option value="optional">{t('bookingEngine.requestSettings.cardPolicies.optional')}</option>
                  <option value="required">{t('bookingEngine.requestSettings.cardPolicies.required')}</option>
                </select>
                <p className="text-[11px] text-telivity-mid-grey mt-1">{t(`bookingEngine.requestSettings.cardDescriptions.${form.paymentMethodCollection}`)}</p>
              </div>
              <div className="md:col-span-2">
                <label htmlFor="stripe-publishable-key" className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('bookingEngine.requestSettings.stripeKey')}</label>
                <input id="stripe-publishable-key" type="text" value={form.stripePublishableKey} onChange={(event) => updateForm((current) => ({ ...current, stripePublishableKey: event.target.value }))} placeholder={t('bookingEngine.requestSettings.stripeKeyPlaceholder')} autoComplete="off" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-telivity-teal focus-visible:ring-2 focus-visible:ring-telivity-teal/20" />
                <p className="text-[11px] text-telivity-mid-grey mt-1">{t('bookingEngine.requestSettings.stripeKeyDescription')}</p>
              </div>
            </div>
            {missingRequiredCardKey && (
              <div role="alert" className="flex items-start gap-2 mt-4 border-l-4 border-telivity-orange bg-telivity-orange/5 rounded-lg px-3 py-2.5 max-w-3xl">
                <AlertTriangle size={16} className="text-telivity-orange shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-xs font-medium text-telivity-navy">{t('bookingEngine.requestSettings.requiredCardWarning')}</p>
              </div>
            )}
          </div>
        </div>

        <BookingQuestionBuilder questions={form.formQuestions} onChange={(formQuestions) => updateForm((current) => ({ ...current, formQuestions }))} disabled={saveConfig.isPending} />
        {!questionsValid && <p role="alert" className="text-xs text-red-600 px-1">{t('bookingEngine.requestSettings.invalidQuestions')}</p>}

        <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-telivity-navy mb-1">{t('bookingEngine.sellableInventory')}</h2>
          <p className="text-xs text-telivity-mid-grey mb-4">{t('bookingEngine.sellableInventoryDescription')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <InventoryList title={t('bookingEngine.roomTypes')} empty={t('bookingEngine.noRoomTypes')} items={roomTypes} selected={form.sellableRoomTypeIds} onToggle={(id) => updateForm((current) => ({ ...current, sellableRoomTypeIds: toggleId(current.sellableRoomTypeIds, id) }))} />
            <InventoryList title={t('bookingEngine.ratePlans')} empty={t('bookingEngine.noRatePlans')} items={ratePlans} selected={form.sellableRatePlanIds} onToggle={(id) => updateForm((current) => ({ ...current, sellableRatePlanIds: toggleId(current.sellableRatePlanIds, id) }))} />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('bookingEngine.branding')}</h2>
          <div className="space-y-4 max-w-xl">
            <div>
              <label htmlFor="booking-display-name" className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('bookingEngine.displayName')}</label>
              <input id="booking-display-name" type="text" value={form.displayName} onChange={(event) => updateForm((current) => ({ ...current, displayName: event.target.value }))} placeholder={t('bookingEngine.displayNamePlaceholder')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal focus-visible:ring-2 focus-visible:ring-telivity-teal/20" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ColorControl id="booking-primary-color" label={t('bookingEngine.primaryColor')} value={form.primaryColor} onChange={(primaryColor) => updateForm((current) => ({ ...current, primaryColor }))} />
              <ColorControl id="booking-accent-color" label={t('bookingEngine.accentColor')} value={form.accentColor} onChange={(accentColor) => updateForm((current) => ({ ...current, accentColor }))} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2"><ImageIcon size={16} className="text-telivity-teal" aria-hidden="true" /><p className="text-xs font-medium text-telivity-mid-grey">{t('bookingEngine.logo')}</p></div>
              <MediaGallery propertyId={propertyId} ownerType="property" ownerId={propertyId} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('bookingEngine.depositPolicy')}</h2>
          <div className="space-y-4 max-w-xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="deposit-policy-type" className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('bookingEngine.type')}</label>
                <select id="deposit-policy-type" value={form.depositPolicy.type} onChange={(event) => updateForm((current) => ({ ...current, depositPolicy: { ...current.depositPolicy, type: event.target.value as DepositType } }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
                  <option value="none">{t('bookingEngine.depositTypes.none')}</option>
                  <option value="first_night">{t('bookingEngine.depositTypes.first_night')}</option>
                  <option value="percentage">{t('bookingEngine.depositTypes.percentage')}</option>
                  <option value="full">{t('bookingEngine.depositTypes.full')}</option>
                </select>
              </div>
              {form.depositPolicy.type === 'percentage' && (
                <div>
                  <label htmlFor="deposit-percentage" className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('bookingEngine.percentageLabel')}</label>
                  <input id="deposit-percentage" type="number" min={0} max={100} value={form.depositPolicy.percentage ?? 0} onChange={(event) => updateForm((current) => ({ ...current, depositPolicy: { ...current.depositPolicy, percentage: Number(event.target.value) } }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.depositPolicy.refundable} onChange={(event) => updateForm((current) => ({ ...current, depositPolicy: { ...current.depositPolicy, refundable: event.target.checked } }))} className="accent-telivity-teal" /><span className="text-telivity-navy">{t('bookingEngine.refundableDeposit')}</span></label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.autoConfirm} onChange={(event) => updateForm((current) => ({ ...current, autoConfirm: event.target.checked }))} className="accent-telivity-teal" /><span className="text-telivity-navy">{t('bookingEngine.autoConfirm')}</span></label>
            <p className="text-[11px] text-telivity-mid-grey">{t('bookingEngine.requestSettings.autoConfirmDescription')}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || missingRequiredCardKey || !questionsValid || saveConfig.isPending} className="bg-telivity-teal text-white rounded-lg px-6 py-2 text-sm font-semibold disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-teal focus-visible:ring-offset-2">{saveConfig.isPending ? t('bookingEngine.requestSettings.saving') : t('bookingEngine.requestSettings.save')}</button>
          <button type="button" onClick={() => baseline && syncForm(baseline)} disabled={!dirty || saveConfig.isPending} className="text-sm font-medium text-telivity-slate hover:text-telivity-navy disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-teal rounded">{t('bookingEngine.requestSettings.reset')}</button>
          {dirty && <span className="text-xs text-telivity-orange">{t('bookingEngine.requestSettings.unsaved')}</span>}
          {saveConfig.isError && <p role="alert" className="text-xs text-red-600 sm:ml-auto">{t('bookingEngine.requestSettings.saveError')}</p>}
        </div>
      </fieldset>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-sm font-semibold text-telivity-navy">{t('bookingEngine.publishableKeys')}</h2>
          <button type="button" onClick={generateKey} disabled={createKey.isPending} className="inline-flex items-center justify-center gap-2 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-telivity-teal focus-visible:ring-offset-2"><KeyRound size={15} aria-hidden="true" /> {t('bookingEngine.generateKey')}</button>
        </div>
        {newKey && (
          <div className="m-4 border-l-4 border-telivity-orange bg-telivity-orange/5 rounded-xl p-4">
            <p className="text-xs font-semibold text-telivity-orange mb-2">{t('bookingEngine.copyKeyWarning')}</p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <code className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-telivity-navy break-all">{newKey}</code>
              <button type="button" onClick={copyKey} className="inline-flex items-center justify-center gap-1.5 bg-telivity-teal text-white rounded-lg px-3 py-2 text-sm font-semibold shrink-0">{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? t('bookingEngine.copied') : t('bookingEngine.copy')}</button>
              <button type="button" onClick={() => setNewKey(null)} className="text-xs text-telivity-mid-grey hover:text-telivity-slate shrink-0">{t('bookingEngine.dismiss')}</button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem]">
            <thead><tr className="bg-telivity-teal/5 border-b border-gray-100"><th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('bookingEngine.label')}</th><th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('bookingEngine.key')}</th><th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th><th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('bookingEngine.created')}</th><th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('common.actions')}</th></tr></thead>
            <tbody>
              {keys.map((key, index) => (
                <tr key={key.id} className={`border-b border-gray-50 ${index % 2 === 1 ? 'bg-gray-50/50' : ''}`}><td className="px-4 py-3 text-sm font-medium text-telivity-navy">{key.label}</td><td className="px-4 py-3 text-sm text-telivity-slate font-mono">{key.keyPrefix}••••</td><td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${key.isActive ? 'bg-telivity-dark-teal/10 text-telivity-dark-teal' : 'bg-gray-100 text-telivity-mid-grey'}`}>{key.isActive ? t('bookingEngine.active') : t('bookingEngine.revoked')}</span></td><td className="px-4 py-3 text-sm text-telivity-slate">{key.createdAt ? new Date(key.createdAt).toLocaleDateString() : '—'}</td><td className="px-4 py-3 text-right">{key.isActive && <button type="button" onClick={() => revokeKey.mutate(key.id)} disabled={revokeKey.isPending} className="inline-flex items-center gap-1 text-red-500 hover:text-red-600 text-sm font-medium disabled:opacity-50"><Trash2 size={14} aria-hidden="true" /> {t('bookingEngine.revoke')}</button>}</td></tr>
              ))}
              {keys.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('bookingEngine.noKeysYet')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InventoryList({ title, empty, items, selected, onToggle }: { title: string; empty: string; items: Array<RoomType | RatePlan>; selected: string[]; onToggle: (id: string) => void }) {
  const selectedIds = new Set(selected);
  return (
    <div>
      <p className="text-xs font-medium text-telivity-mid-grey mb-2">{title}</p>
      <div className="space-y-1 max-h-56 overflow-y-auto border border-gray-100 rounded-lg p-2">
        {items.map((item) => <label key={item.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer"><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => onToggle(item.id)} className="accent-telivity-teal" /><span className="font-medium text-telivity-navy">{item.name}</span><span className="text-[10px] text-telivity-mid-grey uppercase tracking-wide">{item.code}</span></label>)}
        {items.length === 0 && <p className="text-xs text-telivity-mid-grey py-1">{empty}</p>}
      </div>
    </div>
  );
}

function ColorControl({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-telivity-mid-grey mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input aria-label={label} type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-12 border border-gray-200 rounded-lg cursor-pointer" />
        <input id={id} type="text" value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-telivity-teal" />
      </div>
    </div>
  );
}
