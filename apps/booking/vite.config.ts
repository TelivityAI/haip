import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Two entry points:
//  - index.html  → standalone SPA
//  - src/embed.ts → small script a host page loads to mount the widget into
//                   a <div id="haip-booking" data-booking-key="pk_..."></div>
export default defineConfig({
  base: '/booking/',
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        embed: path.resolve(__dirname, 'src/embed.ts'),
      },
      output: {
        // Stable name for the embed snippet: /booking/embed.js
        entryFileNames: (chunk) =>
          chunk.name === 'embed' ? 'embed.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
