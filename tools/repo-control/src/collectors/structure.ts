import fs from 'node:fs';
import path from 'node:path';
import type { CollectorResult, RepoControlConfig } from '../lib/types.js';

export async function collectStructure(
  config: RepoControlConfig,
): Promise<{ data: Record<string, unknown>; collector: CollectorResult }> {
  const started = Date.now();
  const root = config.repoRoot!;
  try {
    const apiModulesDir = path.join(root, 'apps/api/src/modules');
    const apiModules = fs.existsSync(apiModulesDir)
      ? fs.readdirSync(apiModulesDir).filter((n) =>
          fs.statSync(path.join(apiModulesDir, n)).isDirectory(),
        )
      : [];

    const controllers = findBySuffix(root, apiModulesDir, '.controller.ts');
    const services = findBySuffix(root, apiModulesDir, '.service.ts');
    const schemaDir = path.join(root, 'packages/database/src/schema');
    const schemas = fs.existsSync(schemaDir)
      ? fs.readdirSync(schemaDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      : [];
    const migrationsDir = path.join(root, 'packages/database/src/migrations');
    const migrations = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
      : [];

    const dashboardApp = path.join(root, 'apps/dashboard/src/App.tsx');
    const dashboardRoutes = extractDashboardRoutes(dashboardApp);

    return {
      data: {
        apiModules,
        controllerCount: controllers.length,
        serviceCount: services.length,
        controllers: controllers.slice(0, 200),
        schemas,
        migrationCount: migrations.length,
        migrations: migrations.slice(0, 200),
        dashboardRoutes,
      },
      collector: {
        id: 'structure',
        status: 'ok',
        durationMs: Date.now() - started,
        summary: `${apiModules.length} api modules, ${schemas.length} schemas, ${dashboardRoutes.length} dashboard routes`,
      },
    };
  } catch (err) {
    return {
      data: {},
      collector: {
        id: 'structure',
        status: 'failed',
        durationMs: Date.now() - started,
        summary: 'structure collector failed',
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function findBySuffix(repoRoot: string, dir: string, suffix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (abs: string): void => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, ent.name);
      if (ent.isDirectory()) walk(child);
      else if (ent.name.endsWith(suffix)) {
        out.push(path.relative(repoRoot, child).replace(/\\/g, '/'));
      }
    }
  };
  walk(dir);
  return out;
}

function extractDashboardRoutes(appPath: string): string[] {
  if (!fs.existsSync(appPath)) return [];
  const text = fs.readFileSync(appPath, 'utf8');
  const routes: string[] = [];
  const re = /path=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    routes.push(m[1]);
  }
  return routes;
}
