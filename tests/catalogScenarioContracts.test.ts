import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog, resolveEquipmentCatalog, validateCatalogIntegrity } from '../src/db';
import { resolveUnitConfiguration } from '../src/db/unitConfiguration';
import { compileScenario } from '../src/scenarios/compileScenario';
import {
  SCENARIO_EAST_SEA_THUNDER as east,
  SCENARIO_DEEP_SEA_CARRIER_HUNT as deep,
  instantiateScenarioUnits,
  validateAndParseScenarioJson,
  exportCurrentStateAsScenarioJson,
} from '../src/scenarios/builtinScenarios';
import { createRuntimeUnitFromPlacement, stepSimulationWorld, type SimulationWorldState } from '../src/engine/simulationEngine';
import { deriveMissionAssignments } from '../src/engine/missions';
import { getEventOccurrences } from '../src/engine/scenarioEvents';
import { useWargameStore as store } from '../src/store/useWargameStore';
import type {
  EquipmentCatalog, InitialUnitPlacement, RuntimeScenarioEvent, RuntimeUnit,
  ScenarioDefinition, ScenarioEventRule, TacticalContact, WeaponInFlight,
} from '../src/types/wargame';

function placement(id: string, platformId = 'j20_mighty_dragon', extra: Partial<InitialUnitPlacement> = {}): InitialUnitPlacement {
  const side = extra.side ?? 'RED';
  return {
    id, name: id, callsign: id, platformId, side,
    parentGroupId: side === 'RED' ? 'red_air_cmd' : 'blue_csg_air',
    position: [0, 0], heading: 0, speedKts: 0,
    doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: false },
    ...extra,
  };
}

function scenario(units: InitialUnitPlacement[] = [], extra: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return { ...structuredClone(east), units, missions: [], events: [], referencePoints: [], ...extra };
}

function world(units: RuntimeUnit[] = [], events: ScenarioEventRule[] = []): SimulationWorldState {
  return {
    startTime: 0, simTime: 0, units: Object.fromEntries(units.map((unit) => [unit.id, unit])),
    contacts: {}, weaponsInFlight: {}, explosions: [], missions: [], events,
    score: { redLosses: 0, blueLosses: 0, redMissilesFired: 0, blueMissilesFired: 0,
      redInterceptions: 0, blueInterceptions: 0, redScore: 0, blueScore: 0,
      firedEventIds: [], sortiesLaunched: 0 },
  };
}

function unit(p: InitialUnitPlacement, c = catalog) {
  return createRuntimeUnitFromPlacement(p, c, () => 0.5);
}

function tick(state: SimulationWorldState, dt = 1, c = catalog) {
  return stepSimulationWorld(state, c, dt, {
    onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false,
  }, 'GOD', () => 0.5).nextState;
}

function timedEvent(extra: Partial<ScenarioEventRule> = {}): ScenarioEventRule {
  return {
    id: 'event', name: 'event', description: '', trigger: { type: 'TIME_ELAPSED', elapsedSec: 1 },
    actions: [{ type: 'AWARD_SCORE', side: 'RED', points: 10, reason: 'test' }], ...extra,
  };
}

function tankOverlay(): Partial<EquipmentCatalog> {
  return { loadouts: { tanks: { ...catalog.loadouts.loadout_j20_stealth_cap,
    id: 'tanks', combatRadiusMultiplier: 2, speedPenaltyKts: 80,
    additionalSensorIds: ['eots_irst', 'klc7_awacs_radar'],
  } } };
}

