import { expect, test } from 'bun:test';
import { INFORMATION_EXERCISE } from '../../src/scenarios/informationExercise';
import { canonicalBattleState, captureBattleRecording, replayBattleRecording } from '../../src/store/battleRecording';
import { useWargameStore as store } from '../../src/store/useWargameStore';

const duration = INFORMATION_EXERCISE.victoryConditions!.durationSec;
function begin(side: 'BLUE' | 'RED') {
  store.getState().loadScenario(INFORMATION_EXERCISE, false, 6262);
  store.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
  store.getState().setPlayerSide(side);
}
function plotHandoff(id: string) {
  const s = store.getState();
  const destination = s.referencePoints.find(point => point.side === s.playerSide && point.name.includes('交接点'));
  if (!destination) throw new Error('No handoff marker for the command seat');
  s.clearUnitWaypoints(id);
  store.getState().appendUnitWaypoint(id, destination.position);
}
function expectQuietFinish() {
  const s = store.getState();
  expect(s.score.redMissilesFired + s.score.blueMissilesFired).toBe(0);
  expect(s.battleResult?.reason).toBe('time_limit');
}

test('keeping the observer on the exercise and delivering its record earn separate results', () => {
  for (const deliver of [false, true]) {
    begin('RED');
    store.getState().updateUnitDoctrine('exercise_red_scout', { emconRadar: true });
    store.getState().stepSingleTick(5);
    expect(store.getState().objectiveProgress.red_primary).toBe('achieved');
    if (deliver) plotHandoff('exercise_red_scout');
    store.getState().stepSingleTick(duration - 5);
    const s = store.getState();
    expectQuietFinish();
    expect(s.battleResult?.outcomes.RED).toBe('victory');
    expect(s.objectiveProgress.red_return).toBe(deliver ? 'achieved' : 'failed');
    expect(s.units.exercise_red_scout.status === 'recovered').toBe(deliver);
    expect(s.score.redScore).toBe(deliver ? 140 : 100);
  }
});

test('blue can complete the delivery without combat and replay it from commands alone', () => {
  begin('BLUE');
  plotHandoff('exercise_blue_target');
  store.getState().stepSingleTick(duration);
  const s = store.getState();
  expectQuietFinish();
  expect(s.objectiveProgress.blue_primary).toBe('achieved');
  expect(s.battleResult?.outcomes.BLUE).toBe('victory');
  const arrival = s.aar.events.find(event => event.kind === 'recovery' && event.unitId === 'exercise_blue_target');
  expect(arrival).toBeDefined();
  expect(arrival!.simTime).toBeLessThan(s.simTime);
  const original = canonicalBattleState();
  const recording = captureBattleRecording();
  delete recording.snapshots;
  expect(replayBattleRecording(recording, 60)).toEqual(original);
});

test('ignoring the exercise misses both primary goals and the midpoint reminder fires only once', () => {
  begin('RED');
  store.getState().stepSingleTick(duration / 2 - .25);
  const midpoint = () => store.getState().events.find(e => e.id === 'exercise_midpoint');
  expect(midpoint()?.fireCount).toBe(0);
  store.getState().stepSingleTick(.25);
  expect(store.getState().logs.filter(l => l.side === 'SYSTEM' && l.title.includes('演练过半'))).toHaveLength(1);
  store.getState().stepSingleTick(duration / 2);
  expectQuietFinish();
  expect(midpoint()?.fireCount).toBe(1);
  expect(store.getState().battleResult?.outcomes).toEqual({ RED: 'defeat', BLUE: 'defeat' });
});
