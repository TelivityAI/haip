import fs from 'node:fs';
import path from 'node:path';
import type { GraphifyInfo } from '../lib/types.js';

export interface InternalLink {
  source: string;
  target: string;
  weight: number;
  samples: string[];
}

export interface ImportNode {
  id: string;
  label: string;
  group: string;
  source_file: string;
  community: string;
  community_name: string;
  fileCount: number;
  files: string[];
  internal: InternalLink[];
}

export interface ImportLink {
  source: string;
  target: string;
  relationship: 'imports';
  weight: number;
  samples: string[];
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  'graphify-out',
  'snapshots',
]);

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const GROUP_ORDER = ['Packages', 'API', 'Dashboard', 'Booking'];

export function buildImportGraph(repoRoot: string): {
  nodes: ImportNode[];
  links: ImportLink[];
} {
  const files = listSourceFiles(repoRoot).filter((rel) => !isTestFile(rel));
  const fileSet = new Set(files);
  const moduleFiles = new Map<string, Set<string>>();
  const externalWeight = new Map<string, number>();
  const externalSamples = new Map<string, string[]>();
  const internalWeight = new Map<string, number>();
  const internalSamples = new Map<string, string[]>();

  for (const rel of files) {
    const srcId = communityFor(path.posix.dirname(rel));
    let bucket = moduleFiles.get(srcId);
    if (!bucket) {
      bucket = new Set();
      moduleFiles.set(srcId, bucket);
    }
    bucket.add(rel);

    let text = '';
    try {
      text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    } catch {
      continue;
    }
    IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMPORT_RE.exec(text))) {
      const spec = match[1] || match[2];
      if (!spec) continue;
      const target = resolveImport(repoRoot, rel, spec, fileSet);
      if (!target || isTestFile(target) || target === rel) continue;
      const dstId = communityFor(path.posix.dirname(target));
      if (dstId === srcId) {
        const key = `${srcId}\n${rel}\n${target}`;
        internalWeight.set(key, (internalWeight.get(key) ?? 0) + 1);
        const samples = internalSamples.get(key) ?? [];
        if (samples.length < 4) {
          samples.push(`${path.posix.basename(rel)} → ${path.posix.basename(target)}`);
          internalSamples.set(key, samples);
        }
        continue;
      }
      const key = `${srcId}\n${dstId}`;
      externalWeight.set(key, (externalWeight.get(key) ?? 0) + 1);
      const samples = externalSamples.get(key) ?? [];
      if (samples.length < 6) {
        samples.push(`${path.posix.basename(rel)} → ${path.posix.basename(target)}`);
        externalSamples.set(key, samples);
      }
    }
  }

  const internalsByModule = new Map<string, InternalLink[]>();
  for (const [key, weight] of internalWeight) {
    const [moduleId, source, target] = key.split('\n');
    const list = internalsByModule.get(moduleId) ?? [];
    const root = commonDir([...(moduleFiles.get(moduleId) ?? [])]);
    list.push({
      source: stripRoot(source, root),
      target: stripRoot(target, root),
      weight,
      samples: internalSamples.get(key) ?? [],
    });
    internalsByModule.set(moduleId, list);
  }

  const nodes: ImportNode[] = [];
  for (const [id, fileSetForModule] of moduleFiles) {
    const listed = [...fileSetForModule].sort();
    const root = commonDir(listed);
    const presented = present(id);
    const internal = (internalsByModule.get(id) ?? []).sort(
      (a, b) => b.weight - a.weight || a.source.localeCompare(b.source),
    );
    nodes.push({
      id,
      label: presented.label,
      group: presented.group,
      source_file: root || id,
      community: id,
      community_name: presented.label,
      fileCount: listed.length,
      files: listed.map((file) => stripRoot(file, root)),
      internal,
    });
  }

  const known = new Set(nodes.map((n) => n.id));
  const links: ImportLink[] = [];
  for (const [key, weight] of externalWeight) {
    const [source, target] = key.split('\n');
    if (!known.has(source) || !known.has(target)) continue;
    links.push({
      source,
      target,
      relationship: 'imports',
      weight,
      samples: externalSamples.get(key) ?? [],
    });
  }

  nodes.sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.label.localeCompare(b.label));
  links.sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source));
  return { nodes, links };
}

export function writeImportGraph(repoRoot: string, dirAbs: string): GraphifyInfo {
  const { nodes, links } = buildImportGraph(repoRoot);
  fs.mkdirSync(dirAbs, { recursive: true });
  const jsonPath = path.join(dirAbs, 'graph.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ nodes, links }, null, 2));
  const internalCount = nodes.reduce((sum, node) => sum + node.internal.length, 0);
  const reportPath = path.join(dirAbs, 'GRAPH_REPORT.md');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const top = links.slice(0, 25).map((link) => {
    const from = byId.get(link.source);
    const to = byId.get(link.target);
    return `- ${link.weight}  ${from?.group ?? ''} ${from?.label ?? link.source} → ${to?.group ?? ''} ${to?.label ?? link.target}`;
  });
  fs.writeFileSync(
    reportPath,
    [
      '# Repo map',
      '',
      `Modules: ${nodes.length}`,
      `Cross-module imports: ${links.length}`,
      `Internal file links: ${internalCount}`,
      '',
      'Built from TypeScript import statements under apps/ and packages/.',
      'Test files and external packages are omitted. A module keeps its own files, including dto folders.',
      '',
      '## Strongest links',
      '',
      ...top,
      '',
    ].join('\n'),
  );
  const htmlPath = path.join(dirAbs, 'graph.html');
  if (!fs.existsSync(htmlPath)) {
    fs.writeFileSync(
      htmlPath,
      '<!DOCTYPE html><meta charset="utf-8"><p>Open the Telivity repo map.</p>',
    );
  }
  return {
    status: 'ready',
    dir: dirAbs,
    htmlPath,
    jsonPath,
    reportPath,
    nodeCount: nodes.length,
    edgeCount: links.length,
    summary: `Repo map: ${nodes.length} modules, ${links.length} cross-module imports, ${internalCount} internal file links.`,
  };
}

function listSourceFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const roots = ['apps', 'packages'].map((r) => path.join(repoRoot, r));
  for (const start of roots) {
    if (!fs.existsSync(start)) continue;
    walk(start, repoRoot, out);
  }
  return out;
}

