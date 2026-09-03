import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

/** The one indeterminate-progress mark. Decorative: the host element carries `aria-busy`. */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} aria-hidden className={cn('shrink-0 animate-spin', className)} />;
}
