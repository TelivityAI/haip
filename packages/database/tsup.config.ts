import { defineConfig } from 'tsup';

export default defineConfig({
  // push-schema and seed are emitted as runnable scripts so the production
  // Docker image (which ships only dist/, no tsx) can migrate+seed via `node`.
  entry: ['src/index.ts', 'src/schema/index.ts', 'src/push-schema.ts', 'src/seed.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
