import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../src/db';
import { deployCarriedUnitFromLauncher, evaluateCarrierSortieAvailability, launchCarrierSortie } from '../../src/engine/carrierOperations';
import { evaluateWeatherModifiers } from '../../src/engine/environment';
import { countActiveGuidanceChannels, evaluateFireControl, resolveMaxGuidanceChannels } from '../../src/engine/fireControl';
import { computeFlightProfileAltitudeM, launchGuidance, seekerCanObserve } from '../../src/engine/guidance';
import { updateUnitOperations } from '../../src/engine/operations';
import { computeContactsOnly, isTargetWithinSensorArc } from '../../src/engine/sensors';
import { runAutoDefense } from '../../src/engine/simulation/autoDefense';
import { applySubsystemHitDamage, advanceWeaponPhysics } from '../../src/engine/simulation/weaponPhysics';
import { advanceSimulation, createRuntimeUnitFromPlacement } from '../../src/engine/simulationEngine';
import { getUnitCapabilities } from '../../src/engine/unitCapabilities';
import { buildSensorEnvelopeFeature } from '../../src/map/tacticalProjection';
import { SCENARIO_EAST_SEA_THUNDER } from '../../src/scenarios/builtinScenarios';
import { captureBattleRecording, canonicalBattleState, replayBattleRecording } from '../../src/store/battleRecording';
import { useWargameStore as store } from '../../src/store/useWargameStore';
import type { CombatLogEntry, InitialUnitPlacement, ScenarioDefinition, ScoreLedger, TacticalContact, WeaponInFlight } from '../../src/types/wargame';

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

