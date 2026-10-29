import * as turf from '@turf/turf';
import type { CombatLogEntry, EquipmentCatalog, MissionDefinition, RuntimeUnit, ScoreLedger, TacticalContact } from '../types/wargame';
import { resolveUnitConfiguration } from '../db/unitConfiguration';
import { getDistanceKm } from './geometry';
import { getUnitCapabilities, isActiveUnit } from './unitCapabilities';

export function effectiveDoctrine(unit: RuntimeUnit, missions: MissionDefinition[]) {
  const mission = missions.find((m) => m.id === unit.assignedMissionId && m.isActive);
  return { ...unit.doctrine, ...mission?.doctrineOverride };
}

export function recoverySolution(unit: RuntimeUnit, units: Record<string, RuntimeUnit>, catalog: EquipmentCatalog) {
  const config = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
  const hosts = Object.values(units).filter((candidate) => candidate.side === unit.side && isActiveUnit(candidate) &&
    candidate.hangar.some((slot) => slot.platformId === unit.platformId));
  const originalHost = unit.hostCarrierId ? units[unit.hostCarrierId] : undefined;
  const options = originalHost && hosts.includes(originalHost) ? [originalHost.position]
    : hosts.map((host) => host.position);
  // Aircraft that did not launch from a carrier can withdraw to their declared departure point.
  if (!unit.hostCarrierId && unit.recoveryPosition) options.push(unit.recoveryPosition);
  const position = options.sort((a, b) => getDistanceKm(unit.position, a) - getDistanceKm(unit.position, b))[0];
  const cruise = Math.max(1, config.cruiseSpeedKts * getUnitCapabilities(unit).speedFactor);
  const seconds = position ? getDistanceKm(unit.position, position) / (cruise * 1.852 / 3600) : Infinity;
  return { position, cruise, reserveSec: seconds + Math.max(60, unit.maxFuelSec * 0.05) };
}

export function updateUnitOperations(
  unit: RuntimeUnit, units: Record<string, RuntimeUnit>, contacts: Record<string, TacticalContact>,
  missions: MissionDefinition[], catalog: EquipmentCatalog, simTime: number, dtSec: number,
  score: ScoreLedger, logs: CombatLogEntry[]
) {
  const mission = missions.find((m) => m.id === unit.assignedMissionId && m.isActive);
  const domain = mission?.type === 'aaw_patrol' ? 'air' : mission?.type === 'asuw_patrol' ? 'surface'
    : mission?.type === 'asw_patrol' ? 'subsurface' : mission?.type === 'land_strike' ? 'land' : undefined;
  if (unit.domain === 'air') {
    const recovery = recoverySolution(unit, units, catalog);
    const combatMounts = domain ? unit.mounts.filter((m) => catalog.weapons[m.weaponId]?.targetDomains.includes(domain)) : [];
    const empty = combatMounts.length > 0 && combatMounts.every((m) => m.currentAmmo === 0);
    if (unit.status !== 'returning' && (unit.fuelRemainingSec <= recovery.reserveSec || empty)) {
      unit.status = 'returning';
      unit.returnReason = empty ? 'ammunition' : 'fuel';
      logs.push({ id: `rtb_${unit.id}_${simTime}`, simTime, side: unit.side, category: 'DOCTRINE', severity: 'warning',
        title: `${unit.callsign} 脱离返航`, message: `${empty ? '任务弹药耗尽' : '达到返航油量储备'}；${recovery.position ? '前往可用回收点。' : '没有可用回收点，需人工处置。'}`, unitId: unit.id });
    }
    if (unit.status === 'returning' && recovery.position) {
      unit.waypoints = [[...recovery.position]];
      unit.targetSpeedKts = recovery.cruise;
      unit.missionTargetId = undefined;
      if (getDistanceKm(unit.position, recovery.position) <= Math.max(0.5, recovery.cruise * 1.852 * dtSec / 3600)) {
        unit.position = [...recovery.position];
        unit.status = 'recovered';
        unit.speedKts = unit.targetSpeedKts = 0;
        unit.waypoints = [];
        logs.push({ id: `recovered_${unit.id}_${simTime}`, simTime, side: unit.side, category: 'EVENT', severity: 'info',
          title: `${unit.callsign} 已回收 / 撤出战区`, message: '本架次结束，不计战损；不自动补弹或生成新的出动库存。', unitId: unit.id });
        return;
      }
    }
    const cruise = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId).cruiseSpeedKts;
    const burnRate = Math.max(0.6, Math.pow(unit.speedKts / Math.max(1, cruise), 1.5));
    unit.fuelRemainingSec = Math.max(0, unit.fuelRemainingSec - dtSec * burnRate);
    if (unit.fuelRemainingSec <= 0) {
      unit.hp = 0; unit.status = 'destroyed'; unit.speedKts = unit.targetSpeedKts = 0;
      if (unit.side === 'RED') score.redLosses += 1;
      else if (unit.side === 'BLUE') score.blueLosses += 1;
      logs.push({ id: `fuel_loss_${unit.id}_${simTime}`, simTime, side: unit.side, category: 'DESTROYED', severity: 'critical',
        title: `${unit.callsign} 燃油耗尽`, message: '未到达回收点，平台失能并计入本方战损。', unitId: unit.id });
      return;
    }
  }

  if (unit.status === 'returning' || unit.navigationMode === 'manual') return;
  if (!mission || effectiveDoctrine(unit, missions).roe === 'hold') {
    if (unit.missionTargetId) unit.waypoints = [];
    unit.missionTargetId = undefined;
    return;
  }
  if (!domain || (unit.nextMissionDecisionTime ?? 0) > simTime) return;
  if (unit.waypoints.length && !unit.missionTargetId) return;
  unit.nextMissionDecisionTime = simTime + 5000;
  const area = turf.polygon([[...mission.areaPolygon, mission.areaPolygon[0]]]);
  const boundary = turf.lineString([...mission.areaPolygon, mission.areaPolygon[0]]);
  const candidates = Object.values(contacts).filter((contact) =>
    contact.observerSide === unit.side && contact.domain === domain && simTime - contact.lastDetectedTime <= 5000 &&
    (turf.booleanPointInPolygon(contact.estimatedPosition, area) || turf.pointToLineDistance(contact.estimatedPosition, boundary, { units: 'kilometers' }) <= mission.prosecuteOutsideAreaKm)
  ).sort((a, b) => getDistanceKm(unit.position, a.estimatedPosition) - getDistanceKm(unit.position, b.estimatedPosition) || a.id.localeCompare(b.id));
  const target = candidates.find((c) => c.id === unit.missionTargetId) ?? candidates[0];
  if (target) {
    const inFlight = Object.values(unit.weaponUsage).some((usage) => usage.cooldownUntil > simTime);
    if (!inFlight) { unit.missionTargetId = target.id; unit.waypoints = [[...target.estimatedPosition]]; }
    else { unit.missionTargetId = undefined; unit.waypoints = []; }
  } else if (unit.missionTargetId) {
    unit.missionTargetId = undefined;
    unit.waypoints = [];
  }
}
