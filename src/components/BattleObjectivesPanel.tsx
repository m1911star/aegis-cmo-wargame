import { useWargameStore } from '../store/useWargameStore';

export function BattleObjectivesPanel() {
  const scenario = useWargameStore((s) => s.currentScenario);
  const side = useWargameStore((s) => s.playerSide);
  const progress = useWargameStore((s) => s.objectiveProgress);
  const result = useWargameStore((s) => s.battleResult);
  const time = useWargameStore((s) => s.simTime - s.startTime);
  const objectives = scenario.objectives?.filter((o) => o.side === side) ?? [];
  const outcome = result?.outcomes[side === 'BLUE' ? 'BLUE' : 'RED'];
  const outcomes = { victory: '任务胜利', costly_victory: '付出战损，任务达成', defeat: '任务失败', draw: '未分胜负' };
  const remaining = Math.max(0, (scenario.victoryConditions?.durationSec ?? 0) - time / 1000);
  return <section className="p-3 mb-3 rounded border border-cyan-500/30 bg-slate-950/70 text-xs space-y-2" aria-label="任务目标">
    <h3 className="font-bold text-cyan-300">{outcome ? outcomes[outcome] : '任务目标与代价'}</h3>
    {scenario.victoryConditions && <p>剩余 {Math.floor(remaining / 60)}:{Math.floor(remaining % 60).toString().padStart(2, '0')}</p>}
    {!objectives.length && <p className="text-slate-400">本想定按时间与积分结算；目标型体验请选择「有限信息演练」。</p>}
    {objectives.map((objective) => <div key={objective.id} className="border-t border-slate-800 pt-2">
      <span className={progress[objective.id] === 'achieved' ? 'text-emerald-300' : progress[objective.id] === 'failed' ? 'text-rose-300' : 'text-slate-200'}>
        {progress[objective.id] === 'achieved' ? '已达成' : progress[objective.id] === 'failed' ? '未达成' : '进行中'} · {objective.title}
      </span>
      <p className="text-slate-400 mt-1">{objective.required ? '主要目标' : '次要目标'} · {objective.points} 分{objective.criticalFailure ? ' · 损失将终止任务' : ''}</p>
    </div>)}
    {result && <p className="text-slate-400">推演已停止。展开战报，回看支援丢失、风险射击、返航与任务完成事件。</p>}
  </section>;
}
