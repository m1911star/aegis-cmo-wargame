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
  const mounts = (loadout?.mounts ?? platform.mounts).map((mount) => {
    if (!Object.hasOwn(catalog.weapons, mount.weaponId)) {
      throw new Error(`Unknown weapon: ${mount.weaponId}`);
    }
    return { ...mount };
  });
  const penalty = loadout?.speedPenaltyKts ?? 0;
  const maxSpeedKts = Math.max(0, platform.maxSpeedKts - penalty);
  const maxFuelSec = Math.round(platform.maxFuelSec * (loadout?.combatRadiusMultiplier ?? 1));
  if (!Number.isFinite(maxFuelSec)) throw new Error(`Invalid endurance for platform ${platformId}`);

  return {
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
}
