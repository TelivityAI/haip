import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Moon, Play, Brain, AlertTriangle, Info, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import KpiCard from '../components/ui/KpiCard';

interface RevenueSummary {
  totalRevenue?: number;
}

interface AuditResult {
  id: string;
  businessDate: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  roomChargesPosted?: string | number;
  noShowsProcessed?: string | number;
  summary?: RevenueSummary | null;
  steps?: { step: string; count: number; status: string }[];
}

function auditRevenue(a: AuditResult): number | null {
  const fromSummary = a.summary?.totalRevenue;
  if (fromSummary != null && !Number.isNaN(Number(fromSummary))) {
    return Number(fromSummary);
  }
  return null;
}

function auditCount(value: string | number | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function formatAuditRevenue(a: AuditResult, empty = '$0.00'): string {
  const rev = auditRevenue(a);
  return rev != null ? `$${rev.toFixed(2)}` : empty;
}

const SEVERITY_ICONS = { critical: XCircle, warning: AlertTriangle, info: Info };
const SEVERITY_COLORS = { critical: 'text-red-600 bg-red-50', warning: 'text-telivity-orange bg-orange-50', info: 'text-blue-500 bg-blue-50' };

function AnomalySection({ propertyId }: { propertyId: string }) {
  const { data: decisions } = useQuery({
    queryKey: ['agent-decisions', propertyId, 'night_audit'],
    queryFn: () => api.get(`/v1/agents/${propertyId}/night_audit/decisions`, { params: { limit: 5 } }).then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!propertyId,
  });

  const latest = Array.isArray(decisions) ? decisions[0] : null;
  const anomalies: any[] = latest?.recommendation?.anomalies ?? [];

  if (anomalies.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 mb-6 border-l-4 border-telivity-teal">
      <div className="flex items-center gap-3 mb-4">
        <Brain size={20} className="text-telivity-teal" />
        <h2 className="text-sm font-semibold text-telivity-navy">AI Anomaly Detection</h2>
        <span className="text-xs text-telivity-mid-grey ml-auto">{anomalies.length} issues found</span>
      </div>
      <div className="space-y-2">
        {anomalies.slice(0, 10).map((a: any, i: number) => {
          const Icon = SEVERITY_ICONS[a.severity as keyof typeof SEVERITY_ICONS] ?? Info;
          const colors = SEVERITY_COLORS[a.severity as keyof typeof SEVERITY_COLORS] ?? SEVERITY_COLORS.info;
          return (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
              <div className={`p-1.5 rounded-lg ${colors}`}><Icon size={14} /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-telivity-navy">{a.description}</p>
                <p className="text-xs text-telivity-mid-grey mt-0.5">{a.suggestedAction}</p>
              </div>
              <span className="text-xs text-telivity-mid-grey whitespace-nowrap">{(a.confidence * 100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function NightAudit() {
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const [auditDate, setAuditDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [lastResult, setLastResult] = useState<AuditResult | null>(null);

  const { data } = useQuery({
    queryKey: ['audit', propertyId],
    queryFn: () => api.get('/v1/night-audit/runs', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const audits: AuditResult[] = data?.data ?? data ?? [];

  const runMutation = useMutation({
    mutationFn: () => api.post('/v1/night-audit/run', { propertyId, businessDate: auditDate }),
    onSuccess: (res) => {
      const payload = res.data?.data ?? res.data;
      setLastResult(payload?.auditRun ?? payload);
      queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Moon size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Night Audit</h1>
      </div>

      {/* AI Anomalies Section */}
      <AnomalySection propertyId={propertyId} />

      {/* Run Audit Panel */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-sm font-semibold text-telivity-navy mb-4">Run Night Audit</h2>
        <div className="flex gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Business Date</label>
            <input type="date" value={auditDate} onChange={(e) => setAuditDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-6 py-2 text-sm font-semibold hover:bg-telivity-light-teal disabled:opacity-50"
          >
            <Play size={16} />
            {runMutation.isPending ? 'Running...' : 'Run Night Audit'}
          </button>
        </div>

        {runMutation.isPending && (
          <div className="mt-4 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-telivity-teal border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-telivity-slate">Processing audit steps...</span>
          </div>
        )}

        {lastResult && (
          <div className="mt-4 grid grid-cols-3 gap-4">
            <KpiCard title="Room Charges" value={auditCount(lastResult.roomChargesPosted)} icon={Moon} />
            <KpiCard title="No-Shows" value={auditCount(lastResult.noShowsProcessed)} icon={Moon} />
            <KpiCard title="Revenue" value={formatAuditRevenue(lastResult)} icon={Moon} />
          </div>
        )}

        {lastResult?.steps && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-telivity-mid-grey uppercase mb-2">Steps</h3>
            <div className="space-y-1">
              {lastResult.steps.map((s, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50">
                  <span className="text-sm text-telivity-navy">{s.step}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-telivity-slate">{s.count}</span>
                    <StatusBadge status={s.status === 'completed' ? 'success' : s.status} label={s.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Audit History */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-telivity-navy">Audit History</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Started</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Completed</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Charges</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">No-Shows</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((a, i) => (
              <tr key={a.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{a.businessDate}</td>
                <td className="px-4 py-3"><StatusBadge status={a.status === 'completed' ? 'success' : a.status} label={a.status} /></td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{a.startedAt ? format(new Date(a.startedAt), 'HH:mm:ss') : '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{a.completedAt ? format(new Date(a.completedAt), 'HH:mm:ss') : '—'}</td>
                <td className="px-4 py-3 text-sm text-right">{auditCount(a.roomChargesPosted)}</td>
                <td className="px-4 py-3 text-sm text-right">{auditCount(a.noShowsProcessed)}</td>
                <td className="px-4 py-3 text-sm text-right font-medium">{formatAuditRevenue(a, '—')}</td>
              </tr>
            ))}
            {audits.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No audit history</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
