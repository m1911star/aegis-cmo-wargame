import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG } from '../../../src/db';
import { resolvePropulsionAtAltitude } from '../../../src/engine/cmoUnits';
import { countActiveGuidanceChannels, evaluateFireControl } from '../../../src/engine/fireControl';
import { resolveUnitConfiguration } from '../../../src/engine/unitConfiguration';
import { computeContactsOnly } from '../../../src/engine/sensors';
import { advanceSimulation, createRuntimeUnitFromPlacement } from '../../../src/engine/simulationEngine';
import type { EquipmentCatalog, TacticalContact, WeaponInFlight } from '../../../src/types/wargame';

describe('CMO relational engine resolution', () => {
  test('resolves propulsion speed, mountSpec capacity, comm datalink, and 8-arc sensor blind spots', () => {
    const catalog = structuredClone(MASTER_EQUIPMENT_CATALOG) as EquipmentCatalog;
    catalog.propulsions = {
      prop_test: {
        id: 'prop_test',
        name: 'Test Gas Turbine',
        type: 'Gas Turbine',
        speedProfile: [
          { altitudeBand: 1, throttle: 2, speedKts: 18, altitudeMinM: 0, altitudeMaxM: 0, consumptionPerHour: 10 },
          { altitudeBand: 1, throttle: 4, speedKts: 31, altitudeMinM: 0, altitudeMaxM: 0, consumptionPerHour: 30 },
        ],
      },
    };
    catalog.comms = {
      comm_link16: {
        id: 'comm_link16',
        name: 'Link 16 / CEC',
        type: 'Datalink',
        supportsDatalink: true,
        supportsCec: true,
      },
    };
    catalog.mounts = {
      mount_mk41: {
        id: 'mount_mk41',
        name: 'Mk 41 VLS',
        rofPerMin: 12,
        capacity: 32,
        magazineRofPerMin: 0,
        magazineCapacity: 0,
        damagePoints: 40,
        trainable: false,
        autonomous: false,
        weaponIds: [catalog.platforms.type055_destroyer.mounts[0].weaponId],
      },
    };
    const baseShip = structuredClone(catalog.platforms.type055_destroyer);
    catalog.platforms.cmo_test_ddg = {
      ...baseShip,
      id: 'cmo_test_ddg',
      maxSpeedKts: 0,
      cruiseSpeedKts: 0,
      hasDatalink: false,
      propulsionIds: ['prop_test'],
      commIds: ['comm_link16'],
      mounts: [{ mountId: 'vls_1', weaponId: baseShip.mounts[0].weaponId, maxAmmo: 0, reloadTimeSec: 0, mountSpecId: 'mount_mk41' }],
      sensorIds: [baseShip.sensorIds[0]],
      sensorMounts: [{ sensorId: baseShip.sensorIds[0], mastHeightM: 28, arcs: { SB: true, PB: true } }],
    };

    const cfg = resolveUnitConfiguration(catalog, 'cmo_test_ddg');
    expect(cfg.maxSpeedKts).toBe(31);
    expect(cfg.cruiseSpeedKts).toBe(18);
    expect(cfg.hasDatalink).toBe(true);
    expect(cfg.mounts[0].maxAmmo).toBe(32);
    expect(cfg.mounts[0].reloadTimeSec).toBe(5);

    const observer = createRuntimeUnitFromPlacement(
      {
        id: 'obs', name: 'obs', callsign: 'obs', side: 'BLUE', platformId: 'cmo_test_ddg',
        parentGroupId: 'g1', position: [120, 25], heading: 0, speedKts: 18,
        doctrine: { roe: 'hold', emconRadar: true, emconSonar: false, emconJamming: false },
      },
      catalog,
      () => 0.5
    );
    const targetAhead = createRuntimeUnitFromPlacement(
      {
        id: 't_ahead', name: 't_ahead', callsign: 't_ahead', side: 'RED', platformId: 'j20_mighty_dragon',
        parentGroupId: 'g2', position: [120, 25.4], heading: 180, speedKts: 450, altitudeM: 8000,
        doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: false },
      },
      catalog,
      () => 0.5
    );
    const targetAstern = createRuntimeUnitFromPlacement(
      {
        id: 't_astern', name: 't_astern', callsign: 't_astern', side: 'RED', platformId: 'j20_mighty_dragon',
        parentGroupId: 'g2', position: [120, 24.6], heading: 0, speedKts: 450, altitudeM: 8000,
        doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: false },
      },
      catalog,
      () => 0.5
    );

    const { contacts } = computeContactsOnly(
      { [observer.id]: observer, [targetAhead.id]: targetAhead, [targetAstern.id]: targetAstern },
      catalog,
      {},
      1000
    );
    expect(contacts.BLUE_CONTACT_t_ahead).toBeDefined();
    expect(contacts.BLUE_CONTACT_t_astern).toBeUndefined();
  });

  test('enforces 8-sector mount firing arcs and exempts autonomous point-defense mounts from channel saturation', () => {
    const catalog = structuredClone(MASTER_EQUIPMENT_CATALOG) as EquipmentCatalog;
    const ship = createRuntimeUnitFromPlacement(
      {
        id: 'ship_arc',
        name: 'ship_arc',
        callsign: 'ARC-1',
        side: 'BLUE',
        platformId: 'arleigh_burke_flt3',
        parentGroupId: 'g1',
        position: [120, 25],
        heading: 0,
        speedKts: 15,
        doctrine: { roe: 'free', emconRadar: true, emconSonar: false, emconJamming: false },
      },
      catalog
    );
    ship.mounts[0].arcs = { SB: true, PB: true }; // Bow-only firing sector (315..45 deg)
    const samWeapon = catalog.weapons[ship.mounts[0].weaponId]!;

    const makeContactAt = (pos: [number, number], idSuffix: string): TacticalContact => ({
      id: `BLUE_CONTACT_${idSuffix}`,
      actualUnitId: idSuffix,
      observerSide: 'BLUE',
      targetSide: 'RED',
      domain: 'air',
      classification: 'identified',
      displayName: idSuffix,
      sidc: 'SHAPMF------',
      estimatedPosition: pos,
      truePosition: pos,
      uncertaintyRadiusKm: 0.3,
      heading: 180,
      speedKts: 480,
      altitudeM: 5000,
      firstDetectedTime: 0,
      lastDetectedTime: 0,
      detectedBySources: ['ARC-1'],
      sourceUnitIds: [ship.id],
      fireControlSourceIds: [ship.id],
      threatLevel: 'critical',
    });

    const aheadContact = makeContactAt([120, 25.3], 'ahead');
    const asternContact = makeContactAt([120, 24.7], 'astern');

    const aheadSol = evaluateFireControl(ship, aheadContact, ship.mounts[0], samWeapon, catalog, { [ship.id]: ship }, 0, 'automatic');
    const asternSol = evaluateFireControl(ship, asternContact, ship.mounts[0], samWeapon, catalog, { [ship.id]: ship }, 0, 'automatic');
    expect(aheadSol.status).toBe('executable');
    expect(asternSol.status).toBe('blocked');
    expect(asternSol.hardBlockReasons.some((r) => r.includes('挂架射界盲区'))).toBe(true);

    // Saturate main guidance channels with non-autonomous missiles; autonomous mount still executes
    catalog.platforms[ship.platformId].maxGuidanceChannels = 1;
    const inflight: Record<string, WeaponInFlight> = {
      m1: {
        id: 'm1',
        weaponId: samWeapon.id,
        name: samWeapon.codeName,
        side: 'BLUE',
        shooterId: ship.id,
        shooterName: ship.callsign,
        targetId: 'ahead',
        targetType: 'unit',
        position: [120, 25.1],
        launchPosition: [120, 25],
        trail: [],
        altitudeM: 4000,
        heading: 0,
        speedKts: 2000,
        distanceRemainingKm: 20,
        maxRangeKm: 150,
        traveledKm: 10,
        basePk: 0.8,
        warheadDamage: 40,
        seekerState: 'midcourse_datalink',
      },
    };
    expect(countActiveGuidanceChannels(ship.id, inflight, catalog)).toBe(1);
    const blockedNonAuto = evaluateFireControl(ship, aheadContact, ship.mounts[0], samWeapon, catalog, { [ship.id]: ship }, 0, 'automatic', inflight);
    expect(blockedNonAuto.status).toBe('blocked');

    const autoMount = { ...ship.mounts[0], autonomous: true };
    const allowedAuto = evaluateFireControl(ship, aheadContact, autoMount, samWeapon, catalog, { [ship.id]: ship }, 0, 'automatic', inflight);
    expect(allowedAuto.status).toBe('executable');
  });

  test('resolves multi-altitude propulsion speed/fuel curves, OODA targeting/evasion delays, and magazine auto-reloads', () => {
    const catalog = structuredClone(MASTER_EQUIPMENT_CATALOG) as EquipmentCatalog;
    catalog.propulsions!.prop_multi = {
      id: 'prop_multi',
      dbid: 501,
      name: 'Variable Cycle Turbofan',
      type: 'Turbofan',
      speedProfile: [
        { altitudeBand: 1, throttle: 1, speedKts: 310, altitudeMinM: 0, altitudeMaxM: 3000, consumptionPerHour: 18 },
        { altitudeBand: 1, throttle: 2, speedKts: 440, altitudeMinM: 0, altitudeMaxM: 3000, consumptionPerHour: 30 },
        { altitudeBand: 1, throttle: 4, speedKts: 680, altitudeMinM: 0, altitudeMaxM: 3000, consumptionPerHour: 90 },
        { altitudeBand: 2, throttle: 2, speedKts: 540, altitudeMinM: 3001, altitudeMaxM: 18000, consumptionPerHour: 24 },
        { altitudeBand: 2, throttle: 4, speedKts: 1120, altitudeMinM: 3001, altitudeMaxM: 18000, consumptionPerHour: 72 },
      ],
    };
    const jetSpec = structuredClone(catalog.platforms.j20_mighty_dragon);
    jetSpec.id = 'cmo_jet_dbid';
    jetSpec.dbid = 3500;
    jetSpec.propulsionIds = ['prop_multi'];
    jetSpec.ooda = { detectionSec: 4, targetingSec: 6, evasionSec: 4 };
    catalog.platforms.cmo_jet_dbid = jetSpec;

    const lowLoiter = resolvePropulsionAtAltitude(jetSpec, catalog, 1000, 1, 1200, 520);
    const highFlank = resolvePropulsionAtAltitude(jetSpec, catalog, 11000, 4, 1200, 520);
    expect(lowLoiter.altitudeBand).toBe(1);
    expect(lowLoiter.targetSpeedKts).toBe(310);
    expect(lowLoiter.fuelBurnMultiplier).toBeCloseTo(0.6, 2);
    expect(highFlank.altitudeBand).toBe(2);
    expect(highFlank.targetSpeedKts).toBe(1120);
    expect(highFlank.fuelBurnMultiplier).toBeCloseTo(3.0, 2);

    // Magazine reload + OODA targeting delay on an imported CMO surface combatant
    const wId = Object.values(catalog.weapons).find((w) => w.category === 'sam' && w.maxRangeKm >= 80)!.id;
    catalog.magazines!.mag_cmo_vls = {
      id: 'mag_cmo_vls',
      dbid: 801,
      name: 'Mk 41 Reserve Magazine',
      rofPerMin: 30, // 2s per round reload cycle
      capacity: 4,
      weaponIds: [wId],
    };
    const shipSpec = structuredClone(catalog.platforms.type055_destroyer);
    shipSpec.id = 'cmo_ddg_dbid';
    shipSpec.dbid = 2901;
    shipSpec.defaultLoadoutId = undefined;
    shipSpec.availableLoadoutIds = undefined;
    shipSpec.ooda = { detectionSec: 0.5, targetingSec: 3, evasionSec: 3 };
    shipSpec.magazineIds = ['mag_cmo_vls'];
    shipSpec.mounts = [{ mountId: 'm_vls', weaponId: wId, maxAmmo: 4, reloadTimeSec: 1 }];
    catalog.platforms.cmo_ddg_dbid = shipSpec;

    const shooter = createRuntimeUnitFromPlacement(
      {
        id: 'cmo_shooter',
        name: 'CMO DDG',
        callsign: 'CMO-1',
        side: 'RED',
        platformId: 'cmo_ddg_dbid',
        parentGroupId: 'g1',
        position: [122.0, 25.0],
        heading: 90,
        speedKts: 15,
        doctrine: { roe: 'free', emconRadar: true, salvoSize: 1, engageOpportunityTargets: true, minimumAutomaticThreat: 'low' },
      },
      catalog
    );
    expect(shooter.magazineStores?.[wId]).toBe(4);

    const drone = createRuntimeUnitFromPlacement(
      {
        id: 'blue_target',
        name: 'Target',
        callsign: 'TGT-1',
        side: 'BLUE',
        platformId: 'mq4c_triton',
        parentGroupId: 'g2',
        position: [122.4, 25.0],
        altitudeM: 9000,
        heading: 270,
        speedKts: 300,
        doctrine: { roe: 'hold', emconRadar: true },
      },
      catalog
    );

    const baseWorld = {
      startTime: 0,
      tick: 0,
      simTime: 0,
      rngState: 42,
      units: { [shooter.id]: shooter, [drone.id]: drone },
      contacts: {},
      weaponsInFlight: {},
      explosions: [],
      missions: [],
      score: {
        redLosses: 0, blueLosses: 0, redMissilesFired: 0, blueMissilesFired: 0,
        redInterceptions: 0, blueInterceptions: 0, redScore: 0, blueScore: 0,
        firedEventIds: [], sortiesLaunched: 0,
      },
    };
    const pausesOff = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };

    // After 2s (< 3s targetingSec), OODA holds automatic fire
    const at2s = advanceSimulation(baseWorld, catalog, 2, pausesOff, 'RED');
    expect(at2s.nextState.score.redMissilesFired).toBe(0);

    // By 8s (>= 3s targetingSec + 1s mount cooldown + 2s mag cycle), shooter fires and replenishes from magazineStores
    const at8s = advanceSimulation(at2s.nextState, catalog, 6, pausesOff, 'RED');
    expect(at8s.nextState.score.redMissilesFired).toBeGreaterThanOrEqual(1);
    expect(at8s.nextState.units.cmo_shooter.magazineStores?.[wId]).toBeLessThan(4);
  });
});
