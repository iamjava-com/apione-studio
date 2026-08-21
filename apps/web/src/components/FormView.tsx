import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import YAML from 'yaml';
import type { SpecFile } from '../hooks/useSpecFile';
import { InfoSection } from './form/InfoSection';
import { OperationCard } from './form/OperationCard';
import { SchemaCard } from './form/SchemaCard';
import { HTTP_METHODS } from './form/constants';
import type { Doc, Selection, UpdateFn } from './form/types';

/** Every tag in use across the spec (top-level `tags:` + each operation's tags) — for autocomplete. */
function collectTags(doc: Doc): string[] {
  const set = new Set<string>();
  for (const tg of doc.tags ?? []) if (typeof tg?.name === 'string') set.add(tg.name);
  for (const item of Object.values(doc.paths ?? {}) as Doc[])
    for (const m of HTTP_METHODS) for (const tag of item?.[m]?.tags ?? []) if (typeof tag === 'string') set.add(tag);
  return [...set];
}

/** Every operation as `${method} ${path}` — lets the op editor reject a move onto an existing op. */
function collectOpKeys(doc: Doc): Set<string> {
  const keys = new Set<string>();
  for (const [p, item] of Object.entries(doc.paths ?? {}) as [string, Doc][])
    for (const m of HTTP_METHODS) if (item?.[m]) keys.add(`${m} ${p}`);
  return keys;
}

/**
 * Master-detail editor: renders only the item chosen in the outline (Info, one
 * operation, or one schema). Edits a parsed copy of the spec and writes it back
 * as YAML — two-way with the YAML view, persisted via the same save path.
 */
export function FormView({
  file,
  docRevision,
  selection,
  onSelect,
}: {
  file: SpecFile;
  docRevision?: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [parseError, setParseError] = useState(false);

  // Re-parse on (re)load, when the outline edits the doc (docRevision bump), and when the
  // content is swapped wholesale (reset/restore → file.syncRev). The form's own edits bump
  // none of these, so typing never triggers a re-parse.
  useEffect(() => {
    if (!file.loaded) return;
    try {
      setDoc(YAML.parse(file.content) ?? {});
      setParseError(false);
    } catch {
      setParseError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.loaded, docRevision, file.syncRev]);

  if (!file.loaded) return null; // loading (or switching files) — no stale form, no flash
  if (parseError) {
    return <div className="p-4 text-[14px] text-muted">{t('formUnavailable')}</div>;
  }
  // loaded, parse ok, but the effect hasn't set doc for this frame yet — render blank
  // rather than flashing the "unparseable" notice for one frame (effect runs post-render).
  if (!doc) return null;

  const update: UpdateFn = (mutate) => {
    const next = structuredClone(doc);
    mutate(next);
    setDoc(next);
    file.setContent(YAML.stringify(next));
  };

  const schemaNames = Object.keys(doc.components?.schemas ?? {});

  const gotoSchema = (name: string) => onSelect({ kind: 'schema', name });

  let body;
  if (selection.kind === 'info') {
    body = <InfoSection doc={doc} update={update} />;
  } else if (selection.kind === 'op') {
    const op = doc.paths?.[selection.path]?.[selection.method];
    body = op ? (
      <OperationCard
        p={selection.path}
        m={selection.method}
        op={op}
        schemaNames={schemaNames}
        allTags={collectTags(doc)}
        opKeys={collectOpKeys(doc)}
        update={update}
        onRenamed={(method, path) => onSelect({ kind: 'op', method, path })}
        onNavigate={gotoSchema}
      />
    ) : null;
  } else {
    const node = doc.components?.schemas?.[selection.name];
    body = node ? (
      <SchemaCard
        name={selection.name}
        node={node}
        names={schemaNames}
        update={update}
        onRenamed={(newName) => onSelect({ kind: 'schema', name: newName })}
        onNavigate={gotoSchema}
      />
    ) : null;
  }

  return (
    <div className="h-full space-y-6 overflow-auto p-4">{body ?? <p className="text-[14px] text-muted">—</p>}</div>
  );
}
