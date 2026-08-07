import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromCli } from '../lib.mjs';

/**
 * Local / pre-go-live file and compose checks.
 * @returns {Promise<import('../lib.mjs').ProbeResult[]}>
 */
export async function runLocalFileProbes() {
  const root = repoRootFromCli();
  /** @type {import('../lib.mjs').ProbeResult[]} */
  const results = [];

  const requiredFiles = [
    'docker-compose.yml',
    'docker-compose.prod.yml',
    'docker-compose.auth.yml',
    '.env.production.example',
    'docs/deployment.md',
    'ops/harden/CHECKLIST.md',
    'ops/harden/TENANT_ISOLATION.md',
    'ops/harden/SURFACE_SMOKE.md',
  ];

  for (const rel of requiredFiles) {
    const full = path.join(root, rel);
    const ok = fs.existsSync(full);
    results.push({
      id: `file:${rel}`,
      ok,
      detail: ok ? 'present' : `missing at ${full}`,
    });
  }

  // .env.production — warn if missing (operators may use other secret injection)
  const envProd = path.join(root, '.env.production');
  if (fs.existsSync(envProd)) {
    const text = fs.readFileSync(envProd, 'utf8');
    const checks = [
      { id: 'env:AUTH_ENABLED', re: /^\s*AUTH_ENABLED\s*=\s*true\s*$/m },
      {
        id: 'env:no-insecure',
        re: null,
        ok: !/^\s*HAIP_ALLOW_INSECURE\s*=\s*true\s*$/m.test(text),
        detailFail: 'HAIP_ALLOW_INSECURE=true must not be set in production',
      },
      {
        id: 'env:DATABASE_URL',
        re: /^\s*DATABASE_URL\s*=\s*.+/m,
      },
      {
        id: 'env:REDIS_URL',
        re: /^\s*REDIS_URL\s*=\s*.+/m,
      },
    ];
    for (const c of checks) {
      if (c.re) {
        const ok = c.re.test(text);
        results.push({
          id: c.id,
          ok,
          detail: ok ? 'ok' : `check failed in .env.production`,
        });
      } else {
        results.push({
          id: c.id,
          ok: c.ok,
          detail: c.ok ? 'ok' : c.detailFail,
        });
      }
    }
  } else {
    results.push({
      id: 'env:.env.production',
      ok: true,
      skip: true,
      detail:
        'no .env.production yet — copy from .env.production.example before go-live',
    });
  }

  // Prod compose must force AUTH_ENABLED
  const prodCompose = path.join(root, 'docker-compose.prod.yml');
  if (fs.existsSync(prodCompose)) {
    const text = fs.readFileSync(prodCompose, 'utf8');
    const authOn = /AUTH_ENABLED:\s*['"]?true['"]?/.test(text);
    results.push({
      id: 'compose:prod-auth',
      ok: authOn,
      detail: authOn
        ? 'docker-compose.prod.yml sets AUTH_ENABLED=true'
        : 'docker-compose.prod.yml should set AUTH_ENABLED=true',
    });
  }

  // Vignette pack present
  const vignetteDir = path.join(root, 'ops/harden/vignettes');
  let vignetteCount = 0;
  if (fs.existsSync(vignetteDir)) {
    vignetteCount = fs
      .readdirSync(vignetteDir)
      .filter((f) => f.startsWith('base-') && f.endsWith('.md')).length;
  }
  results.push({
    id: 'vignettes',
    ok: vignetteCount >= 20,
    detail: `${vignetteCount} vignette files in ops/harden/vignettes`,
  });

  return results;
}
