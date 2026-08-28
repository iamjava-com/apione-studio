import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { TagSelect } from '../ui/TagSelect';
import { CommitInput } from './CommitInput';
import { SortableList, Sortable, DragHandle } from './Sortable';
import { moveKey, insertAfterKey, renameKey, uniqueKey } from './reorder';
import { SchemaNode } from './SchemaNode';
import type { Doc } from './types';
import { cloneNode } from '../../lib/clone';

/** The child sections SchemaNode renders below its header row. Split out for file size only —
 *  they are SchemaNode's flesh, mutually recursive with it, and have no other callers. */

// Common OpenAPI/JSON-Schema formats per primary type — suggestions only; custom values allowed.
const FORMATS: Record<string, string[]> = {
  string: [
    'date-time',
    'date',
    'time',
    'email',
    'uuid',
    'uri',
    'hostname',
    'ipv4',
    'ipv6',
    'byte',
    'binary',
    'password',
  ],
  integer: ['int32', 'int64'],
  number: ['float', 'double'],
};

/** Coerce a text field to the JSON type implied by the schema's primary type. */
function coerce(type: string, raw: string): unknown {
  const s = raw.trim();
  if (s === '') return undefined;
  if (type === 'integer' || type === 'number') {
    const n = Number(s);
    return Number.isNaN(n) ? s : n;
  }
  if (type === 'boolean') {
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return s;
}

type Mutate = (fn: (n: Doc, root: Doc) => void) => void;

/** format / example / enum for a scalar node — what SchemaNode's advanced toggle reveals. */
export function ScalarAdvancedPanel({ node, ty, mutate }: { node: Doc; ty: string; mutate: Mutate }) {
  const { t } = useTranslation();
  const format = typeof node.format === 'string' ? node.format : '';
  const formatOptions = [...new Set([format, ...(FORMATS[ty] ?? [])].filter(Boolean))];
  const isCustomFormat = !!format && !(FORMATS[ty] ?? []).includes(format);
  const enumArr: unknown[] = Array.isArray(node.enum) ? node.enum : [];

  const setStr = (key: string) => (v: string) =>
    mutate((n) => {
      const s = v.trim();
      if (s) n[key] = s;
      else delete n[key];
    });
  const setTyped = (key: string) => (v: string) =>
    mutate((n) => {
      const c = coerce(ty, v);
      if (c === undefined) delete n[key];
      else n[key] = c;
    });
  const setEnum = (v: string) =>
    mutate((n) => {
      const items = v
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x !== '')
        .map((x) => coerce(ty, x));
      if (items.length) n.enum = items;
      else delete n.enum;
    });

  return (
    <div className="space-y-1.5 border-l border-border pl-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="w-40 shrink-0">
          <TagSelect
            aria-label="node-format"
            value={format}
            options={formatOptions}
            onChange={setStr('format')}
            placeholder={t('fFormat')}
            clearLabel={t('none')}
            createLabel={(q) => t('useLiteral', { name: q })}
          />
        </div>
        <Input
          aria-label="node-example"
          className="h-7 w-32 font-mono text-[12px]"
          placeholder={t('fExample')}
          value={node.example === undefined ? '' : String(node.example)}
          onChange={(e) => setTyped('example')(e.target.value)}
        />
        <Input
          aria-label="node-enum"
          className="h-7 w-44 font-mono text-[12px]"
          placeholder={t('fEnumPlaceholder')}
          title={t('fEnum')}
          value={enumArr.map(String).join(', ')}
          onChange={(e) => setEnum(e.target.value)}
        />
      </div>
      {isCustomFormat && <p className="text-[11px] text-faint">{t('formatHint', { format: t('fFormat') })}</p>}
    </div>
  );
}

