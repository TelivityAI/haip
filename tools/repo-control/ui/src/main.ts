import './styles.css';
import { initDiscordActivity } from './discord';

type Snapshot = {
  schemaVersion: number;
  generatedAt: string;
  productSummary: string;
  configPath: string;
  git: {
    branch: string;
    commit: string;
    shortCommit: string;
    dirty: boolean;
    dirtyPaths: string[];
    analyzedCommit: string;
    analyzedAt: string;
    stale: boolean;
    staleReason: string | null;
  };
  checks: Record<
    string,
    {
      id: string;
      label: string;
      status: string;
      summary: string;
      command: string;
      durationMs: number | null;
    }
  >;
  capabilities: Array<{
    id: string;
    name: string;
    status: string;
    exists: string;
    missing: string;
    files: string[];
    routes: string[];
    tests: string[];
    verification: string;
    consequence: string;
  }>;
  findings: Array<{
    id: string;
    category: string;
    capability: string | null;
    severity: string;
    confidence: string;
    evidenceClass: string;
    title: string;
    explanation: string;
    evidence: Array<{
      kind: string;
      path?: string;
      line?: number;
      command?: string;
      summary: string;
    }>;
    suggestedAction: string;
    verificationLimits: string;
    analyzedCommit: string;
    analyzedAt: string;
    observedFailure?: boolean;
  }>;
  recentChanges: {
    commits: Array<{
      sha: string;
      subject: string;
      date: string;
      capabilities: string[];
    }>;
    uncommitted: string[];
  };
  nextActions: Array<{
    rank: number;
    title: string;
    why: string;
    confidence: string;
    effortEstimate: string | null;
    findingIds: string[];
  }>;
  runtime: { status: string; note: string; sources: string[] };
  collectors: Array<{ id: string; status: string; durationMs: number; summary: string; error?: string | null }>;
  graphify: {
    status: string;
    summary: string;
    nodeCount: number | null;
    edgeCount: number | null;
    htmlPath: string | null;
  };
  comparison: {
    previousGeneratedAt: string;
    newFindingIds: string[];
    resolvedFindingIds: string[];
    recurringFindingIds: string[];
  } | null;
};

type Annotations = Record<string, { status: 'acknowledged' | 'false_positive'; note?: string }>;

const app = document.getElementById('app')!;
const state: {
  snapshot: Snapshot | null;
  annotations: Annotations;
  viewOnly: boolean;
  authed: boolean;
  query: string;
  severity: string;
  category: string;
  status: string;
  confidence: string;
  drawer: null | { kind: 'finding' | 'capability' | 'graphify' | 'compare'; id?: string };
  error: string | null;
  refreshing: boolean;
} = {
  snapshot: null,
  annotations: {},
  viewOnly: false,
  authed: false,
  query: '',
  severity: '',
  category: '',
  status: '',
  confidence: '',
  drawer: null,
  error: null,
  refreshing: false,
};

async function boot(): Promise<void> {
  const discord = await initDiscordActivity();
  state.viewOnly = discord.viewOnly;

  const me = await api<{ authenticated: boolean; viewOnly?: boolean }>('/api/me');
  state.authed = me.authenticated;
  if (me.viewOnly) state.viewOnly = true;

  if (!state.authed && !state.viewOnly) {
    renderLogin();
    return;
  }

  await loadData();
  render();
}

function renderLogin(): void {
  app.innerHTML = `
    <div class="login">
      <h1>Telivity</h1>
      <p>Repository Control — owner access</p>
      <input id="token" type="password" placeholder="Auth token" />
      <button class="btn primary" id="loginBtn" style="width:100%">Enter</button>
      <p style="font-size:11px">Set <code>REPO_CONTROL_AUTH_TOKEN</code> on the server. Never commit secrets.</p>
      <div id="loginErr" class="sev-critical"></div>
    </div>`;
  document.getElementById('loginBtn')!.addEventListener('click', async () => {
    const token = (document.getElementById('token') as HTMLInputElement).value;
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      (document.getElementById('loginErr') as HTMLElement).textContent = 'Invalid token';
      return;
    }
    state.authed = true;
    await loadData();
    render();
  });
}

