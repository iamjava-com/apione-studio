import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Apply drizzle migrations. Resolves to apps/server/drizzle in both dev (src) and prod (dist). */
export function runMigrations(): void {
  migrate(db, { migrationsFolder: path.resolve(here, '..', '..', 'drizzle') });
}
