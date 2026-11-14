import React from 'react';
import { BookOpen, X } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';

export const BriefingModal: React.FC = () => {
  const currentScenario = useWargameStore((s) => s.currentScenario);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);

  return (
    <div className="w-full max-w-2xl tactical-panel rounded-lg border border-cyan-400/50 overflow-hidden shadow-[0_0_50px_rgba(34,211,238,0.25)]">
      <div className="px-4 py-3 bg-cyan-950/50 border-b border-cyan-500/30 flex items-center justify-between">
        <div className="flex items-center gap-2 text-cyan-300 font-bold text-sm">
          <BookOpen className="w-4 h-4" />
          <span>OPERATIONAL BRIEFING // 战役想定简报</span>
        </div>
        <button
          onClick={() => setActiveModal('none')}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 space-y-4 text-xs leading-relaxed max-h-[75vh] overflow-y-auto">
        <div>
          <div className="text-base font-bold text-cyan-300">
            {currentScenario.title}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {currentScenario.subtitle} · 战区: {currentScenario.theater}
          </div>
        </div>

        <div className="p-3 rounded bg-slate-950/90 border border-slate-800 space-y-1">
          <div className="text-amber-300 font-bold">【战场态势背景】</div>
          <p className="text-slate-300 whitespace-pre-line">
            {currentScenario.briefing.situation}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded bg-rose-950/25 border border-rose-500/35">
            <div className="text-rose-300 font-bold mb-1">
              【红方联指作战企图】
            </div>
            <p className="text-slate-300">
              {currentScenario.briefing.redObjective}
            </p>
          </div>
          <div className="p-3 rounded bg-sky-950/25 border border-sky-500/35">
            <div className="text-sky-300 font-bold mb-1">
              【蓝方联指作战企图】
            </div>
            <p className="text-slate-300">
              {currentScenario.briefing.blueObjective}
            </p>
          </div>
        </div>

        <div className="p-3 rounded bg-cyan-950/25 border border-cyan-500/30 space-y-1.5">
          <div className="text-cyan-300 font-bold">
            【CMO 核心机制与参谋操作要领】
          </div>
          <ul className="list-disc list-inside space-y-1 text-slate-300">
            {currentScenario.briefing.tacticalTips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="px-4 py-3 bg-slate-950/90 border-t border-slate-800 flex justify-end">
        <button
          onClick={() => setActiveModal('none')}
          className="px-4 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
        >
          进入指挥席位
        </button>
      </div>
    </div>
  );
};
