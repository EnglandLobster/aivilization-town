import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  base: '/ui/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    manifest: true,
    chunkSizeWarningLimit: 750,
  },
  server: {
    host: '127.0.0.1',
    port: 4318,
    proxy: {
      '/runtime': 'http://127.0.0.1:4317',
      '/simulations': 'http://127.0.0.1:4317',
      '/access': 'http://127.0.0.1:4317',
    },
  },
});
