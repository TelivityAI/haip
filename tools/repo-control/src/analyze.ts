#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './lib/config.js';
import { PACKAGE_ROOT, latestSnapshotPath, snapshotsDir } from './lib/paths.js';
import type { Finding, SnapshotV1 } from './lib/types.js';
import { collectGit, collectCommitPaths } from './collectors/git.js';
import { collectManifests } from './collectors/manifests.js';
import { collectChecks } from './collectors/checks.js';
import { collectStructure } from './collectors/structure.js';
import { collectCapabilities } from './collectors/capabilities.js';
import { collectTodos } from './collectors/todos.js';
import { collectBloat } from './collectors/bloat.js';
import { collectGraphify } from './collectors/graphify.js';
import { collectRuntime } from './collectors/runtime.js';
import { findingsFromChecks } from './lib/findings-from-checks.js';
import { buildNextActions, mapPathsToCapabilities } from './lib/next-actions.js';
import { compareSnapshots } from './lib/compare.js';
import { pathExists } from './lib/fs-walk.js';

export interface AnalyzeOptions {
  configPath?: string;
  skipChecks?: boolean;
  skipGraphify?: boolean;
}

export async function runAnalyze(opts: AnalyzeOptions = {}): Promise<SnapshotV1> {
  const { config, configPath } = loadConfig(opts.configPath);
  if (opts.skipChecks) {
    config.checks = config.checks.map((c) => ({ ...c, enabled: false }));
  }
  if (opts.skipGraphify) {
    config.graphifyEnabled = false;
  }

  const collectors: SnapshotV1['collectors'] = [];

  const git = await collectGit(config);
  collectors.push(git.collector);
  const { recentRaw, ...gitMeta } = git.data;

  const manifests = await collectManifests(config);
  collectors.push(manifests.collector);

  const structure = await collectStructure(config);
  collectors.push(structure.collector);

  const checks = await collectChecks(config);
  collectors.push(checks.collector);

  const capabilities = await collectCapabilities(config, structure.data, checks.data);
  collectors.push(capabilities.collector);

  const analyzedCommit = gitMeta.analyzedCommit;
  const analyzedAt = gitMeta.analyzedAt;

  const todos = await collectTodos(config, analyzedCommit, analyzedAt);
  collectors.push(todos.collector);

  const bloat = await collectBloat(config, analyzedCommit, analyzedAt);
  collectors.push(bloat.collector);

  const graphify = await collectGraphify(config);
  collectors.push(graphify.collector);

  const runtime = await collectRuntime(config.runtimeProbes ?? []);
  collectors.push(runtime.collector);

  const findings: Finding[] = [
    ...findingsFromChecks(checks.data, analyzedCommit, analyzedAt),
    ...todos.findings,
    ...bloat.findings,
    ...tenancyFindings(config.repoRoot!, analyzedCommit, analyzedAt),
    ...capabilityGapFindings(capabilities.data, analyzedCommit, analyzedAt),
  ];

  // Recent commits with path mapping
  const recentCommits: SnapshotV1['recentChanges']['commits'] = [];
  for (const c of recentRaw) {
    const paths = await collectCommitPaths(config.repoRoot!, c.sha);
    recentCommits.push({
      sha: c.sha.slice(0, 8),
      subject: c.subject,
      date: c.date,
      paths: paths.slice(0, 40),
      capabilities: mapPathsToCapabilities(paths, capabilities.data),
    });
  }

  const snapshot: SnapshotV1 = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repoRoot: config.repoRoot!,
    configPath,
    productSummary: config.productSummary,
    git: gitMeta,
    checks: checks.data,
    capabilities: capabilities.data,
    findings,
    recentChanges: {
      commits: recentCommits,
      uncommitted: gitMeta.dirtyPaths,
    },
    nextActions: buildNextActions(findings, capabilities.data),
    runtime: runtime.data,
    collectors,
    graphify: {
      ...graphify.data,
      // expose paths relative to package for serving when under tools/repo-control
      dir: graphify.data.dir,
      htmlPath: graphify.data.htmlPath,
      jsonPath: graphify.data.jsonPath,
      reportPath: graphify.data.reportPath,
    },
    manifests: manifests.data,
    structure: structure.data,
    previousSnapshotId: null,
    comparison: null,
  };

  // Compare with previous latest
  const latestPath = latestSnapshotPath();
  let previous: SnapshotV1 | null = null;
  if (fs.existsSync(latestPath)) {
    try {
      previous = JSON.parse(fs.readFileSync(latestPath, 'utf8')) as SnapshotV1;
      snapshot.previousSnapshotId = previous.generatedAt;
      snapshot.comparison = compareSnapshots(snapshot, previous);
      // stale if HEAD moved since previous analyzed commit and we somehow reused — always fresh after analyze
      if (previous.git?.commit && previous.git.commit !== snapshot.git.commit) {
        // mark nothing — current is fresh
      }
    } catch {
      previous = null;
    }
  }

  // Persist
  const dir = snapshotsDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamped = path.join(
    dir,
    `snapshot-${snapshot.generatedAt.replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(stamped, JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(snapshot, null, 2));

  // Copy graphify html into snapshots for static hosting convenience
  if (snapshot.graphify.htmlPath && fs.existsSync(snapshot.graphify.htmlPath)) {
    const dest = path.join(PACKAGE_ROOT, 'ui', 'public', 'graphify');
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(snapshot.graphify.htmlPath, path.join(dest, 'graph.html'));
    if (snapshot.graphify.jsonPath && fs.existsSync(snapshot.graphify.jsonPath)) {
      fs.copyFileSync(snapshot.graphify.jsonPath, path.join(dest, 'graph.json'));
    }
    if (snapshot.graphify.reportPath && fs.existsSync(snapshot.graphify.reportPath)) {
      fs.copyFileSync(snapshot.graphify.reportPath, path.join(dest, 'GRAPH_REPORT.md'));
    }
  }

  return snapshot;
}

function tenancyFindings(
  repoRoot: string,
  analyzedCommit: string,
  analyzedAt: string,
): Finding[] {
  const findings: Finding[] = [];
  if (pathExists(repoRoot, 'ops/harden/TENANT_ISOLATION.md')) {
    findings.push({
      id: 'tenancy-harden-doc-present',
      category: 'auth_tenancy',
      capability: 'tenant-isolation',
      severity: 'medium',
      confidence: 'high',
      evidenceClass: 'fact',
      title: 'Tenant isolation playbook present — runtime probe not run',
      explanation:
        'ops/harden/TENANT_ISOLATION.md exists. This scan did not execute harden probes against a live API.',
      evidence: [
        {
          kind: 'file',
          path: 'ops/harden/TENANT_ISOLATION.md',
          summary: 'Tenant isolation documentation and checklist located',
        },
      ],
      analyzedCommit,
      analyzedAt,
      suggestedAction: 'Run `pnpm harden:local` (or live) and attach results to a future snapshot.',
      verificationLimits: 'Documentation presence ≠ verified isolation.',
      observedFailure: false,
    });
  }
  return findings;
}

function capabilityGapFindings(
  capabilities: SnapshotV1['capabilities'],
  analyzedCommit: string,
  analyzedAt: string,
): Finding[] {
  const out: Finding[] = [];
  for (const c of capabilities) {
    if (!['partial', 'broken', 'planned_only', 'stub_mock'].includes(c.status)) continue;
    out.push({
      id: `cap-gap-${c.id}`,
      category:
        c.status === 'stub_mock'
          ? 'placeholder'
          : c.status === 'broken'
            ? 'check_failure'
            : 'incomplete_workflow',
      capability: c.id,
      severity: c.status === 'broken' ? 'critical' : c.status === 'partial' ? 'high' : 'medium',
      confidence: 'medium',
      evidenceClass: c.status === 'stub_mock' ? 'fact' : 'heuristic',
      title: `${c.name}: ${c.status}`,
      explanation: `${c.missing} ${c.verification}`,
      evidence: c.files.slice(0, 5).map((f) => ({
        kind: 'file' as const,
        path: f,
        summary: 'capability probe path',
      })),
      analyzedCommit,
      analyzedAt,
      suggestedAction: `Investigate ${c.name} gap and confirm with a representative workflow.`,
      verificationLimits: c.verification,
      observedFailure: c.status === 'broken',
    });
  }
  return out;
}

// CLI
const isMain = process.argv[1]?.endsWith('analyze.ts') || process.argv[1]?.endsWith('analyze.js');
if (isMain) {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const configIdx = args.indexOf('--config');
  const configPath = configIdx >= 0 ? args[configIdx + 1] : undefined;
  const skipChecks = args.includes('--skip-checks');
  const skipGraphify = args.includes('--skip-graphify');

  runAnalyze({ configPath, skipChecks, skipGraphify })
    .then((snap) => {
      console.log(
        JSON.stringify(
          {
            generatedAt: snap.generatedAt,
            commit: snap.git.shortCommit,
            findings: snap.findings.length,
            capabilities: snap.capabilities.length,
            checks: Object.fromEntries(
              Object.values(snap.checks).map((c) => [c.id, c.status]),
            ),
            graphify: snap.graphify.status,
            snapshot: latestSnapshotPath(),
          },
          null,
          2,
        ),
      );
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
