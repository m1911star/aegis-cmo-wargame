import * as React from 'react';
import { cn } from '../../lib/utils';

export const Separator: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div role="separator" className={cn('h-px w-full bg-border', className)} {...props} />
);
