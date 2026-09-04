import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import YAML from 'yaml';
import type { BreakingChange } from '../api';
import { useParsedDoc } from '../hooks/useParsedDoc';
import { cn } from '../lib/utils';
import { DiffPane } from './DiffPane';
import { groupChanges, type ChangeGroup } from './history/changes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The part of `doc` a group is about — one operation, or a whole top-level section. */
function nodeOf(doc: any, g: ChangeGroup): any {
  return g.method && g.path ? doc?.paths?.[g.path]?.[g.method.toLowerCase()] : doc?.[g.section ?? ''];
}
function subtree(doc: any, g: ChangeGroup): string {
  const node = nodeOf(doc, g);
  return node === undefined ? '' : YAML.stringify(node);
}

/** One line: does this change break a client? Clicking it floats oasdiff's own words. */
function BreakingSummary({ group }: { group: ChangeGroup }) {
  const { t } = useTranslation();
  const [openList, setOpenList] = useState(false);
  const breaking = group.changes.filter((c) => c.level !== 'info');
  const errors = breaking.filter((c) => c.level === 'error').length;
  if (breaking.length === 0) {
    return <p className="px-3 pb-1.5 text-[12px] text-post">✓ {t('breakingNone')}</p>;
  }
  return (
    <div className="relative px-3 pb-1.5 text-[12px]">
      <button className="text-put underline-offset-2 hover:underline" onClick={() => setOpenList((x) => !x)}>
        ⚠ {t('errors', { count: errors })} · {t('warnings', { count: breaking.length - errors })}
      </button>
      {openList && (
        <ul className="absolute left-3 right-3 z-10 mt-1 max-h-56 animate-drop-in space-y-1.5 overflow-auto rounded-md border border-border bg-surface p-2 shadow-lg">
          {breaking.map((c, i) => (
            <li
              key={i}
              className="rounded border-l-2 py-0.5 pl-2 text-text"
              style={{ borderColor: c.level === 'error' ? 'var(--color-delete)' : 'var(--color-put)' }}
            >
              {c.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
  // Like the outline: the summary names the endpoint, the path identifies it. A removed
  // endpoint only exists in the base version.
  const summary = (nodeOf(target, group) ?? nodeOf(base, group))?.summary as string | undefined;
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
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5">
              <span className="shrink-0 font-mono text-muted">{group.method}</span>
              <span className="truncate text-text">{summary ?? group.path}</span>
            </span>
            {summary && <span className="block truncate font-mono text-[11px] text-faint">{group.path}</span>}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted">{t('changesElsewhere')}</span>
        )}
      </button>
      {open && (
        <>
          <BreakingSummary group={group} />
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