describe('Module 3: Platform guidance channel saturation & 3-tier HGV/ballistic altitude envelopes', () => {
  test('saturating frigate radar guidance channels blocks ESSM midcourse launches while freeing autonomous IR RAM point defense', () => {
    const ffg = createRuntimeUnitFromPlacement(
      placement('blue_ffg', {
        side: 'BLUE',
        platformId: 'constellation_ffg',
        position: [0, 0],
        doctrine: { roe: 'free', emconRadar: true, salvoSize: 2, minimumWeaponReserve: 0 },
      }),
      catalog
    );
    const maxCh = resolveMaxGuidanceChannels(catalog.platforms.constellation_ffg);
    expect(maxCh).toBe(8);

    const weaponsInFlight: Record<string, WeaponInFlight> = {};
    // Pre-fill all 8 radar guidance channels with midcourse ESSM interceptors
    for (let i = 0; i < maxCh; i++) {
      weaponsInFlight[`essm_busy_${i}`] = {
        id: `essm_busy_${i}`,
        weaponId: 'essm_blk2',
        name: 'ESSM Block 2',
        side: 'BLUE',
        shooterId: ffg.id,
        shooterName: ffg.callsign,
        targetId: `decoy_${i}`,
        targetType: 'unit',
        position: [0.05, 0],
        launchPosition: [0, 0],
        trail: [],
        altitudeM: 5000,
        heading: 90,
        speedKts: 2500,
        distanceRemainingKm: 20,
        maxRangeKm: 50,
        traveledKm: 5,
        basePk: 0.74,
        warheadDamage: 42,
        seekerState: 'midcourse_datalink',
      };
    }
    expect(countActiveGuidanceChannels(ffg.id, weaponsInFlight, catalog)).toBe(8);

    // Incoming sea-skimming missile at 10km (within both ESSM 50km and RAM 15km range!)
    weaponsInFlight.incoming_leaker = {
      id: 'incoming_leaker',
      weaponId: 'yj18_ashm',
      name: 'YJ-18',
      side: 'RED',
      shooterId: 'red_055',
      shooterName: 'RED-055',
      targetId: ffg.id,
      targetType: 'unit',
      position: [0.09, 0], // ~10 km
      launchPosition: [0.5, 0],
      trail: [],
      altitudeM: 12,
      heading: 270,
      speedKts: 1850,
      distanceRemainingKm: 10,
      maxRangeKm: 540,
      traveledKm: 40,
      basePk: 0.74,
      warheadDamage: 65,
      seekerState: 'terminal_locked',
    };

    const pausesOff = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };
    runAutoDefense({
      units: { blue_ffg: ffg },
      missions: [],
      contacts: {},
      weaponsInFlight,
      catalog,
      nextSimTime: 1000,
      score: emptyScore(),
      logs: [],
      autoPauseSettings: pausesOff,
      triggerPause: () => undefined,
    });

    // ESSM is channel-saturated (0 launched), while fire-and-forget IR RAM Block 2 still launches 2 rounds!
    const launchedInterceptors = Object.values(weaponsInFlight).filter((m) => m.targetId === 'incoming_leaker');
    expect(launchedInterceptors).toHaveLength(2);
    expect(launchedInterceptors.every((m) => m.weaponId === 'ram_blk2')).toBe(true);

    // Once one ESSM goes Pitbull (terminal_locked), a channel frees up immediately!
    weaponsInFlight.essm_busy_0.seekerState = 'terminal_locked';
    expect(countActiveGuidanceChannels(ffg.id, weaponsInFlight, catalog)).toBe(7);
  });

  test('hypersonic glide & ballistic loft follow boost-glide-dive altitude curves and enforce 3-tier SAM altitude bands', () => {
    const yj21 = catalog.weapons.yj21_hypersonic;
    const baseHvg = { traveledKm: 0, distanceRemainingKm: 500 } as WeaponInFlight;
    // Boost climb -> 38km near-space glide -> terminal steep dive
    const midGlideAlt = computeFlightProfileAltitudeM({ ...baseHvg, traveledKm: 200, distanceRemainingKm: 300 }, yj21, 0)!;
    const lateDiveAlt = computeFlightProfileAltitudeM({ ...baseHvg, traveledKm: 480, distanceRemainingKm: 20 }, yj21, 0)!;
    expect(midGlideAlt).toBeGreaterThan(35500);
    expect(lateDiveAlt).toBeLessThan(8000);

    // At 37,000m near-space glide: Tier-1 BMD (SM-6 Dual II max 40km) CAN engage, while Tier-2 ESSM (17.5km) and Tier-3 RAM (8.5km) CANNOT!
    const ddg = createRuntimeUnitFromPlacement(
      placement('ddg', { side: 'BLUE', platformId: 'arleigh_burke_flt3', position: [0, 0], doctrine: { roe: 'free', emconRadar: true } }),
      catalog
    );
    const ffg = createRuntimeUnitFromPlacement(
      placement('ffg', { side: 'BLUE', platformId: 'constellation_ffg', position: [0, 0], doctrine: { roe: 'free', emconRadar: true } }),
      catalog
    );
    const highGlideTrack: TacticalContact = {
      id: 'BLUE_MISSILE_hvg',
      actualUnitId: 'hvg_1',
      observerSide: 'BLUE',
      targetSide: 'RED',
      domain: 'air',
      classification: 'classified',
      displayName: 'HGV',
      sidc: ddg.sidc,
      estimatedPosition: [0.25, 0],
      truePosition: [0.25, 0],
      uncertaintyRadiusKm: 0.3,
      heading: 270,
      speedKts: 4600,
      altitudeM: 37000,
      firstDetectedTime: 0,
      lastDetectedTime: 0,
      detectedBySources: ['ddg', 'ffg'],
      sourceUnitIds: ['ddg', 'ffg'],
      fireControlSourceIds: ['ddg', 'ffg'],
      threatLevel: 'critical',
    };
    const sm6Mount = ddg.mounts.find((m) => m.weaponId === 'sm6_eram')!;
    const essmMount = ffg.mounts.find((m) => m.weaponId === 'essm_blk2')!;
    expect(evaluateFireControl(ddg, highGlideTrack, sm6Mount, catalog.weapons.sm6_eram, catalog, { ddg, ffg }, 0, 'defense').status).toBe('executable');
    expect(evaluateFireControl(ffg, highGlideTrack, essmMount, catalog.weapons.essm_blk2, catalog, { ddg, ffg }, 0, 'defense').status).toBe('blocked');

    // Above 40,000m exo-atmospheric apex, even Endo-BMD SM-6 is blocked; in terminal dive (< 8,000m), ESSM and RAM both unlock!
    highGlideTrack.altitudeM = 42000;
    expect(evaluateFireControl(ddg, highGlideTrack, sm6Mount, catalog.weapons.sm6_eram, catalog, { ddg, ffg }, 0, 'defense').status).toBe('blocked');
    highGlideTrack.altitudeM = 6000;
    expect(evaluateFireControl(ffg, highGlideTrack, essmMount, catalog.weapons.essm_blk2, catalog, { ddg, ffg }, 0, 'defense').status).toBe('executable');
  });
});

