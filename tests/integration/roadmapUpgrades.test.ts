import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../src/db';
import { launchGuidance, seekerCanObserve } from '../../src/engine/guidance';
import { computeContactsOnly } from '../../src/engine/sensors';
import {
  createRuntimeUnitFromPlacement,
  stepSimulationWorld,
  type SimulationWorldState,
} from '../../src/engine/simulationEngine';
import { SCENARIO_EAST_SEA_THUNDER } from '../../src/scenarios/builtinScenarios';
import { compileScenario } from '../../src/scenarios/compileScenario';
import { SCENARIO_INTERACTIVE_TUTORIAL } from '../../src/scenarios/tutorialScenario';
import {
  captureBattleRecording,
  captureBattleSave,
  canonicalBattleState,
  replayBattleRecording,
  restoreBattleSave,
  SNAPSHOT_INTERVAL_TICKS,
} from '../../src/store/battleRecording';
import { useWargameStore as store } from '../../src/store/useWargameStore';
import type { InitialUnitPlacement, TacticalContact, WeaponInFlight } from '../../src/types/wargame';

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

const placement = (id: string, extra: Partial<InitialUnitPlacement> = {}): InitialUnitPlacement => ({
  id,
  name: id,
  callsign: id,
  side: 'RED',
  platformId: 'type055_destroyer',
  parentGroupId: 'red_surface_tg',
  position: [0, 0],
  speedKts: 0,
  heading: 90,
  doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: false },
  ...extra,
});

describe('Terrain occlusion, missile energy & terminal seeker switching', () => {
  test('terrain elevation blocks X-band surface radar & missile seeker LOS until line of sight clears', () => {
    const observer = createRuntimeUnitFromPlacement(
      placement('obs', { position: [0, 0], doctrine: { roe: 'hold', emconRadar: true } }),
      catalog
    );
    const target = createRuntimeUnitFromPlacement(
      placement('tgt', {
        side: 'BLUE',
        platformId: 'j20_mighty_dragon',
        position: [0.25, 0],
        altitudeM: 120,
        doctrine: { roe: 'hold', emconRadar: false },
      }),
      catalog
    );
    const environment = {
      landPolygons: [
        {
          id: 'island_ridge',
          name: 'Ridge',
          elevationM: 350,
          areaPolygon: [[0.1, -0.2], [0.15, -0.2], [0.15, 0.2], [0.1, 0.2]] as [number, number][],
        },
      ],
      acousticZones: [],
    };
    expect(computeContactsOnly({ obs: observer, tgt: target }, catalog, {}, 0, 0, environment).contacts.RED_CONTACT_tgt).toBeUndefined();
    expect(computeContactsOnly({ obs: observer, tgt: target }, catalog, {}, 0, 0).contacts.RED_CONTACT_tgt).toBeDefined();
    target.altitudeM = 3000;
    expect(computeContactsOnly({ obs: observer, tgt: target }, catalog, {}, 0, 0, environment).contacts.RED_CONTACT_tgt).toBeDefined();
    target.altitudeM = 120;

    const shipTarget = createRuntimeUnitFromPlacement(
      placement('ship_tgt', {
        side: 'BLUE',
        platformId: 'arleigh_burke_flt3',
        position: [0.2, 0],
        altitudeM: 0,
        doctrine: { roe: 'hold', emconRadar: false },
      }),
      catalog
    );
    const missile: WeaponInFlight = {
      id: 'm_los',
      weaponId: 'yj18_ashm',
      name: 'YJ-18',
      side: 'RED',
      shooterId: observer.id,
      shooterName: observer.callsign,
      targetId: shipTarget.id,
      targetType: 'unit',
      position: [0.05, 0],
      launchPosition: [0.05, 0],
      trail: [],
      altitudeM: 12,
      heading: 90,
      speedKts: catalog.weapons.yj18_ashm.speedKts,
      distanceRemainingKm: 16,
      maxRangeKm: catalog.weapons.yj18_ashm.maxRangeKm,
      traveledKm: 0,
      basePk: catalog.weapons.yj18_ashm.basePk,
      warheadDamage: catalog.weapons.yj18_ashm.warheadDamage,
    };
    expect(seekerCanObserve(missile, catalog.weapons.yj18_ashm, shipTarget, catalog, false, environment)).toBe(false);
    expect(seekerCanObserve(missile, catalog.weapons.yj18_ashm, shipTarget, catalog, false)).toBe(true);
  });

  test('missile speed decays after midcourse boost and terminal seeker switches to secondary target/decoy when primary is lost', () => {
    const shooter = createRuntimeUnitFromPlacement(placement('shooter', { position: [0, 0] }), catalog);
    const primary = createRuntimeUnitFromPlacement(
      placement('primary', { side: 'BLUE', position: [0.1, 0] }),
      catalog
    );
    primary.hp = 0;
    primary.status = 'destroyed';
    const decoy = createRuntimeUnitFromPlacement(
      placement('decoy', { side: 'BLUE', platformId: 'adm160_mald', position: [0.12, 0], altitudeM: 5000 }),
      catalog
    );

    const contact: TacticalContact = {
      id: 'RED_CONTACT_primary',
      actualUnitId: primary.id,
      observerSide: 'RED',
      targetSide: 'BLUE',
      domain: 'air',
      classification: 'classified',
      displayName: 'Contact',
      sidc: decoy.sidc,
      estimatedPosition: [0.1, 0],
      truePosition: [0.1, 0],
      uncertaintyRadiusKm: 0.5,
      heading: 90,
      speedKts: 400,
      altitudeM: 5000,
      firstDetectedTime: 0,
      lastDetectedTime: 0,
      detectedBySources: ['obs'],
      threatLevel: 'high',
    };
    const weapon = catalog.weapons.pl15_aam;
    const missile: WeaponInFlight = {
      id: 'm_switch',
      weaponId: weapon.id,
      name: weapon.codeName,
      side: 'RED',
      shooterId: shooter.id,
      shooterName: shooter.callsign,
      targetId: primary.id,
      targetType: 'unit',
      position: [0.08, 0],
      launchPosition: [0, 0],
      trail: [],
      altitudeM: 5000,
      heading: 90,
      speedKts: weapon.speedKts,
      distanceRemainingKm: 3,
      maxRangeKm: weapon.maxRangeKm,
      traveledKm: weapon.maxRangeKm * 0.85,
      basePk: weapon.basePk,
      warheadDamage: weapon.warheadDamage,
      ...launchGuidance(contact),
      seekerState: 'terminal_searching',
    };

    const world: SimulationWorldState = {
      startTime: 0,
      simTime: 0,
      tick: 0,
      rngState: 99,
      units: { shooter, primary, decoy },
      contacts: {},
      weaponsInFlight: { [missile.id]: missile },
      explosions: [],
      missions: [],
      score: emptyScore(),
    };
    const next = stepSimulationWorld(world, catalog, 0.25, pausesOff, 'RED', () => 0.99);
    const updated = next.nextState.weaponsInFlight[missile.id];
    expect(updated).toBeDefined();
    expect(updated.targetId).toBe(decoy.id);
    expect(updated.speedKts).toBeLessThan(weapon.speedKts);
  });
});

