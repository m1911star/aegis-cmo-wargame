import * as turf from './turfGeo';
import type {
  CombatLogEntry,
  EquipmentCatalog,
  PendingSortieOrder,
  RuntimeUnit,
  ScenarioEnvironment,
  ScoreLedger,
  TacticalMission,
} from '../types/wargame';
import {
  findAmphibiousLandingPoint,
  isPointOnLand,
  isRouteAllowed,
  localSeaStateAt,
  MAX_AMPHIBIOUS_STANDOFF_KM,
} from './environment';
import { getBearingDeg } from './geometry';
import { createRuntimeUnitFromPlacement } from './simulation/unitFactory';
import { getUnitCapabilities, isActiveUnit } from './unitCapabilities';

export type SortieAvailability = { status: 'ready' | 'temporary' | 'permanent'; reason: string };

export function evaluateCarrierSortieAvailability(
  units: Record<string, RuntimeUnit>,
  catalog: EquipmentCatalog,
  carrierUnitId: string,
  hangarSlotId: string,
  requestedLoadoutId?: string,
  environment?: ScenarioEnvironment
): SortieAvailability {
  const carrier = units[carrierUnitId];
  if (!carrier) return { status: 'permanent', reason: '母舰不存在' };
  const caps = getUnitCapabilities(carrier);
  if (!isActiveUnit(carrier) || !caps.canFire) {
    return { status: 'permanent', reason: '母舰已失能，无法执行出动' };
  }
  if (!caps.canLaunchAircraft) {
    return { status: 'temporary', reason: '飞行甲板/跑道起火损管抢修中，暂停起降' };
  }
  const seaState = localSeaStateAt(carrier.position, environment);
  if (seaState >= 6 && carrier.domain === 'surface' && carrier.category !== 'carrier') {
    return { status: 'temporary', reason: '6级恶劣海况甲板横摇超限，护卫舰暂停直升机起降' };
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
  requestedLoadoutId?: string,
  environment?: ScenarioEnvironment
): RuntimeUnit | undefined {
  const carrier = units[carrierUnitId];
  if (!carrier || !isActiveUnit(carrier) || !getUnitCapabilities(carrier).canLaunchAircraft) return undefined;
  const seaState = localSeaStateAt(carrier.position, environment);
  if (seaState >= 6 && carrier.domain === 'surface' && carrier.category !== 'carrier') return undefined;
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
  const deckSeaMultiplier = seaState >= 5 && carrier.domain === 'surface' ? 1.5 : 1;
  slot.cooldownRemainingSec = Math.round(slot.launchCooldownSec * deckSeaMultiplier);
  slot.activeSortieIds.push(sortieId);
  slot.nextSortieNumber += 1;
  units[sortieId] = launched;
  return launched;
}

export const MAX_FAILED_SORTIE_ORDERS = 32;

export function processPendingSortieOrders(
  orders: PendingSortieOrder[],
  units: Record<string, RuntimeUnit>,
  missions: TacticalMission[],
  catalog: EquipmentCatalog,
  nextSimTime: number,
  score: ScoreLedger,
  logs: CombatLogEntry[],
  environment?: ScenarioEnvironment
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
      units, catalog, order.carrierUnitId, order.hangarSlotId, order.loadoutId, environment
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
      units, catalog, order.carrierUnitId, order.hangarSlotId, order.loadoutId, environment
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
  const failedCount = remaining.filter((order) => order.status === 'failed').length;
  if (failedCount <= MAX_FAILED_SORTIE_ORDERS) return remaining;
  let excessFailed = failedCount - MAX_FAILED_SORTIE_ORDERS;
  return remaining.filter((order) => {
    if (order.status !== 'failed' || excessFailed <= 0) return true;
    excessFailed -= 1;
    return false;
  });
}

export interface DeployCarriedResult {
  deployed?: RuntimeUnit;
  log?: CombatLogEntry;
  errorReason?: string;
}

export function deployCarriedUnitFromLauncher(
  units: Record<string, RuntimeUnit>,
  launcher: RuntimeUnit | undefined,
  platformId: string,
  catalog: EquipmentCatalog,
  environment: ScenarioEnvironment | undefined,
  simTime: number,
  idSuffix: string,
  callsignSeq: number,
  targetWaypoint?: [number, number]
): DeployCarriedResult {
  if (!launcher || !isActiveUnit(launcher) || !getUnitCapabilities(launcher).canFire) {
    return { errorReason: '投送母舰/载机已失能，无法执行释放或抵滩卸载' };
  }
  const deployableSpec = catalog.platforms[platformId];
  const remaining = launcher.deployableInventory[platformId] ?? 0;
  if (remaining <= 0 || !deployableSpec) {
    return { errorReason: '所选搭载单位库存已耗尽' };
  }
  const id = `deployable_${launcher.id}_${platformId}_${idSuffix}`;
  if (units[id]) {
    return { errorReason: '投送编号冲突，请稍后重试' };
  }

  // Branch A: Airborne unmanned / decoy deployable
  if (deployableSpec.domain === 'air' && ['decoy', 'mpa_uav'].includes(deployableSpec.category)) {
    const deployed = createRuntimeUnitFromPlacement({
      id,
      name: `${deployableSpec.name} #${remaining}`,
      callsign: `${deployableSpec.category === 'decoy' ? 'DECOY' : 'UAV'}-${callsignSeq}`,
      side: launcher.side,
      platformId,
      parentGroupId: launcher.parentGroupId,
      position: [...launcher.position],
      altitudeM: Math.max(deployableSpec.minAltitudeM, Math.min(deployableSpec.maxAltitudeM, launcher.altitudeM)),
      heading: targetWaypoint ? getBearingDeg(launcher.position, targetWaypoint) : launcher.heading,
      speedKts: deployableSpec.cruiseSpeedKts,
    }, catalog);
    deployed.deployedByUnitId = launcher.id;
    const destination = targetWaypoint
      ? ([...targetWaypoint] as [number, number])
      : (turf.destination(launcher.position, 250, launcher.heading, { units: 'kilometers' })
          .geometry.coordinates as [number, number]);
    deployed.waypoints = [{
      position: destination,
      speedKts: deployableSpec.cruiseSpeedKts,
      altitudeM: deployed.altitudeM,
    }];
    return {
      deployed,
      log: {
        id: `deployable_launch_${id}`,
        simTime,
        side: launcher.side,
        category: 'EVENT',
        severity: 'info',
        title: `${launcher.callsign} 释放 ${deployableSpec.name}`,
        message: `剩余库存 ${remaining - 1}；平台作为独立可观测实体进入战场。`,
        position: [...launcher.position],
        unitId: deployed.id,
        aarType: 'sortie',
      },
    };
  }

  // Branch B: Amphibious beach landing of embarked ground force
  if (
    deployableSpec.domain === 'land' &&
    deployableSpec.category === 'ground_force' &&
    launcher.domain === 'surface' &&
    ['carrier', 'amphibious'].includes(launcher.category)
  ) {
    const landingPos = findAmphibiousLandingPoint(
      launcher.position,
      launcher.heading,
      environment,
      MAX_AMPHIBIOUS_STANDOFF_KM
    );
    if (!landingPos) {
      return {
        errorReason: `需抵近海岸线 ${MAX_AMPHIBIOUS_STANDOFF_KM} km 以内方可实施两栖卸载登滩`,
      };
    }
    const advanceTarget = targetWaypoint
      ? ([...targetWaypoint] as [number, number])
      : (turf.destination(landingPos, 6, getBearingDeg(launcher.position, landingPos), {
          units: 'kilometers',
        }).geometry.coordinates as [number, number]);
    const canAdvanceInland = isRouteAllowed('land', landingPos, advanceTarget, environment);
    const heading = canAdvanceInland
      ? getBearingDeg(landingPos, advanceTarget)
      : getBearingDeg(launcher.position, landingPos);

    const deployed = createRuntimeUnitFromPlacement({
      id,
      name: `${deployableSpec.name} (登滩#${remaining})`,
      callsign: `LANDING-${callsignSeq}`,
      side: launcher.side,
      platformId,
      parentGroupId: launcher.parentGroupId,
      position: landingPos,
      heading,
      speedKts: canAdvanceInland ? deployableSpec.cruiseSpeedKts : 0,
      doctrine: { roe: 'free', requireIdentifiedForAutoFire: true, shootAndScoot: false },
    }, catalog);
    deployed.deployedByUnitId = launcher.id;
    if (canAdvanceInland) {
      deployed.waypoints = [{
        position: advanceTarget,
        speedKts: deployableSpec.cruiseSpeedKts,
      }];
    }
    return {
      deployed,
      log: {
        id: `amphibious_landing_${id}`,
        simTime,
        side: launcher.side,
        category: 'EVENT',
        severity: 'warning',
        title: `[两栖抵滩投送] ${launcher.callsign} 卸载 ${deployableSpec.name} 抢滩登岛`,
        message: `登陆点 [${landingPos[0].toFixed(2)}°E, ${landingPos[1].toFixed(2)}°N]，坞舱剩余 ${remaining - 1} 批。`,
        position: [...landingPos],
        unitId: deployed.id,
        aarType: 'sortie',
      },
    };
  }

  // Branch C: Airborne ASW sonobuoy drop into open water
  if (
    deployableSpec.domain === 'subsurface' &&
    deployableSpec.category === 'sonobuoy' &&
    launcher.domain === 'air'
  ) {
    const dropPos: [number, number] = targetWaypoint ? [...targetWaypoint] : [...launcher.position];
    if (isPointOnLand(dropPos, environment)) {
      return { errorReason: '声呐浮标只能投放在海域，当前坐标位于陆地上空' };
    }
    const hasActivePing = deployableSpec.sensorIds.some(
      (sId) => catalog.sensors[sId]?.type === 'sonar_active'
    );
    const deployed = createRuntimeUnitFromPlacement({
      id,
      name: `${deployableSpec.name} #${remaining}`,
      callsign: `BUOY-${callsignSeq}`,
      side: launcher.side,
      platformId,
      parentGroupId: launcher.parentGroupId,
      position: dropPos,
      altitudeM: deployableSpec.defaultAltitudeM,
      heading: 0,
      speedKts: 0,
      doctrine: {
        roe: 'hold',
        emconRadar: false,
        emconSonar: hasActivePing,
        emconJamming: false,
        autoEvade: false,
      },
    }, catalog);
    deployed.deployedByUnitId = launcher.id;
    return {
      deployed,
      log: {
        id: `sonobuoy_drop_${id}`,
        simTime,
        side: launcher.side,
        category: 'EVENT',
        severity: 'info',
        title: `${launcher.callsign} 投掷 ${deployableSpec.name}`,
        message: `浮标入水悬停 (${deployableSpec.defaultAltitudeM}m · ${hasActivePing ? '主动Ping开启' : '被动静默监听'})，剩余库存 ${remaining - 1} 枚。`,
        position: [...dropPos],
        unitId: deployed.id,
      },
    };
  }

  return { errorReason: '平台不支持该类型搭载投送' };
}