describe('Module 4: Missile dogleg waypoints & multi-unit synchronized TOT strikes', () => {
  test('dogleg waypoints route sea-skimming missiles around high island ridges and enforce total polyline range', () => {
    const islandEnv = {
      landPolygons: [
        {
          id: 'high_island',
          name: 'High Island',
          elevationM: 900,
          areaPolygon: [[0.18, -0.15], [0.32, -0.15], [0.32, 0.15], [0.18, 0.15]] as [number, number][],
        },
      ],
      acousticZones: [],
    };
    const scenario: ScenarioDefinition = {
      ...structuredClone(SCENARIO_EAST_SEA_THUNDER),
      units: [
        placement('red_ship', {
          platformId: 'type052d_destroyer',
          position: [0, 0],
          doctrine: { roe: 'hold', emconRadar: false },
        }),
        placement('red_awacs', {
          platformId: 'kj500_awacs',
          parentGroupId: 'red_air_cmd',
          position: [0.25, 0.3],
          altitudeM: 9200,
          doctrine: { roe: 'hold', emconRadar: true },
        }),
        placement('blue_ship', {
          side: 'BLUE',
          platformId: 'constellation_ffg',
          parentGroupId: 'blue_desron15',
          position: [0.5, 0],
          doctrine: { roe: 'hold', emconRadar: false },
        }),
      ],
      missions: [],
      events: [],
      objectives: [],
      referencePoints: [],
      environment: islandEnv,
      victoryConditions: undefined,
    };

    store.getState().loadScenario(scenario, false, 404);
    const pausesOff = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };
    store.setState({ autoPause: pausesOff });
    // Ensure AWACS high-altitude contact is established
    store.getState().stepSingleTick(1);
    const contactId = 'RED_CONTACT_blue_ship';
    expect(store.getState().contacts[contactId]).toBeDefined();

    // Out-of-range dogleg detour (>540km) is rejected at fire-control boundary
    const yj18Mount = store.getState().units.red_ship.mounts.find((m) => m.weaponId === 'yj18_ashm')!;
    expect(
      evaluateFireControl(
        store.getState().units.red_ship,
        store.getState().contacts[contactId],
        yj18Mount,
        catalog.weapons.yj18_ashm,
        catalog,
        store.getState().units,
        store.getState().simTime,
        'manual',
        {},
        [[4.0, 4.0]]
      ).status
    ).toBe('blocked');

    // 1) Direct straight-line launch crashes into the 900m island ridge!
    store.getState().executeManualEngage('red_ship', contactId, 'yj18_ashm', 1, true);
    store.getState().stepSingleTick(60);
    expect(store.getState().logs.some((l) => l.title.includes('撞击高地山脊坠毁'))).toBe(true);

    // 2) Dogleg launch via northern sea channel [0.25, 0.22] bypasses island and reaches terminal phase!
    store.getState().loadScenario(scenario, false, 404);
    store.setState({ autoPause: pausesOff });
    store.getState().stepSingleTick(1);
    store.getState().executeManualEngage('red_ship', contactId, 'yj18_ashm', 1, true, [[0.25, 0.22]]);
    const launched = Object.values(store.getState().weaponsInFlight)[0];
    expect(launched.waypoints).toEqual([[0.25, 0.22]]);

    store.getState().stepSingleTick(45);
    // At 45s (~42 km traveled), missile has cleanly rounded the northern dogleg [0.25, 0.22] without hitting the island!
    expect(store.getState().logs.some((l) => l.title.includes('撞击高地山脊坠毁'))).toBe(false);
    const midAfterTurn = Object.values(store.getState().weaponsInFlight)[0];
    expect(midAfterTurn).toBeDefined();
    expect(midAfterTurn.waypoints).toBeUndefined();

    // Advance another 50s -> reaches target and resolves terminal engagement!
    store.getState().stepSingleTick(50);
    expect(store.getState().logs.some((l) => l.title.includes('撞击高地山脊坠毁'))).toBe(false);
    expect(store.getState().logs.some((l) => l.title.includes('末段攻击结束'))).toBe(true);
  });

  test('scheduleTotStrike staggers subsonic and supersonic launches for simultaneous arrival and replays across batches', () => {
    const scenario: ScenarioDefinition = {
      ...structuredClone(SCENARIO_EAST_SEA_THUNDER),
      units: [
        placement('slow_lhd', {
          platformId: 'type075_lhd', // YJ-83K subsonic (560 kts)
          position: [0, 0],
          doctrine: { roe: 'hold', emconRadar: true, salvoSize: 1 },
        }),
        placement('fast_ddg', {
          platformId: 'type052d_destroyer', // YJ-18 supersonic (1850 kts)
          position: [0, 0.05],
          doctrine: { roe: 'hold', emconRadar: true, salvoSize: 1 },
        }),
        placement('enemy_target', {
          side: 'BLUE',
          platformId: 'arleigh_burke_flt3',
          parentGroupId: 'blue_desron15',
          position: [0.6, 0], // ~66 km away
          doctrine: { roe: 'hold', emconRadar: false },
        }),
      ],
      missions: [],
      events: [],
      objectives: [],
      referencePoints: [],
      environment: undefined,
      victoryConditions: undefined,
    };

    store.getState().loadScenario(scenario, false, 818);
    store.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
    store.getState().scheduleTotStrike(['slow_lhd', 'fast_ddg'], 'RED_CONTACT_enemy_target', 1);

    const orders = store.getState().pendingTotStrikeOrders;
    expect(orders).toHaveLength(2);
    const slowOrder = orders.find((o) => o.shooterId === 'slow_lhd')!;
    const fastOrder = orders.find((o) => o.shooterId === 'fast_ddg')!;
    expect(slowOrder.plannedImpactSimTime).toBe(fastOrder.plannedImpactSimTime);
    // Slow subsonic missile MUST launch much earlier than fast supersonic missile!
    expect(slowOrder.launchAtSimTime).toBeLessThan(fastOrder.launchAtSimTime - 60_000);

    // Step 10s: slow missile is already airborne while fast missile is still holding on the rail
    store.getState().stepSingleTick(10);
    expect(Object.values(store.getState().weaponsInFlight).map((m) => m.shooterId)).toEqual(['slow_lhd']);
    expect(store.getState().pendingTotStrikeOrders).toHaveLength(1);

    // Replay deterministically across speed batches
    const expected = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));
    for (const batch of [1, 15, 60]) {
      expect(replayBattleRecording(recording, batch)).toEqual(expected);
    }
  });
});

