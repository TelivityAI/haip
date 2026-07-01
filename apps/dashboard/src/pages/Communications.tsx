import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, Send, Clock, CheckCircle, Eye } from 'lucide-react';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import { useState } from 'react';

interface CommunicationDecision {
  id: string;
  decisionType: string;
  recommendation: {
    reservationId?: string;
    guestId?: string;
    emailType: string;
    to: string;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    personalizationTokens: string[];
  };
  confidence: string;
  status: string;
  createdAt: string;
}

const EMAIL_TYPE_LABELS: Record<string, string> = {
  confirmation: 'Booking Confirmation',
  pre_arrival: 'Pre-Arrival',
  day_of: 'Day of Arrival',
  welcome: 'Welcome',
  post_stay: 'Post-Stay',
  win_back: 'Win-Back',
};

function statusToColor(status: string) {
  switch (status) {
    case 'auto_executed': return 'success';
    case 'approved': return 'success';
    case 'pending': return 'warning';
    case 'rejected': return 'error';
    default: return 'default';
  }
}

export default function Communications() {
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { data: decisions } = useQuery({
    queryKey: ['agent-decisions', propertyId, 'guest_comms'],
    queryFn: () =>
      api
        .get(`/v1/agents/${propertyId}/guest_comms/decisions`, { params: { limit: 50 } })
        .then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!propertyId,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/v1/agents/${propertyId}/decisions/${id}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-decisions'] }),
  });

  const comms: CommunicationDecision[] = Array.isArray(decisions) ? decisions : [];
  const previewItem = comms.find((c) => c.id === previewId);

  const stats = {
    total: comms.length,
    sent: comms.filter((c) => c.status === 'auto_executed' || c.status === 'approved').length,
    pending: comms.filter((c) => c.status === 'pending').length,
  };

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Mail size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Guest Communications</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-2 text-telivity-mid-grey text-xs font-semibold uppercase mb-1">
            <Mail size={14} /> Total
          </div>
          <p className="text-2xl font-bold text-telivity-navy">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-2 text-telivity-mid-grey text-xs font-semibold uppercase mb-1">
            <CheckCircle size={14} /> Sent
          </div>
          <p className="text-2xl font-bold text-green-600">{stats.sent}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-2 text-telivity-mid-grey text-xs font-semibold uppercase mb-1">
            <Clock size={14} /> Pending Review
          </div>
          <p className="text-2xl font-bold text-telivity-orange">{stats.pending}</p>
        </div>
      </div>

      {/* Communications List */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-telivity-navy">Email Communications</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {comms.map((c) => (
            <div key={c.id} className="px-5 py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-telivity-navy">
                    {EMAIL_TYPE_LABELS[c.recommendation.emailType] ?? c.recommendation.emailType}
                  </span>
                  <StatusBadge
                    status={statusToColor(c.status)}
                    label={c.status.replace('_', ' ')}
                  />
                </div>
                <p className="text-xs text-telivity-mid-grey mt-0.5 truncate">
                  To: {c.recommendation.to} — {c.recommendation.subject}
                </p>
                <p className="text-xs text-telivity-mid-grey">
                  {new Date(c.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPreviewId(previewId === c.id ? null : c.id)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-telivity-slate"
                  title="Preview"
                >
                  <Eye size={16} />
                </button>
                {c.status === 'pending' && (
                  <button
                    onClick={() => approveMutation.mutate(c.id)}
                    disabled={approveMutation.isPending}
                    className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-teal disabled:opacity-50"
                  >
                    <Send size={12} />
                    Send
                  </button>
                )}
              </div>
            </div>
          ))}
          {comms.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-telivity-mid-grey">
              No communications yet. Enable the Guest Communication agent in Settings.
            </div>
          )}
        </div>
      </div>

      {/* Preview Panel */}
      {previewItem && (
        <div className="mt-4 bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-telivity-navy">
              Email Preview — {previewItem.recommendation.subject}
            </h3>
            <button
              onClick={() => setPreviewId(null)}
              className="text-xs text-telivity-mid-grey hover:text-telivity-navy"
            >
              Close
            </button>
          </div>
          <div className="text-xs text-telivity-mid-grey mb-2">
            To: {previewItem.recommendation.to} | Type: {EMAIL_TYPE_LABELS[previewItem.recommendation.emailType]}
          </div>
          <div
            className="border border-gray-200 rounded-lg p-4 text-sm"
            dangerouslySetInnerHTML={{ __html: previewItem.recommendation.bodyHtml }}
          />
          <div className="mt-2 flex gap-2">
            {previewItem.recommendation.personalizationTokens.map((t) => (
              <span key={t} className="text-xs bg-telivity-teal/10 text-telivity-teal px-2 py-0.5 rounded-full">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
