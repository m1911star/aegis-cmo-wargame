import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../src/db';
import { summarizeAar } from '../../src/engine/aar';
import { createRuntimeUnitFromPlacement, initializeWorldContacts, stepSimulationWorld, advanceSimulation, type SimulationWorldState } from '../../src/engine/simulationEngine';
import { advanceAirRefueling } from '../../src/engine/simulation/airRefueling';
import { runAutoDefense } from '../../src/engine/simulation/autoDefense';
import { advanceWeaponPhysics } from '../../src/engine/simulation/weaponPhysics';
import { runEvasionAndSoftKill } from '../../src/engine/simulation/evasion';
import { createRandomStream } from '../../src/engine/determinism';
import { evaluateFireControl, trackSupport } from '../../src/engine/fireControl';
import { advanceGuidance, launchGuidance, seekerCanObserve, sweptSeparationKm } from '../../src/engine/guidance';
import { getBearingDeg, getDistanceKm } from '../../src/engine/geometry';
import { recoverySolution, updateUnitOperations } from '../../src/engine/operations';
import { getUnitCapabilities } from '../../src/engine/unitCapabilities';
import { evaluateObjectives, creditDamage } from '../../src/engine/objectives';
import { calculateSonarDetectionRangeKm, computeContactsOnly, observeMissile } from '../../src/engine/sensors';
import { visibleLogs } from '../../src/engine/commandPolicy';
import { compileScenario } from '../../src/scenarios/compileScenario';
import { INFORMATION_EXERCISE } from '../../src/scenarios/informationExercise';
import { BUILTIN_SCENARIOS, SCENARIO_BASHI_CHANNEL_BLOCKADE as bashi, SCENARIO_DEEP_SEA_CARRIER_HUNT as deep, SCENARIO_EAST_SEA_THUNDER as east, exportCurrentStateAsScenarioJson, instantiateScenarioUnits } from '../../src/scenarios/builtinScenarios';
import { useWargameStore as store } from '../../src/store/useWargameStore';
import { BATTLE_RECORDING_VERSION, RULESET_VERSION, SCENARIO_SCHEMA_VERSION, captureBattleRecording, canonicalBattleState, replayBattleRecording } from '../../src/store/battleRecording';
import type { InitialUnitPlacement, RuntimeUnit, ScenarioDefinition, ScenarioObjective, TacticalContact, TacticalMission, UnitDoctrine, WeaponInFlight, WeaponSpec } from '../../src/types/wargame';

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
  missions: [], events: [], objectives: [], referencePoints: [], environment: undefined, victoryConditions: undefined });
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

  test('single-station ESM creates a bearing corridor and independent bearings fuse into an ellipse', () => {
    const observerOne = unit('esm_one', { platformId: 'yj12b_coastal_asm', position: [0, 0] });
    const observerTwo = unit('esm_two', { platformId: 'yj12b_coastal_asm', position: [0, 0.2] });
    const emitter = unit('emitter', { side: 'BLUE', platformId: 'type055_destroyer', position: [0.2, 0.1],
      doctrine: { roe: 'hold', emconRadar: true } });
    const single = computeContactsOnly({ observerOne, emitter }, catalog, {}, 1000).contacts.RED_CONTACT_emitter;
    expect(single).toMatchObject({ uncertaintyKind: 'bearing_corridor', emitterObserved: true, lastEmitterDetectedTime: 1000 });
    expect(single.bearingObservations).toHaveLength(1);
    expect(single.uncertaintyPolygon?.length).toBe(5);
    expect(single.estimatedPosition).not.toEqual(emitter.position);

    const fused = computeContactsOnly({ observerOne, observerTwo, emitter }, catalog, {}, 1000).contacts.RED_CONTACT_emitter;
    expect(fused.uncertaintyKind).toBe('ellipse');
    expect(fused.bearingObservations).toHaveLength(2);
    expect(fused.uncertaintyRadiusKm).toBeLessThan(single.uncertaintyRadiusKm);

    emitter.doctrine.emconRadar = false;
    const silent = computeContactsOnly({ observerOne, observerTwo, emitter }, catalog,
      { [fused.id]: fused }, 2000, 1).contacts.RED_CONTACT_emitter;
    expect(silent.emitterObserved).toBe(false);
    expect(silent.lastEmitterDetectedTime).toBe(1000);
  });

  test('manual anti-radiation bearing fire stores an area aimpoint and reacquires only a radiating seeker target', () => {
    const scenario = fixture([
      placement('arm_shooter', { platformId: 'j16d_roaring_wolf', parentGroupId: 'red_air_cmd', position: [0, 0],
        doctrine: { roe: 'hold', emconRadar: false } }),
      placement('silent_site', { side: 'BLUE', platformId: 'patriot_pac3_site', parentGroupId: 'blue_island_chain',
        position: [0.1, 0], doctrine: { roe: 'hold', emconRadar: false } }),
    ]);
    store.getState().loadScenario(scenario, false, 515);
    const shooter = store.getState().units.arm_shooter;
    const site = store.getState().units.silent_site;
    const corridor = contact(site, shooter, {
      id: 'RED_BEARING_SITE', estimatedPosition: [0.1, 0], uncertaintyRadiusKm: 15,
      uncertaintyKind: 'bearing_corridor', emitterObserved: false, lastEmitterDetectedTime: 0,
      bearingObservations: [{ sourceUnitId: shooter.id, origin: [...shooter.position], bearingDeg: 90, errorDeg: 2.5, maxRangeKm: 180 }],
    });
    store.setState({ contacts: { [corridor.id]: corridor } });
    store.getState().executeManualEngage(shooter.id, corridor.id, 'ld10_arm', 1, true);
    const areaMissile = Object.values(store.getState().weaponsInFlight)[0];
    expect(areaMissile).toMatchObject({ targetType: 'area', targetId: corridor.id, aimPosition: corridor.estimatedPosition });
    expect(areaMissile.targetId).not.toBe(site.id);

    site.position = [0.12, 0.02];
    let areaWorld = { ...world([shooter, site]), contacts: {}, weaponsInFlight: { [areaMissile.id]: structuredClone(areaMissile) } };
    areaWorld = stepSimulationWorld(areaWorld, catalog, 1, pausesOff, 'RED', () => 0.9).nextState;
    expect(areaWorld.weaponsInFlight[areaMissile.id].seekerState).toBe('terminal_searching');
    expect(areaWorld.weaponsInFlight[areaMissile.id].targetId).toBe(corridor.id);
    areaWorld.units.silent_site.doctrine.emconRadar = true;
    areaWorld = stepSimulationWorld(areaWorld, catalog, 1, pausesOff, 'RED', () => 0.9).nextState;
    const reacquired = areaWorld.weaponsInFlight[areaMissile.id];
    expect(reacquired?.seekerState === 'terminal_locked' || areaWorld.units.silent_site.hp < site.maxHp).toBe(true);
  });

  test('automatic WRA enforces range, reserve, target domain and threat value without constraining manual fire', () => {
    const attempt = (patch: Partial<UnitDoctrine>, contactPatch: Partial<TacticalContact> = {}, ammo = 6) => {
      const shooter = unit('shooter', { platformId: 'j20_mighty_dragon', doctrine: { roe: 'free', emconRadar: true } });
      const target = unit('target', { side: 'BLUE', platformId: 'j20_mighty_dragon', position: [0.9, 0] });
      Object.assign(shooter.doctrine, patch);
      shooter.mounts[0].currentAmmo = ammo;
      const track = contact(target, shooter, { threatLevel: 'medium', ...contactPatch });
      const weaponsInFlight: Record<string, WeaponInFlight> = {};
      runAutoDefense({
        units: { shooter, target }, missions: [], contacts: { [track.id]: track }, weaponsInFlight,
        catalog, nextSimTime: 0, score: score(), logs: [], autoPauseSettings: pausesOff,
        triggerPause: () => undefined,
      });
      return { shooter, target, track, weaponsInFlight };
    };

    expect(Object.keys(attempt({ automaticFireRangeFraction: 0.5 }).weaponsInFlight)).toHaveLength(0);
    expect(Object.keys(attempt({ automaticFireRangeFraction: 0.75 }).weaponsInFlight)).toHaveLength(2);
    const reserved = attempt({ minimumWeaponReserve: 5 }, {}, 6);
    expect(Object.keys(reserved.weaponsInFlight)).toHaveLength(1);
    expect(reserved.shooter.mounts[0].currentAmmo).toBe(5);
    expect(Object.keys(attempt({ automaticTargetDomains: ['surface'] }).weaponsInFlight)).toHaveLength(0);
    expect(Object.keys(attempt({ minimumAutomaticThreat: 'high' }).weaponsInFlight)).toHaveLength(0);
    expect(Object.keys(attempt({ minimumAutomaticThreat: 'high' }, { threatLevel: 'high' }).weaponsInFlight)).toHaveLength(2);

    const manual = attempt({ automaticFireRangeFraction: 0.05, minimumWeaponReserve: 6,
      automaticTargetDomains: [], minimumAutomaticThreat: 'critical' });
    const mount = manual.shooter.mounts[0];
    const weapon = catalog.weapons[mount.weaponId];
    expect(evaluateFireControl(manual.shooter, manual.track, mount, weapon, catalog,
      { shooter: manual.shooter, target: manual.target }, 0).status).not.toBe('blocked');
    mount.currentAmmo = 0;
    expect(evaluateFireControl(manual.shooter, manual.track, mount, weapon, catalog,
      { shooter: manual.shooter, target: manual.target }, 0).status).toBe('blocked');

    store.getState().loadScenario(fixture([placement('wra_unit')]), false, 603);
    const before = store.getState();
    store.getState().updateUnitDoctrine('wra_unit', { automaticFireRangeFraction: 2 });
    expect(store.getState()).toBe(before);
    store.getState().updateUnitDoctrine('wra_unit', {
      automaticFireRangeFraction: 0.5, minimumWeaponReserve: 2,
      automaticTargetDomains: ['air'], minimumAutomaticThreat: 'high',
    });
    expect(store.getState().units.wra_unit.doctrine).toMatchObject({
      automaticFireRangeFraction: 0.5, minimumWeaponReserve: 2,
      automaticTargetDomains: ['air'], minimumAutomaticThreat: 'high',
    });
  });

  test('layered defense evaluates every mount and chooses the smallest executable range margin', () => {
    const attempt = (distanceKm: number, reserve = 0, existingCount = 0,
      doctrinePatch: Partial<UnitDoctrine> = {}) => {
      const local = structuredClone(catalog);
      const base = local.weapons.hhq9b_sam;
      local.weapons.test_long_sam = { ...base, id: 'test_long_sam', name: 'Long SAM', codeName: 'LONG', minRangeKm: 8, maxRangeKm: 260 };
      local.weapons.test_mid_sam = { ...base, id: 'test_mid_sam', name: 'Mid SAM', codeName: 'MID', minRangeKm: 4, maxRangeKm: 100 };
      local.weapons.test_short_sam = { ...base, id: 'test_short_sam', name: 'Short SAM', codeName: 'SHORT', minRangeKm: 1, maxRangeKm: 30 };
      const defender = unit('layered_defender', { platformId: 'type055_destroyer', doctrine: {
        roe: 'tight', emconRadar: true, minimumWeaponReserve: reserve, salvoSize: 2,
        automaticFireRangeFraction: 1, automaticTargetDomains: ['air'], minimumAutomaticThreat: 'critical',
        ...doctrinePatch,
      } });
      defender.mounts = [
        { mountId: 'long', weaponId: 'test_long_sam', weaponName: 'LONG', maxAmmo: 12, currentAmmo: 12, reloadTimeSec: 4, cooldownRemainingSec: 0 },
        { mountId: 'short', weaponId: 'test_short_sam', weaponName: 'SHORT', maxAmmo: 4, currentAmmo: 4, reloadTimeSec: 2, cooldownRemainingSec: 0 },
        { mountId: 'mid', weaponId: 'test_mid_sam', weaponName: 'MID', maxAmmo: 8, currentAmmo: 8, reloadTimeSec: 3, cooldownRemainingSec: 0 },
      ];
      const attacker = unit('layered_attacker', { side: 'BLUE', position: [distanceKm / 111.195, 0] });
      const incoming = missile(attacker, defender);
      incoming.id = 'layered_incoming';
      incoming.altitudeM = 10000;
      const weaponsInFlight: Record<string, WeaponInFlight> = { [incoming.id]: incoming };
      for (let index = 0; index < existingCount; index++) {
        const existing = missile(defender, attacker, local.weapons.test_long_sam);
        existing.id = `existing_${index}`;
        existing.targetType = 'missile';
        existing.targetId = incoming.id;
        weaponsInFlight[existing.id] = existing;
      }
      const before = Object.keys(weaponsInFlight).length;
      runAutoDefense({ units: { [defender.id]: defender, [attacker.id]: attacker }, missions: [], contacts: {}, weaponsInFlight,
        catalog: local, nextSimTime: 1000, score: score(), logs: [], autoPauseSettings: pausesOff,
        triggerPause: () => undefined });
      const launched = Object.values(weaponsInFlight).filter((weapon) => weapon.targetType === 'missile' &&
        weapon.targetId === incoming.id && weapon.id.startsWith('msl_int_'));
      return { defender, launched, added: Object.keys(weaponsInFlight).length - before };
    };

    expect(attempt(20).launched.map((weapon) => weapon.weaponId)).toEqual(['test_short_sam', 'test_short_sam']);
    expect(attempt(70).launched.map((weapon) => weapon.weaponId)).toEqual(['test_mid_sam', 'test_mid_sam']);
    expect(attempt(150).launched.map((weapon) => weapon.weaponId)).toEqual(['test_long_sam', 'test_long_sam']);
    expect(attempt(20, 5).launched.map((weapon) => weapon.weaponId)).toEqual(['test_mid_sam', 'test_mid_sam']);
    expect(attempt(20, 0, 1).added).toBe(1);
    expect(attempt(20, 0, 2).added).toBe(0);
    expect(attempt(20, 0, 0, { salvoSize: 1 }).added).toBe(1);
    expect(attempt(20, 0, 1, { salvoSize: 3 }).added).toBe(2);
    expect(attempt(70, 0, 0, { automaticFireRangeFraction: 0.5 }).launched
      .map((weapon) => weapon.weaponId)).toEqual(['test_long_sam', 'test_long_sam']);
    expect(attempt(20, 0, 0, { automaticTargetDomains: ['surface'] }).added).toBe(0);
  });

  test('054B and Constellation frigates detect, intercept and conduct limited surface attacks', () => {
    const red = unit('red_ffg', { platformId: 'type054b_frigate', position: [0, 0],
      doctrine: { roe: 'tight', emconRadar: true } });
    const blue = unit('blue_ffg', { side: 'BLUE', platformId: 'constellation_ffg', position: [0.15, 0],
      doctrine: { roe: 'tight', emconRadar: true } });
    const contacts = computeContactsOnly({ [red.id]: red, [blue.id]: blue }, catalog, {}, 0).contacts;
    expect(contacts.RED_CONTACT_blue_ffg).toBeDefined();
    expect(contacts.BLUE_CONTACT_red_ffg).toBeDefined();

    const verifyDefense = (defender: RuntimeUnit, attacker: RuntimeUnit, expectedWeaponId: string, distanceKm = 40) => {
      defender.doctrine.automaticFireRangeFraction = 1;
      attacker.position = [distanceKm / 111.195, 0];
      const incoming = missile(attacker, defender);
      incoming.id = `incoming_${defender.id}`;
      incoming.altitudeM = 1000;
      const weaponsInFlight: Record<string, WeaponInFlight> = { [incoming.id]: incoming };
      runAutoDefense({ units: { [defender.id]: defender, [attacker.id]: attacker }, missions: [], contacts: {},
        weaponsInFlight, catalog, nextSimTime: 0, score: score(), logs: [], autoPauseSettings: pausesOff,
        triggerPause: () => undefined });
      expect(Object.values(weaponsInFlight).filter((weapon) => weapon.targetType === 'missile')
        .map((weapon) => weapon.weaponId)).toEqual([expectedWeaponId, expectedWeaponId]);
    };
    verifyDefense(red, blue, 'hq16fe_sam');
    const freshBlue = unit('fresh_blue_ffg', { side: 'BLUE', platformId: 'constellation_ffg', position: [0, 0],
      doctrine: { roe: 'tight', emconRadar: true } });
    const redAttacker = unit('red_attacker', { platformId: 'type054b_frigate', position: [0.2, 0] });
    verifyDefense(freshBlue, redAttacker, 'essm_blk2');
    const nearRed = unit('near_red_ffg', { platformId: 'type054b_frigate', position: [0, 0],
      doctrine: { roe: 'tight', emconRadar: true } });
    const nearBlue = unit('near_blue_attacker', { side: 'BLUE', position: [0.05, 0] });
    verifyDefense(nearRed, nearBlue, 'hq10_point_defense', 5);
    const nearBlueFfg = unit('near_blue_ffg', { side: 'BLUE', platformId: 'constellation_ffg', position: [0, 0],
      doctrine: { roe: 'tight', emconRadar: true } });
    const nearRedAttacker = unit('near_red_attacker', { position: [0.05, 0] });
    verifyDefense(nearBlueFfg, nearRedAttacker, 'ram_blk2', 5);
    expect(catalog.weapons.hq10_point_defense.maxRangeKm).toBeLessThan(catalog.weapons.hq16fe_sam.maxRangeKm);
    expect(catalog.weapons.ram_blk2.maxRangeKm).toBeLessThan(catalog.weapons.essm_blk2.maxRangeKm);
    expect(nearRed.mounts.find((mount) => mount.weaponId === 'hq10_point_defense')!.maxAmmo)
      .toBeLessThan(red.mounts.find((mount) => mount.weaponId === 'hq16fe_sam')!.maxAmmo);

    for (const [shooter, target, weaponId] of [
      [unit('red_attack_ffg', { platformId: 'type054b_frigate', doctrine: { roe: 'free', emconRadar: true } }),
        unit('blue_surface_target', { side: 'BLUE', platformId: 'constellation_ffg', position: [1, 0] }), 'yj83_ashm'],
      [unit('blue_attack_ffg', { side: 'BLUE', platformId: 'constellation_ffg', doctrine: { roe: 'free', emconRadar: true } }),
        unit('red_surface_target', { platformId: 'type054b_frigate', position: [1, 0] }), 'nsm_ashm'],
    ] as const) {
      const track = contact(target, shooter, { classification: 'identified' });
      const mount = shooter.mounts.find((candidate) => candidate.weaponId === weaponId)!;
      expect(evaluateFireControl(shooter, track, mount, catalog.weapons[weaponId], catalog,
        { [shooter.id]: shooter, [target.id]: target }, 0).status).not.toBe('blocked');
    }
  });

  test('AIP SSKs exploit low-speed shallow-water acoustics and retain torpedo/anti-ship options', () => {
    const sensor = catalog.sensors.towed_array_sonar;
    const sskRange = calculateSonarDetectionRangeKm(sensor, 0, -70,
      catalog.platforms.type039c_ssk.acousticSignatureDb, 5, false);
    const ssnRange = calculateSonarDetectionRangeKm(sensor, 0, -70,
      catalog.platforms.type093b_ssn.acousticSignatureDb, 5, false);
    expect(sskRange).toBeLessThan(ssnRange);
    const shallowThresholdKm = (sskRange + ssnRange) * 0.5 * 0.72;
    const environment = { landPolygons: [], acousticZones: [{
      id: 'shallow_test', name: 'Shallow', kind: 'shallow' as const, sonarRangeFactor: 0.72,
      areaPolygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]] as [number, number][],
    }] };
    const observer = unit('asw_screen', { platformId: 'type054b_frigate', position: [0, 0], speedKts: 0 });
    const ssk = unit('quiet_ssk', { side: 'BLUE', platformId: 'taigei_ssk',
      position: [shallowThresholdKm / 111.195, 0], speedKts: 5, altitudeM: -70 });
    const ssn = unit('louder_ssn', { side: 'BLUE', platformId: 'virginia_ssn',
      position: [shallowThresholdKm / 111.195, 0], speedKts: 5, altitudeM: -70 });
    expect(computeContactsOnly({ observer, quiet_ssk: ssk }, catalog, {}, 0, 0, environment).contacts.RED_CONTACT_quiet_ssk)
      .toBeUndefined();
    expect(computeContactsOnly({ observer, louder_ssn: ssn }, catalog, {}, 0, 0, environment).contacts.RED_CONTACT_louder_ssn)
      .toBeDefined();

    const redSsk = unit('red_ssk', { platformId: 'type039c_ssk', doctrine: { roe: 'free' } });
    const subTarget = unit('sub_target', { side: 'BLUE', platformId: 'taigei_ssk', position: [0.05, 0] });
    const surfaceTarget = unit('surface_target', { side: 'BLUE', platformId: 'constellation_ffg', position: [1, 0] });
    const torpedoContact = contact(subTarget, redSsk);
    const surfaceContact = contact(surfaceTarget, redSsk);
    for (const [weaponId, track] of [['yu6_torpedo', torpedoContact], ['yj83_ashm', surfaceContact]] as const) {
      const mount = redSsk.mounts.find((candidate) => candidate.weaponId === weaponId)!;
      expect(evaluateFireControl(redSsk, track, mount, catalog.weapons[weaponId], catalog,
        { [redSsk.id]: redSsk, [subTarget.id]: subTarget, [surfaceTarget.id]: surfaceTarget }, 0).status)
        .not.toBe('blocked');
    }
    expect(catalog.platforms.taigei_ssk.mounts.map((mount) => mount.weaponId)).toEqual(['mk48_adcap', 'nsm_ashm']);
  });

  test('ASW helicopters use dipping sonar contacts to authorize lightweight torpedo drops', () => {
    for (const [platformId, loadoutId, targetPlatformId, weaponId] of [
      ['z20f_asw', 'loadout_z20f_asw_prosecute', 'taigei_ssk', 'yu11_lwt'],
      ['mh60r_seahawk', 'loadout_mh60r_asw_prosecute', 'type039c_ssk', 'mk54_lwt'],
    ] as const) {
      const side = platformId === 'z20f_asw' ? 'RED' as const : 'BLUE' as const;
      const targetSide = side === 'RED' ? 'BLUE' as const : 'RED' as const;
      const helicopter = unit(`${platformId}_unit`, { side, platformId, loadoutId, position: [0, 0], altitudeM: 300,
        doctrine: { roe: 'free', emconSonar: true } });
      const target = unit(`${targetPlatformId}_target`, { side: targetSide, platformId: targetPlatformId,
        position: [0.1, 0], altitudeM: -80, speedKts: 5 });
      const contacts = computeContactsOnly({ [helicopter.id]: helicopter, [target.id]: target }, catalog, {}, 0).contacts;
      const track = contacts[`${side}_CONTACT_${target.id}`];
      expect(track).toBeDefined();
      expect(track.domain).toBe('subsurface');
      const mount = helicopter.mounts.find((candidate) => candidate.weaponId === weaponId)!;
      expect(evaluateFireControl(helicopter, track, mount, catalog.weapons[weaponId], catalog,
        { [helicopter.id]: helicopter, [target.id]: target }, 0).status).not.toBe('blocked');
    }
  });

  test('AIM-174B obeys automatic range WRA and finite Super Hornet inventory', () => {
    const fighter = unit('super_hornet', { side: 'BLUE', platformId: 'fa18ef_super_hornet',
      loadoutId: 'loadout_fa18ef_aim174_barcap', position: [0, 0],
      doctrine: { roe: 'free', emconRadar: true, salvoSize: 1, minimumAutomaticThreat: 'high' } });
    const awacs = unit('high_value_air', { platformId: 'kj500_awacs', position: [300 / 111.195, 0] });
    const track = contact(awacs, fighter, { threatLevel: 'high', classification: 'identified', lastDetectedTime: 0 });
    const units = { [fighter.id]: fighter, [awacs.id]: awacs };
    const blockedByWra: Record<string, WeaponInFlight> = {};
    runAutoDefense({ units, missions: [], contacts: { [track.id]: track }, weaponsInFlight: blockedByWra,
      catalog, nextSimTime: 0, score: score(), logs: [], autoPauseSettings: pausesOff,
      triggerPause: () => undefined });
    expect(blockedByWra).toEqual({});

    fighter.doctrine.automaticFireRangeFraction = 1;
    const launched: Record<string, WeaponInFlight> = {};
    runAutoDefense({ units, missions: [], contacts: { [track.id]: track }, weaponsInFlight: launched,
      catalog, nextSimTime: 1000, score: score(), logs: [], autoPauseSettings: pausesOff,
      triggerPause: () => undefined });
    expect(Object.values(launched).map((weapon) => weapon.weaponId)).toEqual(['aim174b_ulraam']);
    expect(fighter.mounts.find((mount) => mount.weaponId === 'aim174b_ulraam')?.currentAmmo).toBe(1);
  });

  test('air-dropped lightweight torpedoes transition into water search and heavy torpedoes stay non-air-launchable', () => {
    const local = structuredClone(catalog);
    local.platforms.type093b_ssn.ciwsDefenseProb = 0;
    const aircraft = unit('asw_aircraft', { side: 'BLUE', platformId: 'p8a_poseidon', position: [0, 0], speedKts: 0,
      doctrine: { roe: 'free', emconRadar: true, salvoSize: 1 } });
    const submarine = unit('asw_submarine', { platformId: 'type093b_ssn', position: [0.05, 0], speedKts: 0 });
    const track = contact(submarine, aircraft, { id: 'BLUE_CONTACT_asw_submarine', lastDetectedTime: 0 });
    const weaponsInFlight: Record<string, WeaponInFlight> = {};
    const s = score();
    runAutoDefense({ units: { [aircraft.id]: aircraft, [submarine.id]: submarine }, missions: [],
      contacts: { [track.id]: track }, weaponsInFlight, catalog: local, nextSimTime: 0,
      score: s, logs: [], autoPauseSettings: pausesOff, triggerPause: () => undefined });
    const dropped = Object.values(weaponsInFlight)[0];
    expect(dropped).toMatchObject({ weaponId: 'mk54_lwt', deliveryPhase: 'air_drop',
      altitudeM: aircraft.altitudeM, speedKts: local.weapons.mk54_lwt.airDropSpeedKts });
    expect(aircraft.mounts.find((mount) => mount.weaponId === 'mk54_lwt')?.currentAmmo).toBe(5);

    const logs: import('../../src/types/wargame').CombatLogEntry[] = [];
    advanceWeaponPhysics({ units: { [aircraft.id]: aircraft, [submarine.id]: submarine },
      contacts: { [track.id]: track }, weaponsInFlight, previousExplosions: [], catalog: local,
      nextSimTime: 50000, dtSec: 50, score: s, creditedDamage: {}, rng: () => 0.9,
      logs, autoPauseSettings: pausesOff, triggerPause: () => undefined });
    expect(dropped).toMatchObject({ deliveryPhase: 'water_search', altitudeM: -50, speedKts: 47, maxRangeKm: 20 });
    expect(logs.some((log) => log.id.startsWith('water_entry_'))).toBe(true);

    dropped.position = [submarine.position[0] - 0.0001, submarine.position[1]];
    dropped.aimPosition = [...submarine.position];
    dropped.heading = getBearingDeg(dropped.position, submarine.position);
    dropped.seekerState = 'terminal_searching';
    const rolls = [0.9, 0.1, 0.5];
    advanceWeaponPhysics({ units: { [aircraft.id]: aircraft, [submarine.id]: submarine },
      contacts: { [track.id]: track }, weaponsInFlight, previousExplosions: [], catalog: local,
      nextSimTime: 51000, dtSec: 1, score: s, creditedDamage: {}, rng: () => rolls.shift() ?? 0.5,
      logs, autoPauseSettings: pausesOff, triggerPause: () => undefined });
    expect(weaponsInFlight[dropped.id]).toBeUndefined();
    expect(submarine.hp).toBeLessThan(submarine.maxHp);

    const heavyMount = { mountId: 'illegal_heavy', weaponId: 'mk48_adcap', weaponName: 'Mk48',
      maxAmmo: 1, currentAmmo: 1, reloadTimeSec: 1, cooldownRemainingSec: 0 };
    expect(evaluateFireControl(aircraft, track, heavyMount, local.weapons.mk48_adcap, local,
      { [aircraft.id]: aircraft, [submarine.id]: submarine }, 0).status).toBe('blocked');
    const ship = unit('lwt_ship', { side: 'BLUE', platformId: 'type055_destroyer' });
    const lwtMount = { ...heavyMount, mountId: 'illegal_lwt', weaponId: 'mk54_lwt', weaponName: 'Mk54' };
    expect(evaluateFireControl(ship, track, lwtMount, local.weapons.mk54_lwt, local,
      { [ship.id]: ship, [submarine.id]: submarine }, 0).status).toBe('blocked');
  });

  test('autoEvade reacts only to an observed closing track, consumes finite inventory once and restores the route', () => {
    const defender = unit('defender', { platformId: 'type055_destroyer', position: [0, 0] });
    const attacker = unit('attacker', { side: 'BLUE', position: [0.2, 0] });
    defender.waypoints = [{ position: [1, 0], speedKts: 24 }];
    const incoming = missile(attacker, defender);
    incoming.targetId = 'some_other_unit';
    const weapons = { [incoming.id]: incoming };
    const logs: never[] = [];

    runEvasionAndSoftKill({ units: { defender, attacker }, weaponsInFlight: weapons, catalog, nextSimTime: 0, logs });
    expect(defender.status).toBe('operational');
    expect(defender.countermeasures.chaff).toBe(6);

    defender.doctrine.emconRadar = true;
    runEvasionAndSoftKill({ units: { defender, attacker }, weaponsInFlight: weapons, catalog, nextSimTime: 1000, logs });
    expect(defender.status).toBe('evading');
    expect(defender.countermeasures.chaff).toBe(5);
    expect(defender.evasionState?.resumeWaypoints).toEqual([{ position: [1, 0], speedKts: 24 }]);
    runEvasionAndSoftKill({ units: { defender, attacker }, weaponsInFlight: weapons, catalog, nextSimTime: 2000, logs });
    expect(defender.countermeasures.chaff).toBe(5);

    runEvasionAndSoftKill({ units: { defender, attacker }, weaponsInFlight: {}, catalog, nextSimTime: 5000, logs });
    expect(defender.status).toBe('evading');
    runEvasionAndSoftKill({ units: { defender, attacker }, weaponsInFlight: {}, catalog, nextSimTime: 12000, logs });
    expect(defender.status).toBe('operational');
    expect(defender.waypoints).toEqual([{ position: [1, 0], speedKts: 24 }]);
  });

  test('chaff, infrared and acoustic soft-kill effects use the serialized PRNG', () => {
    for (const guidance of ['active_radar', 'infrared'] as const) {
      const local = structuredClone(catalog);
      local.weapons.pl15_aam.guidance = guidance;
      const defender = unit(`defender_${guidance}`, { platformId: 'j20_mighty_dragon', position: [0, 0], doctrine: { roe: 'hold', emconRadar: true } });
      const attacker = unit(`attacker_${guidance}`, { side: 'BLUE', platformId: 'j20_mighty_dragon', position: [0.001, 0], doctrine: { roe: 'hold' } });
      const incoming = missile(attacker, defender, local.weapons.pl15_aam);
      const state = world([defender, attacker]); state.weaponsInFlight[incoming.id] = incoming;
      const result = stepSimulationWorld(state, local, 1, pausesOff, 'RED', () => 0);
      expect(result.nextState.weaponsInFlight).toEqual({});
      expect(result.nextState.units[defender.id].hp).toBe(defender.maxHp);
      expect(result.newLogs.some((log) => log.id.startsWith('log_softkill_'))).toBe(true);
      expect(result.nextState.units[defender.id].countermeasures).toMatchObject({ chaff: 3, flares: 3 });
    }

    const submarine = unit('submarine', { platformId: 'type093b_ssn', position: [0, 0], doctrine: { roe: 'hold' } });
    const hostileSub = unit('hostile_sub', { side: 'BLUE', platformId: 'virginia_ssn', position: [0.0001, 0], doctrine: { roe: 'hold' } });
    const torpedo = missile(hostileSub, submarine, catalog.weapons.yu6_torpedo);
    const underwater = world([submarine, hostileSub]); underwater.weaponsInFlight[torpedo.id] = torpedo;
    const acousticResult = stepSimulationWorld(underwater, catalog, 1, pausesOff, 'RED', () => 0);
    expect(acousticResult.nextState.weaponsInFlight).toEqual({});
    expect(acousticResult.nextState.units.submarine.countermeasures.acousticDecoys).toBe(3);
    expect(acousticResult.newLogs.some((log) => log.id.startsWith('log_softkill_'))).toBe(true);
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
    a.navigationMode = 'manual'; a.waypoints = [{ position: [-1, -1] }];
    updateUnitOperations(a, { a, b }, { [c.id]: c }, [mission], catalog, 6000, 1, score(), []);
    expect(a.waypoints).toEqual([{ position: [-1, -1] }]);
    a.navigationMode = 'mission'; a.nextMissionDecisionTime = 0;
    c.estimatedPosition = [1, 1]; c.lastDetectedTime = 6000;
    updateUnitOperations(a, { a, b }, { [c.id]: c }, [mission], catalog, 6000, 1, score(), []);
    expect(a.missionTargetId).toBeUndefined();
  });

  test('escort missions enter, engage observed threats, disengage and recover formation', () => {
    const escort = unit('escort', { platformId: 'j20_mighty_dragon', assignedMissionId: 'escort_mission', position: [0, 0], doctrine: { roe: 'free' } });
    const protectedUnit = unit('protected', { position: [1, 0] });
    const threat = unit('threat', { side: 'BLUE', position: [1.05, 0] });
    const mission: TacticalMission = {
      id: 'escort_mission', name: 'Escort', side: 'RED', type: 'escort', isActive: true,
      areaPolygon: [[0.8, -0.2], [1.2, -0.2], [1.2, 0.2], [0.8, 0.2]], assignedUnitIds: [escort.id],
      prosecuteOutsideAreaKm: 100, stationRadiusKm: 20, escortUnitId: protectedUnit.id, description: '',
    };
    const units = { escort, protected: protectedUnit, threat };
    updateUnitOperations(escort, units, {}, [mission], catalog, 0, 1, score(), []);
    expect(escort.missionState).toBe('ingress');
    expect(escort.waypoints).toEqual([{ position: [...protectedUnit.position] }]);

    escort.position = [1, 0]; escort.waypoints = []; escort.nextMissionDecisionTime = 0;
    updateUnitOperations(escort, units, {}, [mission], catalog, 6000, 1, score(), []);
    expect(escort.missionState).toBe('on_station');

    const observedThreat = contact(threat, escort, { lastDetectedTime: 12000 });
    escort.nextMissionDecisionTime = 0;
    updateUnitOperations(escort, units, { [observedThreat.id]: observedThreat }, [mission], catalog, 12000, 1, score(), []);
    expect(escort.missionState).toBe('engaging');
    expect(escort.missionTargetId).toBe(observedThreat.id);

    escort.nextMissionDecisionTime = 0;
    updateUnitOperations(escort, units, {}, [mission], catalog, 18000, 1, score(), []);
    expect(escort.missionState).toBe('egress');
    escort.position = [...protectedUnit.position]; escort.waypoints = []; escort.nextMissionDecisionTime = 0;
    updateUnitOperations(escort, units, {}, [mission], catalog, 24000, 1, score(), []);
    expect(escort.missionState).toBe('on_station');

    protectedUnit.hp = 0; protectedUnit.status = 'destroyed'; escort.nextMissionDecisionTime = 0;
    updateUnitOperations(escort, units, {}, [mission], catalog, 30000, 1, score(), []);
    expect(escort.missionState).toBe('egress');
    expect(escort.waypoints).toEqual([{ position: [...mission.areaPolygon[0]] }]);
  });

  test('SEAD only prosecutes observed emitters while AEW and tanker support loop routes and recover on fuel', () => {
    const sead = unit('sead', { platformId: 'j16d_roaring_wolf', assignedMissionId: 'sead_mission', position: [0.1, 0.1], doctrine: { roe: 'free' } });
    const emitter = unit('emitter', { side: 'BLUE', platformId: 'patriot_pac3_site', position: [0.15, 0.15] });
    const seadMission: TacticalMission = {
      id: 'sead_mission', name: 'SEAD', side: 'RED', type: 'sead', isActive: true,
      areaPolygon: [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]], assignedUnitIds: [sead.id],
      prosecuteOutsideAreaKm: 20, description: '',
    };
    const track = contact(emitter, sead, { lastDetectedTime: 0, emitterObserved: false });
    updateUnitOperations(sead, { sead, emitter }, { [track.id]: track }, [seadMission], catalog, 0, 1, score(), []);
    expect(sead.missionState).toBe('on_station');
    track.emitterObserved = true; track.lastDetectedTime = 6000; sead.nextMissionDecisionTime = 0;
    updateUnitOperations(sead, { sead, emitter }, { [track.id]: track }, [seadMission], catalog, 6000, 1, score(), []);
    expect(sead.missionState).toBe('engaging');
    track.emitterObserved = false; track.lastDetectedTime = 12000; sead.nextMissionDecisionTime = 0;
    updateUnitOperations(sead, { sead, emitter }, { [track.id]: track }, [seadMission], catalog, 12000, 1, score(), []);
    expect(sead.missionState).toBe('egress');
    sead.nextMissionDecisionTime = 0;
    updateUnitOperations(sead, { sead, emitter }, {}, [seadMission], catalog, 18000, 1, score(), []);
    expect(sead.missionState).toBe('on_station');

    for (const type of ['aew_support', 'tanker_support'] as const) {
      const support = unit(type, { platformId: 'kj500_awacs', assignedMissionId: `${type}_mission`, position: [0, 0] });
      const supportMission: TacticalMission = {
        id: `${type}_mission`, name: type, side: 'RED', type, isActive: true,
        areaPolygon: [[0, 0], [0.1, 0], [0.1, 0.1]], assignedUnitIds: [support.id],
        prosecuteOutsideAreaKm: 0, stationRadiusKm: 20, description: '',
      };
      let supportWorld = stepSimulationWorld({ ...world([support]), missions: [supportMission] }, catalog, 1, pausesOff, 'RED').nextState;
      expect(supportWorld.units[support.id].missionState).toBe('on_station');
      expect(supportWorld.units[support.id].missionRouteIndex).toBe(1);
      supportWorld.units[support.id].fuelRemainingSec = 1;
      supportWorld.units[support.id].position = [...supportWorld.units[support.id].recoveryPosition!];
      supportWorld = stepSimulationWorld(supportWorld, catalog, 1, pausesOff, 'RED').nextState;
      expect(supportWorld.units[support.id].status).toBe('recovered');
      expect(supportWorld.units[support.id].missionState).toBe('recovering');
    }
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

  test('surface withdrawal areas remove only authorized targets and do not end before all units arrive', () => {
    const first = unit('withdraw_first', { position: [0, 0], speedKts: 0 });
    const second = unit('withdraw_second', { position: [1, 0], speedKts: 0 });
    const objective: ScenarioObjective = {
      id: 'surface_withdraw', side: 'RED', title: 'Surface withdrawal', type: 'withdraw',
      unitIds: [first.id, second.id], required: true, points: 100,
      withdrawAreaPolygon: [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]],
      withdrawUnitDomains: ['surface'],
    };
    const victory = { durationSec: 1, tacticalVictoryThreshold: 10, decisiveVictoryThreshold: 100 };
    let state = stepSimulationWorld({ ...world([first, second]), objectives: [objective], victoryConditions: victory },
      catalog, 0.25, pausesOff, 'RED').nextState;
    expect(state.units.withdraw_first.status).toBe('recovered');
    expect(state.units.withdraw_first.completedWithdrawalObjectiveIds).toContain(objective.id);
    expect(state.units.withdraw_second.status).toBe('operational');
    expect(state.objectiveProgress?.surface_withdraw).toBe('pending');
    expect(state.battleResult).toBeUndefined();

    state.units.withdraw_second.position = [0, 0];
    state = stepSimulationWorld(state, catalog, 0.25, pausesOff, 'RED').nextState;
    expect(state.objectiveProgress?.surface_withdraw).toBe('achieved');
    expect(state.battleResult).toBeUndefined();
    state = stepSimulationWorld(state, catalog, 0.5, pausesOff, 'RED').nextState;
    expect(state.battleResult?.outcomes.RED).toBe('victory');

    const recoveredElsewhere = unit('air_recovered', { platformId: 'j20_mighty_dragon' });
    recoveredElsewhere.status = 'recovered';
    const airObjective: ScenarioObjective = { ...objective, id: 'air_area', unitIds: [recoveredElsewhere.id],
      withdrawUnitDomains: ['air'] };
    expect(evaluateObjectives([airObjective], {}, { [recoveredElsewhere.id]: recoveredElsewhere }, {},
      score(), 500, 0, victory).progress.air_area).toBe('pending');
  });

  test('amphibious high-value ships can be mission-killed, preserved and withdrawn through a corridor', () => {
    const lhd = unit('red_lhd', { platformId: 'type075_lhd', position: [0, 0], speedKts: 0 });
    const withdraw: ScenarioObjective = {
      id: 'lhd_withdraw', side: 'RED', title: 'Withdraw LHD', type: 'withdraw', unitIds: [lhd.id],
      required: true, points: 150, withdrawAreaPolygon: [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]],
      withdrawUnitDomains: ['surface'],
    };
    const withdrawn = stepSimulationWorld({ ...world([lhd]), objectives: [withdraw],
      victoryConditions: { durationSec: 10, tacticalVictoryThreshold: 10, decisiveVictoryThreshold: 100 } },
      catalog, 0.25, pausesOff, 'RED').nextState;
    expect(withdrawn.units.red_lhd.status).toBe('recovered');
    expect(withdrawn.objectiveProgress?.lhd_withdraw).toBe('achieved');

    const america = unit('blue_lha', { side: 'BLUE', platformId: 'america_lha' });
    america.hp = america.maxHp * 0.2;
    expect(getUnitCapabilities(america).state).toBe('mission_killed');
    const preserve: ScenarioObjective = { id: 'preserve_lha', side: 'BLUE', title: 'Preserve LHA',
      type: 'preserve', unitIds: [america.id], required: true, points: 100, preserveCapability: true };
    const result = evaluateObjectives([preserve], {}, { [america.id]: america }, {}, score(), 1000, 0,
      { durationSec: 1, tacticalVictoryThreshold: 10, decisiveVictoryThreshold: 100 });
    expect(result.progress.preserve_lha).toBe('failed');
  });

  test('main scenario objectives cover timeout, critical failure and costly victory outcomes', () => {
    const eastUnits = instantiateScenarioUnits(east);
    const timeout = evaluateObjectives(
      east.objectives!, {}, eastUnits, {}, score(), east.victoryConditions!.durationSec * 1000, 0,
      east.victoryConditions
    );
    expect(timeout.battleResult?.outcomes).toEqual({ RED: 'defeat', BLUE: 'victory' });
    expect(timeout.progress.east_red_disable_ishigaki).toBe('failed');
    expect(timeout.progress.east_blue_hold_ishigaki).toBe('achieved');

    eastUnits.blue_pac3_ishigaki.hp = eastUnits.blue_pac3_ishigaki.maxHp * 0.2;
    const critical = evaluateObjectives(east.objectives!, {}, eastUnits, {}, score(), 250, 0, east.victoryConditions);
    expect(critical.battleResult?.reason).toBe('critical_objective');
    expect(critical.battleResult?.outcomes).toEqual({ RED: 'victory', BLUE: 'defeat' });

    const deepUnits = instantiateScenarioUnits(deep);
    deepUnits.blue_cvn78_carrier.hp = deepUnits.blue_cvn78_carrier.maxHp * 0.2;
    const costlyScore = score(); costlyScore.redLosses = 1;
    const costly = evaluateObjectives(deep.objectives!, {}, deepUnits, {}, costlyScore, 250, 0, deep.victoryConditions);
    expect(costly.battleResult?.reason).toBe('critical_objective');
    expect(costly.battleResult?.outcomes).toEqual({ RED: 'costly_victory', BLUE: 'defeat' });
  });
});

