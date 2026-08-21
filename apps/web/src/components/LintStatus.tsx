import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import type { LintResult } from '../api';
import { HTTP_METHODS as METHOD_LIST } from './form/constants';

const HTTP_METHODS = new Set(METHOD_LIST);

// Turn a raw JSON Pointer (RFC 6901) into a readable trail — unescape ~1/~0 and lead
// with "METHOD /path" when it points inside paths, e.g.
//   #/paths/~1REPS0020/post/responses/200 → POST /REPS0020 › responses › 200
function humanizePointer(pointer: string | null): string | null {
  if (!pointer) return null;
  const segs = pointer
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (segs.length === 0) return null;
  // paths/{path}/{method}/… → lead with "METHOD /path"
  if (segs[0] === 'paths' && segs[2] && HTTP_METHODS.has(segs[2].toLowerCase())) {
    return [`${segs[2].toUpperCase()} ${segs[1]}`, ...segs.slice(3)].join(' › ');
  }
  // components/schemas/{name}/… → drop the components/schemas noise
  if (segs[0] === 'components' && segs.length >= 3) return segs.slice(2).join(' › ');
  return segs.join(' › ');
}

/**
 * Passive structural-health signal in the editor header: silent when the spec is
 * valid, a red chip that opens a list of problems when it isn't. Structural errors
 * (struct / unresolved $refs) break docs/mock/bundle, so they surface here rather
 * than in a standing sidebar tool.
 */
export function LintStatus({ lint }: { lint: LintResult | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!lint || lint.errorCount === 0) return null;

  return (
    <div className="relative">
      <button
        aria-label="lint-status"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-delete hover:bg-delete/10"
      >
        <AlertTriangle size={13} />
        {t('structErrors', { count: lint.errorCount })}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-80 space-y-1.5 overflow-auto rounded-md border border-border bg-surface p-2 shadow-lg">
            {lint.problems.map((p, i) => {
              const where = humanizePointer(p.location);
              return (
                <div key={i} className="rounded border-l-2 border-delete py-1 pl-2 text-[13px]">
                  <div className="text-text">{p.message}</div>
                  {where && (
                    <div className="truncate font-mono text-[11px] text-faint" title={p.location ?? ''}>
                      {where}
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-faint/70">{p.ruleId}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
