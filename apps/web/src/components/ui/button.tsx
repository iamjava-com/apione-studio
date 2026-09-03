import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
import { Spinner } from './spinner';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-[14px] font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        // One per view, primary action only — brass means nothing once it spreads.
        brand: 'bg-brand-solid text-on-brand hover:bg-brand-solid-hover',
        default: 'border border-border text-text hover:border-brand',
        ghost: 'text-muted hover:bg-raised hover:text-text',
      },
      size: { sm: 'h-7 px-2.5', md: 'h-8 px-3', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** The action this button fired is in flight: disabled, marked, and the label stays put so the
   *  button keeps its width. An icon button swaps its icon for the mark instead. */
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, busy, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...props}
      >
        {busy && <Spinner />}
        {!(busy && size === 'icon') && children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
