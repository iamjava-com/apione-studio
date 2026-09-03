import { cn } from '../../lib/utils';
import { Delayed } from './delayed';

/** A placeholder block in the shape of the content on its way. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-raised', className)} />;
}

/** A list's first-load stand-in: `rows` rows of `height`, shown only past the flash threshold. */
export function SkeletonRows({
  rows = 3,
  height = 'h-9',
  className,
}: {
  rows?: number;
  height?: string;
  className?: string;
}) {
  return (
    <Delayed>
      <div aria-busy className={cn('space-y-2', className)}>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className={height} />
        ))}
      </div>
    </Delayed>
  );
}
