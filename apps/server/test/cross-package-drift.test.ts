/**
 * Pins the hand-copied mirrors between the two packages. server and web install separately and
 * share no build, so a handful of rules and constants exist twice by design; nothing but this
 * file notices when one side is edited and the other is not.
 *
 * When a test here fails: the two files it names have drifted apart. Whichever side you changed
 * on purpose, mirror the edit in the other file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serverBasePaths as serverBases } from '../src/services/spec-servers.js';
import { ALL_PERMISSIONS } from '../src/permissions.js';
import { OP_ID_KEY as SERVER_OP_ID_KEY } from '../src/services/operations.js';
import { bootData } from './helpers.js';

const WEB_SRC = path.resolve(import.meta.dirname, '../../web/src');
const SERVER_SRC = path.resolve(import.meta.dirname, '../src');

const readWeb = (rel: string) => fs.readFileSync(path.join(WEB_SRC, rel), 'utf8');
const importWeb = (rel: string) => import(pathToFileURL(path.join(WEB_SRC, rel)).href);

const SYNC = 'whichever side you changed, mirror the edit in the other file';

test('base-path: the web copy of the servers[] rules computes what the server computes', async () => {
  // apps/web/src/lib/base-path.ts declares itself a copy of apps/server/src/services/spec-servers.ts.
  const web = (await importWeb('lib/base-path.ts')) as { serverBasePaths: (servers: unknown) => string[] };

  const cases: unknown[] = [
    undefined,
    [],
    [{ url: '/' }],
    [{ url: '/v1/beta/' }],
    [{ url: 'https://api.example.com' }],
    [
      { url: 'https://api.example.com/v1' },
      { url: 'https://api-staging.example.com/v1' }, // same base, different host → deduped
      { url: 'https://api.example.com' },
      { url: '/' },
      { url: '/v1/beta/' },
      { url: 'https://api.example.com/{ver}' }, // no default to resolve {ver} with
    ],
    [{ url: 'https://{env}.example.com/{ver}', variables: { env: { default: 'api' }, ver: { default: 'v1' } } }],
    [{ url: 'https://x.example.com/{ver}' }], // nothing resolvable at all
    [{ url: 42 }, { url: '/ok' }], // a malformed server is skipped, not fatal
    [{ url: '/api' }, { url: '/' }],
  ];
  for (const servers of cases) {
    assert.deepEqual(
      web.serverBasePaths(servers),
      serverBases({ servers }),
      `serverBasePaths(${JSON.stringify(servers)}) differs between apps/web/src/lib/base-path.ts and ` +
        `apps/server/src/services/spec-servers.ts — ${SYNC}`,
    );
  }
});

test('Permission: the union the web declares is exactly what the server grants', () => {
  // The web side is a type, so it is read off the source text; the server side is runtime.
  const source = readWeb('api.ts');
  const block = /export type Permission =([^;]+);/.exec(source);
  assert.ok(block, 'apps/web/src/api.ts no longer declares `export type Permission` — update this test with it');
  const webNames = [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
  assert.deepEqual(
    webNames,
    [...ALL_PERMISSIONS].sort(),
    `the Permission union in apps/web/src/api.ts does not match apps/server/src/permissions.ts — ${SYNC}`,
  );
});

test('STAGES and DEFAULT_STAGE: the workflow the web shows is the one the server enforces', async () => {
  await bootData('apione-drift-'); // the status service pulls in the db client, which wants a data dir
  const server = await import('../src/services/operation-status-service.js');
  const web = (await importWeb('api.ts')) as { STAGES: readonly string[]; DEFAULT_STAGE: string };

  assert.deepEqual(
    [...web.STAGES],
    [...server.STAGES],
    `STAGES in apps/web/src/api.ts does not match apps/server/src/services/operation-status-service.ts — ${SYNC}`,
  );
  assert.equal(
    web.DEFAULT_STAGE,
    server.DEFAULT_STAGE,
    `DEFAULT_STAGE in apps/web/src/api.ts does not match apps/server/src/services/operation-status-service.ts — ${SYNC}`,
  );
});

test('OP_ID_KEY: both sides address an operation by the same extension key', () => {
  // The web module drags UI imports along, so its constant is read off the source text.
  const m = /export const OP_ID_KEY = '([^']+)'/.exec(readWeb('components/form/constants.ts'));
  assert.ok(m, 'apps/web/src/components/form/constants.ts no longer declares OP_ID_KEY — update this test with it');
  assert.equal(
    m[1],
    SERVER_OP_ID_KEY,
    `OP_ID_KEY in apps/web/src/components/form/constants.ts does not match apps/server/src/services/operations.ts — ${SYNC}`,
  );
});

test('mock debug headers: the panel sends the header names the gateway reads', () => {
  // Unexported consts on both sides — compared as source text.
  const serverSource = fs.readFileSync(path.join(SERVER_SRC, 'routes/mock.ts'), 'utf8');
  const webSource = readWeb('components/MockDebugPanel.tsx');
  for (const name of ['DEBUG_HEADER', 'LOGS_HEADER']) {
    const re = new RegExp(`const ${name} = '([^']+)'`);
    const onServer = re.exec(serverSource);
    const onWeb = re.exec(webSource);
    assert.ok(onServer, `apps/server/src/routes/mock.ts no longer declares ${name} — update this test with it`);
    assert.ok(
      onWeb,
      `apps/web/src/components/MockDebugPanel.tsx no longer declares ${name} — update this test with it`,
    );
    assert.equal(
      onWeb[1],
      onServer[1],
      `${name} in apps/web/src/components/MockDebugPanel.tsx does not match apps/server/src/routes/mock.ts — ${SYNC}`,
    );
  }
});
