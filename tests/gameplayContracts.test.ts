import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../src/db';
import { createRuntimeUnitFromPlacement, initializeWorldContacts, stepSimulationWorld, advanceSimulation, type SimulationWorldState } from '../src/engine/simulationEngine';
import { createRandomStream } from '../src/engine/determinism';
import { evaluateFireControl, trackSupport } from '../src/engine/fireControl';
import { advanceGuidance, launchGuidance, seekerCanObserve, sweptSeparationKm } from '../src/engine/guidance';
import { getBearingDeg, getDistanceKm } from '../src/engine/geometry';
import { recoverySolution, updateUnitOperations } from '../src/engine/operations';
import { getUnitCapabilities } from '../src/engine/unitCapabilities';
import { evaluateObjectives, creditDamage } from '../src/engine/objectives';
import { observeMissile } from '../src/engine/sensors';
import { visibleLogs } from '../src/engine/commandPolicy';
import { compileScenario } from '../src/scenarios/compileScenario';
import { INFORMATION_EXERCISE } from '../src/scenarios/informationExercise';
import { BUILTIN_SCENARIOS, SCENARIO_EAST_SEA_THUNDER as east, exportCurrentStateAsScenarioJson } from '../src/scenarios/builtinScenarios';
import { useWargameStore as store } from '../src/store/useWargameStore';
import { captureBattleRecording, canonicalBattleState, replayBattleRecording } from '../src/store/battleRecording';
import type { InitialUnitPlacement, RuntimeUnit, ScenarioDefinition, ScenarioObjective, TacticalContact, TacticalMission, WeaponInFlight, WeaponSpec } from '../src/types/wargame';

const pausesOff = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };
const score = () => ({ redLosses: 0, blueLosses: 0, redMissilesFired: 0, blueMissilesFired: 0,
  redInterceptions: 0, blueInterceptions: 0, redScore: 0, blueScore: 0, firedEventIds: [] as string[], sortiesLaunched: 0 });
const placement = (id: string, extra: Partial<InitialUnitPlacement> = {}): InitialUnitPlacement => ({
  id, name: id, callsign: id, side: 'RED', platformId: 'type055_destroyer', parentGroupId: 'red_surface_tg',
  position: [0, 0], speedKts: 0, heading: 90, doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: false }, ...extra,
});
const unit = (id: string, extra: Partial<InitialUnitPlacement> = {}) => createRuntimeUnitFromPlacement(placement(id, extra), catalog, () => 0.5);
const world = (units: RuntimeUnit[] = []): SimulationWorldState => ({
  startTime: 0, simTime: 0, tick: 0, rngState: 44, units: Object.fromEntries(units.map((u) => [u.id, u])),
  contacts: {}, weaponsInFlight: {}, explosions: [], missions: [], score: score(),
});
const fixture = (units: InitialUnitPlacement[]): ScenarioDefinition => ({ ...structuredClone(east), units,
  missions: [], events: [], objectives: [], referencePoints: [], victoryConditions: undefined });
function contact(target: RuntimeUnit, observer: RuntimeUnit, extra: Partial<TacticalContact> = {}): TacticalContact {
  return { id: `${observer.side}_CONTACT_${target.id}`, actualUnitId: target.id, observerSide: observer.side,
    targetSide: target.side, domain: target.domain, classification: 'classified', displayName: 'Estimated contact', sidc: target.sidc,
    estimatedPosition: [...target.position], truePosition: [...target.position], uncertaintyRadiusKm: 0.3,
    heading: target.heading, speedKts: target.speedKts, altitudeM: target.altitudeM, firstDetectedTime: 0, lastDetectedTime: 0,
    detectedBySources: [observer.callsign], sourceUnitIds: [observer.id], fireControlSourceIds: [observer.id], threatLevel: 'high', ...extra };
}
function missile(shooter: RuntimeUnit, target: RuntimeUnit, weapon = catalog.weapons.yj18_ashm): WeaponInFlight {
  const c = contact(target, shooter);
  return { id: 'test_missile', weaponId: weapon.id, name: weapon.name, side: shooter.side, shooterId: shooter.id,
    shooterName: shooter.callsign, targetId: target.id, targetType: 'unit', position: [...shooter.position], launchPosition: [...shooter.position],
    trail: [], altitudeM: weapon.cruiseAltitudeM, heading: getBearingDeg(shooter.position, c.estimatedPosition), speedKts: weapon.speedKts,
    distanceRemainingKm: getDistanceKm(shooter.position, c.estimatedPosition), maxRangeKm: weapon.maxRangeKm, traveledKm: 0,
    basePk: weapon.basePk, warheadDamage: weapon.warheadDamage, ...launchGuidance(c) };
}

