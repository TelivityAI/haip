import fs from 'node:fs';
import path from 'node:path';
import type { CollectorResult, GraphifyInfo, RepoControlConfig } from '../lib/types.js';
import { writeImportGraph } from './import-graph.js';

/**
 * Repo map is built from TypeScript imports in apps/ and packages/.
 * Folder nodes, import edges, and communities (api module, dashboard area, package).
 */
export async function collectGraphify(
  config: RepoControlConfig,
): Promise<{ data: GraphifyInfo; collector: CollectorResult }> {
  const started = Date.now();
  const root = config.repoRoot!;
  const dirRel = config.graphifyDir;
  const dirAbs = path.isAbsolute(dirRel) ? dirRel : path.join(root, dirRel);

  if (!config.graphifyEnabled) {
    return {
      data: emptyGraphify('skipped', dirAbs, 'Graphify disabled in config.'),
      collector: {
        id: 'graphify',
        status: 'skipped',
        durationMs: Date.now() - started,
        summary: 'disabled',
      },
    };
  }

  fs.mkdirSync(dirAbs, { recursive: true });
  const data = writeImportGraph(root, dirAbs);
  return {
    data,
    collector: {
      id: 'graphify',
      status: 'ok',
      durationMs: Date.now() - started,
      summary: data.summary,
    },
  };
}

function emptyGraphify(
  status: GraphifyInfo['status'],
  dir: string | null,
  summary: string,
): GraphifyInfo {
  return {
    status,
    dir,
    htmlPath: null,
    jsonPath: null,
    reportPath: null,
    nodeCount: null,
    edgeCount: null,
    summary,
  };
}
