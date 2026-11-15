import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../../src/db';
import { resolveUnitConfiguration } from '../../../src/db/unitConfiguration';
import { getCompiledPolygon, hasRadarLineOfSight, pointInBbox, segmentOverlapsBbox } from '../../../src/engine/environment';
import { computeMissileEnergyFactor } from '../../../src/engine/guidance';
import { deriveMissionAssignments } from '../../../src/engine/missions';
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
});
