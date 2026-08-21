import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { bootApp } from './helpers.js';

let tmp: string;
let app: FastifyInstance;
let port: number;

/**
 * A real socket, because `app.inject` normalizes an absolute-form request target away — a test
 * written against inject alone passes on the unfixed code and proves nothing.
 */
function rawRequest(requestLine: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    sock.on('data', (d: Buffer) => chunks.push(d));
    sock.on('error', reject);
    sock.on('close', () => {
      const text = Buffer.concat(chunks).toString();
      resolve({ status: Number(text.slice(9, 12)), body: text.slice(text.indexOf('\r\n\r\n') + 4) });
    });
    const headers = [`Host: 127.0.0.1:${port}`, 'Connection: close'];
    if (body !== undefined)
      headers.push('Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`);
    sock.write(`${requestLine} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n${body ?? ''}`);
  });
}

const PREVIEW = JSON.stringify({ content: 'openapi: 3.1.0\ninfo: { title: Confidential, version: "1" }\npaths: {}\n' });

before(async () => {
  ({ app, tmp, port } = await bootApp('apione-target-', { admin: false, listen: true }));
});
after(async () => app.close());

test('an absolute-form request target still meets the auth gate', async () => {
  // The router strips the origin before matching; a gate reading req.url does not.
  for (const target of [
    `http://127.0.0.1:${port}/api/projects/import/preview`,
    'https://evil.example/api/projects/import/preview',
    'http:///api/projects/import/preview',
  ]) {
    const r = await rawRequest(`POST ${target}`, PREVIEW);
    assert.equal(r.status, 401, `${target} answered ${r.status}: ${r.body}`);
  }
});

test('a percent-encoded /api prefix still meets the auth gate', async () => {
  // The router percent-decodes before matching, so `/%61pi` routes as `/api`. WHATWG URL parsing
  // does not decode, which is why reading a pathname off req.url is not enough either.
  for (const target of ['/%61pi/projects/import/preview', '/%61pi/projects']) {
    const r = await rawRequest(`POST ${target}`, PREVIEW);
    assert.equal(r.status, 401, `${target} answered ${r.status}: ${r.body}`);
  }
});

test('no /api route answers 500 to an anonymous request', async () => {
  // A 500 means an unauthenticated request reached a handler. Today that is harmless only where
  // the handler happens to dereference req.user early — safety by accident, which this pins down.
  const routes = [
    ['GET', '/api/projects'],
    ['GET', '/api/users'],
    ['GET', '/api/groups'],
    ['POST', '/api/groups'],
    ['GET', '/api/tokens'],
    ['POST', '/api/tokens'],
    ['DELETE', '/api/tokens/x'],
    ['POST', '/api/projects'],
  ] as const;
  for (const [method, p] of routes) {
    for (const target of [p, `http://127.0.0.1:${port}${p}`, p.replace('/api/', '/%61pi/')]) {
      const r = await rawRequest(`${method} ${target}`, method === 'GET' ? undefined : '{}');
      assert.notEqual(r.status, 500, `${method} ${target} reached a handler unauthenticated`);
    }
  }
});

test('an anonymous create leaves nothing behind', async () => {
  // POST /api/projects writes the row and the vault dir before it ever looks at req.user, so a
  // handler it reaches unauthenticated is not merely a failed request.
  const vault = path.join(tmp, 'projects');
  const count = () => (fs.existsSync(vault) ? fs.readdirSync(vault).length : 0);
  const before = count();
  await rawRequest(`POST http://127.0.0.1:${port}/api/projects`, JSON.stringify({ name: 'ORPHAN' }));
  await rawRequest('POST /%61pi/projects', JSON.stringify({ name: 'ORPHAN' }));
  assert.equal(count(), before, 'an anonymous request created a project');
});

test('the bootstrap endpoints stay reachable without a credential', async () => {
  const status = await rawRequest('GET /api/auth/status');
  assert.equal(status.status, 200);

  // Both the gate and a wrong password answer 401, so the error code is what says which one ran.
  const login = await rawRequest('POST /api/auth/login', JSON.stringify({ username: 'nobody', password: 'wrong123' }));
  assert.equal(JSON.parse(login.body).error, 'invalid_credentials');
});

test('an /api route with no auth guard fails at registration', async () => {
  // The gate is a second layer; this is what stops the next route from relying on it.
  const { buildApp } = await import('../src/app.js');
  const fresh = buildApp({ logger: false });
  assert.throws(() => fresh.get('/api/deliberately-unguarded', async () => 'x'), /no auth guard/);
  await fresh.close();
});
