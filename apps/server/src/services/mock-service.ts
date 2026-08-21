import { AppError, NotFoundError } from '../errors.js';
import { getProject } from './project-service.js';
import { bundleProjectView } from './spec-service.js';
import { generateFromSchema, inlineRefs } from './mock-generator.js';
import * as cfg from './mock-config-service.js';
import { readCode } from './mock-catalog-service.js';
import { OP_ID_KEY } from './operations.js';
import { serverBasePaths, sortByStripOrder, stripBasePath } from './spec-servers.js';
import { runScriptedMock } from './mock-sandbox.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * `/users/{id}` vs `/users/42` → `{ id: '42' }`, or null if it doesn't fit.
 *
 * The gateway and the editor's debug run share this, so a mock sees an identically-shaped `req`
 * either way — a debug run that fed different params than production would be worse than none.
 */
export function matchTemplate(template: string, reqPath: string): Record<string, string> | null {
  const tmplSegs = template.split('/').filter(Boolean);
  const reqSegs = reqPath.split('/').filter(Boolean);
  if (tmplSegs.length !== reqSegs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < tmplSegs.length; i++) {
    const t = tmplSegs[i]!;
    const r = reqSegs[i]!;
    if (t.startsWith('{') && t.endsWith('}')) params[t.slice(1, -1)] = decodeURIComponent(r);
    else if (t !== r) return null;
  }
  return params;
}

interface PathMatch {
  pathItem: any;
  /** The spec path template that matched, e.g. /users/{id}. */
  template: string;
  params: Record<string, string>;
}

/**
 * Match a request path against spec path templates (e.g. /users/{id}).
 *
 * Literal templates win over parameterised ones regardless of declaration order: `/users/me` and
 * `/users/{id}` both fit `GET /users/me`, and every real router — and the OpenAPI spec itself —
 * treats the concrete one as the answer. Going in document order would hand it to whichever the
 * author happened to write first.
 */
function matchPath(paths: Record<string, any>, reqPath: string): PathMatch | null {
  const entries = Object.entries(paths);
  const isTemplated = (t: string) => t.includes('{');
  for (const [template, pathItem] of entries) {
    if (isTemplated(template)) continue;
    const params = matchTemplate(template, reqPath);
    if (params) return { pathItem, template, params };
  }
  for (const [template, pathItem] of entries) {
    if (!isTemplated(template)) continue;
    const params = matchTemplate(template, reqPath);
    if (params) return { pathItem, template, params };
  }
  return null;
}

/**
 * A mock answers at `/mock/{projectId}` + a declared base path + the `paths` key — the same shape
 * the real API has, since a base path lives in `servers[].url` rather than in every path.
 *
 * Declaring one therefore *moves* the endpoint: the bare address stops answering, because the API
 * being mocked doesn't answer there either. Declaring a server with no path in it (`/`, or a bare
 * host) declares the root, which is the empty base — so an untouched project is unaffected.
 *
 * Every declared base is accepted — each one is an address the author wrote down. Nothing else is:
 * stripping an arbitrary leading segment would turn a stale or misspelled prefix into a 200.
 */
function matchWithBasePaths(spec: any, reqPath: string): PathMatch | null {
  const paths = spec.paths ?? {};
  for (const base of sortByStripOrder(serverBasePaths(spec))) {
    const rest = stripBasePath(reqPath, base);
    const match = rest === null ? null : matchPath(paths, rest);
    if (match) return match;
  }
  return null;
}

/** Pick the response to mock: lowest 2xx, else `default`, else the first declared. */
function pickResponse(operation: any): { status: number; response: any } {
  const responses = operation.responses ?? {};
  const codes = Object.keys(responses);
  const twoxx = codes.filter((c) => /^2\d\d$/.test(c)).sort();
  const key = twoxx[0] ?? (responses.default ? 'default' : codes[0]);
  const status = key && /^\d{3}$/.test(key) ? Number(key) : 200;
  return { status, response: key ? responses[key] : undefined };
}

/** The media type to mock: application/json when declared, else the first one. */
function pickContentType(content: Record<string, unknown>): string | null {
  return content['application/json'] ? 'application/json' : (Object.keys(content)[0] ?? null);
}