describe('Scenario-owned environment rules', () => {
  const landBarrier = {
    landPolygons: [{
      id: 'barrier', name: 'Barrier',
      areaPolygon: [[0.5, -0.5], [1.5, -0.5], [1.5, 0.5], [0.5, 0.5]] as [number, number][],
    }],
    acousticZones: [],
  };

  test('rejects invalid sea routes at the command boundary and blocks swept movement through land', () => {
    const scenario = fixture([placement('ship', { position: [0, 0], speedKts: 0 })]);
    scenario.environment = landBarrier;
    store.getState().loadScenario(scenario, false, 650);
    const before = store.getState();
    store.getState().appendUnitWaypoint('ship', [2, 0]);
    expect(store.getState()).toBe(before);

    const moving = unit('moving', { position: [0, 0], speedKts: 100, heading: 90 });
    const narrowBarrier = {
      landPolygons: [{ id: 'narrow', name: 'Narrow',
        areaPolygon: [[0.01, -0.1], [0.02, -0.1], [0.02, 0.1], [0.01, 0.1]] as [number, number][] }],
      acousticZones: [],
    };
    const moved = stepSimulationWorld({ ...world([moving]), environment: narrowBarrier }, catalog, 120, pausesOff, 'RED').nextState;
    expect(moved.units.moving.position).toEqual([0, 0]);
    expect(moved.units.moving.speedKts).toBe(0);
  });

  test('shallow and deep acoustic zones deterministically change sonar contact range', () => {
    const observer = unit('observer', { platformId: 'type055_destroyer', position: [0, 0], speedKts: 0 });
    const target = unit('target', { side: 'BLUE', platformId: 'virginia_ssn', position: [0.2, 0], speedKts: 0 });
    const zone = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][];
    const shallow = { landPolygons: [], acousticZones: [{
      id: 'shallow', name: 'Shallow', kind: 'shallow' as const, sonarRangeFactor: 0.1, areaPolygon: zone,
    }] };
    const deepWater = { landPolygons: [], acousticZones: [{
      id: 'deep', name: 'Deep', kind: 'deep' as const, sonarRangeFactor: 2, areaPolygon: zone,
    }] };
    const shallowContacts = computeContactsOnly({ observer, target }, catalog, {}, 0, 0, shallow).contacts;
    const deepContacts = computeContactsOnly({ observer, target }, catalog, {}, 0, 0, deepWater).contacts;
    expect(shallowContacts.RED_CONTACT_target).toBeUndefined();
    expect(deepContacts.RED_CONTACT_target).toBeDefined();
  });
});

