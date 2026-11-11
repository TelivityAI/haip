import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';

export default defineConfig({
  // push-schema, run-migrations, seed and link-integration-principal are emitted as
  // runnable scripts so the production Docker image (which ships only dist/, no tsx)
  // can migrate, seed and link service principals via `node`.
  entry: [
    'src/index.ts',
    'src/schema/index.ts',
    'src/push-schema.ts',
    'src/run-migrations.ts',
    'src/seed.ts',
    'src/link-integration-principal.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  onSuccess: async () => {
    cpSync('src/migrations', 'dist/migrations', { recursive: true });
  },
});
