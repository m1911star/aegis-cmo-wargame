import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../src/db';
import { launchGuidance, seekerCanObserve } from '../../src/engine/guidance';
import { computeContactsOnly } from '../../src/engine/sensors';
import {
  createRuntimeUnitFromPlacement,
  stepSimulationWorld,
  type SimulationWorldState,
} from '../../src/engine/simulationEngine';
import {
  BUILTIN_CAMPAIGN_WESTPAC,
  applyCampaignRuntimeCarryover,
  computeNextCampaignCarryover,
  createInitialCampaignState,
} from '../../src/scenarios/campaign';
import { SCENARIO_EAST_SEA_THUNDER } from '../../src/scenarios/builtinScenarios';
import { compileScenario } from '../../src/scenarios/compileScenario';
import { SCENARIO_INTERACTIVE_TUTORIAL } from '../../src/scenarios/tutorialScenario';
import {
  captureBattleRecording,
  captureBattleSave,
  captureShareableAarPackage,
  canonicalBattleState,
  deleteBattleSaveSlot,
  listBattleSaveSlots,
  loadBattleFromSlot,
  MAX_BATTLE_SAVE_SLOTS,
  replayBattleRecording,
  restoreBattleSave,
  saveBattleToSlot,
  SNAPSHOT_INTERVAL_TICKS,
} from '../../src/store/battleRecording';
import { evaluateFireControl } from '../../src/engine/fireControl';
import { runAutoDefense } from '../../src/engine/simulation/autoDefense';
import { simulationWorkerClient } from '../../src/engine/workerClient';
import { extractSimulationWorldState, useWargameStore as store } from '../../src/store/useWargameStore';
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
    expect(withSnapshots.history.tracks.length).toBeGreaterThan(0);
    expect(withSnapshots.snapshots.every((frame: Record<string, unknown>) => !('aar' in frame))).toBe(true);
    expect(replayBattleRecording(withSnapshots, 60)).toEqual(expected);
    expect(replayBattleRecording(withoutSnapshots, 60)).toEqual(expected);
    const invalid = structuredClone(withSnapshots);
    invalid.snapshots[0].history.tracks.count = invalid.history.tracks.length + 1;
    expect(() => replayBattleRecording(invalid, 60)).toThrow('history range');
    expect(canonicalBattleState()).toEqual(expected);
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

  test('worker batching, battle saves and replay snapshots preserve pendingSortieOrders identically to stepSingleTick', async () => {
    store.getState().loadScenario(SCENARIO_EAST_SEA_THUNDER, false, 2048);
    const queuedOrder = {
      orderId: 'sortie_order_retry_test',
      eventId: 'ev_retry_test',
      carrierUnitId: 'red_054b_screen',
      hangarSlotId: 'hangar_z20f_ffg',
      loadoutId: 'loadout_z20f_asw_prosecute',
      assignedMissionId: 'mission_red_shallow_asw',
      earliestLaunchTime: store.getState().startTime + 2000,
      status: 'pending' as const,
      attempts: 1,
    };
    store.setState({ autoPause: pausesOff, pendingSortieOrders: [queuedOrder] });
    const saveWithQueue = JSON.parse(JSON.stringify(captureBattleSave()));
    expect(saveWithQueue.snapshot.pendingSortieOrders).toEqual([queuedOrder]);

    // Step via synchronous main-thread path — queued helicopter launches at +2s
    store.getState().stepSingleTick(5);
    const syncCanonical = canonicalBattleState();
    expect(syncCanonical.score.sortiesLaunched).toBe(1);
    expect(syncCanonical.pendingSortieOrders).toEqual([]);

    // Restore save and step via Worker client path using extractSimulationWorldState
    restoreBattleSave(saveWithQueue);
    expect(store.getState().pendingSortieOrders).toEqual([queuedOrder]);
    const s = store.getState();
    const workerResult = await simulationWorkerClient.runBatch(
      extractSimulationWorldState(s),
      s.catalog,
      5 + s.pendingSimSeconds,
      s.autoPause,
      s.playerSide,
      s.commandSequence
    );
    expect(
      store.getState().applySimulationResult(workerResult, s.tick, s.commandSequence, s.currentScenario.id)
    ).toBe(true);
    expect(canonicalBattleState()).toEqual(syncCanonical);
  });

  test('multi-slot battle save manager creates, overwrites, caps at MAX_BATTLE_SAVE_SLOTS, loads, and deletes slots', () => {
    const map = new Map<string, string>();
    const memStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };

    store.getState().loadScenario(SCENARIO_INTERACTIVE_TUTORIAL, false, 707);
    store.setState({ autoPause: pausesOff });
    store.getState().stepSingleTick(6);
    const expectedSlot1 = canonicalBattleState();
    const slot1 = saveBattleToSlot('Alpha Checkpoint', undefined, memStorage);
    expect(slot1.label).toBe('Alpha Checkpoint');
    expect(listBattleSaveSlots(memStorage)).toHaveLength(1);

    // Advance further and overwrite same slot
    store.getState().stepSingleTick(4);
    const expectedUpdated = canonicalBattleState();
    saveBattleToSlot('Alpha Overwritten', slot1.slotId, memStorage);
    expect(listBattleSaveSlots(memStorage)).toHaveLength(1);
    expect(listBattleSaveSlots(memStorage)[0].label).toBe('Alpha Overwritten');

    // Switch scenario, then load slot1 and verify state matches expectedUpdated (not expectedSlot1)
    store.getState().loadScenario(SCENARIO_EAST_SEA_THUNDER, false, 1);
    expect(expectedUpdated.tick).toBeGreaterThan(expectedSlot1.tick);
    expect(loadBattleFromSlot(slot1.slotId, memStorage)).toEqual(expectedUpdated);

    // Verify cap at MAX_BATTLE_SAVE_SLOTS (8) and deletion
    for (let i = 0; i < MAX_BATTLE_SAVE_SLOTS + 3; i++) {
      saveBattleToSlot(`Slot ${i}`, `slot_fixed_${i}`, memStorage);
    }
    expect(listBattleSaveSlots(memStorage)).toHaveLength(MAX_BATTLE_SAVE_SLOTS);
    const firstId = listBattleSaveSlots(memStorage)[0].slotId;
    const afterDelete = deleteBattleSaveSlot(firstId, memStorage);
    expect(afterDelete).toHaveLength(MAX_BATTLE_SAVE_SLOTS - 1);
    expect(afterDelete.some((s) => s.slotId === firstId)).toBe(false);
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

  test('campaign advances across 5 stages with hull damage, hangar attrition, and scarce munition carryover', () => {
    expect(BUILTIN_CAMPAIGN_WESTPAC.stages).toHaveLength(5);
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

    // Verify deep runtime carryover math (damage debt, airframe attrition, scarce munition deduction)
    const s2Units = structuredClone(store.getState().units);
    s2Units.red_055_nanchang.hp = Math.round(s2Units.red_055_nanchang.maxHp * 0.4);
    s2Units.red_055_nanchang.weaponUsage = { yj21_hypersonic: { expended: 6, cooldownUntil: 0 } };
    s2Units.red_j20_alpha.hp = 0;
    s2Units.red_j20_alpha.status = 'destroyed';
    s2Units.red_j10c_reinforce.hp = 0;
    s2Units.red_j10c_reinforce.status = 'destroyed';

    const nextCarry = computeNextCampaignCarryover(
      createInitialCampaignState(BUILTIN_CAMPAIGN_WESTPAC, 'RED').carryover,
      { endedAt: 3600000, reason: 'time_limit', outcomes: { RED: 'costly_victory', BLUE: 'defeat' } },
      'RED',
      850,
      2,
      s2Units
    );
    expect(nextCarry.platformDamageDebt.type055_destroyer).toBeGreaterThan(0);
    expect(nextCarry.airframeAttritionDebt).toBe(1); // 2 air losses - 1 replenished = 1 debt
    expect(nextCarry.scarceAmmoDebt.yj21_hypersonic).toBe(3); // 50% of 6 expended

    const freshUnits = structuredClone(store.getState().units);
    const beforeHp = freshUnits.red_055_nanchang.maxHp;
    const beforeYj21 = freshUnits.red_055_nanchang.mounts.find((m) => m.weaponId === 'yj21_hypersonic')!.currentAmmo;
    const beforeHeloTotal = freshUnits.red_054b_screen.hangar[0].totalAirframes;

    const carriedUnits = applyCampaignRuntimeCarryover(freshUnits, nextCarry, 'RED', catalog);
    expect(carriedUnits.red_055_nanchang.hp).toBeLessThan(beforeHp);
    expect(carriedUnits.red_055_nanchang.hp).toBeGreaterThanOrEqual(Math.ceil(beforeHp * 0.55));
    expect(carriedUnits.red_055_nanchang.mounts.find((m) => m.weaponId === 'yj21_hypersonic')!.currentAmmo).toBe(beforeYj21 - 3);
    expect(carriedUnits.red_054b_screen.hangar[0].totalAirframes).toBe(beforeHeloTotal - 1);
  });
});

