import type { EquipmentCatalog, RuntimeUnit } from '../types/wargame';
import { resolveUnitConfiguration } from '../db/unitConfiguration';

export function isActiveUnit(unit: RuntimeUnit): boolean {
  return unit.hp > 0 && unit.status !== 'destroyed' && unit.status !== 'recovered';
}

// Deliberately coarse game profiles, not estimates of real equipment performance.
export function getUnitCapabilities(unit: RuntimeUnit) {
  const fraction = unit.hp / unit.maxHp;
  const disabledAt = unit.domain === 'land' ? 0.3 : unit.domain === 'air' ? 0.15 : 0.25;
  const disabled = !isActiveUnit(unit) || fraction <= disabledAt;
  const damaged = fraction <= 0.6;
  return {
    state: unit.status === 'recovered' ? 'recovered' as const : disabled ? 'mission_killed' as const : damaged ? 'damaged' as const : 'operational' as const,
    canFire: !disabled,
    radarFactor: disabled ? 0 : damaged ? 0.75 : 1,
    speedFactor: !isActiveUnit(unit) ? 0 : disabled ? 0.4 : damaged ? 0.75 : 1,
    reloadFactor: damaged ? 1.5 : 1,
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
