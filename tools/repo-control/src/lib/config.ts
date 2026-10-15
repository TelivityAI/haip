import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { RepoControlConfig } from './types.js';
import { PACKAGE_ROOT, resolveRepoRoot } from './paths.js';

const DEFAULTS: Omit<RepoControlConfig, 'productName' | 'productSummary' | 'capabilities' | 'checks'> = {
  exclusions: [
    'node_modules',
    'dist',
    'coverage',
    '.git',
    'tools/repo-control/snapshots',
    'graphify-out/cache',
  ],
  graphifyDir: 'graphify-out',
  graphifyEnabled: true,
  graphifyTimeoutMs: 300_000,
  recentCommitLimit: 15,
  todoLimit: 40,
  largeFileLineThreshold: 800,
  staleAfterMinutes: 60,
};

export function loadConfig(configPath?: string): { config: RepoControlConfig; configPath: string } {
  const resolved =
    configPath && configPath.trim()
      ? path.resolve(configPath)
      : path.join(PACKAGE_ROOT, 'config.haip.yaml');

  if (!fs.existsSync(resolved)) {
    throw new Error(`Config not found: ${resolved}`);
  }

  const raw = YAML.parse(fs.readFileSync(resolved, 'utf8')) as Partial<RepoControlConfig>;
  if (!raw.productName || !raw.productSummary) {
    throw new Error('Config must include productName and productSummary');
  }

  const config: RepoControlConfig = {
    ...DEFAULTS,
    ...raw,
    productName: raw.productName,
    productSummary: String(raw.productSummary).trim(),
    exclusions: raw.exclusions ?? DEFAULTS.exclusions,
    checks: raw.checks ?? [],
    capabilities: raw.capabilities ?? [],
    repoRoot: resolveRepoRoot(raw.repoRoot),
  };

  return { config, configPath: resolved };
}
