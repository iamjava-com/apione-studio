import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server proxies API / mock / instance docs to the backend.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4100',
      '/docs': 'http://127.0.0.1:4100',
      '/mock': 'http://127.0.0.1:4100',
    },
  },
});
