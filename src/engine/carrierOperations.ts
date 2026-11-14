import type {
  CombatLogEntry,
  EquipmentCatalog,
  PendingSortieOrder,
  RuntimeUnit,
  ScoreLedger,
  TacticalMission,
} from '../types/wargame';
import { createRuntimeUnitFromPlacement } from './simulation/unitFactory';
import { getUnitCapabilities, isActiveUnit } from './unitCapabilities';

export type SortieAvailability = { status: 'ready' | 'temporary' | 'permanent'; reason: string };

export function evaluateCarrierSortieAvailability(
  units: Record<string, RuntimeUnit>,
  catalog: EquipmentCatalog,
  carrierUnitId: string,
  hangarSlotId: string,
  requestedLoadoutId?: string
): SortieAvailability {
  const carrier = units[carrierUnitId];
  if (!carrier) return { status: 'permanent', reason: '母舰不存在' };
  if (!isActiveUnit(carrier) || !getUnitCapabilities(carrier).canFire) {
    return { status: 'permanent', reason: '母舰已失能，无法执行出动' };
  }
  const slot = carrier.hangar.find((candidate) => candidate.slotId === hangarSlotId);
  if (!slot) return { status: 'permanent', reason: '机库槽位不存在' };
  const airSpec = catalog.platforms[slot.platformId];
  if (!airSpec) return { status: 'permanent', reason: '舰载平台不存在' };
  const loadoutId = requestedLoadoutId || slot.selectedLoadoutId;
  const loadout = catalog.loadouts[loadoutId];
  if (!slot.availableLoadoutIds.includes(loadoutId) || !loadout?.compatiblePlatformIds.includes(slot.platformId)) {
    return { status: 'permanent', reason: '挂载与机库槽位不兼容' };
  }
  if (slot.readyAirframes > 0 && slot.cooldownRemainingSec <= 0) {
    return { status: 'ready', reason: '甲板与库存就绪' };
  }
  if (slot.cooldownRemainingSec > 0) return { status: 'temporary', reason: '甲板冷却中' };
  if (slot.reserveAirframes > 0 || slot.turnaroundQueue.length > 0 ||
      (slot.activeSortieIds.length > 0 && slot.turnaroundSupplies > 0)) {
    return { status: 'temporary', reason: '等待机体整备或回收' };
  }
  return { status: 'permanent', reason: '机体库存永久耗尽' };
}

/** Mutate one cloned world/store unit dictionary by launching a finite hangar sortie. */
export function launchCarrierSortie(
  units: Record<string, RuntimeUnit>,
  catalog: EquipmentCatalog,
  carrierUnitId: string,
  hangarSlotId: string,
  requestedLoadoutId?: string
): RuntimeUnit | undefined {
  const carrier = units[carrierUnitId];
  if (!carrier || !isActiveUnit(carrier) || !getUnitCapabilities(carrier).canFire) return undefined;
  const slot = carrier.hangar.find((candidate) => candidate.slotId === hangarSlotId);
  if (!slot || slot.readyAirframes <= 0 || slot.cooldownRemainingSec > 0) return undefined;
  const airSpec = catalog.platforms[slot.platformId];
  if (!airSpec) return undefined;
  const loadoutId = requestedLoadoutId || slot.selectedLoadoutId;
  const loadout = catalog.loadouts[loadoutId];
  if (!slot.availableLoadoutIds.includes(loadoutId) ||
      !loadout?.compatiblePlatformIds.includes(slot.platformId)) return undefined;

  const sortieNumber = slot.nextSortieNumber;
  const sortieId = `sortie_${carrier.id}_${slot.slotId}_${sortieNumber}`;
  if (units[sortieId]) return undefined;
  const slotIndex = carrier.hangar.indexOf(slot);
  const isLandAirbase = carrier.domain === 'land' || carrier.category === 'airbase';
  const offsetLon = isLandAirbase ? (carrier.side === 'RED' ? 0.04 : -0.04) : (carrier.side === 'RED' ? 0.12 : -0.12);
  const offsetLat = isLandAirbase ? 0.03 : 0.08;
  const callsignPrefix = isLandAirbase ? 'WING' : carrier.side === 'RED' ? 'HAIDONG' : 'STRIKE';
  const launched = createRuntimeUnitFromPlacement({
    id: sortieId,
    name: `${slot.squadronName} #${sortieNumber}波次`,
    callsign: `${callsignPrefix}-${sortieNumber}0${slotIndex + 1}`,
    side: carrier.side,
    platformId: slot.platformId,
    loadoutId,
    parentGroupId: carrier.parentGroupId,
    position: [
      Number((carrier.position[0] + offsetLon).toFixed(4)),
      Number((carrier.position[1] + offsetLat).toFixed(4)),
    ],
    altitudeM: isLandAirbase ? Math.max(airSpec.defaultAltitudeM, 1500) : airSpec.defaultAltitudeM,
    heading: carrier.heading,
  }, catalog);
  launched.hostCarrierId = carrier.id;
  launched.hostHangarSlotId = slot.slotId;

  slot.selectedLoadoutId = loadoutId;
  slot.readyAirframes -= 1;
  slot.cooldownRemainingSec = slot.launchCooldownSec;
  slot.activeSortieIds.push(sortieId);
  slot.nextSortieNumber += 1;
  units[sortieId] = launched;
  return launched;
}

