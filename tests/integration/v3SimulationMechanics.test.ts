import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../src/db';
import { updateUnitOperations } from '../../src/engine/operations';
import { computeContactsOnly, isTargetWithinSensorArc } from '../../src/engine/sensors';
import { createRuntimeUnitFromPlacement } from '../../src/engine/simulationEngine';
import { buildSensorEnvelopeFeature } from '../../src/map/tacticalProjection';
import type { CombatLogEntry, InitialUnitPlacement, ScoreLedger } from '../../src/types/wargame';

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

describe('Module 1: Sensor azimuth arcs, sonar rear baffles & submarine baffle-clearing', () => {
  test('fighter forward AESA cone detects nose/Crank targets (±70°) and loses radar lock behind gimbal limits', () => {
    const j20RadarOnly = structuredClone(catalog);
    j20RadarOnly.platforms.j20_mighty_dragon.sensorIds = ['klj5_aesa'];

    const observer = createRuntimeUnitFromPlacement(
      placement('j20_obs', {
        platformId: 'j20_mighty_dragon',
        position: [0, 0],
        altitudeM: 9000,
        heading: 90, // Facing due East
        doctrine: { roe: 'hold', emconRadar: true },
      }),
      j20RadarOnly
    );
    const targetAhead = createRuntimeUnitFromPlacement(
      placement('tgt_ahead', {
        side: 'BLUE',
        platformId: 'fa18ef_super_hornet',
        position: [0.4, 0.25], // ~58° bearing -> ~32° off-nose (within ±70° Crank cone)
        altitudeM: 9000,
      }),
      j20RadarOnly
    );
    const targetAftQuarter = createRuntimeUnitFromPlacement(
      placement('tgt_aft', {
        side: 'BLUE',
        platformId: 'fa18ef_super_hornet',
        position: [-0.3, 0.25], // ~310° bearing -> ~140° off-nose (outside ±70° gimbal limit)
        altitudeM: 9000,
      }),
      j20RadarOnly
    );

    const contacts = computeContactsOnly(
      { j20_obs: observer, tgt_ahead: targetAhead, tgt_aft: targetAftQuarter },
      j20RadarOnly,
      {},
      1000,
      1
    ).contacts;
    expect(contacts.RED_CONTACT_tgt_ahead).toBeDefined();
    expect(contacts.RED_CONTACT_tgt_aft).toBeUndefined();

    // Sector polygon starts and closes at observer center rather than drawing a 360° circle
    const sector = buildSensorEnvelopeFeature([0, 0], 280, 90, 140, 0, 48, { ringKind: 'radar' });
    const ring = (sector.geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring[0]).toEqual([0, 0]);
    expect(ring.at(-1)).toEqual([0, 0]);
  });

  test('submarine rear propulsion baffles mask astern stalker until periodic baffle-clearing maneuver turns the boat', () => {
    const sub = createRuntimeUnitFromPlacement(
      placement('red_ssk', {
        platformId: 'type039c_ssk',
        position: [0, 0],
        altitudeM: -60,
        heading: 90, // Facing East; stern baffles are 240°..300° (±30° around 270°)
        speedKts: 5,
        doctrine: { roe: 'hold', emconSonar: false, baffleClearPeriodic: true },
      }),
      catalog
    );
    const stalkerAstern = createRuntimeUnitFromPlacement(
      placement('blue_stalker', {
        side: 'BLUE',
        platformId: 'virginia_ssn',
        position: [-0.15, 0], // Bearing 270° -> dead astern inside ±30° baffles!
        altitudeM: -60,
        speedKts: 12,
      }),
      catalog
    );

    expect(isTargetWithinSensorArc(90, [0, 0], [-0.15, 0], catalog.sensors.red_aip_flank_array)).toBe(false);
    expect(
      computeContactsOnly({ red_ssk: sub, blue_stalker: stalkerAstern }, catalog, {}, 1000, 1).contacts
        .RED_CONTACT_blue_stalker
    ).toBeUndefined();

    // Initialize baffleClearState timer at t=1000 -> next S-turn scheduled at 181_000 ms
    const logs: CombatLogEntry[] = [];
    updateUnitOperations(sub, { red_ssk: sub }, {}, [], catalog, 1000, 1, emptyScore(), logs);
    expect(sub.heading).toBe(90);

    // At t=182_000 ms, periodic baffle-clearing turns boat by 38°, unmasking the astern stalker!
    updateUnitOperations(sub, { red_ssk: sub }, {}, [], catalog, 182_000, 1, emptyScore(), logs);
    expect(Math.abs(sub.heading - 90)).toBeGreaterThanOrEqual(35);
    expect(
      computeContactsOnly({ red_ssk: sub, blue_stalker: stalkerAstern }, catalog, {}, 182_000, 1).contacts
        .RED_CONTACT_blue_stalker
    ).toBeDefined();

    // After 20s window (t=203_000 ms), submarine automatically restores original base heading 90°
    updateUnitOperations(sub, { red_ssk: sub }, {}, [], catalog, 203_000, 1, emptyScore(), logs);
    expect(sub.heading).toBe(90);
  });
});
