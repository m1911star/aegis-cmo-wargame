import type { EquipmentCatalog, RuntimeUnit, UnitDoctrine, WeaponInFlight } from '../types/wargame';
import { resolveUnitConfiguration } from './unitConfiguration';

export const EMCON_BLINK_PERIOD_MS = 60_000;
export const EMCON_BLINK_ON_MS = 15_000;

export function computeUnitRadarBlinkOffsetMs(unitId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < unitId.length; i++) {
    hash ^= unitId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % EMCON_BLINK_PERIOD_MS;
}

export function isUnitRadarEmittingAtTime(
  unit: RuntimeUnit,
  simTime = 0,
  weaponsInFlight?: Record<string, WeaponInFlight>,
  catalog?: EquipmentCatalog,
  doctrineOverride?: Partial<UnitDoctrine>
): boolean {
  const emconRadar = doctrineOverride?.emconRadar ?? unit.doctrine.emconRadar;
  const intermittent =
    doctrineOverride?.emconRadarIntermittent ?? unit.doctrine.emconRadarIntermittent;
  if (!intermittent) return Boolean(emconRadar);

  if (weaponsInFlight && catalog) {
    for (const missile of Object.values(weaponsInFlight)) {
      if (missile.shooterId !== unit.id || missile.isIntercepted) continue;
      if (catalog.weapons[missile.weaponId]?.guidance === 'semi_active_radar') {
        return true;
      }
    }
  }
  const offset = computeUnitRadarBlinkOffsetMs(unit.id);
  const phase =
    (((simTime + offset) % EMCON_BLINK_PERIOD_MS) + EMCON_BLINK_PERIOD_MS) %
    EMCON_BLINK_PERIOD_MS;
  return phase < EMCON_BLINK_ON_MS;
}

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

  const active = isActiveUnit(unit);
  const hpDisabled = !active || fraction <= disabledAt;
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
  const radarFactor = baseRadar === 0 || sensorMod === 1 ? baseRadar : Number((baseRadar * sensorMod).toFixed(3));
  const sonarFactor = disabled || sensorsInt <= 0.2 ? 0 : sensorMod === 1 ? 1 : Number(sensorMod.toFixed(3));

  const baseSpeed = !active ? 0 : disabled ? 0.4 : fraction <= 0.6 ? 0.75 : 1;
  const propMod =
    (propInt < 0.65 ? Math.max(0.2, propInt / 0.65) : 1) *
    (floodSev > 0.15 ? Math.max(0.25, 1 - floodSev * 0.65) : 1);
  const speedFactor = baseSpeed === 0 || propMod === 1 ? baseSpeed : Number((baseSpeed * propMod).toFixed(3));

  const weapReloadMod = weapInt < 0.65 ? 1 + (0.65 - weapInt) * 1.2 : 1;
  const baseReload = fraction <= 0.6 ? 1.5 : 1;
  const reloadFactor = weapReloadMod === 1 ? baseReload : Number((baseReload * weapReloadMod).toFixed(2));

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

export function isRadioEmitting(
  unit: RuntimeUnit,
  catalog: EquipmentCatalog,
  simTime = 0,
  weaponsInFlight?: Record<string, WeaponInFlight>
): boolean {
  if (!isActiveUnit(unit) || !getUnitCapabilities(unit).radarFactor) return false;
  const radarOn = isUnitRadarEmittingAtTime(unit, simTime, weaponsInFlight, catalog);
  const config = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
  return (unit.doctrine.emconJamming && (config.platform.ecmStrength ?? 0) > 0) || config.sensorIds.some((id) => {
    const type = catalog.sensors[id]?.type;
    return (radarOn && (type === 'radar_air_surface' || type === 'radar_oth')) ||
      (unit.doctrine.emconJamming && type === 'ecm_jammer');
  });
}
