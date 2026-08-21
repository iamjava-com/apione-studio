import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { TagSelect } from '../ui/TagSelect';
import { CommitInput } from './CommitInput';
import { ParametersEditor } from './ParametersEditor';
import { RequestBodyEditor } from './RequestBodyEditor';
import { ResponsesEditor } from './ResponsesEditor';
import { StagePicker } from './StagePicker';
import { insertAfterKey } from './reorder';
import { selectCls, sectionLabelCls, textareaCls, HTTP_METHODS } from './constants';
import { anchorId } from '../../lib/utils';
import type { Doc, UpdateFn } from './types';

/** Path params mirror the URL template: every `{x}` gets a required path param, and path params
 *  whose placeholder is gone from the path are dropped. Query/header/cookie params are untouched. */
function syncPathParams(op: Doc, path: string) {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((mm) => mm[1]);
  const params: Doc[] = Array.isArray(op.parameters) ? op.parameters : [];
  const kept = params.filter((pm) => pm.in !== 'path' || names.includes(pm.name as string));
  for (const nm of names) {
    if (!kept.some((pm) => pm.in === 'path' && pm.name === nm))
      kept.push({ name: nm, in: 'path', required: true, schema: { type: 'string' } });
  }
  if (kept.length) op.parameters = kept;
  else delete op.parameters;
}

/** One operation's editor: editable method + path, summary/description/operationId/tags +
 *  request body, then the parameter and response sub-editors. */
export function OperationCard({
  p,
  m,
  op,
  schemaNames,
  allTags,
  opKeys,
  update,
  onRenamed,
  onNavigate,
}: {
  p: string;
  m: string;
  op: Doc;
  schemaNames: string[];
  allTags: string[];
  opKeys: Set<string>; // every `${method} ${path}` in use — to reject a move onto an existing op
  update: UpdateFn;
  onRenamed: (method: string, path: string) => void;
  onNavigate?: (name: string) => void;
}) {
  const { t } = useTranslation();
  // One tag per operation = one group (matches the single-group outline + docs).
  const opTag = Array.isArray(op.tags) && op.tags.length ? String(op.tags[0]) : '';

  // Method + path are the operation's identity (its keys in `paths`). Editing either MOVES
  // this one operation to the new location (siblings on the old path stay put), unless the
  // target already exists.
  const moveOp = (nextMethod: string, nextPathRaw: string) => {
    let nextPath = nextPathRaw.trim();
    if (!nextPath) return;
    if (!nextPath.startsWith('/')) nextPath = `/${nextPath}`;
    if (nextMethod === m && nextPath === p) return;
    if (opKeys.has(`${nextMethod} ${nextPath}`)) return; // collision → ignore
    update((d) => {
      const moved = d.paths[p][m];
      syncPathParams(moved, nextPath); // keep path params in step with the new URL template
      if (nextPath in d.paths) {
        d.paths[nextPath][nextMethod] = moved; // merge into an existing path
      } else {
        // new path: insert right after the current one so it keeps its slot in the outline
        // (a bare delete+add would append the key to the end of `paths`).
        d.paths = insertAfterKey(d.paths, p, nextPath, { [nextMethod]: moved });
      }
      delete d.paths[p][m];
      if (Object.keys(d.paths[p]).length === 0) delete d.paths[p];
    });
    onRenamed(nextMethod, nextPath);
  };

  const setField = (key: string, val: string) =>
    update((d) => {
      if (val) d.paths[p][m][key] = val;
      else delete d.paths[p][m][key];
    });
  // Omit `deprecated` when off — false is the default, so canonical output stays clean.
  const setDeprecated = (v: boolean) =>
    update((d) => {
      if (v) d.paths[p][m].deprecated = true;
      else delete d.paths[p][m].deprecated;
    });
  // The tag is the operation's group. Pick from tags already defined, or create a new one —
  // management (order, description, removal) lives in the Info tags manager.
  const setTag = (tag: string) =>
    update((d) => {
      if (tag) d.paths[p][m].tags = [tag];
      else delete d.paths[p][m].tags;
    });

  // Conventionally only these methods carry a request body; keep the affordance scoped to them.
  const hasBody = ['post', 'put', 'patch'].includes(m);

  return (
    <div id={anchorId('op', m, p)} className="scroll-mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <select
          aria-label="op-method"
          className={`${selectCls} uppercase`}
          value={m}
          onChange={(e) => moveOp(e.target.value, p)}
        >
          {HTTP_METHODS.map((x) => (
            <option key={x} value={x}>
              {x.toUpperCase()}
            </option>
          ))}
        </select>
        <CommitInput
          aria-label="op-path"
          className="flex-1 font-mono text-[13px]"
          value={p}
          onCommit={(np) => moveOp(m, np)}
        />
        <StagePicker p={p} m={m} op={op} update={update} />
        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={!!op.deprecated} onChange={(e) => setDeprecated(e.target.checked)} />
          {t('deprecated')}
        </label>
      </div>
      <div className="text-[12px] text-muted">
        {t('fSummary')}
        <Input
          aria-label={t('fSummary')}
          className="mt-1"
          placeholder={t('fSummary')}
          value={(op.summary as string) ?? ''}
          onChange={(e) => setField('summary', e.target.value)}
        />
      </div>
      <div className="text-[12px] text-muted">
        {t('fDescription')}
        <textarea
          aria-label="op-description"
          rows={3}
          className={`mt-1 ${textareaCls}`}
          placeholder={t('fDescription')}
          value={(op.description as string) ?? ''}
          onChange={(e) => setField('description', e.target.value)}
        />
      </div>
      <div className="text-[12px] text-muted">
        operationId
        <Input
          aria-label="operationId"
          className="mt-1 font-mono"
          placeholder="operationId"
          value={(op.operationId as string) ?? ''}
          onChange={(e) => setField('operationId', e.target.value)}
        />
      </div>
      <div className="text-[12px] text-muted">
        {t('opTags')}
        <div className="mt-1">
          <TagSelect
            aria-label="op-tags"
            value={opTag}
            options={allTags}
            onChange={setTag}
            placeholder={t('opTagsHint')}
            clearLabel={t('none')}
            createLabel={(q) => t('createTag', { name: q })}
          />
        </div>
      </div>

      <div className="space-y-1.5 pt-1">
        <span className={sectionLabelCls}>{t('request')}</span>
        <div className="space-y-2 rounded border border-border/60 p-1.5">
          <ParametersEditor p={p} m={m} op={op} update={update} />
          {hasBody && (
            <RequestBodyEditor p={p} m={m} op={op} schemaNames={schemaNames} update={update} onNavigate={onNavigate} />
          )}
        </div>
      </div>
      <ResponsesEditor p={p} m={m} op={op} schemaNames={schemaNames} update={update} onNavigate={onNavigate} />
    </div>
  );
}
