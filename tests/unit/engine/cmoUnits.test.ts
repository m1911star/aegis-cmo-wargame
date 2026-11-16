import { describe, expect, test } from 'bun:test';
import {
  dbsmToM2,
  m2ToDbsm,
  nmToKm,
  ftToM,
  getRelativeCmoSector,
  isBearingInCmoArcs,
  resolvePlatformRcsProfile,
  resolvePlatformAcousticDb,
  resolveWeaponWarheadDamage,
  resolveWeaponRangeForDomain,
  resolveWeaponPkForDomain,
} from '../../../src/engine/cmoUnits';
import { MASTER_EQUIPMENT_CATALOG } from '../../../src/db';
import type { EquipmentCatalog, PlatformSpec, WeaponSpec } from '../../../src/types/wargame';

describe('CMO unit conversions & 8-arc geometry', () => {
  test('converts dBsm <-> m² and nm/ft accurately', () => {
    expect(dbsmToM2(0)).toBeCloseTo(1, 5);
    expect(dbsmToM2(-20)).toBeCloseTo(0.01, 5);
    expect(dbsmToM2(10)).toBeCloseTo(10, 5);
    expect(m2ToDbsm(0.005)).toBeCloseTo(-23.01, 1);
    expect(nmToKm(100)).toBeCloseTo(185.2, 2);
    expect(ftToM(10000)).toBeCloseTo(3048, 1);
  });

  test('maps relative bearings to the 8 CMO 45-degree arcs', () => {
    expect(getRelativeCmoSector(10)).toBe('SB');
    expect(getRelativeCmoSector(60)).toBe('SMF');
    expect(getRelativeCmoSector(120)).toBe('SMA');
    expect(getRelativeCmoSector(160)).toBe('SS');
    expect(getRelativeCmoSector(200)).toBe('PS');
    expect(getRelativeCmoSector(250)).toBe('PMA');
    expect(getRelativeCmoSector(290)).toBe('PMF');
    expect(getRelativeCmoSector(350)).toBe('PB');

    const forwardOnly = { SB: true, PB: true };
    expect(isBearingInCmoArcs(90, 110, forwardOnly)).toBe(true);  // +20° -> SB
    expect(isBearingInCmoArcs(90, 70, forwardOnly)).toBe(true);   // -20° -> PB
    expect(isBearingInCmoArcs(90, 270, forwardOnly)).toBe(false); // 180° -> PS
  });

  test('derives RCS profile and acoustic dB from CMO signatures when scalar/profile omitted', () => {
    const base = structuredClone(MASTER_EQUIPMENT_CATALOG.platforms.f35c_lightning);
    const cmoPlatform: PlatformSpec = {
      ...base,
      dbid: 3501,
      rcsProfile: undefined,
      acousticSignatureDb: 0,
      signatures: [
        { type: 'radar_em', front: -23.01, side: -7.45, rear: -10.46, top: -5 },
        { type: 'passive_sonar_lf', front: 112, side: 118, rear: 124 },
      ],
    };
    const rcs = resolvePlatformRcsProfile(cmoPlatform)!;
    expect(rcs.frontalM2).toBeCloseTo(0.005, 3);
    expect(rcs.beamM2).toBeCloseTo(0.18, 2);
    expect(rcs.rearM2).toBeCloseTo(0.09, 2);
    expect(resolvePlatformAcousticDb(cmoPlatform)).toBe(124);
  });

  test('resolves warhead damage, domain range, and domain Pk from CMO fields', () => {
    const catalog = structuredClone(MASTER_EQUIPMENT_CATALOG) as EquipmentCatalog;
    catalog.warheads = {
      wh_test: { id: 'wh_test', name: 'Test 200kg HE', type: 'HE', damagePoints: 55 },
    };
    const weapon: WeaponSpec = {
      ...catalog.weapons.aim120d_aam,
      warheadDamage: 0,
      warheadId: 'wh_test',
      warheadCount: 1,
      domainRangesKm: { air: { minKm: 2, maxKm: 180 } },
      domainPk: { air: 0.78 },
    };
    expect(resolveWeaponWarheadDamage(weapon, catalog)).toBe(55);
    expect(resolveWeaponRangeForDomain(weapon, 'air')).toEqual({ minKm: 2, maxKm: 180 });
    expect(resolveWeaponPkForDomain(weapon, 'air')).toBe(0.78);
  });
});
