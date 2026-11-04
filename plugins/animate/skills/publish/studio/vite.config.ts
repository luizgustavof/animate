import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// dev: `node tools/studio.mjs --dev --port 4747` serves the API; Vite serves the UI and proxies /api and /media to it
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4747', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:4747', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    cssMinify: true,
  },
});
