import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useWargameStore } from '../store/useWargameStore';

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
  const side = useWargameStore((state) => state.playerSide);
  const progress = useShallow ? useWargameStore(useShallow((state) => state.objectiveProgress)) : {};
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
    <section className="p-2.5 mb-2 rounded border border-cyan-500/30 bg-slate-950/70 text-xs space-y-2" aria-label="任务目标">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={showDetails}
        className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <span className="font-bold text-cyan-300 flex items-center gap-1">
          {showDetails ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {outcome ? OUTCOME_LABELS[outcome] : `任务目标 (${achievedCount}/${objectives.length})`}
        </span>
        {scenario.victoryConditions && (
          <span className="text-[11px] text-slate-300 font-mono">
            {Math.floor(remaining / 60)}:{Math.floor(remaining % 60).toString().padStart(2, '0')}
          </span>
        )}
      </button>
      {showDetails && (
        <>
          {!objectives.length && (
            <p className="text-slate-400">
              本想定按时间与积分结算；目标型体验请选择「有限信息演练」。
            </p>
          )}
          {objectives.map((objective) => (
            <div key={objective.id} className="border-t border-slate-800 pt-2">
              <span
                className={
                  progress[objective.id] === 'achieved'
                    ? 'text-emerald-300'
                    : progress[objective.id] === 'failed'
                      ? 'text-rose-300'
                      : 'text-slate-200'
                }
              >
                {progress[objective.id] === 'achieved'
                  ? '已达成'
                  : progress[objective.id] === 'failed'
                    ? '未达成'
                    : '进行中'}{' '}
                · {objective.title}
              </span>
              <p className="text-slate-400 mt-1">
                {objective.required ? '主要目标' : '次要目标'} · {objective.points} 分
                {objective.criticalFailure ? ' · 损失将终止任务' : ''}
              </p>
            </div>
          ))}
          {result && (
            <div className="space-y-2">
              <p className="text-slate-400">
                推演已停止。展开战报，回看支援丢失、风险射击、返航与任务完成事件。
              </p>
              {campaignState && !campaignState.finished && (
                <button
                  onClick={advanceCampaignStage}
                  className="toolbar-button text-cyan-300"
                >
                  {campaignState.currentStageIndex + 1 < campaignState.totalStages
                    ? `推进至第 ${campaignState.currentStageIndex + 2} 阶段战役`
                    : '结算全部战役战果'}
                </button>
              )}
              {campaignState?.finished && (
                <p className="text-emerald-300 font-bold">
                  战役已圆满结束！累计积分 {campaignState.carryover.cumulativeScore} · 胜场 {campaignState.carryover.victoryCount}/{campaignState.totalStages}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
});
