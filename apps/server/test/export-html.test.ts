import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { bootApp, createProject, putFile } from './helpers.js';

/** The HTML export's whole promise is that it opens from disk with no network, so the two things
 *  worth testing are that nothing external is referenced and that a spec cannot break out of the
 *  page it is embedded in. */

let app: FastifyInstance;
let headers: Record<string, string>;
let projectId: string;

// A title needing HTML escaping, and a description carrying a closing script tag.
const SPEC = `openapi: 3.1.0
info:
  title: Orders <API> & "friends"
  version: 1.0.0
  description: "</script><script>alert(1)</script>"
paths:
  /orders:
    get:
      summary: List orders
      x-team: payments
      responses:
        '200': { description: ok }
`;

before(async () => {
  ({ app, headers } = await bootApp('apione-exporthtml-'));
  projectId = (await createProject(app, headers, 'Orders')).id;
  await putFile(app, headers, projectId, 'openapi.yaml', SPEC);
});

test('the exported page carries both the document and its renderer', async () => {
  const r = await app.inject({ url: `/api/projects/${projectId}/spec.html`, headers });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'] as string, /text\/html/);
  assert.ok(r.body.includes('List orders'), 'the spec is embedded');
  assert.ok(r.body.length > 1_000_000, 'the renderer travels with it');
});

// Referencing anything at all would break the one thing this format is for.
test('nothing is fetched from anywhere — it opens offline', async () => {
  const html = (await app.inject({ url: `/api/projects/${projectId}/spec.html`, headers })).body;
  const external = html.match(/(?:src|href)="(?!data:)[^"]*"/g) ?? [];
  assert.deepEqual(external, [], 'no external src/href');
});

test('a spec cannot break out of the page it is embedded in', async () => {
  const html = (await app.inject({ url: `/api/projects/${projectId}/spec.html`, headers })).body;
  const jsonBlock = html.slice(html.indexOf('<script id="api-reference"'), html.indexOf('</script>'));
  assert.ok(!jsonBlock.includes('<script>alert(1)'), 'the closing tag in the description is neutralised');
  assert.ok(jsonBlock.includes('\\u003c'), 'it survives as an escape, so the document still parses');
  assert.ok(html.includes('<title>Orders &lt;API&gt; &amp; &quot;friends&quot;</title>'), 'the title is escaped');
});

// Scalar reads x- extensions to build the page — x-internal hides operations, x-tagGroups and
// x-displayName shape the navigation — so stripping them degrades the page and can reveal what
// was meant to stay hidden. The rendered copy is always whole, whatever the query says.
test('extensions are never stripped from the rendered page', async () => {
  const plain = (await app.inject({ url: `/api/projects/${projectId}/spec.html`, headers })).body;
  const asked = (await app.inject({ url: `/api/projects/${projectId}/spec.html?strip=x`, headers })).body;
  assert.ok(plain.includes('x-team'));
  assert.ok(asked.includes('x-team'), 'the page keeps its extensions even when asked to strip');
});

// Each of these is something that would otherwise reach out of the page or back into the app.
// The end-to-end proof that nothing is actually requested lives in the e2e suite, which opens
// the produced file; this pins the configuration that gets it there.
test('everything that phones home or sends live requests is switched off', async () => {
  const html = (await app.inject({ url: `/api/projects/${projectId}/spec.html`, headers })).body;
  const config = html.slice(html.indexOf('data-configuration='), html.indexOf('type="application/json"') + 200);
  for (const flag of [
    'withDefaultFonts&quot;:false', // webfonts from fonts.scalar.com
    'documentDownloadType&quot;:&quot;none', // a link back to the document this file replaces
    'disabled&quot;:true', // the AI agent panel
    'showDeveloperTools&quot;:&quot;never',
    'hideTestRequestButton&quot;:true', // live requests: blocked by CORS from file://, or proxied by a third party
    'hideClientButton&quot;:true',
  ]) {
    assert.ok(html.includes(flag), `${flag} — got: ${config}`);
  }
});

test('it is gated like every other read of the spec', async () => {
  assert.equal((await app.inject({ url: `/api/projects/${projectId}/spec.html` })).statusCode, 401);
});
