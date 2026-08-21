/** JSON Pointer prefix for component schemas — the single source for building/parsing schema $refs. */
export const SCHEMAS_REF = '#/components/schemas/';

/**
 * Rewrite every local schema $ref when a component schema is renamed — the
 * "rename propagation" that makes refs behave like Obsidian wikilinks. Mutates
 * the draft in place; matches `#/components/schemas/<old>` exactly or as a path
 * prefix (e.g. `.../<old>/properties/x`), never a same-prefixed sibling.
 */
export function rewriteSchemaRefs(node: unknown, oldName: string, newName: string): void {
  const base = `${SCHEMAS_REF}${oldName}`;
  const next = `${SCHEMAS_REF}${newName}`;
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (!n || typeof n !== 'object') return;
    const obj = n as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$ref' && typeof v === 'string' && (v === base || v.startsWith(`${base}/`))) {
        obj[k] = next + v.slice(base.length);
      } else {
        walk(v);
      }
    }
  };
  walk(node);
}
