import { useTranslation } from 'react-i18next';
import { Copy, Plus, Trash2 } from 'lucide-react';
import type { GraphResult } from '../../api';
import { cn } from '../../lib/utils';
import { SortableList, Sortable, DragHandle } from '../form/Sortable';
import { moveKey, insertAfterKey, uniqueKey } from '../form/reorder';
import { useConfirm } from '../ConfirmProvider';
import type { Selection } from '../../lib/router';
import { MethodBadge } from '../ui/method-badge';
import { NavGroup, NavItem, RowActions } from './nav';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Referrer = { kind: 'op'; method: string; path: string; summary?: string } | { kind: 'schema'; name: string };

/** How many referrers the delete confirm lists before it says "and N more" — a schema everything
 *  points at would otherwise push the buttons off the dialog. */
const REFERRER_CAP = 20;

/** Who points at `name`: the operations and schemas whose `$ref` reaches it. */
function referrersOf(doc: Doc | null, graph: GraphResult | null, name: string): Referrer[] {
  const labelById = new Map(graph?.nodes.map((n) => [n.id, n.label] as const));
  return (graph?.edges ?? [])
    .filter((e) => e.to === `schema:${name}`)
    .map((e): Referrer => {
      if (e.from.startsWith('schema:')) return { kind: 'schema', name: e.from.slice(7) };
      const [method = '', path = ''] = (labelById.get(e.from) ?? '').split(' '); // node label is "METHOD /path"
      return { kind: 'op', method, path, summary: doc?.paths?.[path]?.[method.toLowerCase()]?.summary };
    });
}

/**
 * The outline's schemas: reorder by drag, duplicate, delete. Deleting one that is still referenced
 * leaves dangling `$ref`s, so the confirm names who would be left holding them.
 *
 * `names` is already filtered by the outline's search box; `doc` and `graph` are the unfiltered
 * document and its reference graph, which is what the delete warning has to reason about.
 */
export function SchemaSection({
  names,
  doc,
  graph,
  selection,
  onSelect,
  updateDoc,
  emptyLabel,
}: {
  names: string[];
  doc: Doc | null;
  graph: GraphResult | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
  updateDoc: (mutate: (d: Doc) => void) => void;
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const orphans = new Set(graph?.orphans ?? []);

  const add = () => {
    const existing = doc?.components?.schemas ?? {};
    let n = 'NewSchema';
    let i = 1;
    while (existing[n]) n = `NewSchema${i++}`;
    updateDoc((d) => {
      d.components ??= {};
      d.components.schemas ??= {};
      d.components.schemas[n] = { type: 'object', properties: {} };
    });
    onSelect({ kind: 'schema', name: n });
  };

  const duplicate = (name: string) => {
    const key = uniqueKey(Object.keys(doc?.components?.schemas ?? {}), name);
    updateDoc((d) => {
      d.components.schemas = insertAfterKey(
        d.components.schemas,
        name,
        key,
        structuredClone(d.components.schemas[name]),
      );
    });
    onSelect({ kind: 'schema', name: key });
  };

  const remove = async (name: string) => {
    const refs = referrersOf(doc, graph, name);
    const body =
      refs.length > 0 ? (
        <ul className="mt-2 max-h-44 space-y-1 overflow-auto rounded-md border border-border p-2">
          {refs.slice(0, REFERRER_CAP).map((r, i) => (
            <li key={i} className="flex min-w-0 items-center gap-1.5">
              {r.kind === 'op' ? (
                <>
                  <MethodBadge method={r.method} />
                  <span className={cn('truncate text-[13px]', r.summary ? 'text-text' : 'font-mono text-muted')}>
                    {r.summary || r.path}
                  </span>
                  {r.summary && <span className="truncate font-mono text-[12px] text-faint">{r.path}</span>}
                </>
              ) : (
                <span className="font-mono text-[13px] text-post">{r.name}</span>
              )}
            </li>
          ))}
          {refs.length > REFERRER_CAP && (
            <li className="pl-1 text-[12px] text-faint">… +{refs.length - REFERRER_CAP}</li>
          )}
        </ul>
      ) : undefined;
    const message =
      refs.length > 0 ? t('confirmDeleteSchemaUsed', { name, count: refs.length }) : t('confirmDeleteSchema', { name });
    if (!(await confirm({ message, body, confirmLabel: t('delete'), danger: true }))) return;
    updateDoc((d) => delete d.components.schemas[name]);
    if (selection.kind === 'schema' && selection.name === name) onSelect({ kind: 'info' });
  };

  const reorder = (activeId: string, overId: string) =>
    updateDoc((d) => {
      d.components.schemas = moveKey(d.components.schemas, activeId, overId);
    });

  return (
    <NavGroup
      label={t('schemas')}
      action={
        <button aria-label="add-schema" className="text-faint hover:text-text" onClick={add}>
          <Plus size={14} />
        </button>
      }
    >
      {names.length === 0 && <p className="px-3 text-[13px] text-faint">{emptyLabel}</p>}
      <SortableList ids={names} onReorder={reorder}>
        {names.map((name) => (
          <Sortable key={name} id={name}>
            {({ setNodeRef, style, handleProps }) => (
              <NavItem
                active={selection.kind === 'schema' && selection.name === name}
                dragRef={setNodeRef}
                dragStyle={style}
              >
                <DragHandle {...handleProps} />
                <span
                  aria-label={`open-schema-${name}`}
                  className={cn(
                    'flex-1 cursor-pointer truncate font-mono text-[13px]',
                    orphans.has(`schema:${name}`) ? 'text-delete' : 'text-post',
                  )}
                  onClick={() => onSelect({ kind: 'schema', name })}
                >
                  {name}
                </span>
                <RowActions>
                  <button
                    aria-label="duplicate-schema"
                    className="text-faint hover:text-text"
                    onClick={() => duplicate(name)}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    aria-label="delete-schema"
                    className="text-faint hover:text-delete"
                    onClick={() => void remove(name)}
                  >
                    <Trash2 size={14} />
                  </button>
                </RowActions>
              </NavItem>
            )}
          </Sortable>
        ))}
      </SortableList>
    </NavGroup>
  );
}
