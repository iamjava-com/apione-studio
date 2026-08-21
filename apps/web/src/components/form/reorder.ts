/**
 * Order-preserving helpers for the OpenAPI maps we let users reorder/duplicate
 * (paths' methods, schema properties, components.schemas). Objects keep insertion
 * order in JS + our YAML serializer, so key order is the display order.
 */

/** Rebuild an object with `activeKey` moved to `overKey`'s position. */
export function moveKey<T>(obj: Record<string, T>, activeKey: string, overKey: string): Record<string, T> {
  const keys = Object.keys(obj);
  const from = keys.indexOf(activeKey);
  const to = keys.indexOf(overKey);
  if (from < 0 || to < 0) return obj;
  keys.splice(to, 0, keys.splice(from, 1)[0]!);
  return Object.fromEntries(keys.map((k) => [k, obj[k]!]));
}

/** Rebuild an object with `[newKey]=value` inserted right after `afterKey`. */
export function insertAfterKey<T>(
  obj: Record<string, T>,
  afterKey: string,
  newKey: string,
  value: T,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj)) {
    out[k] = obj[k]!;
    if (k === afterKey) out[newKey] = value;
  }
  if (!(newKey in out)) out[newKey] = value; // afterKey missing → append
  return out;
}

/** Rebuild an object with `oldKey` renamed to `newKey`, in place in the key order. */
export function renameKey<T>(obj: Record<string, T>, oldKey: string, newKey: string): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === oldKey ? newKey : k, v]));
}

/** First `base`, `baseCopy`, `baseCopy2`… not already taken. */
export function uniqueKey(taken: string[], base: string): string {
  let candidate = `${base}Copy`;
  let i = 2;
  while (taken.includes(candidate)) candidate = `${base}Copy${i++}`;
  return candidate;
}
