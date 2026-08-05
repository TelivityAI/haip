#!/usr/bin/env node
/**
 * HAIP operator harden CLI
 *
 *   node ops/harden/cli/harden.mjs local
 *   node ops/harden/cli/harden.mjs live
 *   node ops/harden/cli/harden.mjs all
 *
 * Env: see ops/harden/.env.harden.example
 */

import { printReport, env } from './lib.mjs';
import { runLocalFileProbes } from './probes/local.mjs';
import { runHealthProbes } from './probes/health.mjs';
import { runAuthOnProbes } from './probes/auth-on.mjs';
import { runTenantIsolationProbes } from './probes/tenant-isolation.mjs';

function usage() {
  console.log(`Usage: haip-harden <local|live|all>

  local  File/compose checklist (+ optional HTTP if HAIP_API_BASE is set)
  live   Health + auth-on + tenant-isolation against HAIP_API_BASE
  all    local then live

Env: copy ops/harden/.env.harden.example → .env.harden and source it.
`);
}

async function runLive() {
  /** @type {import('./lib.mjs').ProbeResult[]} */
  const results = [];
  results.push(...(await runHealthProbes()));
  results.push(...(await runAuthOnProbes()));
  results.push(...(await runTenantIsolationProbes()));
  return results;
}

async function runLocal() {
  /** @type {import('./lib.mjs').ProbeResult[]} */
  const results = [...(await runLocalFileProbes())];

  // If API base is configured, also hit health (and auth/tenant when tokens present)
  if (env('HAIP_API_BASE')) {
    console.log('HAIP_API_BASE set — running HTTP probes against local/target API…');
    results.push(...(await runHealthProbes()));
    if (env('PROPERTY_A')) {
      results.push(...(await runAuthOnProbes()));
    }
    if (env('TOKEN_A') && env('TOKEN_B') && env('PROPERTY_A') && env('PROPERTY_B')) {
      results.push(...(await runTenantIsolationProbes()));
    } else {
      results.push({
        id: 'tenant-live-optional',
        ok: true,
        skip: true,
        detail: 'TOKEN_A/B + PROPERTY_A/B not all set — skipped live tenant probes',
      });
    }
  } else {
    results.push({
      id: 'http-optional',
      ok: true,
      skip: true,
      detail: 'HAIP_API_BASE not set — file checks only; set it to probe a running API',
    });
  }

  return results;
}

async function main() {
  const mode = (process.argv[2] ?? '').toLowerCase();
  if (!['local', 'live', 'all'].includes(mode)) {
    usage();
    process.exit(2);
  }

  console.log(`HAIP harden — mode=${mode}`);

  /** @type {import('./lib.mjs').ProbeResult[]} */
  let results = [];
  if (mode === 'local' || mode === 'all') {
    console.log('\n== local ==');
    results = results.concat(await runLocal());
  }
  if (mode === 'live' || mode === 'all') {
    console.log('\n== live ==');
    if (!env('HAIP_API_BASE')) {
      console.error('HAIP_API_BASE is required for live mode');
      process.exit(2);
    }
    results = results.concat(await runLive());
  }

  const passed = printReport(results);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
