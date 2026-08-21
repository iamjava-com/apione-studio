/**
 * Shared test bootstrap. Every suite runs in its own process (one per test file), so the pattern
 * is: point the APIONE_* env at a throwaway dir BEFORE any src module is imported, then migrate
 * and (for HTTP suites) build the app. All src imports in here are dynamic for that reason —
 * a static import would read config before the env is set.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';

export type AuthHeaders = Record<string, string>;

export const authHeader = (token: string): AuthHeaders => ({ authorization: `Bearer ${token}` });

/** mkdtemp + point APIONE_DATA_DIR / APIONE_DB_PATH at it. Call before importing any src module. */
export function tmpDataDir(prefix: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.APIONE_DATA_DIR = tmp;
  process.env.APIONE_DB_PATH = path.join(tmp, 'test.sqlite');
  return tmp;
}

/** Env + migrations, no HTTP app — for service-level suites. Returns the data dir. */
export async function bootData(prefix: string): Promise<string> {
  const tmp = tmpDataDir(prefix);
  const { runMigrations } = await import('../src/db/migrate.js');
  runMigrations();
  return tmp;
}

export interface BootAppOptions {
  /** `false` to leave first-run setup untouched (for suites that test registration itself). */
  admin?: false | { username?: string; password?: string };
  /** Listen on a real port, for suites that need a raw socket instead of `app.inject`. */
  listen?: boolean;
}

export interface BootedApp {
  app: FastifyInstance;
  /** The data dir (vault root) this suite writes under. */
  tmp: string;
  /** Bearer headers for the bootstrap admin; empty when `admin: false`. */
  headers: AuthHeaders;
  token: string;
  /** Bound port when `listen` was asked for; 0 otherwise. */
  port: number;
}

/** Fresh data dir + migrations + built app, with the first-run admin registered unless opted out. */
export async function bootApp(prefix: string, opts: BootAppOptions = {}): Promise<BootedApp> {
  const tmp = await bootData(prefix);
  const { buildApp } = await import('../src/app.js');
  const app = buildApp({ logger: false });
  let port = 0;
  if (opts.listen) {
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  } else {
    await app.ready();
  }

  let headers: AuthHeaders = {};
  let token = '';
  if (opts.admin !== false) {
    const admin = await registerAdmin(app, opts.admin?.username, opts.admin?.password);
    headers = admin.headers;
    token = admin.token;
  }
  return { app, tmp, headers, token, port };
}

/** First-run registration: creates the instance admin and returns its auto-login session. */
export async function registerAdmin(app: FastifyInstance, username = 'admin', password = 'secret12') {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password } });
  assert.equal(r.statusCode, 201, r.body);
  const body = r.json() as { token: string; user: { id: string; username: string; role: string } };
  return { token: body.token, headers: authHeader(body.token), user: body.user };
}

export async function login(app: FastifyInstance, username: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().token as string;
}

/** Provision an account the way the console does (server issues the password), then sign it in. */
export async function createUser(
  app: FastifyInstance,
  adminHeaders: AuthHeaders,
  username: string,
  role?: 'admin' | 'member',
) {
  const r = await app.inject({ method: 'POST', url: '/api/users', headers: adminHeaders, payload: { username, role } });
  assert.equal(r.statusCode, 201, r.body);
  const { id, password } = r.json() as { id: string; password: string };
  const token = await login(app, username, password);
  return { id, username, password, token, headers: authHeader(token) };
}

export async function createProject(app: FastifyInstance, headers: AuthHeaders, name: string, groupId?: string) {
  const r = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name, groupId } });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { id: string; name: string; groupId: string | null; groupName: string | null };
}

/** Write a project file at whatever version it currently has (0 when new). Asserts the write took. */
export async function putFile(
  app: FastifyInstance,
  headers: AuthHeaders,
  projectId: string,
  filePath: string,
  content: string,
) {
  const cur = await app.inject({ url: `/api/projects/${projectId}/files/${filePath}`, headers });
  const baseVersion = cur.statusCode === 200 ? (cur.json().version as number) : 0;
  const r = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/files/${filePath}`,
    headers,
    payload: { content, baseVersion },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r;
}