describe('Player-authored mission commands', () => {
  const missionFixture = () => {
    const scenario = fixture([placement('ship')]);
    scenario.referencePoints = [
      { id: 'rp_a', name: 'A', side: 'RED', position: [0, 0], locked: false },
      { id: 'rp_b', name: 'B', side: 'RED', position: [1, 0], locked: false },
      { id: 'rp_c', name: 'C', side: 'RED', position: [1, 1], locked: false },
      { id: 'rp_d', name: 'D', side: 'RED', position: [0, 1], locked: false },
      { id: 'rp_e', name: 'E', side: 'RED', position: [2, 0], locked: false },
      { id: 'rp_blue', name: 'Blue', side: 'BLUE', position: [2, 2], locked: false },
      { id: 'rp_blue_2', name: 'Blue 2', side: 'BLUE', position: [3, 2], locked: false },
      { id: 'rp_blue_3', name: 'Blue 3', side: 'BLUE', position: [3, 3], locked: false },
    ];
    return scenario;
  };

  test('creates, edits, toggles, assigns and deletes reference-point missions as replayable commands', () => {
    store.getState().loadScenario(missionFixture(), false, 601);
    store.getState().createMissionFromReferencePoints({
      name: 'Player CAP', type: 'aaw_patrol', referencePointIds: ['rp_a', 'rp_b', 'rp_c', 'rp_d'],
      prosecuteOutsideAreaKm: 75,
    });
    const missionId = 'mission_red_0_0';
    expect(store.getState().missions.find((mission) => mission.id === missionId)).toMatchObject({
      name: 'Player CAP', side: 'RED', type: 'aaw_patrol', areaPolygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
      prosecuteOutsideAreaKm: 75, isActive: true,
    });
    expect(store.getState().commandHistory.at(-1)).toMatchObject({ action: 'createMissionFromReferencePoints' });
    store.getState().assignUnitMission('ship', missionId);
    store.getState().toggleMissionActive(missionId);
    store.getState().removeReferencePoint('rp_d');
    expect(store.getState().missions.find((mission) => mission.id === missionId)!.areaPolygon).toHaveLength(4);
    store.getState().updateMissionFromReferencePoints(missionId, {
      name: 'Player ASuW', type: 'asuw_patrol', referencePointIds: ['rp_a', 'rp_b', 'rp_c'],
      prosecuteOutsideAreaKm: 120,
    });
    expect(store.getState().missions.find((mission) => mission.id === missionId)).toMatchObject({
      name: 'Player ASuW', type: 'asuw_patrol', areaPolygon: [[0, 0], [1, 0], [1, 1]],
      prosecuteOutsideAreaKm: 120, isActive: false, assignedUnitIds: ['ship'],
    });

    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    for (const batch of [1, 5, 15, 60]) expect(replayBattleRecording(recording, batch)).toEqual(expected);

    store.getState().deleteMission(missionId);
    expect(store.getState().missions.some((mission) => mission.id === missionId)).toBe(false);
    expect(store.getState().units.ship).toMatchObject({ assignedMissionId: undefined, navigationMode: 'manual' });
    expect(store.getState().commandHistory.at(-1)).toMatchObject({ action: 'deleteMission', args: [missionId] });
  });

  test('rejects degenerate, self-intersecting, mixed-side and unauthorized mission polygons', () => {
    store.getState().loadScenario(missionFixture(), false, 602);
    const rejected = [
      ['rp_a', 'rp_b', 'rp_e'],
      ['rp_a', 'rp_c', 'rp_b', 'rp_d'],
      ['rp_a', 'rp_b', 'rp_blue'],
      ['rp_a', 'rp_b', 'rp_b'],
    ];
    for (const referencePointIds of rejected) {
      const before = store.getState();
      store.getState().createMissionFromReferencePoints({
        name: 'Invalid', type: 'aaw_patrol', referencePointIds, prosecuteOutsideAreaKm: 0,
      });
      expect(store.getState()).toBe(before);
    }
    const beforeBlue = store.getState();
    store.getState().createMissionFromReferencePoints({
      name: 'Unauthorized', type: 'aew_support',
      referencePointIds: ['rp_blue', 'rp_blue_2', 'rp_blue_3'], prosecuteOutsideAreaKm: 0,
    });
    expect(store.getState()).toBe(beforeBlue);
    store.getState().setPlayMode('sandbox');
    store.getState().createMissionFromReferencePoints({
      name: 'Sandbox Blue', type: 'aew_support',
      referencePointIds: ['rp_blue', 'rp_blue_2', 'rp_blue_3'], prosecuteOutsideAreaKm: 0,
    });
    expect(store.getState().missions.at(-1)).toMatchObject({ name: 'Sandbox Blue', side: 'BLUE' });
  });
});

