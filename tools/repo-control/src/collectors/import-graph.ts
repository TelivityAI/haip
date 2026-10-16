import fs from 'node:fs';
import path from 'node:path';
import type { GraphifyInfo } from '../lib/types.js';

export interface ImportNode {
  id: string;
  label: string;
  source_file: string;
  community: string;
  community_name: string;
  fileCount: number;
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

export function buildImportGraph(repoRoot: string): {
  nodes: ImportNode[];
  links: ImportLink[];
} {
  const files = listSourceFiles(repoRoot);
  const fileSet = new Set(files);
  const folderFiles = new Map<string, number>();
  const edgeWeight = new Map<string, number>();
  const edgeSamples = new Map<string, string[]>();

  for (const rel of files) {
    const srcNode = path.dirname(rel);
    folderFiles.set(srcNode, (folderFiles.get(srcNode) ?? 0) + 1);
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
      if (!target) continue;
      const dstNode = path.dirname(target);
      if (dstNode === srcNode) continue;
      const key = `${srcNode}\n${dstNode}`;
      edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 1);
      const samples = edgeSamples.get(key) ?? [];
      if (samples.length < 6) {
        samples.push(`${path.basename(rel)} → ${path.basename(target)}`);
        edgeSamples.set(key, samples);
      }
    }
  }

  const linked = new Set<string>();
  const links: ImportLink[] = [];
  for (const [key, weight] of edgeWeight) {
    const [source, target] = key.split('\n');
    linked.add(source);
    linked.add(target);
    links.push({
      source,
      target,
      relationship: 'imports',
      weight,
      samples: edgeSamples.get(key) ?? [],
    });
  }

  const nodes: ImportNode[] = [];
  for (const [id, fileCount] of folderFiles) {
    if (!linked.has(id) && fileCount < 1) continue;
    const community = communityFor(id);
    nodes.push({
      id,
      label: folderLabel(id),
      source_file: id,
      community,
      community_name: community,
      fileCount,
    });
  }
  nodes.sort((a, b) => a.community.localeCompare(b.community) || a.label.localeCompare(b.label));
  links.sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source));
  return { nodes, links };
}

export function writeImportGraph(repoRoot: string, dirAbs: string): GraphifyInfo {
  const { nodes, links } = buildImportGraph(repoRoot);
  fs.mkdirSync(dirAbs, { recursive: true });
  const jsonPath = path.join(dirAbs, 'graph.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ nodes, links }, null, 2));
  const communities = new Set(nodes.map((n) => n.community));
  const reportPath = path.join(dirAbs, 'GRAPH_REPORT.md');
  const top = links.slice(0, 25).map((l) => `- ${l.weight}  ${l.source} → ${l.target}`);
  fs.writeFileSync(
    reportPath,
    [
      '# Import communities',
      '',
      `Folders: ${nodes.length}`,
      `Import edges: ${links.length}`,
      `Communities: ${communities.size}`,
      '',
      'Built from TypeScript import statements under apps/ and packages/.',
      'External packages are omitted. Edges connect folders, weighted by import count.',
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
      '<!DOCTYPE html><meta charset="utf-8"><p>Open the Repository Control Graphify viewer.</p>',
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
    summary: `Import graph: ${nodes.length} folders, ${links.length} import edges, ${communities.size} communities.`,
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
    if (fileSet.has(norm) || fs.existsSync(path.join(repoRoot, norm))) return norm;
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

function folderLabel(dir: string): string {
  const parts = dir.split('/').filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join('/');
  return parts[0] || dir;
}
