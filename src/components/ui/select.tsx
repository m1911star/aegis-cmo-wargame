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
  /** For an action-like value that already names the trigger (e.g. a command seat). */
  nameFromValue?: boolean;
  children?: React.ReactNode;
}

function extractOptions(children: React.ReactNode, disabled = false): SelectOptionItem[] {
  const items: SelectOptionItem[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      items.push(...extractOptions((child.props as { children?: React.ReactNode }).children, disabled));
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
        disabled: disabled || Boolean(props.disabled),
      });
    } else if (child.type === 'optgroup') {
      const group = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>;
      items.push(...extractOptions(group.children, disabled || Boolean(group.disabled)));
    }
  });
  return items;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, nameFromValue, children, value, defaultValue, onChange, disabled, title, 'aria-label': ariaLabel, ...props }, ref) => {
    const [open, setOpen] = React.useState(false);
    const [activeIndex, setActiveIndex] = React.useState(-1);
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
    const uid = React.useId();
    const menuId = `${uid}-options`;
    const labelId = `${uid}-label`;
    const valueId = `${uid}-value`;
    const optionId = (index: number) => `${menuId}-${index}`;

    const setMergedRef = React.useCallback(
      (el: HTMLSelectElement | null) => {
        nativeRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLSelectElement | null>).current = el;
      },
      [ref]
    );

    const options = React.useMemo(() => extractOptions(children), [children]);
    const desiredValue = value !== undefined ? String(value) : uncontrolledValue;
    const selectedIndex = options.findIndex((opt) => opt.value === desiredValue);
    const selectedOption = options[selectedIndex] ?? options.find((opt) => !opt.disabled);
    const expanded = open && !disabled;
    const activeId = options[activeIndex] && !options[activeIndex].disabled ? optionId(activeIndex) : undefined;

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

    const findEnabled = (start: number, direction: 1 | -1) => {
      for (let i = start; i >= 0 && i < options.length; i += direction) {
        if (!options[i].disabled) return i;
      }
      return -1;
    };

    const openMenu = (direction: 1 | -1 = 1) => {
      if (disabled) return;
      updatePosition();
      setActiveIndex(
        selectedIndex >= 0 && !options[selectedIndex].disabled
          ? selectedIndex : findEnabled(direction === 1 ? 0 : options.length - 1, direction)
      );
      setOpen(true);
    };

    const closeMenu = (restoreFocus = false) => {
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    };

    React.useLayoutEffect(() => {
      if (expanded) menuRef.current?.focus({ preventScroll: true });
    }, [expanded]);

    React.useLayoutEffect(() => {
      if (expanded && activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
    }, [expanded, activeId]);

    React.useEffect(() => {
      if (disabled) setOpen(false);
    }, [disabled]);

    React.useEffect(() => {
      if (!expanded) return;
      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as Node;
        if (
          triggerRef.current?.contains(target) ||
          menuRef.current?.contains(target)
        ) {
          return;
        }
        setOpen(false);
      };

      const handleScrollOrResize = (event: Event) => {
        if (event.type === 'scroll' && menuRef.current?.contains(event.target as Node)) {
          return;
        }
        updatePosition();
      };

      document.addEventListener('pointerdown', handlePointerDown);
      window.addEventListener('resize', handleScrollOrResize);
      window.addEventListener('scroll', handleScrollOrResize, true);
      return () => {
        document.removeEventListener('pointerdown', handlePointerDown);
        window.removeEventListener('resize', handleScrollOrResize);
        window.removeEventListener('scroll', handleScrollOrResize, true);
      };
    }, [expanded, updatePosition]);

    const handleSelectOption = (index: number) => {
      const option = options[index];
      const native = nativeRef.current;
      if (disabled || !option || option.disabled || !native) return;
      closeMenu(true);
      native.value = option.value;
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const handleMenuKeyDown = (event: React.KeyboardEvent) => {
      if (event.key === 'Tab') {
        // Continue sequential navigation from the trigger in its DOM order, not from the portal.
        // The dialog's Tab handler also sees the trigger as the active control for wraparound.
        closeMenu(true);
        return;
      }
      let nextIndex = -1;
      switch (event.key) {
        case 'Escape':
          closeMenu(true);
          break;
        case 'Enter':
        case ' ':
          if (!event.repeat) handleSelectOption(activeIndex);
          break;
        case 'ArrowDown':
          nextIndex = findEnabled(activeIndex + 1, 1);
          break;
        case 'ArrowUp':
          nextIndex = findEnabled(activeIndex < 0 ? options.length - 1 : activeIndex - 1, -1);
          break;
        case 'Home':
          nextIndex = findEnabled(0, 1);
          break;
        case 'End':
          nextIndex = findEnabled(options.length - 1, -1);
          break;
        default: {
          if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
          const prefix = event.key.toLocaleLowerCase();
          for (let offset = 1; offset <= options.length; offset++) {
            const i = (activeIndex + offset) % options.length;
            if (!options[i].disabled && options[i].label.toLocaleLowerCase().startsWith(prefix)) {
              nextIndex = i;
              break;
            }
          }
        }
      }
      event.preventDefault();
      event.stopPropagation();
      if (nextIndex >= 0) setActiveIndex(nextIndex);
    };

    return (
      <>
        <select
          ref={setMergedRef}
          aria-label={ariaLabel}
          value={value}
          defaultValue={value === undefined ? defaultValue : undefined}
          onChange={(event) => {
            if (value === undefined) setUncontrolledValue(event.currentTarget.value);
            onChange?.(event);
          }}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only pointer-events-none"
          {...props}
          onFocus={(event) => {
            props.onFocus?.(event);
            triggerRef.current?.focus();
          }}
        >
          {children}
        </select>

        {/* The trigger announces field context plus its value. The form element keeps its own label and id. */}
        {ariaLabel && <span hidden id={labelId} title={ariaLabel} />}
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          title={title ?? selectedOption?.label}
          aria-labelledby={ariaLabel && !nameFromValue ? `${labelId} ${valueId}` : valueId}
          aria-describedby={ariaLabel && nameFromValue ? labelId : undefined}
          aria-expanded={expanded}
          aria-haspopup="listbox"
          aria-controls={expanded ? menuId : undefined}
          onClick={() => expanded ? closeMenu(true) : openMenu()}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            openMenu(event.key === 'ArrowDown' ? 1 : -1);
          }}
          className={cn(
            'relative flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-secondary/80 px-2.5 text-left text-xs text-foreground shadow-xs transition-colors cursor-pointer hover:bg-accent hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
            wrapperClassName,
            className
          )}
        >
          <span id={valueId} className="min-w-0 flex-1 truncate">{selectedOption?.label ?? '未选择'}</span>
          <ChevronDown aria-hidden="true" className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150', expanded && 'rotate-180')} />
        </button>

        {expanded && createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="listbox"
            aria-labelledby={ariaLabel ? labelId : valueId}
            aria-activedescendant={activeId}
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== triggerRef.current) closeMenu();
            }}
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
            {options.map((opt, index) => {
              const isSelected = opt === selectedOption;
              return (
                <button
                  key={index}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  disabled={opt.disabled}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelectOption(index)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                    isSelected
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-popover-foreground/90 hover:bg-accent/70 hover:text-accent-foreground',
                    activeIndex === index && 'ring-1 ring-inset ring-ring'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  <Check aria-hidden="true" className={cn('h-3.5 w-3.5 shrink-0 text-foreground', isSelected ? 'opacity-100' : 'opacity-0')} />
                </button>
              );
            })}
          </div>,
          // In a modal, keep the popup in the real dialog subtree as well as the React subtree.
          triggerRef.current?.closest('[role="dialog"], dialog') ?? document.body
        )}
      </>
    );
  }
);
Select.displayName = 'Select';
