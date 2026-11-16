import React, { useEffect, useRef, useState } from 'react';
import { GripHorizontal, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import type { TacticalBoxSlice } from '../../tacview3d/boxSlice';
import type { ProjectedHudLabel, ThreeBoxSceneController } from '../../tacview3d/ThreeBoxScene';
import { ThreeBoxSceneController as ControllerClass } from '../../tacview3d/ThreeBoxScene';

interface LocalAirSeaBox3DProps {
  slice: TacticalBoxSlice;
  heightClassName?: string;
  isExpandedSize?: boolean;
  onToggleExpandedSize?: () => void;
  onHeaderPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onClose?: () => void;
}

const SCALE_PRESETS = {
  balanced: { label: '均衡 4x/60x', airScale: 4, subScale: 60 },
  macro: { label: '高空 8x/80x', airScale: 8, subScale: 80 },
  true: { label: '真实 1x/10x', airScale: 1, subScale: 10 },
} as const;

type ScalePresetKey = keyof typeof SCALE_PRESETS;

export const LocalAirSeaBox3D: React.FC<LocalAirSeaBox3DProps> = ({
  slice,
  heightClassName = 'h-[300px]',
  isExpandedSize = false,
  onToggleExpandedSize,
  onHeaderPointerDown,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<ThreeBoxSceneController | null>(null);
  const [scalePreset, setScalePreset] = useState<ScalePresetKey>('balanced');
  const [labels, setLabels] = useState<ProjectedHudLabel[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const controller = new ControllerClass(el, setLabels);
    controllerRef.current = controller;

    const ro = new ResizeObserver(() => controller.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const preset = SCALE_PRESETS[scalePreset];
    controller.setScales({ airScale: preset.airScale, subScale: preset.subScale });
    controller.updateSlice(slice);
  }, [slice, scalePreset]);

  return (
    <div className="relative w-full rounded-lg border border-cyan-500/40 bg-[#040813]/95 shadow-2xl overflow-hidden select-none backdrop-blur-xs">
      <div
        onPointerDown={onHeaderPointerDown}
        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-white/10 bg-slate-950/95 text-[11px] ${
          onHeaderPointerDown ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        <div className="min-w-0 flex items-center gap-1.5 flex-1">
          {onHeaderPointerDown && <GripHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
          <span className="font-semibold text-cyan-200 truncate">
            3D 空海剖面 // {slice.anchorLabel}
          </span>
          <span className="text-slate-400 font-mono text-[10px] shrink-0">R={slice.radiusKm}km</span>
        </div>
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="flex items-center gap-1 shrink-0"
        >
          <select
            aria-label="3D 垂直夸张比例"
            value={scalePreset}
            onChange={(e) => setScalePreset(e.target.value as ScalePresetKey)}
            className="bg-slate-900 border border-white/15 rounded px-1.5 py-0.5 text-[10px] text-slate-200 outline-none cursor-pointer"
          >
            {Object.entries(SCALE_PRESETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="重置 3D 视角"
            onClick={() => controllerRef.current?.resetCamera()}
            className="p-1 rounded hover:bg-white/10 text-slate-300 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          {onToggleExpandedSize && (
            <button
              type="button"
              title={isExpandedSize ? '恢复标准视窗' : '放大 3D 视窗'}
              onClick={onToggleExpandedSize}
              className="p-1 rounded hover:bg-white/10 text-cyan-300 cursor-pointer"
            >
              {isExpandedSize ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              aria-label="关闭 3D 视窗"
              onClick={onClose}
              className="px-1.5 py-0.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-200 cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div ref={containerRef} className={`relative w-full ${heightClassName}`}>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {labels.map((lbl) => {
            const colorClass =
              lbl.side === 'RED'
                ? 'text-rose-300 border-rose-500/40'
                : lbl.side === 'BLUE'
                  ? 'text-sky-300 border-sky-500/40'
                  : lbl.side === 'SYSTEM'
                    ? 'text-emerald-300 border-emerald-500/40'
                    : 'text-amber-300 border-amber-500/40';
            return (
              <div
                key={lbl.id}
                style={{
                  transform: `translate3d(${Math.round(lbl.x)}px, ${Math.round(lbl.y)}px, 0) translate(-50%, -100%)`,
                }}
                className={`absolute top-0 left-0 px-1 py-0.2 rounded bg-slate-950/80 border text-[9px] font-mono leading-tight whitespace-nowrap ${colorClass} ${
                  lbl.isAnchor ? 'ring-1 ring-amber-300/70' : ''
                }`}
              >
                <span>{lbl.text}</span>
                {lbl.subText && <span className="ml-1 opacity-75">{lbl.subText}</span>}
              </div>
            );
          })}
        </div>

        <div className="pointer-events-none absolute bottom-1.5 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-2 text-[9px] font-mono text-slate-400">
          <div className="flex flex-wrap gap-2.5">
            <span>海平面 0m</span>
            <span className="text-sky-400/90">温跃层 {slice.thermocline.upperDepthM}m~{slice.thermocline.lowerDepthM}m</span>
            {slice.clouds && slice.clouds.condition !== 'clear' && (
              <span className="text-slate-300">云层 {slice.clouds.floorM}~{slice.clouds.ceilingM}m</span>
            )}
            {slice.ridges.length > 0 && (
              <span className="text-amber-400">山脊 {slice.ridges.length} 处</span>
            )}
          </div>
          <span className="text-slate-500">左键旋转 · 滚轮缩放 · 右键平移</span>
        </div>
      </div>
    </div>
  );
};

export default LocalAirSeaBox3D;
