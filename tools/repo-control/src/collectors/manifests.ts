import fs from 'node:fs';
import path from 'node:path';
import type { CollectorResult, RepoControlConfig } from '../lib/types.js';

export async function collectManifests(
  config: RepoControlConfig,
): Promise<{ data: Record<string, unknown>; collector: CollectorResult }> {
  const started = Date.now();
  const root = config.repoRoot!;
  try {
    const rootPkgPath = path.join(root, 'package.json');
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const workspaceGlobs = readWorkspacePackages(root);
    const packages: Array<{ name: string; path: string; depCount: number; scripts: string[] }> = [];

    for (const rel of workspaceGlobs) {
      const pkgPath = path.join(root, rel, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      const depCount =
        Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
      packages.push({
        name: pkg.name ?? rel,
        path: rel,
        depCount,
        scripts: Object.keys(pkg.scripts ?? {}),
      });
    }

    const lockPath = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']
      .map((f) => path.join(root, f))
      .find((p) => fs.existsSync(p));

    return {
      data: {
        rootName: rootPkg.name ?? null,
        rootScripts: Object.keys(rootPkg.scripts ?? {}),
        rootDepCount:
          Object.keys(rootPkg.dependencies ?? {}).length +
          Object.keys(rootPkg.devDependencies ?? {}).length,
        packages,
        lockfile: lockPath ? path.basename(lockPath) : null,
      },
      collector: {
        id: 'manifests',
        status: 'ok',
        durationMs: Date.now() - started,
        summary: `${packages.length} workspace packages`,
      },
    };
  } catch (err) {
    return {
      data: {},
      collector: {
        id: 'manifests',
        status: 'failed',
        durationMs: Date.now() - started,
        summary: 'manifest collector failed',
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function readWorkspacePackages(root: string): string[] {
  const wsPath = path.join(root, 'pnpm-workspace.yaml');
  const found: string[] = [];
  if (fs.existsSync(wsPath)) {
    const text = fs.readFileSync(wsPath, 'utf8');
    // simple: apps/* and packages/*
    for (const base of ['apps', 'packages']) {
      const dir = path.join(root, base);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (fs.existsSync(path.join(dir, name, 'package.json'))) {
          found.push(`${base}/${name}`);
        }
      }
    }
  }
  // also tools/* that have package.json
  const toolsDir = path.join(root, 'tools');
  if (fs.existsSync(toolsDir)) {
    for (const name of fs.readdirSync(toolsDir)) {
      if (fs.existsSync(path.join(toolsDir, name, 'package.json'))) {
        found.push(`tools/${name}`);
      }
    }
  }
  return found;
}
