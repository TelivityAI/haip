import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

const AGENT_LABELS: Record<string, string> = {
  demand_forecast: 'Demand Forecast',
  pricing: 'Dynamic Pricing',
  channel_mix: 'Channel Mix',
  overbooking: 'Overbooking',
  night_audit: 'Night Audit Anomaly',
  housekeeping: 'Housekeeping Optimizer',
  cancellation: 'Cancellation Predictor',
};

const AGENT_TYPES = ['demand_forecast', 'pricing', 'channel_mix', 'overbooking', 'night_audit', 'housekeeping', 'cancellation'];

// ---------------------------------------------------------------------------
// Revenue Dashboard (top KPIs)
// ---------------------------------------------------------------------------

function RevenueDashboard({ agents }: { agents: AgentStatus[] }) {
  const pendingTotal = agents.reduce((s, a) => s + a.pendingDecisions, 0);
  const enabledCount = agents.filter((a) => a.isEnabled).length;
  const autopilotCount = agents.filter((a) => a.mode === 'autopilot').length;
  const latestRun = agents
    .filter((a) => a.lastRunAt)
    .sort((a, b) => new Date(b.lastRunAt!).getTime() - new Date(a.lastRunAt!).getTime())[0];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <KpiCard
        title="Active Agents"
        value={`${enabledCount} / ${agents.length}`}
        subtitle={`${autopilotCount} on autopilot`}
        icon={Brain}
      />
      <KpiCard
        title="Pending Decisions"
        value={pendingTotal}
        subtitle="Awaiting approval"
        icon={AlertCircle}
      />
      <KpiCard
        title="Agent Modes"
        value={autopilotCount > 0 ? 'Autopilot' : enabledCount > 0 ? 'Suggest' : 'Manual'}
        subtitle={agents.filter((a) => a.mode === 'suggest').length + ' in suggest mode'}
        icon={Zap}
      />
      <KpiCard
        title="Last Run"
        value={latestRun?.lastRunAt ? new Date(latestRun.lastRunAt).toLocaleTimeString() : '—'}
        subtitle={latestRun ? AGENT_LABELS[latestRun.agentType] ?? latestRun.agentType : 'No runs yet'}
        icon={TrendingUp}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// HAIP AI — grounded explanation for a single decision (lazy, on expand)
// ---------------------------------------------------------------------------

function HaipAiExplanation({ propertyId, decisionId }: { propertyId: string; decisionId: string }) {
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
        <Brain size={12} className="text-telivity-teal" /> HAIP AI is analyzing…
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
// AI Recommendations (pending decisions table)
// ---------------------------------------------------------------------------

function RecommendationsSection({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch decisions for each agent
  const { data: allDecisions = [] } = useQuery({
    queryKey: ['agent-decisions', propertyId],
    queryFn: async () => {
      const results: AgentDecision[] = [];
      for (const type of AGENT_TYPES) {
        try {
          const res = await api.get(`/v1/agents/${propertyId}/decisions/${type}`, { params: { limit: 20 } });
          const items = res.data?.data ?? res.data ?? [];
          results.push(...items);
        } catch { /* agent may not exist */ }
      }
      return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
      <div className="flex items-center gap-3 mb-4">
        <Brain size={20} className="text-telivity-teal" />
        <h2 className="text-lg font-semibold text-telivity-navy">AI Recommendations</h2>
        <div className="ml-auto flex gap-2">
          {['all', ...AGENT_TYPES].map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`text-xs px-3 py-1 rounded-full font-medium ${
                filter === t
                  ? 'bg-telivity-teal text-white'
                  : 'bg-gray-100 text-telivity-slate hover:bg-gray-200'
              }`}
            >
              {t === 'all' ? 'All' : AGENT_LABELS[t] ?? t}
            </button>
          ))}
        </div>
      </div>

      {/* Pending decisions */}
      {pending.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-telivity-slate uppercase mb-2">Pending Approval ({pending.length})</p>
          <div className="space-y-2">
            {pending.map((d) => (
              <div key={d.id} className="border border-telivity-teal/20 rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <StatusBadge status="pending" label={AGENT_LABELS[d.agentType] ?? d.agentType} />
                  <span className="text-sm text-telivity-navy font-medium">{d.decisionType.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-telivity-mid-grey">
                    Confidence: {(parseFloat(d.confidence) * 100).toFixed(0)}%
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
                    <Check size={14} /> Approve
                  </button>
                  <button
                    onClick={() => rejectMutation.mutate(d.id)}
                    disabled={rejectMutation.isPending}
                    className="flex items-center gap-1 border border-gray-200 text-telivity-slate text-xs px-3 py-1 rounded-lg hover:bg-gray-100"
                  >
                    <X size={14} /> Reject
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
          <p className="text-xs font-semibold text-telivity-slate uppercase mb-2">Recent Decisions</p>
          <table className="w-full">
            <thead>
              <tr className="bg-telivity-teal/5 border-b border-gray-100">
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">Agent</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">Confidence</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">Date</th>
              </tr>
            </thead>
            <tbody>
              {others.slice(0, 10).map((d, i) => (
                <tr key={d.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-3 py-2 text-sm text-telivity-navy">{AGENT_LABELS[d.agentType] ?? d.agentType}</td>
                  <td className="px-3 py-2 text-sm text-telivity-slate">{d.decisionType.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-sm text-telivity-slate">{(parseFloat(d.confidence) * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      status={d.status === 'approved' || d.status === 'auto_executed' ? 'success' : d.status === 'rejected' ? 'error' : d.status}
                      label={d.status === 'auto_executed' ? 'Auto' : d.status}
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
        <p className="text-sm text-telivity-mid-grey text-center py-8">No agent decisions yet. Run an agent to see recommendations.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Performance
// ---------------------------------------------------------------------------

function PerformanceSection({ propertyId }: { propertyId: string }) {
  const { data: performances = [] } = useQuery({
    queryKey: ['agent-performance', propertyId],
    queryFn: async () => {
      const results: AgentPerformance[] = [];
      for (const type of AGENT_TYPES) {
        try {
          const res = await api.get(`/v1/agents/${propertyId}/performance/${type}`);
          results.push(res.data?.data ?? res.data);
        } catch { /* skip */ }
      }
      return results;
    },
    enabled: !!propertyId,
  });

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <BarChart3 size={20} className="text-telivity-teal" />
        <h2 className="text-lg font-semibold text-telivity-navy">Agent Performance</h2>
      </div>

      {performances.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {performances.map((p) => (
            <div key={p.agentType} className="border border-gray-100 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-telivity-navy mb-2">{AGENT_LABELS[p.agentType] ?? p.agentType}</h3>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">Total Decisions</span>
                  <span className="text-telivity-navy font-medium">{p.totalDecisions}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">Approved</span>
                  <span className="text-telivity-dark-teal font-medium">{p.approvedCount}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">Rejected</span>
                  <span className="text-telivity-orange font-medium">{p.rejectedCount}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">Auto-Executed</span>
                  <span className="text-telivity-navy font-medium">{p.autoExecutedCount}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">Avg Confidence</span>
                  <span className="text-telivity-navy font-medium">{(p.averageConfidence * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-telivity-mid-grey">Approval Rate</span>
                  <span className="text-telivity-navy font-medium">{p.approvalRate}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-telivity-mid-grey text-center py-4">No performance data yet.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Settings
// ---------------------------------------------------------------------------

function SettingsSection({ propertyId, agents }: { propertyId: string; agents: AgentStatus[] }) {
  const queryClient = useQueryClient();

  const updateConfigMutation = useMutation({
    mutationFn: ({ agentType, updates }: { agentType: string; updates: Record<string, unknown> }) =>
      api.put(`/v1/agents/${propertyId}/config/${agentType}`, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  const runAgentMutation = useMutation({
    mutationFn: (agentType: string) =>
      api.post(`/v1/agents/${propertyId}/run/${agentType}`),
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
        <h2 className="text-lg font-semibold text-telivity-navy">Agent Settings</h2>
      </div>

      <div className="space-y-3">
        {revenueAgents.map((agent) => (
          <div key={agent.agentType} className="border border-gray-100 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-telivity-navy">
                  {AGENT_LABELS[agent.agentType] ?? agent.agentType}
                </h3>
                <p className="text-xs text-telivity-mid-grey mt-0.5">
                  Last run: {agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : 'Never'}
                  {agent.pendingDecisions > 0 && ` | ${agent.pendingDecisions} pending`}
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
                Enabled
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
                <option value="manual">Manual</option>
                <option value="suggest">Suggest</option>
                <option value="autopilot">Autopilot</option>
              </select>

              {/* Run Now button */}
              <button
                onClick={() => runAgentMutation.mutate(agent.agentType)}
                disabled={runAgentMutation.isPending || !agent.hasImplementation}
                className="flex items-center gap-1 bg-telivity-teal text-white text-xs px-3 py-1.5 rounded-lg hover:bg-telivity-dark-teal disabled:opacity-50"
              >
                <Play size={14} /> Run Now
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
  const { propertyId } = useProperty();

  const { data: agentStatuses = [] } = useQuery<AgentStatus[]>({
    queryKey: ['agents', propertyId],
    queryFn: () => api.get(`/v1/agents/${propertyId}`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!propertyId,
  });

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        Select a property
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <TrendingUp size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Revenue Management</h1>
      </div>

      <RevenueDashboard agents={agentStatuses} />
      <RecommendationsSection propertyId={propertyId} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PerformanceSection propertyId={propertyId} />
        <SettingsSection propertyId={propertyId} agents={agentStatuses} />
      </div>
    </div>
  );
}
