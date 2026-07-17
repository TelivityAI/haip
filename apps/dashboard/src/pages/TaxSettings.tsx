import { useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ReceiptText, Plus, ChevronLeft } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import { useTranslation } from 'react-i18next';

interface TaxProfile {
  id: string;
  name: string;
  jurisdictionCode: string;
  isActive?: boolean;
  effectiveFrom: string;
  rules?: { id: string; name: string; code: string; rate: string; type: string }[];
}

function TaxProfileList() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [jurisdictionCode, setJurisdictionCode] = useState('US-FL');
  const [effectiveFrom, setEffectiveFrom] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data } = useQuery({
    queryKey: ['tax-profiles', propertyId],
    queryFn: () => api.get('/v1/tax/profiles', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const profiles: TaxProfile[] = data?.data ?? data ?? [];

  const createMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/tax/profiles', {
        propertyId,
        name,
        jurisdictionCode,
        effectiveFrom,
        isActive: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-profiles'] });
      setCreateOpen(false);
      setName('');
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('taxSettings.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <ReceiptText size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('taxSettings.title')}</h1>
        <button onClick={() => setCreateOpen(true)} className="ml-auto flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">
          <Plus size={16} /> {t('taxSettings.newProfile')}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.name')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('taxSettings.jurisdiction')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('taxSettings.effective')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p, i) => (
              <tr key={p.id} onClick={() => navigate(`/tax/${p.id}`)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{p.name}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{p.jurisdictionCode}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{p.effectiveFrom}</td>
                <td className="px-4 py-3"><StatusBadge status={p.isActive !== false ? 'success' : 'completed'} label={p.isActive !== false ? t('common.active') : t('common.inactive')} /></td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('taxSettings.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('taxSettings.newProfile')}>
        <div className="space-y-4">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('taxSettings.profileName')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <input type="text" value={jurisdictionCode} onChange={(e) => setJurisdictionCode(e.target.value)} placeholder={t('taxSettings.jurisdictionCode')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('common.create')}</button>
        </div>
      </Modal>

      <TaxCalculator />
    </div>
  );
}

function TaxCalculator() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const [amount, setAmount] = useState('100.00');
  const [chargeType, setChargeType] = useState('room');
  const [serviceDate, setServiceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const calculate = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/tax/calculate', {
        propertyId,
        amount: amount.includes('.') ? amount : `${amount}.00`,
        chargeType,
        serviceDate,
      });
    },
    onSuccess: (res) => setResult(res.data?.data ?? res.data),
  });

  if (!propertyId) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 mt-6">
      <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('taxSettings.calculator')}</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <select value={chargeType} onChange={(e) => setChargeType(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="room">Room</option>
          <option value="food_beverage">Food & Beverage</option>
          <option value="tax">Tax</option>
          <option value="incidental">Incidental</option>
        </select>
        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      </div>
      <button onClick={() => calculate.mutate()} disabled={!amount || calculate.isPending} className="bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('taxSettings.calculate')}</button>
      {result && (
        <pre className="mt-4 bg-telivity-light-grey rounded-lg p-4 text-xs overflow-auto max-h-48">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

function TaxProfileDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleCode, setRuleCode] = useState('');
  const [ruleRate, setRuleRate] = useState('0.07');
  const [ruleType, setRuleType] = useState('percentage');

  const { data } = useQuery({
    queryKey: ['tax-profiles', id, propertyId],
    queryFn: () => api.get(`/v1/tax/profiles/${id}`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const profile: TaxProfile | null = data?.data ?? data ?? null;
  const rules = profile?.rules ?? [];

  const addRule = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/tax/profiles/${id}/rules`, {
        name: ruleName,
        code: ruleCode,
        type: ruleType,
        rate: ruleRate,
        effectiveFrom: format(new Date(), 'yyyy-MM-dd'),
      }, { params: { propertyId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-profiles'] });
      setRuleOpen(false);
      setRuleName('');
      setRuleCode('');
    },
  });

  if (!profile) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.loading')}</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/tax')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <ReceiptText size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{profile.name}</h1>
        <button onClick={() => setRuleOpen(true)} className="ml-auto flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold"><Plus size={14} /> {t('taxSettings.addRule')}</button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('taxSettings.ruleName')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('taxSettings.ruleCode')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('taxSettings.type')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('taxSettings.rate')}</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{r.name}</td>
                <td className="px-4 py-3 text-sm font-mono text-telivity-slate">{r.code}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{r.type}</td>
                <td className="px-4 py-3 text-sm text-right">{r.rate}</td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('taxSettings.noRules')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={ruleOpen} onClose={() => setRuleOpen(false)} title={t('taxSettings.addTaxRule')}>
        <div className="space-y-4">
          <input type="text" value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder={t('taxSettings.ruleName')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <input type="text" value={ruleCode} onChange={(e) => setRuleCode(e.target.value)} placeholder={t('taxSettings.ruleCode')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <select value={ruleType} onChange={(e) => setRuleType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="percentage">{t('taxSettings.types.percentage')}</option>
            <option value="flat">{t('taxSettings.types.flat')}</option>
          </select>
          <input type="text" value={ruleRate} onChange={(e) => setRuleRate(e.target.value)} placeholder={t('taxSettings.ratePlaceholder')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => addRule.mutate()} disabled={!ruleName || !ruleCode || addRule.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('taxSettings.addRule')}</button>
        </div>
      </Modal>
    </div>
  );
}

export default function TaxSettings() {
  return (
    <Routes>
      <Route index element={<TaxProfileList />} />
      <Route path=":id" element={<TaxProfileDetail />} />
    </Routes>
  );
}
