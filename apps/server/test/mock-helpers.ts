/**
 * Shared helpers for driving the mock catalog over HTTP. Mocks are addressed by the operation's
 * id; the catalog is what hands them out, so every helper starts from a method + path lookup.
 *
 * All writes assert their status code — a setup step that silently failed used to surface three
 * tests later as a baffling wrong answer.
 */
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { putFile, type AuthHeaders } from './helpers.js';

/** `projectId` is mutable on purpose: suites that re-create their project per test just reassign it. */
export interface MockCtx {
  app: FastifyInstance;
  headers: AuthHeaders;
  projectId: string;
}

export const opIdOf = async (ctx: MockCtx, method: string, p: string): Promise<string> => {
  const cat = await ctx.app.inject({ url: `/api/projects/${ctx.projectId}/mock`, headers: ctx.headers });
  const op = cat.json().operations.find((o: { method: string; path: string }) => o.method === method && o.path === p);
  assert.ok(op, `no catalog entry for ${method} ${p}`);
  return op.opId;
};

export const readCode = async (ctx: MockCtx, opId: string) => {
  const r = await ctx.app.inject({
    url: `/api/projects/${ctx.projectId}/mock/code?opId=${opId}`,
    headers: ctx.headers,
  });
  assert.equal(r.statusCode, 200, r.body);
  return r;
};

/** Reads the current version first — hardcoding baseVersion couples every test to how many
 *  writes happened to run before it. Returns the operation's id. */
export const putCode = async (ctx: MockCtx, method: string, p: string, content: string): Promise<string> => {
  const opId = await opIdOf(ctx, method, p);
  const cur = await readCode(ctx, opId);
  const res = await ctx.app.inject({
    method: 'PUT',
    url: `/api/projects/${ctx.projectId}/mock/code`,
    headers: ctx.headers,
    payload: { opId, content, baseVersion: cur.json().version },
  });
  assert.equal(res.statusCode, 200, res.body);
  return opId;
};

export const setMode = async (ctx: MockCtx, method: string, p: string, mode: 'auto' | 'scripted'): Promise<void> => {
  const res = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/projects/${ctx.projectId}/mock/mode`,
    headers: ctx.headers,
    payload: { opId: await opIdOf(ctx, method, p), mode },
  });
  assert.equal(res.statusCode, 200, res.body);
};

/** Give an operation code and switch it on. Returns the operation's id. */
export const scriptedMock = async (ctx: MockCtx, method: string, p: string, content: string): Promise<string> => {
  const opId = await putCode(ctx, method, p, content);
  await setMode(ctx, method, p, 'scripted');
  return opId;
};

export const putSpec = (ctx: MockCtx, content: string) =>
  putFile(ctx.app, ctx.headers, ctx.projectId, 'openapi.yaml', content);
