/**
 * Narrowing a bundled document to the operations a team has released.
 *
 * This is a projection, not the truth: the files keep every operation, and what comes out here is
 * one view of them. Nothing writes back through this.
 *
 * Cutting operations is the easy half. The hard half is leaving a document that still stands on
 * its own — no `$ref` pointing at a component that went with them, no tag heading with nothing
 * under it — and that gives away nothing about what was cut, which a dangling `#/components/
 * schemas/InternalDraft` would.
 */
import { HTTP_METHODS, OP_ID_KEY } from './operations.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Component sections addressed by `$ref`, and so reachable from the operations that survive.
 *  `securitySchemes` is deliberately not one: a scheme is named from a `security` requirement, not
 *  pointed at, so it has no inbound `$ref` and tree-shaking would drop every one of them. */
const REF_SECTIONS = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'links',
  'callbacks',
  'pathItems',
] as const;

const REF_PATTERN = /^#\/components\/([^/]+)\/(.+)$/;

/** Collect every internal component `$ref` in a subtree, as `section/name` keys. */
function collectComponentRefs(node: any, acc: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectComponentRefs(n, acc);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') {
      const m = REF_PATTERN.exec(v);
      // JSON Pointer escapes: a component name containing / or ~ is written ~1 / ~0.
      if (m) acc.add(`${m[1]}/${m[2]!.replace(/~1/g, '/').replace(/~0/g, '~')}`);
    } else collectComponentRefs(v, acc);
  }
}

/**
 * Drop every component nothing reaches, following refs between components to a fixed point — a
 * schema kept only because another kept schema points at it has to survive too.
 */
function shakeComponents(doc: any): void {
  const components = doc.components;
  if (!components || typeof components !== 'object') return;

  const roots: Record<string, unknown> = { ...doc };
  delete roots.components;

  const reached = new Set<string>();
  const queue: string[] = [];
  const seed = new Set<string>();
  collectComponentRefs(roots, seed);
  for (const key of seed) queue.push(key);

  while (queue.length) {
    const key = queue.pop()!;
    if (reached.has(key)) continue;
    reached.add(key);
    const slash = key.indexOf('/');
    const section = key.slice(0, slash);
    const name = key.slice(slash + 1);
    const found = components[section]?.[name];
    if (found === undefined) continue;
    const refs = new Set<string>();
    collectComponentRefs(found, refs);
    for (const next of refs) if (!reached.has(next)) queue.push(next);
  }

  for (const section of REF_SECTIONS) {
    const bag = components[section];
    if (!bag || typeof bag !== 'object') continue;
    for (const name of Object.keys(bag)) {
      if (!reached.has(`${section}/${name}`)) delete bag[name];
    }
    if (!Object.keys(bag).length) delete components[section];
  }
  if (!Object.keys(components).length) delete doc.components;
}

/** Drop tag declarations no surviving operation uses, keeping the author's order for the rest. */
function shakeTags(doc: any): void {
  if (!Array.isArray(doc.tags)) return;
  const used = new Set<string>();
  for (const item of Object.values<any>(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      for (const tag of item?.[method]?.tags ?? []) if (typeof tag === 'string') used.add(tag);
    }
  }
  doc.tags = doc.tags.filter((t: any) => typeof t?.name !== 'string' || used.has(t.name));
  if (!doc.tags.length) delete doc.tags;
}

export interface ReleasedFilter {
  doc: unknown;
  /** How many operations were left out — the caller has to be able to say so. */
  omitted: number;
}

/**
 * Keep only the operations whose id is in `released`. Mutates `doc`; callers pass a freshly
 * bundled object that is theirs to consume.
 *
 * An operation with no `x-apione-id` is cut too. It has never been saved through the App, so
 * nobody has said it is released — and an export that leaked the unstaged ones would be the wrong
 * way round.
 *
 * `deprecated` earns an operation nothing: a retired endpoint that never shipped is not something
 * to publish, and one that did ship is `released` and stays, carrying its flag.
 *
 * `webhooks` is untouched. Operation ids are only ever minted under `paths`, so there is nothing
 * there to filter on.
 */
export function keepReleased(doc: any, released: Set<string>): ReleasedFilter {
  const paths = doc?.paths;
  if (!paths || typeof paths !== 'object') return { doc, omitted: 0 };

  let omitted = 0;
  for (const [path, item] of Object.entries<any>(paths)) {
    if (!item || typeof item !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      const opId = op[OP_ID_KEY];
      if (typeof opId === 'string' && released.has(opId)) continue;
      delete item[method];
      omitted += 1;
    }
    // Shared `parameters`/`servers` on the path item are not an endpoint; a path that answers
    // nothing goes entirely rather than staying behind as an empty heading.
    if (!HTTP_METHODS.some((m) => item[m])) delete paths[path];
  }

  shakeComponents(doc);
  shakeTags(doc);
  return { doc, omitted };
}
