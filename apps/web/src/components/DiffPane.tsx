import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../lib/utils';
import { useLineDiff } from '../hooks/useLineDiff';

type Row = { kind: 'add' | 'del' | 'ctx'; n: number; text: string } | { kind: 'gap' };

/** Hunks flattened to one indexable list for the virtualizer; `gap` is the "···" between hunks. */
function toRows(hunks: { oldStart: number; newStart: number; lines: string[] }[]): Row[] {
  const rows: Row[] = [];
  for (const [hi, h] of hunks.entries()) {
    if (hi > 0) rows.push({ kind: 'gap' });
    let oldLn = h.oldStart;
    let newLn = h.newStart;
    for (const line of h.lines) {
      if (line[0] === '\\') continue; // "No newline at end of file" marker
      const text = line.slice(1);
      if (line[0] === '+') rows.push({ kind: 'add', n: newLn++, text });
      else if (line[0] === '-') rows.push({ kind: 'del', n: oldLn++, text });
      else {
        rows.push({ kind: 'ctx', n: newLn++, text });
        oldLn++;
      }
    }
  }
  return rows;
}

/** One rendered diff line: a line-number gutter + the +/- body, colored by kind. */
function DiffLine({ n, kind, text }: { n: number; kind: 'add' | 'del' | 'ctx'; text: string }) {
  return (
    <div
      className={cn(
        'flex',
        kind === 'add' && 'bg-post/12 text-post',
        kind === 'del' && 'bg-delete/12 text-delete',
        kind === 'ctx' && 'text-faint',
      )}
    >
      <span className="w-9 shrink-0 select-none pr-2 text-right text-faint tabular-nums">{n}</span>
      <span className="w-3 shrink-0 select-none text-faint">{kind === 'add' ? '+' : kind === 'del' ? '-' : ''}</span>
      <span className="whitespace-pre-wrap break-all">{text}</span>
    </div>
  );
}

/**
 * Text diff between two revisions, virtualized: a whole-file diff of a large spec is tens of
 * thousands of lines. `expandAll` shows the whole file instead of hunks + 3 lines of context.
 */
export function DiffPane({ base, target, expandAll }: { base: string; target: string; expandAll: boolean }) {
  const { t } = useTranslation();
  const diff = useLineDiff(base, target, expandAll ? 1e9 : 3);
  const hunks = diff.status === 'done' ? diff.hunks : null;
  const rows = useMemo(() => (hunks ? toRows(hunks) : []), [hunks]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // useVirtualizer returns unmemoizable functions, so React Compiler skips this component —
  // which is why it is its own module, not part of History.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 17, // one unwrapped mono line; wrapped ones are re-measured on mount
    overscan: 24,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [base, target, expandAll]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[12px] leading-snug">
      {diff.status === 'pending' ? (
        <p className="px-1 text-faint">{t('diffComputing')}</p>
      ) : diff.status === 'gaveUp' ? (
        <p className="px-1 text-faint">{t('diffTooDifferent')}</p>
      ) : rows.length === 0 ? (
        <p className="px-1 text-faint">{t('diffNone')}</p>
      ) : (
        <div className="relative w-full" style={{ height: virt.getTotalSize() }}>
          {virt.getVirtualItems().map((v) => {
            const row = rows[v.index];
            return (
              <div
                key={v.key}
                ref={virt.measureElement}
                data-index={v.index}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${v.start}px)` }}
              >
                {row.kind === 'gap' ? (
                  <div className="py-1 text-center text-faint">···</div>
                ) : (
                  <DiffLine n={row.n} kind={row.kind} text={row.text} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
