import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** tools/repo-control package root */
export const PACKAGE_ROOT = path.resolve(here, '../..');

/** Default HAIP monorepo root (two levels up from tools/repo-control) */
export const DEFAULT_REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..');

export function resolveRepoRoot(configured?: string): string {
  if (configured && configured.trim()) {
    return path.resolve(configured);
  }
  return DEFAULT_REPO_ROOT;
}

export function snapshotsDir(packageRoot = PACKAGE_ROOT): string {
  return path.join(packageRoot, 'snapshots');
}

export function latestSnapshotPath(packageRoot = PACKAGE_ROOT): string {
  return path.join(snapshotsDir(packageRoot), 'latest.json');
}

export function annotationsPath(packageRoot = PACKAGE_ROOT): string {
  return path.join(packageRoot, 'annotations.json');
}
