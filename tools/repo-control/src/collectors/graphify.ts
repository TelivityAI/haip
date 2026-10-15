import fs from 'node:fs';
import path from 'node:path';
import type { CollectorResult, GraphifyInfo, RepoControlConfig } from '../lib/types.js';
import { runCommand } from '../lib/exec.js';

export async function collectGraphify(
  config: RepoControlConfig,
): Promise<{ data: GraphifyInfo; collector: CollectorResult }> {
  const started = Date.now();
  const root = config.repoRoot!;
  const dirRel = config.graphifyDir;
  const dirAbs = path.isAbsolute(dirRel) ? dirRel : path.join(root, dirRel);

  if (!config.graphifyEnabled) {
    return {
      data: emptyGraphify('skipped', dirAbs, 'Graphify disabled in config.'),
      collector: {
        id: 'graphify',
        status: 'skipped',
        durationMs: Date.now() - started,
        summary: 'disabled',
      },
    };
  }

  // Prefer existing artifacts if present
  const existing = inspectGraphifyDir(dirAbs);
  if (existing.status === 'ready') {
    return {
      data: existing,
      collector: {
        id: 'graphify',
        status: 'ok',
        durationMs: Date.now() - started,
        summary: `using existing map (${existing.nodeCount ?? '?'} nodes)`,
      },
    };
  }

  fs.mkdirSync(dirAbs, { recursive: true });

  // Try graphify CLI (PyPI package graphifyy exposes `graphify`)
  const env = { ...process.env, GRAPHIFY_OUT: dirAbs };
  const attempts = [
    `graphify cluster-only "${root}" --no-label`,
    `python3 -m graphify cluster-only "${root}" --no-label`,
    `graphify export html`,
  ];

  let lastError = '';
  for (const cmd of attempts.slice(0, 2)) {
    const result = await runCommand(cmd, {
      cwd: root,
      timeoutMs: config.graphifyTimeoutMs,
      env,
    });
    if (result.timedOut) {
      return {
        data: emptyGraphify('failed', dirAbs, `Graphify timed out after ${config.graphifyTimeoutMs}ms`),
        collector: {
          id: 'graphify',
          status: 'timeout',
          durationMs: Date.now() - started,
          summary: 'timed out',
          error: result.stderr || result.stdout,
        },
      };
    }
    if (result.ok) {
      // optionally export html if missing
      const after = inspectGraphifyDir(dirAbs);
      if (after.status === 'ready' && !after.htmlPath) {
        await runCommand('graphify export html', { cwd: root, timeoutMs: 60_000, env });
      }
      const final = inspectGraphifyDir(dirAbs);
      return {
        data: final,
        collector: {
          id: 'graphify',
          status: final.status === 'ready' ? 'ok' : 'failed',
          durationMs: Date.now() - started,
          summary: final.summary,
          error: final.status === 'ready' ? null : 'graphify ran but outputs incomplete',
        },
      };
    }
    lastError = result.stderr || result.stdout || 'unknown error';
    if (result.unavailable || /not found|No module named|Cannot find/i.test(lastError)) {
      // try install once
      const pip = await runCommand('pip3 install --user graphifyy', {
        cwd: root,
        timeoutMs: 180_000,
      });
      if (pip.ok) {
        const retry = await runCommand(`graphify cluster-only "${root}" --no-label`, {
          cwd: root,
          timeoutMs: config.graphifyTimeoutMs,
          env,
        });
        if (retry.ok) {
          await runCommand('graphify export html', { cwd: root, timeoutMs: 60_000, env });
          const final = inspectGraphifyDir(dirAbs);
          return {
            data: final,
            collector: {
              id: 'graphify',
              status: final.status === 'ready' ? 'ok' : 'failed',
              durationMs: Date.now() - started,
              summary: final.summary,
            },
          };
        }
        lastError = retry.stderr || retry.stdout || lastError;
      } else {
        lastError = `graphify unavailable; pip install failed: ${pip.stderr || pip.stdout}`;
      }
      break;
    }
  }

  // Fallback: generate a minimal structural graph from api modules so the UI block still drills in
  const fallback = writeFallbackGraph(root, dirAbs);
  return {
    data: {
      ...fallback,
      summary: `Graphify CLI unavailable (${lastError.slice(0, 160)}). Served structural fallback map.`,
    },
    collector: {
      id: 'graphify',
      status: 'ok',
      durationMs: Date.now() - started,
      summary: 'fallback structural map',
      error: lastError.slice(0, 500),
    },
  };
}