describe('Command authority and preparation', () => {
  test('all built-ins initialize at tick zero without consuming inventory or firing', () => {
    for (const scenario of BUILTIN_SCENARIOS) {
      store.getState().loadScenario(scenario, false, 11);
      const state = store.getState();
      expect(state.tick).toBe(0);
      expect(state.simTime).toBe(state.startTime);
      expect(state.weaponsInFlight).toEqual({});
      expect(state.score.redMissilesFired + state.score.blueMissilesFired).toBe(0);
      for (const u of Object.values(state.units)) {
        expect(u.fuelRemainingSec).toBe(u.maxFuelSec);
        expect(u.mounts.every((m) => m.currentAmmo === m.maxAmmo && m.cooldownRemainingSec === 0)).toBe(true);
      }
    }
  });

  test('sensor initialization preserves an explicitly supplied underway battle', () => {
    const a = unit('a'); const b = unit('b', { side: 'BLUE', position: [0.2, 0] });
    const initial = world([a, b]); initial.weaponsInFlight.m = missile(a, b);
    const snapshot = structuredClone(initial);
    const result = initializeWorldContacts(initial, catalog).nextState;
    expect(initial).toEqual(snapshot);
    expect(result.units).toEqual(initial.units);
    expect(result.weaponsInFlight).toEqual(initial.weaponsInFlight);
    expect(result.simTime).toBe(initial.simTime);
    expect(result.rngState).toBe(initial.rngState);
  });

  test('observation perspective never grants command authority, including GOD', () => {
    store.getState().loadScenario(east);
    const id = 'blue_ddg125_lucas'; const original = structuredClone(store.getState().units[id]);
    for (const perspective of ['BLUE', 'GOD'] as const) {
      const s = store.getState(); s.setActivePerspective(perspective);
      s.appendUnitWaypoint(id, [0, 0]); s.clearUnitWaypoints(id);
      s.updateUnitDoctrine(id, { roe: 'hold' }); s.updateUnitKinematics(id, 0, 0);
      s.assignUnitMission(id, undefined); s.executeManualEngage(id, 'red_055_nanchang', undefined, 2, true);
      expect(store.getState().units[id]).toEqual(original);
    }
    store.getState().setPlayMode('sandbox');
    store.getState().updateUnitDoctrine(id, { roe: 'hold' });
    expect(store.getState().units[id].doctrine.roe).toBe('hold');
  });

  test('enemy hangars and loadouts cannot be changed through alternate entry points', () => {
    store.getState().loadScenario(BUILTIN_SCENARIOS[1]);
    const s = store.getState();
    const carrier = Object.values(s.units).find((u) => u.side === 'BLUE' && u.hangar.length)!;
    const aircraft = Object.values(s.units).find((u) => u.side === 'BLUE' && u.platformId === 'f35c_lightning')!;
    s.launchCarrierAircraft(carrier.id, carrier.hangar[0].slotId);
    s.switchUnitLoadout(aircraft.id, 'loadout_f35c_lrasm_strike');
    expect(store.getState().units[carrier.id]).toEqual(carrier);
    expect(store.getState().units[aircraft.id]).toEqual(aircraft);
  });

  test('detection log selection resolves to a contact, never an enemy runtime unit', () => {
    store.getState().loadScenario(east);
    const s = store.getState(); const log = s.logs.find((l) => l.side === 'RED' && l.contactId)!;
    expect(log).toBeDefined(); expect(log.unitId).toBeUndefined();
    s.selectLogEntry(log.id);
    expect(store.getState().selectedContactId).toBe(log.contactId!);
    expect(store.getState().selectedUnitId === null || store.getState().units[store.getState().selectedUnitId!].side === 'RED').toBe(true);
    expect(visibleLogs(s.logs, 'RED', false).every((l) => l.side !== 'BLUE')).toBe(true);
  });

  test('risk authorization consumes ammo once; HOLD and AOU do not bypass cooldown', () => {
    const a = placement('a'); const b = placement('b', { side: 'BLUE', parentGroupId: 'blue_desron15', position: [0.8, 0] });
    store.getState().loadScenario(fixture([a, b]));
    const s = store.getState();
    const c = contact(s.units.b, s.units.a, { uncertaintyRadiusKm: 20, sourceUnitIds: [], fireControlSourceIds: [] });
    store.setState({ contacts: { [c.id]: c } });
    s.executeManualEngage('a', c.id, 'yj18_ashm', 2);
    expect(store.getState().pendingRiskEngagement).not.toBeNull();
    expect(store.getState().score.redMissilesFired).toBe(0);
    s.executeManualEngage('a', c.id, 'yj18_ashm', 2, true);
    expect(store.getState().score.redMissilesFired).toBe(2);
    expect(store.getState().units.a.doctrine.roe).toBe('hold');
    s.executeManualEngage('a', c.id, 'yj18_ashm', 2, true);
    expect(store.getState().score.redMissilesFired).toBe(2);
    expect(store.getState().pendingRiskEngagement).toBeNull();
  });

  test('an undiscovered unit ID is not a blind-fire aimpoint', () => {
    store.getState().loadScenario(fixture([placement('a'), placement('b', { side: 'BLUE', parentGroupId: 'blue_desron15', position: [5, 0] })]));
    store.getState().executeManualEngage('a', 'b', 'yj21_hypersonic', 2, true);
    expect(store.getState().weaponsInFlight).toEqual({});
  });
});

