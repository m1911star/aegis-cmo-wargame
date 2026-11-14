import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SelectOptionItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  wrapperClassName?: string;
  children?: React.ReactNode;
}

function extractOptions(children: React.ReactNode): SelectOptionItem[] {
  const items: SelectOptionItem[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      items.push(...extractOptions((child.props as { children?: React.ReactNode }).children));
      return;
    }
    if (child.type === 'option') {
      const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
      const rawText = React.Children.toArray(props.children)
        .map((node) => (typeof node === 'string' || typeof node === 'number' ? String(node) : ''))
        .join('');
      const value = props.value !== undefined ? String(props.value) : rawText;
      items.push({
        value,
        label: rawText || value,
        disabled: Boolean(props.disabled),
      });
    } else if (child.type === 'optgroup') {
      items.push(...extractOptions((child.props as { children?: React.ReactNode }).children));
    }
  });
  return items;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, children, value, defaultValue, onChange, disabled, title, 'aria-label': ariaLabel, ...props }, ref) => {
    const [open, setOpen] = React.useState(false);
    const [uncontrolledValue, setUncontrolledValue] = React.useState(() =>
      defaultValue !== undefined ? String(defaultValue) : ''
    );
    const [coords, setCoords] = React.useState<{
      top: number;
      left: number;
      width: number;
      openUp: boolean;
    }>({ top: 0, left: 0, width: 160, openUp: false });

    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const menuRef = React.useRef<HTMLDivElement>(null);
    const nativeRef = React.useRef<HTMLSelectElement | null>(null);

    const setMergedRef = React.useCallback(
      (el: HTMLSelectElement | null) => {
        nativeRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLSelectElement | null>).current = el;
      },
      [ref]
    );

    const options = React.useMemo(() => extractOptions(children), [children]);
    const currentValue = value !== undefined ? String(value) : uncontrolledValue;
    const selectedOption =
      options.find((opt) => opt.value === currentValue) ?? options[0];

    const updatePosition = React.useCallback(() => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const estimatedMenuHeight = Math.min(248, options.length * 32 + 10);
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
      const width = Math.max(rect.width, 136);
      const maxLeft = Math.max(8, window.innerWidth - width - 8);
      const left = Math.min(rect.left, maxLeft);
      setCoords({
        top: openUp ? rect.top - 4 : rect.bottom + 4,
        left,
        width,
        openUp,
      });
    }, [options.length]);

    React.useEffect(() => {
      if (!open) return;
      updatePosition();

      const handlePointerDown = (event: MouseEvent) => {
        const target = event.target as Node;
        if (
          triggerRef.current?.contains(target) ||
          menuRef.current?.contains(target)
        ) {
          return;
        }
        setOpen(false);
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      };

      const handleScrollOrResize = (event: Event) => {
        if (event.type === 'scroll' && menuRef.current?.contains(event.target as Node)) {
          return;
        }
        updatePosition();
      };

      document.addEventListener('mousedown', handlePointerDown);
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('resize', handleScrollOrResize);
      window.addEventListener('scroll', handleScrollOrResize, true);
      return () => {
        document.removeEventListener('mousedown', handlePointerDown);
        document.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('resize', handleScrollOrResize);
        window.removeEventListener('scroll', handleScrollOrResize, true);
      };
    }, [open, updatePosition]);

    const handleSelectOption = (nextValue: string) => {
      if (value === undefined) {
        setUncontrolledValue(nextValue);
      }
      if (nativeRef.current) {
        nativeRef.current.value = nextValue;
      }
      if (onChange) {
        const syntheticEvent = {
          target: { value: nextValue },
          currentTarget: { value: nextValue },
        } as React.ChangeEvent<HTMLSelectElement>;
        onChange(syntheticEvent);
      }
      setOpen(false);
      triggerRef.current?.focus();
    };

    return (
      <>
        <select
          ref={setMergedRef}
          aria-label={ariaLabel}
          value={value}
          defaultValue={value === undefined ? defaultValue : undefined}
          onChange={onChange}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only pointer-events-none"
          {...props}
        >
          {children}
        </select>

        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          title={title ?? selectedOption?.label}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => !disabled && setOpen((prev) => !prev)}
          className={cn(
            'relative flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-secondary/80 px-2.5 text-left text-xs text-foreground shadow-xs transition-colors cursor-pointer hover:bg-accent hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
            wrapperClassName,
            className
          )}
        >
          <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? ''}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-180')} />
        </button>

        {open && typeof document !== 'undefined' && createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: 'fixed',
              left: coords.left,
              top: coords.top,
              minWidth: coords.width,
              maxWidth: 'min(360px, calc(100vw - 16px))',
              transform: coords.openUp ? 'translateY(-100%)' : undefined,
            }}
            className="z-[120] max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-2xl backdrop-blur-xl"
          >
            {options.map((opt) => {
              const isSelected = opt.value === currentValue;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onClick={() => handleSelectOption(opt.value)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                    isSelected
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-popover-foreground/90 hover:bg-accent/70 hover:text-accent-foreground'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  <Check className={cn('h-3.5 w-3.5 shrink-0 text-foreground', isSelected ? 'opacity-100' : 'opacity-0')} />
                </button>
              );
            })}
          </div>,
          document.body
        )}
      </>
    );
  }
);
Select.displayName = 'Select';
