import type {
  EquipmentCatalog,
  LoadoutSpec,
  PlatformMountTemplate,
  PlatformSensorMount,
  PlatformSpec,
  RuntimeUnit,
  RuntimeWeaponMount,
} from '../types/wargame';
import { getUnitCapabilities } from './unitCapabilities';

export interface ResolvedUnitConfiguration {
  platform: PlatformSpec;
  loadout?: LoadoutSpec;
  loadoutId?: string;
  sensorIds: string[];
  sensorMounts: PlatformSensorMount[];
  mounts: PlatformMountTemplate[];
  maxSpeedKts: number;
  cruiseSpeedKts: number;
  maxFuelSec: number;
  rcsPenaltyM2: number;
  hasDatalink: boolean;
}

const configCache = new WeakMap<
  EquipmentCatalog,
  Map<
    string,
    {
      platform: PlatformSpec;
      loadout: LoadoutSpec | undefined;
      defaultLoadoutId: string | undefined;
      sensorIdsRef: string[];
      sensorCount: number;
      additionalSensorIdsRef: string[] | undefined;
      additionalSensorCount: number;
      platformMountsRef: PlatformMountTemplate[];
      loadoutMountsRef: PlatformMountTemplate[] | undefined;
      mountCount: number;
      maxSpeedKts: number;
      cruiseSpeedKts: number;
      maxFuelSec: number;
      speedPenaltyKts: number | undefined;
      combatRadiusMultiplier: number | undefined;
      rcsPenaltyM2: number | undefined;
      result: ResolvedUnitConfiguration;
    }
  >
>();

