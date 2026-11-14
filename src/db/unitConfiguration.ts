import type {
  EquipmentCatalog,
  LoadoutSpec,
  PlatformMountTemplate,
  PlatformSpec,
} from '../types/wargame';

export interface ResolvedUnitConfiguration {
  platform: PlatformSpec;
  loadout?: LoadoutSpec;
  loadoutId?: string;
  sensorIds: string[];
  mounts: PlatformMountTemplate[];
  maxSpeedKts: number;
  cruiseSpeedKts: number;
  maxFuelSec: number;
  rcsPenaltyM2: number;
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

  const sensorIds = [...new Set([
    ...platform.sensorIds,
    ...(loadout?.additionalSensorIds ?? []),
  ])];
  for (const id of sensorIds) {
    if (!Object.hasOwn(catalog.sensors, id)) throw new Error(`Unknown sensor: ${id}`);
  }
  const mounts = activeMountsRef.map((mount) => {
    if (!Object.hasOwn(catalog.weapons, mount.weaponId)) {
      throw new Error(`Unknown weapon: ${mount.weaponId}`);
    }
    return { ...mount };
  });
  const penalty = loadout?.speedPenaltyKts ?? 0;
  const maxSpeedKts = Math.max(0, platform.maxSpeedKts - penalty);
  const maxFuelSec = Math.round(platform.maxFuelSec * (loadout?.combatRadiusMultiplier ?? 1));
  if (!Number.isFinite(maxFuelSec)) throw new Error(`Invalid endurance for platform ${platformId}`);

  const result: ResolvedUnitConfiguration = {
    platform,
    loadout,
    loadoutId,
    sensorIds,
    mounts,
    maxSpeedKts,
    cruiseSpeedKts: Math.max(0, Math.min(maxSpeedKts, platform.cruiseSpeedKts - penalty * 0.5)),
    maxFuelSec,
    rcsPenaltyM2: loadout?.rcsPenaltyM2 ?? 0,
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
