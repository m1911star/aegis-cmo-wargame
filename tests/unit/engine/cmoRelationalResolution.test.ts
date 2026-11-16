import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG } from '../../../src/db';
import { resolveUnitConfiguration } from '../../../src/engine/unitConfiguration';
import { computeContactsOnly } from '../../../src/engine/sensors';
import { createRuntimeUnitFromPlacement } from '../../../src/engine/simulationEngine';
import type { EquipmentCatalog } from '../../../src/types/wargame';

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
});
