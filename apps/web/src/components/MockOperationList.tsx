import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-react';
import type { MockCatalog, MockOperation } from '../api';
import { cn, toggleInSet } from '../lib/utils';
import { Input } from './ui/input';
import { MethodBadge } from './ui/method-badge';
import { groupByTag, matchesEndpointFilter } from '../lib/endpoint-outline';
import { SkeletonRows } from './ui/skeleton';
import type { MockCatalogError } from '../hooks/useProjectData';

/**
 * The Mock canvas's endpoint picker. Deliberately mirrors the design outline — same filter, same
 * tag grouping, same "summary as the friendly name" — because switching tabs shouldn't mean
 * relearning how to find an endpoint. What's mock-specific is the trailing state: the mode, and
 * whether there's an unsaved draft.
 */
export function MockOperationList({
  catalog,
  error,
  activeKey,
  dirtyKeys,
  onPick,
}: {
  catalog: MockCatalog | null;
  /** Why there is no catalog: a spec never saved, or a read that failed. Said, not waited for. */
  error: MockCatalogError | null;
  activeKey: string | null;
  dirtyKeys: Set<string>;
  onPick: (o: MockOperation) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const ops = (catalog?.operations ?? []).filter((o) =>
      matchesEndpointFilter({ method: o.method, path: o.path, summary: o.summary, tag: o.tag }, filter),
    );
    return groupByTag(ops, catalog?.tagOrder ?? []);
  }, [catalog, filter]);

  if (error === 'missing') return <p className="p-3 text-[13px] text-muted">{t('mockNoSpec')}</p>;
  if (error === 'failed') return <p className="p-3 text-[13px] text-delete">{t('mockCatalogFailed')}</p>;
  if (!catalog) return <SkeletonRows rows={4} height="h-7" className="p-3" />;

  const toggle = (tag: string) => setCollapsed((prev) => toggleInSet(prev, tag));

  const tags = groups.map((g) => g.tag);
  const allCollapsed = tags.length > 0 && tags.every((tg) => collapsed.has(tg));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(tags));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 p-2">
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            aria-label="mock-filter"
            className="h-7 pl-7 text-[13px]"
            placeholder={t('filterOutline')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {tags.length > 1 && (
          <button
            aria-label="toggle-all-groups"
            title={allCollapsed ? t('expandAll') : t('collapseAll')}
            className="shrink-0 rounded p-1 text-faint hover:bg-raised hover:text-text"
            onClick={toggleAll}
          >
            {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.tag);
          return (
            <div key={g.tag}>
              <button
                aria-label={`group-${g.tag || 'untagged'}`}
                onClick={() => toggle(g.tag)}
                className="flex w-full items-center gap-1 px-2 py-1 text-left text-[12px] text-muted hover:text-text"
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="truncate">{g.tag || t('untagged')}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-faint">{g.ops.length}</span>
              </button>
              {!isCollapsed &&
                g.ops.map((o) => {
                  const k = o.opId;
                  return (
                    <button
                      key={k}
                      onClick={() => onPick(o)}
                      title={o.path}
                      className={cn(
                        'flex w-full items-start gap-1.5 px-2 py-1 pl-4 text-left',
                        k === activeKey ? 'bg-raised' : 'hover:bg-raised/60',
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <MethodBadge method={o.method} />
                          {/* summary is the friendly name (like the docs); fall back to the path */}
                          <span
                            className={cn(
                              'truncate text-[13px]',
                              o.summary ? 'text-text' : 'font-mono text-muted',
                              k === activeKey && 'text-text',
                            )}
                          >
                            {o.summary || o.path}
                          </span>
                        </div>
                        {o.summary && <span className="truncate pl-1 font-mono text-[12px] text-faint">{o.path}</span>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 pt-0.5">
                        {dirtyKeys.has(k) && <span className="text-[11px] text-brand">●</span>}
                        {o.mode === 'scripted' && (
                          <span className="text-[11px] text-brand">{t('mockModeScripted')}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