export function processPendingSortieOrders(
  orders: PendingSortieOrder[],
  units: Record<string, RuntimeUnit>,
  missions: TacticalMission[],
  catalog: EquipmentCatalog,
  nextSimTime: number,
  score: ScoreLedger,
  logs: CombatLogEntry[]
): PendingSortieOrder[] {
  const remaining: PendingSortieOrder[] = [];
  for (const order of [...orders].sort((a, b) =>
    a.earliestLaunchTime - b.earliestLaunchTime || a.orderId.localeCompare(b.orderId))) {
    if (order.status === 'failed' || order.earliestLaunchTime > nextSimTime) {
      remaining.push(order);
      continue;
    }
    if (order.assignedMissionId) {
      const carrier = units[order.carrierUnitId];
      const mission = missions.find((candidate) => candidate.id === order.assignedMissionId);
      if (!carrier || !mission || mission.side !== carrier.side) {
        order.status = 'failed';
        order.failureReason = '待执行任务不存在或阵营不匹配';
        logs.push({ id: `sortie_order_failed_${order.orderId}_${nextSimTime}`, simTime: nextSimTime,
          side: carrier?.side ?? 'SYSTEM', category: 'EVENT', severity: 'critical',
          title: '待执行出动失败', message: `${order.orderId}: ${order.failureReason}` });
        remaining.push(order);
        continue;
      }
    }
    const availability = evaluateCarrierSortieAvailability(
      units, catalog, order.carrierUnitId, order.hangarSlotId, order.loadoutId
    );
    order.attempts += 1;
    if (availability.status === 'temporary') {
      order.earliestLaunchTime = nextSimTime + 1000;
      remaining.push(order);
      continue;
    }
    if (availability.status === 'permanent') {
      order.status = 'failed';
      order.failureReason = availability.reason;
      logs.push({ id: `sortie_order_failed_${order.orderId}_${nextSimTime}`, simTime: nextSimTime,
        side: units[order.carrierUnitId]?.side ?? 'SYSTEM', category: 'EVENT', severity: 'critical',
        title: '待执行出动失败', message: `${order.orderId}: ${availability.reason}`,
        unitId: order.carrierUnitId });
      remaining.push(order);
      continue;
    }
    const launched = launchCarrierSortie(
      units, catalog, order.carrierUnitId, order.hangarSlotId, order.loadoutId
    );
    if (!launched) {
      order.earliestLaunchTime = nextSimTime + 1000;
      remaining.push(order);
      continue;
    }
    if (order.assignedMissionId) {
      launched.assignedMissionId = order.assignedMissionId;
      launched.navigationMode = 'mission';
      launched.missionState = 'ingress';
    }
    score.sortiesLaunched = (score.sortiesLaunched ?? 0) + 1;
    logs.push({
      id: `sortie_order_launched_${order.orderId}_${nextSimTime}`,
      simTime: nextSimTime,
      side: launched.side,
      category: 'EVENT',
      severity: 'warning',
      title: `[待执行出动完成] ${launched.callsign} 升空`,
      message: `${order.orderId} 在第 ${order.attempts} 次尝试成功，真实消耗机库 ready 库存。`,
      position: [...launched.position],
      unitId: launched.id,
      aarType: 'sortie',
    });
  }
  return remaining;
}
