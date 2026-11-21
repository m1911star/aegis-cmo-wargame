import type { RuntimeUnit, TacticalContact } from '../types/wargame';

export type ExerciseTaskCriterion = Readonly<
  | { kind: 'observe_marker'; side: 'RED'; markerUnitId: string }
  | { kind: 'friendly_handoff'; side: 'BLUE'; objectiveId: string; unitId: string; referencePointId: string }
>;

export type ExerciseTaskStopReason = 'cancelled' | 'window_closed' | 'exercise_ended' | 'handoff_before_open' | 'handoff_while_paused';

export type ExerciseTask = Readonly<{
  criterion: ExerciseTaskCriterion;
  assignedUnitId: string;
  opensAtTick: number;
  closesAtTick: number;
  reassignedAtTick?: number;
} & (
  | { phase: 'scheduled' | 'running' | 'paused'; end?: never }
  | { phase: 'completed'; end: Readonly<{ tick: number } & ({ reason: 'marker_report'; contactId: string } | { reason: 'handoff_receipt' })> }
  | { phase: 'stopped'; end: Readonly<{ tick: number; reason: ExerciseTaskStopReason }> }
)>;

export function hasExerciseHandoffReceipt(task: ExerciseTask, unit?: RuntimeUnit): boolean {
  return task.criterion.kind === 'friendly_handoff' && unit?.side === task.criterion.side &&
    unit.completedWithdrawalObjectiveIds.includes(task.criterion.objectiveId);
}

export function advanceExerciseTask(
  task: ExerciseTask,
  tick: number,
  simTime: number,
  contacts: Readonly<Record<string, Pick<TacticalContact, 'id' | 'observerSide' | 'actualUnitId' | 'lastDetectedTime' | 'sourceUnitIds'>>>,
  receivedHandoffThisTick: boolean,
  exerciseEnded: boolean,
): ExerciseTask {
  if (task.end) return task;
  const { criterion, assignedUnitId, opensAtTick, closesAtTick } = task;
  const accepting = task.phase !== 'paused' && opensAtTick <= tick && tick <= closesAtTick;

  if (criterion.kind === 'friendly_handoff' && receivedHandoffThisTick) {
    if (accepting) return { ...task, phase: 'completed', end: { reason: 'handoff_receipt', tick } };
    if (tick <= closesAtTick) return { ...task, phase: 'stopped', end: { tick,
      reason: tick < opensAtTick ? 'handoff_before_open' : 'handoff_while_paused' } };
  }
  if (criterion.kind === 'observe_marker' && accepting) {
    const report = Object.values(contacts).find((contact) => contact.observerSide === criterion.side &&
      contact.actualUnitId === criterion.markerUnitId && contact.lastDetectedTime === simTime &&
      contact.sourceUnitIds?.includes(assignedUnitId));
    if (report) return { ...task, phase: 'completed', end: { reason: 'marker_report', tick, contactId: report.id } };
  }
  if (tick >= closesAtTick) return { ...task, phase: 'stopped', end: { reason: 'window_closed', tick } };
  if (exerciseEnded) return { ...task, phase: 'stopped', end: { reason: 'exercise_ended', tick } };
  if (task.phase === 'scheduled' && tick >= opensAtTick) return { ...task, phase: 'running' };
  return task;
}
