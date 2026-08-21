import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-8 w-full rounded-md border border-border bg-bg px-2.5 text-[14px] text-text outline-none placeholder:text-faint focus:border-brand',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