describe('Module 5: Cloud layers, rainstorm weather zones & sea-state sensor/deck modifiers', () => {
  test('cloud decks and rainstorm fronts attenuate IRST/IR seekers while radar remains all-weather, and Sea State 6 suspends frigate helo deck ops', () => {
    const stormEnv = {
      landPolygons: [],
      acousticZones: [],
      weather: {
        condition: 'rain_storm' as const,
        seaState: 5 as const,
        cloudFloorM: 1200,
        cloudCeilingM: 6000,
      },
      weatherZones: [
        {
          id: 'typhoon_squall',
          name: 'Typhoon Squall',
          condition: 'rain_storm' as const,
          seaStateOverride: 6 as const,
          areaPolygon: [[-0.2, -0.2], [0.8, -0.2], [0.8, 0.2], [-0.2, 0.2]] as [number, number][],
        },
      ],
    };

    // Observer at 9,000m above cloud deck looking down at target at 500m below cloud deck inside squall -> strong optical attenuation!
    const mods = evaluateWeatherModifiers([0, 0], 9000, [0.45, 0], 500, stormEnv);
    expect(mods.opticalFactor).toBeLessThan(0.25);
    expect(mods.localSeaState).toBe(6);
    expect(mods.passiveSonarFactor).toBeLessThan(0.75);

    const irOnlyCatalog = structuredClone(catalog);
    irOnlyCatalog.platforms.j20_mighty_dragon.sensorIds = ['eots_irst'];
    const j20Ir = createRuntimeUnitFromPlacement(
      placement('j20_ir', { platformId: 'j20_mighty_dragon', position: [0, 0], altitudeM: 9000, doctrine: { roe: 'hold', emconRadar: false } }),
      irOnlyCatalog
    );
    const lowBogey = createRuntimeUnitFromPlacement(
      placement('low_bogey', { side: 'BLUE', platformId: 'fa18ef_super_hornet', position: [0.45, 0], altitudeM: 500 }),
      irOnlyCatalog
    );
    // Clear sky (no weather): EOTS 110km easily detects bogey at ~50km
    expect(computeContactsOnly({ j20_ir: j20Ir, low_bogey: lowBogey }, irOnlyCatalog, {}, 0, 0).contacts.RED_CONTACT_low_bogey).toBeDefined();
    // Across rain_storm cloud deck: EOTS is blocked (< 20km effective range), while active X-band AESA radar penetrates clouds!
    expect(computeContactsOnly({ j20_ir: j20Ir, low_bogey: lowBogey }, irOnlyCatalog, {}, 0, 0, stormEnv).contacts.RED_CONTACT_low_bogey).toBeUndefined();
    const j20Radar = createRuntimeUnitFromPlacement(
      placement('j20_radar', { platformId: 'j20_mighty_dragon', position: [0, 0], altitudeM: 9000, heading: 90, doctrine: { roe: 'hold', emconRadar: true } }),
      catalog
    );
    expect(computeContactsOnly({ j20_radar: j20Radar, low_bogey: lowBogey }, catalog, {}, 0, 0, stormEnv).contacts.RED_CONTACT_low_bogey).toBeDefined();

    // IR missile seeker range also shrinks across cloud/storm front
    const irMissile: WeaponInFlight = {
      id: 'ir_m',
      weaponId: 'pl10_wvr',
      name: 'PL-10E',
      side: 'RED',
      shooterId: j20Radar.id,
      shooterName: j20Radar.callsign,
      targetId: lowBogey.id,
      targetType: 'unit',
      position: [0.37, 0], // ~8.9 km from [0.45, 0] (inside clear 12km IR seeker, outside storm-attenuated seeker)
      launchPosition: [0.3, 0],
      trail: [],
      altitudeM: 6500,
      heading: 90,
      speedKts: 2100,
      distanceRemainingKm: 8.9,
      maxRangeKm: 30,
      traveledKm: 8,
      basePk: 0.68,
      warheadDamage: 36,
    };
    expect(seekerCanObserve(irMissile, catalog.weapons.pl10_wvr, lowBogey, catalog, false)).toBe(true);
    expect(seekerCanObserve(irMissile, catalog.weapons.pl10_wvr, lowBogey, catalog, false, stormEnv)).toBe(false);

    // Sea State 6 suspends small-deck frigate ASW helo launches while large-deck carrier stays operational
    const ffg = createRuntimeUnitFromPlacement(placement('ffg_storm', { platformId: 'type054b_frigate', position: [0.1, 0] }), catalog);
    const cv = createRuntimeUnitFromPlacement(placement('cv_storm', { platformId: 'cv18_fujian_carrier', position: [0.1, 0] }), catalog);
    const stormUnits = { ffg_storm: ffg, cv_storm: cv };
    expect(
      evaluateCarrierSortieAvailability(stormUnits, catalog, 'ffg_storm', 'hangar_z20f_ffg', undefined, stormEnv).status
    ).toBe('temporary');
    expect(launchCarrierSortie(stormUnits, catalog, 'ffg_storm', 'hangar_z20f_ffg', undefined, stormEnv)).toBeUndefined();
    expect(launchCarrierSortie(stormUnits, catalog, 'cv_storm', 'hangar_j35_vf1', undefined, stormEnv)).toBeDefined();
  });
});

