import { expect, test } from 'bun:test';
import { INFORMATION_EXERCISE } from '../../src/scenarios/informationExercise';
import { canonicalBattleState, captureBattleRecording, replayBattleRecording } from '../../src/store/battleRecording';
import { useWargameStore as store } from '../../src/store/useWargameStore';

for (const seat of ['BLUE', 'RED'] as const) {
  test(`same-condition retry restores the ${seat} opening and replays without a keyframe`, () => {
    store.getState().loadScenario(INFORMATION_EXERCISE, false, 717);
    store.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
    store.getState().setPlayerSide(seat);
    const before = canonicalBattleState();
    const unit = store.getState().selectedUnitId!;
    store.getState().updateUnitDoctrine(unit, { emconRadar: !store.getState().units[unit].doctrine.emconRadar });
    store.getState().stepSingleTick(905);
    expect(store.getState().battleResult).toBeDefined();
    expect(store.getState().retryExercise()).toBe(true);
    const reset = store.getState();
    expect([reset.seed, reset.tick, reset.playerSide, reset.timeScale]).toEqual([717, 0, seat, 0]);
    expect(canonicalBattleState()).toEqual(before);
    expect(reset.commandHistory.map(c => c.action)).toEqual(seat === 'BLUE' ? ['setPlayerSide'] : []);
    reset.stepSingleTick(5);
    const moved = canonicalBattleState();
    const recording = captureBattleRecording();
    expect(recording.snapshots?.length ?? 0).toBe(0);
    expect(replayBattleRecording(recording, 1, 0)).toEqual(before);
    expect(replayBattleRecording(recording, 5)).toEqual(moved);
  });
}

test('retry does not reset a live exercise or campaign stage', () => {
  store.getState().loadScenario(INFORMATION_EXERCISE, false, 909);
  const live = store.getState();
  expect(live.retryExercise()).toBe(false);
  expect(store.getState()).toBe(live);
  live.startCampaign('BLUE');
  store.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
  store.getState().stepSingleTick(905);
  const campaign = store.getState();
  expect(campaign.battleResult).toBeDefined();
  expect(campaign.retryExercise()).toBe(false);
  expect(store.getState()).toBe(campaign);
});
