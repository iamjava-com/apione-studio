import { defineConfig } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

// Fresh data dir per run → deterministic first-run setup state, no cross-run buildup.
const DATA = path.join(os.tmpdir(), `apione-e2e-${Date.now()}`);

// Auto-starts the backend (fresh temp data dir) and the Vite dev server, then runs
// the browser tests against the real, proxied app.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // One backend + one shared DB for the whole run (below), and a singleton admin bootstrap:
  // parallel files would race on both. Serial keeps it deterministic, and files run in path
  // order so 01-auth.spec.ts hits the genuine first-run before anything creates the admin.
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    colorScheme: 'dark', // so system-follow yields dark by default in tests
    locale: 'en-US', // the language these tests assert in; the app otherwise follows the browser
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev',
      cwd: path.resolve(process.cwd(), '..', 'server'),
      url: 'http://127.0.0.1:4100/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        APIONE_DATA_DIR: DATA,
        APIONE_DB_PATH: path.join(DATA, 'e2e.sqlite'),
        PORT: '4100',
        HOST: '127.0.0.1',
      },
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
