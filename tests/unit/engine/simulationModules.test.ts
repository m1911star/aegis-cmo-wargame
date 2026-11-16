import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../../src/db';
import { resolveUnitConfiguration } from '../../../src/db/unitConfiguration';
import { getCompiledPolygon, hasRadarLineOfSight, pointInBbox, segmentOverlapsBbox } from '../../../src/engine/environment';
import { evaluateTargetEcmSuppression, resolveUnitJammingCapability } from '../../../src/engine/sensors';
import { seekerCanObserve } from '../../../src/engine/guidance';
import { advanceWeaponPhysics } from '../../../src/engine/simulation/weaponPhysics';
import { computeMissileEnergyFactor } from '../../../src/engine/guidance';
import { deriveMissionAssignments } from '../../../src/engine/missions';
import { createAarLedger, recordAarTick } from '../../../src/engine/aar';
import { evaluateBattleAssessment } from '../../../src/engine/simulation/battleAssessment';
import { createRuntimeUnitFromPlacement } from '../../../src/engine/simulation/unitFactory';
import { advanceSimulation, type SimulationWorldState } from '../../../src/engine/simulationEngine';
import { SimulationWorkerClient, type WorkerLike } from '../../../src/engine/workerClient';
import {
  handleSimulationWorkerRequest,
  type SimulationWorkerRequest,
  type SimulationWorkerResponse,
  type WorkerAdvanceBatchRequest,
} from '../../../src/engine/workerProtocol';
import type { InitialUnitPlacement, ScoreLedger, WeaponInFlight } from '../../../src/types/wargame';

const emptyScore = (): ScoreLedger => ({
  redLosses: 0,
  blueLosses: 0,
  redMissilesFired: 0,
  blueMissilesFired: 0,
  redInterceptions: 0,
  blueInterceptions: 0,
  redScore: 0,
  blueScore: 0,
  firedEventIds: [],
  sortiesLaunched: 0,
});

