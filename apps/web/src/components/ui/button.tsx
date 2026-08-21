import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

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
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';
