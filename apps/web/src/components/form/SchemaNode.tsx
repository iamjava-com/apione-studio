import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, ChevronDown, ChevronRight, PackagePlus, SlidersHorizontal } from 'lucide-react';
import { Input } from '../ui/input';
import { selectCls } from '../ui/select';
import { ScalarAdvancedPanel, ObjectPropertiesEditor, CompositionEditor } from './SchemaNodeSections';
import { SCHEMAS_REF } from '../../lib/openapi-refs';
import { primaryType, isNullable, setNullable } from './schema-type';
import type { Doc } from './types';
import { cloneNode } from '../../lib/clone';

const COMPOSITION = ['allOf', 'oneOf', 'anyOf'] as const;
const TYPES = ['string', 'integer', 'number', 'boolean', 'object', 'array', '$ref', ...COMPOSITION] as const;

function nodeType(s: Doc): string {
  if (s?.$ref) return '$ref';
  for (const kw of COMPOSITION) if (Array.isArray(s?.[kw])) return kw;
  return primaryType(s) ?? 'string';
}

function resetTo(n: Doc, shape: Doc) {
  for (const k of Object.keys(n)) delete n[k];
  Object.assign(n, shape);
}

/** A PascalCase schema name derived from `base`, unique against `taken`. */
function uniqueSchemaName(taken: string[], base: string): string {
  const cleaned = base.replace(/[^A-Za-z0-9_]/g, '') || 'Model';
  const name = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  if (!taken.includes(name)) return name;
  let i = 2;
  while (taken.includes(`${name}${i}`)) i++;
  return `${name}${i}`;
}

/**
 * Recursive editor for one schema value. Each node renders a single header row
 * (`leading` name/handle · type · `flags` · nullability · description · advanced), then its children
 * (array items / object props) BELOW, indented one small fixed step — so depth
 * never eats the control columns. `mutate` targets THIS node; children compose it.
 *
 * `mutate` also receives the doc root, so a node can touch `components.schemas`
 * (used by "extract to model") in the SAME update — two updates would race, since
 * each clones the doc from its own render.
 * `rootSchema` marks the top node of a named schema, where extract makes no sense.
 */
