import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { Plus, FileText, Search, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { FileMeta, GraphResult } from '../api';
import { cn, toggleInSet } from '../lib/utils';
import { insertAfterKey } from './form/reorder';
import { OP_ID_KEY } from './form/constants';
import { useOpsDnd, type Op } from '../hooks/useOpsDnd';
import { useConfirm } from './ConfirmProvider';
import type { Selection } from '../lib/router';
import { MethodBadge } from './ui/method-badge';
import { Input } from './ui/input';
import { matchesEndpointFilter } from '../lib/endpoint-outline';
import { NavGroup, NavItem } from './outline/nav';
import { OpGroup, OpRows, type RowHandlers } from './outline/OperationRows';
import { SchemaSection } from './outline/SchemaSection';
import { cloneNode } from '../lib/clone';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Path Item Object field order, from the specification. OpenAPI gives a path's methods no
// meaningful order, so the outline imposes one rather than following whatever the file lists.
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/**
 * The left workspace outline: a filter box over the operations (tag-grouped, with
 * cross-group drag-to-retag) and schemas. Adding an op/schema creates a placeholder and
 * opens it in the detail (no dialog). Reads the live doc and writes back through
 * `updateDoc`; selection is owned by the parent (URL).
 */
export function OutlinePanel({
  doc,
  selection,
  onSelect,
  updateDoc,
  graph,
  files,
  activePath,
  onSelectFile,
  onDeleteFile,
}: {
  doc: Doc | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
  updateDoc: (mutate: (d: Doc) => void) => void;
  graph: GraphResult | null;
  files: FileMeta[];
  activePath: string;
  onSelectFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── live outline (from the edited doc, so reorders show immediately) ──
  const liveOps: Op[] = useMemo(
    () =>
      doc
        ? Object.entries<Doc>(doc.paths ?? {}).flatMap(([p, item]) =>
            METHODS.filter((m) => item?.[m]).map((m) => ({
              p,
              m,
              tag: (item[m]?.tags?.[0] as string) ?? '',
              summary: (item[m]?.summary as string) ?? '',
              deprecated: !!item[m]?.deprecated,
              opId: item[m]?.[OP_ID_KEY] as string | undefined,
            })),
          )
        : [],
    [doc],
  );
  const liveSchemas = doc ? Object.keys(doc.components?.schemas ?? {}) : [];

  // Filter/search across the outline — ops match via the shared predicate (so the Mock
  // navigator filters identically); schemas match on name.
  const q = filter.trim().toLowerCase();
  const shownOps = q
    ? liveOps.filter((o) => matchesEndpointFilter({ method: o.m, path: o.p, summary: o.summary, tag: o.tag }, q))
    : liveOps;
  const shownSchemas = q ? liveSchemas.filter((n) => n.toLowerCase().includes(q)) : liveSchemas;

  const selKey =
    selection.kind === 'op'
      ? `open-op-${selection.method}-${selection.path}`
      : selection.kind === 'schema'
        ? `open-schema-${selection.name}`
        : '';

  // Selecting an op inside a collapsed tag group expands that group, so the row is actually
  // shown (and the reveal below can scroll to it).
  useEffect(() => {
    if (selection.kind !== 'op') return;
    const op = liveOps.find((o) => o.m === selection.method && o.p === selection.path);
    if (op && collapsedGroups.has(op.tag))
      setCollapsedGroups((s) => {
        const n = new Set(s);
        n.delete(op.tag);
        return n;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  // Keep the selection visible: when it changes (a freshly created op/schema, a jump from the
  // YAML view, or the group above just expanded), scroll its row into the outline viewport.
  // `nearest` is a no-op if it's already shown.
  useEffect(() => {
    if (!selKey) return;
    scrollRef.current?.querySelector(`[aria-label="${selKey.replace(/"/g, '\\"')}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [selKey, liveOps.length, liveSchemas.length, collapsedGroups]);

  // Group by tag to mirror the docs (Scalar). A single untagged group is just a flat list.
  const tagOrder: string[] = Array.isArray(doc?.tags)
    ? doc.tags.map((tg: Doc) => tg?.name).filter((n: unknown): n is string => typeof n === 'string')
    : [];

  // All ops drag/reorder/retag behaviour lives in the hook; the component just renders it.
  const dnd = useOpsDnd(liveOps, shownOps, tagOrder, updateDoc);
  const toggleGroup = (tag: string) => setCollapsedGroups((s) => toggleInSet(s, tag));
  const groupTags = dnd.renderGroups.map((g) => g.tag);
  const allCollapsed = groupTags.length > 0 && groupTags.every((tg) => collapsedGroups.has(tg));
  const toggleAllGroups = () => setCollapsedGroups(allCollapsed ? new Set() : new Set(groupTags));

  const duplicateOp = (p: string, m: string) => {
    let np = `${p}-copy`;
    // Insert the copy right after the original path (not at the end of the group). The unique-name
    // check runs inside the mutator: the shared `doc` trails the editor by the debounce, and a
    // name checked against it could collide with a path typed in the last 200ms.
    updateDoc((d) => {
      let i = 2;
      while (d.paths?.[np]) np = `${p}-copy-${i++}`;
      const copy = cloneNode(d.paths[p][m]);
      // A copy is a new operation. Carrying the original's id would point both at one set of
      // mocks and one stage until the next save broke the tie for them.
      delete copy[OP_ID_KEY];
      d.paths = insertAfterKey(d.paths, p, np, { [m]: copy });
    });
    onSelect({ kind: 'op', method: m, path: np });
  };
  const removeOp = async (p: string, m: string) => {
    const summary = liveOps.find((o) => o.p === p && o.m === m)?.summary;
    const msg = summary
      ? t('confirmDeleteOpNamed', { name: summary, m: m.toUpperCase(), p })
      : t('confirmDeleteOp', { m: m.toUpperCase(), p });
    if (!(await confirm({ message: msg, confirmLabel: t('delete'), danger: true }))) return;
    updateDoc((d) => {
      delete d.paths[p][m];
      if (Object.keys(d.paths[p]).length === 0) delete d.paths[p];
    });
    if (selection.kind === 'op' && selection.path === p && selection.method === m) onSelect({ kind: 'info' });
  };
  // Like adding a schema: create a placeholder GET operation and open it — method, path and
  // tag are all editable in the detail on the right (no dialog).
  const addEndpoint = () => {
    let path = '/new-endpoint';
    // Unique-name check inside the mutator, against the fresh doc — see duplicateOp.
    updateDoc((d) => {
      let i = 2;
      d.paths ??= {};
      while (d.paths[path]) path = `/new-endpoint-${i++}`;
      d.paths[path] = { get: { responses: { '200': { description: 'OK' } } } };
    });
    onSelect({ kind: 'op', method: 'get', path });
  };

  const rowHandlers: RowHandlers = {
    onSelectOp: (op) => onSelect({ kind: 'op', method: op.m, path: op.p }),
    onDuplicateOp: (op) => duplicateOp(op.p, op.m),
    onDeleteOp: (op) => void removeOp(op.p, op.m),
  };

  return (
    <div className="flex h-full flex-col">
      {/* Filter/search — the outline can get long, so this is essential */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            aria-label="outline-filter"
            className="h-7 w-full pl-7 text-[13px]"
            placeholder={t('filterOutline')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {/* Files list only matters for multi-file specs; a single openapi.yaml is noise. */}
        {files.length > 1 && (
          <NavGroup label={t('files')}>
            {files.map((f) => (
              <NavItem key={f.path} active={f.path === activePath}>
                <span
                  className="flex-1 cursor-pointer truncate font-mono text-[13px]"
                  onClick={() => onSelectFile(f.path)}
                >
                  {f.path}
                </span>
                <span className="font-mono text-[11px] text-faint">v{f.currentVersion}</span>
                <button
                  aria-label={t('delete')}
                  className="text-faint hover:text-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteFile(f.path);
                  }}
                >
                  ✕
                </button>
              </NavItem>
            ))}
          </NavGroup>
        )}

        {/* Info — always the top item, default selection */}
        <div className="px-1 py-1">
          <button
            onClick={() => onSelect({ kind: 'info' })}
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px] hover:bg-raised',
              selection.kind === 'info' ? 'bg-raised text-text' : 'text-muted',
            )}
          >
            <FileText size={13} className="text-faint" />
            {t('infoSection')}
          </button>
        </div>

        <NavGroup
          label={t('operations')}
          action={
            <div className="flex items-center gap-1">
              {dnd.grouped && (
                <button
                  aria-label={allCollapsed ? 'expand-all-groups' : 'collapse-all-groups'}
                  title={allCollapsed ? t('expandAll') : t('collapseAll')}
                  className="text-faint hover:text-text"
                  onClick={toggleAllGroups}
                >
                  {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
                </button>
              )}
              <button aria-label="add-endpoint" className="text-faint hover:text-text" onClick={addEndpoint}>
                <Plus size={14} />
              </button>
            </div>
          }
        >
          {shownOps.length === 0 && <p className="px-3 text-[13px] text-faint">{q ? t('cmdkEmpty') : '—'}</p>}
          {/* One DndContext spans every group (multi-container sortable), so dragging across a
              boundary re-tags. Groups force-open during a drag and while filtering, or a row
              lands behind a collapse. */}
          <DndContext sensors={dnd.sensors} collisionDetection={dnd.collisionDetection} {...dnd.dragHandlers}>
            {dnd.grouped ? (
              dnd.renderGroups
                .filter((g) => !q || g.ids.length > 0)
                .map((g) => (
                  <OpGroup
                    key={g.tag}
                    group={{ tag: g.tag, ops: g.ids.map((id) => dnd.opById.get(id)).filter((o): o is Op => !!o) }}
                    collapsed={!dnd.draggingId && !q && collapsedGroups.has(g.tag)}
                    onToggle={() => toggleGroup(g.tag)}
                    selection={selection}
                    untaggedLabel={t('untagged')}
                    on={rowHandlers}
                  />
                ))
            ) : (
              <OpRows ops={dnd.renderOps} selection={selection} on={rowHandlers} />
            )}
            {/* floating copy under the cursor; it names the path when the whole block travels */}
            <DragOverlay dropAnimation={null}>
              {dnd.draggingOp ? (
                <div className="flex items-center gap-1.5 rounded bg-raised px-2 py-1 shadow-lg ring-1 ring-brand">
                  {dnd.travellingPath ? (
                    <span className="truncate font-mono text-[13px] text-text">
                      {t('dragPathBlock', { p: dnd.travellingPath, n: dnd.travellingCount })}
                    </span>
                  ) : (
                    <>
                      <MethodBadge method={dnd.draggingOp.m} />
                      <span
                        className={cn(
                          'truncate text-[13px]',
                          dnd.draggingOp.summary ? 'text-text' : 'font-mono text-muted',
                        )}
                      >
                        {dnd.draggingOp.summary || dnd.draggingOp.p}
                      </span>
                    </>
                  )}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </NavGroup>

        <SchemaSection
          names={shownSchemas}
          doc={doc}
          graph={graph}
          selection={selection}
          onSelect={onSelect}
          updateDoc={updateDoc}
          emptyLabel={q ? t('cmdkEmpty') : '—'}
        />
      </div>
    </div>
  );
}
