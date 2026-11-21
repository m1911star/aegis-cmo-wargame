import { expect, test } from 'bun:test';
import { handleSimulationWorkerRequest } from '../../src/engine/workerProtocol';
import { INFORMATION_EXERCISE } from '../../src/scenarios/informationExercise';
import { subscribeActionFeedback } from '../../src/store/actionFeedbackBus';
import { canonicalBattleState, captureBattleRecording, captureBattleSave, replayBattleRecording, restoreBattleSave } from '../../src/store/battleRecording';
import { extractSimulationWorldState, useWargameStore as store } from '../../src/store/useWargameStore';
import type { ScenarioDefinition } from '../../src/types/wargame';

const redShip = 'exercise_red_ship';
const redScout = 'exercise_red_scout';
const blueMarker = 'exercise_blue_target';
const blueGuard = 'exercise_blue_guard';
const state = store.getState;
const task = () => state().exerciseTask;
const step = (ticks: number) => state().stepSingleTick(ticks * .25);

function begin(side: 'RED' | 'BLUE' = 'RED', scenario = INFORMATION_EXERCISE) {
  state().loadScenario(scenario, false, 6262);
  store.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
  state().setPlayerSide(side);
}

function plotHandoff() {
  const point = state().referencePoints.find(rp => rp.id === 'exercise_blue_handoff')!;
  state().appendUnitWaypoint(blueMarker, point.position, true);
}

const shortHandoff: ScenarioDefinition = {
  ...INFORMATION_EXERCISE,
  units: INFORMATION_EXERCISE.units.map(unit => unit.id === blueMarker ? {
    ...unit, position: [124.7, 25], waypoints: [],
  } : unit),
  victoryConditions: { ...INFORMATION_EXERCISE.victoryConditions!, durationSec: 3 },
};

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function commandsOnly() {
  const recording = jsonRoundTrip(captureBattleRecording());
  delete recording.snapshots;
  delete recording.history;
  return recording;
}

test('invalid orders have no history and a real seat switch clears a Tick 0 plan', () => {
  begin();
  const feedback: string[] = [];
  const unsubscribe = subscribeActionFeedback((next) => { if (next) feedback.push(next.message); });
  feedback.length = 0;
  try {
    state().setActivePerspective('GOD');
    const before = state().commandHistory;
    state().planExerciseTask(blueMarker, 0, 20);
    state().planExerciseTask(redScout, -1, 20);
    state().planExerciseTask(redScout, 0, 3601);
    state().planExerciseTask(redScout, 20, 19);
    state().planExerciseTask(redScout, .5, 20);
    state().planExerciseTask(redScout, 0, NaN);
    state().planExerciseTask(redScout, 0, 0);
    expect(state().commandHistory).toBe(before);
    expect(task()).toBeUndefined();
    expect(feedback).toHaveLength(7);

    state().planExerciseTask(redShip, 0, 20);
    const redPlan = task();
    const planned = state().commandHistory;
    state().setPlayerSide('RED');
    state().planExerciseTask(redScout, 0, 20);
    state().reassignExerciseTask(redShip);
    state().reassignExerciseTask(blueMarker);
    state().setExerciseTaskPaused(false);
    expect(task()).toBe(redPlan);
    expect(state().commandHistory).toBe(planned);

    state().setPlayerSide('BLUE');
    expect(task()).toBeUndefined();
    state().planExerciseTask(blueGuard, 0, 20);
    expect(task()).toBeUndefined();
    state().planExerciseTask(blueMarker, 0, 20);
    const bluePlan = task();
    state().reassignExerciseTask(blueGuard);
    expect(task()).toBe(bluePlan);
    expect(replayBattleRecording(commandsOnly()).exerciseTask).toEqual(bluePlan);
    state().setPlayerSide('RED');
    expect(task()).toBeUndefined();
    state().setPlayMode('sandbox');
    const sandbox = state().commandHistory;
    state().planExerciseTask(redScout, 0, 20);
    expect(state().commandHistory).toBe(sandbox);
    state().startCampaign('RED');
    const campaign = state().commandHistory;
    state().planExerciseTask(redScout, 0, 20);
    expect(state().commandHistory).toBe(campaign);
    expect(task()).toBeUndefined();
  } finally { unsubscribe(); }
});

