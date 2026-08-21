import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { CommitInput } from './CommitInput';
import { ContentMapEditor } from './ContentMapEditor';
import { sectionLabelCls } from './constants';
import { renameKey } from './reorder';
import { SCHEMAS_REF } from '../../lib/openapi-refs';
import type { Doc, UpdateFn } from './types';

/**
 * One operation's responses: status codes (rename-in-place), a description, and an optional
 * body per content-type — each body reuses SchemaNode ($ref to a model, array-of-$ref, or
 * an inline object).
 */
export function ResponsesEditor({
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
  const responses: Record<string, Doc> = op.responses ?? {};

  const mutateResponses = (fn: (r: Record<string, Doc>) => void) =>
    update((d) => {
      const o = d.paths[p][m];
      o.responses ??= {};
      fn(o.responses);
    });
  const renameResponse = (oldCode: string, newCode: string) =>
    update((d) => {
      const o = d.paths[p][m];
      const r: Record<string, Doc> = o.responses ?? {};
      if (!newCode || newCode === oldCode || r[newCode]) return; // reject empty / duplicate
      o.responses = renameKey(r, oldCode, newCode);
    });
  const addContent = (code: string) =>
    mutateResponses((r) => {
      r[code].content ??= {};
      const ct = r[code].content['application/json'] ? 'text/plain' : 'application/json';
      r[code].content[ct] ??= {
        schema: schemaNames[0] ? { $ref: `${SCHEMAS_REF}${schemaNames[0]}` } : { type: 'object' },
      };
    });
  const removeContent = (code: string, ct: string) =>
    mutateResponses((r) => {
      delete r[code].content?.[ct];
      if (r[code].content && Object.keys(r[code].content).length === 0) delete r[code].content;
    });
  const renameContentType = (code: string, oldCt: string, newCt: string) =>
    mutateResponses((r) => {
      r[code].content = renameKey(r[code].content ?? {}, oldCt, newCt);
    });

  return (
    <>
      <div className="flex items-center gap-2 pt-1">
        <span className={sectionLabelCls}>{t('responses')}</span>
        <Button
          size="sm"
          onClick={() =>
            mutateResponses((r) => {
              const codes = ['200', '201', '204', '400', '401', '403', '404', '500'];
              const next = codes.find((c) => !r[c]) ?? '200';
              r[next] ??= { description: '' };
            })
          }
        >
          + {t('addResponse')}
        </Button>
      </div>
      {Object.keys(responses).map((code) => {
        const content: Record<string, Doc> = responses[code].content ?? {};
        return (
          <div key={code} className="space-y-1.5 rounded border border-border/60 p-1.5">
            <div className="flex items-center gap-1.5">
              <CommitInput
                aria-label="response-code"
                className="w-16 font-mono text-[13px]"
                value={code}
                onCommit={(nc) => renameResponse(code, nc)}
              />
              <Input
                className="flex-1"
                placeholder={t('fDescription')}
                value={(responses[code].description as string) ?? ''}
                onChange={(e) => mutateResponses((r) => (r[code].description = e.target.value))}
              />
              <Button size="sm" aria-label="add-response-body" onClick={() => addContent(code)}>
                + {t('body')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => mutateResponses((r) => delete r[code])}>
                ✕
              </Button>
            </div>
            <ContentMapEditor
              content={content}
              kind="response"
              schemaNames={schemaNames}
              onNavigate={onNavigate}
              onRename={(oldCt, newCt) => renameContentType(code, oldCt, newCt)}
              onRemove={(ct) => removeContent(code, ct)}
              mutateSchema={(ct, fn) =>
                update((d) => {
                  const c = d.paths[p][m].responses[code].content[ct];
                  c.schema ??= {};
                  fn(c.schema, d);
                })
              }
            />
          </div>
        );
      })}
    </>
  );
}
