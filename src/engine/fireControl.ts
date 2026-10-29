import type { EquipmentCatalog, GuidanceProfile, RuntimeUnit, RuntimeWeaponMount, TacticalContact, WeaponSpec } from '../types/wargame';
import { getDistanceKm } from './geometry';
import { getUnitCapabilities, isActiveUnit } from './unitCapabilities';

export function guidanceProfile(weapon: WeaponSpec): GuidanceProfile {
  const acoustic = weapon.guidance === 'acoustic_homing';
  const infrared = weapon.guidance === 'infrared';
  return {
    activationRangeKm: acoustic ? 10 : infrared ? 25 : 35,
    seekerRangeKm: acoustic ? 8 : infrared ? 20 : 30,
    seekerFovDeg: acoustic ? 120 : 90,
    searchDurationSec: acoustic ? 180 : 45,
    maxTrackAgeSec: 5,
    maxUncertaintyKm: acoustic ? 4 : 8,
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

export interface FireControlSolution {
  status: 'executable' | 'risky' | 'blocked';
  hardBlockReasons: string[];
  riskWarnings: string[];
  trackAgeSec?: number;
  distanceKm?: number;
  supportSourceIds: string[];
}

export function evaluateFireControl(
  attacker: RuntimeUnit, contact: TacticalContact | undefined, mount: RuntimeWeaponMount,
  weapon: WeaponSpec, catalog: EquipmentCatalog, units: Record<string, RuntimeUnit>,
  simTime: number, mode: 'manual' | 'automatic' | 'defense' = 'manual'
): FireControlSolution {
  const hardBlockReasons: string[] = [];
  const riskWarnings: string[] = [];
  const profile = guidanceProfile(weapon);
  const supportSourceIds = trackSupport(attacker, contact, weapon, units, catalog, simTime);
  if (!isActiveUnit(attacker) || !getUnitCapabilities(attacker).canFire) hardBlockReasons.push('平台已失去发射能力');
  if (mount.currentAmmo <= 0) hardBlockReasons.push('弹药耗尽');
  if (mount.cooldownRemainingSec > 0) hardBlockReasons.push(`挂架冷却中（${mount.cooldownRemainingSec.toFixed(1)} 秒）`);
  if (!contact || contact.observerSide !== attacker.side || contact.targetSide === attacker.side || contact.targetSide === 'NEUTRAL') {
    hardBlockReasons.push('没有本方可用的敌方情报接触');
  }
  let trackAgeSec: number | undefined;
  let distanceKm: number | undefined;
  if (contact) {
    distanceKm = getDistanceKm(attacker.position, contact.estimatedPosition);
    trackAgeSec = Math.max(0, (simTime - contact.lastDetectedTime) / 1000);
    if (!weapon.targetDomains.includes(contact.domain)) hardBlockReasons.push('武器与目标域不匹配');
    if (distanceKm > weapon.maxRangeKm || distanceKm < weapon.minRangeKm) hardBlockReasons.push('已知瞄准点不在武器射程内');
    if (trackAgeSec > profile.maxTrackAgeSec) riskWarnings.push(`情报已陈旧（${trackAgeSec.toFixed(1)} 秒未更新）`);
    if (contact.uncertaintyRadiusKm > profile.maxUncertaintyKm) riskWarnings.push(`定位误差 ±${contact.uncertaintyRadiusKm.toFixed(1)} km，存在搜索失败风险`);
    if (contact.classification === 'unknown') riskWarnings.push('目标尚未分类');
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
  return { status: hardBlockReasons.length ? 'blocked' : riskWarnings.length ? 'risky' : 'executable',
    hardBlockReasons, riskWarnings, distanceKm, trackAgeSec, supportSourceIds };
}