describe('Scenario input boundary', () => {
  test.each([{ input: null }, { input: [] }, { input: { id: 'bad', title: 'bad', units: [] } }])('rejects incomplete input %j', ({ input }) => {
    expect(validateAndParseScenarioJson(JSON.stringify(input)).valid).toBe(false);
  });

  test('rejects bad coordinates, dates, numeric values and duplicate IDs', () => {
    const cases = [
      scenario([placement('a', undefined, { position: [181, 0] })]),
      scenario([placement('a', undefined, { appearProbability: -1 })]),
      scenario([placement('a', undefined, { speedKts: 2000 })]),
      scenario([placement('a', undefined, { altitudeM: -20 })]),
      scenario([placement('a'), placement('a')]),
      scenario([], { startTimeIso: 'not-a-date' }),
    ];
    for (const input of cases) expect(validateAndParseScenarioJson(JSON.stringify(input)).valid).toBe(false);
    expect(() => compileScenario(scenario([placement('a', undefined, { speedKts: NaN })]))).toThrow();
  });

  test('validates reinforcement and event references before the first tick', () => {
    const badSpawn = timedEvent({ actions: [{ type: 'SPAWN_REINFORCEMENTS', units: [placement('late', 'missing')] }] });
    const badMission = timedEvent({ actions: [{ type: 'ACTIVATE_MISSION', missionId: 'missing', isActive: true }] });
    const badTarget = timedEvent({ trigger: { type: 'UNIT_DESTROYED', unitId: 'missing' } });
    for (const event of [badSpawn, badMission, badTarget]) {
      expect(validateAndParseScenarioJson(JSON.stringify(scenario([], { events: [event] }))).valid).toBe(false);
    }
    const duplicate = timedEvent({ actions: [{ type: 'SPAWN_REINFORCEMENTS', units: [placement('a')] }] });
    expect(() => compileScenario(scenario([placement('a')], { events: [duplicate] }))).toThrow('duplicate');
  });

  test('rejects malformed or internally invalid overlays without throwing from the parser', () => {
    const malformed = { ...scenario(), customCatalogOverlay: { platforms: { broken: { id: 'broken' } } } };
    expect(validateAndParseScenarioJson(JSON.stringify(malformed)).valid).toBe(false);
    const badLoadout = { ...catalog.loadouts.loadout_j20_stealth_cap,
      mounts: [{ mountId: 'missing', weaponId: 'missing', maxAmmo: 1, reloadTimeSec: 1 }],
    };
    expect(validateAndParseScenarioJson(JSON.stringify(scenario([], {
      customCatalogOverlay: { loadouts: { [badLoadout.id]: badLoadout } },
    }))).valid).toBe(false);
  });

  test('rejects incompatible loadouts in JSON, the factory, catalog defaults and hangars', () => {
    const p = placement('a', undefined, { loadoutId: 'loadout_f35c_stealth_cap' });
    expect(validateAndParseScenarioJson(JSON.stringify(scenario([p]))).valid).toBe(false);
    expect(() => unit(p)).toThrow('incompatible');
    expect(() => unit({ ...p, loadoutId: 'missing' })).toThrow('Unknown loadout');
    const c = structuredClone(catalog);
    c.platforms.j20_mighty_dragon.defaultLoadoutId = p.loadoutId;
    expect(validateCatalogIntegrity(c).valid).toBe(false);
    const h = structuredClone(catalog);
    h.platforms.cv18_fujian_carrier.hangarSlots![0].availableLoadoutIds.push('loadout_f35c_stealth_cap');
    expect(validateCatalogIntegrity(h).valid).toBe(false);
  });

  test('catalog validation checks ranges, inventory, identity and duplicate mount IDs', () => {
    const c = structuredClone(catalog);
    c.weapons.pl15_aam.basePk = 2;
    expect(validateCatalogIntegrity(c).valid).toBe(false);
    c.weapons.pl15_aam.basePk = 0.5;
    c.weapons.pl15_aam.id = 'mismatched';
    expect(validateCatalogIntegrity(c).valid).toBe(false);
    const h = structuredClone(catalog);
    h.platforms.cv18_fujian_carrier.hangarSlots![0].readyAirframes = 100;
    expect(validateCatalogIntegrity(h).valid).toBe(false);
    const m = structuredClone(catalog);
    m.loadouts.loadout_j20_stealth_cap.mounts.push({ ...m.loadouts.loadout_j20_stealth_cap.mounts[0] });
    expect(validateCatalogIntegrity(m).valid).toBe(false);
    const inherited = structuredClone(catalog);
    inherited.platforms.j20_mighty_dragon.defaultLoadoutId = 'toString';
    expect(validateCatalogIntegrity(inherited).valid).toBe(false);
  });

  test('load failure leaves the existing store untouched', () => {
    const before = store.getState();
    expect(() => store.getState().loadScenario({ id: 'bad', title: 'bad', units: [] } as unknown as ScenarioDefinition)).toThrow();
    expect(store.getState()).toBe(before);
  });

  test('probability zero never spawns even when the RNG returns zero', () => {
    const input = scenario([placement('never', undefined, { appearProbability: 0 })]);
    expect(Object.keys(instantiateScenarioUnits(input, catalog, () => 0))).toEqual([]);
  });
});

