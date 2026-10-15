#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_ROOT, annotationsPath, latestSnapshotPath } from './lib/paths.js';
import { runAnalyze } from './analyze.js';

const PORT = Number(process.env.PORT || process.env.REPO_CONTROL_PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_TOKEN = process.env.REPO_CONTROL_AUTH_TOKEN || '';
const AUTH_DISABLED = process.env.REPO_CONTROL_AUTH_DISABLED === 'true';
/** When true, GET snapshot/UI/graphify are readable without login (Discord Activity). Mutations still require auth. */
const DISCORD_PUBLIC_READ = process.env.REPO_CONTROL_DISCORD_PUBLIC_READ === 'true';
const COOKIE_NAME = 'repo_control_session';
const DEV = process.argv.includes('--dev') || process.env.REPO_CONTROL_DEV === 'true';

const READ_API = new Set(['/api/me', '/api/snapshot', '/api/annotations', '/api/health']);

type AnnotationMap = Record<string, { status: 'acknowledged' | 'false_positive'; note?: string; at: string }>;

function readAnnotations(): AnnotationMap {
  const p = annotationsPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as AnnotationMap;
  } catch {
    return {};
  }
}

function writeAnnotations(map: AnnotationMap): void {
  fs.writeFileSync(annotationsPath(), JSON.stringify(map, null, 2));
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function isAuthed(req: http.IncomingMessage): boolean {
  if (AUTH_DISABLED) return true;
  if (!AUTH_TOKEN) {
    // Local default: allow if token unset AND not production
    return process.env.NODE_ENV !== 'production';
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[COOKIE_NAME] === AUTH_TOKEN) return true;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ') && auth.slice(7) === AUTH_TOKEN) return true;
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const [, pass] = decoded.split(':');
      if (pass === AUTH_TOKEN) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.md': 'text/markdown; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

function safeJoin(root: string, reqPath: string): string | null {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const abs = path.normalize(path.join(root, decoded));
  if (!abs.startsWith(root)) return null;
  return abs;
}

function uiRoot(): string {
  const dist = path.join(PACKAGE_ROOT, 'ui', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) return dist;
  return path.join(PACKAGE_ROOT, 'ui');
}

function graphifyRoots(): string[] {
  return [
    path.join(PACKAGE_ROOT, 'ui', 'public', 'graphify'),
    path.join(PACKAGE_ROOT, 'graphify-out'),
    path.join(PACKAGE_ROOT, '..', '..', 'tools', 'repo-control', 'graphify-out'),
  ];
}

let analyzeInFlight: Promise<unknown> | null = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Health — unauthenticated
    if (pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'repo-control' });
      return;
    }

    if (pathname === '/api/me') {
      const authed = isAuthed(req);
      sendJson(res, 200, {
        authenticated: authed || DISCORD_PUBLIC_READ,
        viewOnly:
          url.searchParams.get('viewOnly') === '1' ||
          url.searchParams.get('discord') === '1' ||
          (DISCORD_PUBLIC_READ && !authed),
        authRequired: Boolean(AUTH_TOKEN) && !AUTH_DISABLED,
        discordPublicRead: DISCORD_PUBLIC_READ,
      });
      return;
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as { token?: string };
      if (!AUTH_TOKEN && process.env.NODE_ENV !== 'production') {
        res.writeHead(200, {
          'Set-Cookie': `${COOKIE_NAME}=local; Path=/; HttpOnly; SameSite=Lax`,
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (!body.token || body.token !== AUTH_TOKEN) {
        sendJson(res, 401, { error: 'invalid_token' });
        return;
      }
      res.writeHead(200, {
        'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(AUTH_TOKEN)}; Path=/; HttpOnly; SameSite=Lax`,
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Graphify static — readable when authed or Discord public-read mode
    if (pathname.startsWith('/graphify/')) {
      if (!isAuthed(req) && !DISCORD_PUBLIC_READ && AUTH_TOKEN && !AUTH_DISABLED) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const rel = pathname.replace(/^\/graphify\//, '');
      for (const root of graphifyRoots()) {
        const file = safeJoin(root, rel);
        if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.writeHead(200, { 'Content-Type': contentType(file) });
          fs.createReadStream(file).pipe(res);
          return;
        }
      }
      sendJson(res, 404, { error: 'graphify_not_found', tried: graphifyRoots() });
      return;
    }

    // API routes require auth; optional public read for Discord Activity GET endpoints
    if (pathname.startsWith('/api/')) {
      const isRead = req.method === 'GET' && READ_API.has(pathname);
      const allow =
        isAuthed(req) ||
        (DISCORD_PUBLIC_READ && isRead) ||
        pathname === '/api/health' ||
        pathname === '/api/me';
      if (!allow) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
    }

    if (pathname === '/api/snapshot') {
      const latest = latestSnapshotPath();
      if (!fs.existsSync(latest)) {
        sendJson(res, 404, {
          error: 'no_snapshot',
          hint: 'POST /api/refresh or run pnpm analyze',
        });
        return;
      }
      const snap = JSON.parse(fs.readFileSync(latest, 'utf8'));
      // Mark stale if file older than config threshold — lightweight
      const ageMin = (Date.now() - new Date(snap.generatedAt).getTime()) / 60000;
      if (ageMin > 60) {
        snap.git = {
          ...snap.git,
          stale: true,
          staleReason: `Snapshot is ${Math.round(ageMin)} minutes old`,
        };
      }
      sendJson(res, 200, snap);
      return;
    }

    if (pathname === '/api/annotations' && req.method === 'GET') {
      sendJson(res, 200, { annotations: readAnnotations() });
      return;
    }

    if (pathname === '/api/annotations' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as {
        id: string;
        status: 'acknowledged' | 'false_positive';
        note?: string;
      };
      if (!body.id || !body.status) {
        sendJson(res, 400, { error: 'id and status required' });
        return;
      }
      const map = readAnnotations();
      map[body.id] = { status: body.status, note: body.note, at: new Date().toISOString() };
      writeAnnotations(map);
      sendJson(res, 200, { annotations: map });
      return;
    }

    if (pathname.startsWith('/api/annotations/') && req.method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/api/annotations/'.length));
      const map = readAnnotations();
      delete map[id];
      writeAnnotations(map);
      sendJson(res, 200, { annotations: map });
      return;
    }

    if (pathname === '/api/refresh' && req.method === 'POST') {
      if (analyzeInFlight) {
        sendJson(res, 409, { error: 'analyze_in_progress' });
        return;
      }
      const skipChecks = url.searchParams.get('skipChecks') === '1';
      analyzeInFlight = runAnalyze({
        skipChecks,
        configPath: process.env.REPO_CONTROL_CONFIG,
      }).finally(() => {
        analyzeInFlight = null;
      });
      const snap = await analyzeInFlight;
      sendJson(res, 200, {
        ok: true,
        generatedAt: (snap as { generatedAt: string }).generatedAt,
      });
      return;
    }

    // Static UI — gated when auth token configured unless Discord public-read
    const canReadUi =
      isAuthed(req) || DISCORD_PUBLIC_READ || AUTH_DISABLED || (!AUTH_TOKEN && process.env.NODE_ENV !== 'production');
    if (!canReadUi && (pathname === '/' || pathname.endsWith('.html'))) {
      // Serve a tiny login shell without the snapshot
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Telivity Repo Control</title>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&display=swap" rel="stylesheet"/>
        <style>body{font-family:Montserrat,sans-serif;background:#0e1118;color:#f0f0f6;display:grid;place-items:center;height:100vh;margin:0}
        form{background:#161a24;border:1px solid #2a3145;padding:24px;border-radius:10px;width:320px}
        h1{color:#06bdb4;margin:0 0 8px;font-size:18px}input,button{width:100%;margin-top:8px;padding:10px;border-radius:6px;border:1px solid #2a3145;background:#0e1118;color:#f0f0f6}
        button{background:#06bdb4;color:#04110f;font-weight:700;border:0;cursor:pointer}</style></head>
        <body><form method="POST" action="/api/login" id="f"><h1>Telivity</h1><p>Repository Control</p>
        <input name="token" id="token" type="password" placeholder="Auth token" />
        <button type="submit">Enter</button></form>
        <script>document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();
          const token=document.getElementById('token').value;
          const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
          if(r.ok) location.reload(); else alert('Invalid token');};</script></body></html>`);
      return;
    }

    // Static UI
    const root = uiRoot();
    const reqPath = pathname === '/' ? '/index.html' : pathname;
    const file = safeJoin(root, reqPath);
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': contentType(file) });
      fs.createReadStream(file).pipe(res);
      return;
    }

    // Also allow /src/* from ui when serving unbuilt tree
    if (pathname.startsWith('/src/')) {
      const srcFile = safeJoin(path.join(PACKAGE_ROOT, 'ui'), pathname);
      if (srcFile && fs.existsSync(srcFile)) {
        res.writeHead(200, { 'Content-Type': contentType(srcFile) });
        fs.createReadStream(srcFile).pipe(res);
        return;
      }
    }

    // SPA fallback
    const index = path.join(root, 'index.html');
    if (fs.existsSync(index) && canReadUi) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(index).pipe(res);
      return;
    }

    sendJson(res, 404, { error: 'not_found', path: pathname });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      service: 'repo-control',
      url: `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`,
      auth: AUTH_DISABLED ? 'disabled' : AUTH_TOKEN ? 'token' : 'open-non-production',
      ui: uiRoot(),
      dev: DEV,
    }),
  );
});

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (!isMain) {
  // imported
}
