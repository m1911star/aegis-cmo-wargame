import React from 'react';
import { X } from 'lucide-react';
import { summarizeAar } from '../../engine/aar';
import { useWargameStore } from '../../store/useWargameStore';

export const AarDebriefModal: React.FC = () => {
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const catalog = useWargameStore((s) => s.catalog);
  const units = useWargameStore((s) => s.units);
  const aar = useWargameStore((s) => s.aar);
  const battleResult = useWargameStore((s) => s.battleResult);
  const playMode = useWargameStore((s) => s.playMode);
  const aarSummary = summarizeAar(aar);

  return (
    <div className="w-full max-w-4xl max-h-[90dvh] tactical-panel rounded-lg border border-amber-400/50 overflow-y-auto">
      <div className="px-4 py-3 bg-amber-950/40 border-b border-amber-500/30 flex items-center justify-between">
        <div className="text-amber-300 font-bold text-sm">AFTER ACTION REVIEW // 战斗复盘</div>
        <button onClick={() => setActiveModal('none')} className="text-slate-400 hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      {!battleResult && playMode !== 'sandbox' ? (
        <div className="p-6 text-sm text-amber-200">完整真值 AAR 仅在战后或显式沙盒模式开放。</div>
      ) : (
        <div className="p-4 space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            {(['RED', 'BLUE'] as const).map((side) => {
              const stats = aarSummary[side];
              return (
                <section key={side} className="p-3 rounded bg-slate-950/80 border border-slate-700 space-y-2">
                  <h3 className={side === 'RED' ? 'text-rose-300 font-bold' : 'text-sky-300 font-bold'}>{side} FORCE</h3>
                  <div className="grid grid-cols-3 gap-2 text-slate-300">
                    <span>发射 {stats.launches}</span><span>命中 {stats.hits}</span><span>命中率 {(stats.hitRate * 100).toFixed(1)}%</span>
                    <span>拦截 {stats.interceptions}</span><span>损失 {stats.losses}</span><span>出动/回收 {stats.sorties}/{stats.recoveries}</span>
                  </div>
                </section>
              );
            })}
          </div>
          <section className="p-3 rounded bg-slate-950/80 border border-slate-700">
            <h3 className="text-cyan-300 font-bold mb-2">弹药消耗</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-slate-300">
              {aarSummary.weaponUsage.length === 0 ? <span className="text-slate-500">尚无发射记录</span> :
                aarSummary.weaponUsage.map(([weaponId, count]) => (
                  <span key={weaponId}>{catalog.weapons[weaponId]?.codeName ?? weaponId}: {count}</span>
                ))}
            </div>
          </section>
          <section className="p-3 rounded bg-slate-950/80 border border-slate-700">
            <h3 className="text-cyan-300 font-bold mb-2">完整航迹账本</h3>
            <p className="text-slate-400 mb-2">{aarSummary.trackedUnits} 个单位 · {aarSummary.trackSamples} 个固定采样点（战斗中不向指挥视角揭示敌方真值）</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-slate-300">
              {[...new Set(aar.tracks.map((sample) => sample.unitId))].map((unitId) => (
                <span key={unitId}>{units[unitId]?.callsign ?? unitId}: {aar.tracks.filter((sample) => sample.unitId === unitId).length} 点</span>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
