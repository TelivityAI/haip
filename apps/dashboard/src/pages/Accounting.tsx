import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calculator, Plus, Download } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import Modal from '../components/ui/Modal';
import { useTranslation } from 'react-i18next';

interface Deposit {
  id: string;
  amount: string;
  status: string;
}

interface ArLedger {
  id: string;
  name: string;
  balance?: string;
}

function AccountingHome() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeName, setCodeName] = useState('');
  const [codeValue, setCodeValue] = useState('');
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [depositActionOpen, setDepositActionOpen] = useState(false);
  const [applyFolioId, setApplyFolioId] = useState('');
  const [selectedLedger, setSelectedLedger] = useState<ArLedger | null>(null);
  const [arActionOpen, setArActionOpen] = useState<'payment' | 'aging' | 'transfer' | 'reverse' | null>(null);
  const [arPaymentAmount, setArPaymentAmount] = useState('');
  const [transferFolioId, setTransferFolioId] = useState('');
  const [reverseTxId, setReverseTxId] = useState('');

  const { data: depositsData } = useQuery({
    queryKey: ['deposits', propertyId],
    queryFn: () => api.get('/v1/deposits', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: codesData } = useQuery({
    queryKey: ['accounting-codes', propertyId],
    queryFn: () => api.get('/v1/accounting/codes', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: arData } = useQuery({
    queryKey: ['ar-ledgers', propertyId],
    queryFn: () => api.get('/v1/ar/ledgers', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: agingData, refetch: refetchAging } = useQuery({
    queryKey: ['ar-aging', selectedLedger?.id, propertyId],
    queryFn: () => api.get(`/v1/ar/ledgers/${selectedLedger!.id}/aging`, { params: { propertyId } }).then((r) => r.data),
    enabled: false,
  });

  const deposits: Deposit[] = depositsData?.data ?? depositsData ?? [];
  const codes = codesData?.data ?? codesData ?? [];
  const ledgers: ArLedger[] = arData?.data ?? arData ?? [];

  const recordDeposit = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/deposits', {
        propertyId,
        amount: moneyString(depositAmount),
        currencyCode: 'USD',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      setDepositOpen(false);
      setDepositAmount('');
    },
  });

  const createCode = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/accounting/codes', {
        propertyId,
        code: codeValue,
        label: codeName,
        kind: 'gl',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-codes'] });
      setCodeOpen(false);
      setCodeName('');
      setCodeValue('');
    },
  });

  const applyDeposit = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/deposits/${selectedDeposit!.id}/apply`, {
        propertyId,
        folioId: applyFolioId || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      setDepositActionOpen(false);
      setSelectedDeposit(null);
    },
  });

  const refundDeposit = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/deposits/${selectedDeposit!.id}/refund`, null, { params: { propertyId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      setDepositActionOpen(false);
      setSelectedDeposit(null);
    },
  });

  const forfeitDeposit = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/deposits/${selectedDeposit!.id}/forfeit`, null, { params: { propertyId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] });
      setDepositActionOpen(false);
      setSelectedDeposit(null);
    },
  });

  const recordArPayment = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/ar/ledgers/${selectedLedger!.id}/payments`, {
        propertyId,
        amount: moneyString(arPaymentAmount),
        currencyCode: 'USD',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ar-ledgers'] });
      setArActionOpen(null);
      setArPaymentAmount('');
    },
  });

  const transferToAr = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/ar/transfer', {
        propertyId,
        folioId: transferFolioId,
        arLedgerId: selectedLedger!.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ar-ledgers'] });
      setArActionOpen(null);
      setTransferFolioId('');
    },
  });

  const reverseTransfer = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/ar/transactions/${reverseTxId}/reverse`, null, { params: { propertyId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ar-ledgers'] });
      setArActionOpen(null);
      setReverseTxId('');
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('accounting.selectProperty')}</div>;
  }

  const exportUrl = (path: string) =>
    `/api/v1/accounting-export/${path}?propertyId=${propertyId}&date=${today}`;

  const aging = agingData?.data ?? agingData;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Calculator size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('accounting.title')}</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-telivity-navy mb-3">{t('accounting.csvExports')}</h2>
        <div className="flex flex-wrap gap-2">
          <a href={exportUrl('revenue-journal.csv')} className="inline-flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium hover:bg-telivity-light-grey">
            <Download size={14} /> {t('accounting.revenueJournal')}
          </a>
          <a href={exportUrl('trial-balance.csv')} className="inline-flex items-center gap-2 border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium hover:bg-telivity-light-grey">
            <Download size={14} /> {t('accounting.folioLedgerTrialBalance')}
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-telivity-navy">{t('accounting.deposits')}</h2>
            <button onClick={() => setDepositOpen(true)} className="flex items-center gap-1 text-xs font-semibold text-telivity-teal"><Plus size={14} /> {t('accounting.record')}</button>
          </div>
          <ul className="space-y-2 text-sm">
            {deposits.slice(0, 8).map((d) => (
              <li key={d.id} className="flex justify-between items-center border-b border-gray-50 py-1">
                <span>${Number(d.amount).toFixed(2)}</span>
                <span className="text-telivity-mid-grey">{d.status}</span>
                {d.status === 'held' && (
                  <button
                    onClick={() => { setSelectedDeposit(d); setDepositActionOpen(true); }}
                    className="text-xs font-semibold text-telivity-teal hover:underline"
                  >
                    {t('accounting.actions')}
                  </button>
                )}
              </li>
            ))}
            {deposits.length === 0 && <li className="text-telivity-mid-grey">{t('accounting.noDeposits')}</li>}
          </ul>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-telivity-navy">{t('accounting.glCodes')}</h2>
            <button onClick={() => setCodeOpen(true)} className="flex items-center gap-1 text-xs font-semibold text-telivity-teal"><Plus size={14} /> {t('accounting.add')}</button>
          </div>
          <ul className="space-y-2 text-sm">
            {(codes as { id: string; code: string; label: string }[]).slice(0, 8).map((c) => (
              <li key={c.id} className="flex justify-between border-b border-gray-50 py-1">
                <span className="font-mono text-xs">{c.code}</span>
                <span>{c.label}</span>
              </li>
            ))}
            {codes.length === 0 && <li className="text-telivity-mid-grey">{t('accounting.noCodes')}</li>}
          </ul>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-telivity-navy mb-3">{t('accounting.arLedgers')}</h2>
          <ul className="space-y-2 text-sm">
            {ledgers.slice(0, 10).map((l) => (
              <li key={l.id} className="flex justify-between items-center border-b border-gray-50 py-1">
                <span>{l.name}</span>
                <span className="font-medium">${Number(l.balance ?? 0).toFixed(2)}</span>
                <div className="flex gap-2">
                  <button onClick={() => { setSelectedLedger(l); setArActionOpen('payment'); }} className="text-xs text-telivity-teal hover:underline">{t('accounting.payment')}</button>
                  <button onClick={async () => { setSelectedLedger(l); setArActionOpen('aging'); await refetchAging(); }} className="text-xs text-telivity-teal hover:underline">{t('accounting.aging')}</button>
                  <button onClick={() => { setSelectedLedger(l); setArActionOpen('transfer'); }} className="text-xs text-telivity-teal hover:underline">{t('accounting.transfer')}</button>
                  <button onClick={() => { setSelectedLedger(l); setArActionOpen('reverse'); }} className="text-xs text-telivity-teal hover:underline">{t('accounting.reverse')}</button>
                </div>
              </li>
            ))}
            {ledgers.length === 0 && <li className="text-telivity-mid-grey">{t('accounting.noLedgers')}</li>}
          </ul>
        </div>
      </div>

      <Modal open={depositOpen} onClose={() => setDepositOpen(false)} title={t('accounting.recordDeposit')}>
        <div className="space-y-4">
          <input type="number" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder={t('accounting.amount')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => recordDeposit.mutate()} disabled={!depositAmount || recordDeposit.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('accounting.record')}</button>
        </div>
      </Modal>

      <Modal open={codeOpen} onClose={() => setCodeOpen(false)} title={t('accounting.addGlCode')}>
        <div className="space-y-4">
          <input type="text" value={codeValue} onChange={(e) => setCodeValue(e.target.value)} placeholder={t('accounting.code')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <input type="text" value={codeName} onChange={(e) => setCodeName(e.target.value)} placeholder={t('accounting.name')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => createCode.mutate()} disabled={!codeName || !codeValue || createCode.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('accounting.create')}</button>
        </div>
      </Modal>

      <Modal open={depositActionOpen} onClose={() => setDepositActionOpen(false)} title={t('accounting.depositActions', { amount: Number(selectedDeposit?.amount ?? 0).toFixed(2) })}>
        <div className="space-y-4">
          <input type="text" value={applyFolioId} onChange={(e) => setApplyFolioId(e.target.value)} placeholder={t('accounting.folioIdPlaceholder')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-xs" />
          <button onClick={() => applyDeposit.mutate()} disabled={applyDeposit.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('accounting.applyToFolio')}</button>
          <button onClick={() => refundDeposit.mutate()} disabled={refundDeposit.isPending} className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold">{t('accounting.refund')}</button>
          <button onClick={() => forfeitDeposit.mutate()} disabled={forfeitDeposit.isPending} className="w-full border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm font-semibold">{t('accounting.forfeit')}</button>
        </div>
      </Modal>

      <Modal open={arActionOpen === 'payment'} onClose={() => setArActionOpen(null)} title={t('accounting.arPayment', { name: selectedLedger?.name ?? '' })}>
        <div className="space-y-4">
          <input type="number" step="0.01" value={arPaymentAmount} onChange={(e) => setArPaymentAmount(e.target.value)} placeholder={t('accounting.amount')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => recordArPayment.mutate()} disabled={!arPaymentAmount || recordArPayment.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('accounting.recordPayment')}</button>
        </div>
      </Modal>

      <Modal open={arActionOpen === 'transfer'} onClose={() => setArActionOpen(null)} title={t('accounting.arTransfer', { name: selectedLedger?.name ?? '' })}>
        <div className="space-y-4">
          <input type="text" value={transferFolioId} onChange={(e) => setTransferFolioId(e.target.value)} placeholder={t('accounting.sourceFolioIdPlaceholder')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-xs" />
          <button onClick={() => transferToAr.mutate()} disabled={!transferFolioId || transferToAr.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('accounting.transferBalance')}</button>
        </div>
      </Modal>

      <Modal open={arActionOpen === 'reverse'} onClose={() => setArActionOpen(null)} title={t('accounting.reverseTransfer')}>
        <div className="space-y-4">
          <input type="text" value={reverseTxId} onChange={(e) => setReverseTxId(e.target.value)} placeholder={t('accounting.transactionIdPlaceholder')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-xs" />
          <button onClick={() => reverseTransfer.mutate()} disabled={!reverseTxId || reverseTransfer.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('accounting.reverse')}</button>
        </div>
      </Modal>

      <Modal open={arActionOpen === 'aging'} onClose={() => setArActionOpen(null)} title={t('accounting.arAging', { name: selectedLedger?.name ?? '' })}>
        {aging ? (
          <div className="space-y-2 text-sm">
            {Object.entries(aging as Record<string, unknown>).map(([key, val]) => (
              <div key={key} className="flex justify-between border-b border-gray-50 py-1">
                <span className="capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                <span className="font-medium">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-telivity-mid-grey">{t('accounting.loadingAgingReport')}</p>
        )}
      </Modal>
    </div>
  );
}

export default function Accounting() {
  return (
    <Routes>
      <Route index element={<AccountingHome />} />
    </Routes>
  );
}