describe('Route legs and formation control', () => {
  test('applies per-leg kinematics, synchronizes followers and restores mission control deterministically', () => {
    const scenario = fixture([
      placement('leader', { platformId: 'j20_mighty_dragon', parentGroupId: 'red_air_cmd', position: [0, 0], speedKts: 300 }),
      placement('follower', { platformId: 'j20_mighty_dragon', parentGroupId: 'red_air_cmd', position: [0.1, 0], speedKts: 250 }),
      placement('mission_follower', { platformId: 'j20_mighty_dragon', parentGroupId: 'red_air_cmd', position: [0.2, 0],
        speedKts: 250, assignedMissionId: 'cap' }),
    ]);
    scenario.missions = [{
      id: 'cap', name: 'CAP', side: 'RED', type: 'aaw_patrol', isActive: true,
      areaPolygon: [[0, 0], [0.3, 0], [0.3, 0.3]], prosecuteOutsideAreaKm: 20, description: '',
    }];
    store.getState().loadScenario(scenario, false, 701);
    store.setState({ autoPause: pausesOff });
    store.getState().appendUnitWaypoint('leader', [0.5, 0], false, 400, 5000);
    store.getState().updateUnitWaypoint('leader', 0, { speedKts: 450 });
    expect(store.getState().units.leader.waypoints[0]).toEqual({ position: [0.5, 0], speedKts: 450, altitudeM: 5000 });
    store.getState().setGroupFormation('red_air_cmd', 'leader', 10);
    expect(store.getState().units.follower).toMatchObject({ navigationMode: 'formation', formationLeaderId: 'leader' });
    expect(store.getState().units.mission_follower).toMatchObject({
      navigationMode: 'formation', formationLeaderId: 'leader', assignedMissionId: 'cap',
    });
    store.getState().stepSingleTick(1);
    expect(store.getState().units.leader).toMatchObject({ targetSpeedKts: 450, targetAltitudeM: 5000 });
    expect(store.getState().units.follower).toMatchObject({ targetSpeedKts: 450, targetAltitudeM: 5000 });
    store.getState().setGroupFormation('red_air_cmd');
    expect(store.getState().units.mission_follower.navigationMode).toBe('mission');
    store.getState().setGroupFormation('red_air_cmd', 'leader', 8);

    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    for (const batch of [1, 5, 15, 60]) expect(replayBattleRecording(recording, batch)).toEqual(expected);

    const returning = store.getState().units.follower;
    store.setState((state) => ({ units: { ...state.units, follower: {
      ...returning, fuelRemainingSec: 1, recoveryPosition: [...returning.position],
    } } }));
    store.getState().stepSingleTick(0.25);
    expect(store.getState().units.follower.status).toBe('recovered');

    const leader = store.getState().units.leader;
    store.setState((state) => ({ units: { ...state.units, leader: { ...leader, hp: 0, status: 'destroyed' } } }));
    store.getState().stepSingleTick(0.25);
    expect(store.getState().units.mission_follower).toMatchObject({
      assignedMissionId: 'cap', navigationMode: 'mission', formationLeaderId: undefined,
    });
  });
});

