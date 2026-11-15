import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog, resolveEquipmentCatalog, validateCatalogIntegrity } from '../../src/db';
import { resolveUnitConfiguration } from '../../src/db/unitConfiguration';
import { compileScenario } from '../../src/scenarios/compileScenario';
import {
  BUILTIN_SCENARIOS,
  SCENARIO_EAST_SEA_THUNDER as east,
  SCENARIO_DEEP_SEA_CARRIER_HUNT as deep,
  instantiateScenarioUnits,
  validateAndParseScenarioJson,
  exportCurrentStateAsScenarioJson,
} from '../../src/scenarios/builtinScenarios';
import { createRuntimeUnitFromPlacement, stepSimulationWorld, type SimulationWorldState } from '../../src/engine/simulationEngine';
import { resolveEventsAndObjectives } from '../../src/engine/simulation/eventResolver';
import { processPendingSortieOrders } from '../../src/engine/carrierOperations';
import { runAutoDefense } from '../../src/engine/simulation/autoDefense';
import { deriveMissionAssignments } from '../../src/engine/missions';
import { getEventOccurrences } from '../../src/engine/scenarioEvents';
import { computeContactsOnly, evaluateTargetEcmSuppression } from '../../src/engine/sensors';
import { useWargameStore as store } from '../../src/store/useWargameStore';
import type {
  EquipmentCatalog, InitialUnitPlacement, RuntimeScenarioEvent, RuntimeUnit,
  ScenarioDefinition, ScenarioEventRule, ScenarioObjective, TacticalContact, TacticalMission, WeaponInFlight,
} from '../../src/types/wargame';

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
  return { ...structuredClone(east), units, missions: [], events: [], objectives: [], referencePoints: [], ...extra };
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

  test('normalizes legacy coordinate waypoints into route legs and validates per-leg limits', () => {
    const input = scenario([placement('route', undefined, {
      waypoints: [[1, 1], { position: [2, 2], speedKts: 500, altitudeM: 5000 }],
    })]);
    const compiled = compileScenario(input).scenario;
    expect(compiled.units[0].waypoints).toEqual([
      { position: [1, 1] },
      { position: [2, 2], speedKts: 500, altitudeM: 5000 },
    ]);
    const tooFast = structuredClone(input);
    tooFast.units[0].waypoints = [{ position: [1, 1], speedKts: 5000 }];
    expect(() => compileScenario(tooFast)).toThrow('waypoints[0].speedKts');
    const tooLow = structuredClone(input);
    tooLow.units[0].waypoints = [{ position: [1, 1], altitudeM: -100 }];
    expect(() => compileScenario(tooLow)).toThrow('waypoints[0].altitudeM');
  });

  test('validates environment polygons and initial unit domain placement', () => {
    const environment = {
      landPolygons: [{ id: 'land', name: 'Land', areaPolygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][] }],
      acousticZones: [],
    };
    expect(() => compileScenario(scenario([placement('ship', 'type055_destroyer', { position: [0, 0] })], { environment })))
      .toThrow('outside the configured domain environment');
    expect(() => compileScenario(scenario([placement('sam', 'hq9b_sam_site', { position: [2, 2] })], { environment })))
      .toThrow('outside the configured domain environment');
    const invalidEnvironment = structuredClone(environment);
    invalidEnvironment.landPolygons[0].areaPolygon = [[0, 0], [1, 1], [1, 0], [0, 1]];
    expect(() => compileScenario(scenario([], { environment: invalidEnvironment }))).toThrow('non-self-intersecting');
  });

  test('validates withdraw areas, target ownership and allowed domains before the first tick', () => {
    const ship = placement('withdraw_ship', 'type055_destroyer');
    const baseObjective = {
      id: 'withdraw', side: 'RED' as const, title: 'Withdraw', type: 'withdraw' as const,
      unitIds: [ship.id], required: true, points: 100,
      withdrawAreaPolygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][],
      withdrawUnitDomains: ['surface' as const],
    };
    expect(() => compileScenario(scenario([ship], { objectives: [baseObjective] }))).not.toThrow();
    const wrongSide = structuredClone(baseObjective) as ScenarioObjective; wrongSide.side = 'BLUE';
    expect(() => compileScenario(scenario([ship], { objectives: [wrongSide] }))).toThrow('objective side');
    const wrongDomain = structuredClone(baseObjective) as ScenarioObjective; wrongDomain.withdrawUnitDomains = ['subsurface'];
    expect(() => compileScenario(scenario([ship], { objectives: [wrongDomain] }))).toThrow('disallowed domain');
    const wrongType = { ...structuredClone(baseObjective), type: 'destroy' as const };
    expect(() => compileScenario(scenario([ship], { objectives: [wrongType] }))).toThrow('only applies');
  });

  test('validates reinforcement and event references before the first tick', () => {
    const badSpawn = timedEvent({ actions: [{ type: 'SPAWN_REINFORCEMENTS', units: [placement('late', 'missing')] }] });
    const badMission = timedEvent({ actions: [{ type: 'ACTIVATE_MISSION', missionId: 'missing', isActive: true }] });
    const badTarget = timedEvent({ trigger: { type: 'UNIT_DESTROYED', unitId: 'missing' } });
    const badSortie = timedEvent({ actions: [{ type: 'LAUNCH_SORTIE', carrierUnitId: 'missing', hangarSlotId: 'missing' }] });
    const badAssignment = timedEvent({ actions: [{ type: 'ASSIGN_MISSION', side: 'RED', unitId: 'missing', missionId: 'missing' }] });
    for (const event of [badSpawn, badMission, badTarget, badSortie, badAssignment]) {
      expect(validateAndParseScenarioJson(JSON.stringify(scenario([], { events: [event] }))).valid).toBe(false);
    }
    const duplicate = timedEvent({ actions: [{ type: 'SPAWN_REINFORCEMENTS', units: [placement('a')] }] });
    expect(() => compileScenario(scenario([placement('a')], { events: [duplicate] }))).toThrow('duplicate');
  });

  test('main scenarios define required objectives for both sides and reject dangling targets', () => {
    for (const input of [east, deep]) {
      const compiled = compileScenario(input).scenario;
      expect([...new Set((compiled.objectives ?? []).filter((objective) => objective.required).map((objective) => objective.side))].sort())
        .toEqual(['BLUE', 'RED']);
    }
    const dangling = structuredClone(east);
    dangling.objectives![0].unitIds = ['missing_unit'];
    expect(() => compileScenario(dangling)).toThrow('unknown unit missing_unit');
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
    const badDeployable = structuredClone(catalog);
    badDeployable.platforms.ea18g_growler.deployables = [{ platformId: 'missing', count: 1 }];
    expect(validateCatalogIntegrity(badDeployable).valid).toBe(false);
    const badTanker = structuredClone(catalog);
    delete badTanker.platforms.y20u_tanker.aarTransferRateSecPerSec;
    expect(validateCatalogIntegrity(badTanker).valid).toBe(false);
    const inherited = structuredClone(catalog);
    inherited.platforms.j20_mighty_dragon.defaultLoadoutId = 'toString';
    expect(validateCatalogIntegrity(inherited).valid).toBe(false);
  });

  test('content expansion counts, required IDs and scenario consumption remain explicit', () => {
    expect(Object.keys(catalog.platforms)).toHaveLength(48);
    expect(Object.keys(catalog.weapons)).toHaveLength(31);
    expect(Object.keys(catalog.sensors)).toHaveLength(26);
    expect(Object.keys(catalog.loadouts)).toHaveLength(30);
    const addedPlatforms = ['j15t_flanker', 'fa18ef_super_hornet', 'y9g_jammer', 'b1b_lancer',
      'j10c_multirole', 'mq4c_triton', 'f35b_lightning', 'type054b_frigate', 'constellation_ffg',
      'type039c_ssk', 'taigei_ssk', 'type075_lhd', 'america_lha', 'z20f_asw', 'mh60r_seahawk'];
    const requiredWeapons = ['hq16fe_sam', 'essm_blk2', 'aim174b_ulraam', 'yu11_lwt', 'mk54_lwt',
      'hq10_point_defense', 'ram_blk2'];
    const requiredSensors = ['y9g_esm_array', 'y9g_oecm_suite', 'spy6v3_ffg_radar', 'type382b_mfr',
      'z20f_dipping_sonar', 'aqs22_dipping_sonar'];
    const requiredLoadouts = ['loadout_j15t_heavy_cap', 'loadout_fa18ef_aim174_barcap',
      'loadout_y9g_esm_support', 'loadout_b1b_mass_lrasm', 'loadout_f35b_stovl_strike',
      'loadout_z20f_asw_prosecute', 'loadout_mh60r_asw_prosecute'];
    for (const id of addedPlatforms) expect(catalog.platforms[id]).toBeDefined();
    for (const id of requiredWeapons) expect(catalog.weapons[id]).toBeDefined();
    for (const id of requiredSensors) expect(catalog.sensors[id]).toBeDefined();
    for (const id of requiredLoadouts) expect(catalog.loadouts[id]).toBeDefined();

    const consumed = new Set<string>();
    for (const builtIn of BUILTIN_SCENARIOS) {
      compileScenario(builtIn);
      for (const placed of builtIn.units) {
        consumed.add(placed.platformId);
        for (const slot of catalog.platforms[placed.platformId]?.hangarSlots ?? []) consumed.add(slot.platformId);
      }
      for (const event of builtIn.events ?? []) for (const action of event.actions) {
        if (action.type === 'SPAWN_REINFORCEMENTS') for (const placed of action.units) consumed.add(placed.platformId);
      }
    }
    expect(BUILTIN_SCENARIOS.map((builtIn) => builtIn.id)).toContain('op_bashi_channel_blockade_2029');
    for (const id of addedPlatforms) expect(consumed).toContain(id);
  });

  test('every loadout resolves compatible kinematics, endurance, RCS and finite ammunition', () => {
    for (const loadout of Object.values(catalog.loadouts)) {
      const platformId = loadout.compatiblePlatformIds[0];
      const runtime = unit(placement(`loadout_${loadout.id}`, platformId, { loadoutId: loadout.id }));
      const resolved = resolveUnitConfiguration(catalog, platformId, loadout.id);
      expect(runtime.activeLoadoutId).toBe(loadout.id);
      expect(resolved.maxSpeedKts).toBe(Math.max(0, resolved.platform.maxSpeedKts - (loadout.speedPenaltyKts ?? 0)));
      expect(runtime.maxFuelSec).toBe(resolved.maxFuelSec);
      expect(resolved.maxFuelSec).toBe(Math.round(resolved.platform.maxFuelSec * (loadout.combatRadiusMultiplier ?? 1)));
      expect(resolved.rcsPenaltyM2).toBe(loadout.rcsPenaltyM2 ?? 0);
      expect(runtime.mounts.map((mount) => [mount.weaponId, mount.maxAmmo, mount.currentAmmo]))
        .toEqual(resolved.mounts.map((mount) => [mount.weaponId, mount.maxAmmo, mount.maxAmmo]));
    }
  });

  test('every expansion weapon produces a legal observed-contact launch or drop', () => {
    const launchCases = [
      ['pl10_wvr', 'j10c_multirole', 'loadout_j10c_multirole_cap'],
      ['yj83_ashm', 'type054b_frigate', undefined],
      ['aim9x_wvr', 'fa18ef_super_hornet', 'loadout_fa18ef_fleet_cap'],
      ['aim174b_ulraam', 'fa18ef_super_hornet', 'loadout_fa18ef_aim174_barcap'],
      ['yu11_lwt', 'z20f_asw', 'loadout_z20f_asw_prosecute'],
      ['mk54_lwt', 'mh60r_seahawk', 'loadout_mh60r_asw_prosecute'],
      ['hq16fe_sam', 'type054b_frigate', undefined],
      ['essm_blk2', 'constellation_ffg', undefined],
      ['nsm_ashm', 'constellation_ffg', undefined],
      ['hq10_point_defense', 'type054b_frigate', undefined],
      ['ram_blk2', 'constellation_ffg', undefined],
    ] as const;
    for (const [weaponId, platformId, loadoutId] of launchCases) {
      const weapon = catalog.weapons[weaponId];
      const targetDomain = weapon.targetDomains.includes('subsurface') ? 'subsurface'
        : weapon.targetDomains.includes('surface') ? 'surface' : 'air';
      const targetPlatformId = targetDomain === 'subsurface' ? 'virginia_ssn'
        : targetDomain === 'surface' ? 'arleigh_burke_flt3' : 'j20_mighty_dragon';
      const maxRange = weapon.launchMedium === 'air_drop' ? weapon.airDropRangeKm! : weapon.maxRangeKm;
      const distanceKm = Math.max(weapon.minRangeKm + 1, Math.min(maxRange * 0.5, maxRange - 1));
      const shooter = unit(placement(`shooter_${weaponId}`, platformId, {
        loadoutId, position: [0, 0], altitudeM: catalog.platforms[platformId].defaultAltitudeM,
        doctrine: { roe: 'free', emconRadar: true, emconSonar: true, emconJamming: false,
          automaticFireRangeFraction: 1, automaticTargetDomains: [targetDomain], minimumAutomaticThreat: 'low',
          minimumWeaponReserve: 0, engageOpportunityTargets: true, salvoSize: 1 },
      }));
      shooter.mounts = shooter.mounts.filter((mount) => mount.weaponId === weaponId);
      const target = unit(placement(`target_${weaponId}`, targetPlatformId, {
        side: 'BLUE', parentGroupId: 'blue_desron15', position: [distanceKm / 111, 0],
        altitudeM: catalog.platforms[targetPlatformId].defaultAltitudeM,
      }));
      const contact: TacticalContact = {
        id: `RED_CONTACT_${target.id}`, actualUnitId: target.id, observerSide: 'RED', targetSide: 'BLUE',
        domain: targetDomain, classification: 'identified', identifiedCategory: target.category,
        displayName: target.name, sidc: target.sidc, estimatedPosition: [...target.position], truePosition: [...target.position],
        uncertaintyRadiusKm: 0.1, heading: target.heading, speedKts: target.speedKts, altitudeM: target.altitudeM,
        firstDetectedTime: 0, lastDetectedTime: 1000, detectedBySources: [shooter.callsign],
        sourceUnitIds: [shooter.id], fireControlSourceIds: [shooter.id], threatLevel: 'critical', emitterObserved: true,
      };
      const weaponsInFlight: Record<string, WeaponInFlight> = {};
      runAutoDefense({ units: { [shooter.id]: shooter, [target.id]: target }, missions: [],
        contacts: { [contact.id]: contact }, weaponsInFlight, catalog, nextSimTime: 1000, score: world().score,
        logs: [], previousDetectedMissileIds: [], autoPauseSettings: {
          onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false,
        }, triggerPause: () => undefined });
      expect(Object.values(weaponsInFlight).some((launched) => launched.weaponId === weaponId)).toBe(true);
    }
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

  test('Y-9G provides unique long-baseline ESM/OECM support without offensive mounts', () => {
    const resolved = resolveUnitConfiguration(catalog, 'y9g_jammer', 'loadout_y9g_esm_support');
    expect(resolved.mounts).toEqual([]);
    expect(resolved.sensorIds).toContain('y9g_esm_array');
    expect(resolved.sensorIds).toContain('y9g_oecm_suite');
    expect(resolved.maxFuelSec).toBeGreaterThan(catalog.platforms.y9g_jammer.maxFuelSec);

    const support = unit(placement('y9g', 'y9g_jammer', { position: [0, 0], altitudeM: 7600,
      doctrine: { roe: 'hold', emconRadar: false, emconJamming: true } }));
    const emitter = unit(placement('emitter', 'arleigh_burke_flt3', { side: 'BLUE', position: [4, 0],
      doctrine: { roe: 'hold', emconRadar: true } }));
    const detected = computeContactsOnly({ y9g: support, emitter }, catalog, {}, 0).contacts.RED_CONTACT_emitter;
    expect(detected).toBeDefined();
    expect(detected.bearingObservations?.some((observation) => observation.sourceUnitId === support.id)).toBe(true);

    const escorted = unit(placement('escorted', 'j15t_flanker', { position: [0.2, 0] }));
    expect(evaluateTargetEcmSuppression(escorted, [support, escorted], catalog)).toBeGreaterThan(0.5);
    const mission = { id: 'ew_support', name: 'EW Support', side: 'RED' as const, type: 'aew_support' as const,
      isActive: true, areaPolygon: [[0, 0], [0.2, 0], [0.2, 0.2]] as [number, number][], assignedUnitIds: [support.id],
      prosecuteOutsideAreaKm: 0, description: '' };
    support.assignedMissionId = mission.id; support.navigationMode = 'mission'; support.waypoints = [];
    const next = tick({ ...world([support]), missions: [mission] });
    expect(next.units.y9g.waypoints.length).toBeGreaterThan(0);
  });

  test('B-1B, J-10C and MQ-4C form distinct strike, mass-CAP and ISR roles', () => {
    const b1Mass = resolveUnitConfiguration(catalog, 'b1b_lancer', 'loadout_b1b_mass_lrasm');
    const b1Mixed = resolveUnitConfiguration(catalog, 'b1b_lancer', 'loadout_b1b_maritime_mixed');
    expect(b1Mass.mounts).toEqual([{ mountId: 'internal_lrasm', weaponId: 'agm158c_lrasm', maxAmmo: 12, reloadTimeSec: 14 }]);
    expect(b1Mixed.mounts.map((mount) => mount.weaponId)).toEqual(['agm158c_lrasm', 'bgm109_tlahm']);
    expect(b1Mass.maxFuelSec).toBeLessThan(catalog.platforms.b1b_lancer.maxFuelSec);
    expect(catalog.platforms.b1b_lancer.canReceiveAar).not.toBe(false);

    const j10Cap = resolveUnitConfiguration(catalog, 'j10c_multirole', 'loadout_j10c_multirole_cap');
    const j10Sead = resolveUnitConfiguration(catalog, 'j10c_multirole', 'loadout_j10c_sead');
    expect(j10Cap.mounts.map((mount) => mount.weaponId)).toEqual(['pl15_aam', 'pl10_wvr']);
    expect(j10Sead.mounts.map((mount) => mount.weaponId)).toEqual(['ld10_arm', 'pl10_wvr']);

    const mq4c = unit(placement('mq4c', 'mq4c_triton', { position: [0, 0], altitudeM: 15000,
      doctrine: { roe: 'hold', emconRadar: true } }));
    const surface = unit(placement('surface', 'type055_destroyer', { side: 'BLUE', parentGroupId: 'blue_desron15', position: [2.4, 0] }));
    expect(mq4c.mounts).toEqual([]);
    expect(resolveUnitConfiguration(catalog, mq4c.platformId, mq4c.activeLoadoutId).sensorIds).toContain('apy10_maritime_radar');
    expect(computeContactsOnly({ mq4c, surface }, catalog, {}, 0).contacts.RED_CONTACT_surface).toBeDefined();
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

  test('J-15T loadouts apply distinct kinematics/RCS and launch from the Fujian finite hangar', () => {
    const cap = resolveUnitConfiguration(catalog, 'j15t_flanker', 'loadout_j15t_heavy_cap');
    const strike = resolveUnitConfiguration(catalog, 'j15t_flanker', 'loadout_j15t_maritime_strike');
    const sead = resolveUnitConfiguration(catalog, 'j15t_flanker', 'loadout_j15t_sead');
    expect(cap.mounts.map((mount) => mount.weaponId)).toEqual(['pl15_aam', 'pl10_wvr']);
    expect(strike.mounts.map((mount) => mount.weaponId)).toEqual(['yj83_ashm', 'pl15_aam', 'pl10_wvr']);
    expect(sead.mounts.map((mount) => mount.weaponId)).toEqual(['ld10_arm', 'yj83_ashm', 'pl15_aam']);
    expect(strike.maxSpeedKts).toBeLessThan(cap.maxSpeedKts);
    expect(strike.rcsPenaltyM2).toBeGreaterThan(cap.rcsPenaltyM2);
    expect(cap.maxFuelSec).toBeGreaterThan(catalog.platforms.j15t_flanker.maxFuelSec);

    store.getState().loadScenario(deep);
    const before = store.getState().units.red_cv18_fujian.hangar.find((slot) => slot.slotId === 'hangar_j15t_multirole')!;
    store.getState().launchCarrierAircraft('red_cv18_fujian', before.slotId, 'loadout_j15t_maritime_strike');
    const launched = Object.values(store.getState().units).find((candidate) =>
      candidate.hostCarrierId === 'red_cv18_fujian' && candidate.platformId === 'j15t_flanker')!;
    expect(launched.activeLoadoutId).toBe('loadout_j15t_maritime_strike');
    expect(launched.mounts.map((mount) => mount.weaponId)).toEqual(['yj83_ashm', 'pl15_aam', 'pl10_wvr']);
    expect(store.getState().units.red_cv18_fujian.hangar.find((slot) => slot.slotId === before.slotId)?.readyAirframes)
      .toBe(before.readyAirframes - 1);
  });

  test('F/A-18E/F loadouts and finite CVN hangar support CAP, LRASM and AIM-174B roles', () => {
    const cap = resolveUnitConfiguration(catalog, 'fa18ef_super_hornet', 'loadout_fa18ef_fleet_cap');
    const strike = resolveUnitConfiguration(catalog, 'fa18ef_super_hornet', 'loadout_fa18ef_lrasm_strike');
    const barcap = resolveUnitConfiguration(catalog, 'fa18ef_super_hornet', 'loadout_fa18ef_aim174_barcap');
    expect(cap.mounts.map((mount) => mount.weaponId)).toEqual(['aim120d_aam', 'aim9x_wvr']);
    expect(strike.mounts.map((mount) => mount.weaponId)).toEqual(['agm158c_lrasm', 'aim120d_aam', 'aim9x_wvr']);
    expect(barcap.mounts.map((mount) => mount.weaponId)).toEqual(['aim174b_ulraam', 'aim120d_aam', 'aim9x_wvr']);
    expect(barcap.maxSpeedKts).toBeLessThan(cap.maxSpeedKts);
    expect(barcap.maxFuelSec).toBeLessThan(catalog.platforms.fa18ef_super_hornet.maxFuelSec);
    expect(barcap.rcsPenaltyM2).toBeGreaterThan(strike.rcsPenaltyM2);

    store.getState().loadScenario(deep);
    store.getState().setPlayerSide('BLUE');
    const slot = store.getState().units.blue_cvn78_carrier.hangar.find((candidate) => candidate.slotId === 'hangar_vfa_fa18ef')!;
    store.getState().launchCarrierAircraft('blue_cvn78_carrier', slot.slotId, 'loadout_fa18ef_aim174_barcap');
    const launched = Object.values(store.getState().units).find((candidate) =>
      candidate.hostCarrierId === 'blue_cvn78_carrier' && candidate.platformId === 'fa18ef_super_hornet')!;
    expect(launched.mounts.find((mount) => mount.weaponId === 'aim174b_ulraam')?.currentAmmo).toBe(2);
    expect(store.getState().units.blue_cvn78_carrier.hangar.find((candidate) => candidate.slotId === slot.slotId)?.readyAirframes)
      .toBe(slot.readyAirframes - 1);
  });

  test('F-35B is limited to the America LHA STOVL hangar and finite inventory', () => {
    const cap = resolveUnitConfiguration(catalog, 'f35b_lightning', 'loadout_f35b_stovl_cap');
    const strike = resolveUnitConfiguration(catalog, 'f35b_lightning', 'loadout_f35b_stovl_strike');
    expect(cap.mounts.map((mount) => mount.weaponId)).toEqual(['aim120d_aam', 'aim9x_wvr']);
    expect(strike.mounts.map((mount) => mount.weaponId)).toEqual(['agm158c_lrasm', 'aim120d_aam', 'aim9x_wvr']);
    expect(strike.maxFuelSec).toBeLessThan(cap.maxFuelSec);
    expect(strike.rcsPenaltyM2).toBeGreaterThan(cap.rcsPenaltyM2);

    const input = scenario([placement('lha', 'america_lha', { side: 'BLUE', parentGroupId: 'blue_csg_air' })]);
    store.getState().loadScenario(input);
    store.getState().setPlayerSide('BLUE');
    store.getState().launchCarrierAircraft('lha', 'hangar_f35b_stovl', 'loadout_f35b_stovl_strike');
    const launched = Object.values(store.getState().units).find((candidate) => candidate.hostCarrierId === 'lha')!;
    expect(launched).toMatchObject({ platformId: 'f35b_lightning', activeLoadoutId: 'loadout_f35b_stovl_strike' });
    expect(store.getState().units.lha.hangar[0].readyAirframes).toBe(0);

    store.getState().loadScenario(deep);
    store.getState().setPlayerSide('BLUE');
    const before = store.getState();
    store.getState().launchCarrierAircraft('blue_cvn78_carrier', 'hangar_f35b_stovl', 'loadout_f35b_stovl_cap');
    expect(store.getState()).toBe(before);
  });

  test('Deep Sea carrier air wings expose stealth CAP, multirole heavy and electronic escort slots with turnaround', () => {
    store.getState().loadScenario(deep);
    const redCarrier = store.getState().units.red_cv18_fujian;
    expect(redCarrier.hangar.map((slot) => slot.platformId)).toEqual(['j35_naval_stealth', 'j15t_flanker', 'j16d_roaring_wolf']);
    store.getState().launchCarrierAircraft(redCarrier.id, 'hangar_j35_vf1', 'loadout_j35_carrier_cap');
    store.getState().launchCarrierAircraft(redCarrier.id, 'hangar_j15t_multirole', 'loadout_j15t_maritime_strike');
    store.getState().launchCarrierAircraft(redCarrier.id, 'hangar_j15d_ew', 'loadout_j16d_sead_escort');
    store.getState().setPlayerSide('BLUE');
    const blueCarrier = store.getState().units.blue_cvn78_carrier;
    expect(blueCarrier.hangar.map((slot) => slot.platformId)).toEqual(['f35c_lightning', 'fa18ef_super_hornet', 'ea18g_growler']);
    store.getState().launchCarrierAircraft(blueCarrier.id, 'hangar_vfa_f35c', 'loadout_f35c_stealth_cap');
    store.getState().launchCarrierAircraft(blueCarrier.id, 'hangar_vfa_fa18ef', 'loadout_fa18ef_lrasm_strike');
    store.getState().launchCarrierAircraft(blueCarrier.id, 'hangar_vaq_growler', 'loadout_ea18g_growler_sead');
    const launchedPlatforms = new Set(Object.values(store.getState().units).filter((unit) => unit.hostCarrierId)
      .map((unit) => unit.platformId));
    for (const platformId of ['j35_naval_stealth', 'j15t_flanker', 'j16d_roaring_wolf',
      'f35c_lightning', 'fa18ef_super_hornet', 'ea18g_growler']) expect(launchedPlatforms).toContain(platformId);

    const j15 = Object.values(store.getState().units).find((unit) => unit.platformId === 'j15t_flanker')!;
    const carrierNow = store.getState().units.red_cv18_fujian;
    store.setState((state) => ({ units: { ...state.units, [j15.id]: {
      ...j15, position: [...carrierNow.position], status: 'returning', speedKts: 0, targetSpeedKts: 0,
    } } }));
    store.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
    store.getState().stepSingleTick(0.25);
    const queued = store.getState().units.red_cv18_fujian.hangar.find((slot) => slot.slotId === 'hangar_j15t_multirole')!;
    expect(queued.turnaroundQueue.map((entry) => entry.sortieId)).toContain(j15.id);
    const supplyBefore = queued.turnaroundSupplies;
    store.getState().stepSingleTick(queued.turnaroundSec);
    const ready = store.getState().units.red_cv18_fujian.hangar.find((slot) => slot.slotId === queued.slotId)!;
    expect(ready.turnaroundQueue).toEqual([]);
    expect(ready.turnaroundSupplies).toBe(supplyBefore - 1);
  });

  test('Type 075 and America LHA expose finite compatible air wings and layered self-defense', () => {
    const type075 = unit(placement('type075', 'type075_lhd'));
    const america = unit(placement('america', 'america_lha', { side: 'BLUE', parentGroupId: 'blue_csg_air' }));
    expect(type075.mounts.map((mount) => mount.weaponId)).toEqual(['hq16fe_sam', 'hq10_point_defense', 'yj83_ashm']);
    expect(america.mounts.map((mount) => mount.weaponId)).toEqual(['essm_blk2', 'ram_blk2', 'nsm_ashm']);
    expect(type075.hangar.map((slot) => slot.platformId)).toEqual(['z20f_asw']);
    expect(america.hangar.map((slot) => slot.platformId)).toEqual(['f35b_lightning', 'mh60r_seahawk']);
    expect(catalog.platforms.type075_lhd.cruiseSpeedKts).toBeLessThan(catalog.platforms.type054b_frigate.cruiseSpeedKts);
    expect(catalog.platforms.america_lha.cruiseSpeedKts).toBeLessThan(catalog.platforms.constellation_ffg.cruiseSpeedKts);

    store.getState().loadScenario(scenario([placement('type075', 'type075_lhd')]));
    store.getState().launchCarrierAircraft('type075', 'hangar_z20f_asw', 'loadout_z20f_asw_search');
    expect(Object.values(store.getState().units).some((candidate) =>
      candidate.hostCarrierId === 'type075' && candidate.platformId === 'z20f_asw')).toBe(true);
  });

  test('Z-20F and MH-60R launch from matching ships with search/prosecute ASW loadouts', () => {
    for (const [platformId, searchId, prosecuteId, weaponId, sensorId] of [
      ['z20f_asw', 'loadout_z20f_asw_search', 'loadout_z20f_asw_prosecute', 'yu11_lwt', 'z20f_dipping_sonar'],
      ['mh60r_seahawk', 'loadout_mh60r_asw_search', 'loadout_mh60r_asw_prosecute', 'mk54_lwt', 'aqs22_dipping_sonar'],
    ] as const) {
      const search = resolveUnitConfiguration(catalog, platformId, searchId);
      const prosecute = resolveUnitConfiguration(catalog, platformId, prosecuteId);
      expect(search.mounts).toEqual([]);
      expect(search.sensorIds).toContain(sensorId);
      expect(prosecute.mounts.map((mount) => mount.weaponId)).toEqual([weaponId]);
      expect(search.maxFuelSec).toBeGreaterThan(prosecute.maxFuelSec);
    }

    store.getState().loadScenario(scenario([placement('red_ffg', 'type054b_frigate')]));
    store.getState().launchCarrierAircraft('red_ffg', 'hangar_z20f_ffg', 'loadout_z20f_asw_prosecute');
    expect(Object.values(store.getState().units).some((candidate) =>
      candidate.hostCarrierId === 'red_ffg' && candidate.platformId === 'z20f_asw' &&
      candidate.mounts.some((mount) => mount.weaponId === 'yu11_lwt'))).toBe(true);

    store.getState().loadScenario(scenario([placement('blue_ffg', 'constellation_ffg', { side: 'BLUE', parentGroupId: 'blue_csg_air' })]));
    store.getState().setPlayerSide('BLUE');
    store.getState().launchCarrierAircraft('blue_ffg', 'hangar_mh60r_ffg', 'loadout_mh60r_asw_prosecute');
    expect(Object.values(store.getState().units).some((candidate) =>
      candidate.hostCarrierId === 'blue_ffg' && candidate.platformId === 'mh60r_seahawk' &&
      candidate.mounts.some((mount) => mount.weaponId === 'mk54_lwt'))).toBe(true);
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
      if (i === 1) {
        expect(launched.at(-1)!.activeLoadoutId).toBe('loadout_j35_maritime_strike');
        expect(launched.at(-1)!.mounts.map((mount) => mount.weaponId)).toEqual(['yj12_supersonic', 'ld10_arm', 'pl15_aam']);
        expect(store.getState().commandHistory.at(-1)).toMatchObject({
          action: 'launchCarrierAircraft',
          args: ['carrier', 'hangar_j35_vf1', 'loadout_j35_maritime_strike'],
        });
      }
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

  test('legacy hangar definitions receive deterministic turnaround defaults at the runtime boundary', () => {
    const c = structuredClone(catalog);
    delete c.platforms.cv18_fujian_carrier.hangarSlots![0].turnaroundSec;
    delete c.platforms.cv18_fujian_carrier.hangarSlots![0].turnaroundSupplyBatches;
    const legacy = unit(placement('carrier', 'cv18_fujian_carrier'), c).hangar[0];
    expect(legacy.turnaroundSec).toBe(legacy.launchCooldownSec * 4);
    expect(legacy.turnaroundSupplies).toBe(legacy.totalAirframes);
  });

  test('a recovered sortie enters turnaround once and returns to ready inventory by consuming finite supply', () => {
    const carrier = unit(placement('carrier', 'cv18_fujian_carrier'));
    const sortie = unit(placement('sortie', 'j35_naval_stealth'));
    const slot = carrier.hangar[0];
    slot.readyAirframes -= 1;
    slot.activeSortieIds.push(sortie.id);
    slot.nextSortieNumber = 2;
    sortie.hostCarrierId = carrier.id;
    sortie.hostHangarSlotId = slot.slotId;
    sortie.status = 'returning';
    sortie.position = [...carrier.position];

    let state = tick(world([carrier, sortie]), 0.25);
    let recoveredSlot = state.units.carrier.hangar[0];
    expect(state.units.sortie.status).toBe('recovered');
    expect(recoveredSlot.activeSortieIds).toEqual([]);
    expect(recoveredSlot.turnaroundQueue.map((entry) => entry.sortieId)).toEqual(['sortie']);
    expect(recoveredSlot.readyAirframes + recoveredSlot.reserveAirframes + recoveredSlot.turnaroundQueue.length)
      .toBe(recoveredSlot.totalAirframes);

    const supplies = recoveredSlot.turnaroundSupplies;
    state = tick(state, recoveredSlot.turnaroundSec);
    recoveredSlot = state.units.carrier.hangar[0];
    expect(recoveredSlot.turnaroundQueue).toEqual([]);
    expect(recoveredSlot.readyAirframes + recoveredSlot.reserveAirframes).toBe(recoveredSlot.totalAirframes);
    expect(recoveredSlot.turnaroundSupplies).toBe(supplies - 1);
    state = tick(state, 1);
    expect(state.units.carrier.hangar[0].turnaroundSupplies).toBe(supplies - 1);
  });

  test('destroyed sorties reduce inventory and a disabled host loses onboard batches without recovering aircraft', () => {
    const carrier = unit(placement('carrier', 'cv18_fujian_carrier'));
    const sortie = unit(placement('sortie', 'j35_naval_stealth'));
    const slot = carrier.hangar[0];
    slot.readyAirframes -= 1;
    slot.activeSortieIds.push(sortie.id);
    sortie.hostCarrierId = carrier.id;
    sortie.hostHangarSlotId = slot.slotId;
    sortie.hp = 0;
    sortie.status = 'destroyed';
    const loss = tick(world([carrier, sortie]), 0.25).units.carrier.hangar[0];
    expect(loss.activeSortieIds).toEqual([]);
    expect(loss.totalAirframes).toBe(2);
    expect(loss.readyAirframes + loss.reserveAirframes).toBe(2);

    const disabledCarrier = unit(placement('disabled', 'cv18_fujian_carrier'));
    const diverted = unit(placement('diverted', 'j35_naval_stealth'));
    const disabledSlot = disabledCarrier.hangar[0];
    disabledSlot.readyAirframes -= 1;
    disabledSlot.activeSortieIds.push(diverted.id);
    disabledCarrier.hp = 0;
    disabledCarrier.status = 'destroyed';
    diverted.hostCarrierId = disabledCarrier.id;
    diverted.hostHangarSlotId = disabledSlot.slotId;
    diverted.status = 'returning';
    const stranded = tick(world([disabledCarrier, diverted]), 0.25);
    expect(stranded.units.disabled.hangar[0]).toMatchObject({
      readyAirframes: 0, reserveAirframes: 0, turnaroundSupplies: 0, totalAirframes: 1,
    });
    expect(stranded.units.diverted.status).toBe('returning');
    expect(stranded.units.disabled.hangar[0].turnaroundQueue).toEqual([]);
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

  test('escort mission schema requires a same-side protected unit and rejects stray escort fields', () => {
    const escortMission = {
      ...deep.missions[0], id: 'escort', type: 'escort' as const, escortUnitId: 'protected', stationRadiusKm: 20,
    };
    const input = scenario([
      placement('escort_unit', undefined, { assignedMissionId: escortMission.id }),
      placement('protected'),
    ], { missions: [escortMission] });
    expect(() => compileScenario(input)).not.toThrow();
    const missing = structuredClone(input); missing.missions[0].escortUnitId = 'missing';
    expect(() => compileScenario(missing)).toThrow('same-side escortUnitId');
    const stray = structuredClone(input); stray.missions[0].type = 'aaw_patrol';
    expect(() => compileScenario(stray)).toThrow('only applies to escort');
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

  test('event actions launch finite sorties, reassign missions, blink EMCON and coordinate observed-contact fire', () => {
    const carrier = unit(placement('carrier', 'cv18_fujian_carrier', { position: [0, 0], doctrine: { roe: 'free', emconRadar: true } }));
    const ship = unit(placement('ship', 'type055_destroyer', { position: [0.02, 0], doctrine: { roe: 'free', emconRadar: true } }));
    const bomber = unit(placement('bomber', 'h6n_bomber', { position: [0.05, 0] }));
    const target = unit(placement('target', 'arleigh_burke_flt3', {
      side: 'BLUE', parentGroupId: 'blue_desron15', position: [0.2, 0],
    }));
    carrier.parentGroupId = ship.parentGroupId = 'strike_group';
    const mission = { ...deep.missions[0], id: 'strike_mission', assignedUnitIds: [] };
    const track: TacticalContact = {
      id: 'RED_CONTACT_target', actualUnitId: target.id, observerSide: 'RED', targetSide: 'BLUE',
      domain: 'surface', classification: 'identified', displayName: 'Observed destroyer', sidc: target.sidc,
      estimatedPosition: [...target.position], truePosition: [...target.position], uncertaintyRadiusKm: 0.2,
      heading: target.heading, speedKts: target.speedKts, altitudeM: target.altitudeM,
      firstDetectedTime: 1000, lastDetectedTime: 1000, detectedBySources: [ship.callsign],
      sourceUnitIds: [ship.id], fireControlSourceIds: [ship.id], threatLevel: 'critical',
    };
    const event = timedEvent({ trigger: { type: 'TIME_ELAPSED', elapsedSec: 0 }, actions: [
      { type: 'LAUNCH_SORTIE', carrierUnitId: carrier.id, hangarSlotId: 'hangar_j35_vf1',
        loadoutId: 'loadout_j35_maritime_strike', assignedMissionId: mission.id },
      { type: 'ASSIGN_MISSION', side: 'RED', unitId: bomber.id, missionId: mission.id },
      { type: 'TOGGLE_SIDE_EMCON', side: 'RED', groupId: 'strike_group', sensor: 'radar' },
      { type: 'COORDINATE_ATTACK', side: 'RED', groupId: 'strike_group', targetDomain: 'surface', delaySec: 10 },
    ] });
    const units: Record<string, RuntimeUnit> = { carrier, ship, bomber, target };
    const contacts = { [track.id]: track };
    const s = world().score;
    const logs: never[] = [];
    resolveEventsAndObjectives({
      events: [event], pendingSortieOrders: [], units, contacts, missions: [mission], catalog, nextSimTime: 1000, startTime: 0,
      score: s, rng: () => 0.5, logs, objectives: [], objectiveProgress: {},
    });
    const sortie = units.sortie_carrier_hangar_j35_vf1_1;
    expect(sortie).toMatchObject({ assignedMissionId: mission.id, navigationMode: 'mission' });
    expect(carrier.hangar[0].readyAirframes).toBe(1);
    expect(bomber.assignedMissionId).toBe(mission.id);
    expect(carrier.doctrine.emconRadar).toBe(false);
    expect(ship.doctrine.emconRadar).toBe(false);
    expect(carrier.coordinatedAttack).toEqual({ contactId: track.id, releaseAtSimTime: 11000 });
    expect(s.sortiesLaunched).toBe(1);

    for (const firingUnit of [carrier, ship, sortie]) firingUnit.doctrine.emconRadar = true;
    const weaponsInFlight: Record<string, WeaponInFlight> = {};
    runAutoDefense({ units, missions: [mission], contacts, weaponsInFlight, catalog, nextSimTime: 5000,
      score: s, logs: [], previousDetectedMissileIds: [],
      autoPauseSettings: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false },
      triggerPause: () => undefined });
    expect(Object.keys(weaponsInFlight)).toHaveLength(0);
    track.lastDetectedTime = 11000;
    runAutoDefense({ units, missions: [mission], contacts, weaponsInFlight, catalog, nextSimTime: 11000,
      score: s, logs: [], previousDetectedMissileIds: [],
      autoPauseSettings: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false },
      triggerPause: () => undefined });
    expect(new Set(Object.values(weaponsInFlight).map((weapon) => weapon.shooterId)).size).toBeGreaterThanOrEqual(2);
    expect([carrier, ship, sortie].filter((unit) => unit.coordinatedAttack).length).toBeLessThan(3);
  });

  test('Deep Sea classification gates tanker activation before reliable full-wing sortie waves', () => {
    const units = instantiateScenarioUnits(deep);
    const initialRedReady = units.red_cv18_fujian.hangar.map((slot) => slot.readyAirframes);
    const initialBlueReady = units.blue_cvn78_carrier.hangar.map((slot) => slot.readyAirframes);
    const events = structuredClone(deep.events) as RuntimeScenarioEvent[];
    const missions: TacticalMission[] = structuredClone(deep.missions).map((mission) => ({
      ...mission, assignedUnitIds: Object.values(units).filter((runtimeUnit) => runtimeUnit.assignedMissionId === mission.id)
        .map((runtimeUnit) => runtimeUnit.id),
    }));
    const pending: NonNullable<SimulationWorldState['pendingSortieOrders']> = [];
    const score = world().score;
    const logs: never[] = [];
    const makeContact = (observerSide: 'RED' | 'BLUE', target: RuntimeUnit, classification: TacticalContact['classification']): TacticalContact => ({
      id: `${observerSide}_CONTACT_${target.id}`, actualUnitId: target.id, observerSide,
      targetSide: target.side, domain: target.domain, classification, displayName: 'observed carrier', sidc: target.sidc,
      estimatedPosition: [...target.position], truePosition: [...target.position], uncertaintyRadiusKm: 1,
      heading: target.heading, speedKts: target.speedKts, altitudeM: target.altitudeM,
      firstDetectedTime: 1000, lastDetectedTime: 1000, detectedBySources: ['ISR'], sourceUnitIds: [],
      fireControlSourceIds: [], threatLevel: 'critical',
      ...(classification === 'identified' ? { identifiedCategory: 'carrier' as const } : {}),
    });
    let contacts: Record<string, TacticalContact> = {
      RED_CONTACT_blue_cvn78_carrier: makeContact('RED', units.blue_cvn78_carrier, 'classified'),
      BLUE_CONTACT_red_cv18_fujian: makeContact('BLUE', units.red_cv18_fujian, 'classified'),
    };
    const resolveAt = (nextSimTime: number) => resolveEventsAndObjectives({ events, pendingSortieOrders: pending,
      units, contacts, missions, catalog, nextSimTime, startTime: 0, score, rng: () => 0.5,
      logs, objectives: [], objectiveProgress: {} });
    resolveAt(1000);
    expect(missions.find((mission) => mission.id === 'mission_red_deep_tanker')?.isActive).toBe(true);
    expect(missions.find((mission) => mission.id === 'mission_blue_deep_tanker')?.isActive).toBe(true);
    expect(score.sortiesLaunched).toBe(0);
    expect(pending).toEqual([]);

    contacts = {
      RED_CONTACT_blue_cvn78_carrier: makeContact('RED', units.blue_cvn78_carrier, 'identified'),
      BLUE_CONTACT_red_cv18_fujian: makeContact('BLUE', units.red_cv18_fujian, 'identified'),
    };
    resolveAt(2000);
    expect(missions.find((mission) => mission.id === 'mission_blue_deep_strike')?.isActive).toBe(true);
    expect(score.sortiesLaunched).toBe(2);
    expect(pending.map((order) => order.earliestLaunchTime)).toEqual([12000, 22000, 12000, 22000]);
    const processAt = (nextSimTime: number) => {
      const remaining = processPendingSortieOrders(pending, units, missions, catalog, nextSimTime, score, logs);
      pending.splice(0, pending.length, ...remaining);
    };
    processAt(12000);
    expect(score.sortiesLaunched).toBe(4);
    processAt(22000);
    expect(score.sortiesLaunched).toBe(6);
    expect(pending).toEqual([]);
    const launchedPlatforms = new Set(Object.values(units).filter((runtimeUnit) => runtimeUnit.hostCarrierId)
      .map((runtimeUnit) => runtimeUnit.platformId));
    for (const platformId of ['j35_naval_stealth', 'j15t_flanker', 'j16d_roaring_wolf',
      'f35c_lightning', 'fa18ef_super_hornet', 'ea18g_growler']) expect(launchedPlatforms).toContain(platformId);
    expect(units.red_cv18_fujian.hangar.map((slot) => slot.readyAirframes)).toEqual(initialRedReady.map((ready) => ready - 1));
    expect(units.blue_cvn78_carrier.hangar.map((slot) => slot.readyAirframes)).toEqual(initialBlueReady.map((ready) => ready - 1));
  });

  test('temporarily blocked event sorties queue, retry deterministically and consume real ready inventory', () => {
    const carrier = unit(placement('queue_carrier', 'cv18_fujian_carrier'));
    carrier.hangar[0].cooldownRemainingSec = 1;
    const event = timedEvent({ trigger: { type: 'TIME_ELAPSED', elapsedSec: 0 }, actions: [{
      type: 'LAUNCH_SORTIE', carrierUnitId: carrier.id, hangarSlotId: 'hangar_j35_vf1',
      loadoutId: 'loadout_j35_carrier_cap',
    }] });
    let state = tick(world([carrier], [event]), 0.25);
    expect(state.pendingSortieOrders).toHaveLength(1);
    expect(state.pendingSortieOrders![0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(Object.values(state.units).filter((candidate) => candidate.hostCarrierId === carrier.id)).toHaveLength(0);
    state = tick(state, 1);
    expect(state.pendingSortieOrders).toEqual([]);
    const launched = Object.values(state.units).find((candidate) => candidate.hostCarrierId === carrier.id);
    expect(launched).toBeDefined();
    expect(state.units.queue_carrier.hangar[0].activeSortieIds).toContain(launched!.id);
    expect(state.score.sortiesLaunched).toBe(1);
  });

  test('delayed sortie orders wait until their exact window and disabled carriers fail explicitly', () => {
    const carrier = unit(placement('delayed_carrier', 'cv18_fujian_carrier'));
    const delayed = timedEvent({ trigger: { type: 'TIME_ELAPSED', elapsedSec: 0 }, actions: [{
      type: 'LAUNCH_SORTIE', carrierUnitId: carrier.id, hangarSlotId: 'hangar_j35_vf1', launchDelaySec: 2,
    }] });
    let state = tick(world([carrier], [delayed]), 0.25);
    expect(state.pendingSortieOrders?.[0].earliestLaunchTime).toBe(2250);
    state = tick(state, 1);
    expect(state.pendingSortieOrders).toHaveLength(1);
    state = tick(state, 1);
    expect(state.pendingSortieOrders).toEqual([]);
    expect(state.score.sortiesLaunched).toBe(1);

    const disabled = unit(placement('disabled_carrier', 'cv18_fujian_carrier'));
    disabled.hp = 0; disabled.status = 'destroyed';
    const failed = timedEvent({ trigger: { type: 'TIME_ELAPSED', elapsedSec: 0 }, actions: [{
      type: 'LAUNCH_SORTIE', carrierUnitId: disabled.id, hangarSlotId: 'hangar_j35_vf1',
    }] });
    const failedState = tick(world([disabled], [failed]), 0.25);
    expect(failedState.pendingSortieOrders?.[0]).toMatchObject({ status: 'failed' });
    expect(failedState.pendingSortieOrders?.[0].failureReason).toContain('失能');
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
    const contact = { actualUnitId: 'a', observerSide: 'BLUE', classification: 'classified', domain: 'surface' } as TacticalContact;
    expect(getEventOccurrences(detected, { a: target }, { a: contact }, 1)).toBe(1);
    expect(getEventOccurrences(detected, { a: target }, { a: contact }, 2)).toBe(0);
    getEventOccurrences(detected, { a: target }, {}, 3);
    expect(getEventOccurrences(detected, { a: target }, { a: contact }, 4)).toBe(1);
    const classifiedOnly: RuntimeScenarioEvent = timedEvent({ trigger: {
      type: 'UNIT_DETECTED', observerSide: 'BLUE', targetCategory: target.category,
    } });
    contact.classification = 'classified';
    expect(getEventOccurrences(classifiedOnly, { a: target }, { a: contact }, 5)).toBe(0);
    const classifiedTrigger: RuntimeScenarioEvent = timedEvent({ trigger: {
      type: 'UNIT_DETECTED', observerSide: 'BLUE', targetDomain: 'surface', minimumClassification: 'classified',
    } });
    const identifiedTrigger: RuntimeScenarioEvent = timedEvent({ trigger: {
      type: 'UNIT_DETECTED', observerSide: 'BLUE', targetDomain: 'surface', minimumClassification: 'identified',
    } });
    expect(getEventOccurrences(classifiedTrigger, { a: target }, { a: contact }, 5)).toBe(1);
    expect(getEventOccurrences(identifiedTrigger, { a: target }, { a: contact }, 5)).toBe(0);
    contact.classification = 'identified'; contact.identifiedCategory = target.category;
    expect(getEventOccurrences(classifiedOnly, { a: target }, { a: contact }, 6)).toBe(1);
    expect(getEventOccurrences(identifiedTrigger, { a: target }, { a: contact }, 6)).toBe(1);
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