test('observing before opening or from another unit does not count; reassignment accepts the first new assigned report', () => {
  begin();
  state().updateUnitDoctrine(redScout, { emconRadar: true });
  state().planExerciseTask(redShip, 4, 8);
  step(3);
  expect(task()?.phase).toBe('scheduled');
  expect(state().objectiveProgress.red_primary).toBe('achieved');
  step(1);
  const previous = task();
  expect(previous?.phase).toBe('running');
  expect(Object.values(state().contacts).find(c => c.observerSide === 'RED' && c.actualUnitId === blueMarker)).toMatchObject({
    lastDetectedTime: state().simTime, sourceUnitIds: [redScout],
  });
  state().reassignExerciseTask(redScout);
  expect(previous?.assignedUnitId).toBe(redShip);
  expect(task()).toMatchObject({ phase: 'running', assignedUnitId: redScout, opensAtTick: 4, closesAtTick: 8, reassignedAtTick: 4 });
  step(1);
  expect(task()).toMatchObject({ phase: 'completed', end: { reason: 'marker_report', tick: 5 } });
  const original = canonicalBattleState();
  const recording = commandsOnly();
  expect(replayBattleRecording(recording, 60)).toEqual(original);
  state().startReplayPlayer(recording, 4);
  expect(state().replayPlayer?.currentTick).toBe(4);
  const before = state().commandHistory;
  state().setExerciseTaskPaused(true);
  state().stopExerciseTask();
  expect(state().commandHistory).toBe(before);
  expect(task()?.phase).toBe('running');
  state().seekReplayPlayer(5);
  expect(task()).toEqual(original.exerciseTask);
  state().exitReplayPlayer();
  expect(canonicalBattleState()).toEqual(original);
});

test('pausing discards report acceptance, preserves assignments and does not extend the close', () => {
  begin();
  state().updateUnitDoctrine(redScout, { emconRadar: true });
  state().planExerciseTask(redShip, 1, 5);
  state().setExerciseTaskPaused(true);
  state().reassignExerciseTask(redScout);
  step(2);
  expect(task()).toMatchObject({ phase: 'paused', assignedUnitId: redScout, opensAtTick: 1, closesAtTick: 5 });
  expect(state().objectiveProgress.red_primary).toBe('achieved');
  state().updateUnitDoctrine(redScout, { emconRadar: false });
  state().setExerciseTaskPaused(false);
  step(1);
  expect(Object.values(state().contacts).find(c => c.observerSide === 'RED' && c.actualUnitId === blueMarker)).toMatchObject({
    lastDetectedTime: state().simTime - 250, sourceUnitIds: [redScout],
  });
  expect(task()?.phase).toBe('running');
  state().setExerciseTaskPaused(true);
  step(2);
  expect(task()).toMatchObject({ phase: 'stopped', end: { reason: 'window_closed', tick: 5 } });
  const history = state().commandHistory;
  state().setExerciseTaskPaused(false);
  state().reassignExerciseTask(redShip);
  state().stopExerciseTask();
  expect(state().commandHistory).toBe(history);
  const original = canonicalBattleState();
  expect(replayBattleRecording(commandsOnly(), 60)).toEqual(original);
});

test('a report at the inclusive close counts, including the final tick of an exercise', () => {
  begin('RED', { ...INFORMATION_EXERCISE, victoryConditions: { ...INFORMATION_EXERCISE.victoryConditions!, durationSec: 1 } });
  state().planExerciseTask(redScout, 4, 4);
  step(3);
  expect(task()?.phase).toBe('scheduled');
  state().updateUnitDoctrine(redScout, { emconRadar: true });
  step(1);
  expect(state().battleResult?.reason).toBe('time_limit');
  expect(task()).toMatchObject({ phase: 'completed', end: { reason: 'marker_report', tick: 4 } });
  const history = state().commandHistory;
  state().setExerciseTaskPaused(true);
  state().stopExerciseTask();
  state().planExerciseTask(redShip, 4, 5);
  expect(state().commandHistory).toBe(history);
  expect(replayBattleRecording(commandsOnly()).exerciseTask).toEqual(task());
});

test('a manual stop at a keyframe round-trips through compact replay and saves', () => {
  begin();
  state().planExerciseTask(redScout, 242, 260);
  step(240);
  const scheduled = task();
  const liveSave = jsonRoundTrip(captureBattleSave());
  state().stopExerciseTask();
  step(1);
  const expected = canonicalBattleState();
  const endedSave = jsonRoundTrip(captureBattleSave());
  const recording = jsonRoundTrip(captureBattleRecording());
  expect(recording.snapshots?.[0]).toMatchObject({ tick: 240, exerciseTask: scheduled });
  expect(expected.exerciseTask).toMatchObject({ phase: 'stopped', end: { reason: 'cancelled', tick: 240 } });
  expect(replayBattleRecording(recording, 60)).toEqual(expected);
  const invalidRecording = structuredClone(recording);
  Object.assign(invalidRecording.snapshots![0].exerciseTask!, { assignedUnitId: blueMarker });
  expect(() => replayBattleRecording(invalidRecording, 60)).toThrow('invalid friendly assignment');
  expect(canonicalBattleState()).toEqual(expected);
  state().resetScenario();
  expect(task()).toBeUndefined();
  expect(restoreBattleSave(endedSave)).toEqual(expected);
  expect(restoreBattleSave(liveSave).exerciseTask).toEqual(scheduled);
  step(1);
  state().updateUnitDoctrine(redScout, { emconRadar: true });
  step(1);
  expect(task()).toMatchObject({ phase: 'completed', end: { reason: 'marker_report', tick: 242 } });
});

