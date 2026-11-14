import type {
  EquipmentCatalog,
  LoadoutSpec,
  PlatformSpec,
  SensorSpec,
  WeaponSpec,
} from '../types/wargame';
import { MODULAR_SENSORS } from './sensors/allSensors';
import { MODULAR_WEAPONS } from './weapons/allWeapons';
import { MODULAR_LOADOUTS } from './loadouts/allLoadouts';
import { RED_FORCE_PLATFORMS } from './platforms/redForcePlatforms';
import { BLUE_FORCE_PLATFORMS } from './platforms/blueForcePlatforms';
import { assertCatalogShape } from '../validation/wargameSchemas';
export { resolveUnitConfiguration } from './unitConfiguration';

// ============================================================================
// AEGIS-CMO // 四层模块化装备数据库汇总与引用完整性校验器
// ============================================================================

export const MODULAR_PLATFORMS: Record<string, PlatformSpec> = {
  ...RED_FORCE_PLATFORMS,
  ...BLUE_FORCE_PLATFORMS,
};

export const MASTER_EQUIPMENT_CATALOG: EquipmentCatalog = {
  version: '2026.11-JOINT-AIR-LAND-1',
  sensors: MODULAR_SENSORS,
  weapons: MODULAR_WEAPONS,
  loadouts: MODULAR_LOADOUTS,
  platforms: MODULAR_PLATFORMS,
};

/**
 * 合并主装备目录与想定自定义扩展目录 (Catalog Overlay Merger)
 */
export function resolveEquipmentCatalog(
  overlay?: Partial<EquipmentCatalog>
): EquipmentCatalog {
  if (!overlay) return MASTER_EQUIPMENT_CATALOG;
  return {
    version: overlay.version || MASTER_EQUIPMENT_CATALOG.version,
    sensors: {
      ...MASTER_EQUIPMENT_CATALOG.sensors,
      ...(overlay.sensors || {}),
    },
    weapons: {
      ...MASTER_EQUIPMENT_CATALOG.weapons,
      ...(overlay.weapons || {}),
    },
    loadouts: {
      ...MASTER_EQUIPMENT_CATALOG.loadouts,
      ...(overlay.loadouts || {}),
    },
    platforms: {
      ...MASTER_EQUIPMENT_CATALOG.platforms,
      ...(overlay.platforms || {}),
    },
  };
}

/**
 * 校验装备数据库内部所有外键引用完整性 (Platforms -> Sensors, Weapons, Loadouts, Hangar)
 */