export function resolveUnitConfiguration(
  catalog: EquipmentCatalog,
  platformId: string,
  requestedLoadoutId?: string
): ResolvedUnitConfiguration {
  const platform = Object.hasOwn(catalog.platforms, platformId)
    ? catalog.platforms[platformId]
    : undefined;
  if (!platform) throw new Error(`Unknown platform: ${platformId}`);

  const loadoutId = requestedLoadoutId ?? platform.defaultLoadoutId;
  const loadout = loadoutId && Object.hasOwn(catalog.loadouts, loadoutId)
    ? catalog.loadouts[loadoutId]
    : undefined;
  if (loadoutId && !loadout) throw new Error(`Unknown loadout: ${loadoutId}`);

  const activeMountsRef = loadout?.mounts ?? platform.mounts;
  let perCatalog = configCache.get(catalog);
  const cacheKey = `${platformId}::${loadoutId ?? ''}`;
  const hit = perCatalog?.get(cacheKey);
  if (
    hit &&
    hit.platform === platform &&
    hit.loadout === loadout &&
    hit.defaultLoadoutId === platform.defaultLoadoutId &&
    hit.sensorIdsRef === platform.sensorIds &&
    hit.sensorCount === platform.sensorIds.length &&
    hit.additionalSensorIdsRef === loadout?.additionalSensorIds &&
    hit.additionalSensorCount === (loadout?.additionalSensorIds?.length ?? 0) &&
    hit.platformMountsRef === platform.mounts &&
    hit.loadoutMountsRef === loadout?.mounts &&
    hit.mountCount === activeMountsRef.length &&
    hit.maxSpeedKts === platform.maxSpeedKts &&
    hit.cruiseSpeedKts === platform.cruiseSpeedKts &&
    hit.maxFuelSec === platform.maxFuelSec &&
    hit.speedPenaltyKts === loadout?.speedPenaltyKts &&
    hit.combatRadiusMultiplier === loadout?.combatRadiusMultiplier &&
    hit.rcsPenaltyM2 === loadout?.rcsPenaltyM2
  ) {
    return hit.result;
  }

  if (loadout && !loadout.compatiblePlatformIds.includes(platformId)) {
    throw new Error(`Loadout ${loadout.id} is incompatible with platform ${platformId}`);
  }

  const sensorMountsMap = new Map<string, PlatformSensorMount>();
  for (const sm of platform.sensorMounts ?? []) {
    sensorMountsMap.set(sm.sensorId, { ...sm });
  }
  for (const id of platform.sensorIds) {
    if (!sensorMountsMap.has(id)) {
      sensorMountsMap.set(id, { sensorId: id });
    }
  }
  for (const id of loadout?.additionalSensorIds ?? []) {
    if (!sensorMountsMap.has(id)) {
      sensorMountsMap.set(id, { sensorId: id });
    }
  }
  const sensorMounts = Array.from(sensorMountsMap.values());
  const sensorIds = sensorMounts.map((sm) => sm.sensorId);
  for (const id of sensorIds) {
    if (!Object.hasOwn(catalog.sensors, id)) throw new Error(`Unknown sensor: ${id}`);
  }
  const mounts = activeMountsRef.map((mount) => {
    if (!Object.hasOwn(catalog.weapons, mount.weaponId)) {
      throw new Error(`Unknown weapon: ${mount.weaponId}`);
    }
    const spec = mount.mountSpecId ? catalog.mounts?.[mount.mountSpecId] : undefined;
    if (!spec) return { ...mount };
    const useSpecDefaults = mount.maxAmmo <= 0;
    return {
      ...mount,
      maxAmmo: useSpecDefaults ? spec.capacity : mount.maxAmmo,
      reloadTimeSec: useSpecDefaults && mount.reloadTimeSec <= 0 && spec.rofPerMin > 0
        ? Math.round(60 / spec.rofPerMin)
        : mount.reloadTimeSec,
      trainable: mount.trainable ?? spec.trainable,
      autonomous: mount.autonomous ?? spec.autonomous,
    };
  });
  let baseMaxSpeedKts = platform.maxSpeedKts;
  let baseCruiseSpeedKts = platform.cruiseSpeedKts;
  if ((baseMaxSpeedKts <= 0 || baseCruiseSpeedKts <= 0) && platform.propulsionIds?.length) {
    for (const propId of platform.propulsionIds) {
      const prop = catalog.propulsions?.[propId];
      if (!prop) continue;
      for (const pt of prop.speedProfile) {
        if (pt.throttle === 4 && pt.speedKts > baseMaxSpeedKts) baseMaxSpeedKts = pt.speedKts;
        if (pt.throttle === 2 && pt.speedKts > baseCruiseSpeedKts) baseCruiseSpeedKts = pt.speedKts;
      }
    }
    if (baseCruiseSpeedKts <= 0 && baseMaxSpeedKts > 0) baseCruiseSpeedKts = Math.round(baseMaxSpeedKts * 0.65);
  }
  const hasDatalink =
    platform.hasDatalink ||
    Boolean(platform.commIds?.some((commId) => catalog.comms?.[commId]?.supportsDatalink));
  const penalty = loadout?.speedPenaltyKts ?? 0;
  const maxSpeedKts = Math.max(0, baseMaxSpeedKts - penalty);
  const maxFuelSec = Math.round(platform.maxFuelSec * (loadout?.combatRadiusMultiplier ?? 1));
  if (!Number.isFinite(maxFuelSec)) throw new Error(`Invalid endurance for platform ${platformId}`);

  const result: ResolvedUnitConfiguration = {
    platform,
    loadout,
    loadoutId,
    sensorIds,
    sensorMounts,
    mounts,
    maxSpeedKts,
    cruiseSpeedKts: Math.max(0, Math.min(maxSpeedKts, baseCruiseSpeedKts - penalty * 0.5)),
    maxFuelSec,
    rcsPenaltyM2: loadout?.rcsPenaltyM2 ?? 0,
    hasDatalink,
  };

  if (!perCatalog) {
    perCatalog = new Map();
    configCache.set(catalog, perCatalog);
  }
  perCatalog.set(cacheKey, {
    platform,
    loadout,
    defaultLoadoutId: platform.defaultLoadoutId,
    sensorIdsRef: platform.sensorIds,
    sensorCount: platform.sensorIds.length,
    additionalSensorIdsRef: loadout?.additionalSensorIds,
    additionalSensorCount: loadout?.additionalSensorIds?.length ?? 0,
    platformMountsRef: platform.mounts,
    loadoutMountsRef: loadout?.mounts,
    mountCount: activeMountsRef.length,
    maxSpeedKts: platform.maxSpeedKts,
    cruiseSpeedKts: platform.cruiseSpeedKts,
    maxFuelSec: platform.maxFuelSec,
    speedPenaltyKts: loadout?.speedPenaltyKts,
    combatRadiusMultiplier: loadout?.combatRadiusMultiplier,
    rcsPenaltyM2: loadout?.rcsPenaltyM2,
    result,
  });
  return result;
}

export function createRuntimeWeaponMounts(
  configuration: ResolvedUnitConfiguration,
  catalog: EquipmentCatalog,
  usage: RuntimeUnit['weaponUsage'] = {},
  simTime = 0
): RuntimeWeaponMount[] {
  const expended = new Map(Object.entries(usage).map(([id, state]) => [id, state.expended]));
  return configuration.mounts.map((mount) => {
    const spent = Math.min(mount.maxAmmo, expended.get(mount.weaponId) ?? 0);
    expended.set(mount.weaponId, (expended.get(mount.weaponId) ?? 0) - spent);
    return {
      ...mount,
      weaponName: catalog.weapons[mount.weaponId].name,
      currentAmmo: mount.maxAmmo - spent,
      cooldownRemainingSec: Math.max(0, ((usage[mount.weaponId]?.cooldownUntil ?? 0) - simTime) / 1000),
    };
  });
}

export function recordWeaponLaunch(
  unit: RuntimeUnit,
  mount: RuntimeWeaponMount,
  count: number,
  simTime: number
): void {
  const previous = unit.weaponUsage[mount.weaponId];
  unit.weaponUsage = {
    ...unit.weaponUsage,
    [mount.weaponId]: {
      expended: (previous?.expended ?? 0) + count,
      cooldownUntil: Math.max(previous?.cooldownUntil ?? 0, simTime + mount.reloadTimeSec * getUnitCapabilities(unit).reloadFactor * 1000),
    },
  };
}