describe('One fire-control solution, bounded observations', () => {
  test('range and risks depend on the observed aimpoint, not hidden target motion', () => {
    const a = unit('a'); const b = unit('b', { side: 'BLUE', position: [0.8, 0] }); const c = contact(b, a);
    const m = a.mounts.find((mount) => mount.weaponId === 'yj18_ashm')!; const w = catalog.weapons[m.weaponId];
    const before = evaluateFireControl(a, c, m, w, catalog, { a, b }, 0);
    b.position = [80, 40]; b.hp = 0;
    expect(evaluateFireControl(a, c, m, w, catalog, { a, b }, 0)).toEqual(before);
  });

  test('necessary guidance support remains a hard condition even for manual orders', () => {
    const a = unit('a'); const b = unit('b', { side: 'BLUE', position: [0.3, 0] });
    const w: WeaponSpec = { ...catalog.weapons.yj18_ashm, guidance: 'semi_active_radar' };
    const m = a.mounts.find((mount) => mount.weaponId === 'yj18_ashm')!;
    expect(evaluateFireControl(a, contact(b, a), m, w, catalog, { a, b }, 0).status).toBe('blocked');
    a.doctrine.emconRadar = true;
    expect(evaluateFireControl(a, contact(b, a), m, w, catalog, { a, b }, 0).status).toBe('risky');
    a.doctrine.roe = 'free';
    expect(evaluateFireControl(a, contact(b, a), m, w, catalog, { a, b }, 0, 'automatic').status).toBe('executable');
  });

  test('a team track without a receiving datalink is not usable midcourse support', () => {
    const a = unit('a'); const observer = unit('eye', { platformId: 'kj500_awacs' });
    const b = unit('b', { side: 'BLUE' }); const c = contact(b, observer);
    const local = structuredClone(catalog); local.platforms[a.platformId].hasDatalink = false;
    expect(trackSupport(a, c, local.weapons.yj18_ashm, { a, eye: observer, b }, local, 0)).toEqual([]);
    c.sourceUnitIds = [a.id];
    expect(trackSupport(a, c, local.weapons.yj18_ashm, { a, b }, local, 0)).toEqual([a.id]);
  });

  test('missile detection and defense require an operating sensor, not proximity alone', () => {
    const a = unit('a'); const b = unit('b', { side: 'BLUE', position: [0.2, 0] });
    const m = missile(b, a);
    expect(observeMissile('RED', m, { a, b }, catalog, 0)).toBeUndefined();
    a.doctrine.emconRadar = true;
    expect(observeMissile('RED', m, { a, b }, catalog, 0)).toBeDefined();
  });

  test('disconnected missiles do not turn toward hidden motion or vanish on hidden destruction', () => {
    const a = unit('a'); const b = unit('b', { side: 'BLUE', position: [2, 0] });
    const original = missile(a, b); const left = structuredClone(original); const right = structuredClone(original);
    const hidden = { ...b, position: [3, 1] as [number, number], hp: 0, status: 'destroyed' as const };
    for (let t = 1; t <= 10; t++) {
      advanceGuidance(left, catalog.weapons.yj18_ashm, undefined, { a, b }, catalog, t * 1000, 1, b);
      advanceGuidance(right, catalog.weapons.yj18_ashm, undefined, { a, b: hidden }, catalog, t * 1000, 1, hidden);
      expect(left).toEqual(right);
      expect(left.seekerState).toBe('midcourse_blind');
    }
  });

  test('activation outside seeker range searches instead of immediately self-destructing', () => {
    const a = unit('a'); const b = unit('b', { side: 'BLUE', position: [0.22, 0] });
    const w = { ...catalog.weapons.yj18_ashm, guidanceProfile: { activationRangeKm: 25, seekerRangeKm: 12, searchDurationSec: 30 } };
    const m = missile(a, b, w);
    const flight = advanceGuidance(m, w, undefined, { a, b }, catalog, 1000, 1, b);
    expect(m.seekerState).toBe('terminal_searching'); expect(flight.expired).toBe(false);
    m.searchElapsedSec = 29;
    expect(advanceGuidance(m, w, undefined, { a, b }, catalog, 2000, 1, undefined).expired).toBe(true);
  });

  test('seeker range, full FOV angle, and loss of lock remain enforced after acquisition', () => {
    const a = unit('a'); const b = unit('b', { side: 'BLUE', position: [0.05, 0] });
    const w = catalog.weapons.yj18_ashm; const m = missile(a, b);
    expect(seekerCanObserve(m, w, b, catalog, false)).toBe(true);
    advanceGuidance(m, w, undefined, { a, b }, catalog, 250, 0.25, b);
    expect(m.seekerState).toBe('terminal_locked');
    b.position = [-0.5, 0.5];
    advanceGuidance(m, w, undefined, { a, b }, catalog, 500, 0.25, b);
    expect(m.seekerState).toBe('terminal_searching');
    expect(m.aimPosition).not.toEqual(b.position);
  });

  test('anti-radiation guidance does not see every emitter on the map', () => {
    const a = unit('a'); const b = unit('b', { side: 'BLUE', position: [0.05, 0], doctrine: { emconRadar: true } });
    const w = catalog.weapons.ld10_arm; const m = missile(a, b, w);
    expect(seekerCanObserve(m, w, b, catalog, false)).toBe(true);
    b.position = [5, 0]; expect(seekerCanObserve(m, w, b, catalog, false)).toBe(false);
    b.position = [0.05, 0]; b.doctrine.emconRadar = false;
    expect(seekerCanObserve(m, w, b, catalog, false)).toBe(false);
  });

  test('swept collision detects crossing paths but not nearby diverging paths', () => {
    expect(sweptSeparationKm([0, 0], [0.1, 0], [0.05, -0.05], [0.05, 0.05])).toBeLessThan(0.001);
    expect(sweptSeparationKm([0, 0], [0.1, 0], [0, 0.05], [0.1, 0.05])).toBeGreaterThan(5);
  });
});