/** An object node's property rows: sortable, renamable in place, with required/duplicate/remove. */
export function ObjectPropertiesEditor({
  node,
  names,
  selfName,
  onNavigate,
  mutate,
}: {
  node: Doc;
  names: string[];
  selfName?: string;
  onNavigate?: (name: string) => void;
  mutate: Mutate;
}) {
  const { t } = useTranslation();
  const props: Record<string, Doc> = node.properties ?? {};
  const required: string[] = Array.isArray(node.required) ? node.required : [];

  const addField = () =>
    mutate((n) => {
      n.properties ??= {};
      let f = 'field';
      let i = 1;
      while (n.properties[f]) f = `field${i++}`;
      n.properties[f] = { type: 'string' };
    });
  const removeField = (f: string) =>
    mutate((n) => {
      delete n.properties[f];
      if (Array.isArray(n.required)) n.required = n.required.filter((r: string) => r !== f);
    });
  const renameField = (oldF: string, newF: string) =>
    mutate((n) => {
      if (newF === oldF || n.properties[newF]) return; // reject duplicate
      n.properties = renameKey(n.properties, oldF, newF);
      if (Array.isArray(n.required)) n.required = n.required.map((r: string) => (r === oldF ? newF : r));
    });
  const toggleRequired = (f: string, on: boolean) =>
    mutate((n) => {
      n.required ??= [];
      const i = n.required.indexOf(f);
      if (on && i < 0) n.required.push(f);
      if (!on && i >= 0) n.required.splice(i, 1);
    });
  const reorderFields = (activeId: string, overId: string) =>
    mutate((n) => {
      n.properties = moveKey(n.properties, activeId, overId);
    });
  const duplicateField = (f: string) =>
    mutate((n) => {
      const key = uniqueKey(Object.keys(n.properties), f);
      n.properties = insertAfterKey(n.properties, f, key, cloneNode(n.properties[f]));
    });

  return (
    <div className="space-y-1.5 border-l border-border pl-3">
      <SortableList ids={Object.keys(props)} onReorder={reorderFields}>
        {Object.keys(props).map((f) => (
          <Sortable key={f} id={f}>
            {({ setNodeRef, style, handleProps }) => (
              <div ref={setNodeRef} style={style}>
                <SchemaNode
                  node={props[f]}
                  names={names}
                  selfName={selfName}
                  onNavigate={onNavigate}
                  nameHint={f}
                  mutate={(fn) => mutate((n, root) => fn(n.properties[f], root))}
                  leading={
                    <>
                      <DragHandle {...handleProps} />
                      <CommitInput
                        aria-label="field-name"
                        className="mt-0 w-52 shrink-0 font-mono"
                        value={f}
                        onCommit={(next) => renameField(f, next)}
                      />
                    </>
                  }
                  flags={
                    <label className="flex shrink-0 items-center gap-1 text-[12px] text-muted">
                      <input
                        type="checkbox"
                        checked={required.includes(f)}
                        onChange={(e) => toggleRequired(f, e.target.checked)}
                      />
                      {t('fRequired')}
                    </label>
                  }
                  trailing={
                    <>
                      <Button size="sm" variant="ghost" aria-label="duplicate-field" onClick={() => duplicateField(f)}>
                        <Copy size={13} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeField(f)}>
                        ✕
                      </Button>
                    </>
                  }
                />
              </div>
            )}
          </Sortable>
        ))}
      </SortableList>
      {/* Spacer mirrors the collapse-toggle column so the button lines up with the row
          content (drag handle) above it — same as the branch add button. */}
      <div className="flex items-center gap-1.5">
        <span className="w-5 shrink-0" />
        <Button size="sm" onClick={addField}>
          + {t('addField')}
        </Button>
      </div>
    </div>
  );
}

/** An allOf/oneOf/anyOf node's branch list; `ty` is the composition keyword in play. */
export function CompositionEditor({
  node,
  ty,
  names,
  selfName,
  onNavigate,
  mutate,
}: {
  node: Doc;
  ty: string;
  names: string[];
  selfName?: string;
  onNavigate?: (name: string) => void;
  mutate: Mutate;
}) {
  const { t } = useTranslation();
  const branches: Doc[] = Array.isArray(node[ty]) ? node[ty] : [];

  const addBranch = () =>
    mutate((n) => {
      (n[ty] ??= []).push({ type: 'string' });
    });
  const removeBranch = (i: number) =>
    mutate((n) => {
      if (Array.isArray(n[ty])) n[ty].splice(i, 1);
    });

  return (
    <div className="space-y-1.5 border-l border-border pl-3">
      {branches.map((_, i) => (
        <div key={i}>
          <SchemaNode
            node={branches[i]}
            names={names}
            selfName={selfName}
            onNavigate={onNavigate}
            leading={
              <span className="shrink-0 text-[12px] text-faint">
                {t('branch')} {i + 1}
              </span>
            }
            trailing={
              <Button size="sm" variant="ghost" aria-label="remove-branch" onClick={() => removeBranch(i)}>
                ✕
              </Button>
            }
            mutate={(fn) => mutate((n, root) => fn(n[ty][i], root))}
          />
        </div>
      ))}
      {/* Spacer mirrors a branch row's leading column (collapse toggle) so the button
          lines up with the "branch N" label above it. */}
      <div className="flex items-center gap-1.5">
        <span className="w-5 shrink-0" />
        <Button size="sm" onClick={addBranch}>
          + {t('branch')}
        </Button>
      </div>
    </div>
  );
}