async function loadData(): Promise<void> {
  try {
    const [snap, ann] = await Promise.all([
      api<Snapshot>('/api/snapshot'),
      api<{ annotations: Annotations }>('/api/annotations'),
    ]);
    state.snapshot = snap;
    state.annotations = ann.annotations ?? {};
    state.error = null;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401) {
    state.authed = false;
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

function render(): void {
  const s = state.snapshot;
  if (!s) {
    app.innerHTML = `<div class="shell"><div class="empty">${escapeHtml(state.error || 'No snapshot. Run analyze or Refresh.')}</div>
      <button class="btn primary" id="refresh">Refresh analysis</button></div>`;
    bindChrome();
    return;
  }

  const findings = filteredFindings(s);
  const caps = filteredCapabilities(s);

  app.innerHTML = `
  <div class="shell">
    <div class="topbar">
      <div class="brand">
        <div class="brand-mark">Telivity</div>
        <div class="brand-sub">Repo Control · Discord</div>
      </div>
      ${state.viewOnly ? '<div class="viewonly">Discord view-only</div>' : '<div class="viewonly" style="border-color:rgba(6,189,180,.35);color:var(--teal)">Activity origin — use in Discord</div>'}
      <div class="search">
        <input id="q" placeholder="Search capabilities & findings…" value="${escapeAttr(state.query)}" />
        <div class="filters">
          ${select('severity', ['', 'critical', 'high', 'medium', 'low'], state.severity)}
          ${select('category', ['', ...unique(s.findings.map((f) => f.category))], state.category)}
          ${select('status', ['', ...unique(s.capabilities.map((c) => c.status))], state.status)}
          ${select('confidence', ['', 'high', 'medium', 'low'], state.confidence)}
        </div>
      </div>
      <button class="btn" id="exportJson" ${state.viewOnly ? 'disabled' : ''}>Export JSON</button>
      <button class="btn" id="exportMd" ${state.viewOnly ? 'disabled' : ''}>Export MD</button>
      <button class="btn" id="compareBtn">Compare</button>
      <button class="btn primary" id="refresh" ${state.viewOnly || state.refreshing ? 'disabled' : ''}>${state.refreshing ? 'Refreshing…' : 'Refresh'}</button>
    </div>

    <div class="status-strip">
      <div class="status-meta">
        <span class="kv">Branch <strong>${escapeHtml(s.git.branch)}</strong></span>
        <span class="kv">Commit <strong>${escapeHtml(s.git.shortCommit)}</strong></span>
        <span class="kv">Dirty <strong>${s.git.dirty ? `yes (${s.git.dirtyPaths.length})` : 'no'}</strong></span>
        <span class="kv">Analyzed <strong>${escapeHtml(fmtTime(s.git.analyzedAt))}</strong></span>
        <span class="kv">${s.git.stale ? `<span class="stale-flag">STALE</span> ${escapeHtml(s.git.staleReason || '')}` : '<strong>Current</strong> snapshot'}</span>
      </div>
      <div class="check-chips">
        ${Object.values(s.checks)
          .map(
            (c) =>
              `<span class="chip ${c.status}" title="${escapeAttr(c.summary)}">${escapeHtml(c.label)} · ${escapeHtml(c.status)}</span>`,
          )
          .join('')}
      </div>
      <div class="kv">Findings <strong>${s.findings.length}</strong> · Caps <strong>${s.capabilities.length}</strong></div>
    </div>

    <div class="main-grid">
      <section class="panel" style="grid-row: span 2">
        <h2>Product capability matrix</h2>
        <div class="product-blurb">${escapeHtml(s.productSummary)}</div>
        <div class="panel-body">
          <table class="cap-table">
            <thead><tr><th>Capability</th><th>Status</th><th>Exists / gap</th></tr></thead>
            <tbody>
              ${caps
                .map(
                  (c) => `<tr data-cap="${escapeAttr(c.id)}">
                    <td>${escapeHtml(c.name)}</td>
                    <td><span class="badge ${c.status}">${escapeHtml(labelStatus(c.status))}</span></td>
                    <td>${escapeHtml(truncate(c.exists, 90))}<div class="meta" style="color:var(--muted);font-size:10px">${escapeHtml(truncate(c.missing, 90))}</div></td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <h2>Issues & unfinished work</h2>
        <div class="panel-body">
          ${findings.length === 0 ? '<div class="empty">No findings match filters.</div>' : ''}
          ${findings
            .slice(0, 40)
            .map((f) => {
              const ann = state.annotations[f.id];
              return `<div class="finding ${ann ? 'ack' : ''}" data-finding="${escapeAttr(f.id)}">
                <div class="title"><span class="sev-${f.severity}">${escapeHtml(f.severity)}</span> · ${escapeHtml(f.title)}</div>
                <div class="meta"><span class="ec-${f.evidenceClass}">${escapeHtml(f.evidenceClass)}</span> · ${escapeHtml(f.category)} · conf ${escapeHtml(f.confidence)}${ann ? ` · ${ann.status}` : ''}${f.observedFailure ? ' · observed' : ' · risk'}</div>
              </div>`;
            })
            .join('')}
        </div>
      </section>

      <section class="panel">
        <h2>Graphify map</h2>
        <div class="graphify-tile">
          <div class="product-blurb">${escapeHtml(s.graphify.summary)}</div>
          <div class="graphify-preview" id="openGraphify">
            <div>
              <div style="font-weight:700;color:var(--teal);margin-bottom:4px">Open & drill in</div>
              <div class="muted">${s.graphify.nodeCount ?? '—'} nodes · ${s.graphify.edgeCount ?? '—'} edges · ${escapeHtml(s.graphify.status)}</div>
            </div>
          </div>
          <button class="btn" id="openGraphifyBtn">Open Graphify</button>
        </div>
      </section>

      <section class="panel">
        <h2>Bloat & maintainability</h2>
        <div class="panel-body">
          ${s.findings
            .filter((f) => ['bloat', 'duplication', 'complexity'].includes(f.category))
            .filter((f) => matchesFilters(f))
            .slice(0, 25)
            .map(
              (f) => `<div class="finding" data-finding="${escapeAttr(f.id)}">
                <div class="title">${escapeHtml(f.title)}</div>
                <div class="meta"><span class="ec-${f.evidenceClass}">${escapeHtml(f.evidenceClass)}</span> · ${escapeHtml(f.confidence)}</div>
              </div>`,
            )
            .join('') || '<div class="empty">No bloat candidates in this snapshot.</div>'}
        </div>
      </section>

      <section class="panel">
        <h2>Recent & next actions</h2>
        <div class="panel-body">
          <div style="margin-bottom:6px;font-weight:600">Next 5</div>
          <ol class="next-list">
            ${s.nextActions
              .map(
                (a) =>
                  `<li><strong>${escapeHtml(a.title)}</strong><div class="meta" style="color:var(--muted)">${escapeHtml(a.why)}</div></li>`,
              )
              .join('')}
          </ol>
          <div style="margin:8px 0 4px;font-weight:600">Recent commits</div>
          ${s.recentChanges.commits
            .slice(0, 6)
            .map(
              (c) =>
                `<div class="finding" style="cursor:default"><div class="title">${escapeHtml(c.sha)} ${escapeHtml(c.subject)}</div><div class="meta">${escapeHtml(c.date)} · caps: ${escapeHtml(c.capabilities.join(', ') || '—')}</div></div>`,
            )
            .join('')}
          <div style="margin-top:8px" class="runtime-box">
            <strong>Runtime telemetry: ${escapeHtml(s.runtime.status)}</strong>
            <div>${escapeHtml(s.runtime.note)}</div>
          </div>
        </div>
      </section>
    </div>

    <div class="footer">
      <div>Snapshot ${escapeHtml(s.generatedAt)} · schema v${s.schemaVersion} · collectors: ${s.collectors.map((c) => `${c.id}:${c.status}`).join(', ')}</div>
      <div>No health score. Counts are explicit. Facts ≠ heuristics ≠ inferences.</div>
    </div>
  </div>
  ${renderDrawer(s)}`;

  bindChrome();
}

function renderDrawer(s: Snapshot): string {
  if (!state.drawer) return '';
  if (state.drawer.kind === 'graphify') {
    return `<div class="drawer-backdrop" id="backdrop"><div class="drawer wide">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border)">
        <h3 style="margin:0">Graphify map</h3>
        <button class="btn" id="closeDrawer">Close</button>
      </div>
      <iframe src="/graphify/graph.html" title="Graphify" style="border:0;flex:1;width:100%;height:100%;background:#0f121c"></iframe>
    </div></div>`;
  }
  if (state.drawer.kind === 'compare') {
    const cmp = s.comparison;
    return `<div class="drawer-backdrop" id="backdrop"><div class="drawer">
      <button class="btn" id="closeDrawer">Close</button>
      <h3>Snapshot comparison</h3>
      ${
        cmp
          ? `<p>Previous: ${escapeHtml(cmp.previousGeneratedAt)}</p>
             <p>New: ${cmp.newFindingIds.length} · Resolved: ${cmp.resolvedFindingIds.length} · Recurring: ${cmp.recurringFindingIds.length}</p>
             <pre>${escapeHtml(JSON.stringify(cmp, null, 2))}</pre>`
          : '<p class="empty">No previous snapshot to compare.</p>'
      }
    </div></div>`;
  }
  if (state.drawer.kind === 'capability') {
    const c = s.capabilities.find((x) => x.id === state.drawer?.id);
    if (!c) return '';
    return `<div class="drawer-backdrop" id="backdrop"><div class="drawer">
      <button class="btn" id="closeDrawer">Close</button>
      <h3>${escapeHtml(c.name)}</h3>
      <p><span class="badge ${c.status}">${escapeHtml(labelStatus(c.status))}</span></p>
      <p><strong>Exists:</strong> ${escapeHtml(c.exists)}</p>
      <p><strong>Missing:</strong> ${escapeHtml(c.missing)}</p>
      <p><strong>Verification:</strong> ${escapeHtml(c.verification)}</p>
      <p><strong>Consequence:</strong> ${escapeHtml(c.consequence)}</p>
      <p><strong>Files</strong></p>
      <pre>${escapeHtml(c.files.join('\n') || '—')}</pre>
      <p><strong>Routes</strong></p>
      <pre>${escapeHtml(c.routes.join('\n') || '—')}</pre>
      <p><strong>Tests</strong></p>
      <pre>${escapeHtml(c.tests.join('\n') || '—')}</pre>
    </div></div>`;
  }
  const f = s.findings.find((x) => x.id === state.drawer?.id);
  if (!f) return '';
  const ann = state.annotations[f.id];
  return `<div class="drawer-backdrop" id="backdrop"><div class="drawer">
    <button class="btn" id="closeDrawer">Close</button>
    <h3>${escapeHtml(f.title)}</h3>
    <p class="meta"><span class="sev-${f.severity}">${escapeHtml(f.severity)}</span> · <span class="ec-${f.evidenceClass}">${escapeHtml(f.evidenceClass)}</span> · ${escapeHtml(f.confidence)} · ${escapeHtml(f.category)}</p>
    <p>${escapeHtml(f.explanation)}</p>
    <p><strong>Suggested:</strong> ${escapeHtml(f.suggestedAction)}</p>
    <p><strong>Limits:</strong> ${escapeHtml(f.verificationLimits)}</p>
    <p><strong>Analyzed:</strong> ${escapeHtml(f.analyzedCommit.slice(0, 8))} @ ${escapeHtml(f.analyzedAt)}</p>
    <div class="evidence"><strong>Evidence</strong>
      ${f.evidence
        .map((e) => {
          const label = e.path
            ? `${e.path}${e.line ? `:${e.line}` : ''}`
            : e.command || e.summary;
          const href = e.path ? fileUrl(e.path, e.line) : null;
          return `<div>${href ? `<a href="${href}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label)} — ${escapeHtml(e.summary)}</div>`;
        })
        .join('')}
    </div>
    ${
      state.viewOnly
        ? ''
        : `<div style="margin-top:12px;display:flex;gap:6px">
      <button class="btn" data-ann="acknowledged">Acknowledge</button>
      <button class="btn" data-ann="false_positive">False positive</button>
      <button class="btn" data-ann="clear">Clear annotation</button>
    </div>
    <p class="meta">Annotations do not alter scan evidence.${ann ? ` Current: ${ann.status}` : ''}</p>`
    }
  </div></div>`;
}

function bindChrome(): void {
  document.getElementById('q')?.addEventListener('input', (e) => {
    state.query = (e.target as HTMLInputElement).value;
    render();
  });
  for (const id of ['severity', 'category', 'status', 'confidence'] as const) {
    document.getElementById(id)?.addEventListener('change', (e) => {
      state[id] = (e.target as HTMLSelectElement).value;
      render();
    });
  }
  document.getElementById('refresh')?.addEventListener('click', async () => {
    if (state.viewOnly) return;
    state.refreshing = true;
    render();
    try {
      await api('/api/refresh', { method: 'POST' });
      await loadData();
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.refreshing = false;
      render();
    }
  });
  document.getElementById('exportJson')?.addEventListener('click', () => download('repo-control-findings.json', JSON.stringify(state.snapshot, null, 2)));
  document.getElementById('exportMd')?.addEventListener('click', () => download('repo-control-findings.md', toMarkdown(state.snapshot!)));
  document.getElementById('compareBtn')?.addEventListener('click', () => {
    state.drawer = { kind: 'compare' };
    render();
  });
  document.getElementById('openGraphify')?.addEventListener('click', openGraphify);
  document.getElementById('openGraphifyBtn')?.addEventListener('click', openGraphify);
  document.querySelectorAll('[data-finding]').forEach((el) => {
    el.addEventListener('click', () => {
      state.drawer = { kind: 'finding', id: (el as HTMLElement).dataset.finding };
      render();
    });
  });
  document.querySelectorAll('[data-cap]').forEach((el) => {
    el.addEventListener('click', () => {
      state.drawer = { kind: 'capability', id: (el as HTMLElement).dataset.cap };
      render();
    });
  });
  document.getElementById('closeDrawer')?.addEventListener('click', () => {
    state.drawer = null;
    render();
  });
  document.getElementById('backdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      state.drawer = null;
      render();
    }
  });
  document.querySelectorAll('[data-ann]').forEach((el) => {
    el.addEventListener('click', async () => {
      const action = (el as HTMLElement).dataset.ann!;
      const id = state.drawer?.id;
      if (!id) return;
      if (action === 'clear') {
        await api('/api/annotations/' + encodeURIComponent(id), { method: 'DELETE' });
      } else {
        await api('/api/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: action }),
        });
      }
      await loadData();
      render();
    });
  });
}

function openGraphify(): void {
  state.drawer = { kind: 'graphify' };
  render();
}

function filteredFindings(s: Snapshot) {
  return [...s.findings]
    .filter((f) => !['bloat', 'duplication', 'complexity'].includes(f.category) || state.category !== '')
    .filter((f) => matchesFilters(f))
    .sort((a, b) => score(b) - score(a));
}

function filteredCapabilities(s: Snapshot) {
  const q = state.query.trim().toLowerCase();
  return s.capabilities.filter((c) => {
    if (state.status && c.status !== state.status) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.id.includes(q) ||
      c.exists.toLowerCase().includes(q) ||
      c.missing.toLowerCase().includes(q)
    );
  });
}

function matchesFilters(f: Snapshot['findings'][number]): boolean {
  if (state.severity && f.severity !== state.severity) return false;
  if (state.category && f.category !== state.category) return false;
  if (state.confidence && f.confidence !== state.confidence) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return (
    f.title.toLowerCase().includes(q) ||
    f.explanation.toLowerCase().includes(q) ||
    f.id.includes(q) ||
    (f.capability ?? '').includes(q)
  );
}

function score(f: Snapshot['findings'][number]): number {
  const sev = { critical: 40, high: 30, medium: 20, low: 10 }[f.severity] ?? 0;
  const conf = { high: 3, medium: 2, low: 1 }[f.confidence] ?? 0;
  return sev + conf + (f.observedFailure ? 10 : 0);
}

function select(id: string, options: string[], value: string): string {
  return `<select id="${id}">${options
    .map(
      (o) =>
        `<option value="${escapeAttr(o)}" ${o === value ? 'selected' : ''}>${escapeHtml(o || id)}</option>`,
    )
    .join('')}</select>`;
}

function unique(arr: string[]): string[] {
  return [...new Set(arr)].sort();
}

function labelStatus(s: string): string {
  return s.replace(/_/g, ' ');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fileUrl(p: string, line?: number): string {
  // Relative path link — works in VS Code/Cursor simple browser poorly; still useful as copyable path
  return `#file=${encodeURIComponent(p)}${line ? `&line=${line}` : ''}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function download(name: string, body: string): void {
  const blob = new Blob([body], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toMarkdown(s: Snapshot): string {
  const lines = [
    `# Repository Control — ${s.generatedAt}`,
    '',
    s.productSummary,
    '',
    `Branch \`${s.git.branch}\` @ \`${s.git.shortCommit}\` dirty=${s.git.dirty}`,
    '',
    '## Checks',
    ...Object.values(s.checks).map((c) => `- ${c.label}: **${c.status}** — ${c.summary}`),
    '',
    '## Capabilities',
    ...s.capabilities.map((c) => `- ${c.name}: **${c.status}** — ${c.exists}`),
    '',
    '## Findings',
    ...s.findings.map(
      (f) =>
        `### ${f.id}\n- ${f.severity}/${f.confidence}/${f.evidenceClass}\n- ${f.title}\n- ${f.explanation}\n- Action: ${f.suggestedAction}\n`,
    ),
    '',
    '## Next actions',
    ...s.nextActions.map((a) => `${a.rank}. ${a.title} — ${a.why}`),
  ];
  return lines.join('\n');
}

boot().catch((err) => {
  app.innerHTML = `<div class="login"><h1>Telivity</h1><p class="sev-critical">${escapeHtml(String(err))}</p></div>`;
});
