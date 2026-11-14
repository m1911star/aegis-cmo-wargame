import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../src/db';
import { launchCarrierSortie } from '../../src/engine/carrierOperations';
import { hasRadarLineOfSight } from '../../src/engine/environment';
import { evaluateAreaControlStatus, evaluateObjectives } from '../../src/engine/objectives';
import { recoverySolution } from '../../src/engine/operations';
import { runAutoDefense } from '../../src/engine/simulation/autoDefense';
import { createRuntimeUnitFromPlacement, stepSimulationWorld } from '../../src/engine/simulationEngine';
import { SCENARIO_INLAND_AIR_LAND } from '../../src/scenarios/inlandAirLandScenario';
import { SCENARIO_JOINT_AMPHIBIOUS_ASSAULT } from '../../src/scenarios/jointAmphibiousScenario';
import { compileScenario } from '../../src/scenarios/compileScenario';
import { instantiateScenarioUnits } from '../../src/scenarios/builtinScenarios';
import {
  captureBattleRecording,
  canonicalBattleState,
  replayBattleRecording,
} from '../../src/store/battleRecording';
import { useWargameStore as store } from '../../src/store/useWargameStore';
import type { ScenarioObjective, TacticalContact, WeaponInFlight } from '../../src/types/wargame';

const pausesOff = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };
const emptyScore = () => ({
  redLosses: 0,
  blueLosses: 0,
  redMissilesFired: 0,
  blueMissilesFired: 0,
  redInterceptions: 0,
  blueInterceptions: 0,
  redScore: 0,
  blueScore: 0,
  firedEventIds: [] as string[],
  sortiesLaunched: 0,
});

