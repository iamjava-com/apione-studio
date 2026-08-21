import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** HTTP method → its semantic token color (the domain vernacular). */
export const METHOD_COLOR: Record<string, string> = {
  GET: 'var(--color-get)',
  POST: 'var(--color-post)',
  PUT: 'var(--color-put)',
  PATCH: 'var(--color-patch)',
  DELETE: 'var(--color-delete)',
};

export function methodColor(method: string): string {
  return METHOD_COLOR[method.toUpperCase()] ?? 'var(--color-muted)';
}

/** Keep the entries whose key is still live. Same object back when nothing was dropped, so
 *  reconciling against an unchanged set doesn't churn React state. */
export function keepOnly<T>(map: Record<string, T>, live: Set<string>): Record<string, T> {
  const kept = Object.entries(map).filter(([k]) => live.has(k));
  return kept.length === Object.keys(map).length ? map : Object.fromEntries(kept);
}

/** A new Set with `value` toggled in or out — Sets live in React state here, so never mutated. */
export function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Stable DOM id for a form section, so the navigator can scroll to an operation
 * or schema card. Both the nav item and the card must build the id the same way.
 */
export function anchorId(kind: 'op' | 'schema', ...parts: string[]): string {
  return `sec-${kind}-${parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;
}
