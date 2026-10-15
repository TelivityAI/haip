import fs from 'node:fs';
import path from 'node:path';
import type {
  CapabilityResult,
  CapabilityStatus,
  CollectorResult,
  RepoControlConfig,
} from '../lib/types.js';
import { listExisting, pathExists } from '../lib/fs-walk.js';

export async function collectCapabilities(
  config: RepoControlConfig,
  structure: Record<string, unknown>,
  checks: Record<string, { status: string }>,
): Promise<{ data: CapabilityResult[]; collector: CollectorResult }> {
  const started = Date.now();
  const root = config.repoRoot!;
  const dashboardRoutes = (structure.dashboardRoutes as string[] | undefined) ?? [];
  const anyCheckFailed = Object.values(checks).some((c) =>
    ['failed', 'timeout'].includes(c.status),
  );
  const results: CapabilityResult[] = [];

  for (const probe of config.capabilities) {
    const present = listExisting(root, probe.requiredPaths);
    const optionalPresent = listExisting(root, probe.optionalPaths ?? []);
    const stubs = listExisting(root, probe.stubHints ?? []);
    const tests = expandTestHits(root, probe.testPaths ?? []);
    const routes = matchRoutes(dashboardRoutes, probe.routeHints ?? []);

    const missingRequired = probe.requiredPaths.filter((p) => !pathExists(root, p));
    let status: CapabilityStatus = 'unknown';
    let verification =
      'No end-to-end workflow was executed. Status is based on filesystem presence and optional check results only.';

    if (present.length === 0) {
      const docs = listExisting(root, probe.docHints ?? []);
      status = docs.length > 0 ? 'planned_only' : 'unknown';
    } else if (stubs.length > 0 && present.length > 0 && missingRequired.length === 0) {
      // stub files present alongside implementation → note stub/mock if mock is primary gateway path
      status = stubs.some((s) => s.includes('mock')) ? 'stub_mock' : 'implemented_unverified';
      if (status === 'stub_mock') {
        verification =
          'Stub/mock gateway files located. Live PSP behavior was not established by this scan.';
      }
    } else if (missingRequired.length > 0) {
      status = 'partial';
    } else if (tests.length === 0) {
      status = 'implemented_unverified';
      verification = 'Implementation paths found; no matching test paths located.';
    } else if (anyCheckFailed && probe.id === 'auth-rbac') {
      // don't mark broken solely from unrelated check failure
      status = 'implemented_unverified';
      verification = `Implementation and tests located (${tests.length}). Full suite not asserted for this capability.`;
    } else {
      status = 'implemented_unverified';
      verification = `Implementation and tests located (${tests.length} test file hits). A route or unit test alone does not prove the full product workflow.`;
    }

    // payments special-case: mock gateway with real stripe folder still implemented_unverified unless only mocks
    if (probe.id === 'payments') {
      const hasStripe = pathExists(root, 'apps/api/src/modules/payment/gateways');
      if (stubs.length > 0 && hasStripe) {
        status = 'implemented_unverified';
        verification =
          'Mock gateways and gateway directory both exist. Scan did not run a live payment workflow.';
      } else if (stubs.length > 0 && !hasStripe) {
        status = 'stub_mock';
      }
    }

    results.push({
      id: probe.id,
      name: probe.name,
      status,
      exists: describeExists(present, optionalPresent, tests, routes),
      missing:
        missingRequired.length > 0
          ? `Missing required paths: ${missingRequired.join(', ')}`
          : optionalPresent.length < (probe.optionalPaths?.length ?? 0)
            ? `Some optional surfaces missing (${(probe.optionalPaths ?? []).filter((p) => !pathExists(root, p)).join(', ') || 'n/a'})`
            : 'No required path gaps detected by probe.',
      files: [...present, ...optionalPresent].slice(0, 30),
      routes,
      tests: tests.slice(0, 30),
      verification,
      consequence: probe.consequence,
    });
  }

  return {
    data: results,
    collector: {
      id: 'capabilities',
      status: 'ok',
      durationMs: Date.now() - started,
      summary: `${results.length} capabilities probed`,
    },
  };
}

function describeExists(
  present: string[],
  optional: string[],
  tests: string[],
  routes: string[],
): string {
  const parts: string[] = [];
  if (present.length) parts.push(`${present.length} required path(s)`);
  if (optional.length) parts.push(`${optional.length} optional path(s)`);
  if (tests.length) parts.push(`${tests.length} test hit(s)`);
  if (routes.length) parts.push(`routes: ${routes.join(', ')}`);
  return parts.join('; ') || 'Nothing located.';
}

function matchRoutes(routes: string[], hints: string[]): string[] {
  if (!hints.length) return [];
  return routes.filter((r) => hints.some((h) => r.toLowerCase().includes(h.toLowerCase())));
}

function expandTestHits(repoRoot: string, testPaths: string[]): string[] {
  const hits: string[] = [];
  for (const rel of testPaths) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    if (st.isFile()) {
      if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(rel)) hits.push(rel);
      continue;
    }
    // directory: find spec/test files one level deep (and nested)
    const stack = [abs];
    while (stack.length) {
      const dir = stack.pop()!;
      let ents: fs.Dirent[];
      try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of ents) {
        const child = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === 'dist') continue;
          stack.push(child);
        } else if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(ent.name)) {
          hits.push(path.relative(repoRoot, child).replace(/\\/g, '/'));
        }
      }
    }
  }
  return hits;
}
