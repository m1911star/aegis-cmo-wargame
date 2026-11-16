import React from 'react';
import { Box } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';

interface InspectorTacviewCardProps {
  anchorLabel: string;
}

export const InspectorTacviewCard: React.FC<InspectorTacviewCardProps> = ({ anchorLabel }) => {
  const tacview3dOpen = useWargameStore((s) => s.tacview3dOpen);
  const toggleTacview3d = useWargameStore((s) => s.toggleTacview3d);

  return (
    <button
      type="button"
      onClick={() => toggleTacview3d()}
      className={`w-full px-2.5 py-2 rounded-lg border flex items-center justify-between text-[11px] font-medium transition-colors cursor-pointer ${
        tacview3dOpen
          ? 'border-cyan-400/55 bg-cyan-500/15 text-cyan-200'
          : 'border-cyan-500/25 bg-slate-950/60 text-cyan-300/90 hover:bg-cyan-500/10'
      }`}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <Box className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span className="truncate">
          {tacview3dOpen ? `正在独立视窗追踪: ${anchorLabel}` : '打开独立 3D 空海剖面视窗'}
        </span>
      </span>
      <span className="text-[10px] font-mono text-cyan-400/90 shrink-0 ml-2">
        {tacview3dOpen ? '已开启' : '120km'}
      </span>
    </button>
  );
};
