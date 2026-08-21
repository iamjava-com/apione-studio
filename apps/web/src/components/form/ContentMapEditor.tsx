import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { TagSelect } from '../ui/TagSelect';
import { SchemaNode } from './SchemaNode';
import { CONTENT_TYPES } from './constants';
import type { Doc } from './types';

/**
 * The content-type rows shared by request and response bodies: a media-type picker, the schema
 * tree, and a remove button per entry. The caller owns the map itself — where it lives in the doc,
 * adding entries, and what removing the last one tears down.
 */
export function ContentMapEditor({
  content,
  kind,
  schemaNames,
  onNavigate,
  onRename,
  onRemove,
  mutateSchema,
}: {
  content: Record<string, Doc>;
  /** Prefixes the aria-labels ("request-content-type" / "remove-response-body"). */
  kind: 'request' | 'response';
  schemaNames: string[];
  onNavigate?: (name: string) => void;
  /** Receives a validated new media type: non-empty, different, not already in the map. */
  onRename: (oldCt: string, newCt: string) => void;
  onRemove: (ct: string) => void;
  /** Mutate one entry's schema; the implementation must create `schema` when missing. */
  mutateSchema: (ct: string, fn: (schema: Doc, doc: Doc) => void) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {Object.keys(content).map((ct) => (
        <div key={ct} className="flex items-start gap-1.5 border-l border-border pl-2">
          <div className="w-44 shrink-0">
            <TagSelect
              aria-label={`${kind}-content-type`}
              value={ct}
              options={[...new Set([ct, ...CONTENT_TYPES])]}
              onChange={(nc) => {
                if (!nc || nc === ct || content[nc]) return;
                onRename(ct, nc);
              }}
              allowClear={false}
              placeholder={t('mediaType')}
              clearLabel={t('mediaType')}
              createLabel={(q) => t('useLiteral', { name: q })}
            />
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <SchemaNode
              node={content[ct].schema ?? {}}
              names={schemaNames}
              onNavigate={onNavigate}
              mutate={(fn) => mutateSchema(ct, fn)}
            />
          </div>
          <Button size="sm" variant="ghost" aria-label={`remove-${kind}-body`} onClick={() => onRemove(ct)}>
            ✕
          </Button>
        </div>
      ))}
    </>
  );
}
