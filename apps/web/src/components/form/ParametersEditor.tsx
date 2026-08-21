import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { TagSelect } from '../ui/TagSelect';
import { SortableList, Sortable, DragHandle } from './Sortable';
import { selectCls } from './constants';
import { primaryType, isNullable } from './schema-type';
import { useRowIds } from '../../hooks/useRowIds';
import type { Doc, UpdateFn } from './types';

const PARAM_TYPES = ['string', 'integer', 'number', 'boolean'];
// Ordered the way a request reads: URL first (path → query), then transport (header → cookie).
const PARAM_INS = ['path', 'query', 'header', 'cookie'] as const;

// Suggestions only, never translated. Path has none — the URL template names those.
const COMMON_NAMES: Record<string, string[]> = {
  query: ['page', 'pageSize', 'limit', 'offset', 'sort', 'q'],
  header: ['Authorization', 'Content-Type', 'Accept', 'X-Request-Id'],
  cookie: ['sessionid', 'sid', 'csrftoken'],
};

/**
 * An operation's parameters, grouped by location. query/header/cookie are edited here
 * (add · reorder-within-group · duplicate · remove); a path param's name comes from the URL
 * template `{x}` (synced in OperationCard) and is read-only, the rest of its row is not.
 */
export function ParametersEditor({ p, m, op, update }: { p: string; m: string; op: Doc; update: UpdateFn }) {
  const { t } = useTranslation();
  const params: Doc[] = Array.isArray(op.parameters) ? op.parameters : [];

  const { ids, reorder: reorderIds } = useRowIds(params.length, 'param');

  const mutateParams = (fn: (arr: Doc[]) => void) =>
    update((d) => {
      const o = d.paths[p][m];
      o.parameters = Array.isArray(o.parameters) ? o.parameters : [];
      fn(o.parameters);
    });
  // Only query/header/cookie are added here (path is URL-driven), so a new param is never required.
  const addParam = (inType: string) =>
    mutateParams((a) => a.push({ name: '', in: inType, required: false, schema: { type: 'string' } }));
  // name + in uniquely identifies a parameter (OpenAPI), so reject a rename that would collide
  // with another param in the same location — same guard the content-type/response-code maps get.
  const renameParam = (i: number, inType: string, name: string) =>
    mutateParams((a) => {
      if (name && a.some((q, j) => j !== i && (q.in ?? 'query') === inType && q.name === name)) return;
      a[i].name = name;
    });
  const reorderParams = (activeId: string, overId: string) => {
    const moved = reorderIds(activeId, overId);
    if (moved) mutateParams((a) => a.splice(moved.to, 0, a.splice(moved.from, 1)[0]));
  };
  const describeParam = (i: number, text: string) =>
    mutateParams((a) => {
      if (text) a[i].description = text;
      else delete a[i].description;
    });
  const duplicateParam = (i: number) =>
    mutateParams((a) => {
      const clone = structuredClone(a[i]);
      clone.name = `${clone.name ?? 'param'}Copy`;
      a.splice(i + 1, 0, clone);
    });

  const typeSelect = (param: Doc, i: number) => (
    <select
      aria-label="param-type"
      className={`${selectCls} shrink-0`}
      value={primaryType(param.schema) ?? 'string'}
      onChange={(e) =>
        mutateParams((a) => {
          const sc = (a[i].schema ??= {});
          sc.type = isNullable(sc) ? [e.target.value, 'null'] : e.target.value; // keep nullability
        })
      }
    >
      {PARAM_TYPES.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </select>
  );

  const descInput = (param: Doc, i: number) => (
    <Input
      aria-label="param-description"
      className="h-7 min-w-[10rem] flex-1 text-[12px]"
      placeholder={t('fDescription')}
      value={(param.description as string) ?? ''}
      onChange={(e) => describeParam(i, e.target.value)}
    />
  );

  return (
    <div className="space-y-1.5 overflow-x-auto">
      {PARAM_INS.map((inType) => {
        const entries = params.map((param, i) => ({ param, i })).filter((e) => (e.param.in ?? 'query') === inType);
        // No add/remove/rename for path — the URL template drives them. Order follows the path,
        // since the array can lag behind incremental path edits.
        if (inType === 'path') {
          const order = [...p.matchAll(/\{([^}]+)\}/g)].map((mm) => mm[1]);
          const rank = (name: unknown) => {
            const idx = order.indexOf(name as string);
            return idx < 0 ? Infinity : idx;
          };
          const pathEntries = entries.slice().sort((a, b) => rank(a.param.name) - rank(b.param.name));
          return (
            <div key={inType} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-faint">{inType}</span>
                <span className="text-[11px] text-faint">{t('pathParamHint')}</span>
              </div>
              {pathEntries.map(({ param, i }) => (
                <div key={ids[i]} className="flex items-center gap-1.5">
                  <span className="w-52 shrink-0 truncate font-mono text-[13px] text-muted">{`{${param.name}}`}</span>
                  {typeSelect(param, i)}
                  <label className="flex shrink-0 items-center gap-1 text-[12px] text-faint">
                    <input type="checkbox" checked disabled />
                    {t('fRequired')}
                  </label>
                  {descInput(param, i)}
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={inType} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-faint">{inType}</span>
              <Button size="sm" aria-label={`add-param-${inType}`} onClick={() => addParam(inType)}>
                + {inType[0].toUpperCase() + inType.slice(1)}
              </Button>
            </div>
            {entries.length > 0 && (
              <SortableList ids={entries.map((e) => ids[e.i])} onReorder={reorderParams}>
                {entries.map(({ param, i }) => (
                  <Sortable key={ids[i]} id={ids[i]}>
                    {({ setNodeRef, style, handleProps }) => (
                      <div ref={setNodeRef} style={style} className="flex items-center gap-1.5">
                        <DragHandle {...handleProps} />
                        <div className="w-52 shrink-0 font-mono">
                          <TagSelect
                            aria-label="param-name"
                            value={(param.name as string) ?? ''}
                            options={[
                              ...new Set([
                                ...(param.name ? [param.name as string] : []),
                                ...(COMMON_NAMES[inType] ?? []),
                              ]),
                            ]}
                            onChange={(v) => renameParam(i, inType, v)}
                            allowClear={false}
                            placeholder={t('name')}
                            clearLabel={t('name')}
                            createLabel={(q) => t('useLiteral', { name: q })}
                          />
                        </div>
                        {typeSelect(param, i)}
                        <label className="flex shrink-0 items-center gap-1 text-[12px] text-muted">
                          <input
                            type="checkbox"
                            checked={!!param.required}
                            onChange={(e) => mutateParams((a) => (a[i].required = e.target.checked))}
                          />
                          {t('fRequired')}
                        </label>
                        {descInput(param, i)}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          aria-label="duplicate-param"
                          onClick={() => duplicateParam(i)}
                        >
                          <Copy size={13} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          onClick={() => mutateParams((a) => a.splice(i, 1))}
                        >
                          ✕
                        </Button>
                      </div>
                    )}
                  </Sortable>
                ))}
              </SortableList>
            )}
          </div>
        );
      })}
    </div>
  );
}