/** Pick the response body: example → first named example → schema-generated. */
function pickBody(response: any, root: any): { contentType: string | null; body: unknown } {
  const content = response?.content ?? {};
  const contentType = pickContentType(content);
  if (!contentType) return { contentType: null, body: null };
  const media = content[contentType];
  if (media.example !== undefined) return { contentType, body: media.example };
  if (media.examples && typeof media.examples === 'object') {
    const first = Object.values(media.examples)[0] as { value?: unknown } | undefined;
    if (first && 'value' in first) return { contentType, body: first.value };
  }
  if (media.schema) return { contentType, body: generateFromSchema(media.schema, root) };
  return { contentType, body: null };
}

export interface MockResult {
  status: number;
  contentType: string | null;
  body: unknown;
  headers?: Record<string, string>;
  /** console output of a scripted run — only ever surfaced to an authorized debugger. */
  logs?: string[];
}

export interface MockRequestInit {
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * The mock gateway's single entry point. An operation is served by its scripted function when it
 * is switched to scripted *and* the code file exists — otherwise it falls through to the built-in
 * generator, so switching back to auto (or deleting the file) restores generated responses rather
 * than breaking the endpoint.
 */
export async function mockRequest(
  projectId: string,
  method: string,
  reqPath: string,
  init: MockRequestInit = {},
): Promise<MockResult> {
  const project = getProject(projectId); // throws 404
  const out = await bundleProjectView(project.id); // bundled (refs kept), generator resolves them
  const spec = out.parsed as any;
  const match = matchWithBasePaths(spec, reqPath);
  if (!match) throw new NotFoundError(`no mock path matches ${reqPath}`);
  const operation = match.pathItem[method.toLowerCase()];
  if (!operation) throw new AppError(405, 'method_not_allowed', `${method} is not defined for ${reqPath}`);

  const scripted = await tryScripted(project.id, operation, method, match.params, reqPath, init);
  if (scripted) return scripted;

  const { status, response } = pickResponse(operation);
  const { contentType, body } = pickBody(response, spec);
  return { status, contentType, body };
}

export interface ResponseSchema {
  status: number;
  contentType: string | null;
  /** `$ref`s inlined, so the shape reads on its own. Null when the response declares no schema. */
  schema: unknown;
}

/** The schema auto mode generates from — what explains its output, as opposed to the output. */
export async function responseSchema(projectId: string, method: string, template: string): Promise<ResponseSchema> {
  const project = getProject(projectId); // throws 404
  const spec = (await bundleProjectView(project.id)).parsed as any;
  const operation = (spec.paths ?? {})[template]?.[method.toLowerCase()];
  if (!operation) throw new NotFoundError(`no operation ${method.toUpperCase()} ${template}`);
  const { status, response } = pickResponse(operation);
  const content = response?.content ?? {};
  const contentType = pickContentType(content);
  const schema = contentType ? content[contentType]?.schema : undefined;
  return { status, contentType, schema: schema ? inlineRefs(schema, spec) : null };
}

/**
 * Returns null whenever scripting doesn't apply, which is the fall-through signal: switching an
 * operation back to auto, or never writing code for it, restores generated responses rather than
 * breaking the endpoint.
 *
 * The code is found by the operation's id, so it is unaffected by whatever the path is today.
 */
async function tryScripted(
  projectId: string,
  operation: any,
  method: string,
  params: Record<string, string>,
  reqPath: string,
  init: MockRequestInit,
): Promise<MockResult | null> {
  const opId = operation[OP_ID_KEY];
  if (typeof opId !== 'string' || !opId) return null;
  if (cfg.getMode(projectId, opId) !== 'scripted') return null;

  const { content: code } = readCode(projectId, opId);
  if (!code) return null;

  const result = await runScriptedMock({
    code,
    req: {
      method: method.toUpperCase(),
      path: reqPath,
      params,
      query: init.query ?? {},
      headers: init.headers ?? {},
      body: init.body,
    },
  });

  // Simulated latency happens out here, not inside the sandbox: it must not eat the run budget,
  // and the guest has no timers to sleep with anyway.
  if (result.delayMs > 0) await new Promise((r) => setTimeout(r, result.delayMs));

  const headers = result.headers;
  const explicit = Object.keys(headers).find((h) => h.toLowerCase() === 'content-type');
  const contentType = explicit ? headers[explicit]! : result.body === undefined ? null : 'application/json';
  return { status: result.status, contentType, body: result.body ?? null, headers, logs: result.logs };
}
