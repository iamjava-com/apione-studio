import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
import { Spinner } from './spinner';

const iconButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded text-faint transition disabled:pointer-events-none aria-busy:opacity-100',
  {
    variants: {
      tone: { default: 'hover:text-text', danger: 'hover:text-delete' },
      size: { sm: 'p-0.5', md: 'p-1' },
    },
    defaultVariants: { tone: 'default', size: 'md' },
  },
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  /** The icon is the whole label, so the accessible name is not optional. */
  'aria-label': string;
  /** The action this button fired is in flight: disabled, and the icon gives way to the mark. */
  busy?: boolean;
}

/** A quiet, icon-only row action (delete, duplicate, rename). For a toolbar button use
 *  `Button size="icon"`. Callers that reveal it on hover add the `opacity-0 group-hover:…`
 *  pair themselves; a busy one stays visible regardless. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, tone, size, busy, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(iconButtonVariants({ tone, size }), className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <Spinner size={size === 'sm' ? 13 : 14} /> : children}
    </button>
  ),
);
IconButton.displayName = 'IconButton';
