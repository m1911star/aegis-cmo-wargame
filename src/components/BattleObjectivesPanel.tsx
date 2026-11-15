import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { evaluateAreaControlStatus } from '../engine/objectives';
import { useWargameStore } from '../store/useWargameStore';
import { Progress } from './ui/progress';

const OUTCOME_LABELS = {
  victory: '任务胜利',
  costly_victory: '付出战损，任务达成',
  defeat: '任务失败',
  draw: '未分胜负',
};

export const BattleObjectivesPanel = memo(function BattleObjectivesPanel() {
  const [expanded, setExpanded] = useState(false);
  const scenario = useWargameStore((state) => state.currentScenario);
  const allObjectives = useWargameStore((state) => state.objectives);
  const units = useWargameStore((state) => state.units);
  const side = useWargameStore((state) => state.playerSide);
  const progress = useShallow ? useWargameStore(useShallow((state) => state.objectiveProgress)) : {};
  const holdProgress = useShallow ? useWargameStore(useShallow((state) => state.objectiveHoldProgress)) : {};
  const result = useWargameStore((state) => state.battleResult);
  const campaignState = useWargameStore((state) => state.campaignState);
  const advanceCampaignStage = useWargameStore((state) => state.advanceCampaignStage);
  // The display only changes once per whole visible second, not every physics tick.
  const elapsedDisplaySec = useWargameStore((state) =>
    Math.ceil((state.simTime - state.startTime) / 1000)
  );
  const objectives = useMemo(
    () => allObjectives.filter((objective) => objective.side === side),
    [allObjectives, side]
  );
  const achievedCount = objectives.filter((objective) => progress[objective.id] === 'achieved').length;
  const outcome = result?.outcomes[side === 'BLUE' ? 'BLUE' : 'RED'];
  const remaining = Math.max(
    0,
    (scenario.victoryConditions?.durationSec ?? 0) - elapsedDisplaySec
  );
  const showDetails = expanded || !!result;

  return (
    <section className="p-2.5 rounded-lg border border-border bg-card/90 text-xs space-y-2 shadow-xs" aria-label="任务目标">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={showDetails}
        className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          {showDetails ? <ChevronDown className="w-3.5 h-3.5 text-primary" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
          <span>{outcome ? OUTCOME_LABELS[outcome] : `任务目标 (${achievedCount}/${objectives.length})`}</span>
        </span>
        {scenario.victoryConditions && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono tabular-nums">
            {Math.floor(remaining / 60)}:{Math.floor(remaining % 60).toString().padStart(2, '0')}
          </span>
        )}
      </button>
      {showDetails && (
        <div className="space-y-2 pt-1">
          {!objectives.length && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              本想定按时间与积分结算；目标型体验请选择「有限信息演练」。
            </p>
          )}
          {objectives.map((objective) => {
            let controlHint = '';
            let holdPct: number | null = null;
            let holdIndicatorClass = 'bg-cyan-400';
            if (objective.type === 'control_area' && objective.areaPolygon && objective.areaPolygon.length >= 3) {
              const status = evaluateAreaControlStatus(objective, units);
              const stateLabel =
                status.state === 'uncontested'
                  ? '己方稳固控制'
                  : status.state === 'suppressing'
                    ? '优势兵力压制中 (0.5x)'
                    : status.state === 'contested'
                      ? '敌我胶着争夺'
                      : status.state === 'overwhelmed'
                        ? '遭敌优势兵力压制'
                        : '待推进进驻';
              if (objective.holdDurationSec && objective.holdDurationSec > 0) {
                const heldSec = Math.floor(holdProgress[objective.id] ?? 0);
                holdPct = Math.min(100, Math.round(((holdProgress[objective.id] ?? 0) / objective.holdDurationSec) * 100));
                holdIndicatorClass =
                  progress[objective.id] === 'achieved'
                    ? 'bg-emerald-400'
                    : status.state === 'contested'
                      ? 'bg-amber-400'
                      : status.state === 'overwhelmed' || status.state === 'vacant'
                        ? 'bg-rose-400'
                        : 'bg-cyan-400';
                controlHint = !result
                  ? ` · 持续占控 ${heldSec}s/${objective.holdDurationSec}s (${stateLabel})`
                  : '';
              } else if (!result) {
                controlHint = ` · ${stateLabel}`;
              }
            }
            return (
              <div key={objective.id} className="border-t border-border pt-2">
                <span
                  className={
                    progress[objective.id] === 'achieved'
                      ? 'text-emerald-300 font-medium'
                      : progress[objective.id] === 'failed'
                        ? 'text-rose-300 font-medium'
                        : 'text-foreground font-medium'
                  }
                >
                  {progress[objective.id] === 'achieved'
                    ? '已达成'
                    : progress[objective.id] === 'failed'
                      ? '未达成'
                      : '进行中'}{' '}
                  · {objective.title}
                </span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {objective.required ? '主要目标' : '次要目标'} · {objective.points} 分
                  {objective.criticalFailure ? ' · 损失将终止任务' : ''}
                  {controlHint}
                </p>
                {holdPct !== null && (
                  <Progress
                    value={progress[objective.id] === 'achieved' ? 100 : holdPct}
                    indicatorClassName={holdIndicatorClass}
                    className="mt-1.5"
                  />
                )}
              </div>
            );
          })}
          {result && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] text-muted-foreground">
                推演已停止。展开战报，回看支援丢失、风险射击、返航与任务完成事件。
              </p>
              {campaignState && !campaignState.finished && (
                <button
                  onClick={() => advanceCampaignStage('balanced')}
                  className="toolbar-button text-cyan-300"
                >
                  {campaignState.currentStageIndex + 1 < campaignState.totalStages
                    ? `推进至第 ${campaignState.currentStageIndex + 2} 阶段战役`
                    : '结算全部战役战果'}
                </button>
              )}
              {campaignState?.finished && (
                <p className="text-emerald-300 font-semibold">
                  战役已圆满结束！累计积分 {campaignState.carryover.cumulativeScore} · 胜场 {campaignState.carryover.victoryCount}/{campaignState.totalStages}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
});
