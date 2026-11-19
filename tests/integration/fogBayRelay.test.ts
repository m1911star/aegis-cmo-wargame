import { expect, test } from 'bun:test';
import { DEFAULT_SEED } from '../../src/engine/determinism';
import { evaluateAreaControlStatus } from '../../src/engine/objectives';
import { SCENARIO_FOG_BAY_RELAY as scenario } from '../../src/scenarios/fogBayRelayScenario';
import { canonicalBattleState, captureBattleRecording, replayBattleRecording } from '../../src/store/battleRecording';
import { useWargameStore as store } from '../../src/store/useWargameStore';

const durationSec = scenario.victoryConditions!.durationSec;
const transportId = 'fog_red_transport';
const cargoId = 'red_armor_brigade';
const redObjectiveId = 'fog_red_handoff';
const blueObjectiveId = 'fog_blue_handoff';
const reserveId = 'fog_blue_reserve';
const pausesOff = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };

function begin(side: 'RED' | 'BLUE', seed = 8642) {
  store.getState().loadScenario(scenario, false, seed);
  store.setState({ autoPause: pausesOff });
  store.getState().setPlayerSide(side);
}

function landed() {
  return Object.values(store.getState().units).filter(unit => unit.deployedByUnitId === transportId);
}

function landingCount() {
  return store.getState().events.find(event => event.id === 'fog_red_landing')?.fireCount ?? 0;
}

function sendReserveToHandoff(speedKts?: number) {
  const state = store.getState();
  const marker = state.referencePoints.find(point => point.id === 'fog_blue_rp_handoff');
  if (!marker) throw new Error('Missing Blue handoff marker');
  state.appendUnitWaypoint(reserveId, marker.position, true, speedKts);
}

function redControl() {
  const state = store.getState();
  const objective = state.objectives.find(candidate => candidate.id === redObjectiveId);
  if (!objective) throw new Error('Missing Red handoff objective');
  return evaluateAreaControlStatus(objective, state.units);
}

test('Red can unload from command mode, and the approach event only uses the remaining cargo', () => {
  begin('RED');
  store.getState().deployCarriedPlatform(transportId, cargoId);
  expect(landed()).toHaveLength(0);
  expect(store.getState().units[transportId].deployableInventory[cargoId]).toBe(2);

  store.getState().stepSingleTick(720);
  expect(landingCount()).toBe(0);
  store.getState().deployCarriedPlatform(transportId, cargoId);
  expect(landed()).toHaveLength(1);
  expect(store.getState().units[transportId].deployableInventory[cargoId]).toBe(1);

  store.getState().stepSingleTick(180);
  expect(landingCount()).toBe(1);
  expect(landed()).toHaveLength(2);
  expect(landed().every(unit => unit.domain === 'land')).toBe(true);
  expect(store.getState().units[transportId].deployableInventory[cargoId]).toBe(0);

  const expected = canonicalBattleState();
  const recording = captureBattleRecording();
  delete recording.snapshots;
  expect(replayBattleRecording(recording, 60)).toEqual(expected);
});

test('at the standard in-game seed, Red can win after air support and automatic sea-to-land deployment', () => {
  begin('RED', DEFAULT_SEED);
  store.getState().stepSingleTick(durationSec);
  const state = store.getState();
  expect(state.aar.events.some(event => event.kind === 'launch' && event.unitId === 'fog_red_cover')).toBe(true);
  expect(landingCount()).toBe(1);
  expect(landed()).toHaveLength(2);
  expect(state.objectiveProgress[redObjectiveId]).toBe('achieved');
  expect(state.objectiveProgress.fog_red_airfield_offline).toBe('failed');
  expect(state.battleResult?.reason).toBe('time_limit');
  expect(state.battleResult?.outcomes.RED).toMatch(/^(costly_)?victory$/);
  expect(state.battleResult?.outcomes.BLUE).toBe('defeat');
});

test('at the same seed, Blue can hold the checkpoint by ordering a reserve movement and an air sortie', () => {
  begin('BLUE', DEFAULT_SEED);
  sendReserveToHandoff();
  store.getState().updateUnitDoctrine('fog_blue_guard', { shootAndScoot: false, autoEvade: false });
  store.getState().updateUnitDoctrine(reserveId, { roe: 'free', shootAndScoot: false, autoEvade: false });
  store.getState().launchCarrierAircraft('fog_blue_airfield', 'airbase_f35c_wing', 'loadout_f35c_lrasm_strike');
  const state = store.getState();
  const sortie = Object.values(state.units).find(unit => unit.hostCarrierId === 'fog_blue_airfield');
  if (!sortie) throw new Error('Blue sortie did not launch');
  state.updateUnitDoctrine(sortie.id, { emconRadar: true, automaticTargetDomains: ['surface'] });
  store.getState().stepSingleTick(durationSec);

  const end = store.getState();
  expect(end.aar.events.some(event => event.kind === 'launch' && event.unitId === sortie.id)).toBe(true);
  expect(landed()).toHaveLength(0);
  expect(end.objectiveProgress[blueObjectiveId]).toBe('achieved');
  expect(end.battleResult?.outcomes.BLUE).toMatch(/^(costly_)?victory$/);
  expect(end.battleResult?.outcomes.RED).toBe('defeat');
});

test('interim Red control does not lock the result if Blue contests it before the deadline', () => {
  begin('BLUE');
  const orderAtSec = 24 * 60;
  store.getState().stepSingleTick(orderAtSec);
  expect(redControl().state).toBe('uncontested');
  expect(store.getState().objectiveProgress[redObjectiveId]).toBe('pending');
  sendReserveToHandoff(35);
  store.getState().stepSingleTick(durationSec - orderAtSec);

  const state = store.getState();
  expect(redControl().state).toBe('contested');
  expect(state.objectiveProgress[redObjectiveId]).toBe('failed');
  expect(state.objectiveProgress[blueObjectiveId]).toBe('failed');
});

test('neither a ship nor a plane can substitute for ground presence in the handoff zone', () => {
  begin('RED');
  const { units, objectives } = store.getState();
  const objective = objectives.find(candidate => candidate.id === redObjectiveId)!;
  const position = scenario.referencePoints.find(point => point.id === 'fog_red_rp_handoff')!.position;
  const ship = { ...units[transportId], position };
  const aircraft = { ...units.fog_red_cover, position };
  const guard = units.fog_blue_guard;

  // Even if passed coordinates inside the zone, non-land units contribute nothing.
  expect(evaluateAreaControlStatus(objective, { ship, aircraft, guard })).toMatchObject({
    ownStrength: 0, hostileStrength: 1.5,
  });
});
