import fs from 'node:fs';
import path from 'node:path';

export function pathExists(repoRoot: string, rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, rel));
}

export function listExisting(repoRoot: string, rels: string[]): string[] {
  return rels.filter((rel) => pathExists(repoRoot, rel));
}

export function isExcluded(relPath: string, exclusions: string[]): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return exclusions.some((ex) => {
    const e = ex.replace(/\\/g, '/');
    if (e.includes('**')) {
      const bare = e.replace(/\*\*\//g, '').replace(/\*\*/g, '');
      if (bare.startsWith('*.')) {
        return normalized.endsWith(bare.slice(1));
      }
      return normalized.includes(bare.replace(/^\*\./, '.'));
    }
    return (
      normalized === e ||
      normalized.startsWith(`${e}/`) ||
      normalized.includes(`/${e}/`) ||
      normalized.endsWith(`/${e}`)
    );
  });
}

export function walkFiles(
  repoRoot: string,
  exclusions: string[],
  opts: { maxFiles?: number; extensions?: string[] } = {},
): string[] {
  const maxFiles = opts.maxFiles ?? 20_000;
  const extensions = opts.extensions;
  const out: string[] = [];

  function walk(abs: string, rel: string): void {
    if (out.length >= maxFiles) return;
    if (rel && isExcluded(rel, exclusions)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxFiles) return;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (isExcluded(childRel, exclusions) || ent.name === 'node_modules' || ent.name === '.git') {
        continue;
      }
      const childAbs = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        walk(childAbs, childRel);
      } else if (ent.isFile()) {
        if (extensions && !extensions.some((ext) => ent.name.endsWith(ext))) continue;
        out.push(childRel);
      }
    }
  }

  walk(repoRoot, '');
  return out;
}

export function countLines(absPath: string): number {
  try {
    const text = fs.readFileSync(absPath, 'utf8');
    if (!text) return 0;
    return text.split('\n').length;
  } catch {
    return 0;
  }
}

export function readText(absPath: string, maxBytes = 2_000_000): string | null {
  try {
    const buf = fs.readFileSync(absPath);
    if (buf.length > maxBytes) return buf.subarray(0, maxBytes).toString('utf8');
    return buf.toString('utf8');
  } catch {
    return null;
  }
}
