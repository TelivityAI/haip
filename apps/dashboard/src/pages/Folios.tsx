import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, ChevronLeft, Plus, Lock, RotateCcw, Split, ArrowRightLeft, CreditCard } from 'lucide-react';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../components/ui/Toast';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import { StripeProvider } from '../components/payment/StripeProvider';
import { CardInput } from '../components/payment/CardInput';

interface Folio {
  id: string;
  folioNumber: string;
  type: string;
  status: string;
  guestName?: string;
  guestId?: string;
  reservationId?: string;
  balance: number;
  totalCharges?: number;
  totalPayments?: number;
  currencyCode?: string;
}

interface RoutingRule {
  id: string;
  chargeType: string;
  targetFolioId: string;
  priority: number;
}

/** Charge types accepted by the folio charge / routing-rule / move-transaction DTOs. */
const CHARGE_TYPES = [
  'room',
  'tax',
  'food_beverage',
  'minibar',
  'phone',
  'laundry',
  'parking',
  'spa',
  'incidental',
  'fee',
  'adjustment',
  'package',
] as const;

interface Charge {
  id: string;
  description: string;
  type: string;
  amount: number;
  serviceDate: string;
  isLocked?: boolean;
  isReversal?: boolean;
  originalChargeId?: string;
  createdAt: string;
}

interface Payment {
  id: string;
  amount: number;
  method: string;
  status: string;
  gatewayReference?: string;
  originalPaymentId?: string;
  createdAt: string;
}