export function validateCatalogIntegrity(catalog: EquipmentCatalog): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  try {
    assertCatalogShape(catalog);
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : 'Invalid catalog'] };
  }

  const unique = (ids: string[], path: string) => {
    if (new Set(ids).size !== ids.length) errors.push(`${path}: duplicate identifiers`);
  };
  const checkLoadout = (loadoutId: string, platformId: string, path: string) => {
    const loadout = Object.hasOwn(catalog.loadouts, loadoutId) ? catalog.loadouts[loadoutId] : undefined;
    if (!loadout) errors.push(`${path}: unknown loadout ${loadoutId}`);
    else if (!loadout.compatiblePlatformIds.includes(platformId)) {
      errors.push(`${path}: loadout ${loadoutId} is incompatible with ${platformId}`);
    }
  };
  for (const section of ['sensors', 'weapons', 'loadouts', 'platforms'] as const) {
    for (const [key, spec] of Object.entries(catalog[section])) {
      if (key !== spec.id) errors.push(`${section}.${key}: key must match id ${spec.id}`);
    }
  }
  for (const [id, weapon] of Object.entries(catalog.weapons)) {
    if (weapon.minRangeKm > weapon.maxRangeKm) errors.push(`weapons.${id}: minRangeKm exceeds maxRangeKm`);
  }

  // 1. 校验 Loadouts 引用的武器与平台
  for (const [lId, loadout] of Object.entries(catalog.loadouts)) {
    unique(loadout.compatiblePlatformIds, `loadouts.${lId}.compatiblePlatformIds`);
    unique(loadout.mounts.map((m) => m.mountId), `loadouts.${lId}.mounts`);
    for (const pId of loadout.compatiblePlatformIds) {
      if (!Object.hasOwn(catalog.platforms, pId)) {
        errors.push(`Loadout [${lId}] 引用了不存在的兼容平台 ID: ${pId}`);
      }
    }
    for (const m of loadout.mounts) {
      if (!Object.hasOwn(catalog.weapons, m.weaponId)) {
        errors.push(`Loadout [${lId}] 挂架 [${m.mountId}] 引用了不存在的武器 ID: ${m.weaponId}`);
      }
    }
    for (const sId of loadout.additionalSensorIds || []) {
      if (!Object.hasOwn(catalog.sensors, sId)) {
        errors.push(`Loadout [${lId}] 引用了不存在的吊舱传感器 ID: ${sId}`);
      }
    }
  }

  // 2. 校验 Platforms 引用的传感器、挂架武器、Loadout 与 Hangar 母舰子平台
  for (const [pId, platform] of Object.entries(catalog.platforms)) {
    unique(platform.mounts.map((m) => m.mountId), `platforms.${pId}.mounts`);
    unique((platform.hangarSlots ?? []).map((s) => s.slotId), `platforms.${pId}.hangarSlots`);
    if (platform.cruiseSpeedKts > platform.maxSpeedKts) errors.push(`platforms.${pId}: cruise speed exceeds maximum`);
    if ((platform.aarFuelCapacitySec === undefined) !== (platform.aarTransferRateSecPerSec === undefined)) {
      errors.push(`platforms.${pId}: tanker capacity and transfer rate must be configured together`);
    }
    if (platform.aarFuelCapacitySec !== undefined && (platform.domain !== 'air' || platform.category !== 'tanker')) {
      errors.push(`platforms.${pId}: AAR supply is only valid on tanker aircraft`);
    }
    if (platform.minAltitudeM > platform.defaultAltitudeM || platform.defaultAltitudeM > platform.maxAltitudeM) {
      errors.push(`platforms.${pId}: default altitude is outside platform limits`);
    }
    unique((platform.deployables ?? []).map((deployable) => deployable.platformId), `platforms.${pId}.deployables`);
    for (const deployable of platform.deployables ?? []) {
      const target = catalog.platforms[deployable.platformId];
      if (!target || target.domain !== 'air' || !['decoy', 'mpa_uav'].includes(target.category)) {
        errors.push(`platforms.${pId}: invalid deployable platform ${deployable.platformId}`);
      }
    }
    for (const sId of platform.sensorIds) {
      if (!Object.hasOwn(catalog.sensors, sId)) {
        errors.push(`Platform [${pId}] 引用了不存在的传感器 ID: ${sId}`);
      }
    }
    for (const m of platform.mounts) {
      if (!Object.hasOwn(catalog.weapons, m.weaponId)) {
        errors.push(`Platform [${pId}] 挂架 [${m.mountId}] 引用了不存在的武器 ID: ${m.weaponId}`);
      }
    }
    if (platform.defaultLoadoutId) {
      checkLoadout(platform.defaultLoadoutId, pId, `platforms.${pId}.defaultLoadoutId`);
      if (platform.availableLoadoutIds && !platform.availableLoadoutIds.includes(platform.defaultLoadoutId)) {
        errors.push(`platforms.${pId}: default loadout is not in availableLoadoutIds`);
      }
    }
    for (const lId of platform.availableLoadoutIds || []) {
      checkLoadout(lId, pId, `platforms.${pId}.availableLoadoutIds`);
    }
    for (const slot of platform.hangarSlots || []) {
      if (!Object.hasOwn(catalog.platforms, slot.platformId)) {
        errors.push(`Platform [${pId}] 机库槽位 [${slot.slotId}] 引用了不存在的舰载机平台: ${slot.platformId}`);
      }
      if (catalog.platforms[slot.platformId]?.domain !== 'air') {
        errors.push(`platforms.${pId}.${slot.slotId}: embarked platform must be an aircraft`);
      }
      checkLoadout(slot.defaultLoadoutId, slot.platformId, `platforms.${pId}.${slot.slotId}.defaultLoadoutId`);
      for (const loadoutId of slot.availableLoadoutIds) {
        checkLoadout(loadoutId, slot.platformId, `platforms.${pId}.${slot.slotId}.availableLoadoutIds`);
      }
      if (!slot.availableLoadoutIds.includes(slot.defaultLoadoutId)) errors.push(`platforms.${pId}.${slot.slotId}: default loadout is unavailable`);
      if (slot.readyAirframes > slot.totalAirframes) errors.push(`platforms.${pId}.${slot.slotId}: ready airframes exceed total inventory`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export type { SensorSpec, WeaponSpec, LoadoutSpec, PlatformSpec };
