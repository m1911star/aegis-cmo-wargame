import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../src/db';
import { deployCarriedUnitFromLauncher } from '../../src/engine/carrierOperations';
import { evaluateFireControl } from '../../src/engine/fireControl';
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

describe('Module 2: Deployable DIFAR/DICASS sonobuoys & networked airborne ASW', () => {
  test('MPA blocks sonobuoy drop over land, drops DIFAR/DICASS in water, shares datalink track for Mk-54, and expires without loss penalty', () => {
    const landEnv = {
      landPolygons: [
        {
          id: 'island',
          name: 'Island',
          areaPolygon: [[0.9, -0.2], [1.2, -0.2], [1.2, 0.2], [0.9, 0.2]] as [number, number][],
        },
      ],
      acousticZones: [],
    };
    const p8OverLand = createRuntimeUnitFromPlacement(
      placement('p8_land', {
        side: 'BLUE',
        platformId: 'p8a_poseidon',
        position: [1.0, 0],
        altitudeM: 1800,
      }),
      catalog
    );
    expect(
      deployCarriedUnitFromLauncher(
        { p8_land: p8OverLand },
        p8OverLand,
        'ssq53_difar_buoy',
        catalog,
        landEnv,
        0,
        't0',
        1
      ).deployed
    ).toBeUndefined();

    // Move P-8A out to sea (distant from sub, drops DICASS active buoy right above quiet AIP SSK)
    const p8Sea = createRuntimeUnitFromPlacement(
      placement('p8_sea', {
        side: 'BLUE',
        platformId: 'p8a_poseidon',
        position: [0, 0],
        altitudeM: 2200,
        doctrine: { roe: 'free', emconRadar: false },
      }),
      catalog
    );
    const quietSub = createRuntimeUnitFromPlacement(
      placement('red_quiet_ssk', {
        side: 'RED',
        platformId: 'type039c_ssk',
        position: [0.16, 0], // ~17.8 km East
        altitudeM: -70,
        heading: 270, // Approaching Westward so buoy at [0.14, 0] is on bow, not in stern baffles
        speedKts: 3,
      }),
      catalog
    );

    const dropDifar = deployCarriedUnitFromLauncher(
      { p8_sea: p8Sea, red_quiet_ssk: quietSub },
      p8Sea,
      'ssq53_difar_buoy',
      catalog,
      landEnv,
      1000,
      'difar_1',
      1,
      [0.12, 0]
    );
    const dropDicass = deployCarriedUnitFromLauncher(
      { p8_sea: p8Sea, red_quiet_ssk: quietSub },
      p8Sea,
      'ssq62_dicass_buoy',
      catalog,
      landEnv,
      1000,
      'dicass_1',
      2,
      [0.14, 0]
    );
    expect(dropDifar.deployed).toBeDefined();
    expect(dropDicass.deployed).toBeDefined();
    expect(dropDifar.deployed!.doctrine.emconSonar).toBe(false);
    expect(dropDicass.deployed!.doctrine.emconSonar).toBe(true);

    const units = {
      p8_sea: p8Sea,
      red_quiet_ssk: quietSub,
      [dropDifar.deployed!.id]: dropDifar.deployed!,
      [dropDicass.deployed!.id]: dropDicass.deployed!,
    };
    const sensed = computeContactsOnly(units, catalog, {}, 2000, 1, landEnv).contacts;

    // 1. BLUE receives identified submarine contact via sonobuoy datalink, enabling P-8A Mk-54 drop
    const subTrack = sensed.BLUE_CONTACT_red_quiet_ssk;
    expect(subTrack).toBeDefined();
    expect(subTrack.classification).toBe('identified');
    const mk54Mount = p8Sea.mounts.find((m) => m.weaponId === 'mk54_lwt')!;
    expect(
      evaluateFireControl(p8Sea, subTrack, mk54Mount, catalog.weapons.mk54_lwt, catalog, units, 2000, 'manual').status
    ).toBe('executable');

    // 2. RED submarine does NOT hear silent passive DIFAR buoy, and hears active DICASS buoy only as low-threat non-targetable sonobuoy
    expect(sensed[`RED_CONTACT_${dropDifar.deployed!.id}`]).toBeUndefined();
    const dicassTrack = sensed[`RED_CONTACT_${dropDicass.deployed!.id}`];
    expect(dicassTrack).toBeDefined();
    expect(dicassTrack.identifiedCategory).toBe('sonobuoy');
    expect(dicassTrack.threatLevel).toBe('low');
    const yu6Mount = quietSub.mounts.find((m) => m.weaponId === 'yu6_torpedo')!;
    expect(
      evaluateFireControl(quietSub, dicassTrack, yu6Mount, catalog.weapons.yu6_torpedo, catalog, units, 2000, 'automatic').status
    ).toBe('blocked');

    // 3. Battery depletion scuttles sonobuoy cleanly with zero loss penalty
    const score = emptyScore();
    const logs: CombatLogEntry[] = [];
    dropDicass.deployed!.fuelRemainingSec = 0.5;
    updateUnitOperations(dropDicass.deployed!, units, {}, [], catalog, 3000, 1, score, logs);
    expect(dropDicass.deployed!.status).toBe('destroyed');
    expect(score.blueLosses).toBe(0);
  });
});
