import { memo, useMemo, type Dispatch, type SetStateAction } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { evaluateAreaControlStatus, type AreaControlState } from '../engine/objectives';
import type { ObjectiveProgress, ScenarioObjective } from '../types/wargame';
import { useWargameStore } from '../store/useWargameStore';
import { Progress } from './ui/progress';

const OUTCOME_LABELS = {
  victory: '任务胜利',
  costly_victory: '付出战损，任务达成',
  defeat: '任务失败',
  draw: '未分胜负',
};

type VisibleStatus = ObjectiveProgress[string] | 'unconfirmed';

const STATUS_LABELS: Record<VisibleStatus, string> = {
  achieved: '已达成', failed: '未达成', pending: '进行中', unconfirmed: '待确认',
};

const CONTROL_LABELS: Record<AreaControlState, string> = {
  uncontested: '己方稳固控制', suppressing: '优势兵力压制中 (0.5x)', contested: '敌我胶着争夺',
  overwhelmed: '遭敌优势兵力压制', vacant: '待推进进驻',
};

function AreaControlDetails({ objective, status, ended }: {
  objective: ScenarioObjective; status: VisibleStatus; ended: boolean;
}) {
  const area = useWargameStore(useShallow((s) => {
    if (status === 'unconfirmed') {
      const ownUnits = Object.fromEntries(Object.entries(s.units).filter(([, unit]) => unit.side === objective.side));
      return { status, ownPresent: evaluateAreaControlStatus(objective, ownUnits).ownStrength > 0 } as const;
    }
    return { status, state: evaluateAreaControlStatus(objective, s.units).state, heldSec: s.objectiveHoldProgress[objective.id] ?? 0 } as const;
  }));
  const requiredSec = objective.holdDurationSec;
  if (area.status === 'unconfirmed') {
    return <> · {area.ownPresent ? '己方力量已进驻' : '己方力量未进驻'} · 占控未确认{requiredSec && ` · 需持续占控 ${requiredSec}s`}</>;
  }
  const label = CONTROL_LABELS[area.state];
  if (!requiredSec) return ended ? null : <> · {label}</>;
  const color = area.status === 'achieved' ? 'bg-emerald-400' : area.state === 'contested' ? 'bg-amber-400'
    : area.state === 'overwhelmed' || area.state === 'vacant' ? 'bg-rose-400' : 'bg-cyan-400';
  return (
    <>
      {!ended && ` · 持续占控 ${Math.floor(area.heldSec)}s/${requiredSec}s (${label})`}
      <Progress value={area.status === 'achieved' ? 100 : Math.round(area.heldSec / requiredSec * 100)}
        indicatorClassName={color} className="mt-1.5" />
    </>
  );
}

export const BattleObjectivesPanel = memo(function BattleObjectivesPanel({ expanded, setExpanded }: {
  expanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
}) {
  const scenario = useWargameStore((state) => state.currentScenario);
  const allObjectives = useWargameStore((state) => state.objectives);
  const side = useWargameStore((state) => state.playerSide);
  const playMode = useWargameStore((state) => state.playMode);
  const progress = useWargameStore(useShallow((state) => state.objectiveProgress));
  const result = useWargameStore((state) => state.battleResult);
  const campaignState = useWargameStore((state) => state.campaignState);
  const setActiveModal = useWargameStore((state) => state.setActiveModal);
  // The display only changes once per whole visible second, not every physics tick.
  const elapsedDisplaySec = useWargameStore((state) =>
    Math.ceil((state.simTime - state.startTime) / 1000)
  );
  const reveal = playMode === 'sandbox' || !!result;
  const objectives = useMemo(() => allObjectives.filter((objective) => objective.side === side).map((objective) => ({
    objective,
    status: !reveal && objective.type === 'control_area' ? 'unconfirmed' as const : progress[objective.id] ?? 'pending',
  })), [allObjectives, side, progress, reveal]);
  const achievedCount = objectives.filter(({ status }) => status === 'achieved').length;
  const outcome = result?.outcomes[side === 'BLUE' ? 'BLUE' : 'RED'];
  const remaining = Math.max(
    0,
    (scenario.victoryConditions?.durationSec ?? 0) - elapsedDisplaySec
  );
  const showDetails = expanded || !!result;
  const nextRequired = objectives.find(({ objective, status }) => objective.required && (status === 'pending' || status === 'unconfirmed'));

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
      {!showDetails && nextRequired && <p className="text-[11px] text-muted-foreground">
        {nextRequired.status === 'unconfirmed' ? '待确认主要目标' : '待完成主要目标'} · {nextRequired.objective.title}
      </p>}
      {showDetails && (
        <div className="space-y-2 pt-1">
          {!objectives.length && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              本想定按时间与积分结算；目标型体验请选择「有限信息演练」。
            </p>
          )}
          {objectives.map(({ objective, status }) => (
            <div key={objective.id} className="border-t border-border pt-2">
              <span className={status === 'achieved' ? 'text-emerald-300 font-medium'
                : status === 'failed' ? 'text-rose-300 font-medium' : 'text-foreground font-medium'}>
                {STATUS_LABELS[status]} · {objective.title}
              </span>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {objective.required ? '主要目标' : '次要目标'} · {objective.points} 分
                {objective.criticalFailure ? ' · 损失将终止任务' : ''}
                {objective.type === 'control_area' && <AreaControlDetails objective={objective} status={status} ended={!!result} />}
              </div>
            </div>
          ))}
          {result && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] text-muted-foreground">
                推演已停止。展开战报，回看支援丢失、风险射击、返航与任务完成事件。
              </p>
              {campaignState && !campaignState.finished && (
                <button
                  onClick={() => setActiveModal('campaign')}
                  className="toolbar-button text-cyan-300"
                >
                  打开战间整备
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
