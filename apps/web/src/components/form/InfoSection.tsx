import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { CommitInput } from './CommitInput';
import { ServersEditor } from './ServersEditor';
import { SortableList, Sortable, DragHandle } from './Sortable';
import { HTTP_METHODS, sectionLabelCls, textareaCls } from './constants';
import type { Doc, SectionProps } from './types';

/** Tags in operation order (first appearance), deduped. */
function usedTagsOrdered(doc: Doc): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of Object.values(doc.paths ?? {}) as Doc[])
    for (const m of HTTP_METHODS)
      for (const tag of item?.[m]?.tags ?? [])
        if (typeof tag === 'string' && !seen.has(tag)) {
          seen.add(tag);
          out.push(tag);
        }
  return out;
}

/** Tags to manage — declared ones (in `tags:` order) first, then any used-but-undeclared. A
 *  declared tag persists even with no operations (this is the authoritative tag list). */
function displayTags(doc: Doc): string[] {
  const declared = (doc.tags ?? [])
    .map((tg: Doc) => tg?.name)
    .filter((n: unknown): n is string => typeof n === 'string');
  const out = [...declared];
  for (const n of usedTagsOrdered(doc)) if (!out.includes(n)) out.push(n);
  return out;
}
const descOf = (doc: Doc, name: string): string =>
  (doc.tags ?? []).find((tg: Doc) => tg?.name === name)?.description ?? '';

export function InfoSection({ doc, update }: SectionProps) {
  const { t } = useTranslation();
  const tags = displayTags(doc);

  // Structural edits materialize the full display order into `tags:` first (so any
  // used-but-undeclared tag becomes a real, orderable entry in its current position), then
  // apply the change. Order here drives the docs' (and the outline's) group order.
  const materialize = (d: Doc) => {
    d.tags = displayTags(d).map((n) => (d.tags ?? []).find((tg: Doc) => tg?.name === n) ?? { name: n });
  };
  const reorderTags = (activeId: string, overId: string) =>
    update((d) => {
      materialize(d);
      const from = d.tags.findIndex((tg: Doc) => tg?.name === activeId);
      const to = d.tags.findIndex((tg: Doc) => tg?.name === overId);
      if (from < 0 || to < 0) return;
      d.tags.splice(to, 0, d.tags.splice(from, 1)[0]);
    });
  const setTagDesc = (name: string, desc: string) =>
    update((d) => {
      materialize(d);
      const entry = d.tags.find((tg: Doc) => tg?.name === name);
      if (entry) entry.description = desc || undefined;
    });
  // Renaming propagates to every operation that uses the tag (like schema rename → $refs).
  const renameTag = (oldName: string, newName: string) =>
    update((d) => {
      const name = newName.trim();
      if (!name || name === oldName || displayTags(d).includes(name)) return; // reject empty / duplicate
      materialize(d);
      for (const tg of d.tags) if (tg?.name === oldName) tg.name = name;
      for (const item of Object.values(d.paths ?? {}) as Doc[])
        for (const m of HTTP_METHODS) {
          const op = item?.[m];
          if (Array.isArray(op?.tags)) op.tags = op.tags.map((x: string) => (x === oldName ? name : x));
        }
    });
  // Create a new (empty) tag declaration — it shows here and as an empty group in the outline
  // until operations are assigned to it.
  const addTag = () =>
    update((d) => {
      d.tags ??= [];
      let n = 'tag';
      let i = 1;
      while (displayTags(d).includes(n)) n = `tag${i++}`;
      d.tags.push({ name: n });
    });
  // Remove = get rid of the tag entirely: drop the declaration and untag every operation.
  const removeTag = (name: string) =>
    update((d) => {
      if (Array.isArray(d.tags)) d.tags = d.tags.filter((tg: Doc) => tg?.name !== name);
      for (const item of Object.values(d.paths ?? {}) as Doc[])
        for (const m of HTTP_METHODS) {
          const op = item?.[m];
          if (Array.isArray(op?.tags)) {
            op.tags = op.tags.filter((x: string) => x !== name);
            if (op.tags.length === 0) delete op.tags;
          }
        }
    });

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <div className="text-[13px] text-muted">
          {t('fTitle')}
          <Input
            aria-label={t('fTitle')}
            className="mt-1"
            value={doc.info?.title ?? ''}
            onChange={(e) => update((d) => ((d.info ??= {}).title = e.target.value))}
          />
        </div>
        <div className="text-[13px] text-muted">
          {t('fVersion')}
          <Input
            aria-label={t('fVersion')}
            className="mt-1 font-mono"
            value={doc.info?.version ?? ''}
            onChange={(e) => update((d) => ((d.info ??= {}).version = e.target.value))}
          />
        </div>
        <div className="text-[13px] text-muted">
          {t('fDescription')}
          <textarea
            aria-label={t('fDescription')}
            rows={3}
            className={`mt-1 ${textareaCls}`}
            value={doc.info?.description ?? ''}
            onChange={(e) => update((d) => ((d.info ??= {}).description = e.target.value))}
          />
        </div>
      </div>

      <ServersEditor doc={doc} update={update} />

      {/* Tags = the groups (the authoritative list). Add/rename/reorder/describe/remove here;
          operations only pick from these. Removing a tag untags every operation. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className={sectionLabelCls}>{t('manageTags')}</h3>
          <Button size="sm" aria-label="add-tag" onClick={addTag}>
            + {t('addTag')}
          </Button>
        </div>
        <SortableList ids={tags} onReorder={reorderTags}>
          {tags.map((name) => (
            <Sortable key={name} id={name}>
              {({ setNodeRef, style, handleProps }) => (
                <div ref={setNodeRef} style={style} className="flex items-center gap-1.5">
                  <DragHandle {...handleProps} />
                  <CommitInput
                    aria-label="tag-name"
                    className="w-28 text-[13px]"
                    value={name}
                    onCommit={(nv) => renameTag(name, nv)}
                  />
                  <Input
                    aria-label="tag-description"
                    className="flex-1 text-[13px]"
                    placeholder={t('fDescription')}
                    value={descOf(doc, name)}
                    onChange={(e) => setTagDesc(name, e.target.value)}
                  />
                  <Button size="sm" variant="ghost" aria-label="remove-tag" onClick={() => removeTag(name)}>
                    <X size={13} />
                  </Button>
                </div>
              )}
            </Sortable>
          ))}
        </SortableList>
      </div>
    </section>
  );
}
