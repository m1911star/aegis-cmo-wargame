import type { EquipmentCatalog, GuidanceProfile, PlatformSpec, RuntimeUnit, RuntimeWeaponMount, TacticalContact, WeaponInFlight, WeaponSpec } from '../types/wargame';
import { getDistanceKm } from './geometry';
import { getUnitCapabilities, isActiveUnit } from './unitCapabilities';
import { GUIDANCE_DEFAULTS } from './constants';

export function resolveMaxGuidanceChannels(platform: PlatformSpec | undefined): number {
  if (!platform) return 8;
  if (platform.maxGuidanceChannels !== undefined) return platform.maxGuidanceChannels;
  switch (platform.category) {
    case 'destroyer':
      return platform.id === 'type055_destroyer' ? 20 : platform.id === 'arleigh_burke_flt3' ? 18 : 12;
    case 'carrier':
    case 'airbase':
    case 'sam_battery':
      return 12;
    case 'frigate':
    case 'amphibious':
      return 8;
    case 'stealth_fighter':
    case 'fighter':
      return platform.id === 'j10c_multirole' ? 4 : 6;
    case 'bomber':
    case 'asm_battery':
    case 'ssn':
    case 'ground_force':
      return 8;
    default:
      return 4;
  }
}

export function weaponUsesGuidanceChannel(weapon: WeaponSpec): boolean {
  const profile = guidanceProfile(weapon);
  return profile.requiresSupport || profile.receivesUpdates;
}

export function countActiveGuidanceChannels(
  shooterId: string,
  weaponsInFlight: Record<string, WeaponInFlight> | undefined,
  catalog: EquipmentCatalog
): number {
  if (!weaponsInFlight) return 0;
  let active = 0;
  for (const missile of Object.values(weaponsInFlight)) {
    if (missile.shooterId !== shooterId || missile.isIntercepted) continue;
    const w = catalog.weapons[missile.weaponId];
    if (!w || !weaponUsesGuidanceChannel(w)) continue;
    const holdsUntilImpact = guidanceProfile(w).requiresSupport;
    const inMidcourse = !missile.seekerState || missile.seekerState.startsWith('midcourse');
    if (holdsUntilImpact || inMidcourse) {
      active += 1;
    }
  }
  return active;
}

export function guidanceProfile(weapon: WeaponSpec): GuidanceProfile {
  const acoustic = weapon.guidance === 'acoustic_homing';
  const infrared = weapon.guidance === 'infrared';
  return {
    activationRangeKm: acoustic
      ? GUIDANCE_DEFAULTS.ACOUSTIC_ACTIVATION_RANGE
      : infrared
        ? GUIDANCE_DEFAULTS.INFRARED_ACTIVATION_RANGE
        : GUIDANCE_DEFAULTS.ACTIVE_RADAR_ACTIVATION_RANGE,
    seekerRangeKm: acoustic
      ? GUIDANCE_DEFAULTS.ACOUSTIC_SEEKER_RANGE
      : infrared
        ? GUIDANCE_DEFAULTS.INFRARED_SEEKER_RANGE
        : GUIDANCE_DEFAULTS.ACTIVE_RADAR_SEEKER_RANGE,
    seekerFovDeg: acoustic
      ? GUIDANCE_DEFAULTS.ACOUSTIC_FOV
      : GUIDANCE_DEFAULTS.DEFAULT_FOV,
    searchDurationSec: acoustic
      ? GUIDANCE_DEFAULTS.ACOUSTIC_SEARCH_DURATION
      : GUIDANCE_DEFAULTS.DEFAULT_SEARCH_DURATION,
    maxTrackAgeSec: GUIDANCE_DEFAULTS.MAX_TRACK_AGE,
    maxUncertaintyKm: acoustic
      ? GUIDANCE_DEFAULTS.ACOUSTIC_MAX_UNCERTAINTY
      : GUIDANCE_DEFAULTS.DEFAULT_MAX_UNCERTAINTY,
    receivesUpdates: !acoustic && !infrared && weapon.guidance !== 'anti_radiation',
    requiresSupport: weapon.guidance === 'semi_active_radar',
    ...weapon.guidanceProfile,
  };
}

export function trackSupport(
  attacker: RuntimeUnit, contact: TacticalContact | undefined, weapon: WeaponSpec,
  units: Record<string, RuntimeUnit>, catalog: EquipmentCatalog, simTime: number
) {
  const profile = guidanceProfile(weapon);
  if (!contact || contact.observerSide !== attacker.side ||
      simTime - contact.lastDetectedTime > profile.maxTrackAgeSec * 1000 ||
      contact.uncertaintyRadiusKm > profile.maxUncertaintyKm) return [];
  const ids = profile.requiresSupport ? contact.fireControlSourceIds : contact.sourceUnitIds;
  return (ids ?? []).filter((id) => {
    const source = units[id];
    if (!source || !isActiveUnit(source) || source.side !== attacker.side) return false;
    if (profile.requiresSupport && (!source.doctrine.emconRadar || !getUnitCapabilities(source).radarFactor)) return false;
    return id === attacker.id ||
      (catalog.platforms[attacker.platformId]?.hasDatalink && catalog.platforms[source.platformId]?.hasDatalink);
  });
}

