import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-tight whitespace-nowrap transition-colors',
  {
    variants: {
      variant: {
        default: 'border-cyan-500/35 bg-cyan-500/15 text-cyan-300',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground',
        destructive: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
        success: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
        warning: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
        red: 'border-rose-500/40 bg-rose-500/20 text-rose-200',
        blue: 'border-sky-500/40 bg-sky-500/20 text-sky-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge: React.FC<BadgeProps> = ({ className, variant, ...props }) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
);
