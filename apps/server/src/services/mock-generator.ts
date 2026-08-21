/**
 * Built-in lightweight mock generator (tier 0 of the mock ladder).
 * Produces a deterministic, schema-shaped sample: honors example then enum (the same
 * value sources the form exposes), resolves local $refs (cycle-safe), picks a branch
 * for oneOf/anyOf and merges allOf,
 * and fills scalar leaves with a canonical value per type/format. Anything realistic or
 * stateful is the job of the tier-3 code mock — so there is no randomness and no faker
 * dependency here.
 *
 * Operates on dynamic OpenAPI JSON, so schema nodes are intentionally `any`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

function resolveRef(root: any, ref: string): any {
  if (!ref.startsWith('#/')) return null;
  const segs = ref
    .slice(2)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = root;
  for (const s of segs) {
    if (cur == null) return null;
    cur = cur[s];
  }
  return cur;
}

/**
 * Inline `$ref`s so a schema can be read on its own. For display only — a bundled spec keeps its
 * refs, and `$ref: '#/components/schemas/User'` tells a reader nothing about the shape.
 *
 * A ref already being expanded is left as-is rather than followed: self-referential schemas
 * (a tree node, a comment with replies) are legitimate and would otherwise never terminate.
 */
export function inlineRefs(schema: any, root: any, seen: Set<string> = new Set()): any {
  if (schema == null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map((v) => inlineRefs(v, root, seen));

  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return { $ref: schema.$ref }; // cycle — keep the pointer
    const target = resolveRef(root, schema.$ref);
    if (target == null) return schema; // external or dangling: show it as written
    return inlineRefs(target, root, new Set([...seen, schema.$ref]));
  }

  const out: any = {};
  for (const [k, v] of Object.entries(schema)) out[k] = inlineRefs(v, root, seen);
  return out;
}

/** A canonical, spec-valid representative value for a string `format` (no randomness). */
function fakeString(format?: string): string {
  switch (format) {
    case 'date':
      return '2024-01-01';
    case 'date-time':
      return '2024-01-01T00:00:00Z';
    case 'time':
      return '00:00:00';
    case 'email':
      return 'user@example.com';
    case 'uuid':
      return '00000000-0000-0000-0000-000000000000';
    case 'uri':
    case 'url':
      return 'https://example.com';
    case 'hostname':
      return 'example.com';
    case 'ipv4':
      return '127.0.0.1';
    case 'ipv6':
      return '::1';
    case 'byte':
      return 'ZXhhbXBsZQ=='; // base64("example")
    case 'password':
      return 'password';
    default:
      return 'string';
  }
}

/** Public entry: a spec always mocks to the same data (values are canonical, not random). */
export function generateFromSchema(schema: any, root: any): unknown {
  return gen(schema, root, new Set());
}

function gen(schema: any, root: any, seenRefs: Set<string>): unknown {
  if (!schema || typeof schema !== 'object') return null;

  if (typeof schema.$ref === 'string') {
    if (seenRefs.has(schema.$ref)) return null; // break cycles
    const next = resolveRef(root, schema.$ref);
    return gen(next, root, new Set(seenRefs).add(schema.$ref));
  }

  // explicit author-provided values win (kept in lock-step with what the form exposes:
  // `example` then `enum` — NOT `default`/`examples`, which the form can't set and would
  // then mock from an invisible source).
  if ('example' in schema) return schema.example;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  // composition: pick the first branch, or merge allOf
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return gen(schema.oneOf[0], root, seenRefs);
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) return gen(schema.anyOf[0], root, seenRefs);
  if (Array.isArray(schema.allOf)) {
    const merged: Record<string, unknown> = {};
    for (const sub of schema.allOf) {
      const v = gen(sub, root, seenRefs);
      if (v && typeof v === 'object') Object.assign(merged, v);
    }
    return merged;
  }

  let type = schema.type;
  if (Array.isArray(type)) type = type.find((t: string) => t !== 'null') ?? type[0];

  switch (type) {
    case 'object':
      return generateObject(schema, root, seenRefs);
    case 'array':
      return schema.items ? [gen(schema.items, root, seenRefs)] : [];
    case 'string':
      return fakeString(schema.format);
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      // no explicit type but has properties → treat as object
      return schema.properties ? generateObject(schema, root, seenRefs) : null;
  }
}

function generateObject(schema: any, root: any, seenRefs: Set<string>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const props = schema.properties ?? {};
  for (const key of Object.keys(props)) {
    obj[key] = gen(props[key], root, seenRefs);
  }
  return obj;
}
