import { cn } from '../../lib/utils';

/** The standard inline error line; renders nothing while there is no error. */
export function ErrorText({ error, className }: { error: string | null; className?: string }) {
  if (!error) return null;
  return <p className={cn('text-[13px] text-delete', className)}>{error}</p>;
}
