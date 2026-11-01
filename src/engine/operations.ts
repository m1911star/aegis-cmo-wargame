import * as turf from '@turf/turf';
import type { CombatLogEntry, EquipmentCatalog, MissionDefinition, RuntimeHangarSlot, RuntimeUnit, ScoreLedger, TacticalContact } from '../types/wargame';
import { resolveUnitConfiguration } from '../db/unitConfiguration';
import { getDistanceKm } from './geometry';
import { getUnitCapabilities, isActiveUnit } from './unitCapabilities';

export function effectiveDoctrine(unit: RuntimeUnit, missions: MissionDefinition[]) {
  const mission = missions.find((m) => m.id === unit.assignedMissionId && m.isActive);
  return { ...unit.doctrine, ...mission?.doctrineOverride };
}

export function recoverySolution(unit: RuntimeUnit, units: Record<string, RuntimeUnit>, catalog: EquipmentCatalog) {
  const config = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
  const compatible = Object.values(units)
    .filter((candidate) => candidate.side === unit.side && isActiveUnit(candidate))
    .flatMap((host) => host.hangar
      .filter((slot) => slot.platformId === unit.platformId)
      .map((slot) => ({ position: host.position, hostId: host.id, slotId: slot.slotId })));
  const original = unit.hostCarrierId
    ? compatible.filter((option) => option.hostId === unit.hostCarrierId &&
      (!unit.hostHangarSlotId || option.slotId === unit.hostHangarSlotId))
    : [];
  const options: Array<{ position: [number, number]; hostId?: string; slotId?: string }> =
    original.length > 0 ? original : [...compatible];
  // Aircraft that did not launch from a carrier can withdraw to their declared departure point.
  if (!unit.hostCarrierId && unit.recoveryPosition) options.push({ position: unit.recoveryPosition });
  const recovery = options.sort((a, b) =>
    getDistanceKm(unit.position, a.position) - getDistanceKm(unit.position, b.position) ||
    (a.hostId ?? '').localeCompare(b.hostId ?? '') || (a.slotId ?? '').localeCompare(b.slotId ?? '')
  )[0];
  const cruise = Math.max(1, config.cruiseSpeedKts * getUnitCapabilities(unit).speedFactor);
  const seconds = recovery ? getDistanceKm(unit.position, recovery.position) / (cruise * 1.852 / 3600) : Infinity;
  return { ...recovery, cruise, reserveSec: seconds + Math.max(60, unit.maxFuelSec * 0.05) };
}

function enqueueRecoveredSortie(
  unit: RuntimeUnit,
  units: Record<string, RuntimeUnit>,
  hostId: string,
  slotId: string,
  simTime: number
): RuntimeHangarSlot | undefined {
  if (!unit.hostCarrierId || !unit.hostHangarSlotId) return undefined;
  const sourceSlot = units[unit.hostCarrierId]?.hangar.find((slot) => slot.slotId === unit.hostHangarSlotId);
  const targetSlot = units[hostId]?.hangar.find((slot) => slot.slotId === slotId);
  if (!sourceSlot || !targetSlot || !sourceSlot.activeSortieIds.includes(unit.id) ||
      targetSlot.turnaroundQueue.some((entry) => entry.sortieId === unit.id)) return undefined;

  sourceSlot.activeSortieIds = sourceSlot.activeSortieIds.filter((id) => id !== unit.id);
  if (sourceSlot !== targetSlot) {
    sourceSlot.totalAirframes = Math.max(0, sourceSlot.totalAirframes - 1);
    targetSlot.totalAirframes += 1;
  }
  targetSlot.turnaroundQueue.push({
    sortieId: unit.id,
    previousLoadoutId: unit.activeLoadoutId,
    readyAtSimTime: simTime + targetSlot.turnaroundSec * 1000,
  });
  targetSlot.turnaroundQueue.sort((a, b) => a.readyAtSimTime - b.readyAtSimTime || a.sortieId.localeCompare(b.sortieId));
  return targetSlot;
}

