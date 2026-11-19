import type { AarEventRecord, CombatLogEntry, ObjectiveProgress, ScenarioObjective } from '../types/wargame';

type RecordedMoment = { label: string; simTime: number };

function relatedMoment(goal: ScenarioObjective, events: readonly AarEventRecord[]): RecordedMoment | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (goal.type === 'withdraw' && event.kind === 'recovery' && event.unitId && goal.unitIds.includes(event.unitId)) {
      return { label: '相关单位回收记录', simTime: event.simTime };
    }
    if (goal.type !== 'disable' && goal.type !== 'destroy' && goal.type !== 'preserve') continue;
    if (event.kind !== 'loss' && event.kind !== 'hit') continue;
    const subject = event.targetUnitId ?? event.unitId;
    if (subject && goal.unitIds.includes(subject)) {
      return { label: event.kind === 'loss' ? '相关单位损失记录' : '相关单位受损记录', simTime: event.simTime };
    }
  }
}

export function projectExerciseDebrief(side: ScenarioObjective['side'], objectives: readonly ScenarioObjective[],
  progress: ObjectiveProgress, logs: readonly CombatLogEntry[], events: readonly AarEventRecord[]) {
  return objectives.filter((goal) => goal.side === side && goal.required).map((goal) => {
    const status = progress[goal.id] ?? 'pending';
    const achieved = status === 'achieved' && logs.find((log) => log.side === side && log.category === 'EVENT' &&
      log.id === `objective_${goal.id}_${log.simTime}`);
    const moment = achieved ? { label: '目标达成记录', simTime: achieved.simTime } : relatedMoment(goal, events);
    return { id: goal.id, title: goal.title, status, moment };
  });
}

export function exerciseClock(time: number, startTime: number) {
  const seconds = Math.floor(Math.max(0, time - startTime) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