function errMsg(e: unknown): string {
  const anyE = e as { response?: { data?: { message?: string } }; message?: string };
  const m = anyE?.response?.data?.message ?? anyE?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

const REFUNDABLE_STATUSES = new Set(['captured', 'settled', 'partially_refunded']);

// ---- Folio List ----
function FolioList() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState('');

  const resId = searchParams.get('reservationId');

  const { data } = useQuery({
    queryKey: ['folios', propertyId, statusFilter, resId],
    queryFn: () => api.get('/v1/folios', {
      params: { propertyId, status: statusFilter || undefined, reservationId: resId || undefined },
    }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const folios: Folio[] = data?.data ?? data ?? [];

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Receipt size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('folios.title')}</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('folios.allStatus')}</option>
          <option value="open">{t('folios.open')}</option>
          <option value="settled">{t('folios.settled')}</option>
          <option value="closed">{t('folios.closed')}</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('folios.folioNumber')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('folios.guest')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('folios.type')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('folios.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {folios.map((f, i) => (
              <tr key={f.id} onClick={() => navigate(`/folios/${f.id}`)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{f.folioNumber}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{f.guestName ?? '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={f.type === 'guest' ? 'info' : 'warning'} label={t(`folios.${f.type}`, { defaultValue: f.type })} /></td>
                <td className="px-4 py-3"><StatusBadge status={f.status === 'open' ? 'pending' : f.status === 'settled' ? 'success' : 'completed'} label={t(`folios.${f.status}`, { defaultValue: f.status })} /></td>
                <td className="px-4 py-3 text-sm font-medium text-right">${Number(f.balance ?? 0).toFixed(2)}</td>
              </tr>
            ))}
            {folios.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('folios.noFoliosFound')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Split folios (KB 14.2): routing rules decide which folio a charge TYPE posts
 * to for a reservation, and move-transactions relocates charges that already
 * posted. Both need a sibling folio on the same reservation, so the panel also
 * offers creating one.
 */
function SplitFolioPanel({
  folio,
  propertyId,
  charges,
  onChanged,
}: {
  folio: Folio;
  propertyId: string;
  charges: Charge[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleChargeType, setRuleChargeType] = useState<string>(CHARGE_TYPES[0]);
  const [ruleTargetFolioId, setRuleTargetFolioId] = useState('');
  const [rulePriority, setRulePriority] = useState('0');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveMode, setMoveMode] = useState<'charge' | 'type'>('charge');
  const [moveChargeId, setMoveChargeId] = useState('');
  const [moveChargeType, setMoveChargeType] = useState<string>(CHARGE_TYPES[0]);
  const [moveTargetFolioId, setMoveTargetFolioId] = useState('');
  const [splitOpen, setSplitOpen] = useState(false);

  const reservationId = folio.reservationId;

  const { data: siblingsData, refetch: refetchSiblings } = useQuery({
    queryKey: ['folios', 'siblings', propertyId, reservationId],
    queryFn: () =>
      api
        .get('/v1/folios', { params: { propertyId, reservationId, status: 'open' } })
        .then((r) => r.data),
    enabled: !!reservationId,
  });

  const { data: rulesData, refetch: refetchRules } = useQuery({
    queryKey: ['folio-routing-rules', propertyId, reservationId],
    queryFn: () =>
      api
        .get('/v1/folios/routing-rules', { params: { propertyId, reservationId } })
        .then((r) => r.data),
    enabled: !!reservationId,
  });

  const siblings: Folio[] = (siblingsData?.data ?? siblingsData ?? []).filter(
    (f: Folio) => f.id !== folio.id,
  );
  const rules: RoutingRule[] = rulesData?.data ?? rulesData ?? [];
  const folioLabel = (folioId: string) =>
    folioId === folio.id
      ? folio.folioNumber
      : siblings.find((f) => f.id === folioId)?.folioNumber ?? folioId.slice(0, 8);

  const movableCharges = charges.filter((c) => !c.isLocked && !c.isReversal);

  const createRule = useMutation({
    mutationFn: () =>
      api.post('/v1/folios/routing-rules', {
        propertyId,
        reservationId,
        chargeType: ruleChargeType,
        targetFolioId: ruleTargetFolioId,
        priority: Number(rulePriority) || 0,
      }),
    onSuccess: () => {
      refetchRules();
      setRuleOpen(false);
      setRuleTargetFolioId('');
      setRulePriority('0');
      toast('success', t('folios.routingRuleCreated'));
    },
    onError: (e) => toast('error', `${t('folios.routingRuleFailed')}: ${errMsg(e)}`),
  });

  const moveTransactions = useMutation({
    mutationFn: () =>
      api.post(`/v1/folios/${folio.id}/move-transactions`, {
        propertyId,
        toFolioId: moveTargetFolioId,
        ...(moveMode === 'charge' ? { chargeId: moveChargeId } : { chargeType: moveChargeType }),
      }),
    onSuccess: (res) => {
      onChanged();
      refetchSiblings();
      setMoveOpen(false);
      setMoveChargeId('');
      const moved = res.data?.moved ?? res.data?.data?.moved;
      toast('success', moved != null ? t('folios.movedCount', { count: moved }) : t('folios.moveSuccess'));
    },
    onError: (e) => toast('error', `${t('folios.moveFailed')}: ${errMsg(e)}`),
  });

  const createSplitFolio = useMutation({
    mutationFn: () =>
      api.post('/v1/folios', {
        propertyId,
        reservationId,
        guestId: folio.guestId,
        type: 'guest',
        currencyCode: folio.currencyCode ?? 'USD',
      }),
    onSuccess: () => {
      refetchSiblings();
      setSplitOpen(false);
      toast('success', t('folios.splitFolioCreated'));
    },
    onError: (e) => toast('error', `${t('folios.splitFolioFailed')}: ${errMsg(e)}`),
  });

  if (!reservationId) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-sm font-semibold text-telivity-navy mb-2 flex items-center gap-2">
          <Split size={16} className="text-telivity-teal" /> {t('folios.splitFolios')}
        </h2>
        <p className="text-sm text-telivity-mid-grey">{t('folios.splitNeedsReservation')}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-telivity-navy flex items-center gap-2">
          <Split size={16} className="text-telivity-teal" /> {t('folios.splitFolios')}
        </h2>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSplitOpen(true)}
            disabled={!folio.guestId}
            className="flex items-center gap-1 border border-gray-200 text-telivity-slate rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey disabled:opacity-50"
          >
            <Plus size={14} /> {t('folios.newSplitFolio')}
          </button>
          <button
            onClick={() => { setRuleTargetFolioId(siblings[0]?.id ?? ''); setRuleOpen(true); }}
            disabled={siblings.length === 0}
            className="flex items-center gap-1 border border-gray-200 text-telivity-slate rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey disabled:opacity-50"
          >
            <Plus size={14} /> {t('folios.newRoutingRule')}
          </button>
          <button
            onClick={() => {
              setMoveTargetFolioId(siblings[0]?.id ?? '');
              setMoveMode('charge');
              setMoveChargeId(movableCharges[0]?.id ?? '');
              setMoveOpen(true);
            }}
            disabled={siblings.length === 0 || folio.status !== 'open'}
            className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            <ArrowRightLeft size={14} /> {t('folios.moveTransactions')}
          </button>
        </div>
      </div>

      {siblings.length === 0 && (
        <p className="text-xs text-telivity-mid-grey mb-3">{t('folios.splitNeedsSibling')}</p>
      )}

      <p className="text-xs font-semibold text-telivity-slate uppercase mb-2">{t('folios.routingRules')}</p>
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">{t('folios.chargeType')}</th>
            <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">{t('folios.targetFolio')}</th>
            <th className="pb-2 text-right text-xs font-medium text-telivity-mid-grey">{t('folios.priority')}</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className="border-b border-gray-50">
              <td className="py-2 text-sm text-telivity-navy">{t(`folios.chargeTypes.${r.chargeType}`, { defaultValue: r.chargeType })}</td>
              <td className="py-2 text-sm text-telivity-slate">{folioLabel(r.targetFolioId)}</td>
              <td className="py-2 text-sm text-right">{r.priority}</td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr><td colSpan={3} className="py-4 text-center text-sm text-telivity-mid-grey">{t('folios.noRoutingRules')}</td></tr>
          )}
        </tbody>
      </table>

      <Modal open={splitOpen} onClose={() => setSplitOpen(false)} title={t('folios.newSplitFolio')}>
        <div className="space-y-4">
          <p className="text-sm text-telivity-mid-grey">{t('folios.newSplitFolioHint')}</p>
          <button
            onClick={() => createSplitFolio.mutate()}
            disabled={createSplitFolio.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('common.create')}
          </button>
        </div>
      </Modal>

      <Modal open={ruleOpen} onClose={() => setRuleOpen(false)} title={t('folios.newRoutingRule')}>
        <div className="space-y-4">
          <p className="text-xs text-telivity-mid-grey">{t('folios.routingRuleHint')}</p>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.chargeType')}</label>
            <select value={ruleChargeType} onChange={(e) => setRuleChargeType(e.target.value)} aria-label={t('folios.chargeType')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {CHARGE_TYPES.map((ct) => (
                <option key={ct} value={ct}>{t(`folios.chargeTypes.${ct}`, { defaultValue: ct })}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.targetFolio')}</label>
            <select value={ruleTargetFolioId} onChange={(e) => setRuleTargetFolioId(e.target.value)} aria-label={t('folios.targetFolio')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">{t('folios.selectFolio')}</option>
              {siblings.map((f) => (
                <option key={f.id} value={f.id}>{f.folioNumber}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.priority')}</label>
            <input type="number" value={rulePriority} onChange={(e) => setRulePriority(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button
            onClick={() => createRule.mutate()}
            disabled={!ruleTargetFolioId || createRule.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('common.create')}
          </button>
        </div>
      </Modal>

      <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title={t('folios.moveTransactions')}>
        <div className="space-y-4">
          <p className="text-xs text-telivity-mid-grey">{t('folios.moveHint')}</p>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={moveMode === 'charge'} onChange={() => setMoveMode('charge')} className="text-telivity-teal" />
              {t('folios.moveSingleCharge')}
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={moveMode === 'type'} onChange={() => setMoveMode('type')} className="text-telivity-teal" />
              {t('folios.moveByType')}
            </label>
          </div>
          {moveMode === 'charge' ? (
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.charge')}</label>
              <select value={moveChargeId} onChange={(e) => setMoveChargeId(e.target.value)} aria-label={t('folios.charge')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">{t('folios.selectCharge')}</option>
                {movableCharges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.serviceDate} · {c.description} · ${Number(c.amount).toFixed(2)}
                  </option>
                ))}
              </select>
              {movableCharges.length === 0 && (
                <p className="text-xs text-telivity-mid-grey mt-1">{t('folios.noMovableCharges')}</p>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.chargeType')}</label>
              <select value={moveChargeType} onChange={(e) => setMoveChargeType(e.target.value)} aria-label={t('folios.chargeType')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {CHARGE_TYPES.map((ct) => (
                  <option key={ct} value={ct}>{t(`folios.chargeTypes.${ct}`, { defaultValue: ct })}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.targetFolio')}</label>
            <select value={moveTargetFolioId} onChange={(e) => setMoveTargetFolioId(e.target.value)} aria-label={t('folios.targetFolio')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">{t('folios.selectFolio')}</option>
              {siblings.map((f) => (
                <option key={f.id} value={f.id}>{f.folioNumber}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => moveTransactions.mutate()}
            disabled={
              !moveTargetFolioId ||
              (moveMode === 'charge' && !moveChargeId) ||
              moveTransactions.isPending
            }
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('folios.move')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Folio Detail ----
function FolioDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [chargeOpen, setChargeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [arTransferOpen, setArTransferOpen] = useState(false);
  const [arLedgerId, setArLedgerId] = useState('');
  const [chargeType, setChargeType] = useState('room');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDesc, setChargeDesc] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payAmount, setPayAmount] = useState('');
  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const [authAmount, setAuthAmount] = useState('');
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [correctTarget, setCorrectTarget] = useState<Payment | null>(null);
  const [correctOp, setCorrectOp] = useState('');

  const { data: folioData } = useQuery({
    queryKey: ['folios', id],
    queryFn: () => api.get(`/v1/folios/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: chargesData } = useQuery({
    queryKey: ['folios', id, 'charges'],
    queryFn: () => api.get(`/v1/folios/${id}/charges`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: paymentsData } = useQuery({
    queryKey: ['payments', 'folio', id],
    queryFn: () => api.get('/v1/payments', { params: { folioId: id } }).then((r) => r.data),
    enabled: !!id,
  });

  const { data: arLedgersData } = useQuery({
    queryKey: ['ar-ledgers', propertyId, 'open'],
    queryFn: () =>
      api.get('/v1/ar/ledgers', { params: { propertyId, status: 'open' } }).then((r) => r.data),
    enabled: !!propertyId && arTransferOpen,
  });
  const arLedgers: { id: string; name: string; balance?: string }[] =
    arLedgersData?.data ?? arLedgersData ?? [];

  const folio: Folio | null = folioData?.data ?? folioData ?? null;
  const charges: Charge[] = chargesData?.data ?? chargesData ?? [];
  const payments: Payment[] = paymentsData?.data ?? paymentsData ?? [];
  const currencyCode = folio?.currencyCode ?? 'USD';

  const reversedIds = new Set(
    charges.filter((c) => c.isReversal && c.originalChargeId).map((c) => c.originalChargeId!),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['folios'] });
    queryClient.invalidateQueries({ queryKey: ['payments'] });
  };

  const postChargeMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/folios/${id}/charges`, {
        propertyId,
        type: chargeType,
        amount: moneyString(chargeAmount),
        currencyCode,
        description: chargeDesc,
        serviceDate: new Date().toISOString().split('T')[0],
      });
    },
    onSuccess: () => { invalidate(); setChargeOpen(false); setChargeAmount(''); setChargeDesc(''); },
  });

  const reverseMutation = useMutation({
    mutationFn: (chargeId: string) => api.post(`/v1/folios/${id}/charges/${chargeId}/reverse`),
    onSuccess: invalidate,
    onError: (e) => toast('error', `${t('folios.reverseFailed')}: ${errMsg(e)}`),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/payments', {
        folioId: id,
        propertyId,
        method: payMethod,
        amount: moneyString(payAmount),
        currencyCode,
      });
    },
    onSuccess: () => { invalidate(); setPaymentOpen(false); setPayAmount(''); },
  });

  /**
   * Card pre-auth (KB 14.1). The card itself is tokenized by Stripe.js in the
   * browser — only the pm_xxx PaymentMethod id reaches HAIP (PCI DSS).
   */
  const authorizeMutation = useMutation({
    mutationFn: (pm: { id: string; card?: { last4: string; brand: string } }) => {
      requirePropertyId(propertyId);
      return api.post('/v1/payments/authorize', {
        folioId: id,
        propertyId,
        amount: moneyString(authAmount),
        currencyCode,
        gatewayProvider: 'stripe',
        gatewayPaymentToken: pm.id,
        cardLastFour: pm.card?.last4,
        cardBrand: pm.card?.brand,
      });
    },
    onSuccess: () => {
      invalidate();
      setAuthorizeOpen(false);
      setAuthAmount('');
      toast('success', t('folios.authorizeSuccess'));
    },
    onError: (e) => toast('error', `${t('folios.authorizeFailed')}: ${errMsg(e)}`),
  });

  const captureMutation = useMutation({
    mutationFn: (paymentId: string) => api.post(`/v1/payments/${paymentId}/capture`, null),
    onSuccess: () => {
      invalidate();
      toast('success', t('folios.captureSuccess'));
    },
    onError: (e) => toast('error', `${t('folios.captureFailed')}: ${errMsg(e)}`),
  });

  const voidMutation = useMutation({
    mutationFn: (paymentId: string) => api.post(`/v1/payments/${paymentId}/void`, null),
    onSuccess: () => {
      invalidate();
      toast('success', t('folios.voidSuccess'));
    },
    onError: (e) => toast('error', `${t('folios.voidFailed')}: ${errMsg(e)}`),
  });

  const refundMutation = useMutation({
    mutationFn: ({ paymentId, amount }: { paymentId: string; amount?: string }) =>
      api.post(`/v1/payments/${paymentId}/refund`, amount ? { amount: moneyString(amount) } : {}),
    onSuccess: () => {
      invalidate();
      setRefundTarget(null);
      setRefundAmount('');
      toast('success', t('folios.refundSuccess'));
    },
    onError: (e) => toast('error', `${t('folios.refundFailed')}: ${errMsg(e)}`),
  });

  /**
   * Correction matrix (KB 14.1): the API derives the single legal op from the
   * payment's state. An explicit op is only sent when the operator picks one,
   * and the API rejects it if it is not the legal op.
   */
  const correctMutation = useMutation({
    mutationFn: ({ paymentId, op }: { paymentId: string; op?: string }) => {
      requirePropertyId(propertyId);
      return api.post(`/v1/payments/${paymentId}/correct`, {
        propertyId,
        ...(op ? { op } : {}),
      });
    },
    onSuccess: (res) => {
      invalidate();
      setCorrectTarget(null);
      setCorrectOp('');
      const applied = res.data?.op ?? res.data?.data?.op;
      toast('success', applied ? t('folios.correctApplied', { op: applied }) : t('folios.correctSuccess'));
    },
    onError: (e) => toast('error', `${t('folios.correctFailed')}: ${errMsg(e)}`),
  });

  const settleMutation = useMutation({ mutationFn: () => api.patch(`/v1/folios/${id}/settle`), onSuccess: invalidate });
  const closeMutation = useMutation({ mutationFn: () => api.patch(`/v1/folios/${id}/close`), onSuccess: invalidate });

  const transferToArMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/ar/transfer', {
        propertyId,
        folioId: id,
        arLedgerId,
      });
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['ar-ledgers'] });
      setArTransferOpen(false);
      setArLedgerId('');
      toast('success', t('folios.transferredToAr'));
    },
    onError: (e) => toast('error', `${t('folios.transferToArFailed')}: ${errMsg(e)}`),
  });

  if (!folio) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.loading')}</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/folios')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <Receipt size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{folio.folioNumber}</h1>
        <StatusBadge status={folio.status === 'open' ? 'pending' : 'success'} label={t(`folios.${folio.status}`, { defaultValue: folio.status })} />
        <div className="ml-auto text-right">
          <p className="text-xs text-telivity-mid-grey">{t('folios.balance')}</p>
          <p className="text-2xl font-semibold text-telivity-navy">${Number(folio.balance ?? 0).toFixed(2)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Charges */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-telivity-navy">{t('folios.charges')}</h2>
            {folio.status === 'open' && (
              <button onClick={() => setChargeOpen(true)} className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold">
                <Plus size={14} /> {t('folios.postCharge')}
              </button>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">{t('common.date')}</th>
                <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">{t('folios.description')}</th>
                <th className="pb-2 text-left text-xs font-medium text-telivity-mid-grey">{t('folios.type')}</th>
                <th className="pb-2 text-right text-xs font-medium text-telivity-mid-grey">{t('folios.amount')}</th>
                <th className="pb-2 text-right text-xs font-medium text-telivity-mid-grey"></th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id} className={`border-b border-gray-50 ${reversedIds.has(c.id) ? 'opacity-50 line-through' : ''}`}>
                  <td className="py-2 text-sm text-telivity-slate">{c.serviceDate}</td>
                  <td className="py-2 text-sm text-telivity-navy">{c.description} {c.isLocked && <Lock size={12} className="inline text-telivity-mid-grey" />}</td>
                  <td className="py-2 text-sm text-telivity-slate">{t(`folios.chargeTypes.${c.type}`, { defaultValue: c.type })}</td>
                  <td className="py-2 text-sm text-right font-medium">${Number(c.amount).toFixed(2)}</td>
                  <td className="py-2 text-right">
                    {!c.isReversal && !reversedIds.has(c.id) && !c.isLocked && folio.status === 'open' && (
                      <button onClick={() => { if (confirm('Reverse this charge?')) reverseMutation.mutate(c.id); }} className="text-telivity-orange text-xs hover:underline">
                        <RotateCcw size={12} className="inline" /> {t('folios.reverse')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {charges.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-sm text-telivity-mid-grey">{t('folios.noCharges')}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Payments + Actions */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-telivity-navy">{t('folios.payments')}</h2>
              {folio.status === 'open' && (
                <div className="flex gap-2">
                  <button onClick={() => setAuthorizeOpen(true)} className="flex items-center gap-1 border border-gray-200 text-telivity-slate rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey">
                    <CreditCard size={14} /> {t('folios.authorizeCard')}
                  </button>
                  <button onClick={() => setPaymentOpen(true)} className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold">
                    <Plus size={14} /> {t('folios.record')}
                  </button>
                </div>
              )}
            </div>
            {payments.map((p) => {
              const isOriginal = Number(p.amount) > 0 && !p.originalPaymentId;
              const canRefund = folio.status === 'open' && isOriginal && REFUNDABLE_STATUSES.has(p.status);
              const canCapture = folio.status === 'open' && isOriginal && p.status === 'authorized';
              const canVoid = canCapture;
              // The correction matrix resolves the legal op server-side, so it is
              // offered for any live original payment, not just refundable ones.
              const canCorrect =
                folio.status === 'open' &&
                isOriginal &&
                !['voided', 'failed', 'refunded'].includes(p.status);

              return (
                <div key={p.id} className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0 gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-telivity-navy">${Number(p.amount).toFixed(2)}</p>
                    <p className="text-xs text-telivity-mid-grey">{t(`folios.paymentMethods.${p.method}`, { defaultValue: p.method })} &middot; {p.createdAt?.split('T')[0]}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {canCapture && (
                        <button
                          onClick={() => captureMutation.mutate(p.id)}
                          disabled={captureMutation.isPending}
                          className="text-telivity-teal text-xs hover:underline disabled:opacity-50"
                        >
                          {t('folios.capture')}
                        </button>
                      )}
                      {canVoid && (
                        <button
                          onClick={() => { if (confirm(t('folios.confirmVoid'))) voidMutation.mutate(p.id); }}
                          disabled={voidMutation.isPending}
                          className="text-telivity-orange text-xs hover:underline disabled:opacity-50"
                        >
                          {t('folios.void')}
                        </button>
                      )}
                      {canRefund && (
                        <button
                          onClick={() => { setRefundTarget(p); setRefundAmount(''); }}
                          className="text-telivity-orange text-xs hover:underline"
                        >
                          {t('folios.refund')}
                        </button>
                      )}
                      {canCorrect && (
                        <button
                          onClick={() => { setCorrectTarget(p); setCorrectOp(''); }}
                          className="text-telivity-slate text-xs hover:underline"
                        >
                          {t('folios.correct')}
                        </button>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={p.status === 'captured' ? 'success' : p.status} label={t(`folios.paymentStatuses.${p.status}`, { defaultValue: p.status })} />
                </div>
              );
            })}
            {payments.length === 0 && <p className="text-sm text-telivity-mid-grey">{t('folios.noPayments')}</p>}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5 space-y-2">
            <h2 className="text-sm font-semibold text-telivity-navy mb-3">{t('common.actions')}</h2>
            {folio.status === 'open' && Number(folio.balance ?? 0) !== 0 && (
              <button
                onClick={() => setArTransferOpen(true)}
                className="w-full border border-gray-200 text-telivity-navy rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey"
              >
                {t('folios.transferToAr')}
              </button>
            )}
            {folio.status === 'open' && (
              <button onClick={() => settleMutation.mutate()} disabled={settleMutation.isPending} className="w-full bg-telivity-dark-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {t('folios.settleFolio')}
              </button>
            )}
            {folio.status === 'settled' && (
              <button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending} className="w-full bg-telivity-deep-blue text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {t('folios.closeFolio')}
              </button>
            )}
          </div>
        </div>

        {propertyId && (
          <div className="lg:col-span-3">
            <SplitFolioPanel
              folio={folio}
              propertyId={propertyId}
              charges={charges}
              onChanged={() => {
                invalidate();
                queryClient.invalidateQueries({ queryKey: ['folios', id, 'charges'] });
              }}
            />
          </div>
        )}
      </div>

      {/* Post Charge Modal */}
      <Modal open={chargeOpen} onClose={() => setChargeOpen(false)} title={t('folios.postCharge')}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.type')}</label>
            <select value={chargeType} onChange={(e) => setChargeType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              <option value="room">{t('folios.chargeTypes.room')}</option><option value="food_beverage">{t('folios.chargeTypes.food_beverage')}</option><option value="minibar">{t('folios.chargeTypes.minibar')}</option><option value="laundry">{t('folios.chargeTypes.laundry')}</option><option value="parking">{t('folios.chargeTypes.parking')}</option><option value="other">{t('folios.chargeTypes.other')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.amount')}</label>
            <input type="number" step="0.01" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.description')}</label>
            <input type="text" value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button onClick={() => postChargeMutation.mutate()} disabled={!chargeAmount || postChargeMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('folios.postCharge')}</button>
        </div>
      </Modal>

      {/* Record Payment Modal */}
      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={t('folios.recordPayment')}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.method')}</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              <option value="cash">{t('folios.paymentMethods.cash')}</option><option value="credit_card">{t('folios.paymentMethods.credit_card')}</option><option value="debit_card">{t('folios.paymentMethods.debit_card')}</option><option value="bank_transfer">{t('folios.paymentMethods.bank_transfer')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.amount')}</label>
            <input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button onClick={() => recordPaymentMutation.mutate()} disabled={!payAmount || recordPaymentMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('folios.recordPayment')}</button>
        </div>
      </Modal>

      {/* Card pre-auth — Stripe.js tokenizes the card in the browser. */}
      <Modal open={authorizeOpen} onClose={() => setAuthorizeOpen(false)} title={t('folios.authorizeCard')}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.amount')}</label>
            <input
              type="number"
              step="0.01"
              value={authAmount}
              onChange={(e) => setAuthAmount(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
            />
          </div>
          <p className="text-xs text-telivity-mid-grey">{t('folios.authorizeHint')}</p>
          {Number(authAmount) > 0 ? (
            <StripeProvider>
              <CardInput
                submitLabel={t('folios.authorize')}
                disabled={authorizeMutation.isPending}
                onPaymentMethod={(pm) => authorizeMutation.mutate(pm)}
                onError={(msg) => toast('error', msg)}
              />
            </StripeProvider>
          ) : (
            <p className="text-xs text-telivity-mid-grey">{t('folios.authorizeEnterAmount')}</p>
          )}
        </div>
      </Modal>

      <Modal open={!!refundTarget} onClose={() => setRefundTarget(null)} title={t('folios.refund')}>
        <div className="space-y-4">
          <p className="text-sm text-telivity-mid-grey">
            {t('folios.refundHint', { amount: Number(refundTarget?.amount ?? 0).toFixed(2) })}
          </p>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.refundAmountOptional')}</label>
            <input
              type="number"
              step="0.01"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              placeholder={Number(refundTarget?.amount ?? 0).toFixed(2)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
            />
          </div>
          <button
            onClick={() =>
              refundMutation.mutate({
                paymentId: refundTarget!.id,
                amount: refundAmount.trim() || undefined,
              })
            }
            disabled={refundMutation.isPending}
            className="w-full bg-telivity-orange text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('folios.refund')}
          </button>
        </div>
      </Modal>

      <Modal open={!!correctTarget} onClose={() => setCorrectTarget(null)} title={t('folios.correctPayment')}>
        <div className="space-y-4">
          <p className="text-sm text-telivity-mid-grey">{t('folios.correctHint')}</p>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('folios.correctionOp')}</label>
            <select value={correctOp} onChange={(e) => setCorrectOp(e.target.value)} aria-label={t('folios.correctionOp')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">{t('folios.correctionAuto')}</option>
              <option value="void">{t('folios.void')}</option>
              <option value="refund">{t('folios.refund')}</option>
              <option value="adjust">{t('folios.adjust')}</option>
            </select>
          </div>
          <button
            onClick={() => correctMutation.mutate({ paymentId: correctTarget!.id, op: correctOp || undefined })}
            disabled={correctMutation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('folios.applyCorrection')}
          </button>
        </div>
      </Modal>

      <Modal open={arTransferOpen} onClose={() => setArTransferOpen(false)} title={t('folios.transferToAr')}>
        <div className="space-y-4">
          <p className="text-sm text-telivity-mid-grey">
            {t('folios.transferToArHint', { balance: Number(folio.balance ?? 0).toFixed(2) })}
          </p>
          <select
            value={arLedgerId}
            onChange={(e) => setArLedgerId(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">{t('folios.selectArLedger')}</option>
            {arLedgers.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          {arLedgers.length === 0 && (
            <p className="text-xs text-telivity-mid-grey">{t('folios.noOpenArLedgers')}</p>
          )}
          <button
            onClick={() => transferToArMutation.mutate()}
            disabled={!arLedgerId || transferToArMutation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('folios.transferBalance')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default function Folios() {
  return (
    <Routes>
      <Route index element={<FolioList />} />
      <Route path=":id" element={<FolioDetail />} />
    </Routes>
  );
}
