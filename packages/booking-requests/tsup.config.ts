import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';

export default defineConfig({
  // database/migrate is emitted as a runnable script (like packages/database)
  // so the production Docker image — which ships only dist/ and package.json,
  // no tsx/src — can run migrations via `node dist/database/migrate.js`.
  entry: {
    index: 'src/index.ts',
    'database/schema/index': 'src/database/schema/index.ts',
    'database/migrate': 'src/database/migrate.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  onSuccess: async () => {
    // migrate.ts resolves its migrations directory relative to its own
    // compiled location (import.meta.url), so this mirrors that for both
    // the source (src/database/migrations) and compiled (dist/database/migrations) paths.
    cpSync('src/database/migrations', 'dist/database/migrations', { recursive: true });
  },
});
