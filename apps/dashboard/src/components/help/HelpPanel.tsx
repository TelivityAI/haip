import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, CircleHelp, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';

interface HelpEntry {
  route: string;
  title: string;
  summary: string;
  bullets: string[];
  related?: Array<{ label: string; href: string }>;
  aiAvailable?: boolean;
  normalizedRoute?: string;
}

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function HelpPanel({ open, onClose }: HelpPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [explainOpen, setExplainOpen] = useState(false);

  const route = location.pathname || '/';

  const { data: help, isFetching, error } = useQuery({
    queryKey: ['help', route],
    queryFn: () =>
      api.get('/v1/help', { params: { route } }).then((r) => (r.data?.data ?? r.data) as HelpEntry),
    enabled: open,
    retry: false,
  });

  const explainMutation = useMutation({
    mutationFn: () =>
      api
        .post('/v1/help/explain', {
          route: help?.normalizedRoute ?? route,
          facts: {},
        })
        .then((r) => r.data?.data ?? r.data),
  });

  useEffect(() => {
    if (!open) {
      setExplainOpen(false);
      explainMutation.reset();
    }
  }, [open]);

  if (!open) return null;

  const explanation = explainMutation.data?.explanation;

  return (
    <div className="fixed inset-0 z-[90] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside
        className="relative w-full max-w-md bg-white shadow-2xl border-l border-gray-200 h-full overflow-y-auto"
        role="dialog"
        aria-label="Help"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <CircleHelp size={18} className="text-telivity-teal" />
            <h2 className="text-sm font-semibold text-telivity-navy">Help</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-telivity-light-grey" aria-label="Close help">
            <X size={16} className="text-telivity-mid-grey" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {isFetching && <p className="text-sm text-telivity-mid-grey">Loading…</p>}
          {error && (
            <p className="text-sm text-telivity-mid-grey">
              No help is available for this screen yet.
            </p>
          )}
          {help && (
            <>
              <div>
                <h3 className="text-lg font-semibold text-telivity-navy">{help.title}</h3>
                <p className="text-sm text-telivity-slate mt-2">{help.summary}</p>
              </div>
              {help.bullets?.length > 0 && (
                <ul className="space-y-2">
                  {help.bullets.map((b) => (
                    <li key={b} className="text-sm text-telivity-slate flex gap-2">
                      <span className="text-telivity-teal mt-1.5 w-1.5 h-1.5 rounded-full bg-telivity-teal flex-shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              {help.related && help.related.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-telivity-mid-grey uppercase mb-2">Related</p>
                  <div className="flex flex-wrap gap-2">
                    {help.related.map((r) => (
                      <button
                        key={r.href}
                        onClick={() => {
                          navigate(r.href);
                          onClose();
                        }}
                        className="text-xs font-medium text-telivity-teal border border-telivity-teal/30 rounded-lg px-3 py-1.5 hover:bg-telivity-teal/5"
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {help.aiAvailable && (
                <div className="border-t border-gray-100 pt-4">
                  <button
                    onClick={() => {
                      setExplainOpen(true);
                      if (!explainMutation.data && !explainMutation.isPending) {
                        explainMutation.mutate();
                      }
                    }}
                    className="flex items-center gap-2 text-sm font-medium text-telivity-teal hover:underline"
                  >
                    <Sparkles size={14} />
                    Explain with HAIP AI
                  </button>
                  {explainOpen && (
                    <div className="mt-3 bg-telivity-light-grey/60 rounded-lg p-3 text-sm text-telivity-slate">
                      {explainMutation.isPending && <p>Generating…</p>}
                      {!explainMutation.isPending && !explanation && (
                        <p className="text-telivity-mid-grey">
                          No explanation available (AI off or not enough numeric screen facts).
                        </p>
                      )}
                      {explanation && (
                        <>
                          <p>{explanation.rationale}</p>
                          {Array.isArray(explanation.suggestions) && explanation.suggestions.length > 0 && (
                            <ul className="mt-2 list-disc list-inside space-y-1">
                              {explanation.suggestions.map((s: string) => (
                                <li key={s}>{s}</li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