export function SchemaNode({
  node,
  names,
  selfName,
  mutate,
  onNavigate,
  leading,
  flags,
  trailing,
  nameHint,
  rootSchema = false,
}: {
  node: Doc;
  names: string[];
  selfName?: string;
  mutate: (fn: (n: Doc, root: Doc) => void) => void;
  onNavigate?: (name: string) => void; // jump to a $ref target's schema
  leading?: ReactNode;
  flags?: ReactNode; // toggles the PARENT owns (required lives in its `required` array), shown before nullability
  trailing?: ReactNode;
  nameHint?: string;
  rootSchema?: boolean;
}) {
  const { t } = useTranslation();
  const [adv, setAdv] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const ty = nodeType(node);
  const refTarget = (node.$ref ?? '').replace(SCHEMAS_REF, '');
  const refFallback = names.find((x) => x !== selfName) ?? selfName ?? 'NewSchema';

  const isComposition = (COMPOSITION as readonly string[]).includes(ty);

  const setType = (type: string) =>
    mutate((n) => {
      const nullable = isNullable(n);
      if (type === '$ref') resetTo(n, { $ref: `${SCHEMAS_REF}${refFallback}` });
      else if (type === 'array') resetTo(n, { type: 'array', items: { type: 'string' } });
      else if (type === 'object') resetTo(n, { type: 'object', properties: {} });
      else if ((COMPOSITION as readonly string[]).includes(type)) resetTo(n, { [type]: [{ type: 'string' }] });
      else resetTo(n, { type });
      if (nullable && type !== '$ref') setNullable(n, true); // keep nullability across a type change (no-op for composition)
    });

  const isScalar = ty !== 'object' && ty !== 'array' && ty !== '$ref' && !isComposition;
  const hasChildren = ty === 'object' || ty === 'array' || isComposition;

  const description = typeof node.description === 'string' ? node.description : '';
  const format = typeof node.format === 'string' ? node.format : '';
  const enumArr: unknown[] = Array.isArray(node.enum) ? node.enum : [];
  const advActive = isScalar && (!!format || node.example !== undefined || enumArr.length > 0);

  const setDesc = (v: string) =>
    mutate((n) => {
      if (v) n.description = v;
      else delete n.description;
    });

  const extractSchema = () =>
    mutate((n, root) => {
      const model = cloneNode(n);
      root.components ??= {};
      root.components.schemas ??= {};
      const name = uniqueSchemaName(Object.keys(root.components.schemas), nameHint ?? 'Schema');
      root.components.schemas[name] = model;
      resetTo(n, { $ref: `${SCHEMAS_REF}${name}` });
    });

  // No min-w-0 on the node or the row: the name and description columns must hold their floor and
  // overflow into the card's horizontal scroll instead of collapsing to nothing on a narrow window.
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {hasChildren ? (
          <button
            type="button"
            aria-label="toggle-collapse"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-faint hover:text-text"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        {leading}
        <select
          aria-label="node-type"
          className={`${selectCls} shrink-0`}
          value={ty}
          onChange={(e) => setType(e.target.value)}
        >
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        {ty === '$ref' && (
          <>
            <select
              aria-label="node-ref"
              className={`${selectCls} min-w-[9rem] max-w-[16rem] font-mono`}
              value={(node.$ref ?? '').replace(SCHEMAS_REF, '')}
              onChange={(e) => mutate((n) => resetTo(n, { $ref: `${SCHEMAS_REF}${e.target.value}` }))}
            >
              {names.length === 0 && <option value="">—</option>}
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {onNavigate && names.includes(refTarget) && (
              <button
                type="button"
                aria-label="goto-schema"
                title={t('gotoSchema', { name: refTarget })}
                onClick={() => onNavigate(refTarget)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-text"
              >
                <ArrowUpRight size={14} />
              </button>
            )}
          </>
        )}
        {flags}
        {ty !== '$ref' && !isComposition && (
          <label className="flex shrink-0 items-center gap-1 text-[12px] text-muted" title={t('fNullableHint')}>
            <input
              type="checkbox"
              aria-label="node-nullable"
              checked={isNullable(node)}
              onChange={(e) => mutate((n) => setNullable(n, e.target.checked))}
            />
            {t('fNullable')}
          </label>
        )}
        <Input
          aria-label="node-description"
          className="h-7 min-w-[10rem] flex-1 text-[12px]"
          placeholder={t('fDescription')}
          value={description}
          onChange={(e) => setDesc(e.target.value)}
        />
        {/* Everything behind the toggle (format/example/enum) is scalar-only. */}
        {isScalar && (
          <button
            type="button"
            aria-label="toggle-advanced"
            aria-expanded={adv}
            title={t('advanced')}
            onClick={() => setAdv((v) => !v)}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-raised ${
              adv || advActive ? 'text-brand' : 'text-faint hover:text-text'
            }`}
          >
            <SlidersHorizontal size={13} />
          </button>
        )}
        {ty === 'object' && !rootSchema && (
          <button
            type="button"
            aria-label="extract-schema"
            title={t('extractSchema')}
            onClick={extractSchema}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-text"
          >
            <PackagePlus size={14} />
          </button>
        )}
        {trailing && <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">{trailing}</div>}
      </div>

      {adv && isScalar && <ScalarAdvancedPanel node={node} ty={ty} mutate={mutate} />}

      {!collapsed && (
        <>
          {ty === 'array' && (
            <div className="border-l border-border pl-3">
              <SchemaNode
                node={node.items ?? { type: 'string' }}
                names={names}
                selfName={selfName}
                onNavigate={onNavigate}
                leading={<span className="shrink-0 text-[12px] text-faint">{t('arrayItemsOf')}</span>}
                mutate={(fn) => mutate((n, root) => fn((n.items ??= { type: 'string' }), root))}
              />
            </div>
          )}

          {ty === 'object' && (
            <ObjectPropertiesEditor
              node={node}
              names={names}
              selfName={selfName}
              onNavigate={onNavigate}
              mutate={mutate}
            />
          )}

          {isComposition && (
            <CompositionEditor
              node={node}
              ty={ty}
              names={names}
              selfName={selfName}
              onNavigate={onNavigate}
              mutate={mutate}
            />
          )}
        </>
      )}
    </div>
  );
}
