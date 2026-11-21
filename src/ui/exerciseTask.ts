import { FIXED_DT_SEC } from '../engine/determinism';
import type { ExerciseTask } from '../engine/exerciseTask';
import { exerciseClock } from './exerciseDebrief';

export const exerciseTaskTitle = {
  observe_marker: '登记标志船报告',
  friendly_handoff: '办理标志船交接',
} as const;

export const exerciseTaskPhase = {
  scheduled: '已排程', paused: '已暂停', running: '进行中', completed: '已完成', stopped: '已停止',
} as const;

export const exerciseTaskEndReason: Record<NonNullable<ExerciseTask['end']>['reason'], string> = {
  marker_report: '指定单位提交了本方的新接触报告',
  handoff_receipt: '收到指定标志船的交接回执',
  handoff_before_open: '标志船已交接，回执早于任务窗口',
  handoff_while_paused: '标志船已交接，任务暂停时不采纳回执',
  window_closed: '窗口已关闭，未采纳有效记录',
  exercise_ended: '推演已结束，未采纳有效记录',
  cancelled: '本席位停止了任务',
};

export function exerciseTaskClock(tick: number): string {
  const seconds = tick * FIXED_DT_SEC;
  return exerciseClock(seconds * 1000, 0) + (seconds % 1).toFixed(2).slice(1);
}