describe('Resources, tasks and outcome accounting', () => {
  test('return reserve depends on distance, not a universal fuel percentage', () => {
    const a = unit('a', { platformId: 'kj500_awacs', recoveryPosition: [0.1, 0] });
    const near = recoverySolution(a, { a }, catalog).reserveSec;
    a.recoveryPosition = [2, 0];
    expect(recoverySolution(a, { a }, catalog).reserveSec).toBeGreaterThan(near * 2);
  });

  test('unarmed support aircraft remain on station, depleted task weapons trigger withdrawal', () => {
    const scout = unit('scout', { platformId: 'kj500_awacs', recoveryPosition: [0.1, 0] });
    const fighter = unit('fighter', { platformId: 'j20_mighty_dragon', recoveryPosition: [0.1, 0], assignedMissionId: 'cap' });
    fighter.mounts.forEach((mount) => { mount.currentAmmo = 0; });
    const cap: TacticalMission = { id: 'cap', name: 'CAP', side: 'RED', type: 'aaw_patrol', isActive: true,
      areaPolygon: [[0, 0], [1, 0], [1, 1]], assignedUnitIds: [fighter.id], prosecuteOutsideAreaKm: 0, description: '' };
    const units = { scout, fighter };
    updateUnitOperations(scout, units, {}, [cap], catalog, 1000, 1, score(), []);
    updateUnitOperations(fighter, units, {}, [cap], catalog, 1000, 1, score(), []);
    expect(scout.status).toBe('operational'); expect(fighter.status).toBe('returning');
    expect(fighter.returnReason).toBe('ammunition');
  });

  test('fuel exhaustion is counted once; arrival ends the sortie without creating ammo or aircraft', () => {
    const a = unit('a', { platformId: 'kj500_awacs', recoveryPosition: [2, 0] }); a.fuelRemainingSec = 0;
    const lost = stepSimulationWorld(world([a]), catalog, 1, pausesOff, 'RED').nextState;
    expect(lost.units.a.status).toBe('destroyed'); expect(lost.score.redLosses).toBe(1);
    expect(stepSimulationWorld(lost, catalog, 1, pausesOff, 'RED').nextState.score.redLosses).toBe(1);
    const b = unit('b', { platformId: 'kj500_awacs' }); b.status = 'returning'; b.fuelRemainingSec = 5;
    const recovered = stepSimulationWorld(world([b]), catalog, 1, pausesOff, 'RED').nextState;
    expect(recovered.units.b.status).toBe('recovered'); expect(recovered.score.redLosses).toBe(0);
    expect(getUnitCapabilities(recovered.units.b).state).not.toBe('mission_killed');
  });

  test('mission pursuit observes domain/boundary limits and never overwrites manual navigation', () => {
    const a = unit('a', { assignedMissionId: 'patrol' }); const b = unit('b', { side: 'BLUE', position: [0.1, 0.1] });
    const mission: TacticalMission = { id: 'patrol', name: 'patrol', side: 'RED', type: 'asuw_patrol', isActive: true,
      areaPolygon: [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]], assignedUnitIds: ['a'], prosecuteOutsideAreaKm: 0, description: '' };
    a.doctrine.roe = 'free'; const c = contact(b, a);
    updateUnitOperations(a, { a, b }, { [c.id]: c }, [mission], catalog, 0, 1, score(), []);
    expect(a.missionTargetId).toBe(c.id);
    a.navigationMode = 'manual'; a.waypoints = [[-1, -1]];
    updateUnitOperations(a, { a, b }, { [c.id]: c }, [mission], catalog, 6000, 1, score(), []);
    expect(a.waypoints).toEqual([[-1, -1]]);
    a.navigationMode = 'mission'; a.nextMissionDecisionTime = 0;
    c.estimatedPosition = [1, 1]; c.lastDetectedTime = 6000;
    updateUnitOperations(a, { a, b }, { [c.id]: c }, [mission], catalog, 6000, 1, score(), []);
    expect(a.missionTargetId).toBeUndefined();
  });

  test('mission kills, subsequent sinking and key-target bonuses cannot be scored twice', () => {
    const victim = unit('victim', { side: 'BLUE' }); const ledger = {}; const s = score();
    creditDamage(s, victim, ledger, 0.7); const partial = s.redScore;
    creditDamage(s, victim, ledger, 0.7); expect(s.redScore).toBe(partial);
    const rules = { durationSec: 10, tacticalVictoryThreshold: 10, decisiveVictoryThreshold: 100,
      keyTargetBonuses: [{ unitId: victim.id, victimSide: 'BLUE' as const, label: '', bonusPoints: 50 }] };
    creditDamage(s, victim, ledger, 1, rules); creditDamage(s, victim, ledger, 1, rules);
    expect(s.redScore).toBe(200);
  });

  test('a completed main objective permits costly victory; optional losses do not end play', () => {
    const target = unit('target', { side: 'BLUE' }); target.hp = target.maxHp * 0.2;
    const support = unit('support'); support.hp = 0; support.status = 'destroyed';
    const objectives: ScenarioObjective[] = [
      { id: 'main', side: 'RED', title: 'disable', type: 'disable', unitIds: ['target'], required: true, points: 100 },
      { id: 'optional', side: 'RED', title: 'preserve', type: 'preserve', unitIds: ['support'], required: false, points: 10 },
    ];
    const rules = { durationSec: 10, tacticalVictoryThreshold: 10, decisiveVictoryThreshold: 100 };
    const s = score(); s.redLosses = 1;
    const before = evaluateObjectives(objectives, {}, { target, support }, {}, s, 1000, 0, rules);
    expect(before.battleResult).toBeUndefined(); expect(s.redScore).toBe(100);
    const after = evaluateObjectives(objectives, before.progress, { target, support }, {}, s, 10000, 0, rules);
    expect(after.battleResult?.outcomes.RED).toBe('costly_victory'); expect(s.redScore).toBe(100);
    objectives[1].criticalFailure = true;
    expect(evaluateObjectives(objectives, {}, { target, support }, {}, score(), 1000, 0, rules).battleResult?.outcomes.RED).toBe('defeat');
  });

  test('protecting survival and protecting capability are distinct objective contracts', () => {
    const target = unit('target'); target.hp = 1;
    const objective: ScenarioObjective = { id: 'p', side: 'RED', title: 'p', type: 'preserve', unitIds: ['target'], required: true, points: 0 };
    const rule = { durationSec: 1, tacticalVictoryThreshold: 1, decisiveVictoryThreshold: 2 };
    expect(evaluateObjectives([objective], {}, { target }, {}, score(), 1000, 0, rule).progress.p).toBe('achieved');
    expect(evaluateObjectives([{ ...objective, preserveCapability: true }], {}, { target }, {}, score(), 1000, 0, rule).progress.p).toBe('failed');
  });
});

