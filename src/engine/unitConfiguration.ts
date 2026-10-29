import type { EquipmentCatalog, RuntimeUnit, RuntimeWeaponMount } from '../types/wargame';
import type { ResolvedUnitConfiguration } from '../db/unitConfiguration';
import { getUnitCapabilities } from './unitCapabilities';

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
