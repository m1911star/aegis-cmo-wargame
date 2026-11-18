import * as turf from './turfGeo';
import type { ActivePerspective, CombatLogEntry, EquipmentCatalog, MissionDefinition, RuntimeHangarSlot, RuntimeUnit, ScenarioEnvironment, ScoreLedger, TacticalContact, WeaponInFlight } from '../types/wargame';
import { resolvePropulsionAtAltitude } from './cmoUnits';
import { deployCarriedUnitFromLauncher } from './carrierOperations';
import { resolveUnitConfiguration } from './unitConfiguration';
import { computeNavigationBypassWaypoints, getCompiledPolygon, isPointOnLand, isRouteAllowed, pointInBbox } from './environment';
import { guidanceProfile, weaponLaunchRangeKm } from './fireControl';
import { getBearingDeg, getDistanceKm } from './geometry';
import {
  assessStrikeCoordination,
  getSeadTargetPriority,
  getStrikeTargetPriority,
  isActiveSamRadarContact,
  isSeadOrEwUnit,
} from './missions';
import { getUnitCapabilities, isActiveUnit } from './unitCapabilities';

const CRITICAL_HP_FRACTION = 0.25;
const CRITICAL_FUEL_FRACTION = 0.1;

function isAiControlledUnit(unit: RuntimeUnit, playerSide?: ActivePerspective): boolean {
  const effectiveNavMode =
    unit.status === 'evading' && unit.evasionState?.resumeNavigationMode
      ? unit.evasionState.resumeNavigationMode
      : unit.navigationMode;
  const isNonPlayerSide =
    (playerSide === 'RED' || playerSide === 'BLUE') && unit.side !== playerSide;
  const isMissionControlled =
    effectiveNavMode === 'mission' &&
    !(unit.status !== 'evading' && unit.waypoints.length > 0 && !unit.missionTargetId && !unit.assignedMissionId);
  return isNonPlayerSide || isMissionControlled;
}

function computeDefensiveEgressPoint(
  unit: RuntimeUnit,
  contacts: Record<string, TacticalContact>,
  simTime: number,
  environment?: ScenarioEnvironment
): [number, number] | undefined {
  const nearestThreat = Object.values(contacts)
    .filter(
      (contact) =>
        contact.observerSide === unit.side &&
        contact.targetSide !== unit.side &&
        contact.targetSide !== 'NEUTRAL' &&
        simTime - contact.lastDetectedTime <= 30_000
    )
    .sort(
      (a, b) =>
        getDistanceKm(unit.position, a.estimatedPosition) -
        getDistanceKm(unit.position, b.estimatedPosition) || a.id.localeCompare(b.id)
    )[0];

  const egressDistKm = unit.domain === 'air' ? 60 : unit.domain === 'surface' ? 25 : 15;
  if (nearestThreat) {
    const awayBearing = (getBearingDeg(nearestThreat.estimatedPosition, unit.position) + 360) % 360;
    for (const offset of [0, 35, -35, 70, -70, 110, -110]) {
      const bearing = (awayBearing + offset + 360) % 360;
      const dest = turf.destination(unit.position, egressDistKm, bearing, { units: 'kilometers' })
        .geometry.coordinates as [number, number];
      if (isRouteAllowed(unit.domain, unit.position, dest, environment)) {
        return dest;
      }
    }
  }
  if (
    unit.recoveryPosition &&
    getDistanceKm(unit.position, unit.recoveryPosition) > 1 &&
    isRouteAllowed(unit.domain, unit.position, unit.recoveryPosition, environment)
  ) {
    return [...unit.recoveryPosition];
  }
  const reverseBearing = (unit.heading + 180) % 360;
  for (const offset of [0, 45, -45, 90, -90]) {
    const dest = turf.destination(unit.position, egressDistKm, (reverseBearing + offset + 360) % 360, {
      units: 'kilometers',
    }).geometry.coordinates as [number, number];
    if (isRouteAllowed(unit.domain, unit.position, dest, environment)) {
      return dest;
    }
  }
  return undefined;
}

