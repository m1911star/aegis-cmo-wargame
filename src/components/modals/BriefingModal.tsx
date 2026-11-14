import React from 'react';
import { BookOpen, Play, X } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';

export const BriefingModal: React.FC = () => {
  const currentScenario = useWargameStore((s) => s.currentScenario);
  const objectives = useWargameStore((s) => s.objectives);
  const seed = useWargameStore((s) => s.seed);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const setTimeScale = useWargameStore((s) => s.setTimeScale);

  const durationMin = currentScenario.victoryConditions
    ? Math.round(currentScenario.victoryConditions.durationSec / 60)
    : 60;

  return (
    <div className="w-full max-w-2xl tactical-panel rounded-lg border border-cyan-400/50 overflow-hidden shadow-[0_0_50px_rgba(34,211,238,0.25)]">
      <div className="px-4 py-3 bg-cyan-950/50 border-b border-cyan-500/30 flex items-center justify-between">
        <div className="flex items-center gap-2 text-cyan-300 font-bold text-sm">
          <BookOpen className="w-4 h-4" />
          <span>OPERATIONAL BRIEFING // 战役想定简报</span>
        </div>
        <button
          aria-label="关闭简报"
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
          <div className="text-[11px] text-slate-300 mt-1 flex flex-wrap gap-3">
            <span>战区: {currentScenario.theater}</span>
            <span>难度: {currentScenario.difficulty}</span>
            <span>限时: {durationMin} 分钟</span>
            <span>目标数: {objectives.length} 项</span>
            <span>种子: {seed}</span>
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

        <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-2">
          免责声明：本系统中的装备参数、命中率与环境模型均为游戏化教学抽象，不构成现实装备效能评估，亦不用于实际导航或军事决策。
        </p>
      </div>

      <div className="px-4 py-3 bg-slate-950/90 border-t border-slate-800 flex justify-end gap-2">
        <button
          onClick={() => setActiveModal('none')}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs cursor-pointer"
        >
          先查看地图部署
        </button>
        <button
          onClick={() => {
            setTimeScale(5);
            setActiveModal('none');
          }}
          className="px-4 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer flex items-center gap-1.5"
        >
          <Play className="w-3.5 h-3.5" />
          <span>开始推演 (5×)</span>
        </button>
      </div>
    </div>
  );
};
