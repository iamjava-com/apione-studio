import { buildApp } from './app.js';
import { config } from './config.js';
import { sqlite } from './db/client.js';
import { runMigrations } from './db/migrate.js';

runMigrations();

const app = buildApp();

/**
 * Let requests in flight finish, then check the WAL back into the database file.
 *
 * Node is PID 1 in the container, where the default answer to SIGTERM is to exit at once — which
 * cuts off whoever was mid-save and leaves the WAL for the next boot to replay.
 */
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (closing) return; // a second Ctrl-C is a request to stop waiting, and the default does that
    closing = true;
    app.log.info(`${signal} received, shutting down`);
    app
      .close()
      .catch((err) => app.log.error(err))
      .finally(() => {
        sqlite.close();
        process.exit(0);
      });
  });
}

app
  .listen({ port: config.port, host: config.host })
  .then(() => app.log.info(`ApiOne Studio server listening on http://${config.host}:${config.port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
