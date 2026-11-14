import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  trackClassName?: string;
  rangeClassName?: string;
}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, trackClassName, rangeClassName, min = 0, max = 100, value = 0, ...props }, ref) => {
    const numMin = Number(min);
    const numMax = Number(max);
    const numVal = Number(value);
    const pct = numMax > numMin ? Math.max(0, Math.min(100, ((numVal - numMin) / (numMax - numMin)) * 100)) : 0;

    return (
      <div className={cn('relative flex h-5 w-full items-center select-none', className)}>
        <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800', trackClassName)}>
          <div
            className={cn('h-full rounded-full bg-zinc-100', rangeClassName)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full border border-zinc-300 bg-zinc-950 shadow-md ring-1 ring-white/20"
          style={{ left: `${pct}%` }}
        />
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          value={value}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          {...props}
        />
      </div>
    );
  }
);
Slider.displayName = 'Slider';
