import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWargameStore } from '../store/useWargameStore';

const OUTCOME_LABELS = {
  victory: '任务胜利',
  costly_victory: '付出战损，任务达成',
  defeat: '任务失败',
  draw: '未分胜负',
};

export const BattleObjectivesPanel = memo(function BattleObjectivesPanel() {
  const scenario = useWargameStore((state) => state.currentScenario);
  const allObjectives = useWargameStore((state) => state.objectives);
  const side = useWargameStore((state) => state.playerSide);
  const progress = useWargameStore(
    useShallow((state) => state.objectiveProgress)
  );
  const result = useWargameStore((state) => state.battleResult);
  // The display only changes once per whole visible second, not every physics tick.
  const elapsedDisplaySec = useWargameStore((state) =>
    Math.ceil((state.simTime - state.startTime) / 1000)
  );
  const objectives = useMemo(
    () => allObjectives.filter((objective) => objective.side === side),
    [allObjectives, side]
  );
  const outcome = result?.outcomes[side === 'BLUE' ? 'BLUE' : 'RED'];
  const remaining = Math.max(
    0,
    (scenario.victoryConditions?.durationSec ?? 0) - elapsedDisplaySec
  );

  return (
    <section className="p-3 mb-3 rounded border border-cyan-500/30 bg-slate-950/70 text-xs space-y-2" aria-label="任务目标">
      <h3 className="font-bold text-cyan-300">
        {outcome ? OUTCOME_LABELS[outcome] : '任务目标与代价'}
      </h3>
      {scenario.victoryConditions && (
        <p>
          剩余 {Math.floor(remaining / 60)}:
          {Math.floor(remaining % 60).toString().padStart(2, '0')}
        </p>
      )}
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
        <p className="text-slate-400">
          推演已停止。展开战报，回看支援丢失、风险射击、返航与任务完成事件。
        </p>
      )}
    </section>
  );
});
