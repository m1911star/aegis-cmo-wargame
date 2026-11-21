import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FIXED_DT_SEC } from '../engine/determinism';
import type { ExerciseTask } from '../engine/exerciseTask';
import { exerciseTaskOffer } from '../scenarios/informationExercise';
import { taskUnitEligible } from '../store/slices/exerciseTaskSlice';
import { useWargameStore } from '../store/useWargameStore';
import { exerciseTaskClock, exerciseTaskEndReason, exerciseTaskPhase, exerciseTaskTitle } from '../ui/exerciseTask';
import { Button } from './ui/button';

const fieldClass = 'min-w-0 w-full rounded border border-border bg-background px-2 py-1 text-foreground';

function taskStatus(task: ExerciseTask, assignedUnitAvailable: boolean) {
  if (task.end) return `${exerciseTaskClock(task.end.tick)} · ${exerciseTaskEndReason[task.end.reason]}`;
  if (task.phase === 'paused') return '暂停采纳记录。单位继续活动，已下达航线不变。';
  if (task.phase === 'scheduled') return '等待任务窗口开启。';
  if (!assignedUnitAvailable) return '指定单位已不可用。';
  return task.criterion.kind === 'observe_marker' ? '等待指定单位的新报告。已有接触不算。' : '等待标志船的交接回执。';
}

export function ExerciseTaskPanel({ onUnitDetails }: { onUnitDetails: () => void }) {
  const scenario = useWargameStore((s) => s.currentScenario);
  const objectives = useWargameStore((s) => s.objectives);
  const side = useWargameStore((s) => s.playerSide);
  const visible = useWargameStore((s) => s.playMode === 'command' && !s.campaignState && !s.campaignStageStart);
  const offer = visible ? exerciseTaskOffer(scenario, side, objectives) : undefined;
  if (!offer) return null;
  return <SeatExerciseTaskPanel key={side} scenario={scenario} onUnitDetails={onUnitDetails} {...offer} />;
}

type PanelProps = NonNullable<ReturnType<typeof exerciseTaskOffer>> & {
  scenario: Parameters<typeof exerciseTaskOffer>[0];
  onUnitDetails: () => void;
};