describe('modular simulation boundaries', () => {
  test.each([
    [400, 0, 'RED_DECISIVE_VICTORY'],
    [150, 0, 'RED_TACTICAL_VICTORY'],
    [0, 400, 'BLUE_DECISIVE_VICTORY'],
    [0, 150, 'BLUE_TACTICAL_VICTORY'],
    [50, 50, 'STRATEGIC_DRAW'],
  ] as const)('assesses score %i:%i as %s', (redScore, blueScore, grade) => {
    expect(
      evaluateBattleAssessment({ ...emptyScore(), redScore, blueScore }).grade
    ).toBe(grade);
  });

  test('unit factory applies deterministic spawn jitter and platform limits', () => {
    const placement: InitialUnitPlacement = {
      id: 'unit',
      name: 'Unit',
      callsign: 'UNIT',
      side: 'RED',
      platformId: 'j20_mighty_dragon',
      parentGroupId: 'red_air_cmd',
      position: [120, 25],
      heading: 90,
      speedKts: 100_000,
      altitudeM: 100_000,
      spawnJitterKm: 10,
    };
    const rngValues = [0.5, 0.25];
    const unit = createRuntimeUnitFromPlacement(
      placement,
      catalog,
      () => rngValues.shift() ?? 0
    );
    const spec = catalog.platforms[placement.platformId];

    expect(unit.position).not.toEqual(placement.position);
    expect(unit.speedKts).toBeLessThanOrEqual(spec.maxSpeedKts);
    expect(unit.altitudeM).toBe(spec.maxAltitudeM);
    expect(placement.position).toEqual([120, 25]);
  });

  test('fixed-step facade rejects an invalid time budget', () => {
    const world: SimulationWorldState = {
      simTime: 0,
      units: {},
      contacts: {},
      weaponsInFlight: {},
      explosions: [],
      missions: [],
      score: emptyScore(),
    };
    expect(() =>
      advanceSimulation(
        world,
        catalog,
        -1,
        {
          onNewContact: false,
          onMissileDetected: false,
          onUnitHitOrDestroyed: false,
        },
        'GOD'
      )
    ).toThrow('Invalid simulation duration');
  });

  test('terrain elevation blocks low-altitude radar LOS while high-altitude observers clear it', () => {
    const env = {
      landPolygons: [
        {
          id: 'ridge',
          name: 'Ridge',
          elevationM: 400,
          areaPolygon: [[0.08, -0.2], [0.12, -0.2], [0.12, 0.2], [0.08, 0.2]] as [number, number][],
        },
      ],
      acousticZones: [],
    };
    expect(hasRadarLineOfSight([0, 0], 0, 20, [0.2, 0], 15, env)).toBe(false);
    expect(hasRadarLineOfSight([0, 0], 9000, 0, [0.2, 0], 15, env)).toBe(true);
    expect(hasRadarLineOfSight([0.1, 0], 100, 15, [0.2, 0], 15, env)).toBe(true);
  });

  test('missile energy factor stays at 1.0 inside 55% range and decays smoothly afterward', () => {
    const weapon = catalog.weapons.pl15_aam;
    const baseMissile = {
      traveledKm: weapon.maxRangeKm * 0.4,
    } as WeaponInFlight;
    expect(computeMissileEnergyFactor(baseMissile, weapon)).toBe(1);
    expect(computeMissileEnergyFactor({ ...baseMissile, traveledKm: weapon.maxRangeKm }, weapon)).toBeCloseTo(0.55, 4);
  });

  test('worker protocol and sync fallback client match advanceSimulation identically', async () => {
    const unit = createRuntimeUnitFromPlacement(
      {
        id: 'w_unit',
        name: 'W',
        callsign: 'W1',
        side: 'RED',
        platformId: 'j20_mighty_dragon',
        parentGroupId: 'red_air_cmd',
        position: [122, 25],
        heading: 90,
        speedKts: 500,
      },
      catalog
    );
    const world: SimulationWorldState = {
      startTime: 0,
      simTime: 0,
      tick: 0,
      rngState: 42,
      units: { w_unit: unit },
      contacts: {},
      weaponsInFlight: {},
      explosions: [],
      missions: [],
      score: emptyScore(),
    };
    const pauses = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };
    const syncResult = advanceSimulation(world, catalog, 2, pauses, 'RED');
    const protocolResult = handleSimulationWorkerRequest({
      type: 'ADVANCE_BATCH',
      requestId: 1,
      epoch: 0,
      world,
      catalog,
      seconds: 2,
      autoPause: pauses,
      playerSide: 'RED',
    });
    expect(protocolResult.type).toBe('ADVANCE_BATCH_RESULT');
    if (protocolResult.type === 'ADVANCE_BATCH_RESULT') {
      expect(protocolResult.result.nextState).toEqual(syncResult.nextState);
    }
    const client = new SimulationWorkerClient();
    const clientResult = await client.runBatch(world, catalog, 2, pauses, 'RED', 0);
    expect(clientResult.nextState).toEqual(syncResult.nextState);
  });

  test('compiled polygon bbox cache and resolveUnitConfiguration memoization preserve identity and invalidate on mutation', () => {
    const polyA: [number, number][] = [[120, 23], [122, 23], [122, 25], [120, 25]];
    const polyB: [number, number][] = [[120, 23], [122, 23], [122, 25], [120, 25]];
    const compiledA = getCompiledPolygon(polyA);
    const compiledB = getCompiledPolygon(polyB);
    expect(compiledA).toBe(compiledB);
    expect(compiledA.bbox).toEqual([120, 23, 122, 25]);
    expect(pointInBbox([121, 24], compiledA.bbox)).toBe(true);
    expect(pointInBbox([118, 24], compiledA.bbox)).toBe(false);
    expect(segmentOverlapsBbox([118, 24], [119.5, 24], compiledA.bbox)).toBe(false);
    expect(segmentOverlapsBbox([119, 24], [123, 24], compiledA.bbox)).toBe(true);

    const cfg1 = resolveUnitConfiguration(catalog, 'j20_mighty_dragon');
    const cfg2 = resolveUnitConfiguration(catalog, 'j20_mighty_dragon');
    expect(cfg1).toBe(cfg2);

    const clonedCatalog = structuredClone(catalog);
    const c1 = resolveUnitConfiguration(clonedCatalog, 'j20_mighty_dragon');
    clonedCatalog.platforms.j20_mighty_dragon.mounts = [];
    const c2 = resolveUnitConfiguration(clonedCatalog, 'j20_mighty_dragon');
    expect(c2).not.toBe(c1);

    const missionPoly: [number, number][] = [[120, 23], [122, 23], [122, 25], [120, 25]];
    const preCompiled = getCompiledPolygon(missionPoly);
    const derived = deriveMissionAssignments(
      [
        {
          id: 'm1',
          name: 'CAP',
          description: 'CAP',
          side: 'RED',
          type: 'aaw_patrol',
          areaPolygon: missionPoly,
          prosecuteOutsideAreaKm: 40,
          isActive: true,
        },
      ],
      {}
    );
    expect(derived[0].areaPolygon).toBe(missionPoly);
    expect(getCompiledPolygon(derived[0].areaPolygon)).toBe(preCompiled);
  });

  test('worker client deduplicates catalog transfers, validates epoch, and recovers after worker crashes', async () => {
    const unit = createRuntimeUnitFromPlacement(
      {
        id: 'w_unit_2',
        name: 'W',
        callsign: 'W2',
        side: 'RED',
        platformId: 'j20_mighty_dragon',
        parentGroupId: 'red_air_cmd',
        position: [122, 25],
        heading: 90,
        speedKts: 500,
      },
      catalog
    );
    const world: SimulationWorldState = {
      startTime: 0,
      simTime: 0,
      tick: 0,
      rngState: 99,
      units: { w_unit_2: unit },
      contacts: {},
      weaponsInFlight: {},
      explosions: [],
      missions: [],
      score: emptyScore(),
    };
    const pauses = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };

    // Protocol edge cases: SYNC_CATALOG, missing catalog, unsupported request
    const workerCache = new Map();
    const syncRes = handleSimulationWorkerRequest(
      { type: 'SYNC_CATALOG', requestId: 1, epoch: 1, catalogKey: 'cat#1', catalog },
      workerCache
    );
    expect(syncRes.type).toBe('CATALOG_SYNCED');
    const missingCatRes = handleSimulationWorkerRequest(
      { type: 'ADVANCE_BATCH', requestId: 2, epoch: 1, world, catalogKey: 'missing', seconds: 1, autoPause: pauses, playerSide: 'RED' },
      workerCache
    );
    expect(missingCatRes.type).toBe('ERROR');
    const badReqRes = handleSimulationWorkerRequest(
      { type: 'UNKNOWN' } as unknown as SimulationWorkerRequest,
      workerCache
    );
    expect(badReqRes.type).toBe('ERROR');

    // Mock Worker lifecycle: catalog dedup, epoch mismatch rejection, crash recovery
    const postedRequests: WorkerAdvanceBatchRequest[] = [];
    let activeMockWorker: (WorkerLike & { mode: 'normal' | 'stale_epoch' | 'crash_onerror' | 'throw_post' }) | null = null;
    let createdCount = 0;

    const client = new SimulationWorkerClient(() => {
      createdCount += 1;
      const localCache = new Map();
      const mock: WorkerLike & { mode: 'normal' | 'stale_epoch' | 'crash_onerror' | 'throw_post' } = {
        mode: 'normal',
        onmessage: null,
        onerror: null,
        terminate: () => {},
        postMessage: (raw) => {
          const req = raw as WorkerAdvanceBatchRequest;
          postedRequests.push(req);
          if (mock.mode === 'throw_post') {
            throw new Error('Clone error');
          }
          if (mock.mode === 'crash_onerror') {
            queueMicrotask(() => mock.onerror?.({} as ErrorEvent));
            return;
          }
          const response: SimulationWorkerResponse = handleSimulationWorkerRequest(req, localCache);
          if (mock.mode === 'stale_epoch') {
            queueMicrotask(() =>
              mock.onmessage?.({ data: { ...response, epoch: req.epoch - 1 } } as MessageEvent<SimulationWorkerResponse>)
            );
            return;
          }
          queueMicrotask(() => mock.onmessage?.({ data: response } as MessageEvent<SimulationWorkerResponse>));
        },
      };
      activeMockWorker = mock;
      return mock;
    });

    // 1st batch sends catalog; 2nd batch omits catalog and reuses catalogKey
    const r1 = await client.runBatch(world, catalog, 1, pauses, 'RED', 5);
    const r2 = await client.runBatch(r1.nextState, catalog, 1, pauses, 'RED', 5);
    expect(postedRequests[0].catalog).toBeDefined();
    expect(postedRequests[1].catalog).toBeUndefined();
    expect(postedRequests[1].catalogKey).toBe(postedRequests[0].catalogKey);
    expect(r2.nextState.tick!).toBeGreaterThan(r1.nextState.tick!);

    // Mismatched epoch rejects cleanly
    activeMockWorker!.mode = 'stale_epoch';
    await expect(client.runBatch(world, catalog, 1, pauses, 'RED', 6)).rejects.toThrow(/epoch/i);

    // Crash via onerror seamlessly falls back for in-flight batch AND spawns a fresh worker on next batch
    activeMockWorker!.mode = 'crash_onerror';
    const recovered = await client.runBatch(world, catalog, 1, pauses, 'RED', 7);
    expect(recovered.nextState.tick).toBe(4);
    const afterCrash = await client.runBatch(world, catalog, 1, pauses, 'RED', 7);
    expect(afterCrash.nextState.tick).toBe(4);
    expect(createdCount).toBe(2);
    // Fresh worker received full catalog sync again!
    expect(postedRequests[postedRequests.length - 1].catalog).toBeDefined();

    // postMessage throwing falls back cleanly too
    activeMockWorker!.mode = 'throw_post';
    const fallbackPost = await client.runBatch(world, catalog, 1, pauses, 'RED', 8);
    expect(fallbackPost.nextState.tick).toBe(4);
    client.resetRecoveryState();
    client.dispose();
  });

  test('active EW jammers extend standoff escort protection while triggering Home-on-Jam and ARM priority', () => {
    const jammer = createRuntimeUnitFromPlacement(
      {
        id: 'red_y9g',
        name: 'Y-9G',
        callsign: 'Y9G-1',
        side: 'RED',
        platformId: 'y9g_jammer',
        parentGroupId: 'red_air',
        position: [120.0, 25.0],
        altitudeM: 8000,
        heading: 90,
        speedKts: 300,
        doctrine: { roe: 'hold', emconRadar: false, emconJamming: true },
      },
      catalog
    );
    const striker = createRuntimeUnitFromPlacement(
      {
        id: 'red_striker',
        name: 'Striker',
        callsign: 'STRIKE-1',
        side: 'RED',
        platformId: 'j20_mighty_dragon',
        parentGroupId: 'red_air',
        position: [120.9, 25.0], // ~90 km east: covered by 135 km standoff OECM pod!
        altitudeM: 9000,
        heading: 90,
        speedKts: 500,
        doctrine: { roe: 'hold', emconRadar: false, emconJamming: false },
      },
      catalog
    );
    const silentTarget = createRuntimeUnitFromPlacement(
      {
        id: 'red_silent',
        name: 'Silent Radar',
        callsign: 'SILENT-1',
        side: 'RED',
        platformId: 'type052d_destroyer',
        parentGroupId: 'red_sea',
        position: [120.05, 25.0],
        heading: 90,
        speedKts: 0,
        doctrine: { roe: 'hold', emconRadar: false, emconJamming: false },
      },
      catalog
    );

    const jamCap = resolveUnitJammingCapability(jammer, catalog);
    expect(jamCap.strength).toBeGreaterThanOrEqual(0.6);
    expect(jamCap.effectiveRadiusKm).toBeGreaterThan(100);
    const escortSuppression = evaluateTargetEcmSuppression(striker, [jammer, striker], catalog);
    expect(escortSuppression).toBeGreaterThan(0.2);

    // Stealth fighter j20 has tiny radar seeker range (~5.5km) normally, but HOJ against strong jammer gives 60% seeker floor (~10.8km)
    const aam = catalog.weapons.aim120d_aam;
    const missileAt10Km: WeaponInFlight = {
      id: 'msl_hoj',
      weaponId: aam.id,
      name: aam.codeName,
      side: 'BLUE',
      shooterId: 'blue_f35',
      shooterName: 'F-35',
      targetId: jammer.id,
      targetType: 'unit',
      position: [120.09, 25.0], // ~9 km from jammer
      launchPosition: [121.0, 25.0],
      trail: [[120.09, 25.0]],
      altitudeM: 8000,
      heading: 270,
      speedKts: 2200,
      distanceRemainingKm: 9,
      maxRangeKm: aam.maxRangeKm,
      traveledKm: 80,
      basePk: aam.basePk,
      warheadDamage: aam.warheadDamage,
      seekerState: 'terminal_searching',
    };
    const lockedHoj = seekerCanObserve(missileAt10Km, aam, jammer, catalog, false, undefined, [jammer, striker]);
    expect(lockedHoj).toBe(true);
    // Turn off jamming on a low-RCS stealth fighter -> seeker cannot lock at 10km without HOJ
    striker.doctrine.emconJamming = false;
    const missileOnStealth: WeaponInFlight = {
      ...missileAt10Km,
      position: [120.99, 25.0], // ~9 km from striker
      targetId: striker.id,
    };
    expect(seekerCanObserve(missileOnStealth, aam, striker, catalog, false, undefined, [striker])).toBe(false);

    // Area ARM prioritizes active jammer over closer radar-off ship (or non-jammer)
    const arm = catalog.weapons.ld10_arm;
    const armMissile: WeaponInFlight = {
      id: 'msl_arm_area',
      weaponId: arm.id,
      name: arm.codeName,
      side: 'BLUE',
      shooterId: 'blue_f35',
      shooterName: 'F-35',
      targetId: 'area_target',
      targetType: 'area',
      position: [120.1, 25.0],
      launchPosition: [121.0, 25.0],
      aimPosition: [120.0, 25.0],
      trail: [[120.1, 25.0]],
      altitudeM: 9000,
      heading: 270,
      speedKts: 2200,
      distanceRemainingKm: 10,
      maxRangeKm: arm.maxRangeKm,
      traveledKm: 60,
      basePk: arm.basePk,
      warheadDamage: arm.warheadDamage,
      seekerState: 'terminal_searching',
    };
    silentTarget.doctrine.emconRadar = true; // closer (~5 km) radar emitter, not jamming
    advanceWeaponPhysics({
      units: { [jammer.id]: jammer, [silentTarget.id]: silentTarget },
      contacts: {},
      weaponsInFlight: { [armMissile.id]: armMissile },
      previousExplosions: [],
      catalog,
      nextSimTime: 1000,
      dtSec: 0.25,
      score: emptyScore(),
      creditedDamage: {},
      rng: () => 0.99,
      logs: [],
      autoPauseSettings: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false },
      triggerPause: () => undefined,
    });
    expect(armMissile.targetId).toBe(jammer.id);
  });

  test('thermocline attenuates hull sonar more than variable-depth sonar and speed scales cavitation noise nonlinearly', async () => {
    const { calculateSonarDetectionRangeKm } = await import('../../../src/engine/sensors');
    const hullSonar = {
      id: 'hull_sonar_test',
      name: '舰壳声呐',
      codeName: 'Hull Sonar',
      type: 'sonar_passive' as const,
      maxRangeKm: 30,
      detectDomains: ['subsurface' as const],
      isActiveEmitter: false,
      lookDownCapable: true,
      frequencyBand: 'LF Passive',
      description: 'Test hull sonar',
    };
    const towedSonar = {
      id: 'towed_array_sonar_test',
      name: '拖曳阵列声呐',
      codeName: 'Towed Array Sonar',
      type: 'sonar_passive' as const,
      maxRangeKm: 30,
      detectDomains: ['subsurface' as const],
      isActiveEmitter: false,
      lookDownCapable: true,
      frequencyBand: 'VLF Passive',
      description: 'Test towed sonar',
    };

    const hullSameLayer = calculateSonarDetectionRangeKm(hullSonar, -20, -40, 95, 8, false);
    const hullCrossLayer = calculateSonarDetectionRangeKm(hullSonar, -20, -180, 95, 8, false);
    const towedSameLayer = calculateSonarDetectionRangeKm(towedSonar, 0, 0, 95, 8, false);
    const towedCrossLayer = calculateSonarDetectionRangeKm(towedSonar, 0, -180, 95, 8, false);

    expect(towedSameLayer).toBeCloseTo(hullSameLayer, 5);
    expect(hullCrossLayer).toBeLessThan(hullSameLayer * 0.55);
    expect(towedCrossLayer).toBeGreaterThan(hullCrossLayer);
    expect(towedCrossLayer).toBeLessThan(hullSameLayer);

    const quietCrawl = calculateSonarDetectionRangeKm(hullSonar, -20, -40, 95, 8, false);
    const moderateSpeed = calculateSonarDetectionRangeKm(hullSonar, -20, -40, 95, 16, false);
    const highSpeed = calculateSonarDetectionRangeKm(hullSonar, -20, -40, 95, 24, false);
    expect(highSpeed - moderateSpeed).toBeGreaterThan(moderateSpeed - quietCrawl);
  });

  test('summarizeAarBreakdowns computes side force survival and top weapon expenditure splits', async () => {
    const { summarizeAarBreakdowns } = await import('../../../src/engine/aar');
    const redAlive = createRuntimeUnitFromPlacement(
      { id: 'r1', name: 'R1', callsign: 'R1', side: 'RED', platformId: 'j20_mighty_dragon', parentGroupId: 'g1', position: [120, 25], heading: 90 },
      catalog
    );
    const redDead = createRuntimeUnitFromPlacement(
      { id: 'r2', name: 'R2', callsign: 'R2', side: 'RED', platformId: 'j20_mighty_dragon', parentGroupId: 'g1', position: [120.1, 25], heading: 90 },
      catalog
    );
    redDead.hp = 0;
    redDead.status = 'destroyed';
    const blueDead = createRuntimeUnitFromPlacement(
      { id: 'b1', name: 'B1', callsign: 'B1', side: 'BLUE', platformId: 'f35c_lightning', parentGroupId: 'g2', position: [121, 25], heading: 270 },
      catalog
    );
    blueDead.hp = 0;
    blueDead.status = 'destroyed';

    const result = summarizeAarBreakdowns(
      {
        events: [
          { id: 'e1', tick: 4, simTime: 1000, side: 'RED', kind: 'launch', title: 'PL-15', weaponId: 'pl15_aam', quantity: 4 },
          { id: 'e2', tick: 6, simTime: 1500, side: 'BLUE', kind: 'launch', title: 'AIM-120D', weaponId: 'aim120d_aam', quantity: 2 },
          { id: 'e3', tick: 8, simTime: 2000, side: 'RED', kind: 'launch', title: 'YJ-18', weaponId: 'yj18_ashm', quantity: 1 },
          { id: 'e4', tick: 9, simTime: 2250, side: 'RED', kind: 'hit', title: 'Hit', weaponId: 'pl15_aam', quantity: 1 },
        ],
        tracks: [],
      },
      { r1: redAlive, r2: redDead, b1: blueDead }
    );

    expect(result.forceSurvival.RED).toEqual({ active: 1, destroyed: 1, total: 2, survivalRate: 0.5, attritionRate: 0.5 });
    expect(result.forceSurvival.BLUE).toEqual({ active: 0, destroyed: 1, total: 1, survivalRate: 0, attritionRate: 1 });
    expect(result.ammunition.redTotal).toBe(5);
    expect(result.ammunition.blueTotal).toBe(2);
    expect(result.ammunition.total).toBe(7);
    expect(result.ammunition.topWeapons).toEqual([
      { weaponId: 'pl15_aam', redCount: 4, blueCount: 0, totalCount: 4 },
      { weaponId: 'aim120d_aam', redCount: 0, blueCount: 2, totalCount: 2 },
      { weaponId: 'yj18_ashm', redCount: 1, blueCount: 0, totalCount: 1 },
    ]);
  });

  test('weapon guidance and air-drop torpedoes advance and cap altitudeTrail in lockstep with trail', () => {
    const shooter = createRuntimeUnitFromPlacement(
      { id: 's1', name: 'S1', callsign: 'S1', side: 'RED', platformId: 'j20_mighty_dragon', parentGroupId: 'g1', position: [122.0, 25.0], heading: 90, altitudeM: 11000 },
      catalog
    );
    const target = createRuntimeUnitFromPlacement(
      { id: 't1', name: 'T1', callsign: 'T1', side: 'BLUE', platformId: 'e2d_hawkeye', parentGroupId: 'g2', position: [123.2, 25.0], heading: 270, altitudeM: 8500 },
      catalog
    );
    const weapon = catalog.weapons.pl15_aam;
    const missile: WeaponInFlight = {
      id: 'm_loft_1',
      weaponId: weapon.id,
      name: weapon.codeName,
      side: 'RED',
      shooterId: shooter.id,
      shooterName: shooter.callsign,
      targetId: target.id,
      targetType: 'unit',
      position: [122.0, 25.0],
      launchPosition: [122.0, 25.0],
      trail: [[122.0, 25.0]],
      altitudeTrail: [11000],
      altitudeM: 11000,
      heading: 90,
      speedKts: weapon.speedKts,
      distanceRemainingKm: 120,
      maxRangeKm: weapon.maxRangeKm,
      traveledKm: 0,
      basePk: weapon.basePk,
      warheadDamage: weapon.warheadDamage,
      aimPosition: [...target.position],
      aimHeading: target.heading,
      aimSpeedKts: target.speedKts,
      aimAltitudeM: target.altitudeM,
      targetDomain: 'air',
      seekerState: 'midcourse_datalink',
    };

    const world: SimulationWorldState = {
      simTime: 0,
      units: { [shooter.id]: shooter, [target.id]: target },
      contacts: {},
      weaponsInFlight: { [missile.id]: missile },
      explosions: [],
      missions: [],
      score: emptyScore(),
    };

    const stepped = advanceSimulation(
      world,
      catalog,
      6.0, // 24 ticks -> exceeds 18-point trail cap
      { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false },
      'GOD'
    );
    const updated = stepped.nextState.weaponsInFlight[missile.id];
    expect(updated).toBeDefined();
    expect(updated.trail.length).toBe(18);
    expect(updated.altitudeTrail).toBeDefined();
    expect(updated.altitudeTrail?.length).toBe(updated.trail.length);
    expect(updated.altitudeTrail?.[updated.altitudeTrail.length - 1]).toBe(updated.altitudeM);
  });

  test('recordAarTick preserves spatial position and altitudeM on combat events', () => {
    const unit = createRuntimeUnitFromPlacement(
      { id: 'u1', name: 'U1', callsign: 'U1', side: 'BLUE', platformId: 'f35c_lightning', parentGroupId: 'g1', position: [124.5, 25.5], heading: 0 },
      catalog
    );
    const ledger = createAarLedger();
    recordAarTick(
      ledger,
      12,
      3000,
      { [unit.id]: unit },
      [
        {
          id: 'log_int_1',
          simTime: 3000,
          side: 'BLUE',
          category: 'INTERCEPT',
          severity: 'info',
          title: 'SM-6 intercept',
          message: 'Splash one',
          position: [124.8, 25.7],
          altitudeM: 14200,
          unitId: unit.id,
          weaponId: 'sm6_dual2',
          quantity: 1,
        },
      ],
      true
    );
    expect(ledger.events).toHaveLength(1);
    expect(ledger.events[0].position).toEqual([124.8, 25.7]);
    expect(ledger.events[0].altitudeM).toBe(14200);
  });
});

