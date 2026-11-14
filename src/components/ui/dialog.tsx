import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModalShellProps {
  children: React.ReactNode;
  className?: string;
}

export const ModalShell: React.FC<ModalShellProps> = ({ children, className }) => (
  <div
    className={cn(
      'w-full rounded-xl border border-border bg-card/98 text-card-foreground shadow-2xl overflow-hidden backdrop-blur-xl',
      className
    )}
  >
    {children}
  </div>
);

interface ModalHeaderProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  icon,
  title,
  subtitle,
  onClose,
  closeLabel = '关闭',
  actions,
  className,
}) => (
  <div className={cn('flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3', className)}>
    <div className="flex items-center gap-2.5 min-w-0">
      {icon && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/70 text-primary">{icon}</div>}
      <div className="min-w-0">
        <div className="text-sm font-semibold tracking-tight text-foreground truncate">{title}</div>
        {subtitle && <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>}
      </div>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      {actions}
      {onClose && (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  </div>
);

export const ModalFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3', className)} {...props} />
);
