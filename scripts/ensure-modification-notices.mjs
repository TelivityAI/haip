// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

const comment = 'Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.';
const exemptFiles = new Set(['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES']);
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const baseIndex = args.indexOf('--base');
const base = baseIndex >= 0 ? args[baseIndex + 1] : null;
const diffArguments = base ? ['diff', '--name-only', `${base}...HEAD`] : ['diff', '--name-only'];
const files = execFileSync('git', diffArguments, { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const missing = [];

for (const file of files) {
  if (exemptFiles.has(file)) continue;
  if (/\.json$|\.lock$|^pnpm-lock\.yaml$/.test(file)) continue;
  const extension = extname(file).toLowerCase();
  const prefix = extension === '.md' || extension === '.html'
    ? `<!-- ${comment} -->\n`
    : extension === '.yml' || extension === '.yaml' || file.endsWith('Dockerfile')
      ? `# ${comment}\n`
      : `// ${comment}\n`;
  const content = readFileSync(file, 'utf8');
  if (!content.includes('Modified by inHotel Sàrl')) {
    if (checkOnly) missing.push(file);
    else writeFileSync(file, `${prefix}${content}`);
  }
}

if (missing.length) {
  console.error(`Missing modification notices: ${missing.join(', ')}`);
  process.exitCode = 1;
}
