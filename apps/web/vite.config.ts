import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server proxies API / mock / instance docs to the backend.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev only imports these from workers, which the startup scan does not crawl; discovering one
  // on first use re-optimizes and reloads the page mid-session.
  optimizeDeps: { include: ['diff', 'yaml'] },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4100',
      '/docs': 'http://127.0.0.1:4100',
      '/mock': 'http://127.0.0.1:4100',
    },
  },
});
