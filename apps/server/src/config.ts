import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The sibling web build, at the same depth from src and dist. Absent until `npm run build` runs.
const siblingWeb = path.resolve(here, '..', '..', 'web', 'dist');

const dataDir = process.env.APIONE_DATA_DIR
  ? path.resolve(process.env.APIONE_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const config = {
  /** Root data dir; everything self-hosted lives under here. */
  dataDir,
  /** The vault: `data/projects/{projectId}/...` — files on disk are the source of truth. */
  vaultDir: path.join(dataDir, 'projects'),
  /** SQLite index/history/concurrency ledger (NOT the source of truth). */
  dbPath: process.env.APIONE_DB_PATH ?? path.join(dataDir, 'apione.sqlite'),
  port: Number(process.env.PORT ?? 4100),
  host: process.env.HOST ?? '127.0.0.1',
  /** Built web SPA to serve alongside the API. Defaults to the sibling build once there is one. */
  webDist: process.env.APIONE_WEB_DIST
    ? path.resolve(process.env.APIONE_WEB_DIST)
    : fs.existsSync(siblingWeb)
      ? siblingWeb
      : null,
} as const;