describe('Module 6: Subsystem hit locations & deterministic Damage Control (DC)', () => {
  test('ARM blinds radar array, torpedo cripples propulsion with flooding, and carrier deck fire suspends sorties until DC extinguishes blaze', () => {
    // 1. ARM hit blinds AESA radar while hull retains >75% HP
    const ddg = createRuntimeUnitFromPlacement(placement('ddg_arm', { side: 'BLUE', platformId: 'arleigh_burke_flt3' }), catalog);
    ddg.hp = ddg.maxHp - 30;
    applySubsystemHitDamage(ddg, catalog.weapons.ld10_arm, 30);
    expect(ddg.hp / ddg.maxHp).toBeGreaterThan(0.75);
    expect(ddg.subsystems!.sensors).toBeLessThanOrEqual(0.35);
    // Second ARM hit completely blinds radar (<= 0.2 -> radarFactor === 0)
    applySubsystemHitDamage(ddg, catalog.weapons.ld10_arm, 30);
    expect(getUnitCapabilities(ddg).radarFactor).toBe(0);
    expect(getUnitCapabilities(ddg).canFire).toBe(true); // VLS still functional via offboard CEC!

    // 2. Torpedo hit damages propulsion shaft and induces hull flooding -> drastic speed loss
    const cruiser = createRuntimeUnitFromPlacement(placement('ddg_torp', { platformId: 'type055_destroyer' }), catalog);
    cruiser.hp -= 65;
    applySubsystemHitDamage(cruiser, catalog.weapons.mk48_adcap, 65);
    expect(cruiser.subsystems!.flooding).toBeGreaterThanOrEqual(0.4);
    expect(getUnitCapabilities(cruiser).speedFactor).toBeLessThan(0.6);

    // 3. AShM hit on carrier ignites flight deck fire (>=0.35), halting launches until Damage Control suppresses fire
    const carrier = createRuntimeUnitFromPlacement(placement('cv_fire', { platformId: 'cv18_fujian_carrier' }), catalog);
    carrier.hp -= 55;
    applySubsystemHitDamage(carrier, catalog.weapons.agm158c_lrasm, 55);
    expect(carrier.subsystems!.fire).toBeGreaterThanOrEqual(0.38);
    expect(getUnitCapabilities(carrier).canLaunchAircraft).toBe(false);
    expect(evaluateCarrierSortieAvailability({ cv_fire: carrier }, catalog, 'cv_fire', 'hangar_j35_vf1').status).toBe('temporary');

    // Run 25s of deterministic Damage Control firefighting -> deck fire drops below 0.35 -> flight deck reopens!
    const afterDc = advanceSimulation(
      {
        startTime: 0,
        simTime: 0,
        tick: 0,
        rngState: 1,
        units: { cv_fire: carrier },
        contacts: {},
        weaponsInFlight: {},
        explosions: [],
        missions: [],
        score: emptyScore(),
      },
      catalog,
      25,
      { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false },
      'RED'
    ).nextState;
    expect(afterDc.units.cv_fire.subsystems!.fire).toBeLessThan(0.35);
    expect(getUnitCapabilities(afterDc.units.cv_fire).canLaunchAircraft).toBe(true);
    expect(launchCarrierSortie(afterDc.units, catalog, 'cv_fire', 'hangar_j35_vf1')).toBeDefined();
  });
});

