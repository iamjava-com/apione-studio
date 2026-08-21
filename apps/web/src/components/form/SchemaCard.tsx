import { useEffect, useState } from 'react';
import { Input } from '../ui/input';
import { SchemaNode } from './SchemaNode';
import { renameKey } from './reorder';
import { rewriteSchemaRefs } from '../../lib/openapi-refs';
import { anchorId } from '../../lib/utils';
import type { Doc, UpdateFn } from './types';

/** Editable schema name; commits on blur/Enter so refs are rewritten once, not per keystroke. */
function SchemaName({ name, taken, onRename }: { name: string; taken: string[]; onRename: (v: string) => void }) {
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  const commit = () => {
    const next = v.trim();
    if (next && next !== name && !taken.includes(next)) onRename(next);
    else setV(name); // reject empty / duplicate — snap back
  };
  return (
    <Input
      aria-label="schema-name"
      className="w-48 font-mono text-post"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** One schema's editor (the detail pane for a selected model). */
export function SchemaCard({
  name,
  node,
  names,
  update,
  onRenamed,
  onNavigate,
}: {
  name: string;
  node: Doc;
  names: string[];
  update: UpdateFn;
  onRenamed: (newName: string) => void;
  onNavigate?: (name: string) => void;
}) {
  // Rename → preserve key order, then rewrite every $ref pointing at the old name.
  const rename = (newName: string) => {
    update((d) => {
      d.components.schemas = renameKey(d.components.schemas, name, newName);
      rewriteSchemaRefs(d, name, newName);
    });
    onRenamed(newName);
  };

  return (
    <div id={anchorId('schema', name)} className="space-y-2 overflow-x-auto">
      <SchemaName name={name} taken={names.filter((n) => n !== name)} onRename={rename} />
      <SchemaNode
        node={node}
        names={names}
        selfName={name}
        onNavigate={onNavigate}
        rootSchema
        mutate={(fn) => update((d) => fn(d.components.schemas[name], d))}
      />
    </div>
  );
}
