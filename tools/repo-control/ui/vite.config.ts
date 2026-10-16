import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  // Absolute base so Discord's discordsays.com proxy resolves /assets correctly
  base: '/',
  publicDir: path.join(root, 'public'),
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: {
    include: ['@clerk/clerk-js'],
  },
  server: {
    port: 4173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/graphify': 'http://127.0.0.1:8787',
    },
  },
});