describe('Joint sea-land-air & inland air-land mechanics', () => {
  test('disabled airbase stops launching sorties and ceases accepting returning aircraft', () => {
    const abPrimary = createRuntimeUnitFromPlacement(
      {
        id: 'ab_1',
        name: 'AB1',
        callsign: 'AB1',
        side: 'RED',
        platformId: 'red_airbase',
        parentGroupId: 'g',
        position: [102.6, 30.65],
        heading: 90,
      },
      catalog
    );
    const abBackup = createRuntimeUnitFromPlacement(
      {
        id: 'ab_2',
        name: 'AB2',
        callsign: 'AB2',
        side: 'RED',
        platformId: 'red_airbase',
        parentGroupId: 'g',
        position: [103.5, 30.65],
        heading: 90,
      },
      catalog
    );
    const units = { ab_1: abPrimary, ab_2: abBackup };
    const sortie = launchCarrierSortie(units, catalog, 'ab_1', 'airbase_j20_wing');
    expect(sortie).toBeDefined();
    expect(sortie!.callsign.startsWith('WING-')).toBe(true);
    expect(recoverySolution(sortie!, units, catalog).hostId).toBe('ab_1');

    // Damage ab_1 runway to mission-killed (< 30% HP)
    abPrimary.hp = abPrimary.maxHp * 0.2;
    expect(launchCarrierSortie(units, catalog, 'ab_1', 'airbase_j20_wing')).toBeUndefined();
    expect(recoverySolution(sortie!, units, catalog).hostId).toBe('ab_2');
  });

  test('mobile land unit executes deterministic shoot-and-scoot inside land polygon after firing', () => {
    const environment = {
      landPolygons: [
        {
          id: 'land_zone',
          name: 'Land',
          areaPolygon: [[102, 29], [106, 29], [106, 32], [102, 32]] as [number, number][],
        },
      ],
      acousticZones: [],
    };
    const shooter = createRuntimeUnitFromPlacement(
      {
        id: 'scoot_unit',
        name: 'Scooter',
        callsign: 'SCOOT-1',
        side: 'RED',
        platformId: 'yj12b_coastal_asm',
        parentGroupId: 'g',
        position: [103.0, 30.5],
        heading: 90,
        doctrine: { roe: 'free', shootAndScoot: true },
      },
      catalog
    );
    const enemy = createRuntimeUnitFromPlacement(
      {
        id: 'enemy_land',
        name: 'Enemy',
        callsign: 'ENEMY-1',
        side: 'BLUE',
        platformId: 'blue_radar_station',
        parentGroupId: 'g2',
        position: [103.8, 30.5],
        heading: 270,
      },
      catalog
    );
    const contact: TacticalContact = {
      id: 'RED_CONTACT_enemy_land',
      actualUnitId: enemy.id,
      observerSide: 'RED',
      targetSide: 'BLUE',
      domain: 'land',
      classification: 'identified',
      identifiedCategory: 'radar_site',
      displayName: 'Enemy Radar',
      sidc: enemy.sidc,
      estimatedPosition: [...enemy.position],
      truePosition: [...enemy.position],
      uncertaintyRadiusKm: 0.3,
      heading: 0,
      speedKts: 0,
      altitudeM: 200,
      firstDetectedTime: 0,
      lastDetectedTime: 0,
      detectedBySources: ['SCOOT-1'],
      sourceUnitIds: ['scoot_unit'],
      fireControlSourceIds: ['scoot_unit'],
      threatLevel: 'high',
    };
    const weaponsInFlight: Record<string, WeaponInFlight> = {};
    runAutoDefense({
      units: { scoot_unit: shooter, enemy_land: enemy },
      missions: [],
      contacts: { [contact.id]: contact },
      weaponsInFlight,
      catalog,
      environment,
      nextSimTime: 1000,
      score: emptyScore(),
      logs: [],
      autoPauseSettings: pausesOff,
      triggerPause: () => undefined,
    });
    expect(Object.keys(weaponsInFlight).length).toBeGreaterThan(0);
    expect(shooter.waypoints).toHaveLength(1);
    expect(shooter.targetSpeedKts).toBeGreaterThan(0);
  });

  test('control_area objective requires friendly presence and zero hostile presence at timeout', () => {
    const obj: ScenarioObjective = {
      id: 'ctrl',
      side: 'RED',
      title: 'Control Pass',
      type: 'control_area',
      unitIds: [],
      areaPolygon: [[104.2, 30.4], [104.7, 30.4], [104.7, 30.8], [104.2, 30.8]],
      controlDomains: ['land'],
      required: true,
      points: 200,
    };
    const redUnit = createRuntimeUnitFromPlacement(
      {
        id: 'r',
        name: 'R',
        callsign: 'R',
        side: 'RED',
        platformId: 'red_armor_brigade',
        parentGroupId: 'g',
        position: [104.4, 30.6],
        heading: 90,
      },
      catalog
    );
    const blueUnit = createRuntimeUnitFromPlacement(
      {
        id: 'b',
        name: 'B',
        callsign: 'B',
        side: 'BLUE',
        platformId: 'blue_armor_brigade',
        parentGroupId: 'g2',
        position: [104.5, 30.6],
        heading: 270,
      },
      catalog
    );
    const rules = { durationSec: 10, tacticalVictoryThreshold: 100, decisiveVictoryThreshold: 200 };
    // Before timeout: stays pending
    expect(evaluateObjectives([obj], {}, { r: redUnit }, {}, emptyScore(), 5000, 0, rules).progress.ctrl).toBe('pending');
    // At timeout when contested: failed
    expect(evaluateObjectives([obj], {}, { r: redUnit, b: blueUnit }, {}, emptyScore(), 10000, 0, rules).progress.ctrl).toBe('failed');
    // At timeout when uncontested: achieved
    expect(evaluateObjectives([obj], {}, { r: redUnit }, {}, emptyScore(), 10000, 0, rules).progress.ctrl).toBe('achieved');
  });

  test('control_area with holdDurationSec tracks continuous hold progress, force-ratio suppression, and mission-kill exclusion', () => {
    const holdObj: ScenarioObjective = {
      id: 'ctrl_hold',
      side: 'RED',
      title: 'Hold Pass 10s',
      type: 'control_area',
      unitIds: [],
      areaPolygon: [[104.2, 30.4], [104.7, 30.4], [104.7, 30.8], [104.2, 30.8]],
      controlDomains: ['land'],
      holdDurationSec: 10,
      required: true,
      points: 200,
    };
    const red1 = createRuntimeUnitFromPlacement(
      { id: 'r1', name: 'R1', callsign: 'R1', side: 'RED', platformId: 'red_armor_brigade', parentGroupId: 'g', position: [104.4, 30.6], heading: 90 },
      catalog
    );
    const red2 = createRuntimeUnitFromPlacement(
      { id: 'r2', name: 'R2', callsign: 'R2', side: 'RED', platformId: 'red_armor_brigade', parentGroupId: 'g', position: [104.45, 30.6], heading: 90 },
      catalog
    );
    const blue1 = createRuntimeUnitFromPlacement(
      { id: 'b1', name: 'B1', callsign: 'B1', side: 'BLUE', platformId: 'blue_armor_brigade', parentGroupId: 'g2', position: [104.5, 30.6], heading: 270 },
      catalog
    );
    const rules = { durationSec: 100, tacticalVictoryThreshold: 100, decisiveVictoryThreshold: 200 };

    // 1. Uncontested advances at 1.0x
    let res = evaluateObjectives([holdObj], {}, { r1: red1 }, {}, emptyScore(), 4000, 0, rules, 4, {});
    expect(res.holdProgress.ctrl_hold).toBe(4);
    expect(res.progress.ctrl_hold).toBe('pending');

    // 2. Contested parity (1v1) pauses progress
    res = evaluateObjectives([holdObj], res.progress, { r1: red1, b1: blue1 }, {}, emptyScore(), 8000, 0, rules, 4, res.holdProgress);
    expect(res.holdProgress.ctrl_hold).toBe(4);

    // 3. Force-ratio suppression (>= 2.5x: 2 full brigades = 3.0 vs crippled defender = 0.525) advances at 0.5x
    blue1.hp = Math.ceil(blue1.maxHp * 0.35);
    expect(evaluateAreaControlStatus(holdObj, { r1: red1, r2: red2, b1: blue1 }).state).toBe('suppressing');
    res = evaluateObjectives([holdObj], res.progress, { r1: red1, r2: red2, b1: blue1 }, {}, emptyScore(), 12000, 0, rules, 4, res.holdProgress);
    expect(res.holdProgress.ctrl_hold).toBe(6);

    // 4. Mission-killed defender (< 30% HP) is fully neutralized -> uncontested 1.0x completes early before timeout!
    blue1.hp = Math.floor(blue1.maxHp * 0.2);
    expect(evaluateAreaControlStatus(holdObj, { r1: red1, b1: blue1 }).state).toBe('uncontested');
    const score = emptyScore();
    res = evaluateObjectives([holdObj], res.progress, { r1: red1, b1: blue1 }, {}, score, 16000, 0, rules, 4, res.holdProgress);
    expect(res.progress.ctrl_hold).toBe('achieved');
    expect(score.redScore).toBe(200);
    expect(res.battleResult).toBeUndefined();
  });

  test('amphibious ship blocks offshore disembarkation, lands ground_force near coastline, and replays deterministically', () => {
    store.getState().loadScenario(SCENARIO_JOINT_AMPHIBIOUS_ASSAULT, false, 3141);
    store.setState({ autoPause: pausesOff });
    // Initially at 119.92E (>50km from 120.5E island coast): offshore disembarkation must be blocked
    const before = store.getState();
    store.getState().deployCarriedPlatform('joint_red_lhd', 'red_armor_brigade');
    expect(store.getState()).toBe(before);

    // Move LHD in sandbox to 120.42E (within 18km of 120.5E island coast), switch back to command mode and disembark
    store.getState().setPlayMode('sandbox');
    store.getState().moveUnitInSandbox('joint_red_lhd', [120.42, 23.75]);
    store.getState().setPlayMode('command');
    store.getState().deployCarriedPlatform('joint_red_lhd', 'red_armor_brigade');

    const stateAfterLanding = store.getState();
    expect(stateAfterLanding.units.joint_red_lhd.deployableInventory.red_armor_brigade).toBe(1);
    const landedBrigade = Object.values(stateAfterLanding.units).find(
      (u) => u.deployedByUnitId === 'joint_red_lhd' && u.platformId === 'red_armor_brigade'
    );
    expect(landedBrigade).toBeDefined();
    expect(landedBrigade!.domain).toBe('land');
    expect(landedBrigade!.position[0]).toBeGreaterThanOrEqual(120.5);
    expect(landedBrigade!.waypoints.length).toBeGreaterThan(0);

    store.getState().stepSingleTick(15);
    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    for (const batch of [1, 15, 60]) {
      expect(replayBattleRecording(recording, batch)).toEqual(expected);
    }
  });

  test('joint amphibious and pure inland air-land scenarios compile, isolate domains, and replay deterministically', () => {
    const compiledJoint = compileScenario(SCENARIO_JOINT_AMPHIBIOUS_ASSAULT);
    const compiledInland = compileScenario(SCENARIO_INLAND_AIR_LAND);
    expect(compiledJoint.scenario.objectives?.some((o) => o.type === 'control_area')).toBe(true);
    expect(compiledInland.scenario.objectives?.some((o) => o.type === 'control_area')).toBe(true);

    const inlandUnits = instantiateScenarioUnits(SCENARIO_INLAND_AIR_LAND);
    expect(Object.values(inlandUnits).every((u) => u.domain === 'air' || u.domain === 'land')).toBe(true);
    expect(
      hasRadarLineOfSight(
        [103.5, 31.3],
        0,
        25,
        [105.0, 31.3],
        350,
        compiledInland.scenario.environment
      )
    ).toBe(false);
    expect(
      hasRadarLineOfSight(
        [103.5, 30.65],
        0,
        25,
        [105.0, 30.65],
        350,
        compiledInland.scenario.environment
      )
    ).toBe(true);

    for (const scenario of [SCENARIO_JOINT_AMPHIBIOUS_ASSAULT, SCENARIO_INLAND_AIR_LAND]) {
      store.getState().loadScenario(scenario, false, 2027);
      store.setState({ autoPause: pausesOff });
      store.getState().stepSingleTick(45);
      const expected = canonicalBattleState();
      const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
      for (const batch of [1, 5, 15, 60]) {
        expect(replayBattleRecording(recording, batch)).toEqual(expected);
      }
    }
  });
});