export function computeStrikeRouteDistanceKm(
  origin: [number, number],
  aimpoint: [number, number],
  doglegWaypoints?: readonly [number, number][]
): number {
  if (!doglegWaypoints || doglegWaypoints.length === 0) {
    return getDistanceKm(origin, aimpoint);
  }
  let total = 0;
  let prev = origin;
  for (const wp of doglegWaypoints) {
    total += getDistanceKm(prev, wp);
    prev = wp;
  }
  total += getDistanceKm(prev, aimpoint);
  return total;
}

export function weaponLaunchRangeKm(weapon: WeaponSpec): number {
  return weapon.launchMedium === 'air_drop' ? weapon.airDropRangeKm ?? 0 : weapon.maxRangeKm;
}

export function weaponNoEscapeRangeKm(weapon: WeaponSpec): number {
  const launchMax = weaponLaunchRangeKm(weapon);
  if (!Number.isFinite(launchMax) || launchMax <= 0) return 0;
  const factor = weapon.launchMedium === 'air_drop' ? 0.65 : 0.55;
  return Number(Math.max(weapon.minRangeKm, launchMax * factor).toFixed(1));
}

export function estimateWeaponTimeOfFlightSec(distanceKm: number, weapon: WeaponSpec): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  if (weapon.launchMedium === 'air_drop') {
    const dropSpeedKmph = Math.max(50, weapon.airDropSpeedKts ?? weapon.speedKts) * 1.852;
    return Math.max(1, Math.round((distanceKm / dropSpeedKmph) * 3600 + 8));
  }
  const baseSpeedKmph = Math.max(50, weapon.speedKts) * 1.852;
  const nezKm = weapon.maxRangeKm * 0.55;
  if (distanceKm <= nezKm || weapon.maxRangeKm <= 0) {
    return Math.max(1, Math.round((distanceKm / baseSpeedKmph) * 3600));
  }
  const boostSec = (nezKm / baseSpeedKmph) * 3600;
  const tailKm = distanceKm - nezKm;
  const ratio = Math.min(1, distanceKm / weapon.maxRangeKm);
  const endFactor = Math.max(0.55, 1 - ((ratio - 0.55) / 0.45) * 0.45);
  const avgTailFactor = (1 + endFactor) * 0.5;
  const tailSec = (tailKm / (baseSpeedKmph * avgTailFactor)) * 3600;
  return Math.max(1, Math.round(boostSec + tailSec));
}

export interface FireControlSolution {
  status: 'executable' | 'risky' | 'blocked';
  hardBlockReasons: string[];
  riskWarnings: string[];
  trackAgeSec?: number;
  distanceKm?: number;
  nezRangeKm?: number;
  withinNez?: boolean;
  estimatedTofSec?: number;
  activeChannels?: number;
  maxChannels?: number;
  supportSourceIds: string[];
}

