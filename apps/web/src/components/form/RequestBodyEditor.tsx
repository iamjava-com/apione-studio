import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { ContentMapEditor } from './ContentMapEditor';
import { CONTENT_TYPES } from './constants';
import { renameKey } from './reorder';
import { SCHEMAS_REF } from '../../lib/openapi-refs';
import type { Doc, UpdateFn } from './types';

/**
 * The operation's request body: an optional schema per content-type — the same shape as a
 * response body (`content` keyed by media type), so it shares ContentMapEditor with
 * ResponsesEditor. Removing the last content-type drops `requestBody` entirely.
 */
export function RequestBodyEditor({
  p,
  m,
  op,
  schemaNames,
  update,
  onNavigate,
}: {
  p: string;
  m: string;
  op: Doc;
  schemaNames: string[];
  update: UpdateFn;
  onNavigate?: (name: string) => void;
}) {
  const { t } = useTranslation();
  const content: Record<string, Doc> = op.requestBody?.content ?? {};

  const addContent = () =>
    update((d) => {
      const o = d.paths[p][m];
      o.requestBody ??= { content: {} };
      o.requestBody.content ??= {};
      const c: Record<string, Doc> = o.requestBody.content;
      const ct = c['application/json'] ? (CONTENT_TYPES.find((x) => !c[x]) ?? 'application/json') : 'application/json';
      c[ct] ??= { schema: schemaNames[0] ? { $ref: `${SCHEMAS_REF}${schemaNames[0]}` } : { type: 'object' } };
    });
  const removeContent = (ct: string) =>
    update((d) => {
      const rb = d.paths[p][m].requestBody;
      if (!rb?.content) return;
      delete rb.content[ct];
      if (Object.keys(rb.content).length === 0) delete d.paths[p][m].requestBody;
    });
  const renameContentType = (oldCt: string, newCt: string) =>
    update((d) => {
      const rb = d.paths[p][m].requestBody;
      if (!rb?.content) return;
      rb.content = renameKey(rb.content, oldCt, newCt);
    });

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-faint">body</span>
        <Button size="sm" aria-label="add-request-body" onClick={addContent}>
          + {t('requestBody')}
        </Button>
      </div>
      <ContentMapEditor
        content={content}
        kind="request"
        schemaNames={schemaNames}
        onNavigate={onNavigate}
        onRename={renameContentType}
        onRemove={removeContent}
        mutateSchema={(ct, fn) =>
          update((d) => {
            const c = d.paths[p][m].requestBody.content[ct];
            c.schema ??= {};
            fn(c.schema, d);
          })
        }
      />
    </div>
  );
}