describe('Finite air-to-air refueling', () => {
  const refuelScenario = () => fixture([
    placement('tanker', { platformId: 'y20u_tanker', parentGroupId: 'red_air_cmd', position: [0, 0], speedKts: 0 }),
    placement('receiver_one', { platformId: 'j20_mighty_dragon', parentGroupId: 'red_air_cmd', position: [0, 0], speedKts: 0 }),
    placement('receiver_two', { platformId: 'h6n_bomber', parentGroupId: 'red_air_cmd', position: [0, 0], speedKts: 0 }),
    placement('surface_unit', { platformId: 'type055_destroyer', position: [0, 0], speedKts: 0 }),
    placement('enemy_receiver', { side: 'BLUE', platformId: 'f35c_lightning', parentGroupId: 'blue_csg_air', position: [0, 0], speedKts: 0 }),
  ]);

  test('queues compatible receivers, conserves transferable fuel and interrupts cleanly', () => {
    store.getState().loadScenario(refuelScenario(), false, 919);
    store.setState((state) => ({ units: {
      ...state.units,
      receiver_one: { ...state.units.receiver_one, fuelRemainingSec: state.units.receiver_one.maxFuelSec - 200 },
      receiver_two: { ...state.units.receiver_two, fuelRemainingSec: state.units.receiver_two.maxFuelSec - 300 },
    } }));
    const beforeInvalid = store.getState();
    store.getState().requestAirRefuel('surface_unit', 'tanker');
    store.getState().requestAirRefuel('enemy_receiver', 'tanker');
    expect(store.getState()).toBe(beforeInvalid);

    store.getState().requestAirRefuel('receiver_one', 'tanker');
    store.getState().requestAirRefuel('receiver_two', 'tanker');
    const units = structuredClone(store.getState().units);
    for (const receiver of [units.receiver_one, units.receiver_two]) {
      receiver.altitudeM = receiver.targetAltitudeM = units.tanker.altitudeM;
      receiver.speedKts = receiver.targetSpeedKts = units.tanker.speedKts;
    }
    expect(units.tanker.aarQueue).toEqual(['receiver_one', 'receiver_two']);
    const totalBefore = units.tanker.aarFuelRemainingSec + units.receiver_one.fuelRemainingSec + units.receiver_two.fuelRemainingSec;
    advanceAirRefueling(units, catalog, 1000, 1, []);
    expect(units.receiver_one.fuelRemainingSec).toBe(units.receiver_one.maxFuelSec - 80);
    expect(units.receiver_two.fuelRemainingSec).toBe(units.receiver_two.maxFuelSec - 300);
    expect(units.tanker.aarFuelRemainingSec + units.receiver_one.fuelRemainingSec + units.receiver_two.fuelRemainingSec)
      .toBeCloseTo(totalBefore, 8);
    advanceAirRefueling(units, catalog, 2000, 1, []);
    expect(units.receiver_one.airRefuelState).toBeUndefined();
    expect(units.tanker.aarQueue).toEqual(['receiver_two']);
    units.tanker.status = 'returning';
    advanceAirRefueling(units, catalog, 3000, 1, []);
    expect(units.tanker.aarQueue).toEqual([]);
    expect(units.receiver_two.airRefuelState).toBeUndefined();
  });

  test('air-refuel request and transfer replay identically across batches', () => {
    store.getState().loadScenario(refuelScenario(), false, 920);
    store.setState({ autoPause: pausesOff });
    store.getState().stepSingleTick(10);
    store.getState().requestAirRefuel('receiver_one', 'tanker');
    store.getState().stepSingleTick(3);
    expect(store.getState().units.receiver_one.fuelRemainingSec).toBeGreaterThan(store.getState().units.receiver_one.maxFuelSec - 10);
    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    for (const batch of [1, 5, 15, 60]) expect(replayBattleRecording(recording, batch)).toEqual(expected);
  });
});