describe('Snapshot-accelerated replay and resumable full-state save', () => {
  test('keyframe snapshots accelerate arbitrary-tick replay with bit-for-bit identical canonical state', () => {
    store.getState().loadScenario(SCENARIO_EAST_SEA_THUNDER, false, 1024);
    store.setState({ autoPause: pausesOff });
    // Advance past SNAPSHOT_INTERVAL_TICKS (240 ticks = 60s)
    store.getState().stepSingleTick(65);
    expect(store.getState().tick).toBeGreaterThan(SNAPSHOT_INTERVAL_TICKS);
    expect(store.getState().replaySnapshots.length).toBeGreaterThanOrEqual(1);
    store.getState().updateUnitDoctrine('red_j20_alpha', { roe: 'hold' });
    store.getState().stepSingleTick(10);

    const expected = canonicalBattleState();
    const withSnapshots = JSON.parse(JSON.stringify(captureBattleRecording()));
    const withoutSnapshots = { ...withSnapshots, snapshots: undefined };
    expect(withSnapshots.snapshots?.length).toBeGreaterThanOrEqual(1);
    expect(replayBattleRecording(withSnapshots, 60)).toEqual(expected);
    expect(replayBattleRecording(withoutSnapshots, 60)).toEqual(expected);
  });

  test('captures and restores resumable battle save and rejects tampered digests atomically', () => {
    store.getState().loadScenario(SCENARIO_INTERACTIVE_TUTORIAL, false, 555);
    store.setState({ autoPause: pausesOff });
    store.getState().updateUnitDoctrine('tut_red_ddg', { emconRadar: true });
    store.getState().stepSingleTick(10);

    const expected = canonicalBattleState();
    const save = JSON.parse(JSON.stringify(captureBattleSave()));
    store.getState().loadScenario(SCENARIO_EAST_SEA_THUNDER, false, 1);
    expect(restoreBattleSave(save)).toEqual(expected);

    const beforeTamper = store.getState();
    expect(() => restoreBattleSave({ ...save, digest: 'deadbeef00000000' })).toThrow('digest');
    expect(store.getState()).toBe(beforeTamper);
  });
});

describe('Multi-stage campaign & interactive tutorial scenario', () => {
  test('tutorial scenario compiles and completes cleanly', () => {
    const compiled = compileScenario(SCENARIO_INTERACTIVE_TUTORIAL);
    expect(compiled.scenario.id).toBe('interactive_command_tutorial');
    store.getState().loadScenario(SCENARIO_INTERACTIVE_TUTORIAL, false, 77);
    store.setState({ autoPause: pausesOff });
    store.getState().updateUnitDoctrine('tut_red_awacs', { emconRadar: true });
    store.getState().stepSingleTick(5);
    expect(Object.keys(store.getState().contacts).length).toBeGreaterThan(0);
  });

  test('campaign advances across stages with deterministic carryover', () => {
    store.getState().startCampaign('RED');
    expect(store.getState().campaignState?.currentStageIndex).toBe(0);
    store.setState({ autoPause: pausesOff });
    // Run Stage 1 (limited_information_exercise = 900s) to completion
    store.getState().stepSingleTick(905);
    expect(store.getState().battleResult).toBeDefined();

    store.getState().advanceCampaignStage();
    const stage2 = store.getState().campaignState;
    expect(stage2?.currentStageIndex).toBe(1);
    expect(stage2?.carryover.completedStages).toBe(1);
    expect(store.getState().currentScenario.id).toContain('op_east_sea_thunder_2027__campaign_s2');
    expect(store.getState().playerSide).toBe('RED');
  });
});
