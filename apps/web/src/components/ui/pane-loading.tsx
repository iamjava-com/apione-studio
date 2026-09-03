import { cn } from '../../lib/utils';
import { Delayed } from './delayed';
import { Spinner } from './spinner';

/** A whole pane's loading state: fills the parent, one centered mark after the flash threshold. */
export function PaneLoading({ className = 'h-full' }: { className?: string }) {
  return (
    <div aria-busy className={cn('flex items-center justify-center text-faint', className)}>
      <Delayed>
        <Spinner size={18} />
      </Delayed>
    </div>
  );
}
