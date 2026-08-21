import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { bootApp, createProject } from './helpers.js';

let tmp: string;
/** Stand-in for anything the server can read but a spec author must not reach: /etc/passwd, the
 *  JWT secret, the SQLite file. Outside the vault entirely. */
let OUTSIDE: string;
const OUTSIDE_MARKER = 'ThisMustNeverAppearInABundle';

const BASE = `openapi: 3.1.0
info: { title: T, version: 1.0.0 }
paths: {}
components:
  schemas:
    Local: { $ref: './shared.yaml#/Pet' }
`;

const SHARED = `Pet:
  type: object
  properties: { name: { type: string } }
`;

let app: FastifyInstance;
let h: Record<string, string>;
let projectId: string;
let otherProjectId: string;
/** Stands in for anything reachable over the network — an intranet host, a cloud metadata service. */
let remote: http.Server;
let remoteUrl: string;

const putFile = async (id: string, name: string, content: string) => {
  const cur = await app.inject({ url: `/api/projects/${id}/files/${name}`, headers: h });
  return app.inject({
    method: 'PUT',
    url: `/api/projects/${id}/files/${name}`,
    headers: h,
    payload: { content, baseVersion: cur.statusCode === 200 ? cur.json().version : 0 },
  });
};

/** Point the root's one schema at `ref` and return what /spec.json makes of it. */
const bundleWithRef = async (ref: string) => {
  await putFile(projectId, 'openapi.yaml', BASE.replace("'./shared.yaml#/Pet'", `'${ref}'`));
  const r = await app.inject({ url: `/api/projects/${projectId}/spec.json`, headers: h });
  return { status: r.statusCode, body: r.body };
};

before(async () => {
  ({ app, tmp, headers: h } = await bootApp('apione-refjail-'));
  OUTSIDE = path.join(tmp, 'outside-secret.yaml');

  // `example` so the marker travels all the way into a generated mock body, not just the bundle.
  fs.writeFileSync(OUTSIDE, `Leaked: { type: string, example: ${OUTSIDE_MARKER} }\n`, 'utf8');

  remote = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/yaml' });
    res.end(`Leaked: { type: string, example: ${OUTSIDE_MARKER} }\n`);
  });
  await new Promise<void>((r) => remote.listen(0, '127.0.0.1', r));
  remoteUrl = `http://127.0.0.1:${(remote.address() as AddressInfo).port}/evil.yaml`;

  projectId = (await createProject(app, h, 'A')).id;
  await putFile(projectId, 'openapi.yaml', BASE);
  await putFile(projectId, 'shared.yaml', SHARED);

  otherProjectId = (await createProject(app, h, 'B')).id;
  await putFile(
    otherProjectId,
    'openapi.yaml',
    `openapi: 3.1.0\ninfo: { title: ${OUTSIDE_MARKER}B, version: 1.0.0 }\npaths: {}\n`,
  );
});

test('a $ref to a sibling file in the project still resolves', async () => {
  const r = await bundleWithRef('./shared.yaml#/Pet');
  assert.equal(r.status, 200);
  assert.match(r.body, /"name"/, 'the sibling schema should have been inlined');
});

test('a $ref to a subdirectory of the project still resolves', async () => {
  await putFile(projectId, 'parts/deep.yaml', 'Deep: { type: string, title: FromSubdir }\n');
  const r = await bundleWithRef('./parts/deep.yaml#/Deep');
  assert.equal(r.status, 200);
  assert.match(r.body, /FromSubdir/);
});

test('a $ref to an absolute path outside the vault reads nothing', async () => {
  const r = await bundleWithRef(`${OUTSIDE}#/Leaked`);
  assert.doesNotMatch(r.body, new RegExp(OUTSIDE_MARKER), 'file outside the vault was inlined into the bundle');
});

test('a $ref that climbs out of the project reads nothing', async () => {
  const r = await bundleWithRef('../../outside-secret.yaml#/Leaked');
  assert.doesNotMatch(r.body, new RegExp(OUTSIDE_MARKER));
});

test('a $ref into a sibling project reads nothing', async () => {
  // The jail is one project, not the vault root: projects are separate tenants, and `spec:write`
  // on A must not become a read of B.
  const r = await bundleWithRef(`../${otherProjectId}/openapi.yaml#/info`);
  assert.doesNotMatch(r.body, new RegExp(`${OUTSIDE_MARKER}B`));
});

test('a $ref through a symlink pointing out of the project reads nothing', async () => {
  // A prefix test on the literal path would pass this one.
  const link = path.join(tmp, 'projects', projectId, 'link.yaml');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(OUTSIDE, link);
  const r = await bundleWithRef('./link.yaml#/Leaked');
  assert.doesNotMatch(r.body, new RegExp(OUTSIDE_MARKER));
});

test('a remote $ref is refused rather than fetched', async () => {
  // The fetch itself is the bug: the server is the one making the request (SSRF), and whatever
  // comes back is inlined into the bundle for the caller to read.
  const r = await bundleWithRef(`${remoteUrl}#/Leaked`);
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.body, new RegExp(OUTSIDE_MARKER), 'the server fetched a remote $ref');
});

test('a refused $ref surfaces as a lint problem, not a 500', async () => {
  await putFile(projectId, 'openapi.yaml', BASE.replace("'./shared.yaml#/Pet'", `'${OUTSIDE}#/Leaked'`));
  const r = await app.inject({ url: `/api/projects/${projectId}/lint`, headers: h });
  assert.equal(r.statusCode, 200);
  const messages = r.json().problems.map((p: { message: string }) => p.message);
  assert.ok(
    messages.some((m: string) => /escapes the project directory/.test(m)),
    `expected an escape problem, got ${JSON.stringify(messages)}`,
  );
});

test('the anonymous mock gateway cannot be used to read outside the project either', async () => {
  // /mock bundles the spec on every request and needs no credentials, so it is the cheapest way to
  // reach the resolver — the guard has to sit in the engine adapter, not in an /api route.
  await putFile(
    projectId,
    'openapi.yaml',
    `openapi: 3.1.0
info: { title: T, version: 1.0.0 }
paths:
  /thing:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '${OUTSIDE}#/Leaked' }
`,
  );
  const r = await app.inject({ url: `/mock/${projectId}/thing` });
  assert.doesNotMatch(r.body, new RegExp(OUTSIDE_MARKER));
});

after(() => remote.close());