function inspectGraphifyDir(dirAbs: string): GraphifyInfo {
  if (!fs.existsSync(dirAbs)) {
    return emptyGraphify('missing', dirAbs, 'graphify-out directory not found');
  }
  const html = pickFirst(dirAbs, ['graph.html', 'index.html']);
  const json = pickFirst(dirAbs, ['graph.json']);
  const report = pickFirst(dirAbs, ['GRAPH_REPORT.md']);
  let nodeCount: number | null = null;
  let edgeCount: number | null = null;
  if (json) {
    try {
      const g = JSON.parse(fs.readFileSync(json, 'utf8')) as {
        nodes?: unknown[];
        links?: unknown[];
        edges?: unknown[];
      };
      nodeCount = Array.isArray(g.nodes) ? g.nodes.length : null;
      edgeCount = Array.isArray(g.links)
        ? g.links.length
        : Array.isArray(g.edges)
          ? g.edges.length
          : null;
    } catch {
      /* ignore */
    }
  }
  if (html || json) {
    return {
      status: 'ready',
      dir: dirAbs,
      htmlPath: html,
      jsonPath: json,
      reportPath: report,
      nodeCount,
      edgeCount,
      summary: `Graph ready (${nodeCount ?? '?'} nodes, ${edgeCount ?? '?'} edges)`,
    };
  }
  return emptyGraphify('missing', dirAbs, 'No graph.html/graph.json in graphify dir');
}

