/**
 * Adapter: Postman Collection v2.1 → OpenAPI 3.1. Import works hub-and-spoke —
 * every source format is converted to OpenAPI once, then the rest of the app only
 * ever sees OpenAPI. This is a focused converter for the common case (requests →
 * paths/operations, query/path params, JSON bodies, example responses); it is not
 * a full Postman feature port (scripts, auth flows, and env vars are out of scope).
 *
 * Operates on dynamic JSON, so nodes are intentionally `any`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { HTTP_METHODS } from '../services/operations.js';

const METHOD_SET = new Set<string>(HTTP_METHODS);

/** Recognize a Postman collection (v2.x). */
export function isPostman(doc: any): boolean {
  const schema: unknown = doc?.info?.schema;
  return (
    (typeof schema === 'string' && schema.includes('schema.getpostman.com')) || (doc?.info && Array.isArray(doc?.item)) // fallback: shape looks like a collection
  );
}

/** Normalize a path segment: Postman `:id` / `{{id}}` → OpenAPI `{id}`. */
function normalizeSegment(seg: string): string {
  if (seg.startsWith(':')) return `{${seg.slice(1)}}`;
  const m = /^\{\{(.+)\}\}$/.exec(seg);
  if (m) return `{${m[1]}}`;
  return seg;
}

/** Extract the path (array or raw string) from a Postman url node → "/a/{id}". */
function extractPath(url: any): string {
  let segs: string[] = [];
  if (typeof url === 'string') {
    const raw = url.split('?')[0]!.replace(/^[a-z]+:\/\/[^/]+/i, '');
    segs = raw.split('/').filter(Boolean);
  } else if (url && Array.isArray(url.path)) {
    segs = url.path.map((p: any) => (typeof p === 'string' ? p : String(p?.value ?? ''))).filter(Boolean);
  }
  const path = '/' + segs.map(normalizeSegment).join('/');
  return path === '/' ? '/' : path.replace(/\/+$/, '') || '/';
}

function pathParams(path: string): any[] {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return names.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
}

function queryParams(url: any): any[] {
  const q = url && typeof url === 'object' && Array.isArray(url.query) ? url.query : [];
  return q
    .filter((p: any) => p?.key && !p?.disabled)
    .map((p: any) => ({
      name: String(p.key),
      in: 'query',
      required: false,
      schema: { type: 'string' },
      ...(p.value ? { example: p.value } : {}),
    }));
}

function jsonOrNull(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function requestBody(body: any): any {
  if (!body || typeof body !== 'object') return undefined;
  if (body.mode === 'raw' && typeof body.raw === 'string' && body.raw.trim()) {
    const parsed = jsonOrNull(body.raw);
    if (parsed !== null) {
      return { content: { 'application/json': { schema: { type: 'object' }, example: parsed } } };
    }
    return { content: { 'text/plain': { schema: { type: 'string' }, example: body.raw } } };
  }
  if (body.mode === 'urlencoded' && Array.isArray(body.urlencoded)) {
    const props: Record<string, any> = {};
    for (const kv of body.urlencoded) if (kv?.key) props[kv.key] = { type: 'string' };
    return { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: props } } } };
  }
  return undefined;
}

function responses(item: any): any {
  const examples = Array.isArray(item?.response) ? item.response : [];
  if (examples.length === 0) return { '200': { description: 'OK' } };
  const out: Record<string, any> = {};
  for (const r of examples) {
    const code = String(r?.code ?? 200);
    const desc = r?.name || r?.status || 'response';
    const bodyRaw = typeof r?.body === 'string' ? r.body : '';
    const parsed = bodyRaw ? jsonOrNull(bodyRaw) : null;
    out[code] =
      parsed !== null
        ? { description: desc, content: { 'application/json': { example: parsed } } }
        : { description: desc };
  }
  return out;
}

/** Flatten nested folders into a flat list of request items. */
function collectRequests(items: any[], acc: any[] = []): any[] {
  for (const it of items ?? []) {
    if (Array.isArray(it?.item)) collectRequests(it.item, acc);
    else if (it?.request) acc.push(it);
  }
  return acc;
}

export function postmanToOpenapi(collection: any): any {
  const paths: Record<string, any> = {};
  for (const item of collectRequests(collection?.item ?? [])) {
    const req = item.request;
    const method = String(req?.method ?? 'GET').toLowerCase();
    if (!METHOD_SET.has(method)) continue;
    const url = typeof req === 'object' ? req.url : undefined;
    const path = extractPath(url);

    const op: any = {
      summary: item.name || undefined,
      parameters: [...pathParams(path), ...queryParams(url)],
      responses: responses(item),
    };
    if (op.parameters.length === 0) delete op.parameters;
    const rb = requestBody(req?.body);
    if (rb) op.requestBody = rb;

    paths[path] ??= {};
    paths[path][method] = op;
  }

  return {
    openapi: '3.1.0',
    info: { title: collection?.info?.name || 'Imported from Postman', version: '1.0.0' },
    paths,
  };
}
