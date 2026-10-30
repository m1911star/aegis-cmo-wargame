import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../../src/db';
import { evaluateBattleAssessment } from '../../../src/engine/simulation/battleAssessment';
import { createRuntimeUnitFromPlacement } from '../../../src/engine/simulation/unitFactory';
import { advanceSimulation, type SimulationWorldState } from '../../../src/engine/simulationEngine';
import type { InitialUnitPlacement, ScoreLedger } from '../../../src/types/wargame';

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
});
