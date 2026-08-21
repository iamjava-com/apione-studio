import { methodColor } from '../../lib/utils';

/** HTTP method chip in the domain's color vernacular (GET blue, POST green, …). */
export function MethodBadge({ method, className }: { method: string; className?: string }) {
  const c = methodColor(method);
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide ${className ?? ''}`}
      style={{ color: c, border: `1px solid ${c}`, background: `color-mix(in srgb, ${c} 12%, transparent)` }}
    >
      {method.toUpperCase()}
    </span>
  );
}