describe('Resolved equipment configuration', () => {
  test('loadouts replace fallback mounts and merge sensors without duplicates', () => {
    const c = resolveEquipmentCatalog(tankOverlay());
    const resolved = resolveUnitConfiguration(c, 'j20_mighty_dragon', 'tanks');
    expect(resolved.maxSpeedKts).toBe(1100);
    expect(resolved.cruiseSpeedKts).toBe(600);
    expect(resolved.maxFuelSec).toBe(14400);
    expect(resolved.sensorIds.filter((id) => id === 'eots_irst')).toHaveLength(1);
    expect(resolved.sensorIds).toContain('klc7_awacs_radar');
    c.loadouts.tanks.mounts = [];
    expect(resolveUnitConfiguration(c, 'j20_mighty_dragon', 'tanks').mounts).toEqual([]);
  });

  test('loadout sensors really participate in detection', () => {
    const c = structuredClone(catalog);
    c.platforms.j20_mighty_dragon.sensorIds = [];
    const observer = unit(placement('observer'), c);
    const target = unit(placement('target', 'e2d_hawkeye', { side: 'BLUE', position: [0, 0.3] }), c);
    const state = world([observer, target]);
    expect(tick(state, 1, c).contacts.RED_CONTACT_target).toBeUndefined();
    c.loadouts.loadout_j20_stealth_cap.additionalSensorIds = ['eots_irst'];
    expect(tick(state, 1, c).contacts.RED_CONTACT_target).toBeDefined();
  });

  test('creation, switching, waypoint orders and speed commands use the same limits', () => {
    const overlay = tankOverlay();
    const p = placement('a', undefined, { speedKts: undefined });
    const direct = unit({ ...p, loadoutId: 'tanks' }, resolveEquipmentCatalog(overlay));
    store.getState().loadScenario(scenario([p], { customCatalogOverlay: overlay }));
    store.getState().switchUnitLoadout('a', 'tanks');
    const switched = store.getState().units.a;
    expect(switched.maxFuelSec).toBe(direct.maxFuelSec);
    expect(switched.targetSpeedKts).toBe(direct.targetSpeedKts);
    expect(switched.fuelRemainingSec).toBe(direct.maxFuelSec);
    store.getState().updateUnitKinematics('a', 2000);
    expect(store.getState().units.a.speedKts).toBe(1100);
    store.getState().updateUnitKinematics('a', 0);
    store.getState().appendUnitWaypoint('a', [0, 1]);
    expect(store.getState().units.a.speedKts).toBe(600);
  });

  test('switching endurance profiles preserves fuel fraction, including empty tanks', () => {
    store.getState().loadScenario(scenario([placement('a', undefined, { loadoutId: 'tanks' })], {
      customCatalogOverlay: tankOverlay(),
    }));
    const aircraft = { ...store.getState().units.a, fuelRemainingSec: 0 };
    store.setState({ units: { a: aircraft } });
    store.getState().switchUnitLoadout('a', 'loadout_j20_stealth_cap');
    store.getState().switchUnitLoadout('a', 'tanks');
    expect(store.getState().units.a.fuelRemainingSec).toBe(0);
  });

  test('automatic launches honor mount-specific reload time and do not mutate the input world', () => {
    const shooter = unit(placement('shooter', undefined, { doctrine: { roe: 'free', emconRadar: true } }));
    const target = unit(placement('target', 'e2d_hawkeye', { side: 'BLUE', position: [0, 0.5] }));
    const before = world([shooter, target]);
    const after = tick(before);
    expect(after.units.shooter.mounts[0].cooldownRemainingSec).toBe(6);
    expect(after.units.shooter.weaponUsage.pl15_aam.expended).toBe(2);
    expect(shooter.weaponUsage).toEqual({});
    expect(shooter.mounts[0].currentAmmo).toBe(8);
    expect(tick(after).units.shooter.mounts[0].cooldownRemainingSec).toBe(5);
  });

  test('interception uses its configured reload interval', () => {
    const defender = unit(placement('defender', 'type055_destroyer', { doctrine: { roe: 'tight', emconRadar: true } }));
    const w = catalog.weapons.yj18_ashm;
    const missile: WeaponInFlight = {
      id: 'incoming', weaponId: w.id, name: w.name, side: 'BLUE', shooterId: 'other', shooterName: 'other',
      targetId: defender.id, targetType: 'unit', position: [0, 0.2], launchPosition: [0, 0.5], trail: [],
      altitudeM: 12, heading: 180, speedKts: w.speedKts, distanceRemainingKm: 22,
      maxRangeKm: w.maxRangeKm, traveledKm: 0, basePk: w.basePk, warheadDamage: w.warheadDamage,
    };
    const initial = world([defender]);
    initial.weaponsInFlight.incoming = missile;
    const after = tick(initial);
    expect(after.units.defender.mounts.find((m) => m.weaponId === 'hhq9b_sam')!.cooldownRemainingSec).toBe(4);
  });

  test('manual fire cannot bypass cooldown or replenish ammo by switching loadouts', () => {
    store.getState().loadScenario(scenario([
      placement('shooter'), placement('target', 'e2d_hawkeye', { side: 'BLUE', position: [0, 0.5] }),
    ]));
    store.getState().executeManualEngage('shooter', 'target', 'pl15_aam', 2, true);
    const afterShot = store.getState();
    expect(afterShot.units.shooter.mounts[0].currentAmmo).toBe(6);
    store.getState().executeManualEngage('shooter', 'target', 'pl15_aam', 2, true);
    expect(store.getState().score.redMissilesFired).toBe(2);
    store.getState().switchUnitLoadout('shooter', 'loadout_j20_awacs_hunter');
    store.getState().switchUnitLoadout('shooter', 'loadout_j20_stealth_cap');
    expect(store.getState().units.shooter.mounts[0].currentAmmo).toBe(6);
    expect(store.getState().units.shooter.mounts[0].cooldownRemainingSec).toBe(6);
    store.getState().stepSingleTick(6);
    store.getState().executeManualEngage('shooter', 'target', 'pl15_aam', 2, true);
    expect(store.getState().score.redMissilesFired).toBe(4);
  });

  test('hangar launches enforce compatibility, availability, timers and finite reserves', () => {
    store.getState().loadScenario(scenario([placement('carrier', 'cv18_fujian_carrier')]));
    const initial = store.getState();
    store.getState().launchCarrierAircraft('carrier', 'hangar_j35_vf1', 'loadout_f35c_stealth_cap');
    expect(store.getState()).toBe(initial);
    for (let i = 1; i <= 3; i++) {
      store.getState().launchCarrierAircraft('carrier', 'hangar_j35_vf1', 'loadout_j35_maritime_strike');
      expect(store.getState().score.sortiesLaunched).toBe(i);
      expect(store.getState().units.carrier.hangar[0].cooldownRemainingSec).toBe(15);
      const launched = Object.values(store.getState().units).filter((u) => u.hostCarrierId === 'carrier');
      expect(launched.at(-1)!.speedKts).toBe(572.5);
      store.getState().launchCarrierAircraft('carrier', 'hangar_j35_vf1');
      expect(store.getState().score.sortiesLaunched).toBe(i);
      store.getState().stepSingleTick(15);
    }
    store.getState().launchCarrierAircraft('carrier', 'hangar_j35_vf1');
    expect(store.getState().score.sortiesLaunched).toBe(3);
    expect(store.getState().units.carrier.hangar[0].reserveAirframes).toBe(0);
    expect(store.getState().units.carrier.hangar[0].readyAirframes).toBe(0);
  });

  test('a compatible loadout can still be unavailable in a particular hangar', () => {
    const carrier = structuredClone(catalog.platforms.cv18_fujian_carrier);
    carrier.hangarSlots![0].availableLoadoutIds = ['loadout_j35_carrier_cap'];
    store.getState().loadScenario(scenario([placement('carrier', carrier.id)], {
      customCatalogOverlay: { platforms: { [carrier.id]: carrier } },
    }));
    const before = store.getState();
    store.getState().launchCarrierAircraft('carrier', 'hangar_j35_vf1', 'loadout_j35_maritime_strike');
    expect(store.getState()).toBe(before);
  });

  test('an initially unready hangar prepares reserves without creating extra aircraft', () => {
    const c = structuredClone(catalog);
    c.platforms.cv18_fujian_carrier.hangarSlots![0].readyAirframes = 0;
    const carrier = unit(placement('carrier', 'cv18_fujian_carrier'), c);
    expect(carrier.hangar[0].reserveAirframes).toBe(3);
    const prepared = tick(world([carrier]), 15, c).units.carrier.hangar[0];
    expect(prepared.readyAirframes).toBe(1);
    expect(prepared.reserveAirframes).toBe(2);
  });
});

