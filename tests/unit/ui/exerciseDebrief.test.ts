import { describe, expect, test } from 'bun:test';
import { projectExerciseDebrief } from '../../../src/ui/exerciseDebrief';
import type { AarEventRecord, CombatLogEntry, ScenarioObjective } from '../../../src/types/wargame';

const goal: ScenarioObjective = { id: 'return', side: 'BLUE', title: '返回交接点', type: 'withdraw', required: true, points: 100, unitIds: ['boat'] };
const red: ScenarioObjective = { ...goal, id: 'red', side: 'RED' };
const recovery: AarEventRecord = { id: 'evt', tick: 20, simTime: 5000, side: 'BLUE', kind: 'recovery', unitId: 'boat', title: '船只完成交接', quantity: 1 };
const achieved: CombatLogEntry = { id: 'objective_return_6000', simTime: 6000, side: 'BLUE', category: 'EVENT', severity: 'info', title: '目标达成：返回交接点', message: '任务奖励 100 分。' };

describe('exercise debrief evidence', () => {
  test('shows only this seat’s required goals and never explains a failure with an unrelated event', () => {
    const [row] = projectExerciseDebrief('BLUE', [red, goal, { ...goal, id: 'bonus', required: false }], { return: 'failed' }, [], [{ ...recovery, unitId: 'other' }]);
    expect(row).toEqual({ id: 'return', title: '返回交接点', status: 'failed', moment: undefined });
    expect(projectExerciseDebrief('BLUE', [red], {}, [], [])).toEqual([]);
  });

  test('takes the actual achievement timestamp over a related event', () => {
    const rows = projectExerciseDebrief('BLUE', [goal], { return: 'achieved' }, [achieved], [recovery]);
    expect(rows[0].moment).toEqual({ simTime: 6000, label: '目标达成记录' });
  });

  test('uses the recorded recovery if objective log history is unavailable, without claiming causation', () => {
    const rows = projectExerciseDebrief('BLUE', [goal], { return: 'failed' }, [], [recovery]);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].moment).toEqual({ simTime: 5000, label: '相关单位回收记录' });
  });

  test('a hit on the goal is not proof of success; a hit by the goal on someone else is irrelevant', () => {
    const hit = { ...recovery, kind: 'hit' as const, targetUnitId: 'boat' };
    const rows = projectExerciseDebrief('BLUE', [{ ...goal, type: 'disable' }], { return: 'failed' }, [achieved], [hit, { ...hit, simTime: 7000, targetUnitId: 'other' }]);
    expect(rows[0]).toMatchObject({ status: 'failed', moment: { simTime: 5000, label: '相关单位受损记录' } });
  });
});
