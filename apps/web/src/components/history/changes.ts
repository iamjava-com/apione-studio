import type { BreakingChange } from '../../api';

export type GroupKind = 'added' | 'removed' | 'modified' | 'other';

/** One endpoint's (or, for changes outside `paths`, one section's) changes between two versions. */
export interface ChangeGroup {
  key: string;
  method: string | null;
  path: string | null;
  section: string | null;
  kind: GroupKind;
  level: BreakingChange['level'];
  changes: BreakingChange[];
}

const LEVEL_RANK = { info: 0, warning: 1, error: 2 } as const;

/** oasdiff ids that mean the whole endpoint came or went, not something inside it. */
function kindOf(c: BreakingChange): GroupKind | null {
  if (c.id === 'endpoint-added') return 'added';
  if (/^(endpoint|api|api-path)-removed/.test(c.id)) return 'removed';
  return null;
}

/** Group a changelog by endpoint, in order of first appearance; changes with no endpoint (components,
 * info, servers…) group by section. */
export function groupChanges(changes: BreakingChange[]): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const c of changes) {
    const key = c.method && c.path ? `${c.method} ${c.path}` : `section:${c.section ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        method: c.method && c.path ? c.method : null,
        path: c.method && c.path ? c.path : null,
        section: c.section,
        kind: c.method && c.path ? 'modified' : 'other',
        level: c.level,
        changes: [],
      };
      groups.set(key, g);
    }
    g.changes.push(c);
    const k = kindOf(c);
    if (k) g.kind = k;
    if (LEVEL_RANK[c.level] > LEVEL_RANK[g.level]) g.level = c.level;
  }
  return [...groups.values()];
}
