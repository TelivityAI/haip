import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCapabilities } from './capabilities.js';
import type { RepoControlConfig } from '../lib/types.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('collectCapabilities', () => {
  it('marks present HAIP reservation module as implemented_unverified or better', async () => {
    const config: RepoControlConfig = {
      productName: 'HAIP',
      productSummary: 'test',
      repoRoot,
      exclusions: ['node_modules', 'dist'],
      graphifyDir: 'graphify-out',
      graphifyEnabled: false,
      graphifyTimeoutMs: 1000,
      checks: [],
      recentCommitLimit: 5,
      todoLimit: 5,
      largeFileLineThreshold: 900,
      staleAfterMinutes: 60,
      capabilities: [
        {
          id: 'reservations',
          name: 'Reservations',
          requiredPaths: ['apps/api/src/modules/reservation'],
          optionalPaths: ['apps/dashboard/src/pages/Reservations.tsx'],
          testPaths: ['apps/api/src/modules/reservation'],
          routeHints: ['/reservations'],
          consequence: 'no stays',
        },
      ],
    };
    const { data } = await collectCapabilities(
      config,
      { dashboardRoutes: ['/reservations/*'] },
      {},
    );
    expect(data[0].status).not.toBe('planned_only');
    expect(data[0].status).not.toBe('unknown');
    expect(data[0].files.length).toBeGreaterThan(0);
    expect(data[0].verification.toLowerCase()).toContain('does not prove');
  });

  it('marks missing capability as unknown/planned', async () => {
    const config: RepoControlConfig = {
      productName: 'HAIP',
      productSummary: 'test',
      repoRoot,
      exclusions: [],
      graphifyDir: 'graphify-out',
      graphifyEnabled: false,
      graphifyTimeoutMs: 1000,
      checks: [],
      recentCommitLimit: 5,
      todoLimit: 5,
      largeFileLineThreshold: 900,
      staleAfterMinutes: 60,
      capabilities: [
        {
          id: 'missing-thing',
          name: 'Missing',
          requiredPaths: ['does/not/exist-anywhere'],
          consequence: 'gap',
        },
      ],
    };
    const { data } = await collectCapabilities(config, {}, {});
    expect(['unknown', 'planned_only']).toContain(data[0].status);
  });
});