function pickFirst(dir: string, names: string[]): string | null {
  for (const n of names) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return p;
  }
  // shallow search
  try {
    for (const ent of fs.readdirSync(dir)) {
      if (names.includes(ent)) return path.join(dir, ent);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function emptyGraphify(
  status: GraphifyInfo['status'],
  dir: string | null,
  summary: string,
): GraphifyInfo {
  return {
    status,
    dir,
    htmlPath: null,
    jsonPath: null,
    reportPath: null,
    nodeCount: null,
    edgeCount: null,
    summary,
  };
}

function writeFallbackGraph(repoRoot: string, dirAbs: string): GraphifyInfo {
  const modulesDir = path.join(repoRoot, 'apps/api/src/modules');
  const nodes: Array<{ id: string; label: string; source_file?: string }> = [
    { id: 'haip', label: 'HAIP', source_file: 'README.md' },
    { id: 'api', label: 'apps/api', source_file: 'apps/api' },
    { id: 'dashboard', label: 'apps/dashboard', source_file: 'apps/dashboard' },
    { id: 'booking', label: 'apps/booking', source_file: 'apps/booking' },
    { id: 'database', label: 'packages/database', source_file: 'packages/database' },
    { id: 'shared', label: 'packages/shared', source_file: 'packages/shared' },
  ];
  const links: Array<{ source: string; target: string; relationship: string }> = [
    { source: 'haip', target: 'api', relationship: 'contains' },
    { source: 'haip', target: 'dashboard', relationship: 'contains' },
    { source: 'haip', target: 'booking', relationship: 'contains' },
    { source: 'haip', target: 'database', relationship: 'contains' },
    { source: 'haip', target: 'shared', relationship: 'contains' },
    { source: 'api', target: 'database', relationship: 'uses' },
    { source: 'api', target: 'shared', relationship: 'uses' },
    { source: 'dashboard', target: 'api', relationship: 'calls' },
    { source: 'booking', target: 'api', relationship: 'calls' },
  ];

  if (fs.existsSync(modulesDir)) {
    for (const name of fs.readdirSync(modulesDir)) {
      const abs = path.join(modulesDir, name);
      if (!fs.statSync(abs).isDirectory()) continue;
      const id = `mod:${name}`;
      nodes.push({
        id,
        label: name,
        source_file: `apps/api/src/modules/${name}`,
      });
      links.push({ source: 'api', target: id, relationship: 'module' });
    }
  }

  fs.mkdirSync(dirAbs, { recursive: true });
  const jsonPath = path.join(dirAbs, 'graph.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ nodes, links }, null, 2));

  const htmlPath = path.join(dirAbs, 'graph.html');
  fs.writeFileSync(htmlPath, renderFallbackHtml(nodes, links));

  const reportPath = path.join(dirAbs, 'GRAPH_REPORT.md');
  fs.writeFileSync(
    reportPath,
    `# Graphify fallback map\n\nGenerated because the Graphify CLI was unavailable.\n\n- Nodes: ${nodes.length}\n- Links: ${links.length}\n- Source: API modules + apps/packages layout\n`,
  );

  return {
    status: 'ready',
    dir: dirAbs,
    htmlPath,
    jsonPath,
    reportPath,
    nodeCount: nodes.length,
    edgeCount: links.length,
    summary: `Fallback structural map (${nodes.length} nodes)`,
  };
}

function renderFallbackHtml(
  nodes: Array<{ id: string; label: string; source_file?: string }>,
  links: Array<{ source: string; target: string; relationship: string }>,
): string {
  const data = JSON.stringify({ nodes, links });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>HAIP structural map (Graphify fallback)</title>
  <style>
    :root { --bg:#0f121c; --fg:#f0f0f6; --teal:#06bdb4; --navy:#23273d; --muted:#bbbbc4; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Montserrat, system-ui, sans-serif; background:var(--bg); color:var(--fg); }
    header { padding:10px 14px; background:var(--navy); border-bottom:1px solid #333; display:flex; gap:12px; align-items:center; }
    header strong { color:var(--teal); }
    #layout { display:grid; grid-template-columns: 1fr 320px; height: calc(100vh - 48px); }
    canvas { width:100%; height:100%; background: radial-gradient(ellipse at top, #1a2030, #0f121c); }
    aside { border-left:1px solid #333; padding:12px; overflow:auto; background:#141824; }
    .muted { color:var(--muted); font-size:12px; }
    .node-list button { display:block; width:100%; text-align:left; background:transparent; border:0; color:var(--fg); padding:6px 4px; cursor:pointer; border-radius:4px; }
    .node-list button:hover, .node-list button.active { background:#1e2436; color:var(--teal); }
    input { width:100%; padding:8px; margin-bottom:8px; border-radius:6px; border:1px solid #333; background:#0f121c; color:var(--fg); }
  </style>
</head>
<body>
  <header>
    <strong>Telivity</strong>
    <span>Graphify drill-in (structural fallback)</span>
    <span class="muted" id="stats"></span>
  </header>
  <div id="layout">
    <canvas id="c"></canvas>
    <aside>
      <input id="q" placeholder="Filter nodes…" />
      <div class="muted" id="detail">Click a node to inspect.</div>
      <div class="node-list" id="list"></div>
    </aside>
  </div>
  <script>
    const data = ${data};
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const detail = document.getElementById('detail');
    const list = document.getElementById('list');
    const q = document.getElementById('q');
    document.getElementById('stats').textContent = data.nodes.length + ' nodes · ' + data.links.length + ' edges';

    function resize() {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      draw();
    }
    const positions = new Map();
    const cx = () => canvas.clientWidth / 2;
    const cy = () => canvas.clientHeight / 2;
    data.nodes.forEach((n, i) => {
      const angle = (i / data.nodes.length) * Math.PI * 2;
      const r = n.id.startsWith('mod:') ? Math.min(canvas.clientWidth, canvas.clientHeight) * 0.35 : 80;
      positions.set(n.id, { x: cx() + Math.cos(angle) * r, y: cy() + Math.sin(angle) * r });
    });
    // recenter after first layout once sized
    function layout() {
      data.nodes.forEach((n, i) => {
        const angle = (i / Math.max(data.nodes.length, 1)) * Math.PI * 2;
        const core = !n.id.startsWith('mod:');
        const r = core ? 90 : Math.min(canvas.clientWidth, canvas.clientHeight) * 0.38;
        positions.set(n.id, { x: cx() + Math.cos(angle) * r, y: cy() + Math.sin(angle) * r });
      });
    }

    let selected = null;
    function draw() {
      layout();
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.strokeStyle = '#2a3148';
      ctx.lineWidth = 1;
      for (const e of data.links) {
        const a = positions.get(e.source); const b = positions.get(e.target);
        if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (const n of data.nodes) {
        const p = positions.get(n.id); if (!p) continue;
        const active = selected === n.id;
        ctx.beginPath();
        ctx.fillStyle = active ? '#06bdb4' : n.id.startsWith('mod:') ? '#444863' : '#016491';
        ctx.arc(p.x, p.y, active ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f0f0f6';
        ctx.font = '11px Montserrat, sans-serif';
        ctx.fillText(n.label, p.x + 10, p.y + 3);
      }
    }

    function renderList() {
      const term = q.value.trim().toLowerCase();
      list.innerHTML = '';
      data.nodes.filter(n => !term || n.label.toLowerCase().includes(term) || (n.source_file||'').includes(term))
        .slice(0, 200)
        .forEach(n => {
          const b = document.createElement('button');
          b.textContent = n.label;
          b.className = selected === n.id ? 'active' : '';
          b.onclick = () => { selected = n.id; detail.innerHTML = '<strong>' + n.label + '</strong><div class="muted">' + (n.source_file || '') + '</div>'; draw(); renderList(); };
          list.appendChild(b);
        });
    }
    canvas.addEventListener('click', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      let hit = null;
      for (const n of data.nodes) {
        const p = positions.get(n.id); if (!p) continue;
        if ((p.x - x) ** 2 + (p.y - y) ** 2 < 100) { hit = n; break; }
      }
      if (hit) { selected = hit.id; detail.innerHTML = '<strong>' + hit.label + '</strong><div class="muted">' + (hit.source_file || '') + '</div>'; draw(); renderList(); }
    });
    q.addEventListener('input', renderList);
    window.addEventListener('resize', resize);
    resize(); renderList();
  </script>
</body>
</html>`;
}
