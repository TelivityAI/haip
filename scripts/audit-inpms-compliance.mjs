// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));
const defaultRoot = resolve(scriptDirectory, '..');
const allowlistFile = join(scriptDirectory, 'inpms-compliance-allowlist.json');

const expectedPackages = {
  'package.json': '@inhotel-io/inpms',
  'apps/api/package.json': '@inhotel-io/api',
  'apps/booking/package.json': '@inhotel-io/booking',
  'apps/dashboard/package.json': '@inhotel-io/dashboard',
  'packages/database/package.json': '@inhotel-io/database',
  'packages/shared/package.json': '@inhotel-io/shared',
  'tools/haip-connect-gpt/package.json': '@inhotel-io/connect-gpt',
  'tools/mock-bookingcom/package.json': '@inhotel-io/mock-bookingcom',
  'tools/mock-derbysoft/package.json': '@inhotel-io/mock-derbysoft',
  'tools/mock-siteminder/package.json': '@inhotel-io/mock-siteminder',
};

const userFacingFiles = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
  'HAIP_BUILD_PLAN.md',
  'apps/api/public/index.html',
  'apps/booking/index.html',
  'apps/booking/README.md',
  'apps/dashboard/index.html',
  'apps/dashboard/public/booking-preview.html',
  'tools/haip-connect-gpt/README.md',
  'tools/haip-connect-gpt/CHATGPT-GPT.md',
  'prompts/FIRST_SESSION_BOOTSTRAP.md',
];

const legacyBrandingPattern = /HAIP|Telivity|telivityhaip/i;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function lineMatches(content, pattern) {
  return content
    .split(/\r?\n/)
    .flatMap((line, index) => legacyBrandingPattern.test(line)
      ? [{ line: index + 1, text: line.trim(), match: line.match(legacyBrandingPattern)?.[0] ?? '' }]
      : []);
}

function isAllowed(entry, line) {
  return entry.patterns.some((pattern) => line.text.includes(pattern));
}

function findDependencyPackageFiles(root) {
  const files = [];
  const pnpmRoot = join(root, 'node_modules', '.pnpm');
  if (!existsSync(pnpmRoot)) return files;

  for (const entry of readdirSync(pnpmRoot)) {
    const packageRoot = join(pnpmRoot, entry, 'node_modules');
    if (!existsSync(packageRoot)) continue;
    for (const scopeOrPackage of readdirSync(packageRoot)) {
      const scopePath = join(packageRoot, scopeOrPackage);
      if (scopeOrPackage.startsWith('@') && existsSync(scopePath)) {
        for (const packageName of readdirSync(scopePath)) {
          const manifest = join(scopePath, packageName, 'package.json');
          if (existsSync(manifest)) files.push(manifest);
        }
      } else {
        const manifest = join(scopePath, 'package.json');
        if (existsSync(manifest)) files.push(manifest);
      }
    }
  }
  return [...new Set(files)];
}

function findModelArtifacts(root) {
  const artifacts = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (['.git', 'node_modules', 'dist'].includes(entry)) continue;
      const file = join(directory, entry);
      const stats = statSync(file);
      if (stats.isDirectory()) visit(file);
      else if (/\.(gguf|safetensors|bin)$/i.test(entry)) artifacts.push(relative(root, file));
    }
  };
  visit(root);
  return artifacts;
}

export function auditRepository(root = defaultRoot) {
  const errors = [];
  const warnings = [];
  const allowlist = readJson(join(root, 'scripts', 'inpms-compliance-allowlist.json'));
  const allowlistByPath = new Map(allowlist.entries.map((entry) => [entry.path, entry]));

  for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES']) {
    if (!existsSync(join(root, file))) errors.push(`Missing required legal file: ${file}`);
  }

  if (existsSync(join(root, 'NOTICE'))) {
    const notice = readFileSync(join(root, 'NOTICE'), 'utf8');
    for (const required of ['inHotel Sàrl', 'TelivityAI/haip', 'Apache License, Version 2.0']) {
      if (!notice.includes(required)) errors.push(`NOTICE is missing: ${required}`);
    }
  }

  for (const [relativePath, expectedName] of Object.entries(expectedPackages)) {
    const file = join(root, relativePath);
    if (!existsSync(file)) {
      errors.push(`Missing package manifest: ${relativePath}`);
      continue;
    }
    const manifest = readJson(file);
    if (manifest.name !== expectedName) errors.push(`${relativePath} must use package name ${expectedName}`);
    const text = readFileSync(file, 'utf8');
    if (/@telivityhaip|"name"\s*:\s*"haip"/.test(text)) errors.push(`Legacy package namespace remains in ${relativePath}`);
  }

  for (const relativePath of userFacingFiles) {
    const file = join(root, relativePath);
    if (!existsSync(file)) {
      errors.push(`Missing user-facing file listed for audit: ${relativePath}`);
      continue;
    }
    const allowlistEntry = allowlistByPath.get(relativePath);
    for (const match of lineMatches(readFileSync(file, 'utf8'))) {
      if (!allowlistEntry || !isAllowed(allowlistEntry, match)) {
        errors.push(`Unclassified legacy branding in ${relativePath}:${match.line}: ${match.text}`);
      }
    }
  }

  const dependencyLicenses = [];
  const missingDependencyLicenses = [];
  for (const file of findDependencyPackageFiles(root)) {
    const manifest = readJson(file);
    const license = manifest.license ?? (Array.isArray(manifest.licenses) ? manifest.licenses.map((item) => item.type ?? item).join(', ') : undefined);
    const record = { name: manifest.name, version: manifest.version, license: license ?? null };
    dependencyLicenses.push(record);
    if (!license) missingDependencyLicenses.push(record);
  }
  if (missingDependencyLicenses.length) {
    warnings.push(`${missingDependencyLicenses.length} installed dependencies do not declare a license in package.json; review before redistribution.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    dependencyLicenses,
    missingDependencyLicenses,
    modelArtifacts: findModelArtifacts(root),
    checkedAt: new Date().toISOString(),
  };
}

function parseArgs(args) {
  const options = { root: defaultRoot, json: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--root') options.root = resolve(args[++index]);
    if (args[index] === '--json') options.json = resolve(args[++index]);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditRepository(options.root);
  if (options.json) {
    mkdirSync(resolve(options.json, '..'), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`inPMS compliance audit: ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Dependency license records: ${report.dependencyLicenses.length}`);
  console.log(`Model artifacts found: ${report.modelArtifacts.length}`);
  for (const warning of report.warnings) console.warn(`WARN: ${warning}`);
  for (const error of report.errors) console.error(`ERROR: ${error}`);
  process.exitCode = report.ok ? 0 : 1;
}
