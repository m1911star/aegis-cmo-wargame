import React from 'react';
import { BookOpen, Play } from 'lucide-react';
import { BUILTIN_CAMPAIGN_WESTPAC } from '../../scenarios/campaign';
import { useWargameStore } from '../../store/useWargameStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ModalFooter, ModalHeader, ModalShell } from '../ui/dialog';

export const BriefingModal: React.FC = () => {
  const currentScenario = useWargameStore((s) => s.currentScenario);
  const catalog = useWargameStore((s) => s.catalog);
  const objectives = useWargameStore((s) => s.objectives);
  const seed = useWargameStore((s) => s.seed);
  const campaignState = useWargameStore((s) => s.campaignState);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const setTimeScale = useWargameStore((s) => s.setTimeScale);

  const durationMin = currentScenario.victoryConditions
    ? Math.round(currentScenario.victoryConditions.durationSec / 60)
    : 60;

  return (
    <ModalShell className="max-w-2xl">
      <ModalHeader
        icon={<BookOpen className="w-4 h-4" />}
        title="OPERATIONAL BRIEFING // 战役想定简报"
        onClose={() => setActiveModal('none')}
        closeLabel="关闭简报"
      />

      <div className="p-5 space-y-4 text-xs leading-relaxed max-h-[75vh] overflow-y-auto">
        <div>
          <div className="text-base font-semibold text-foreground">
            {currentScenario.title}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="secondary">战区: {currentScenario.theater}</Badge>
            <Badge variant="secondary">难度: {currentScenario.difficulty}</Badge>
            <Badge variant="secondary">限时: {durationMin} 分钟</Badge>
            <Badge variant="secondary">目标数: {objectives.length} 项</Badge>
            <Badge variant="outline" className="font-mono">种子: {seed}</Badge>
          </div>
        </div>

        {campaignState && (
          <div className="p-3.5 rounded-lg bg-amber-500/8 border border-amber-500/30 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-amber-300 font-semibold">
                【战役连贯进度与后勤继承账本 · 第 {campaignState.currentStageIndex + 1}/{campaignState.totalStages} 阶段】
              </span>
              <span className="text-[11px] font-mono text-cyan-300">
                战备 {Math.round(campaignState.carryover.readinessMultiplier * 100)}% · 累计 {campaignState.carryover.cumulativeScore} 分
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1 text-[10px]">
              {BUILTIN_CAMPAIGN_WESTPAC.stages.map((stage) => {
                const active = stage.stageIndex === campaignState.currentStageIndex;
                const done = stage.stageIndex < campaignState.currentStageIndex;
                return (
                  <div
                    key={stage.scenarioId}
                    className={`p-1.5 rounded border truncate ${
                      active
                        ? 'bg-amber-500/20 border-amber-400/60 text-amber-200 font-semibold'
                        : done
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-muted/30 border-border text-muted-foreground'
                    }`}
                    title={stage.title}
                  >
                    S{stage.stageIndex + 1} · {stage.title.split('：')[1] ?? stage.title}
                  </div>
                );
              })}
            </div>
            {campaignState.carryover.completedStages > 0 && (
              <div className="text-[11px] text-muted-foreground space-y-0.5 pt-1 border-t border-border/60">
                <div>
                  机库未补足战损折算：{campaignState.carryover.airframeAttritionDebt} 架次 · 主力平台带伤继承：
                  {Object.keys(campaignState.carryover.platformDamageDebt).length === 0
                    ? ' 无'
                    : ' ' +
                      Object.entries(campaignState.carryover.platformDamageDebt)
                        .map(([pid, d]) => `${catalog.platforms[pid]?.name ?? pid}(-${Math.round(d * 100)}%HP)`)
                        .join('、')}
                </div>
                <div>
                  稀缺防区外弹药未补缺口：
                  {Object.keys(campaignState.carryover.scarceAmmoDebt).length === 0
                    ? ' 满额充足'
                    : ' ' +
                      Object.entries(campaignState.carryover.scarceAmmoDebt)
                        .map(([wid, n]) => `${catalog.weapons[wid]?.codeName ?? wid}(-${n})`)
                        .join('、')}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="p-3.5 rounded-lg bg-muted/40 border border-border space-y-1.5">
          <div className="text-amber-300 font-semibold">【战场态势背景】</div>
          <p className="text-foreground/90 whitespace-pre-line">
            {currentScenario.briefing.situation}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-lg bg-rose-500/8 border border-rose-500/25">
            <div className="text-rose-300 font-semibold mb-1.5">
              【红方联指作战企图】
            </div>
            <p className="text-foreground/90">
              {currentScenario.briefing.redObjective}
            </p>
          </div>
          <div className="p-3.5 rounded-lg bg-sky-500/8 border border-sky-500/25">
            <div className="text-sky-300 font-semibold mb-1.5">
              【蓝方联指作战企图】
            </div>
            <p className="text-foreground/90">
              {currentScenario.briefing.blueObjective}
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-cyan-500/8 border border-cyan-500/25 space-y-1.5">
          <div className="text-cyan-300 font-semibold">
            【CMO 核心机制与参谋操作要领】
          </div>
          <ul className="list-disc list-inside space-y-1 text-foreground/90">
            {currentScenario.briefing.tacticalTips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-muted-foreground border-t border-border pt-2.5">
          免责声明：本系统中的装备参数、命中率与环境模型均为游戏化教学抽象，不构成现实装备效能评估，亦不用于实际导航或军事决策。
        </p>
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={() => setActiveModal('none')}>
          先查看地图部署
        </Button>
        <Button
          onClick={() => {
            setTimeScale(5);
            setActiveModal('none');
          }}
        >
          <Play className="w-3.5 h-3.5" />
          <span>开始推演 (5×)</span>
        </Button>
      </ModalFooter>
    </ModalShell>
  );
};
