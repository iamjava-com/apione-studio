import { current, isDraft } from 'immer';

/** Detached deep copy of a doc node. `structuredClone` throws on an immer draft, and `current`
 * alone still shares (frozen) subtrees with the base. */
export function cloneNode<T>(node: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return structuredClone(isDraft(node) ? (current(node as any) as T) : node);
}
