import React, { useState } from 'react';
import { ChartColumn, Check, Download } from 'lucide-react';
import { summarizeAar } from '../../engine/aar';
import { captureShareableAarPackage } from '../../store/battleRecording';
import { useWargameStore } from '../../store/useWargameStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ModalHeader, ModalShell } from '../ui/dialog';

const OUTCOME_BADGES = {
  hit: '命中受损',
  destroy: '击毁摧毁',
  intercept: '末端拦截',
  softkill: '软杀伤诱骗',
  miss: '末段脱靶',
} as const;

export const AarDebriefModal: React.FC = () => {
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const catalog = useWargameStore((s) => s.catalog);
  const units = useWargameStore((s) => s.units);
  const aar = useWargameStore((s) => s.aar);
  const battleResult = useWargameStore((s) => s.battleResult);
  const playMode = useWargameStore((s) => s.playMode);
  const [exported, setExported] = useState(false);
  const aarSummary = summarizeAar(aar);

  const exportShareableReport = () => {
    const pkg = captureShareableAarPackage();
    const json = JSON.stringify(pkg, null, 2);
    if (typeof document !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${pkg.scenarioId}_aar_tick${pkg.tick}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  return (
    <ModalShell className="max-w-4xl max-h-[90dvh] flex flex-col">
      <ModalHeader
        icon={<ChartColumn className="w-4 h-4 text-amber-300" />}
        title="AFTER ACTION REVIEW // 战斗复盘与单发战果拆解"
        onClose={() => setActiveModal('none')}
        actions={(battleResult || playMode === 'sandbox') && (
          <Button size="sm" variant="outline" onClick={exportShareableReport} className="text-cyan-300">
            {exported ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Download className="w-3.5 h-3.5" />}
            <span>{exported ? '已导出战报包' : '导出可分享战报包'}</span>
          </Button>
        )}
      />
      {!battleResult && playMode !== 'sandbox' ? (
        <div className="p-6 text-sm text-amber-200">完整真值 AAR 仅在战后或显式沙盒模式开放。</div>
      ) : (
        <div className="p-4 space-y-4 text-xs overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            {(['RED', 'BLUE'] as const).map((side) => {
              const stats = aarSummary[side];
              return (
                <section key={side} className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-2">
                  <h3 className={side === 'RED' ? 'text-rose-300 font-semibold' : 'text-sky-300 font-semibold'}>{side} FORCE</h3>
                  <div className="grid grid-cols-3 gap-2 text-foreground/90 font-mono tabular-nums">
                    <span>发射 {stats.launches}</span><span>命中 {stats.hits}</span><span>命中率 {(stats.hitRate * 100).toFixed(1)}%</span>
                    <span>拦截 {stats.interceptions}</span><span>损失 {stats.losses}</span><span>出动/回收 {stats.sorties}/{stats.recoveries}</span>
                  </div>
                </section>
              );
            })}
          </div>
          <section className="p-3.5 rounded-lg bg-muted/35 border border-border">
            <h3 className="text-primary font-semibold mb-2">弹药消耗</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-foreground/90 font-mono tabular-nums">
              {aarSummary.weaponUsage.length === 0 ? <span className="text-muted-foreground">尚无发射记录</span> :
                aarSummary.weaponUsage.map(([weaponId, count]) => (
                  <span key={weaponId}>{catalog.weapons[weaponId]?.codeName ?? weaponId}: {count}</span>
                ))}
            </div>
          </section>
          <section className="p-3.5 rounded-lg bg-muted/35 border border-border">
            <h3 className="text-primary font-semibold mb-2">单发战果与战役事件时间线 ({aar.events.length})</h3>
            {aar.events.length === 0 ? (
              <p className="text-muted-foreground">暂无交战事件记录</p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1">
                {aar.events.slice(-80).reverse().map((event) => (
                  <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-background/60 border border-border/50 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground font-mono">T+{event.tick}</span>
                      <span className={event.side === 'RED' ? 'text-rose-300 font-semibold' : 'text-sky-300 font-semibold'}>{event.side}</span>
                      <span className="text-foreground truncate">{event.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      {event.shooterId && (
                        <span className="text-cyan-300">射手: {units[event.shooterId]?.callsign ?? event.shooterId}</span>
                      )}
                      {event.targetUnitId && (
                        <span className="text-amber-300">目标: {units[event.targetUnitId]?.callsign ?? event.targetUnitId}</span>
                      )}
                      {event.outcome && (
                        <Badge variant="warning">
                          {OUTCOME_BADGES[event.outcome]}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="p-3.5 rounded-lg bg-muted/35 border border-border">
            <h3 className="text-primary font-semibold mb-2">完整航迹账本</h3>
            <p className="text-muted-foreground mb-2">{aarSummary.trackedUnits} 个单位 · {aarSummary.trackSamples} 个固定采样点（战斗中不向指挥视角揭示敌方真值）</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 text-foreground/90 font-mono tabular-nums">
              {[...new Set(aar.tracks.map((sample) => sample.unitId))].map((unitId) => (
                <span key={unitId}>{units[unitId]?.callsign ?? unitId}: {aar.tracks.filter((sample) => sample.unitId === unitId).length} 点</span>
              ))}
            </div>
          </section>
        </div>
      )}
    </ModalShell>
  );
};
