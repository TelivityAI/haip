import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import {
  TrendingUp,
  Brain,
  BarChart3,
  Settings2,
  Play,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import KpiCard from '../components/ui/KpiCard';
import StatusBadge from '../components/ui/StatusBadge';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentStatus {
  agentType: string;
  isEnabled: boolean;
  mode: string;
  lastRunAt: string | null;
  lastTrainedAt: string | null;
  pendingDecisions: number;
  hasImplementation: boolean;
}

interface AgentDecision {
  id: string;
  agentType: string;
  decisionType: string;
  recommendation: any;
  confidence: string;
  status: string;
  createdAt: string;
}

interface AgentPerformance {
  agentType: string;
  totalDecisions: number;
  approvedCount: number;
  rejectedCount: number;
  autoExecutedCount: number;
  outcomeCount: number;
  averageConfidence: number;
  approvalRate: number;
}

interface GraphNode {
  agentType: string;
  subgraph: string;
  isEnabled: boolean;
  lastRunAt: string | null;
  hasImplementation: boolean;
}

interface AgentGraph {
  nodes: GraphNode[];
  edges: Array<{ from: string; to: string }>;
  revenueLeverOrder: string[];
}

interface OrchestrationPerformance {
  propertyId: string;
  agents: AgentPerformance[];
  revenueManager: {
    recentRuns: number;
    leverParticipation: Record<string, number>;
    conflictCounts: number;
    averageHorizonDays: number;
  };
}

const AGENT_LABEL_KEYS: Record<string, string> = {
  demand_forecast: 'demandForecast',
  pricing: 'dynamicPricing',
  channel_mix: 'channelMix',
  overbooking: 'overbooking',
  night_audit: 'nightAuditAnomaly',
  housekeeping: 'housekeepingOptimizer',
  cancellation: 'cancellationPredictor',
  revenue_manager: 'revenueManager',
  group_pickup: 'groupPickup',
  ar_collections: 'arCollections',
  deposit_risk: 'depositRisk',
};

function agentLabel(t: TFunction, agentType: string) {
  const key = AGENT_LABEL_KEYS[agentType];
  return key ? t(`revenue.agents.${key}`) : agentType;
}

function decisionLabel(t: TFunction, decisionType: string) {
  const key = decisionType === 'cancellation_risk' ? 'cancellationRisk' : undefined;
  return key ? t(`revenue.decisionTypes.${key}`) : decisionType.replace(/_/g, ' ');
}

/**
 * Agents surfaced on the Revenue console. guest_comms / review_response are
 * driven from the Communications and Reviews pages, so they stay off this list.
 * deposit_risk is a valid agent type with no implementation yet — it renders
 * with Run Now disabled (hasImplementation === false) rather than being hidden.
 */
const AGENT_TYPES = [
  'demand_forecast',
  'pricing',
  'channel_mix',
  'overbooking',
  'night_audit',
  'housekeeping',
  'cancellation',
  'revenue_manager',
  'group_pickup',
  'ar_collections',
  'deposit_risk',
];

// ---------------------------------------------------------------------------
// Revenue Dashboard (top KPIs)
// ---------------------------------------------------------------------------

function RevenueDashboard({ agents }: { agents: AgentStatus[] }) {
  const { t } = useTranslation();
  const pendingTotal = agents.reduce((s, a) => s + a.pendingDecisions, 0);
  const enabledCount = agents.filter((a) => a.isEnabled).length;
  const autopilotCount = agents.filter((a) => a.mode === 'autopilot').length;
  const latestRun = agents
    .filter((a) => a.lastRunAt)
    .sort((a, b) => new Date(b.lastRunAt!).getTime() - new Date(a.lastRunAt!).getTime())[0];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <KpiCard
        title={t('revenue.activeAgents')}
        value={`${enabledCount} / ${agents.length}`}
        subtitle={t('revenue.onAutopilot', { count: autopilotCount })}
        icon={Brain}
      />
      <KpiCard
        title={t('revenue.pendingDecisions')}
        value={pendingTotal}
        subtitle={t('revenue.awaitingApproval')}
        icon={AlertCircle}
      />
      <KpiCard
        title={t('revenue.agentModes')}
        value={autopilotCount > 0 ? t('revenue.modes.autopilot') : enabledCount > 0 ? t('revenue.modes.suggest') : t('revenue.modes.manual')}
        subtitle={t('revenue.inSuggestMode', { count: agents.filter((a) => a.mode === 'suggest').length })}
        icon={Zap}
      />
      <KpiCard
        title={t('revenue.lastRun')}
        value={latestRun?.lastRunAt ? new Date(latestRun.lastRunAt).toLocaleTimeString() : '—'}
        subtitle={latestRun ? agentLabel(t, latestRun.agentType) : t('revenue.noRunsYet')}
        icon={TrendingUp}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// HAIP AI — grounded explanation for a single decision (lazy, on expand)
// ---------------------------------------------------------------------------

function HaipAiExplanation({ propertyId, decisionId }: { propertyId: string; decisionId: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['decision-explain', propertyId, decisionId],
    queryFn: async () => {
      const res = await api.post(`/v1/agents/${propertyId}/decisions/${decisionId}/explain`);
      return res.data?.data ?? res.data;
    },
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className="mb-2 flex items-center gap-1 text-xs text-telivity-mid-grey">
        <Brain size={12} className="text-telivity-teal" /> {t('revenue.aiAnalyzing')}
      </div>
    );
  }

  const explanation = data?.explanation;
  if (!explanation) return null; // model off/unavailable → raw recommendation only

  return (
    <div className="mb-3 rounded-lg border border-telivity-teal/30 bg-telivity-teal/5 p-3">
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-telivity-teal">
        <Brain size={13} /> HAIP AI
      </div>
      <p className="text-sm text-telivity-navy">{explanation.rationale}</p>
      {explanation.suggestions?.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-telivity-slate">
          {explanation.suggestions.map((s: string, i: number) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue orchestration graph (CSS — no graph library)
// ---------------------------------------------------------------------------

function OrchestrationGraphSection({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const { data: graph } = useQuery<AgentGraph>({
    queryKey: ['agent-graph', propertyId],
    queryFn: async () => {
      const res = await api.get(`/v1/agents/${propertyId}/graph`);
      return res.data?.data ?? res.data;
    },
    enabled: !!propertyId,
  });

  const order = graph?.revenueLeverOrder ?? [
    'demand_forecast',
    'pricing',
    'overbooking',
    'channel_mix',
    'group_pickup',
  ];
  const demand = order[0] ?? 'demand_forecast';
  const levers = order.slice(1);
  const nodeByType = new Map((graph?.nodes ?? []).map((n) => [n.agentType, n]));

  const chip = (agentType: string) => {
    const node = nodeByType.get(agentType);
    const disabled = node && !node.isEnabled;
    return (
      <div
        key={agentType}
        className={`rounded-lg border px-3 py-2 text-center text-xs font-medium ${
          disabled
            ? 'border-gray-200 bg-gray-50 text-telivity-mid-grey'
            : 'border-telivity-teal/30 bg-telivity-teal/5 text-telivity-navy'
        }`}
      >
        {agentLabel(t, agentType)}
        {node?.lastRunAt && (
          <div className="mt-0.5 text-[10px] font-normal text-telivity-mid-grey">
            {new Date(node.lastRunAt).toLocaleString()}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
      <div className="flex items-center gap-3 mb-2">
        <Brain size={20} className="text-telivity-teal" />
        <h2 className="text-lg font-semibold text-telivity-navy">{t('revenue.orchestrationGraph')}</h2>
      </div>
      <p className="text-xs text-telivity-mid-grey mb-4">{t('revenue.orchestrationGraphHint')}</p>
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 lg:gap-4">
        <div className="lg:w-40 shrink-0">{chip(demand)}</div>
        <div className="hidden lg:block text-telivity-mid-grey text-lg">→</div>
        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2">
          {levers.map((l) => chip(l))}
        </div>
        <div className="hidden lg:block text-telivity-mid-grey text-lg">→</div>
        <div className="lg:w-44 shrink-0">{chip('revenue_manager')}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RManager recent runs
// ---------------------------------------------------------------------------

function RManagerRunsSection({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: decisions = [] } = useQuery<AgentDecision[]>({
    queryKey: ['agent-decisions', propertyId, 'revenue_manager'],
    queryFn: async () => {
      const res = await api.get(`/v1/agents/${propertyId}/revenue_manager/decisions`, {
        params: { limit: 15 },
        skipErrorToast: true,
      });
      return (res.data?.data ?? res.data ?? []) as AgentDecision[];
    },
    enabled: !!propertyId,
  });

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <TrendingUp size={20} className="text-telivity-teal" />
        <h2 className="text-lg font-semibold text-telivity-navy">{t('revenue.rmanagerRuns')}</h2>
      </div>
      {decisions.length === 0 ? (
        <p className="text-sm text-telivity-mid-grey text-center py-6">{t('revenue.noRManagerRuns')}</p>
      ) : (
        <div className="space-y-2">
          {decisions.map((d) => (
            <div key={d.id} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-center gap-3 flex-wrap">
                <StatusBadge
                  status={
                    d.status === 'approved' || d.status === 'auto_executed'
                      ? 'success'
                      : d.status === 'rejected'
                        ? 'error'
                        : d.status
                  }
                  label={
                    d.status === 'auto_executed'
                      ? t('revenue.autoExecuted')
                      : t(`revenue.decisionStatuses.${d.status}`, { defaultValue: d.status })
                  }
                />
                <span className="text-sm text-telivity-navy font-medium">
                  {decisionLabel(t, d.decisionType)}
                </span>
                <span className="text-xs text-telivity-mid-grey">
                  {t('revenue.confidence')}: {(parseFloat(d.confidence) * 100).toFixed(0)}%
                </span>
                <span className="text-xs text-telivity-mid-grey ml-auto">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
                <button
                  onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                  className="text-telivity-slate hover:text-telivity-navy"
                >
                  {expandedId === d.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
              {expandedId === d.id && (
                <div className="mt-3 bg-gray-50 rounded-lg p-3">
                  <HaipAiExplanation propertyId={propertyId} decisionId={d.id} />
                  <pre className="text-xs text-telivity-slate whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(d.recommendation, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Recommendations (pending decisions table)
// ---------------------------------------------------------------------------

function RecommendationsSection({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch decisions for each agent
  const { data: allDecisions = [] } = useQuery({
    queryKey: ['agent-decisions', propertyId],
    queryFn: async () => {
      const perAgent = await Promise.all(
        AGENT_TYPES.map((type) =>
          api
            .get(`/v1/agents/${propertyId}/${type}/decisions`, {
              params: { limit: 20 },
              skipErrorToast: true,
            })
            .then((res) => (res.data?.data ?? res.data ?? []) as AgentDecision[])
            .catch((err) => {
              console.error(`Failed to fetch agent decisions for ${type}:`, err);
              return [] as AgentDecision[];
            }), // agent may have no config/decisions yet
        ),
      );
      return perAgent
        .flat()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    enabled: !!propertyId,
  });

  const approveMutation = useMutation({
    mutationFn: (decisionId: string) =>
      api.post(`/v1/agents/${propertyId}/decisions/${decisionId}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-decisions'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: (decisionId: string) =>
      api.post(`/v1/agents/${propertyId}/decisions/${decisionId}/reject`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-decisions'] }),
  });

  const filtered = filter === 'all'
    ? allDecisions
    : allDecisions.filter((d) => d.agentType === filter);

  const pending = filtered.filter((d) => d.status === 'pending');
  const others = filtered.filter((d) => d.status !== 'pending');

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        <Brain size={20} className="text-telivity-teal shrink-0 mt-0.5" />
        <h2 className="text-lg font-semibold text-telivity-navy">{t('revenue.aiRecommendations')}</h2>
        <div className="ml-auto flex flex-wrap gap-2 justify-end">
          {['all', ...AGENT_TYPES].map((agentType) => (
            <button
              key={agentType}
              onClick={() => setFilter(agentType)}
              className={`text-xs px-3 py-1 rounded-full font-medium ${
                filter === agentType
                  ? 'bg-telivity-teal text-white'
                  : 'bg-gray-100 text-telivity-slate hover:bg-gray-200'
              }`}
            >
              {agentType === 'all' ? t('revenue.all') : agentLabel(t, agentType)}
            </button>
          ))}
        </div>
      </div>

      {/* Pending decisions */}
      {pending.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-telivity-slate uppercase mb-2">{t('revenue.pendingApproval', { count: pending.length })}</p>
          <div className="space-y-2">
            {pending.map((d) => (
              <div key={d.id} className="border border-telivity-teal/20 rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <StatusBadge status="pending" label={agentLabel(t, d.agentType)} />
                  <span className="text-sm text-telivity-navy font-medium">{decisionLabel(t, d.decisionType)}</span>
                  <span className="text-xs text-telivity-mid-grey">
                    {t('revenue.confidence')}: {(parseFloat(d.confidence) * 100).toFixed(0)}%
                  </span>
                  <span className="text-xs text-telivity-mid-grey ml-auto">
                    {new Date(d.createdAt).toLocaleString()}
                  </span>
                  <button
                    onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                    className="text-telivity-slate hover:text-telivity-navy"
                  >
                    {expandedId === d.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <button
                    onClick={() => approveMutation.mutate(d.id)}
                    disabled={approveMutation.isPending}
                    className="flex items-center gap-1 bg-telivity-teal text-white text-xs px-3 py-1 rounded-lg hover:bg-telivity-dark-teal"
                  >
                    <Check size={14} /> {t('revenue.approve')}
                  </button>
                  <button
                    onClick={() => rejectMutation.mutate(d.id)}
                    disabled={rejectMutation.isPending}
                    className="flex items-center gap-1 border border-gray-200 text-telivity-slate text-xs px-3 py-1 rounded-lg hover:bg-gray-100"
                  >
                    <X size={14} /> {t('revenue.reject')}
                  </button>
                </div>
                {expandedId === d.id && (
                  <div className="mt-3 bg-gray-50 rounded-lg p-3">
                    <HaipAiExplanation propertyId={propertyId} decisionId={d.id} />
                    <pre className="text-xs text-telivity-slate whitespace-pre-wrap overflow-x-auto">
                      {JSON.stringify(d.recommendation, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent decisions */}
      {others.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-telivity-slate uppercase mb-2">{t('revenue.recentDecisions')}</p>
          <table className="w-full">
            <thead>
              <tr className="bg-telivity-teal/5 border-b border-gray-100">
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('revenue.agent')}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('revenue.type')}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('revenue.confidence')}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('revenue.status')}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('revenue.date')}</th>
              </tr>
            </thead>
            <tbody>
              {others.slice(0, 10).map((d, i) => (
                <tr key={d.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-3 py-2 text-sm text-telivity-navy">{agentLabel(t, d.agentType)}</td>
                  <td className="px-3 py-2 text-sm text-telivity-slate">{decisionLabel(t, d.decisionType)}</td>
                  <td className="px-3 py-2 text-sm text-telivity-slate">{(parseFloat(d.confidence) * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      status={d.status === 'approved' || d.status === 'auto_executed' ? 'success' : d.status === 'rejected' ? 'error' : d.status}
                      label={d.status === 'auto_executed' ? t('revenue.autoExecuted') : t(`revenue.decisionStatuses.${d.status}`, { defaultValue: d.status })}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-telivity-mid-grey">{new Date(d.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allDecisions.length === 0 && (
        <p className="text-sm text-telivity-mid-grey text-center py-8">{t('revenue.noAgentDecisions')}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Performance
// ---------------------------------------------------------------------------

function PerformanceSection({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const { data: orch } = useQuery<OrchestrationPerformance>({
    queryKey: ['agent-performance', propertyId],
    queryFn: async () => {
      const res = await api.get(`/v1/agents/${propertyId}/orchestration-performance`, {
        skipErrorToast: true,
      });
      return res.data?.data ?? res.data;
    },
    enabled: !!propertyId,
  });

  const performances = (orch?.agents ?? []).filter((p) => AGENT_TYPES.includes(p.agentType));
  const rm = orch?.revenueManager;

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <BarChart3 size={20} className="text-telivity-teal" />
        <h2 className="text-lg font-semibold text-telivity-navy">{t('revenue.agentPerformance')}</h2>
      </div>

      {rm && (
        <div className="mb-4 border border-telivity-teal/20 rounded-lg p-4 bg-telivity-teal/5">
          <h3 className="text-sm font-semibold text-telivity-navy mb-2">
            {t('revenue.orchestrationSummary')}
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs mb-2">
            <div className="flex justify-between">
              <span className="text-telivity-mid-grey">{t('revenue.rmanagerRuns')}</span>
              <span className="font-medium text-telivity-navy">{rm.recentRuns}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-telivity-mid-grey">{t('revenue.orchestrationHorizon')}</span>
              <span className="font-medium text-telivity-navy">{rm.averageHorizonDays}</span>
            </div>
          </div>
          <p className="text-[10px] uppercase text-telivity-mid-grey mb-1">
            {t('revenue.orchestrationLevers')}
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(rm.leverParticipation ?? {}).map(([k, v]) => (
              <span
                key={k}
                className="text-[10px] px-2 py-0.5 rounded bg-white border border-gray-100 text-telivity-slate"
              >
                {agentLabel(t, k)}: {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {performances.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {performances.map((p) => (
            <div
              key={p.agentType}
              className={`border rounded-lg p-4 ${
                p.agentType === 'revenue_manager'
                  ? 'border-telivity-teal/40'
                  : 'border-gray-100'
              }`}
            >
              <h3 className="text-sm font-semibold text-telivity-navy mb-2">{agentLabel(t, p.agentType)}</h3>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">{t('revenue.totalDecisions')}</span>
                  <span className="text-telivity-navy font-medium">{p.totalDecisions}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">{t('revenue.approved')}</span>
                  <span className="text-telivity-dark-teal font-medium">{p.approvedCount}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">{t('revenue.rejected')}</span>
                  <span className="text-telivity-orange font-medium">{p.rejectedCount}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">{t('revenue.autoExecuted')}</span>
                  <span className="text-telivity-navy font-medium">{p.autoExecutedCount}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">{t('revenue.averageConfidence')}</span>
                  <span className="text-telivity-navy font-medium">{(p.averageConfidence * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">{t('revenue.approvalRate')}</span>
                  <span className="text-telivity-navy font-medium">{p.approvalRate}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-telivity-mid-grey text-center py-4">{t('revenue.noPerformanceData')}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Settings
// ---------------------------------------------------------------------------

function SettingsSection({ propertyId, agents }: { propertyId: string; agents: AgentStatus[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const updateConfigMutation = useMutation({
    mutationFn: ({ agentType, updates }: { agentType: string; updates: Record<string, unknown> }) =>
      api.put(`/v1/agents/${propertyId}/${agentType}/config`, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  const runAgentMutation = useMutation({
    mutationFn: (agentType: string) =>
      api.post(`/v1/agents/${propertyId}/${agentType}/run`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent-decisions'] });
      queryClient.invalidateQueries({ queryKey: ['agent-performance'] });
    },
  });

  const revenueAgents = agents.filter((a) => AGENT_TYPES.includes(a.agentType));

  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-3 mb-4">
        <Settings2 size={20} className="text-telivity-teal" />
        <h2 className="text-lg font-semibold text-telivity-navy">{t('revenue.agentSettings')}</h2>
      </div>

      <div className="space-y-3">
        {revenueAgents.map((agent) => (
          <div key={agent.agentType} className="border border-gray-100 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-telivity-navy">
                  {agentLabel(t, agent.agentType)}
                </h3>
                <p className="text-xs text-telivity-mid-grey mt-0.5">
                  {t('revenue.lastRun')}: {agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : t('channels.never')}
                  {agent.pendingDecisions > 0 && ` | ${t('revenue.pendingCount', { count: agent.pendingDecisions })}`}
                </p>
              </div>

              {/* Enable toggle */}
              <label className="flex items-center gap-2 text-xs text-telivity-slate cursor-pointer">
                <input
                  type="checkbox"
                  checked={agent.isEnabled}
                  onChange={(e) =>
                    updateConfigMutation.mutate({
                      agentType: agent.agentType,
                      updates: { isEnabled: e.target.checked },
                    })
                  }
                  className="rounded border-gray-300 text-telivity-teal focus:ring-telivity-teal"
                />
                {t('revenue.enabled')}
              </label>

              {/* Mode selector */}
              <select
                value={agent.mode}
                onChange={(e) =>
                  updateConfigMutation.mutate({
                    agentType: agent.agentType,
                    updates: { mode: e.target.value },
                  })
                }
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-telivity-slate"
              >
                <option value="manual">{t('revenue.modes.manual')}</option>
                <option value="suggest">{t('revenue.modes.suggest')}</option>
                <option value="autopilot">{t('revenue.modes.autopilot')}</option>
              </select>

              {/* Run Now button */}
              <button
                onClick={() => runAgentMutation.mutate(agent.agentType)}
                disabled={runAgentMutation.isPending || !agent.hasImplementation}
                className="flex items-center gap-1 bg-telivity-teal text-white text-xs px-3 py-1.5 rounded-lg hover:bg-telivity-dark-teal disabled:opacity-50"
              >
                <Play size={14} /> {t('revenue.runNow')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue Page (main)
// ---------------------------------------------------------------------------

export default function Revenue() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();

  const { data: agentStatuses = [] } = useQuery<AgentStatus[]>({
    queryKey: ['agents', propertyId],
    queryFn: () => api.get(`/v1/agents/${propertyId}`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!propertyId,
  });

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        {t('common.selectProperty')}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <TrendingUp size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('revenue.title')}</h1>
      </div>

      <RevenueDashboard agents={agentStatuses} />
      <OrchestrationGraphSection propertyId={propertyId} />
      <RManagerRunsSection propertyId={propertyId} />
      <RecommendationsSection propertyId={propertyId} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PerformanceSection propertyId={propertyId} />
        <SettingsSection propertyId={propertyId} agents={agentStatuses} />
      </div>
    </div>
  );
}