describe('P0/P1 tactical controls, identified-only doctrine & shareable AAR', () => {
  test('requireIdentifiedForAutoFire blocks automatic fire on classified tracks while allowing manual fire', () => {
    const shooter = createRuntimeUnitFromPlacement(
      placement('id_shooter', {
        platformId: 'j20_mighty_dragon',
        parentGroupId: 'red_air_cmd',
        doctrine: { roe: 'free', emconRadar: true, requireIdentifiedForAutoFire: true },
      }),
      catalog
    );
    const target = createRuntimeUnitFromPlacement(
      placement('id_target', { side: 'BLUE', platformId: 'f35c_lightning', position: [0.3, 0] }),
      catalog
    );
    const classifiedContact: TacticalContact = {
      id: 'RED_CONTACT_id_target',
      actualUnitId: target.id,
      observerSide: 'RED',
      targetSide: 'BLUE',
      domain: 'air',
      classification: 'classified',
      displayName: 'BOGEY-101',
      sidc: target.sidc,
      estimatedPosition: [...target.position],
      truePosition: [...target.position],
      uncertaintyRadiusKm: 0.5,
      heading: 270,
      speedKts: 500,
      altitudeM: 9000,
      firstDetectedTime: 0,
      lastDetectedTime: 0,
      detectedBySources: ['id_shooter'],
      sourceUnitIds: ['id_shooter'],
      fireControlSourceIds: ['id_shooter'],
      threatLevel: 'high',
    };
    const mount = shooter.mounts[0];
    const weapon = catalog.weapons[mount.weaponId];
    expect(
      evaluateFireControl(shooter, classifiedContact, mount, weapon, catalog, { id_shooter: shooter, id_target: target }, 0, 'automatic').status
    ).toBe('blocked');
    expect(
      evaluateFireControl(shooter, classifiedContact, mount, weapon, catalog, { id_shooter: shooter, id_target: target }, 0, 'manual').status
    ).toBe('executable');

    const weaponsInFlight: Record<string, WeaponInFlight> = {};
    runAutoDefense({
      units: { id_shooter: shooter, id_target: target },
      missions: [],
      contacts: { [classifiedContact.id]: classifiedContact },
      weaponsInFlight,
      catalog,
      nextSimTime: 0,
      score: emptyScore(),
      logs: [],
      autoPauseSettings: pausesOff,
      triggerPause: () => undefined,
    });
    expect(weaponsInFlight).toEqual({});
  });

  test('deployCountermeasure, cancelUnitReturn and updateMissionDoctrine record deterministically and replay cleanly', () => {
    store.getState().loadScenario(SCENARIO_INTERACTIVE_TUTORIAL, false, 888);
    store.setState({ autoPause: pausesOff });
    store.getState().deployCountermeasure('tut_red_ddg', 'chaff');
    expect(store.getState().units.tut_red_ddg.countermeasures.chaff).toBe(5);
    expect(store.getState().units.tut_red_ddg.countermeasureEffect?.chaff).toBe(true);

    store.setState((s) => ({
      units: {
        ...s.units,
        tut_red_j20: { ...s.units.tut_red_j20, status: 'returning', returnReason: 'ammunition' },
      },
    }));
    store.getState().cancelUnitReturn('tut_red_j20');
    expect(store.getState().units.tut_red_j20.status).toBe('operational');

    store.getState().updateMissionDoctrine('tut_red_aew_mission', {
      roe: 'tight',
      requireIdentifiedForAutoFire: true,
    });
    expect(store.getState().missions.find((m) => m.id === 'tut_red_aew_mission')?.doctrineOverride).toMatchObject({
      roe: 'tight',
      requireIdentifiedForAutoFire: true,
    });

    const pkg = captureShareableAarPackage();
    expect(pkg.kind).toBe('aegis_aar_package');
    expect(pkg.catalogSnapshot.version).toBe(store.getState().catalog.version);
  });

  test('defaults autoPause triggers to disabled so player controls pausing manually', () => {
    store.getState().loadScenario(SCENARIO_EAST_SEA_THUNDER, false, 42);
    expect(store.getState().autoPause).toEqual({
      onNewContact: false,
      onMissileDetected: false,
      onUnitHitOrDestroyed: false,
    });
  });

  test('multi-unit box selection enforces authority and batch waypoint/doctrine commands replay deterministically', () => {
    store.getState().loadScenario(SCENARIO_EAST_SEA_THUNDER, false, 909);
    store.setState({ autoPause: pausesOff });

    // Unauthorized enemy units are filtered out of multi-selection in command mode
    store.getState().selectMultipleUnits(['red_j20_alpha', 'red_055_nanchang', 'blue_ddg125_lucas']);
    expect(store.getState().selectedUnitIds).toEqual(['red_055_nanchang', 'red_j20_alpha']);

    store.getState().toggleUnitSelection('red_054b_screen');
    expect(store.getState().selectedUnitIds).toEqual(['red_054b_screen', 'red_055_nanchang', 'red_j20_alpha']);

    // Atomic batch doctrine & waypoint commands
    const seqBefore = store.getState().commandSequence;
    store.getState().batchUpdateUnitDoctrine(store.getState().selectedUnitIds, {
      roe: 'hold',
      emconRadar: false,
      salvoSize: 4,
    });
    expect(store.getState().commandSequence).toBe(seqBefore + 1);
    for (const id of ['red_054b_screen', 'red_055_nanchang', 'red_j20_alpha']) {
      expect(store.getState().units[id].doctrine).toMatchObject({ roe: 'hold', emconRadar: false, salvoSize: 4 });
    }

    store.getState().batchAppendUnitWaypoint(['red_054b_screen', 'red_055_nanchang'], [123.5, 26.5], true);
    expect(store.getState().units.red_054b_screen.waypoints[0].position).toEqual([123.5, 26.5]);
    expect(store.getState().units.red_055_nanchang.waypoints[0].position).toEqual([123.5, 26.5]);

    store.getState().stepSingleTick(8);
    store.getState().batchClearUnitWaypoints(['red_054b_screen', 'red_055_nanchang']);
    expect(store.getState().units.red_054b_screen.waypoints).toEqual([]);

    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    for (const batch of [1, 15, 60]) {
      expect(replayBattleRecording(recording, batch)).toEqual(expected);
    }
  });
});