describe('Finite deployable decoys and unmanned platforms', () => {
  test('deploys an observable UAV from finite inventory and replays the command deterministically', () => {
    const scenario = fixture([
      placement('bomber', { platformId: 'h6n_bomber', parentGroupId: 'red_air_cmd', position: [0, 0], speedKts: 0 }),
    ]);
    store.getState().loadScenario(scenario, false, 930);
    store.getState().deployCarriedPlatform('bomber', 'wz8_recon_uav');
    const deployedId = 'deployable_bomber_wz8_recon_uav_0_0';
    expect(store.getState().units[deployedId]).toMatchObject({
      platformId: 'wz8_recon_uav', category: 'mpa_uav', deployedByUnitId: 'bomber',
    });
    expect(store.getState().units.bomber.deployableInventory.wz8_recon_uav).toBe(0);
    const beforeSecond = store.getState();
    store.getState().deployCarriedPlatform('bomber', 'wz8_recon_uav');
    expect(store.getState()).toBe(beforeSecond);
    const expected = canonicalBattleState();
    expect(replayBattleRecording(JSON.parse(JSON.stringify(captureBattleRecording())), 60)).toEqual(expected);
  });

  test('MALD is treated as an aircraft-like observed contact until close identification and consumes defense ammo', () => {
    const scenario = fixture([
      placement('sam', { platformId: 'hq9b_sam_site', parentGroupId: 'red_coastal_def', position: [0, 0],
        doctrine: { roe: 'free', emconRadar: true, automaticFireRangeFraction: 1 } }),
      placement('growler', { side: 'BLUE', platformId: 'ea18g_growler', parentGroupId: 'blue_csg_air', position: [2.25, 0], speedKts: 0 }),
    ]);
    store.getState().loadScenario(scenario, false, 931);
    store.getState().setPlayerSide('BLUE');
    store.getState().deployCarriedPlatform('growler', 'adm160_mald');
    const decoy = Object.values(store.getState().units).find((unit) => unit.platformId === 'adm160_mald')!;
    const sam = store.getState().units.sam;
    const farContact = computeContactsOnly({ sam, [decoy.id]: decoy }, catalog, {}, 0).contacts[`RED_CONTACT_${decoy.id}`];
    expect(farContact).toMatchObject({ classification: 'classified', identifiedCategory: undefined, threatLevel: 'high' });
    const weaponsInFlight: Record<string, WeaponInFlight> = {};
    runAutoDefense({ units: { sam, [decoy.id]: decoy }, missions: [], contacts: { [farContact.id]: farContact },
      weaponsInFlight, catalog, nextSimTime: 0, score: score(), logs: [], autoPauseSettings: pausesOff,
      triggerPause: () => undefined });
    expect(Object.values(weaponsInFlight).some((weapon) => weapon.targetId === decoy.id)).toBe(true);
    expect(sam.mounts[0].currentAmmo).toBeLessThan(sam.mounts[0].maxAmmo);

    const freshSam = unit('fresh_sam', { platformId: 'hq9b_sam_site', position: [0, 0],
      doctrine: { roe: 'free', emconRadar: true, automaticFireRangeFraction: 1 } });
    decoy.position = [0.2, 0];
    const nearContact = computeContactsOnly({ freshSam, [decoy.id]: decoy }, catalog, {}, 1000).contacts[`RED_CONTACT_${decoy.id}`];
    expect(nearContact).toMatchObject({ classification: 'identified', identifiedCategory: 'decoy', threatLevel: 'low' });
    const afterIdentification: Record<string, WeaponInFlight> = {};
    runAutoDefense({ units: { freshSam, [decoy.id]: decoy }, missions: [], contacts: { [nearContact.id]: nearContact },
      weaponsInFlight: afterIdentification, catalog, nextSimTime: 1000, score: score(), logs: [], autoPauseSettings: pausesOff,
      triggerPause: () => undefined });
    expect(afterIdentification).toEqual({});
  });
});

describe('Sandbox scenario builder commands', () => {
  test('edits units, groups, objectives and area events, then exports an equivalent importable scenario', () => {
    store.getState().loadScenario(east, false, 717);
    store.getState().setPlayMode('sandbox');
    store.getState().moveUnitInSandbox('red_j20_alpha', [123.1, 26.7]);
    const group = store.getState().groups.find((candidate) => candidate.id === 'red_surface_tg')!;
    store.getState().updateScenarioGroup(group.id, {
      name: '红方联合突击群', commandTitle: 'JOINT-RED', description: 'Builder edited group',
    });
    store.getState().assignUnitGroup('red_j20_alpha', group.id);
    store.getState().upsertObjective({
      title: 'Builder destroy objective', side: 'RED', type: 'destroy',
      unitIds: ['blue_ddg125_lucas'], required: true, points: 125,
    });
    store.getState().createAreaEventFromReferencePoints({
      name: 'Builder area alert', side: 'RED',
      referencePointIds: ['rp_adiz_north', 'rp_adiz_east', 'rp_strike_axis'],
      message: 'Entered builder trigger area',
    });
    expect(store.getState().units.red_j20_alpha).toMatchObject({
      position: [123.1, 26.7], parentGroupId: group.id,
    });
    expect(store.getState().groups.find((candidate) => candidate.id === group.id)?.name).toBe('红方联合突击群');
    expect(store.getState().objectives.some((objective) => objective.title === 'Builder destroy objective')).toBe(true);
    expect(store.getState().events.some((event) => event.name === 'Builder area alert')).toBe(true);

    const state = store.getState();
    const exported = exportCurrentStateAsScenarioJson(state.currentScenario, state.units, {
      groups: state.groups, missions: state.missions, events: state.events,
      objectives: state.objectives, referencePoints: state.referencePoints, environment: state.environment,
    });
    const imported = compileScenario(JSON.parse(exported)).scenario;
    expect(imported.units.find((unit) => unit.id === 'red_j20_alpha')).toMatchObject({
      position: [123.1, 26.7], parentGroupId: group.id,
    });
    expect(imported.groups.find((candidate) => candidate.id === group.id)?.name).toBe('红方联合突击群');
    expect(imported.objectives?.some((objective) => objective.title === 'Builder destroy objective')).toBe(true);
    expect(imported.events?.some((event) => event.name === 'Builder area alert')).toBe(true);

    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    expect(replayBattleRecording(recording, 60)).toEqual(expected);
  });
});

describe('Independent AAR ledger', () => {
  test('preserves weapon events and fixed track samples independently of the visible log dock', () => {
    const scenario = fixture([
      placement('aar_shooter', { platformId: 'j20_mighty_dragon', parentGroupId: 'red_air_cmd',
        position: [0, 0], doctrine: { roe: 'hold', emconRadar: true } }),
      placement('aar_target', { side: 'BLUE', platformId: 'f35c_lightning', parentGroupId: 'blue_csg_air',
        position: [0.1, 0], doctrine: { roe: 'hold', emconRadar: true } }),
    ]);
    store.getState().loadScenario(scenario, false, 818);
    store.setState({ autoPause: pausesOff });
    store.getState().executeManualEngage('aar_shooter', 'RED_CONTACT_aar_target', 'pl15_aam', 1, true);
    expect(store.getState().aar.events.at(-1)).toMatchObject({
      kind: 'launch', side: 'RED', weaponId: 'pl15_aam', quantity: 1,
    });
    store.getState().stepSingleTick(5);
    expect(store.getState().aar.tracks.some((sample) => sample.unitId === 'aar_shooter')).toBe(true);
    expect(store.getState().aar.tracks.some((sample) => sample.unitId === 'aar_target')).toBe(true);
    const eventSnapshot = structuredClone(store.getState().aar.events);
    store.setState({ logs: [] });
    expect(store.getState().aar.events).toEqual(eventSnapshot);
    const summary = summarizeAar(store.getState().aar);
    expect(summary.RED.launches).toBe(1);
    expect(summary.trackedUnits).toBe(2);
  });
});