describe('Deterministic replay and scenario contracts', () => {
  test('PRNG state is serializable and continues the same stream', () => {
    const a = createRandomStream(0); a.next(); a.next();
    const b = createRandomStream(JSON.parse(JSON.stringify(a.state())));
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });

  test('fixed substeps stop at the exact auto-pause tick, not the end of a batch', () => {
    const a = unit('a', { doctrine: { emconRadar: true, roe: 'hold' } }); const b = unit('b', { side: 'BLUE', position: [0.1, 0] });
    const result = advanceSimulation(world([a, b]), catalog, 30, { ...pausesOff, onNewContact: true }, 'RED');
    expect(result.shouldAutoPause).toBe(true); expect(result.nextState.tick).toBe(1);
    expect(result.nextState.simTime).toBe(250); expect(result.remainingSec).toBe(0);
  });

  test('scenario completion also interrupts a batch and freezes subsequent simulation', () => {
    const w = world(); w.victoryConditions = { durationSec: 1, tacticalVictoryThreshold: 1, decisiveVictoryThreshold: 2 };
    const end = advanceSimulation(w, catalog, 60, pausesOff, 'RED').nextState;
    expect(end.simTime).toBe(1000); expect(end.battleResult).toBeDefined();
    expect(stepSimulationWorld(end, catalog, 1, pausesOff, 'RED').nextState).toEqual(end);
  });

  test('same tick-stamped commands reproduce identical states at all speed batches', () => {
    store.getState().loadScenario(INFORMATION_EXERCISE, false, 987);
    store.setState({ autoPause: pausesOff });
    store.getState().updateUnitDoctrine('exercise_red_scout', { emconRadar: true });
    store.getState().stepSingleTick(10);
    store.getState().updateUnitDoctrine('exercise_red_ship', { roe: 'free' });
    store.getState().appendUnitWaypoint('exercise_red_ship', [123.8, 25.05]);
    store.getState().stepSingleTick(60);
    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    for (const batch of [1, 5, 15, 60]) expect(replayBattleRecording(recording, batch)).toEqual(expected);
  });

  test('fractional real-time budgets never skip or enlarge physics ticks', () => {
    store.getState().loadScenario(INFORMATION_EXERCISE, false, 123); store.setState({ autoPause: pausesOff });
    for (let i = 0; i < 100; i++) store.getState().stepSingleTick(0.1);
    const small = canonicalBattleState();
    store.getState().loadScenario(INFORMATION_EXERCISE, false, 123); store.setState({ autoPause: pausesOff });
    store.getState().stepSingleTick(10);
    expect(canonicalBattleState()).toEqual(small);
  });

  test('new objective/guidance fields validate and exported scenarios do not retain dangling goals', () => {
    expect(() => compileScenario(INFORMATION_EXERCISE)).not.toThrow();
    const bad = structuredClone(INFORMATION_EXERCISE); bad.objectives![0].unitIds = ['missing'];
    expect(() => compileScenario(bad)).toThrow();
    const badProfile = structuredClone(INFORMATION_EXERCISE);
    badProfile.customCatalogOverlay!.weapons = { bad: { ...catalog.weapons.yj18_ashm, id: 'bad', guidanceProfile: { seekerFovDeg: 361 } } };
    expect(() => compileScenario(badProfile)).toThrow();
    store.getState().loadScenario(INFORMATION_EXERCISE);
    const units = structuredClone(store.getState().units); units.exercise_blue_target.hp = 0;
    expect(() => compileScenario(JSON.parse(exportCurrentStateAsScenarioJson(INFORMATION_EXERCISE, units)))).not.toThrow();
  });

  test('the short exercise reaches a finite debrief without player commands', () => {
    store.getState().loadScenario(INFORMATION_EXERCISE, false, 7); store.setState({ autoPause: pausesOff });
    store.getState().stepSingleTick(1000);
    expect(store.getState().simTime - store.getState().startTime).toBe(900000);
    expect(store.getState().battleResult?.outcomes.RED).toBe('defeat');
    expect(store.getState().battleResult?.outcomes.BLUE).toBe('victory');
  });

  test('an incompatible replay rolls back the entire current battle', () => {
    store.getState().loadScenario(INFORMATION_EXERCISE, false, 47);
    const before = store.getState();
    const recording = captureBattleRecording();
    recording.commands = [{ tick: 0, sequence: 0, action: 'updateUnitDoctrine', args: ['missing', { roe: 'hold' }] }];
    expect(() => replayBattleRecording(recording)).toThrow('incompatible');
    expect(store.getState()).toBe(before);
  });

  test('reset retains the seed and restores the same deployment', () => {
    store.getState().loadScenario(east, true, 1234);
    const units = structuredClone(store.getState().units);
    store.getState().stepSingleTick(2);
    store.getState().resetScenario();
    expect(store.getState().seed).toBe(1234);
    expect(store.getState().units).toEqual(units);
  });
});