function SeatExerciseTaskPanel({ criterion, deadlineTick, scenario, onUnitDetails }: PanelProps) {
  const task = useWargameStore((s) => s.exerciseTask?.criterion.side === criterion.side ? s.exerciseTask : undefined);
  const replay = useWargameStore((s) => !!s.replayPlayer);
  const readOnly = useWargameStore((s) => !!s.replayPlayer || !!s.battleResult);
  const units = useWargameStore(useShallow((s) => Object.fromEntries(Object.values(s.units)
    .filter((u) => taskUnitEligible(s, criterion, u)).map(({ id, callsign }) => [id, callsign]))));
  const unitId = task?.assignedUnitId;
  const callsign = useWargameStore((s) => unitId && s.units[unitId]?.side === criterion.side ? s.units[unitId].callsign : undefined);
  const [draft, setDraft] = useState<{ unit: string; opens: string; closes: string }>();
  const [replacement, setReplacement] = useState('');
  useEffect(() => { setDraft(undefined); setReplacement(''); }, [scenario]);
  if (!task && readOnly) return null;

  const options = Object.entries(units);
  const canReplace = Object.hasOwn(units, replacement) && replacement !== unitId;
  const assignedUnitAvailable = !!unitId && Object.hasOwn(units, unitId);
  const title = exerciseTaskTitle[criterion.kind];
  return (
    <section aria-label="演练任务" className="space-y-2 rounded-lg border border-border bg-card/90 px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">演练任务</h2>
        {!task && !draft && options.length > 0 && <Button size="xs" variant="outline" onClick={() => {
          setDraft({ unit: options.length === 1 ? options[0][0] : '', opens: '', closes: String(deadlineTick * FIXED_DT_SEC) });
        }}>安排任务</Button>}
        {task && <span className={task.phase === 'completed' ? 'text-emerald-300' : 'text-cyan-300'}>{exerciseTaskPhase[task.phase]}</span>}
      </div>
      {!task && options.length === 0 && <p className="text-muted-foreground">本席位没有可用的任务单位。</p>}
      {!task && draft && <form className="space-y-2" onSubmit={(event) => {
        event.preventDefault();
        const state = useWargameStore.getState();
        const opensAtTick = draft.opens === '' ? state.tick : Number(draft.opens) / FIXED_DT_SEC;
        state.planExerciseTask(draft.unit, opensAtTick, Number(draft.closes) / FIXED_DT_SEC);
        if (useWargameStore.getState().exerciseTask) setDraft(undefined);
      }}>
        <p>{title} <span className="text-muted-foreground">· 不计分</span></p>
        <label className="block">指定单位
          <select className={fieldClass} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
            <option value="" disabled>选择本方单位</option>
            {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>开始（秒）<input className={fieldClass} type="number" min="0" max={deadlineTick * FIXED_DT_SEC}
            placeholder="确认时" step={FIXED_DT_SEC} value={draft.opens} onChange={(e) => setDraft({ ...draft, opens: e.target.value })} /></label>
          <label>结束（秒）<input className={fieldClass} required type="number" min="0" max={deadlineTick * FIXED_DT_SEC}
            step={FIXED_DT_SEC} value={draft.closes} onChange={(e) => setDraft({ ...draft, closes: e.target.value })} /></label>
        </div>
        <p className="text-muted-foreground">从演练开始计时，含结束时刻。开始留空则在确认时生效。</p>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" type="submit" disabled={!Object.hasOwn(units, draft.unit)}>确认排程</Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>取消</Button>
        </div>
      </form>}
      {task && <>
        <p>{title} · {callsign}</p>
        <p className="font-mono text-muted-foreground">{exerciseTaskClock(task.opensAtTick)} 至 {exerciseTaskClock(task.closesAtTick)}</p>
        <p className="text-muted-foreground">{taskStatus(task, assignedUnitAvailable)}</p>
        {task.reassignedAtTick !== undefined && <p className="text-muted-foreground">{exerciseTaskClock(task.reassignedAtTick)} · 已改派至 {callsign}</p>}
        {replay && <p className="text-muted-foreground">回放只读</p>}
        {!task.end && <fieldset disabled={readOnly} className="space-y-2">
          {criterion.kind === 'observe_marker' && <div className="flex items-end gap-1">
            <label className="min-w-0 flex-1">改派观察单位
              <select className={fieldClass} value={canReplace ? replacement : ''}
                onChange={(e) => setReplacement(e.target.value)}>
                <option value="" disabled>选择另一单位</option>
                {options.filter(([id]) => id !== task.assignedUnitId).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <Button size="sm" variant="outline" disabled={!canReplace}
              onClick={() => { useWargameStore.getState().reassignExerciseTask(replacement); setReplacement(''); }}>改派</Button>
          </div>}
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => useWargameStore.getState().setExerciseTaskPaused(task.phase !== 'paused')}>
              {task.phase === 'paused' ? '恢复任务' : '暂停任务'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => useWargameStore.getState().stopExerciseTask()}>停止任务</Button>
            {criterion.kind === 'observe_marker' && assignedUnitAvailable &&
              <Button size="sm" variant="ghost" aria-controls="inspector-panel" onClick={() => {
                useWargameStore.getState().selectUnit(task.assignedUnitId);
                onUnitDetails();
              }}>查看单位</Button>}
          </div>
          {criterion.kind === 'friendly_handoff' && task.phase === 'running' && <div className="space-y-1">
            <p className="text-muted-foreground">将替换标志船现有航点。</p>
            <Button size="sm" variant="outline" disabled={!assignedUnitAvailable} onClick={() => {
              const state = useWargameStore.getState();
              if (state.exerciseTask !== task || state.replayPlayer) return;
              const point = state.referencePoints.find((rp) => rp.id === criterion.referencePointId && rp.side === criterion.side);
              if (point) state.appendUnitWaypoint(task.assignedUnitId, point.position, true);
            }}>规划交接航线</Button>
          </div>}
        </fieldset>}
      </>}
    </section>
  );
}