export function effectiveDoctrine(unit: RuntimeUnit, missions: MissionDefinition[]) {
  const mission = missions.find((m) => m.id === unit.assignedMissionId && m.isActive);
  return { ...unit.doctrine, ...mission?.doctrineOverride };
}

export function recoverySolution(unit: RuntimeUnit, units: Record<string, RuntimeUnit>, catalog: EquipmentCatalog) {
  const config = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
  const compatible = Object.values(units)
    .filter((candidate) => candidate.side === unit.side && isActiveUnit(candidate) && getUnitCapabilities(candidate).canLaunchAircraft)
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
  score: ScoreLedger, logs: CombatLogEntry[], weaponsInFlight: Record<string, WeaponInFlight> = {},
  environment?: ScenarioEnvironment, playerSide?: ActivePerspective
) {
  const mission = missions.find((m) => m.id === unit.assignedMissionId && m.isActive);
  const unitEffDoctrine = effectiveDoctrine(unit, missions);

  // Seawater battery life countdown for expendable ASW sonobuoys (never counts as a platform loss)
  if (unit.category === 'sonobuoy') {
    unit.fuelRemainingSec = Math.max(0, unit.fuelRemainingSec - dtSec);
    if (unit.fuelRemainingSec <= 0) {
      unit.hp = 0;
      unit.status = 'destroyed';
      logs.push({
        id: `buoy_expire_${unit.id}_${simTime}`,
        simTime,
        side: unit.side,
        category: 'EVENT',
        severity: 'info',
        title: `${unit.callsign} 声呐浮标海水电池耗尽自沉`,
        message: '浮标已完成预定监听周期并自动沉没，不计入战损。',
        position: [...unit.position],
        unitId: unit.id,
      });
    }
    return;
  }

  // Submarine periodic S-turn baffle-clearing maneuver (clears stern ±30° sonar baffles every 180s for 20s)
  if (unit.domain === 'subsurface' && isActiveUnit(unit)) {
    const syncExternalBaffleRoute = () => {
      const state = unit.baffleClearState;
      if (!state || state.untilSimTime <= 0) return;
      const managed = state.managedWaypointPosition;
      const external = unit.waypoints
        .filter(
          (w) =>
            !managed ||
            Math.abs(w.position[0] - managed[0]) > 1e-7 ||
            Math.abs(w.position[1] - managed[1]) > 1e-7
        )
        .map((w) => ({ ...w, position: [...w.position] as [number, number] }));
      if (external.length > 0) {
        state.savedWaypoints = external;
        state.savedHeading = getBearingDeg(unit.position, external[0].position);
      }
    };
    if (!unitEffDoctrine.baffleClearPeriodic || unit.status === 'evading' || unit.missionTargetId) {
      if (unit.baffleClearState && unit.baffleClearState.untilSimTime > 0) {
        syncExternalBaffleRoute();
        unit.heading = unit.baffleClearState.savedHeading;
        unit.waypoints = unit.baffleClearState.savedWaypoints.map((w) => ({ ...w, position: [...w.position] as [number, number] }));
        unit.baffleClearState = {
          savedHeading: unit.heading,
          savedWaypoints: [],
          untilSimTime: 0,
          nextAtSimTime: simTime + 180_000,
        };
      }
    } else {
      unit.baffleClearState ??= {
        savedHeading: unit.heading,
        savedWaypoints: [],
        untilSimTime: 0,
        nextAtSimTime: simTime + 180_000,
      };
      if (unit.baffleClearState.untilSimTime > 0) {
        syncExternalBaffleRoute();
        if (simTime >= unit.baffleClearState.untilSimTime) {
          unit.heading = unit.baffleClearState.savedHeading;
          unit.waypoints = unit.baffleClearState.savedWaypoints.map((w) => ({ ...w, position: [...w.position] as [number, number] }));
          unit.baffleClearState.untilSimTime = 0;
          unit.baffleClearState.savedWaypoints = [];
          unit.baffleClearState.managedWaypointPosition = undefined;
          unit.baffleClearState.nextAtSimTime = simTime + 180_000;
        }
      } else if (simTime >= unit.baffleClearState.nextAtSimTime) {
        const turnSign = Math.floor(simTime / 180_000) % 2 === 0 ? 1 : -1;
        const clearBearing = (unit.heading + turnSign * 38 + 360) % 360;
        const clearDest = turf.destination(unit.position, 2.5, clearBearing, { units: 'kilometers' })
          .geometry.coordinates as [number, number];
        if (isRouteAllowed('subsurface', unit.position, clearDest, environment)) {
          unit.baffleClearState = {
            savedHeading: unit.heading,
            savedWaypoints: unit.waypoints.map((w) => ({ ...w, position: [...w.position] as [number, number] })),
            managedWaypointPosition: [...clearDest],
            untilSimTime: simTime + 20_000,
            nextAtSimTime: simTime + 200_000,
          };
          unit.heading = clearBearing;
          unit.waypoints = [{ position: clearDest, speedKts: Math.min(8, Math.max(4, unit.targetSpeedKts || 5)) }];
          logs.push({
            id: `baffle_clear_${unit.id}_${simTime}`,
            simTime,
            side: unit.side,
            category: 'DOCTRINE',
            severity: 'info',
            title: `${unit.callsign} 执行转向清声呐尾流盲区 (Baffle Clear)`,
            message: `偏航 ${Math.round(clearBearing)}° 持续 20 秒，监听艇尾螺旋桨遮蔽扇区。`,
            position: [...unit.position],
            unitId: unit.id,
          });
        } else {
          unit.baffleClearState.nextAtSimTime = simTime + 60_000;
        }
      }
    }
  }
  const targetDomains: RuntimeUnit['domain'][] = mission?.type === 'aaw_patrol' ? ['air']
    : mission?.type === 'asuw_patrol' || mission?.type === 'maritime_strike' ? ['surface']
    : mission?.type === 'asw_patrol' ? ['subsurface']
    : mission?.type === 'land_strike' ? ['land']
    : mission?.type === 'sead' ? ['surface', 'land'] : [];
  const aiControlled = isAiControlledUnit(unit, playerSide);
  const hpCritical = unit.hp > 0 && unit.maxHp > 0 && unit.hp / unit.maxHp <= CRITICAL_HP_FRACTION;
  const isAirborneOrUnderway =
    unit.speedKts > 0.5 ||
    unit.targetSpeedKts > 0.5 ||
    !!unit.hostCarrierId ||
    unit.waypoints.length > 0 ||
    !!unit.missionTargetId;
  if (unit.domain === 'air') {
    const airConfig = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);

    // ASW automatic sonobuoy barrier deployment
    if (
      unitEffDoctrine.autoDeploySonobuoys &&
      isActiveUnit(unit) &&
      unit.status !== 'returning' &&
      !unit.airRefuelState &&
      simTime >= (unit.nextAutoSonobuoyTime ?? 0) &&
      !isPointOnLand(unit.position, environment)
    ) {
      const buoyEntry = Object.entries(unit.deployableInventory).find(
        ([pid, count]) => count > 0 && catalog.platforms[pid]?.category === 'sonobuoy'
      );
      if (buoyEntry) {
        let inDropZone = true;
        if (mission?.type === 'asw_patrol' && mission.areaPolygon.length >= 3) {
          const compiledAsw = getCompiledPolygon(mission.areaPolygon);
          inDropZone =
            (pointInBbox(unit.position, compiledAsw.bbox) &&
              turf.booleanPointInPolygon(unit.position, compiledAsw.feature)) ||
            turf.pointToLineDistance(unit.position, compiledAsw.boundary, { units: 'kilometers' }) <= 20;
        }
        const nearbyFriendlyBuoy = Object.values(units).some(
          (other) =>
            other.side === unit.side &&
            other.category === 'sonobuoy' &&
            isActiveUnit(other) &&
            getDistanceKm(other.position, unit.position) < 18
        );
        if (inDropZone && !nearbyFriendlyBuoy) {
          const [buoyPlatformId, remaining] = buoyEntry;
          const seqNum = Math.floor(simTime / 1000);
          const deployedRes = deployCarriedUnitFromLauncher(
            units,
            unit,
            buoyPlatformId,
            catalog,
            environment,
            simTime,
            `auto_${seqNum}`,
            remaining
          );
          if (deployedRes.deployed) {
            units[deployedRes.deployed.id] = deployedRes.deployed;
            unit.deployableInventory[buoyPlatformId] = Math.max(0, remaining - 1);
            unit.nextAutoSonobuoyTime = simTime + 45_000;
            if (deployedRes.log) logs.push(deployedRes.log);
          }
        }
      }
    }

    if (unit.category !== 'decoy') {
      const recovery = recoverySolution(unit, units, catalog);

      // Low-fuel automatic air refueling request before hitting emergency RTB reserve
      if (
        unitEffDoctrine.autoAirRefuel &&
        unit.category !== 'tanker' &&
        airConfig.platform.canReceiveAar !== false &&
        !unit.airRefuelState &&
        unit.status !== 'returning' &&
        unit.fuelRemainingSec <= Math.max(recovery.reserveSec * 1.45, airConfig.maxFuelSec * 0.35)
      ) {
        const bestTanker = Object.values(units)
          .filter(
            (candidate) =>
              candidate.side === unit.side &&
              isActiveUnit(candidate) &&
              candidate.domain === 'air' &&
              candidate.category === 'tanker' &&
              candidate.status !== 'returning' &&
              candidate.aarFuelRemainingSec > 60 &&
              candidate.aarQueue.length < 4 &&
              !candidate.aarQueue.includes(unit.id)
          )
          .sort(
            (a, b) =>
              getDistanceKm(unit.position, a.position) - getDistanceKm(unit.position, b.position) ||
              a.id.localeCompare(b.id)
          )[0];
        if (bestTanker) {
          const distToTankerKm = getDistanceKm(unit.position, bestTanker.position);
          const timeToTankerSec = distToTankerKm / ((Math.max(1, recovery.cruise) * 1.852) / 3600);
          if (unit.fuelRemainingSec > timeToTankerSec * 1.15 + 30) {
            unit.airRefuelState = {
              tankerId: bestTanker.id,
              phase: 'rendezvous',
              managedWaypointPosition: [...bestTanker.position],
              resumeNavigationMode: unit.navigationMode,
              resumeWaypoints: unit.waypoints.map((wp) => ({
                ...wp,
                position: [...wp.position] as [number, number],
              })),
              resumeMissionTargetId: unit.missionTargetId,
              resumeMissionState: unit.missionState,
            };
            unit.navigationMode = 'manual';
            unit.missionTargetId = undefined;
            unit.waypoints = [
              {
                position: [...bestTanker.position],
                speedKts: bestTanker.targetSpeedKts,
                altitudeM: bestTanker.targetAltitudeM,
              },
            ];
            bestTanker.aarQueue.push(unit.id);
            logs.push({
              id: `auto_aar_${unit.id}_${simTime}`,
              simTime,
              side: unit.side,
              category: 'DOCTRINE',
              severity: 'info',
              title: `${unit.callsign} 低油量自动请求空中加油`,
              message: `自动加入 ${bestTanker.callsign} 受油队列（距离 ${distToTankerKm.toFixed(1)} km），完成后恢复原任务。`,
              position: [...unit.position],
              unitId: unit.id,
            });
          }
        }
      }

      const combatMounts = targetDomains.length > 0
        ? unit.mounts.filter((mount) => targetDomains.some((domain) => catalog.weapons[mount.weaponId]?.targetDomains.includes(domain)))
        : [];
      const empty = combatMounts.length > 0 && combatMounts.every((mount) => mount.currentAmmo === 0);
      const fuelLow = !unit.airRefuelState && unit.fuelRemainingSec <= recovery.reserveSec;
      const damageRtb = aiControlled && hpCritical && isAirborneOrUnderway;
      if (unit.status !== 'returning' && (fuelLow || empty || damageRtb)) {
        unit.status = 'returning';
        unit.missionState = 'egress';
        unit.missionTargetId = undefined;
        unit.returnReason = empty ? 'ammunition' : damageRtb ? 'damage' : 'fuel';
        const reasonText = empty
          ? '任务弹药耗尽'
          : damageRtb
            ? '机体严重受损（耐久 ≤ 25%）'
            : '达到返航油量储备';
        logs.push({ id: `rtb_${unit.id}_${simTime}`, simTime, side: unit.side, category: 'DOCTRINE', severity: 'warning',
          title: `${unit.callsign} 脱离返航`, message: `${reasonText}；${recovery.position ? '前往可用回收点。' : '执行防御性脱离航线。'}`, unitId: unit.id });
      }
      if (unit.status === 'returning') {
        if (recovery.position) {
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
        } else if (unit.waypoints.length === 0) {
          const egressDest = computeDefensiveEgressPoint(unit, contacts, simTime, environment);
          unit.missionTargetId = undefined;
          unit.targetSpeedKts = recovery.cruise;
          if (egressDest) {
            unit.waypoints = [{ position: egressDest, speedKts: recovery.cruise }];
          }
        }
      }
    }
    const cruise = airConfig.cruiseSpeedKts;
    let burnRate: number;
    if (unit.throttleSetting !== undefined || airConfig.platform.dbid !== undefined) {
      const propPerf = resolvePropulsionAtAltitude(
        airConfig.platform,
        catalog,
        unit.altitudeM,
        unit.throttleSetting ?? 2,
        airConfig.maxSpeedKts,
        cruise,
        airConfig.loadout?.speedPenaltyKts ?? 0
      );
      burnRate =
        unit.throttleSetting !== undefined
          ? propPerf.fuelBurnMultiplier
          : Math.max(
              0.55,
              propPerf.fuelBurnMultiplier *
                Math.pow(unit.speedKts / Math.max(1, propPerf.bandCruiseSpeedKts || cruise), 1.35)
            );
    } else {
      burnRate = Math.max(0.6, Math.pow(unit.speedKts / Math.max(1, cruise), 1.5));
    }
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
  } else if (unit.category !== 'decoy') {
    const config = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
    const maxSpeed = config.maxSpeedKts * getUnitCapabilities(unit).speedFactor;
    const fuelCritical =
      unit.maxFuelSec > 0 && unit.fuelRemainingSec <= Math.max(60, unit.maxFuelSec * CRITICAL_FUEL_FRACTION);
    if (aiControlled && isAirborneOrUnderway && maxSpeed > 0 && unit.status !== 'returning' && (hpCritical || fuelCritical)) {
      unit.status = 'returning';
      unit.missionState = 'egress';
      unit.missionTargetId = undefined;
      unit.returnReason = hpCritical ? 'damage' : 'fuel';
      const egressDest = computeDefensiveEgressPoint(unit, contacts, simTime, environment);
      const egressSpeed = Math.max(1, config.cruiseSpeedKts * getUnitCapabilities(unit).speedFactor);
      unit.waypoints = egressDest ? [{ position: egressDest, speedKts: egressSpeed }] : [];
      if (egressDest) unit.targetSpeedKts = egressSpeed;
      logs.push({
        id: `rtb_${unit.id}_${simTime}`,
        simTime,
        side: unit.side,
        category: 'DOCTRINE',
        severity: 'warning',
        title: `${unit.callsign} 战损脱离撤出`,
        message: `${hpCritical ? '平台严重受损（耐久 ≤ 25%）' : '达到临界油量储备'}，停止前出并执行防御性脱离。`,
        position: [...unit.position],
        unitId: unit.id,
      });
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
  const compiledArea = getCompiledPolygon(mission.areaPolygon);
  const area = compiledArea.feature;
  const boundary = compiledArea.boundary;

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
  const seadPrioritized = isSeadOrEwUnit(unit, catalog, mission);
  const unitCanTargetAir = unit.mounts.some(
    (mount) => mount.currentAmmo > 0 && catalog.weapons[mount.weaponId]?.targetDomains.includes('air')
  );
  const strikeCoordination =
    !seadPrioritized &&
    (mission.type === 'land_strike' ||
      mission.type === 'asuw_patrol' ||
      mission.type === 'maritime_strike')
      ? assessStrikeCoordination(unit, mission, units, contacts, missions, catalog, simTime, weaponsInFlight)
      : undefined;
  const candidatePriority = (contact: TacticalContact): number => {
    if (seadPrioritized) return getSeadTargetPriority(contact);
    if (strikeCoordination) return getStrikeTargetPriority(contact, mission.type, strikeCoordination);
    return 0;
  };
  const candidates = Object.values(contacts).filter((contact) => {
    if (contact.observerSide !== unit.side || simTime - contact.lastDetectedTime > 5000) return false;
    if (mission.type === 'sead') {
      if (contact.emitterObserved !== true) return false;
      const domainMatch =
        targetDomains.includes(contact.domain) ||
        (contact.domain === 'air' && contact.identifiedCategory === 'awacs' && unitCanTargetAir);
      if (!domainMatch) return false;
    } else if (!targetDomains.includes(contact.domain)) {
      return false;
    }
    return (
      (pointInBbox(contact.estimatedPosition, compiledArea.bbox) && turf.booleanPointInPolygon(contact.estimatedPosition, area)) ||
      turf.pointToLineDistance(contact.estimatedPosition, boundary, { units: 'kilometers' }) <= mission.prosecuteOutsideAreaKm
    );
  }).sort(
    (a, b) =>
      candidatePriority(a) - candidatePriority(b) ||
      getDistanceKm(unit.position, a.estimatedPosition) - getDistanceKm(unit.position, b.estimatedPosition) ||
      a.id.localeCompare(b.id)
  );
  const bestCandidate = candidates[0];
  const currentTarget = unit.missionTargetId
    ? candidates.find((contact) => contact.id === unit.missionTargetId)
    : undefined;
  const target =
    currentTarget && (!bestCandidate || candidatePriority(currentTarget) <= candidatePriority(bestCandidate))
      ? currentTarget
      : bestCandidate;
  if (target) {
    if (mission.packageTotSec !== undefined && simTime / 1000 < mission.packageTotSec) {
      const config = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
      const speedKts = Math.max(1, config.cruiseSpeedKts * getUnitCapabilities(unit).speedFactor);
      const distKm = getDistanceKm(unit.position, target.estimatedPosition);
      const etaSec = distKm / ((speedKts * 1.852) / 3600);
      if (simTime / 1000 + etaSec < mission.packageTotSec - 15) {
        unit.missionTargetId = undefined;
        unit.missionState = pointInBbox(unit.position, compiledArea.bbox) && turf.booleanPointInPolygon(unit.position, area)
          ? 'on_station'
          : 'ingress';
        unit.waypoints = [];
        return;
      }
    }
    if (
      strikeCoordination?.hasFriendlySeadSupport &&
      strikeCoordination.armInFlightAny &&
      isActiveSamRadarContact(target, mission.type) &&
      (strikeCoordination.armInFlightTargetIds.has(target.actualUnitId) ||
        strikeCoordination.armInFlightTargetIds.has(target.id))
    ) {
      unit.missionTargetId = undefined;
      unit.missionState = pointInBbox(unit.position, compiledArea.bbox) && turf.booleanPointInPolygon(unit.position, area)
        ? 'on_station'
        : 'ingress';
      unit.waypoints = [];
      return;
    }
    const doctrine = effectiveDoctrine(unit, missions);
    const inFlight = Object.values(unit.weaponUsage).some((usage) => usage.cooldownUntil > simTime);
    if (unit.domain === 'air' && doctrine.bvrTactics === 'crank_pump') {
      const outbound = Object.values(weaponsInFlight).filter(
        (m) => m.shooterId === unit.id && !m.isIntercepted && m.targetType !== 'missile'
      );
      const guidingMidcourse = outbound.some((m) => {
        const w = catalog.weapons[m.weaponId];
        return !!w && guidanceProfile(w).receivesUpdates && !!m.seekerState?.startsWith('midcourse');
      });
      const config = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
      if (guidingMidcourse) {
        const bearingToTarget = getBearingDeg(unit.position, target.estimatedPosition);
        const crankSign = unit.id.charCodeAt(unit.id.length - 1) % 2 === 0 ? 1 : -1;
        const crankBearing = (bearingToTarget + crankSign * 50 + 360) % 360;
        const crankPoint = turf.destination(unit.position, 24, crankBearing, { units: 'kilometers' })
          .geometry.coordinates as [number, number];
        unit.missionTargetId = target.id;
        unit.missionState = 'engaging';
        unit.waypoints = [{
          position: crankPoint,
          speedKts: Math.max(120, Math.round(config.cruiseSpeedKts * 0.82)),
        }];
        return;
      }
      if (inFlight) {
        const awayBearing = (getBearingDeg(target.estimatedPosition, unit.position) + 360) % 360;
        const pumpPoint = turf.destination(unit.position, 22, awayBearing, { units: 'kilometers' })
          .geometry.coordinates as [number, number];
        unit.missionTargetId = undefined;
        unit.missionState = 'egress';
        unit.waypoints = [{
          position: pumpPoint,
          speedKts: Math.round(config.maxSpeedKts * 0.9),
        }];
        return;
      }
    }
    if (!inFlight) {
      unit.missionTargetId = target.id;
      unit.missionState = 'engaging';
      const useStandoffStation = mission.type === 'maritime_strike' || mission.standoffStrike === true;
      if (useStandoffStation) {
        let maxReadyRangeKm = 0;
        for (const m of unit.mounts) {
          if (m.currentAmmo <= doctrine.minimumWeaponReserve) continue;
          const w = catalog.weapons[m.weaponId];
          if (!w || !w.targetDomains.includes(target.domain)) continue;
          const eff = weaponLaunchRangeKm(w) * doctrine.automaticFireRangeFraction;
          if (eff > maxReadyRangeKm) maxReadyRangeKm = eff;
        }
        if (maxReadyRangeKm > 15) {
          const distToTargetKm = getDistanceKm(unit.position, target.estimatedPosition);
          if (distToTargetKm > maxReadyRangeKm * 0.94) {
            const awayFromTarget = getBearingDeg(target.estimatedPosition, unit.position);
            const standoffPt = turf.destination(
              target.estimatedPosition,
              maxReadyRangeKm * 0.88,
              awayFromTarget,
              { units: 'kilometers' }
            ).geometry.coordinates as [number, number];
            const routePts = computeNavigationBypassWaypoints(
              unit.domain,
              unit.altitudeM,
              unit.position,
              standoffPt,
              environment
            );
            unit.waypoints = routePts.map((position) => ({ position }));
          } else {
            const orbitBearing = (getBearingDeg(unit.position, target.estimatedPosition) + 90) % 360;
            const orbitPt = turf.destination(
              unit.position,
              unit.domain === 'air' ? 14 : 5,
              orbitBearing,
              { units: 'kilometers' }
            ).geometry.coordinates as [number, number];
            unit.waypoints = isRouteAllowed(unit.domain, unit.position, orbitPt, environment)
              ? [{ position: orbitPt }]
              : [];
          }
          return;
        }
      }
      if (doctrine.autoTerrainDogleg) {
        const routePts = computeNavigationBypassWaypoints(
          unit.domain,
          unit.altitudeM,
          unit.position,
          target.estimatedPosition,
          environment
        );
        unit.waypoints = routePts.map((position) => ({ position }));
      } else {
        unit.waypoints = [{ position: [...target.estimatedPosition] }];
      }
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
      : pointInBbox(unit.position, compiledArea.bbox) && turf.booleanPointInPolygon(unit.position, area) ? 'on_station' : 'ingress';
  }
}