describe('Deterministic replay and scenario contracts', () => {
  test('PRNG state is serializable and continues the same stream', () => {
    const a = createRandomStream(0); a.next(); a.next();
    const b = createRandomStream(JSON.parse(JSON.stringify(a.state())));
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });

  test('recording v2 captures explicit ruleset, catalog and scenario schema versions', () => {
    store.getState().loadScenario(INFORMATION_EXERCISE, false, 321);
    const recording = captureBattleRecording();
    expect(recording).toMatchObject({
      version: BATTLE_RECORDING_VERSION,
      rulesetVersion: RULESET_VERSION,
      catalogVersion: store.getState().catalog.version,
      scenarioSchemaVersion: SCENARIO_SCHEMA_VERSION,
    });
    expect(canonicalBattleState().pendingSortieOrders).toEqual([]);
  });

  test('legacy and mismatched recording headers are rejected before replacing the battle', () => {
    store.getState().loadScenario(INFORMATION_EXERCISE, false, 322);
    const before = store.getState();
    const recording = captureBattleRecording();
    expect(() => replayBattleRecording({ ...recording, version: 1 })).toThrow('legacy v1');
    expect(() => replayBattleRecording({ ...recording, rulesetVersion: 'old-rules' })).toThrow('ruleset');
    expect(() => replayBattleRecording({ ...recording, catalogVersion: 'old-catalog' })).toThrow('catalog');
    expect(() => replayBattleRecording({ ...recording, scenarioSchemaVersion: 0 })).toThrow('schema');
    expect(store.getState()).toBe(before);
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

  test('replay can jump to an arbitrary legal Tick without recording scrubber actions', () => {
    store.getState().loadScenario(INFORMATION_EXERCISE, false, 4321);
    store.setState({ autoPause: pausesOff });
    store.getState().updateUnitDoctrine('exercise_red_scout', { emconRadar: true });
    store.getState().stepSingleTick(10);
    store.getState().appendUnitWaypoint('exercise_red_ship', [123.8, 25.05]);
    const partial = canonicalBattleState();
    const partialTick = store.getState().tick;
    store.getState().stepSingleTick(20);
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    expect(replayBattleRecording(recording, 60, partialTick)).toEqual(partial);
    expect(store.getState().commandHistory.map((command) => command.action)).toEqual([
      'updateUnitDoctrine', 'appendUnitWaypoint',
    ]);
    const beforeInvalid = store.getState();
    expect(() => replayBattleRecording(recording, 60, recording.untilTick + 1)).toThrow('Invalid replay target');
    expect(store.getState()).toBe(beforeInvalid);
  });

  test('turnaround relaunches use monotonic sortie IDs and replay identically across batches', () => {
    const carrierSpec = structuredClone(catalog.platforms.cv18_fujian_carrier);
    carrierSpec.hangarSlots![0].turnaroundSec = 1;
    carrierSpec.hangarSlots![0].turnaroundSupplyBatches = 1;
    const aircraftSpec = { ...structuredClone(catalog.platforms.j35_naval_stealth), maxFuelSec: 100 };
    const scenario = fixture([placement('carrier', {
      platformId: carrierSpec.id,
      position: [0, 0],
      speedKts: 0,
    })]);
    scenario.customCatalogOverlay = {
      version: 'turnaround-replay-test-v1',
      platforms: { [carrierSpec.id]: carrierSpec, [aircraftSpec.id]: aircraftSpec },
    };

    store.getState().loadScenario(scenario, false, 777);
    store.setState({ autoPause: pausesOff });
    store.getState().launchCarrierAircraft('carrier', 'hangar_j35_vf1', 'loadout_j35_maritime_strike');
    store.getState().stepSingleTick(90);
    const firstId = 'sortie_carrier_hangar_j35_vf1_1';
    expect(store.getState().units[firstId].status).toBe('recovered');
    expect(store.getState().units.carrier.hangar[0]).toMatchObject({
      readyAirframes: 3,
      turnaroundSupplies: 0,
      nextSortieNumber: 2,
    });
    store.getState().launchCarrierAircraft('carrier', 'hangar_j35_vf1', 'loadout_j35_carrier_cap');
    const secondId = 'sortie_carrier_hangar_j35_vf1_2';
    expect(store.getState().units[secondId]).toBeDefined();
    expect(store.getState().units.carrier.hangar[0].activeSortieIds).toEqual([secondId]);

    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    for (const batch of [1, 5, 15, 60]) expect(replayBattleRecording(recording, batch)).toEqual(expected);
  });

  test('Bashi Channel executes transit, ASW aviation, shore denial and observed-contact SEAD chains', () => {
    store.getState().loadScenario(bashi, false, 7373);
    store.setState({ autoPause: pausesOff });
    const redStart = store.getState().units.bashi_red_075.position[0];
    const blueStart = store.getState().units.bashi_blue_america.position[0];
    store.getState().stepSingleTick(2);
    let state = store.getState();
    expect(state.events.filter((event) => ['bashi_ev_red_sead_identified', 'bashi_ev_blue_sead_identified'].includes(event.id))
      .every((event) => event.fireCount === 1)).toBe(true);
    expect(state.missions.filter((mission) => mission.type === 'sead').every((mission) => mission.isActive)).toBe(true);
    expect(Object.values(state.weaponsInFlight).filter((weapon) => weapon.weaponId === 'ld10_arm')).toHaveLength(2);
    expect(Object.values(state.weaponsInFlight).filter((weapon) => weapon.weaponId === 'agm88g_aargm')).toHaveLength(2);
    expect(Object.values(state.weaponsInFlight).some((weapon) =>
      weapon.shooterId === 'bashi_red_coastal_asm' && weapon.targetType === 'unit')).toBe(true);

    store.getState().stepSingleTick(98);
    state = store.getState();
    expect(state.score.sortiesLaunched).toBe(3);
    const sorties = Object.values(state.units).filter((unit) => unit.hostCarrierId);
    expect(sorties.map((unit) => unit.platformId).sort()).toEqual(['f35b_lightning', 'mh60r_seahawk', 'z20f_asw'].sort());
    expect(sorties.find((unit) => unit.platformId === 'z20f_asw')?.mounts.some((mount) => mount.weaponId === 'yu11_lwt')).toBe(true);
    expect(sorties.find((unit) => unit.platformId === 'mh60r_seahawk')?.mounts.some((mount) => mount.weaponId === 'mk54_lwt')).toBe(true);
    expect(state.units.bashi_red_075.position[0]).toBeGreaterThan(redStart);
    expect(state.units.bashi_blue_america.position[0]).toBeLessThan(blueStart);
    expect(bashi.environment?.acousticZones.map((zone) => zone.kind).sort()).toEqual(['deep', 'shallow']);
    expect(state.units.bashi_red_039c.assignedMissionId).toBe('bashi_mission_red_asw');
    expect(state.units.bashi_blue_virginia.assignedMissionId).toBe('bashi_mission_blue_asw');
  });

  test('Bashi Channel ASW waves consume reserves then reuse a recovered Turnaround batch', () => {
    store.getState().loadScenario(bashi, false, 7373);
    store.setState((state) => ({
      autoPause: pausesOff,
      objectives: [],
      victoryConditions: undefined,
      events: state.events.filter((event) => event.id.includes('asw_wave')),
      units: Object.fromEntries(Object.entries(state.units).map(([id, runtimeUnit]) => [id,
        ['bashi_red_075', 'bashi_blue_america'].includes(id)
          ? { ...runtimeUnit, doctrine: { ...runtimeUnit.doctrine, roe: 'hold' as const, emconRadar: false } }
          : { ...runtimeUnit, status: 'recovered' as const },
      ])),
    }));
    store.getState().stepSingleTick(20);
    let state = store.getState();
    expect(state.score.sortiesLaunched).toBe(2);
    const firstBlue = Object.values(state.units).find((unit) =>
      unit.hostCarrierId === 'bashi_blue_america' && unit.platformId === 'mh60r_seahawk')!;
    const america = state.units.bashi_blue_america;
    const initialSupply = america.hangar.find((slot) => slot.slotId === 'hangar_mh60r_asw')!.turnaroundSupplies;
    store.setState((current) => ({ units: { ...current.units, [firstBlue.id]: {
      ...firstBlue, position: [...current.units.bashi_blue_america.position], status: 'returning',
      speedKts: 0, targetSpeedKts: 0,
    } } }));
    store.getState().stepSingleTick(0.25);
    expect(store.getState().units.bashi_blue_america.hangar.find((slot) => slot.slotId === 'hangar_mh60r_asw')!
      .turnaroundQueue.map((entry) => entry.sortieId)).toContain(firstBlue.id);
    store.getState().stepSingleTick(110);
    let blueSlot = store.getState().units.bashi_blue_america.hangar.find((slot) => slot.slotId === 'hangar_mh60r_asw')!;
    expect(blueSlot.turnaroundQueue).toEqual([]);
    expect(blueSlot.turnaroundSupplies).toBe(initialSupply - 1);

    store.getState().stepSingleTick(770);
    state = store.getState();
    expect(state.events.every((event) => event.fireCount === 1)).toBe(true);
    expect(state.score.sortiesLaunched).toBe(6);
    blueSlot = state.units.bashi_blue_america.hangar.find((slot) => slot.slotId === 'hangar_mh60r_asw')!;
    expect(blueSlot.nextSortieNumber).toBe(4);
    expect(blueSlot.activeSortieIds).toHaveLength(2);
    expect(blueSlot.readyAirframes).toBe(0);
    expect(state.pendingSortieOrders).toEqual([]);
  });

  test('Bashi Channel preserve and withdrawal complete together while mission kills end critically', () => {
    store.getState().loadScenario(bashi, false, 7373);
    store.setState((state) => ({
      autoPause: pausesOff,
      events: [],
      units: Object.fromEntries(Object.entries(state.units).map(([id, runtimeUnit]) => [id, {
        ...runtimeUnit,
        position: id === 'bashi_red_075' ? [122.60, 20.72] as [number, number]
          : id === 'bashi_blue_america' ? [122.30, 20.28] as [number, number] : runtimeUnit.position,
        doctrine: { ...runtimeUnit.doctrine, roe: 'hold' as const },
      }])),
    }));
    store.getState().stepSingleTick(0.25);
    let state = store.getState();
    expect(state.units.bashi_red_075.status).toBe('recovered');
    expect(state.units.bashi_blue_america.status).toBe('recovered');
    expect(state.objectiveProgress.bashi_red_withdraw_075).toBe('achieved');
    expect(state.objectiveProgress.bashi_blue_withdraw_america).toBe('achieved');
    expect(state.objectiveProgress.bashi_red_preserve_075).not.toBe('failed');
    expect(state.objectiveProgress.bashi_blue_preserve_america).not.toBe('failed');

    for (const [failedId, failedSide] of [['bashi_red_075', 'RED'], ['bashi_blue_america', 'BLUE']] as const) {
      store.getState().loadScenario(bashi, false, 7373);
      store.setState((current) => ({ autoPause: pausesOff, events: [], units: {
        ...current.units, [failedId]: { ...current.units[failedId], hp: 1, status: 'engaged' as const },
      } }));
      store.getState().stepSingleTick(0.25);
      state = store.getState();
      expect(state.battleResult?.reason).toBe('critical_objective');
      expect(state.battleResult?.outcomes[failedSide]).toBe('defeat');
      expect(state.battleResult?.outcomes[failedSide === 'RED' ? 'BLUE' : 'RED']).toBe('victory');
    }
  });

  test('Bashi Channel exposes independently completable red and blue command paths', () => {
    const runPath = (side: 'RED' | 'BLUE') => {
      store.getState().loadScenario(bashi, false, 7373);
      if (side === 'BLUE') store.getState().setPlayerSide('BLUE');
      store.setState({ autoPause: pausesOff });
      const coreId = side === 'RED' ? 'bashi_red_075' : 'bashi_blue_america';
      const exit: [number, number] = side === 'RED' ? [122.25, 20.72] : [122.75, 20.28];
      const issueDefensiveOrders = () => {
        for (const runtimeUnit of Object.values(store.getState().units)) {
          if (runtimeUnit.side === side && runtimeUnit.status !== 'destroyed' && runtimeUnit.status !== 'recovered' &&
              runtimeUnit.doctrine.roe !== 'tight') store.getState().updateUnitDoctrine(runtimeUnit.id, { roe: 'tight' });
        }
      };
      issueDefensiveOrders();
      store.getState().appendUnitWaypoint(coreId, exit, true, 22, 0);
      store.getState().updateUnitKinematics(coreId, 22, 0);
      store.getState().stepSingleTick(0.25);
      issueDefensiveOrders();
      while (!store.getState().battleResult &&
          (store.getState().simTime - store.getState().startTime) / 1000 < bashi.victoryConditions!.durationSec) {
        store.getState().stepSingleTick(30);
        issueDefensiveOrders();
      }
      const ended = store.getState();
      const withdrawId = side === 'RED' ? 'bashi_red_withdraw_075' : 'bashi_blue_withdraw_america';
      const preserveId = side === 'RED' ? 'bashi_red_preserve_075' : 'bashi_blue_preserve_america';
      expect(ended.units[coreId].status).toBe('recovered');
      expect(ended.objectiveProgress[withdrawId]).toBe('achieved');
      expect(ended.objectiveProgress[preserveId]).toBe('achieved');
      expect(ended.battleResult?.outcomes[side]).not.toBe('defeat');
      expect(ended.commandHistory.length).toBeGreaterThan(2);
      const scoreAfter = side === 'RED' ? ended.score.redScore : ended.score.blueScore;
      store.getState().stepSingleTick(10);
      expect(side === 'RED' ? store.getState().score.redScore : store.getState().score.blueScore).toBe(scoreAfter);
    };
    runPath('RED');
    runPath('BLUE');
  }, 40_000);

  test('Bashi Channel seed 7373 reaches a finite reproducible no-command terminal', () => {
    store.getState().loadScenario(bashi, false, 7373);
    store.setState({ autoPause: pausesOff });
    store.getState().stepSingleTick(bashi.victoryConditions!.durationSec + 1);
    const state = store.getState();
    expect({
      tick: state.tick,
      reason: state.battleResult?.reason,
      outcomes: state.battleResult?.outcomes,
      losses: [state.score.redLosses, state.score.blueLosses],
      fired: [state.score.redMissilesFired, state.score.blueMissilesFired],
      sorties: state.score.sortiesLaunched,
      aar: state.aar.events.length,
    }).toEqual({
      tick: 12000,
      reason: 'time_limit',
      outcomes: { RED: 'costly_victory', BLUE: 'costly_victory' },
      losses: [1, 8],
      fired: [146, 142],
      sorties: 5,
      aar: 245,
    });
    expect(state.pendingSortieOrders.filter((order) => order.status === 'pending')).toEqual([]);
    expect(state.pendingSortieOrders.filter((order) => order.status === 'failed')
      .every((order) => !!order.failureReason)).toBe(true);
    expect(state.events.every((event) => event.fireCount === 1)).toBe(true);
    expect(state.objectiveProgress.bashi_red_withdraw_075).toBe('achieved');
    expect(state.objectiveProgress.bashi_blue_withdraw_america).toBe('achieved');
    expect(Object.values(state.units).every((unit) =>
      Number.isFinite(unit.position[0]) && Number.isFinite(unit.position[1]) && Number.isFinite(unit.hp))).toBe(true);
    const frozen = canonicalBattleState();
    store.getState().stepSingleTick(60);
    expect(canonicalBattleState()).toEqual(frozen);
  }, 20_000);

  test('Bashi Channel red and blue support aircraft transfer finite tanker fuel', () => {
    store.getState().loadScenario(bashi, false, 7373);
    store.setState((state) => {
      const tanker = state.units.bashi_red_y20u;
      const receiver = state.units.bashi_red_j10c;
      return { autoPause: pausesOff, units: { ...state.units, bashi_red_j10c: {
        ...receiver, position: [...tanker.position], altitudeM: tanker.altitudeM,
        targetAltitudeM: tanker.altitudeM, speedKts: tanker.speedKts, targetSpeedKts: tanker.speedKts,
        fuelRemainingSec: receiver.maxFuelSec - 300,
      } } };
    });
    const redFuelBefore = store.getState().units.bashi_red_j10c.fuelRemainingSec;
    const redTransferBefore = store.getState().units.bashi_red_y20u.aarFuelRemainingSec!;
    store.getState().requestAirRefuel('bashi_red_j10c', 'bashi_red_y20u');
    store.getState().stepSingleTick(3);
    expect(store.getState().units.bashi_red_j10c.fuelRemainingSec).toBeGreaterThan(redFuelBefore);
    expect(store.getState().units.bashi_red_y20u.aarFuelRemainingSec).toBeLessThan(redTransferBefore);

    store.getState().loadScenario(bashi, false, 7373);
    store.getState().setPlayerSide('BLUE');
    store.setState((state) => {
      const tanker = state.units.bashi_blue_kc135;
      const receiver = state.units.bashi_blue_ea18g;
      return { autoPause: pausesOff, units: { ...state.units, bashi_blue_ea18g: {
        ...receiver, position: [...tanker.position], altitudeM: tanker.altitudeM,
        targetAltitudeM: tanker.altitudeM, speedKts: tanker.speedKts, targetSpeedKts: tanker.speedKts,
        fuelRemainingSec: receiver.maxFuelSec - 300,
      } } };
    });
    const blueFuelBefore = store.getState().units.bashi_blue_ea18g.fuelRemainingSec;
    const blueTransferBefore = store.getState().units.bashi_blue_kc135.aarFuelRemainingSec!;
    store.getState().requestAirRefuel('bashi_blue_ea18g', 'bashi_blue_kc135');
    store.getState().stepSingleTick(3);
    expect(store.getState().units.bashi_blue_ea18g.fuelRemainingSec).toBeGreaterThan(blueFuelBefore);
    expect(store.getState().units.bashi_blue_kc135.aarFuelRemainingSec).toBeLessThan(blueTransferBefore);
  });

  test('upgraded East Sea scenario executes ASW, decoy, SEAD and saturation chains by 200 seconds', () => {
    store.getState().loadScenario(east, false, 5150);
    store.setState({ autoPause: pausesOff });
    const initialPlatforms = new Set(Object.values(store.getState().units).map((unit) => unit.platformId));
    for (const platformId of ['type054b_frigate', 'type039c_ssk', 'y9g_jammer', 'j10c_multirole',
      'constellation_ffg', 'taigei_ssk', 'mq4c_triton']) expect(initialPlatforms).toContain(platformId);
    store.getState().stepSingleTick(200);
    const state = store.getState();
    expect(state.events.filter((event) => ['ev_east_asw_helo_launch_30s', 'ev_blue_mald_screen_90s',
      'ev_red_sead_on_classified_land_contact', 'ev_b1b_maritime_salvo_180s'].includes(event.id))
      .every((event) => (event.fireCount ?? 0) === 1)).toBe(true);
    expect(Object.values(state.units).some((unit) => unit.platformId === 'b1b_lancer')).toBe(true);
    expect(Object.values(state.units).some((unit) => unit.platformId === 'adm160_mald')).toBe(true);
    expect(Object.values(state.units).filter((unit) => ['z20f_asw', 'mh60r_seahawk'].includes(unit.platformId))).toHaveLength(2);
    expect(state.missions.find((mission) => mission.id === 'mission_red_sead')?.isActive).toBe(true);
    expect(state.units.red_j10c_reinforce.assignedMissionId).toBe('mission_red_sead');
    expect(state.pendingSortieOrders).toEqual([]);
  });

  test('event-driven OPFOR reactions replay identically across speed batches', () => {
    store.getState().loadScenario(deep, false, 808);
    store.setState({ autoPause: pausesOff });
    store.getState().stepSingleTick(60);
    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    for (const batch of [1, 5, 15, 60]) expect(replayBattleRecording(recording, batch)).toEqual(expected);
  });

  test('queued and delayed event sorties replay at the same Tick across batches', () => {
    const scenario = fixture([
      placement('replay_carrier', { platformId: 'cv18_fujian_carrier', parentGroupId: 'red_surface_tg', position: [0, 0], speedKts: 0 }),
    ]);
    scenario.events = [{
      id: 'queued_sortie', name: 'Queued sortie', description: 'Replay queue',
      trigger: { type: 'TIME_ELAPSED', elapsedSec: 0 },
      actions: [{ type: 'LAUNCH_SORTIE', carrierUnitId: 'replay_carrier', hangarSlotId: 'hangar_j35_vf1',
        loadoutId: 'loadout_j35_carrier_cap', launchDelaySec: 1 }],
    }];
    store.getState().loadScenario(scenario, false, 8181);
    store.setState({ autoPause: pausesOff });
    store.getState().stepSingleTick(2);
    expect(store.getState().score.sortiesLaunched).toBe(1);
    expect(store.getState().pendingSortieOrders).toEqual([]);
    const launched = Object.values(store.getState().units).find((unit) => unit.hostCarrierId === 'replay_carrier');
    expect(launched?.id).toBe('sortie_replay_carrier_hangar_j35_vf1_1');
    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    for (const batch of [1, 5, 15, 60]) expect(replayBattleRecording(recording, batch)).toEqual(expected);
  });

  test('observed evasion and PRNG soft-kill outcomes replay identically across batches', () => {
    const scenario = fixture([
      placement('red_fighter', { platformId: 'j20_mighty_dragon', parentGroupId: 'red_air_cmd',
        position: [0, 0], doctrine: { roe: 'hold', emconRadar: true } }),
      placement('blue_fighter', { side: 'BLUE', platformId: 'f35c_lightning', parentGroupId: 'blue_csg_air',
        position: [0.1, 0], doctrine: { roe: 'hold', emconRadar: true } }),
    ]);
    store.getState().loadScenario(scenario, false, 909);
    store.setState({ autoPause: pausesOff });
    store.getState().executeManualEngage('red_fighter', 'RED_CONTACT_blue_fighter', 'pl15_aam', 1, true);
    store.getState().stepSingleTick(20);
    expect(store.getState().units.blue_fighter.countermeasures.chaff).toBeLessThan(4);
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
