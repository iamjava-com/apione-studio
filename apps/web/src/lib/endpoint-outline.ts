/**
 * How endpoints are filtered and grouped in a navigator. Shared so the design outline and the
 * Mock canvas behave identically — finding an endpoint shouldn't work differently per tab.
 */

/** The bits of an endpoint a navigator needs; each view keeps its own richer shape. */
export interface EndpointLike {
  method: string;
  path: string;
  summary?: string;
  tag?: string;
}

/** Free-text match over path, summary, method and tag — the fields a user would type. */
export function matchesEndpointFilter(op: EndpointLike, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return (
    op.path.toLowerCase().includes(q) ||
    (op.summary ?? '').toLowerCase().includes(q) ||
    op.method.toLowerCase().includes(q) ||
    (op.tag ?? '').toLowerCase().includes(q)
  );
}

/**
 * Group by first tag. Order follows top-level `tags:` then first appearance (mirroring how
 * Scalar/Redoc order the docs), with untagged last.
 *
 * `keepEmptyDeclared` materializes declared-but-unused tags: the design outline needs them as
 * drop targets, while a read-only list would just show empty groups.
 */
export function groupByTag<T extends { tag?: string }>(
  items: T[],
  tagOrder: string[],
  keepEmptyDeclared = false,
): { tag: string; ops: T[] }[] {
  const byTag = new Map<string, T[]>();
  for (const item of items) {
    const tag = item.tag ?? '';
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(item);
  }
  if (keepEmptyDeclared) for (const tag of tagOrder) if (tag && !byTag.has(tag)) byTag.set(tag, []);

  const ordered: string[] = [];
  for (const tag of tagOrder) if (byTag.has(tag) && !ordered.includes(tag)) ordered.push(tag);
  for (const tag of byTag.keys()) if (tag !== '' && !ordered.includes(tag)) ordered.push(tag);
  if (byTag.has('')) ordered.push(''); // untagged sinks to the bottom
  return ordered.map((tag) => ({ tag, ops: byTag.get(tag)! }));
}
