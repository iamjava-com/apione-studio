import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STAGES, type Stage } from '../../api';
import { errorText } from '../../lib/errors';
import { cn } from '../../lib/utils';
import { HTTP_METHODS, OP_ID_KEY, selectCls } from './constants';
import { stageDotStyle, stageKey } from '../ui/stage-dot';
import { useStages } from '../OperationStages';
import type { Doc, UpdateFn } from './types';

/** Same shape the server mints, and checked against the document before it is used — an id two
 *  operations answer to identifies neither. */
const mintOpId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

function usedOpIds(doc: Doc): Set<string> {
  const used = new Set<string>();
  for (const item of Object.values(doc.paths ?? {}) as Doc[]) {
    for (const m of HTTP_METHODS) {
      const id = item?.[m]?.[OP_ID_KEY];
      if (typeof id === 'string' && id) used.add(id);
    }
  }
  return used;
}

/**
 * The endpoint's workflow stage.
 *
 * It saves on change, unlike every other field on this card — a stage is not in the document, so
 * there is no unsaved state for it to join and nothing for the save bar to carry. That difference
 * is why the picker sits apart from the fields, next to `deprecated`.
 *
 * An endpoint typed in but never saved has no id yet, and a stage has to be keyed to one. Rather
 * than make the author save first, the picker mints the id into the document then and there: the
 * save that follows carries it, exactly as if the server had minted it. Abandon the edit instead
 * and the row is left pointing at an operation the document never declared — which the next save
 * reconciles away.
 */
export function StagePicker({ p, m, op, update }: { p: string; m: string; op: Doc; update: UpdateFn }) {
  const { t } = useTranslation();
  const stages = useStages();
  const [error, setError] = useState<string | null>(null);
  if (!stages) return null;

  const opId = op[OP_ID_KEY] as string | undefined;
  const stage = stages.stageOf(opId);

  /** The operation's id, minting one into the document if it has none. Synchronous: `update`
   *  applies before it returns, so the id is real by the time the stage is sent against it. */
  const ensureOpId = (): string => {
    if (opId) return opId;
    let id = mintOpId();
    update((d) => {
      const used = usedOpIds(d);
      while (used.has(id)) id = mintOpId();
      d.paths[p][m][OP_ID_KEY] = id;
    });
    return id;
  };

  const change = async (next: Stage) => {
    setError(null);
    try {
      await stages.setStage(ensureOpId(), next);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="relative shrink-0" title={error ?? undefined}>
      <span
        aria-hidden
        className="pointer-events-none absolute left-2 top-1/2 z-10 size-2.5 -translate-y-1/2 rounded-full"
        style={stageDotStyle(stage)}
      />
      <select
        aria-label="op-stage"
        className={cn(selectCls, 'pl-7 font-sans', error && 'border-delete')}
        value={stage}
        onChange={(e) => void change(e.target.value as Stage)}
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {t(stageKey(s))}
          </option>
        ))}
      </select>
    </div>
  );
}