describe('Module 7: BDA fog-of-war confirmation & periodic satellite ISR passes', () => {
  test('stand-off BVR kills remain kill_unconfirmed until a SAR/recon pass sweeps the target, and overcast clouds block EO satellites while SAR penetrates', () => {
    const localCat = structuredClone(catalog);
    localCat.platforms.constellation_ffg.ciwsDefenseProb = 0;

    const shooter = createRuntimeUnitFromPlacement(
      placement('red_standoff', { platformId: 'type055_destroyer', position: [0, 0], doctrine: { roe: 'hold', emconRadar: false } }),
      localCat
    );
    const victim = createRuntimeUnitFromPlacement(
      placement('blue_victim', { side: 'BLUE', platformId: 'constellation_ffg', position: [2.0, 0], doctrine: { roe: 'hold', emconRadar: false } }),
      localCat
    );
    victim.hp = 20;

    const priorContact: TacticalContact = {
      id: 'RED_CONTACT_blue_victim',
      actualUnitId: victim.id,
      observerSide: 'RED',
      targetSide: 'BLUE',
      domain: 'surface',
      classification: 'classified',
      displayName: 'SKUNK-202',
      sidc: victim.sidc,
      estimatedPosition: [2.0, 0],
      truePosition: [2.0, 0],
      uncertaintyRadiusKm: 1.5,
      heading: 270,
      speedKts: 15,
      altitudeM: 0,
      firstDetectedTime: 0,
      lastDetectedTime: 1000,
      detectedBySources: ['ISR'],
      threatLevel: 'high',
    };

    const killMissile: WeaponInFlight = {
      id: 'bvr_kill_msl',
      weaponId: 'yj18_ashm',
      name: 'YJ-18',
      side: 'RED',
      shooterId: shooter.id,
      shooterName: shooter.callsign,
      targetId: victim.id,
      targetType: 'unit',
      position: [1.999, 0],
      launchPosition: [0, 0],
      trail: [],
      altitudeM: 12,
      heading: 90,
      speedKts: 1850,
      distanceRemainingKm: 0.1,
      maxRangeKm: 540,
      traveledKm: 220,
      basePk: 0.99,
      warheadDamage: 80,
      ...launchGuidance(priorContact),
      seekerState: 'terminal_locked',
    };

    const contacts: Record<string, TacticalContact> = { [priorContact.id]: priorContact };
    const weaponsInFlight: Record<string, WeaponInFlight> = { [killMissile.id]: killMissile };
    const logs: CombatLogEntry[] = [];
    advanceWeaponPhysics({
      units: { red_standoff: shooter, blue_victim: victim },
      contacts,
      weaponsInFlight,
      previousExplosions: [],
      catalog: localCat,
      nextSimTime: 2000,
      dtSec: 0.25,
      score: emptyScore(),
      creditedDamage: {},
      rng: () => 0.1,
      logs,
      autoPauseSettings: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false },
      triggerPause: () => undefined,
    });

    // Target is destroyed in world truth, but shooter at 222km has NO visual/SAR BDA -> contact remains kill_unconfirmed!
    expect(victim.status).toBe('destroyed');
    expect(contacts.RED_CONTACT_blue_victim?.bdaStatus).toBe('kill_unconfirmed');

    // Overcast storm clouds block EO keyhole satellite at t=60s, leaving kill_unconfirmed unresolved!
    const satEnv = {
      landPolygons: [],
      acousticZones: [],
      weather: { condition: 'rain_storm' as const, seaState: 4 as const, cloudFloorM: 1200, cloudCeilingM: 6000 },
      satellitePasses: [
        {
          id: 'eo_sat',
          name: 'EO-Keyhole',
          side: 'RED' as const,
          sensorKind: 'eo_optical' as const,
          firstPassSec: 60,
          intervalSec: 300,
          swathPolygon: [[1.5, -0.5], [2.5, -0.5], [2.5, 0.5], [1.5, 0.5]] as [number, number][],
        },
        {
          id: 'sar_sat',
          name: 'Yaogan-SAR',
          side: 'RED' as const,
          sensorKind: 'sar_radar' as const,
          firstPassSec: 90,
          intervalSec: 300,
          swathPolygon: [[1.5, -0.5], [2.5, -0.5], [2.5, 0.5], [1.5, 0.5]] as [number, number][],
        },
      ],
    };

    const silentCarrier = createRuntimeUnitFromPlacement(
      placement('blue_silent_cvn', {
        side: 'BLUE',
        platformId: 'cvn_carrier',
        position: [2.1, 0.1],
        doctrine: { roe: 'hold', emconRadar: false, emconJamming: false },
      }),
      localCat
    );
    const allUnits = { red_standoff: shooter, blue_victim: victim, blue_silent_cvn: silentCarrier };

    // At t=62s (EO pass window under rain_storm clouds): EO satellite is blocked by clouds!
    const atEoPass = computeContactsOnly(allUnits, localCat, contacts, 62_000, 1, satEnv, 0);
    expect(atEoPass.contacts.RED_CONTACT_blue_silent_cvn).toBeUndefined();
    expect(atEoPass.contacts.RED_CONTACT_blue_victim?.bdaStatus).toBe('kill_unconfirmed');

    // At t=92s (SAR pass window): all-weather SAR penetrates clouds, identifies silent CVN, AND confirms BDA sinking of blue_victim!
    const atSarPass = computeContactsOnly(allUnits, localCat, atEoPass.contacts, 92_000, 1, satEnv, 0);
    expect(atSarPass.contacts.RED_CONTACT_blue_silent_cvn).toBeDefined();
    expect(atSarPass.contacts.RED_CONTACT_blue_silent_cvn.classification).toBe('identified');
    expect(atSarPass.contacts.RED_CONTACT_blue_victim).toBeUndefined();
    expect(atSarPass.logs.some((l) => l.title.includes('BDA毁伤复核确认'))).toBe(true);
  });
});

