import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildImportGraph } from './import-graph.js';

describe('buildImportGraph', () => {
  it('names modules and keeps internal file links', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haip-graph-'));
    const files: Record<string, string> = {
      'apps/api/src/modules/reservation/reservation.service.ts':
        "import { FolioService } from '../folio/folio.service';\nimport { guests } from '@telivityhaip/database';\nimport { DatabaseModule } from '../../database/database.module';\nimport { ModifyDto } from './dto/modify-reservation.dto';\n",
      'apps/api/src/modules/reservation/dto/modify-reservation.dto.ts': 'export class ModifyDto {}\n',
      'apps/api/src/modules/folio/folio.service.ts': 'export class FolioService {}\n',
      'apps/api/src/database/database.module.ts': 'export class DatabaseModule {}\n',
      'packages/database/src/index.ts': 'export const guests = {};\n',
      'apps/dashboard/src/pages/FrontDesk.tsx': "import { api } from '@/lib/api';\n",
      'apps/dashboard/src/lib/api.ts': 'export const api = {};\n',
      'apps/api/src/modules/reservation/reservation.service.spec.ts':
        "import { FolioService } from '../folio/folio.service';\n",
    };
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }

    const graph = buildImportGraph(root);
    const reservation = graph.nodes.find((n) => n.id === 'api/reservation');
    const folio = graph.nodes.find((n) => n.id === 'api/folio');
    expect(reservation?.label).toBe('Reservation');
    expect(reservation?.group).toBe('API');
    expect(folio?.label).toBe('Folio');
    expect(graph.nodes.some((n) => n.id.includes('dto'))).toBe(false);
    expect(reservation?.internal.some((link) => link.target.endsWith('modify-reservation.dto.ts'))).toBe(
      true,
    );

    const edge = graph.links.find((l) => l.source === 'api/reservation' && l.target === 'api/folio');
    expect(edge?.relationship).toBe('imports');
    expect(edge?.weight).toBe(1);
    expect(graph.links.some((l) => l.target === 'package/database')).toBe(true);
    expect(graph.nodes.find((n) => n.id === 'api/database')?.label).toBe('Database');
    expect(graph.links.some((l) => l.source === 'dashboard/pages' && l.target === 'dashboard/lib')).toBe(
      true,
    );
    expect(graph.nodes.find((n) => n.id === 'dashboard/pages')?.label).toBe('Pages');
  });
});