test('Worker batches carry task evidence and a task command rejects an in-flight batch', () => {
  const start = () => {
    begin();
    const s = state();
    s.updateUnitDoctrine(redScout, { emconRadar: true });
    s.planExerciseTask(redScout, 4, 8);
  };
  start();
  step(8);
  const mainResult = canonicalBattleState();
  start();
  const before = state();
  const batch = handleSimulationWorkerRequest(structuredClone({ type: 'ADVANCE_BATCH', requestId: 1,
    epoch: before.commandSequence, world: extractSimulationWorldState(before), catalog: before.catalog, seconds: 2,
    autoPause: before.autoPause, playerSide: before.playerSide,
  }));
  if (batch.type !== 'ADVANCE_BATCH_RESULT') throw new Error('Worker batch did not produce a world');
  const apply = () => state().applySimulationResult(batch.result, before.tick, before.commandSequence, before.currentScenario.id);
  state().setExerciseTaskPaused(true);
  expect(apply()).toBe(false);
  expect(task()?.phase).toBe('paused');
  start();
  expect(apply()).toBe(true);
  expect(canonicalBattleState()).toEqual(mainResult);
});

test('Blue accepts only a new authored receipt and task tracking cannot change adjudication', () => {
  const outcomes = [];
  for (const withTask of [false, true]) {
    begin('BLUE');
    if (withTask) state().planExerciseTask(blueMarker, 0, 3600);
    plotHandoff();
    step(3600);
    const s = state();
    const receipt = s.aar.events.find(event => event.kind === 'recovery' && event.unitId === blueMarker)!;
    expect(s.objectiveProgress.blue_primary).toBe('achieved');
    expect(s.battleResult?.outcomes.BLUE).toBe('victory');
    expect(s.score.blueScore).toBe(140);
    expect(s.score.blueMissilesFired + s.score.redMissilesFired).toBe(0);
    if (withTask) expect(task()).toMatchObject({ phase: 'completed', end: { reason: 'handoff_receipt', tick: (receipt.simTime - s.startTime) / 250 } });
    outcomes.push({ units: s.units, progress: s.objectiveProgress, result: s.battleResult, score: s.score });
  }
  expect(outcomes[1]).toEqual(outcomes[0]);
});

test('Blue cannot claim a receipt before opening, during pause, or after a task has closed', () => {
  for (const [opens, paused, reason] of [[2, false, 'handoff_before_open'], [0, true, 'handoff_while_paused']] as const) {
    begin('BLUE', shortHandoff);
    state().planExerciseTask(blueMarker, opens, 4);
    if (paused) state().setExerciseTaskPaused(true);
    step(1);
    expect(state().objectiveProgress.blue_primary).toBe('achieved');
    expect(task()).toMatchObject({ phase: 'stopped', end: { reason, tick: 1 } });
    step(4);
    expect(task()?.end).toEqual({ reason, tick: 1 });
  }

  begin('BLUE', shortHandoff);
  step(1);
  const history = state().commandHistory;
  state().planExerciseTask(blueMarker, 1, 3);
  expect(task()).toBeUndefined();
  expect(state().commandHistory).toBe(history);

  begin('BLUE');
  state().planExerciseTask(blueMarker, 0, 1);
  step(1);
  expect(task()?.end).toEqual({ reason: 'window_closed', tick: 1 });
  plotHandoff();
  step(3599);
  expect(state().objectiveProgress.blue_primary).toBe('achieved');
  expect(task()?.end).toEqual({ reason: 'window_closed', tick: 1 });
});

test('exercise-free v2 saves and recordings keep the persisted bytes from base 3591e63', () => {
  begin('BLUE');
  state().setPlayMode('sandbox');
  state().setPlayMode('command');
  step(240);
  const save = jsonRoundTrip(captureBattleSave());
  const recording = jsonRoundTrip(captureBattleRecording());
  expect(save.digest).toBe('b4c0b48bb86f3961');
  expect(new Bun.CryptoHasher('sha256').update(JSON.stringify(recording)).digest('hex')).toBe('9ec4f73149a2adcdcf78bad245ea5ebb319c6e33e5f28051cbf18ffd216193b8');
  expect(save.snapshot).not.toHaveProperty('exerciseTask');
  expect(recording.snapshots?.[0]).not.toHaveProperty('exerciseTask');
  const restored = restoreBattleSave(save);
  expect(restored).not.toHaveProperty('exerciseTask');
  expect(JSON.stringify(restored)).toBe(JSON.stringify(save.snapshot));
  expect(JSON.stringify(replayBattleRecording(recording))).toBe(JSON.stringify(restored));
  expect(JSON.stringify(replayBattleRecording(commandsOnly(), 60))).toBe(JSON.stringify(restored));
});
