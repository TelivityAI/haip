/**
 * Shared helpers for HAIP operator harden probes.
 * Plain Node fetch — no third-party auth SDKs.
 */

export function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v;
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

/** Normalize to base ending without trailing slash; expect .../api */
export function apiBase() {
  const raw = requireEnv('HAIP_API_BASE').replace(/\/+$/, '');
  return raw;
}

export function timeoutMs() {
  const n = Number(env('HARDEN_TIMEOUT_MS', '15000'));
  return Number.isFinite(n) && n > 0 ? n : 15000;
}

/**
 * @param {string} path - path under API base, e.g. `/v1/health`
 * @param {{ method?: string, token?: string | null, headers?: Record<string,string> }} [opts]
 */
export async function request(path, opts = {}) {
  const base = apiBase();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    signal: AbortSignal.timeout(timeoutMs()),
  });
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    bodyText = '';
  }
  let json = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }
  return { url, status: res.status, ok: res.ok, json, bodyText };
}

/**
 * @typedef {{ id: string, ok: boolean, detail: string, skip?: boolean }} ProbeResult
 */

/** @param {ProbeResult[]} results */
export function printReport(results) {
  const width = Math.max(...results.map((r) => r.id.length), 8);
  console.log('');
  console.log(`${'PROBE'.padEnd(width)}  RESULT  DETAIL`);
  console.log(`${'-'.repeat(width)}  ------  ------`);
  for (const r of results) {
    const label = r.skip ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
    console.log(`${r.id.padEnd(width)}  ${label.padEnd(6)}  ${r.detail}`);
  }
  const failed = results.filter((r) => !r.skip && !r.ok);
  const skipped = results.filter((r) => r.skip);
  console.log('');
  console.log(
    `Summary: ${results.length - failed.length - skipped.length} pass, ${failed.length} fail, ${skipped.length} skip`,
  );
  return failed.length === 0;
}

/** @param {boolean} expected @param {number} status @param {number[]} codes */
export function statusIn(status, codes) {
  return codes.includes(status);
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function repoRootFromCli() {
  // ops/harden/cli → repo root is ../../..
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(cliDir, '../../..');
}