export function updateUnitOperations(
  unit: RuntimeUnit, units: Record<string, RuntimeUnit>, contacts: Record<string, TacticalContact>,
  missions: MissionDefinition[], catalog: EquipmentCatalog, simTime: number, dtSec: number,
  score: ScoreLedger, logs: CombatLogEntry[]
) {
  const mission = missions.find((m) => m.id === unit.assignedMissionId && m.isActive);
  const targetDomains: RuntimeUnit['domain'][] = mission?.type === 'aaw_patrol' ? ['air']
    : mission?.type === 'asuw_patrol' ? ['surface']
    : mission?.type === 'asw_patrol' ? ['subsurface']
    : mission?.type === 'land_strike' ? ['land']
    : mission?.type === 'sead' ? ['surface', 'land'] : [];
  if (unit.domain === 'air') {
    if (unit.category !== 'decoy') {
      const recovery = recoverySolution(unit, units, catalog);
    const combatMounts = targetDomains.length > 0
      ? unit.mounts.filter((mount) => targetDomains.some((domain) => catalog.weapons[mount.weaponId]?.targetDomains.includes(domain)))
      : [];
    const empty = combatMounts.length > 0 && combatMounts.every((mount) => mount.currentAmmo === 0);
    if (unit.status !== 'returning' && (unit.fuelRemainingSec <= recovery.reserveSec || empty)) {
      unit.status = 'returning';
      unit.missionState = 'egress';
      unit.returnReason = empty ? 'ammunition' : 'fuel';
      logs.push({ id: `rtb_${unit.id}_${simTime}`, simTime, side: unit.side, category: 'DOCTRINE', severity: 'warning',
        title: `${unit.callsign} 脱离返航`, message: `${empty ? '任务弹药耗尽' : '达到返航油量储备'}；${recovery.position ? '前往可用回收点。' : '没有可用回收点，需人工处置。'}`, unitId: unit.id });
    }
    if (unit.status === 'returning' && recovery.position) {
      unit.waypoints = [{ position: [...recovery.position] }];
      unit.targetSpeedKts = recovery.cruise;
      unit.missionTargetId = undefined;
      if (getDistanceKm(unit.position, recovery.position) <= Math.max(0.5, recovery.cruise * 1.852 * dtSec / 3600)) {
        unit.position = [...recovery.position];
        unit.status = 'recovered';
        unit.missionState = 'recovering';
        unit.speedKts = unit.targetSpeedKts = 0;
        unit.waypoints = [];
        const turnaround = recovery.hostId && recovery.slotId
          ? enqueueRecoveredSortie(unit, units, recovery.hostId, recovery.slotId, simTime)
          : undefined;
        logs.push({ id: `recovered_${unit.id}_${simTime}`, simTime, side: unit.side, category: 'EVENT', severity: 'info',
          title: `${unit.callsign} 已回收 / 撤出战区`,
          message: turnaround
            ? `本架次结束并进入 ${turnaround.turnaroundSec} 秒整备队列；剩余补给 ${turnaround.turnaroundSupplies} 批。`
            : '本架次结束，不计战损；该回收点不提供再次出动整备。',
          unitId: unit.id, aarType: 'recovery' });
        return;
      }
    }
    }
    const cruise = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId).cruiseSpeedKts;
    const burnRate = Math.max(0.6, Math.pow(unit.speedKts / Math.max(1, cruise), 1.5));
    unit.fuelRemainingSec = Math.max(0, unit.fuelRemainingSec - dtSec * burnRate);
    if (unit.fuelRemainingSec <= 0) {
      unit.hp = 0; unit.status = 'destroyed'; unit.speedKts = unit.targetSpeedKts = 0;
      if (unit.category !== 'decoy') {
        if (unit.side === 'RED') score.redLosses += 1;
        else if (unit.side === 'BLUE') score.blueLosses += 1;
      }
      logs.push({ id: `fuel_loss_${unit.id}_${simTime}`, simTime, side: unit.side,
        category: unit.category === 'decoy' ? 'EVENT' : 'DESTROYED',
        severity: unit.category === 'decoy' ? 'info' : 'critical',
        title: `${unit.callsign} ${unit.category === 'decoy' ? '诱饵任务结束' : '燃油耗尽'}`,
        message: unit.category === 'decoy' ? '诱饵燃油耗尽并退出战场。' : '未到达回收点，平台失能并计入本方战损。',
        unitId: unit.id });
      return;
    }
  }

  if (unit.status === 'returning' || unit.navigationMode !== 'mission') return;
  if (!mission) {
    if (unit.missionTargetId) unit.waypoints = [];
    unit.missionTargetId = undefined;
    unit.missionState = undefined;
    return;
  }
  if (effectiveDoctrine(unit, missions).roe === 'hold') {
    if (unit.missionTargetId) unit.waypoints = [];
    unit.missionTargetId = undefined;
    unit.missionState = 'on_station';
    return;
  }
  if (mission.type === 'aew_support' || mission.type === 'tanker_support') {
    unit.missionTargetId = undefined;
    unit.missionState ??= 'ingress';
    return;
  }
  if ((unit.nextMissionDecisionTime ?? 0) > simTime) return;
  if (unit.waypoints.length && !unit.missionTargetId) return;
  unit.nextMissionDecisionTime = simTime + 5000;
  const area = turf.polygon([[...mission.areaPolygon, mission.areaPolygon[0]]]);
  const boundary = turf.lineString([...mission.areaPolygon, mission.areaPolygon[0]]);

  if (mission.type === 'escort') {
    const protectedUnit = mission.escortUnitId ? units[mission.escortUnitId] : undefined;
    if (!protectedUnit || protectedUnit.side !== unit.side || !isActiveUnit(protectedUnit)) {
      unit.missionTargetId = undefined;
      unit.missionState = 'egress';
      unit.waypoints = mission.areaPolygon[0] ? [{ position: [...mission.areaPolygon[0]] }] : [];
      return;
    }
    const stationRadiusKm = mission.stationRadiusKm ?? 20;
    const threatRadiusKm = Math.max(stationRadiusKm, mission.prosecuteOutsideAreaKm);
    const threats = Object.values(contacts).filter((contact) =>
      contact.observerSide === unit.side && ['air', 'surface'].includes(contact.domain) &&
      simTime - contact.lastDetectedTime <= 5000 &&
      getDistanceKm(protectedUnit.position, contact.estimatedPosition) <= threatRadiusKm
    ).sort((a, b) => getDistanceKm(unit.position, a.estimatedPosition) - getDistanceKm(unit.position, b.estimatedPosition) || a.id.localeCompare(b.id));
    const threat = threats.find((contact) => contact.id === unit.missionTargetId) ?? threats[0];
    if (threat) {
      unit.missionTargetId = threat.id;
      unit.missionState = 'engaging';
      unit.waypoints = [{ position: [...threat.estimatedPosition] }];
      return;
    }
    const wasEngaging = unit.missionState === 'engaging' || !!unit.missionTargetId;
    unit.missionTargetId = undefined;
    const separationKm = getDistanceKm(unit.position, protectedUnit.position);
    unit.missionState = wasEngaging ? 'egress' : separationKm > stationRadiusKm ? 'ingress' : 'on_station';
    unit.waypoints = separationKm > Math.max(2, stationRadiusKm * 0.25)
      ? [{ position: [...protectedUnit.position] }] : [];
    return;
  }

  if (targetDomains.length === 0) return;
  const candidates = Object.values(contacts).filter((contact) =>
    contact.observerSide === unit.side && targetDomains.includes(contact.domain) &&
    (mission.type !== 'sead' || contact.emitterObserved === true) &&
    simTime - contact.lastDetectedTime <= 5000 &&
    (turf.booleanPointInPolygon(contact.estimatedPosition, area) ||
      turf.pointToLineDistance(contact.estimatedPosition, boundary, { units: 'kilometers' }) <= mission.prosecuteOutsideAreaKm)
  ).sort((a, b) => getDistanceKm(unit.position, a.estimatedPosition) - getDistanceKm(unit.position, b.estimatedPosition) || a.id.localeCompare(b.id));
  const target = candidates.find((contact) => contact.id === unit.missionTargetId) ?? candidates[0];
  if (target) {
    const inFlight = Object.values(unit.weaponUsage).some((usage) => usage.cooldownUntil > simTime);
    if (!inFlight) {
      unit.missionTargetId = target.id;
      unit.missionState = 'engaging';
      unit.waypoints = [{ position: [...target.estimatedPosition] }];
    } else {
      unit.missionTargetId = undefined;
      unit.missionState = 'egress';
      unit.waypoints = [];
    }
  } else {
    const wasEngaging = unit.missionState === 'engaging' || !!unit.missionTargetId;
    unit.missionTargetId = undefined;
    unit.waypoints = [];
    unit.missionState = wasEngaging ? 'egress'
      : turf.booleanPointInPolygon(unit.position, area) ? 'on_station' : 'ingress';
  }
}