function walk(dir: string, repoRoot: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(abs, repoRoot, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith('.ts') && !ent.name.endsWith('.tsx')) continue;
    if (ent.name.endsWith('.d.ts')) continue;
    out.push(path.relative(repoRoot, abs).split(path.sep).join('/'));
  }
}

function isTestFile(rel: string): boolean {
  return /\.(spec|test)\.(tsx?)$/.test(rel) || rel.includes('/__tests__/');
}

function resolveImport(
  repoRoot: string,
  fromRel: string,
  spec: string,
  fileSet: Set<string>,
): string | null {
  const cleaned = spec.replace(/[?#].*$/, '').replace(/\.(tsx|ts|jsx|js)$/, '');
  let base: string | null = null;
  if (cleaned.startsWith('.')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), cleaned));
  } else if (cleaned === '@telivityhaip/database' || cleaned.startsWith('@telivityhaip/database/')) {
    const rest = cleaned.slice('@telivityhaip/database'.length);
    base = `packages/database/src${rest}`;
  } else if (cleaned === '@telivityhaip/shared' || cleaned.startsWith('@telivityhaip/shared/')) {
    const rest = cleaned.slice('@telivityhaip/shared'.length);
    base = `packages/shared/src${rest}`;
  } else if (
    cleaned === '@telivityhaip/booking-requests' ||
    cleaned.startsWith('@telivityhaip/booking-requests/')
  ) {
    const rest = cleaned.slice('@telivityhaip/booking-requests'.length);
    base = `packages/booking-requests/src${rest}`;
  } else if (cleaned.startsWith('@/')) {
    const app = fromRel.startsWith('apps/dashboard/')
      ? 'apps/dashboard/src'
      : fromRel.startsWith('apps/booking/')
        ? 'apps/booking/src'
        : null;
    if (!app) return null;
    base = `${app}/${cleaned.slice(2)}`;
  } else {
    return null;
  }
  const cands = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  for (const cand of cands) {
    const norm = cand.split(path.sep).join('/');
    if (fileSet.has(norm)) return norm;
    const abs = path.join(repoRoot, norm);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return norm;
  }
  return null;
}

function communityFor(dir: string): string {
  const mod = dir.match(/^apps\/api\/src\/modules\/([^/]+)/);
  if (mod) return `api/${mod[1]}`;
  if (dir.startsWith('apps/api/src/common')) return 'api/common';
  if (dir.startsWith('apps/api/src/database')) return 'api/database';
  if (dir.startsWith('apps/api/src/scripts')) return 'api/scripts';
  if (dir === 'apps/api/src' || dir === 'apps/api') return 'api/root';
  const dash = dir.match(/^apps\/dashboard\/src\/([^/]+)/);
  if (dash) return `dashboard/${dash[1]}`;
  if (dir === 'apps/dashboard/src' || dir === 'apps/dashboard') return 'dashboard/root';
  const book = dir.match(/^apps\/booking\/src\/([^/]+)/);
  if (book) return `booking/${book[1]}`;
  if (dir === 'apps/booking/src' || dir === 'apps/booking') return 'booking/root';
  const pkg = dir.match(/^packages\/([^/]+)/);
  if (pkg) return `package/${pkg[1]}`;
  const app = dir.match(/^apps\/([^/]+)/);
  if (app) return `app/${app[1]}`;
  return dir.split('/').slice(0, 2).join('/') || dir;
}

function present(id: string): { group: string; label: string } {
  const [area, ...rest] = id.split('/');
  const slug = rest.join('/') || 'entry';
  const group =
    area === 'api'
      ? 'API'
      : area === 'dashboard'
        ? 'Dashboard'
        : area === 'booking'
          ? 'Booking'
          : area === 'package'
            ? 'Packages'
            : titleCase(area);
  return { group, label: slug === 'root' ? 'Entry' : titleCase(slug) };
}

function titleCase(slug: string): string {
  const special: Record<string, string> = { ui: 'UI', api: 'API', dto: 'DTO', rbac: 'RBAC' };
  return slug
    .split(/[/-]/)
    .filter(Boolean)
    .map((word) => special[word] || word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function groupRank(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

function commonDir(files: string[]): string {
  if (!files.length) return '';
  const split = files.map((file) => file.split('/'));
  const prefix: string[] = [];
  for (let i = 0; i < split[0].length - 1; i += 1) {
    if (split.every((parts) => parts[i] === split[0][i])) prefix.push(split[0][i]);
    else break;
  }
  return prefix.join('/');
}

function stripRoot(file: string, root: string): string {
  if (!root) return file;
  const prefix = `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}
