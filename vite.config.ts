import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4242',
      '/ws': { target: 'ws://localhost:4242', ws: true },
    },
  },
});
