import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildImportGraph } from './import-graph.js';

describe('buildImportGraph', () => {
  it('links folders and groups them into communities', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haip-graph-'));
    const files: Record<string, string> = {
      'apps/api/src/modules/reservation/reservation.service.ts':
        "import { FolioService } from '../folio/folio.service';\nimport { guests } from '@telivityhaip/database';\nimport { DatabaseModule } from '../../database/database.module';\n",
      'apps/api/src/modules/folio/folio.service.ts': 'export class FolioService {}\n',
      'apps/api/src/database/database.module.ts': 'export class DatabaseModule {}\n',
      'packages/database/src/index.ts': 'export const guests = {};\n',
      'apps/dashboard/src/pages/FrontDesk.tsx': "import { api } from '@/lib/api';\n",
      'apps/dashboard/src/lib/api.ts': 'export const api = {};\n',
    };
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }

    const graph = buildImportGraph(root);
    const edge = graph.links.find(
      (l) => l.source.endsWith('modules/reservation') && l.target.endsWith('modules/folio'),
    );
    expect(edge?.relationship).toBe('imports');
    expect(edge?.weight).toBe(1);
    expect(graph.nodes.find((n) => n.id.endsWith('modules/reservation'))?.community).toBe(
      'api/reservation',
    );
    expect(graph.nodes.find((n) => n.id.endsWith('modules/folio'))?.community).toBe('api/folio');
    expect(graph.links.some((l) => l.target.includes('packages/database'))).toBe(true);
    expect(graph.nodes.find((n) => n.id.endsWith('src/database'))?.community).toBe('api/database');
    expect(graph.links.some((l) => l.source.includes('dashboard/src/pages') && l.target.includes('dashboard/src/lib'))).toBe(
      true,
    );
  });
});