describe('Code review remediation: key-order determinism, no-op command filtering & incremental replay', () => {
  test('shuffled unit/contact key insertion order produces identical autoDefense & simulation state', () => {
    const u1 = createRuntimeUnitFromPlacement(
      placement('u_alpha', { position: [0, 0], doctrine: { roe: 'free', emconRadar: true, salvoSize: 1 } }),
      catalog
    );
    const u2 = createRuntimeUnitFromPlacement(
      placement('u_beta', { position: [0, 0.05], doctrine: { roe: 'free', emconRadar: true, salvoSize: 1 } }),
      catalog
    );
    const e1 = createRuntimeUnitFromPlacement(
      placement('e_one', { side: 'BLUE', platformId: 'constellation_ffg', position: [0.35, 0], doctrine: { roe: 'free', emconRadar: true } }),
      catalog
    );
    const e2 = createRuntimeUnitFromPlacement(
      placement('e_two', { side: 'BLUE', platformId: 'arleigh_burke_flt3', position: [0.35, 0.05], doctrine: { roe: 'free', emconRadar: true } }),
      catalog
    );
    const pauses = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };
    const forwardWorld = advanceSimulation(
      {
        startTime: 0,
        simTime: 0,
        tick: 0,
        rngState: 777,
        units: { u_alpha: u1, u_beta: u2, e_one: e1, e_two: e2 },
        contacts: {},
        weaponsInFlight: {},
        explosions: [],
        missions: [],
        score: emptyScore(),
      },
      catalog,
      6,
      pauses,
      'RED'
    ).nextState;

    const reversedWorld = advanceSimulation(
      {
        startTime: 0,
        simTime: 0,
        tick: 0,
        rngState: 777,
        units: { e_two: structuredClone(e2), u_beta: structuredClone(u2), e_one: structuredClone(e1), u_alpha: structuredClone(u1) },
        contacts: {},
        weaponsInFlight: {},
        explosions: [],
        missions: [],
        score: emptyScore(),
      },
      catalog,
      6,
      pauses,
      'RED'
    ).nextState;

    expect(reversedWorld.score).toEqual(forwardWorld.score);
    expect(Object.keys(reversedWorld.weaponsInFlight).sort()).toEqual(Object.keys(forwardWorld.weaponsInFlight).sort());
  });

  test('no-op removeReferencePoint, clearUnitWaypoints, setPlayerSide, and setPlayMode do not pollute commandHistory, and incremental seekReplayPlayer matches full replay', () => {
    store.getState().loadScenario(SCENARIO_EAST_SEA_THUNDER, false, 1234);
    store.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });

    // No-op calls must NOT record into commandHistory
    store.getState().removeReferencePoint('non_existent_rp');
    const lockedRp = store.getState().referencePoints.find((r) => r.locked);
    if (lockedRp) store.getState().removeReferencePoint(lockedRp.id);
    const blueRp = store.getState().referencePoints.find((r) => r.side === 'BLUE');
    if (blueRp) store.getState().removeReferencePoint(blueRp.id);
    store.getState().setPlayerSide('RED');
    store.getState().setPlayMode('command');
    store.getState().clearUnitWaypoints('red_radar_fujian');
    store.getState().batchClearUnitWaypoints(['red_radar_fujian']);
    expect(store.getState().commandHistory).toHaveLength(0);
    expect(store.getState().commandSequence).toBe(0);

    // Record real commands across ticks and verify incremental seekReplayPlayer matches full replay
    store.getState().stepSingleTick(5);
    store.getState().updateUnitDoctrine('red_055_nanchang', { roe: 'hold' });
    store.getState().stepSingleTick(5);
    const finalCanonical = canonicalBattleState();
    const recording = JSON.parse(JSON.stringify(captureBattleRecording()));

    store.getState().startReplayPlayer(recording, 0);
    store.getState().seekReplayPlayer(12);
    store.getState().seekReplayPlayer(24);
    store.getState().seekReplayPlayer(recording.untilTick);
    expect(canonicalBattleState()).toEqual(finalCanonical);
    store.getState().exitReplayPlayer();
  });
});
