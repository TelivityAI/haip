import fs from 'node:fs';
import path from 'node:path';
import type { CollectorResult, Finding, RepoControlConfig } from '../lib/types.js';
import { walkFiles, countLines, readText } from '../lib/fs-walk.js';

export async function collectBloat(
  config: RepoControlConfig,
  analyzedCommit: string,
  analyzedAt: string,
): Promise<{ findings: Finding[]; collector: CollectorResult }> {
  const started = Date.now();
  const root = config.repoRoot!;
  const findings: Finding[] = [];

  try {
    // Large source files
    const files = walkFiles(root, config.exclusions, {
      maxFiles: 12_000,
      extensions: ['.ts', '.tsx'],
    });
    for (const rel of files) {
      if (rel.startsWith('tools/repo-control/')) continue;
      const lines = countLines(path.join(root, rel));
      if (lines >= config.largeFileLineThreshold) {
        findings.push({
          id: `bloat-large-${hash(rel)}`,
          category: 'complexity',
          capability: null,
          severity: 'low',
          confidence: 'medium',
          evidenceClass: 'heuristic',
          title: `Large module candidate: ${rel} (${lines} lines)`,
          explanation:
            'File length alone is not bad engineering. Flagged as a candidate for review of coupling and responsibility boundaries.',
          evidence: [{ kind: 'file', path: rel, summary: `${lines} lines ≥ threshold ${config.largeFileLineThreshold}` }],
          analyzedCommit,
          analyzedAt,
          suggestedAction: 'Inspect whether this module mixes unrelated concerns; split only if it improves clarity.',
          verificationLimits: 'Line count heuristic only; no coupling graph computed.',
          observedFailure: false,
        });
      }
    }

    // Suspected unused root/workspace dependencies (name not referenced in source text)
    const pkgDirs = discoverPackageDirs(root);
    for (const pkgRel of pkgDirs) {
      const pkgPath = path.join(root, pkgRel, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        name?: string;
      };
      const deps = Object.keys(pkg.dependencies ?? {});
      if (!deps.length) continue;
      const srcRoot = guessSrcRoot(root, pkgRel);
      const corpus = buildCorpus(srcRoot, config.exclusions);
      for (const dep of deps) {
        // skip framework peers commonly used via reflection / config only
        if (isLikelyFrameworkDep(dep)) continue;
        const needle = dep.startsWith('@') ? dep : dep;
        if (!corpus.includes(needle) && !corpus.includes(dep.split('/').pop()!)) {
          findings.push({
            id: `bloat-dep-${hash(pkgRel + dep)}`,
            category: 'bloat',
            capability: null,
            severity: 'low',
            confidence: 'low',
            evidenceClass: 'heuristic',
            title: `Suspected unused dependency: ${dep} (${pkgRel})`,
            explanation:
              'Dependency name was not found in a shallow source text scan. Dynamic imports, config references, and peer usage can hide real use.',
            evidence: [
              {
                kind: 'file',
                path: `${pkgRel}/package.json`,
                summary: `${dep} listed in dependencies; not found in scanned sources under ${path.relative(root, srcRoot)}`,
              },
            ],
            analyzedCommit,
            analyzedAt,
            suggestedAction: 'Confirm with package-level tooling before removal; account for Nest/Vite conventions.',
            verificationLimits: 'Suspected only — string scan, not a full module graph.',
            observedFailure: false,
          });
        }
      }
    }

    // Cap findings
    const capped = findings.slice(0, 40);
    return {
      findings: capped,
      collector: {
        id: 'bloat',
        status: 'ok',
        durationMs: Date.now() - started,
        summary: `${capped.length} maintainability candidates (heuristic)`,
      },
    };
  } catch (err) {
    return {
      findings: [],
      collector: {
        id: 'bloat',
        status: 'failed',
        durationMs: Date.now() - started,
        summary: 'bloat collector failed',
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function discoverPackageDirs(root: string): string[] {
  const out: string[] = ['.'];
  for (const base of ['apps', 'packages', 'tools']) {
    const dir = path.join(root, base);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (fs.existsSync(path.join(dir, name, 'package.json'))) out.push(`${base}/${name}`);
    }
  }
  return out;
}

function guessSrcRoot(repoRoot: string, pkgRel: string): string {
  const candidates = ['src', ''].map((s) => path.join(repoRoot, pkgRel, s));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(repoRoot, pkgRel);
}

function buildCorpus(srcRoot: string, exclusions: string[]): string {
  const files = walkFiles(srcRoot, exclusions, {
    maxFiles: 4000,
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.yml', '.yaml'],
  });
  let corpus = '';
  for (const rel of files) {
    // rel is relative to srcRoot when walk starts at srcRoot — walkFiles uses relative from start
    const abs = path.join(srcRoot, rel);
    const text = readText(abs, 100_000);
    if (text) corpus += text;
    if (corpus.length > 8_000_000) break;
  }
  return corpus;
}

function isLikelyFrameworkDep(dep: string): boolean {
  return [
    '@nestjs/',
    'reflect-metadata',
    'rxjs',
    'tslib',
    'typescript',
    '@types/',
  ].some((p) => dep === p || dep.startsWith(p));
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
