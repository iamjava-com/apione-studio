import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import YAML from 'yaml';
import type { BreakingChange } from '../api';
import { useParsedDoc } from '../hooks/useParsedDoc';
import { cn } from '../lib/utils';
import { DiffPane } from './DiffPane';
import { groupChanges, type ChangeGroup } from './history/changes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The part of `doc` a group is about — one operation, or a whole top-level section — as YAML. */
function subtree(doc: any, g: ChangeGroup): string {
  const node = g.method && g.path ? doc?.paths?.[g.path]?.[g.method.toLowerCase()] : doc?.[g.section ?? ''];
  return node === undefined ? '' : YAML.stringify(node);
}

const LEVEL_COLOR = {
  error: 'var(--color-delete)',
  warning: 'var(--color-put)',
  info: 'var(--color-border)',
} as const;

function GroupRow({
  group,
  open,
  onToggle,
  base,
  target,
}: {
  group: ChangeGroup;
  open: boolean;
  onToggle: () => void;
  base: any;
  target: any;
}) {
  const { t } = useTranslation();
  const kindLabel = { added: t('changeAdded'), removed: t('changeRemoved'), modified: t('changeModified'), other: '' }[
    group.kind
  ];
  return (
    <div className="border-b border-border">
      <button
        aria-label={`change-${group.key}`}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-raised"
      >
        <span
          className={cn(
            'w-14 shrink-0 rounded px-1 text-center text-[10px] uppercase',
            group.kind === 'added' && 'bg-post/15 text-post',
            group.kind === 'removed' && 'bg-delete/15 text-delete',
            group.kind === 'modified' && 'bg-put/15 text-put',
            group.kind === 'other' && 'bg-border text-muted',
          )}
        >
          {kindLabel || group.section}
        </span>
        {group.method ? (
          <span className="min-w-0 flex-1 truncate font-mono">
            <span className="text-muted">{group.method}</span> <span className="text-text">{group.path}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted">{t('changesElsewhere')}</span>
        )}
        <span className="shrink-0 tabular-nums text-faint">{group.changes.length}</span>
      </button>
      {open && (
        <>
          <ul className="space-y-1 px-3 pb-2">
            {group.changes.map((c, i) => (
              <li
                key={i}
                className="rounded border-l-2 py-0.5 pl-2 text-[12px]"
                style={{ borderColor: LEVEL_COLOR[c.level] }}
              >
                <div className="text-text">{c.text}</div>
                <div className="font-mono text-[11px] text-faint">{c.id}</div>
              </li>
            ))}
          </ul>
          {/* Only this endpoint's YAML: a few dozen lines however large the file is. */}
          {base && target && (
            <div className="flex max-h-80 flex-col border-t border-border">
              <DiffPane base={subtree(base, group)} target={subtree(target, group)} expandAll={!!group.method} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The changelog between two versions, one row per endpoint; a row opens to its oasdiff entries and
 * a line diff of that endpoint alone. `baseText`/`targetText` are the two versions, parsed here in
 * a worker once per pair.
 */
export function HistoryChanges({
  changes,
  baseText,
  targetText,
}: {
  changes: BreakingChange[];
  baseText: string | null;
  targetText: string | null;
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupChanges(changes), [changes]);
  const base = useParsedDoc<any>(baseText ?? '');
  const target = useParsedDoc<any>(targetText ?? '');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  if (groups.length === 0) return <p className="px-3 py-2 text-[12px] text-faint">{t('changesNone')}</p>;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {groups.map((g) => (
        <GroupRow
          key={g.key}
          group={g}
          open={open.has(g.key)}
          onToggle={() => toggle(g.key)}
          base={baseText ? base : null}
          target={targetText ? target : null}
        />
      ))}
    </div>
  );
}
