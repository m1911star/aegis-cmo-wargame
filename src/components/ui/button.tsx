import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 font-semibold',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 font-semibold',
        outline: 'border border-border bg-secondary/50 text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground hover:border-slate-600/80',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        success: 'bg-emerald-500 text-slate-950 shadow-xs hover:bg-emerald-400 font-semibold',
        warning: 'bg-amber-500 text-slate-950 shadow-xs hover:bg-amber-400 font-semibold',
        tactical: 'border border-cyan-500/35 bg-cyan-950/50 text-cyan-200 hover:bg-cyan-900/60 hover:border-cyan-400/60',
      },
      size: {
        default: 'h-8 px-3 py-1.5',
        sm: 'h-7 rounded-md px-2.5 text-[11px]',
        xs: 'h-6 rounded px-2 text-[10px]',
        icon: 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = 'Button';