describe('Mission ownership and event lifecycle', () => {
  test('built-in submarine assignments drive both AI and the derived mission roster', () => {
    const units = instantiateScenarioUnits(deep);
    expect(units.red_093b_wolf1.assignedMissionId).toBe('mission_red_asuw_hunt');
    expect(deriveMissionAssignments(deep.missions, units)[0].assignedUnitIds).toEqual(['red_093b_wolf1', 'red_093b_wolf2']);
    units.red_093b_wolf1.waypoints = [];
    const next = tick({ ...world(Object.values(units)), missions: deep.missions });
    expect(next.units.red_093b_wolf1.waypoints.length).toBeGreaterThan(0);
  });

  test('legacy rosters migrate without mutation, and contradictory assignments are rejected', () => {
    const mission = { ...deep.missions[0], assignedUnitIds: ['a'] };
    const input = scenario([placement('a')], { missions: [mission] });
    const normalized = compileScenario(input).scenario;
    expect(normalized.units[0].assignedMissionId).toBe(mission.id);
    expect(normalized.missions[0].assignedUnitIds).toBeUndefined();
    expect(input.units[0].assignedMissionId).toBeUndefined();
    input.units[0].assignedMissionId = 'other';
    expect(() => compileScenario(input)).toThrow('conflicting');
  });

  test('reassignment rejects wrong-side missions and updates the derived roster immediately', () => {
    store.getState().loadScenario(east);
    store.getState().assignUnitMission('red_j20_alpha', 'mission_blue_aaw_barrier');
    expect(store.getState().units.red_j20_alpha.assignedMissionId).toBe('mission_red_aaw_cap');
    store.getState().assignUnitMission('red_j20_alpha', undefined);
    expect(store.getState().missions.find((m) => m.id === 'mission_red_aaw_cap')!.assignedUnitIds).toEqual([]);
  });

  test('repeatable timers require an explicit interval', () => {
    expect(() => compileScenario(scenario([], { events: [timedEvent({ repeatable: true })] }))).toThrow('repeatIntervalSec');
    expect(() => compileScenario(scenario([], { events: [timedEvent({ repeatable: true, repeatIntervalSec: 2 })] }))).not.toThrow();
  });

  test('timer catch-up produces the same event count for fine and coarse steps', () => {
    const event = timedEvent({ repeatable: true, repeatIntervalSec: 2 });
    let fine = world([], [event]);
    for (let i = 0; i < 10; i++) fine = tick(fine);
    const coarse = tick(world([], [event]), 10);
    expect(fine.score.redScore).toBe(50);
    expect(coarse.score.redScore).toBe(50);
    expect(fine.events![0].fireCount).toBe(5);
    expect(event).not.toHaveProperty('fireCount');
  });

  test('runtime event progress cannot leak into a newly loaded scenario', () => {
    const event = { ...timedEvent({ trigger: { type: 'TIME_ELAPSED', elapsedSec: 2 } }), hasFired: true, fireCount: 100 };
    const compiled = compileScenario(scenario([], { events: [event] }));
    expect(compiled.scenario.events![0]).not.toHaveProperty('hasFired');
    store.getState().loadScenario(compiled.scenario);
    store.getState().stepSingleTick(1);
    expect(store.getState().score.redScore).toBe(0);
    store.getState().stepSingleTick(1);
    expect(store.getState().score.redScore).toBe(10);
  });

  test('destruction rules fire once per destroyed unit, not once per tick', () => {
    const event = timedEvent({ repeatable: true, trigger: { type: 'UNIT_DESTROYED', targetSide: 'RED' } });
    const a = unit(placement('a'));
    const b = unit(placement('b'));
    a.hp = 0;
    let current = tick(world([a, b], [event]));
    expect(current.score.redScore).toBe(10);
    current = tick(current);
    expect(current.score.redScore).toBe(10);
    current.units.b.hp = 0;
    expect(tick(current).score.redScore).toBe(20);
  });

  test('area entry and detection re-arm after a unit leaves or contact is lost', () => {
    const target = unit(placement('a'));
    const area: RuntimeScenarioEvent = timedEvent({ repeatable: true, trigger: {
      type: 'UNIT_ENTERS_AREA', side: 'RED', areaPolygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
    } });
    expect(getEventOccurrences(area, { a: target }, {}, 1)).toBe(1);
    expect(getEventOccurrences(area, { a: target }, {}, 2)).toBe(0);
    target.position = [10, 10];
    expect(getEventOccurrences(area, { a: target }, {}, 3)).toBe(0);
    target.position = [0, 0];
    expect(getEventOccurrences(area, { a: target }, {}, 4)).toBe(1);
    const detected: RuntimeScenarioEvent = timedEvent({ repeatable: true, trigger: { type: 'UNIT_DETECTED', observerSide: 'BLUE' } });
    const contact = { actualUnitId: 'a', observerSide: 'BLUE' } as TacticalContact;
    expect(getEventOccurrences(detected, { a: target }, { a: contact }, 1)).toBe(1);
    expect(getEventOccurrences(detected, { a: target }, { a: contact }, 2)).toBe(0);
    getEventOccurrences(detected, { a: target }, {}, 3);
    expect(getEventOccurrences(detected, { a: target }, { a: contact }, 4)).toBe(1);
  });

  test('repeat reinforcements have unique IDs and update mission rosters without resetting survivors', () => {
    const mission = deep.missions[0];
    const event = timedEvent({ repeatable: true, repeatIntervalSec: 2,
      actions: [{ type: 'SPAWN_REINFORCEMENTS', units: [placement('wave', undefined, { assignedMissionId: mission.id })] }],
    });
    let current = tick({ ...world([], [event]), missions: [mission] });
    current.units.wave.hp = 7;
    current.units.wave.mounts[0].currentAmmo = 0;
    current = tick(current, 2);
    expect(Object.keys(current.units)).toHaveLength(2);
    expect(current.units.wave.hp).toBe(7);
    expect(current.units.wave.mounts[0].currentAmmo).toBe(0);
    expect(current.missions[0].assignedUnitIds).toHaveLength(2);
  });

  test('scenario export remains importable after reinforcements, reassignment and losses', () => {
    const input = structuredClone(east);
    input.units = input.units.map((p) => ({ ...p, speedKts: 0, doctrine: { ...p.doctrine, roe: 'hold' } }));
    const initial = instantiateScenarioUnits(input);
    const state = tick({ ...world(Object.values(initial), input.events), missions: input.missions }, 61);
    state.units.red_j20_alpha.assignedMissionId = undefined;
    state.units.blue_pac3_ishigaki.hp = 0;
    state.units.blue_pac3_ishigaki.status = 'destroyed';
    const parsed = validateAndParseScenarioJson(exportCurrentStateAsScenarioJson(input, state.units));
    expect(parsed.valid).toBe(true);
    expect(parsed.scenario!.units.filter((u) => u.id === 'blue_f35c_kadena_reinforce')).toHaveLength(1);
    expect(parsed.scenario!.units.find((u) => u.id === 'red_j20_alpha')!.assignedMissionId).toBeUndefined();
  });
});
