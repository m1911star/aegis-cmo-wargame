import type { EquipmentCatalog, RuntimeUnit } from '../types/wargame';
import { resolveUnitConfiguration } from './unitConfiguration';

export function isActiveUnit(unit: RuntimeUnit): boolean {
  return unit.hp > 0 && unit.status !== 'destroyed' && unit.status !== 'recovered';
}

export function compareRuntimeUnits(a: RuntimeUnit, b: RuntimeUnit): number {
  const orderA = a.spawnOrder ?? 1_000_000_000;
  const orderB = b.spawnOrder ?? 1_000_000_000;
  return orderA - orderB || a.id.localeCompare(b.id);
}

// Deliberately coarse game profiles enhanced with subsystem integrity & fire/flooding modifiers.
export function getUnitCapabilities(unit: RuntimeUnit) {
  const fraction = unit.hp / unit.maxHp;
  const disabledAt = unit.domain === 'land' ? 0.3 : unit.domain === 'air' ? 0.15 : 0.25;
  const sub = unit.subsystems;
  const sensorsInt = sub?.sensors ?? 1;
  const propInt = sub?.propulsion ?? 1;
  const weapInt = sub?.weapons ?? 1;
  const fireSev = sub?.fire ?? 0;
  const floodSev = sub?.flooding ?? 0;

  const hpDisabled = !isActiveUnit(unit) || fraction <= disabledAt;
  const radarSiteBlinded = unit.category === 'radar_site' && sensorsInt <= 0.2;
  const airbaseRunwayCratered = unit.category === 'airbase' && weapInt <= 0.22;
  const disabled = hpDisabled || radarSiteBlinded || airbaseRunwayCratered;
  const hasSubDamage =
    sensorsInt < 0.65 || propInt < 0.65 || weapInt < 0.65 || fireSev >= 0.35 || floodSev > 0.15;
  const damaged = fraction <= 0.6 || hasSubDamage;

  const canFire = !disabled && weapInt > 0.2;
  const canLaunchAircraft = canFire && fireSev < 0.35;

  const baseRadar = disabled || sensorsInt <= 0.2 ? 0 : fraction <= 0.6 ? 0.75 : 1;
  const sensorMod = sensorsInt <= 0.2 ? 0 : sensorsInt < 0.65 ? sensorsInt / 0.65 : 1;
  const radarFactor = Number((baseRadar * sensorMod).toFixed(3));
  const sonarFactor = disabled || sensorsInt <= 0.2 ? 0 : Number(sensorMod.toFixed(3));

  const baseSpeed = !isActiveUnit(unit) ? 0 : disabled ? 0.4 : fraction <= 0.6 ? 0.75 : 1;
  const propMod =
    (propInt < 0.65 ? Math.max(0.2, propInt / 0.65) : 1) *
    (floodSev > 0.15 ? Math.max(0.25, 1 - floodSev * 0.65) : 1);
  const speedFactor =
    !isActiveUnit(unit) || baseSpeed === 0 ? 0 : Number((baseSpeed * propMod).toFixed(3));

  const weapReloadMod = weapInt < 0.65 ? 1 + (0.65 - weapInt) * 1.2 : 1;
  const reloadFactor = Number(((fraction <= 0.6 ? 1.5 : 1) * weapReloadMod).toFixed(2));

  return {
    state:
      unit.status === 'recovered'
        ? ('recovered' as const)
        : disabled
          ? ('mission_killed' as const)
          : damaged
            ? ('damaged' as const)
            : ('operational' as const),
    canFire,
    canLaunchAircraft,
    radarFactor,
    sonarFactor,
    speedFactor,
    reloadFactor,
  };
}

export function isRadioEmitting(unit: RuntimeUnit, catalog: EquipmentCatalog): boolean {
  if (!isActiveUnit(unit) || !getUnitCapabilities(unit).radarFactor) return false;
  const config = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
  return (unit.doctrine.emconJamming && (config.platform.ecmStrength ?? 0) > 0) || config.sensorIds.some((id) => {
    const type = catalog.sensors[id]?.type;
    return (unit.doctrine.emconRadar && (type === 'radar_air_surface' || type === 'radar_oth')) ||
      (unit.doctrine.emconJamming && type === 'ecm_jammer');
  });
}