export function evaluateFireControl(
  attacker: RuntimeUnit, contact: TacticalContact | undefined, mount: RuntimeWeaponMount,
  weapon: WeaponSpec, catalog: EquipmentCatalog, units: Record<string, RuntimeUnit>,
  simTime: number, mode: 'manual' | 'automatic' | 'defense' = 'manual',
  weaponsInFlight?: Record<string, WeaponInFlight>,
  doglegWaypoints?: readonly [number, number][]
): FireControlSolution {
  const hardBlockReasons: string[] = [];
  const riskWarnings: string[] = [];
  const profile = guidanceProfile(weapon);
  const supportSourceIds = trackSupport(attacker, contact, weapon, units, catalog, simTime);
  const maxChannels = resolveMaxGuidanceChannels(catalog.platforms[attacker.platformId]);
  const activeChannels = countActiveGuidanceChannels(attacker.id, weaponsInFlight, catalog);
  const availableChannels = Math.max(0, maxChannels - activeChannels);
  if (!isActiveUnit(attacker) || !getUnitCapabilities(attacker).canFire) hardBlockReasons.push('平台已失去发射能力');
  if (attacker.domain === 'air' && weapon.category === 'torpedo' && weapon.launchMedium !== 'air_drop') {
    hardBlockReasons.push('航空平台不能投放重型直射鱼雷');
  }
  if (attacker.domain !== 'air' && weapon.launchMedium === 'air_drop') {
    hardBlockReasons.push('空投轻型鱼雷需要航空平台');
  }
  if (mount.currentAmmo <= 0) hardBlockReasons.push('弹药耗尽');
  if (mount.cooldownRemainingSec > 0) hardBlockReasons.push(`挂架冷却中（${mount.cooldownRemainingSec.toFixed(1)} 秒）`);
  if (!contact || contact.observerSide !== attacker.side || contact.targetSide === attacker.side || contact.targetSide === 'NEUTRAL') {
    hardBlockReasons.push('没有本方可用的敌方情报接触');
  }
  let trackAgeSec: number | undefined;
  let distanceKm: number | undefined;
  const nezRangeKm = weaponNoEscapeRangeKm(weapon);
  let withinNez: boolean | undefined;
  let estimatedTofSec: number | undefined;
  if (contact) {
    distanceKm = computeStrikeRouteDistanceKm(attacker.position, contact.estimatedPosition, doglegWaypoints);
    trackAgeSec = Math.max(0, (simTime - contact.lastDetectedTime) / 1000);
    withinNez = distanceKm >= weapon.minRangeKm && distanceKm <= nezRangeKm;
    estimatedTofSec = estimateWeaponTimeOfFlightSec(distanceKm, weapon);
    if (!weapon.targetDomains.includes(contact.domain)) hardBlockReasons.push('武器与目标域不匹配');
    if (weapon.interceptAltitudeBandM && contact.domain === 'air') {
      const [minAlt, maxAlt] = weapon.interceptAltitudeBandM;
      if (contact.altitudeM < minAlt || contact.altitudeM > maxAlt) {
        hardBlockReasons.push(
          `目标高度 (${Math.round(contact.altitudeM)}m) 超出拦截射高包线 [${minAlt}m~${maxAlt}m]`
        );
      }
    }
    if (doglegWaypoints && doglegWaypoints.length > 0 && weapon.launchMedium === 'air_drop') {
      hardBlockReasons.push('空投鱼雷不支持中段转折航点规划');
    }
    if (distanceKm > weaponLaunchRangeKm(weapon) || distanceKm < weapon.minRangeKm) {
      hardBlockReasons.push(
        doglegWaypoints && doglegWaypoints.length > 0
          ? `转折航路总长 (${distanceKm.toFixed(1)} km) 超出武器最大射程`
          : '已知瞄准点不在武器射程内'
      );
    }
    if (trackAgeSec > profile.maxTrackAgeSec) riskWarnings.push(`情报已陈旧（${trackAgeSec.toFixed(1)} 秒未更新）`);
    if (contact.uncertaintyRadiusKm > profile.maxUncertaintyKm) riskWarnings.push(`定位误差 ±${contact.uncertaintyRadiusKm.toFixed(1)} km，存在搜索失败风险`);
    if (contact.classification === 'unknown') riskWarnings.push('目标尚未分类');
  }
  if (weaponUsesGuidanceChannel(weapon) && availableChannels <= 0) {
    if (profile.requiresSupport || mode !== 'manual') {
      hardBlockReasons.push(`平台火控/制导通道已饱和 (${activeChannels}/${maxChannels})`);
    } else {
      riskWarnings.push(`本平台制导通道已满 (${activeChannels}/${maxChannels})，导弹将以无本机中继盲飞发射`);
    }
  }
  if (profile.requiresSupport && supportSourceIds.length === 0) hardBlockReasons.push('该制导方式必须获得持续火控支援');
  else if (profile.receivesUpdates && supportSourceIds.length === 0) riskWarnings.push('无有效中继，将依靠最后已知信息飞行');
  if (attacker.doctrine.roe === 'hold') riskWarnings.push('本次人工授权覆盖停止自动开火条令');
  if (mode !== 'manual' && (attacker.doctrine.roe === 'hold' || (mode === 'automatic' && attacker.doctrine.roe !== 'free'))) {
    hardBlockReasons.push('当前条令不允许自动开火');
  }
  if (mode === 'automatic' && (!attacker.doctrine.engageOpportunityTargets || attacker.status === 'returning')) {
    hardBlockReasons.push('未获自动进攻授权');
  }
  if (mode === 'automatic' && contact?.identifiedCategory === 'sonobuoy') {
    hardBlockReasons.push('声呐浮标不作为自动火力打击目标');
  }
  if (mode === 'automatic' && attacker.doctrine.requireIdentifiedForAutoFire && contact && contact.classification !== 'identified') {
    hardBlockReasons.push('条令要求识别目标后方可自动开火');
  }
  return { status: hardBlockReasons.length ? 'blocked' : riskWarnings.length ? 'risky' : 'executable',
    hardBlockReasons, riskWarnings, distanceKm, trackAgeSec, nezRangeKm, withinNez, estimatedTofSec,
    activeChannels, maxChannels, supportSourceIds };
}
