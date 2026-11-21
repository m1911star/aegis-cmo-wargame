import { canCommandUnit } from '../../engine/commandPolicy';
import type { ExerciseTask, ExerciseTaskCriterion } from '../../engine/exerciseTask';
import { exerciseTaskOffer } from '../../scenarios/informationExercise';
import type { RuntimeUnit } from '../../types/wargame';
import { emitActionFeedback } from '../actionFeedbackBus';
import { isReplayingLegacyExerciseHistory } from '../battleRecording';
import type { StoreGet, StoreSet, WargameStoreState } from '../types';

export function taskUnitEligible(state: WargameStoreState, criterion: ExerciseTaskCriterion, unit?: RuntimeUnit): unit is RuntimeUnit {
  return canCommandUnit(state, unit) && unit.side === criterion.side &&
    (criterion.kind === 'observe_marker' || (unit.id === criterion.unitId && unit.domain === 'surface'));
}

const warn = (message: string) => emitActionFeedback('warning', message);

export function createExerciseTaskSlice(set: StoreSet, get: StoreGet) {
  function commandContext() {
    const state = get();
    const offer = !state.battleResult && state.playMode === 'command' && !state.campaignState && !state.campaignStageStart
      ? exerciseTaskOffer(state.currentScenario, state.playerSide, state.objectives) : undefined;
    if (!offer) { warn('只有当前演练的指挥席位可以管理任务。'); return; }
    return { state, ...offer };
  }

  function openPlan() {
    const context = commandContext();
    if (!context) return;
    const { state, criterion } = context;
    const task = state.exerciseTask;
    if (!task || task.criterion.side !== criterion.side || task.end || state.tick >= task.closesAtTick) {
      warn('没有尚未关闭的演练任务。');
      return;
    }
    return { state, task };
  }

  return {
    planExerciseTask: (assignedUnitId: string, opensAtTick: number, closesAtTick: number) => {
      const context = commandContext();
      if (!context) return;
      const { state, criterion, deadlineTick } = context;
      // Older files may have cleared the task during a seat/mode change. Only
      // replay of that recorded history may reproduce another plan in the run.
      if (state.exerciseTask || (!isReplayingLegacyExerciseHistory() &&
          state.commandHistory.some(({ action }) => action === 'planExerciseTask'))) {
        return warn('每局只能安排一项演练任务。');
      }
      if (!Number.isSafeInteger(opensAtTick) || !Number.isSafeInteger(closesAtTick) ||
          opensAtTick < state.tick || closesAtTick < opensAtTick || closesAtTick <= state.tick || closesAtTick > deadlineTick) {
        return warn('请选当前时刻或之后的有效窗口，结束不能超过演练时限。');
      }
      const unit = typeof assignedUnitId === 'string' ? state.units[assignedUnitId] : undefined;
      if (!taskUnitEligible(state, criterion, unit)) return warn('请选择本席位可用的任务单位。');
      if (criterion.kind === 'friendly_handoff' && unit.completedWithdrawalObjectiveIds.includes(criterion.objectiveId)) {
        return warn('标志船已办交接，不能用已有回执建立任务。');
      }
      set({ exerciseTask: { criterion, assignedUnitId, opensAtTick, closesAtTick,
        phase: opensAtTick === state.tick ? 'running' : 'scheduled' } });
    },
    reassignExerciseTask: (assignedUnitId: string) => {
      const plan = openPlan();
      if (!plan) return;
      const { state, task } = plan;
      const unit = typeof assignedUnitId === 'string' ? state.units[assignedUnitId] : undefined;
      if (task.criterion.kind !== 'observe_marker' || assignedUnitId === task.assignedUnitId ||
          !taskUnitEligible(state, task.criterion, unit)) return warn('请选择另一支可用的本方观察单位。');
      set({ exerciseTask: { ...task, assignedUnitId, reassignedAtTick: state.tick } });
    },
    setExerciseTaskPaused: (paused: boolean) => {
      const plan = openPlan();
      if (!plan) return;
      const { state, task } = plan;
      if (typeof paused !== 'boolean' || (task.phase === 'paused') === paused) return warn('任务的暂停状态没有变化。');
      const phase: ExerciseTask['phase'] = paused ? 'paused' : state.tick < task.opensAtTick ? 'scheduled' : 'running';
      set({ exerciseTask: { ...task, phase } });
    },
    stopExerciseTask: () => {
      const plan = openPlan();
      if (!plan) return;
      const { state, task } = plan;
      set({ exerciseTask: { ...task, phase: 'stopped', end: { reason: 'cancelled', tick: state.tick } } });
    },
  };
}
