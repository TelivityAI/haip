#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_ROOT, annotationsPath, latestSnapshotPath } from './lib/paths.js';
import { runAnalyze } from './analyze.js';
import {
  clerkEnabled,
  publicClerkConfig,
  resolveClerkIdentity,
  type ClerkIdentity,
} from './lib/clerk-auth.js';

/** Load gitignored .env next to this package (never commit secrets). */
function loadDotEnv(): void {
  const envPath = path.join(PACKAGE_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const PORT = Number(process.env.PORT || process.env.REPO_CONTROL_PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_TOKEN = process.env.REPO_CONTROL_AUTH_TOKEN || '';
const AUTH_DISABLED = process.env.REPO_CONTROL_AUTH_DISABLED === 'true';
/** Discord Activity proxy may read snapshot/UI without Clerk. */
const DISCORD_PUBLIC_READ = process.env.REPO_CONTROL_DISCORD_PUBLIC_READ === 'true';
const COOKIE_NAME = 'repo_control_session';
const DEV = process.argv.includes('--dev') || process.env.REPO_CONTROL_DEV === 'true';

const READ_API = new Set(['/api/me', '/api/snapshot', '/api/annotations', '/api/health', '/api/public-config']);

type AnnotationMap = Record<
  string,
  { status: 'acknowledged' | 'false_positive'; note?: string; at: string }
>;

type Access = {
  /** Can read snapshot / UI */
  canRead: boolean;
  /** Can refresh / annotate */
  canWrite: boolean;
  viewOnly: boolean;
  via: 'discord' | 'clerk' | 'owner_token' | 'open_dev' | 'none';
  clerk: ClerkIdentity | null;
};

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

function ownerTokenOk(req: http.IncomingMessage): boolean {
  if (AUTH_DISABLED) return true;
  if (!AUTH_TOKEN) return false;
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

async function resolveAccess(
  req: http.IncomingMessage,
  url: URL,
): Promise<Access> {
  const referer = String(req.headers.referer || req.headers.referrer || '');
  const fromDiscordProxy =
    referer.includes('discordsays.com') ||
    url.searchParams.get('discord') === '1' ||
    url.pathname.startsWith('/discord') ||
    Boolean(req.headers['x-discord-activity']);

  if (AUTH_DISABLED) {
    return { canRead: true, canWrite: true, viewOnly: false, via: 'open_dev', clerk: null };
  }

  if (ownerTokenOk(req)) {
    return { canRead: true, canWrite: true, viewOnly: false, via: 'owner_token', clerk: null };
  }

  const clerk = await resolveClerkIdentity(req);
  if (clerk) {
    const canWrite = clerk.isOwner;
    return {
      canRead: true,
      canWrite,
      viewOnly: !canWrite,
      via: 'clerk',
      clerk,
    };
  }

  // Discord Activity iframe only — not arbitrary browsers (Clerk covers those)
  if (DISCORD_PUBLIC_READ && fromDiscordProxy) {
    return {
      canRead: true,
      canWrite: false,
      viewOnly: true,
      via: 'discord',
      clerk: null,
    };
  }

  // Local non-production without Clerk/token: open for agent testing
  if (!AUTH_TOKEN && !clerkEnabled() && process.env.NODE_ENV !== 'production') {
    return { canRead: true, canWrite: true, viewOnly: false, via: 'open_dev', clerk: null };
  }

  return { canRead: false, canWrite: false, viewOnly: true, via: 'none', clerk: null };
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
    const access = await resolveAccess(req, url);

    if (pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'repo-control' });
      return;
    }

    if (pathname === '/api/public-config') {
      sendJson(res, 200, {
        clerk: publicClerkConfig(),
        discordClientId:
          process.env.VITE_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || null,
        discordPublicRead: DISCORD_PUBLIC_READ,
      });
      return;
    }

    if (pathname === '/api/me') {
      sendJson(res, 200, {
        authenticated: access.canRead,
        viewOnly: access.viewOnly || !access.canWrite,
        authRequired: !AUTH_DISABLED && (Boolean(AUTH_TOKEN) || clerkEnabled()),
        discordPublicRead: DISCORD_PUBLIC_READ,
        clerkEnabled: clerkEnabled(),
        via: access.via,
        user: access.clerk
          ? { id: access.clerk.userId, email: access.clerk.email, isOwner: access.clerk.isOwner }
          : null,
        canWrite: access.canWrite,
      });
      return;
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      // Legacy owner-token cookie login (optional alongside Clerk)
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as { token?: string };
      if (!AUTH_TOKEN && process.env.NODE_ENV !== 'production' && !clerkEnabled()) {
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

    if (pathname.startsWith('/graphify/')) {
      if (!access.canRead && !DISCORD_PUBLIC_READ) {
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

    if (pathname.startsWith('/api/')) {
      const isRead = req.method === 'GET' && READ_API.has(pathname);
      const isWrite = !isRead;
      if (isWrite && !access.canWrite) {
        sendJson(res, 401, { error: 'unauthorized', hint: 'owner_required' });
        return;
      }
      if (isRead && !access.canRead && pathname !== '/api/public-config' && pathname !== '/api/health' && pathname !== '/api/me') {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
    }

    if (pathname === '/api/snapshot') {
      if (!access.canRead) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const latest = latestSnapshotPath();
      if (!fs.existsSync(latest)) {
        sendJson(res, 404, {
          error: 'no_snapshot',
          hint: 'POST /api/refresh or run pnpm analyze',
        });
        return;
      }
      const snap = JSON.parse(fs.readFileSync(latest, 'utf8'));
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
      if (!access.canRead) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
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

    // Always serve SPA shell when Clerk is enabled so the sign-in UI can mount.
    // Snapshot APIs remain protected.
    const serveShell =
      access.canRead ||
      clerkEnabled() ||
      DISCORD_PUBLIC_READ ||
      AUTH_DISABLED ||
      (!AUTH_TOKEN && process.env.NODE_ENV !== 'production');

    if (!serveShell && (pathname === '/' || pathname.endsWith('.html'))) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }

    const root = uiRoot();
    const reqPath = pathname === '/' ? '/index.html' : pathname;
    const file = safeJoin(root, reqPath);
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': contentType(file) });
      fs.createReadStream(file).pipe(res);
      return;
    }

    if (pathname.startsWith('/src/')) {
      const srcFile = safeJoin(path.join(PACKAGE_ROOT, 'ui'), pathname);
      if (srcFile && fs.existsSync(srcFile)) {
        res.writeHead(200, { 'Content-Type': contentType(srcFile) });
        fs.createReadStream(srcFile).pipe(res);
        return;
      }
    }

    const index = path.join(root, 'index.html');
    if (fs.existsSync(index) && serveShell) {
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
      auth: AUTH_DISABLED
        ? 'disabled'
        : clerkEnabled()
          ? 'clerk+optional-owner-token'
          : AUTH_TOKEN
            ? 'owner-token'
            : 'open-non-production',
      clerk: clerkEnabled(),
      discordPublicRead: DISCORD_PUBLIC_READ,
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
