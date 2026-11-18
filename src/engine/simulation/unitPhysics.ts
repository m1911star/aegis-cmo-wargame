import * as turf from '../turfGeo';
import { resolvePropulsionAtAltitude } from '../cmoUnits';
import { resolveMagazineReloadCycleSec, resolveUnitConfiguration } from '../unitConfiguration';
import type {
  ActivePerspective,
  CombatLogEntry,
  EquipmentCatalog,
  RuntimeUnit,
  ScenarioEnvironment,
  ScoreLedger,
  TacticalContact,
  TacticalMission,
  WeaponInFlight,
} from '../../types/wargame';
import { getCompiledPolygon, isRouteAllowed } from '../environment';
import { getBearingDeg, getDistanceKm } from '../geometry';
import { updateUnitOperations } from '../operations';
import { getUnitCapabilities, isActiveUnit } from '../unitCapabilities';

const KTS_TO_KMPH = 1.852;

export type UnitPhysicsContext = {
  units: Record<string, RuntimeUnit>;
  previousContacts: Record<string, TacticalContact>;
  weaponsInFlight?: Record<string, WeaponInFlight>;
  missions: TacticalMission[];
  catalog: EquipmentCatalog;
  environment?: ScenarioEnvironment;
  nextSimTime: number;
  dtSec: number;
  score: ScoreLedger;
  logs: CombatLogEntry[];
  playerSide?: ActivePerspective;
};

/** Advance platform readiness, operations, navigation and kinematics for one tick. */
export function advanceUnitPhysics({
  units,
  previousContacts,
  weaponsInFlight = {},
  missions,
  catalog,
  environment,
  nextSimTime,
  dtSec,
  score,
  logs,
  playerSide,
}: UnitPhysicsContext): void {
  const configurations = new Map(
    Object.values(units).map((unit) => [
      unit.id,
      resolveUnitConfiguration(
        catalog,
        unit.platformId,
        unit.activeLoadoutId
      ),
    ])
  );

  for (const unit of Object.values(units)) {
    const unitActive = isActiveUnit(unit);
    for (const slot of unit.hangar || []) {
      const stillAirborne: string[] = [];
      let lostSorties = 0;
      for (const sortieId of slot.activeSortieIds) {
        const sortie = units[sortieId];
        if (!sortie || sortie.hp <= 0 || sortie.status === 'destroyed') {
          lostSorties += 1;
        } else if (sortie.status !== 'recovered') {
          stillAirborne.push(sortieId);
        }
      }
      if (stillAirborne.length !== slot.activeSortieIds.length) {
        slot.activeSortieIds = stillAirborne;
      }
      if (lostSorties > 0) {
        slot.totalAirframes = Math.max(0, slot.totalAirframes - lostSorties);
      }

      if (!unitActive) {
        const lostOnboard = slot.readyAirframes + slot.reserveAirframes + slot.turnaroundQueue.length;
        if (lostOnboard > 0) {
          logs.push({
            id: `hangar_loss_${unit.id}_${slot.slotId}_${nextSimTime}`,
            simTime: nextSimTime,
            side: unit.side,
            category: 'DESTROYED',
            severity: 'critical',
            title: `${unit.callsign} 舰载航空库存损失`,
            message: `${slot.squadronName} 共 ${lostOnboard} 个待命/整备批次随母舰失能；在空波次必须转场。`,
            unitId: unit.id,
            aarType: 'hangar_loss',
          });
        }
        slot.readyAirframes = 0;
        slot.reserveAirframes = 0;
        slot.turnaroundQueue = [];
        slot.turnaroundSupplies = 0;
        slot.cooldownRemainingSec = 0;
        slot.totalAirframes = slot.activeSortieIds.length;
        continue;
      }

      const wasPreparing = slot.cooldownRemainingSec > 0 || slot.readyAirframes === 0;
      if (slot.cooldownRemainingSec > 0) {
        slot.cooldownRemainingSec = Math.max(0, slot.cooldownRemainingSec - dtSec);
      }
      if (wasPreparing && slot.cooldownRemainingSec === 0 && slot.reserveAirframes > 0) {
        slot.reserveAirframes -= 1;
        slot.readyAirframes += 1;
      }
      while (slot.turnaroundSupplies > 0 && slot.turnaroundQueue.length > 0 &&
             slot.turnaroundQueue[0].readyAtSimTime <= nextSimTime) {
        const completed = slot.turnaroundQueue.shift()!;
        slot.turnaroundSupplies -= 1;
        slot.readyAirframes += 1;
        logs.push({
          id: `turnaround_ready_${unit.id}_${slot.slotId}_${completed.sortieId}_${nextSimTime}`,
          simTime: nextSimTime,
          side: unit.side,
          category: 'EVENT',
          severity: 'info',
          title: `${slot.squadronName} 完成整备`,
          message: `回收波次 ${completed.sortieId} 已完成加油挂弹，可再次出动；剩余补给 ${slot.turnaroundSupplies} 批。`,
          unitId: unit.id,
          aarType: 'turnaround',
        });
      }
    }
    if (!unitActive) continue;

    // Deterministic ship / submarine / base Damage Control (DC) firefighting, dewatering & emergency repair
    if (unit.subsystems && unit.domain !== 'air') {
      const sub = unit.subsystems;
      if (sub.fire > 0) {
        sub.fire = Math.max(0, Number((sub.fire - 0.012 * dtSec).toFixed(4)));
      }
      if (sub.flooding > 0) {
        sub.flooding = Math.max(0, Number((sub.flooding - 0.008 * dtSec).toFixed(4)));
      }
      if (sub.fire < 0.25) {
        const repairCeiling = 0.6;
        if (sub.sensors > 0 && sub.sensors < repairCeiling) {
          sub.sensors = Math.min(repairCeiling, Number((sub.sensors + 0.003 * dtSec).toFixed(4)));
        }
        if (sub.propulsion > 0 && sub.propulsion < repairCeiling) {
          sub.propulsion = Math.min(repairCeiling, Number((sub.propulsion + 0.003 * dtSec).toFixed(4)));
        }
        if (sub.weapons > 0 && sub.weapons < repairCeiling) {
          sub.weapons = Math.min(repairCeiling, Number((sub.weapons + 0.003 * dtSec).toFixed(4)));
        }
      }
    }

    const canReloadMag = unit.magazineStores && getUnitCapabilities(unit).canFire;
    for (const mount of unit.mounts) {
      if (mount.cooldownRemainingSec > 0) {
        mount.cooldownRemainingSec = Math.max(
          0,
          mount.cooldownRemainingSec - dtSec
        );
      }
      if (canReloadMag && unit.magazineStores) {
        const storeQty = unit.magazineStores[mount.weaponId] ?? 0;
        if (mount.currentAmmo < mount.maxAmmo && storeQty > 0 && mount.cooldownRemainingSec <= 0) {
          const cycleSec = resolveMagazineReloadCycleSec(unit, mount, catalog);
          const nextRem = (mount.magazineReloadRemainingSec ?? cycleSec) - dtSec;
          if (nextRem <= 1e-6) {
            const wasDepleted = mount.currentAmmo === 0;
            mount.currentAmmo += 1;
            const leftInStore = storeQty - 1;
            unit.magazineStores[mount.weaponId] = leftInStore;
            mount.magazineReloadRemainingSec =
              mount.currentAmmo < mount.maxAmmo && leftInStore > 0 ? cycleSec : undefined;
            if (wasDepleted || mount.currentAmmo === mount.maxAmmo || leftInStore === 0) {
              logs.push({
                id: `mag_reload_${unit.id}_${mount.mountId}_${nextSimTime}`,
                simTime: nextSimTime,
                side: unit.side,
                category: 'DOCTRINE',
                severity: 'info',
                title: `${unit.callsign} 弹药库自动补弹 (${mount.weaponName})`,
                message: `挂架就绪弹药恢复至 ${mount.currentAmmo}/${mount.maxAmmo} 发，弹药库余量 ${leftInStore} 发。`,
                position: [...unit.position],
                unitId: unit.id,
                weaponId: mount.weaponId,
              });
            }
          } else {
            mount.magazineReloadRemainingSec = Number(nextRem.toFixed(3));
          }
        } else {
          mount.magazineReloadRemainingSec = undefined;
        }
      }
    }

    const configuration = configurations.get(unit.id)!;
    updateUnitOperations(
      unit,
      units,
      previousContacts,
      missions,
      catalog,
      nextSimTime,
      dtSec,
      score,
      logs,
      weaponsInFlight,
      environment,
      playerSide
    );
    if (!isActiveUnit(unit)) continue;

    const propPerf =
      unit.throttleSetting !== undefined || configuration.platform.dbid !== undefined
        ? resolvePropulsionAtAltitude(
            configuration.platform,
            catalog,
            unit.altitudeM,
            unit.throttleSetting ?? 2,
            configuration.maxSpeedKts,
            configuration.cruiseSpeedKts,
            configuration.loadout?.speedPenaltyKts ?? 0
          )
        : undefined;
    const speedLimit =
      (propPerf ? propPerf.bandMaxSpeedKts : configuration.maxSpeedKts) *
      getUnitCapabilities(unit).speedFactor;
    if (
      propPerf &&
      unit.throttleSetting !== undefined &&
      unit.status !== 'returning' &&
      unit.status !== 'evading' &&
      !unit.airRefuelState &&
      (unit.waypoints.length === 0 || unit.waypoints[0].speedKts === undefined)
    ) {
      unit.targetSpeedKts = Math.min(speedLimit, propPerf.targetSpeedKts);
    }
    if (unit.navigationMode === 'formation' && unit.status !== 'returning') {
      const leader = unit.formationLeaderId ? units[unit.formationLeaderId] : undefined;
      if (leader && isActiveUnit(leader) && leader.status !== 'returning' && unit.formationOffset) {
        const desired = turf.destination(
          leader.position,
          unit.formationOffset.distanceKm,
          (leader.heading + unit.formationOffset.relativeBearingDeg + 360) % 360,
          { units: 'kilometers' }
        ).geometry.coordinates as [number, number];
        unit.waypoints = [{
          position: desired,
          speedKts: Math.min(speedLimit, leader.targetSpeedKts),
          altitudeM: Math.max(configuration.platform.minAltitudeM,
            Math.min(configuration.platform.maxAltitudeM, leader.targetAltitudeM)),
        }];
      } else {
        unit.navigationMode = unit.assignedMissionId ? 'mission' : 'manual';
        unit.formationLeaderId = undefined;
        unit.formationOffset = undefined;
        unit.waypoints = [];
      }
    }
    const assignedMission = unit.assignedMissionId
      ? missions.find((candidate) => candidate.id === unit.assignedMissionId && candidate.isActive)
      : undefined;
    if (unit.waypoints.length === 0 && assignedMission &&
        unit.navigationMode !== 'manual' && unit.status !== 'returning') {
      if (assignedMission.type === 'aew_support' || assignedMission.type === 'tanker_support') {
        const routeIndex = (unit.missionRouteIndex ?? 0) % assignedMission.areaPolygon.length;
        unit.waypoints.push({ position: [...assignedMission.areaPolygon[routeIndex]] });
        unit.missionRouteIndex = (routeIndex + 1) % assignedMission.areaPolygon.length;
        if (unit.missionState !== 'on_station') unit.missionState = 'ingress';
      } else if (assignedMission.type !== 'escort') {
        unit.waypoints.push({
          position: turf.pointOnFeature(
            getCompiledPolygon(assignedMission.areaPolygon).feature
          ).geometry.coordinates as [number, number],
        });
      }
    }

    if (unit.waypoints.length > 0) {
      const targetWaypoint = unit.waypoints[0];
      if (targetWaypoint.speedKts !== undefined) {
        unit.targetSpeedKts = Math.max(0, Math.min(speedLimit, targetWaypoint.speedKts));
      }
      if (targetWaypoint.altitudeM !== undefined) {
        unit.targetAltitudeM = Math.max(
          configuration.platform.minAltitudeM,
          Math.min(configuration.platform.maxAltitudeM, targetWaypoint.altitudeM)
        );
      }
    }

    unit.targetSpeedKts = Math.max(
      0,
      Math.min(speedLimit, unit.targetSpeedKts)
    );
    unit.speedKts = Math.max(0, Math.min(speedLimit, unit.speedKts));

    if (Math.abs(unit.altitudeM - unit.targetAltitudeM) > 1) {
      const climbRateMps = unit.domain === 'air' ? 35 : 4;
      const maxDeltaAlt = climbRateMps * dtSec;
      const diff = unit.targetAltitudeM - unit.altitudeM;
      unit.altitudeM +=
        Math.sign(diff) * Math.min(Math.abs(diff), maxDeltaAlt);
    }

    if (Math.abs(unit.speedKts - unit.targetSpeedKts) > 0.5) {
      const accelKtsPerSec = unit.domain === 'air' ? 15 : 1.5;
      const diff = unit.targetSpeedKts - unit.speedKts;
      unit.speedKts +=
        Math.sign(diff) * Math.min(Math.abs(diff), accelKtsPerSec * dtSec);
    }

    if (unit.speedKts <= 0.1) continue;
    const stepDistKm = (unit.speedKts * KTS_TO_KMPH * dtSec) / 3600;

    if (unit.waypoints.length > 0) {
      const targetWaypoint = unit.waypoints[0];
      const distanceToWaypointKm = getDistanceKm(
        unit.position,
        targetWaypoint.position
      );
      unit.heading = getBearingDeg(unit.position, targetWaypoint.position);

      if (distanceToWaypointKm <= stepDistKm * 1.25) {
        if (!isRouteAllowed(unit.domain, unit.position, targetWaypoint.position, environment)) {
          unit.speedKts = unit.targetSpeedKts = 0;
          unit.waypoints = [];
          logs.push({ id: `environment_block_${unit.id}_${nextSimTime}`, simTime: nextSimTime,
            side: unit.side, category: 'DOCTRINE', severity: 'warning',
            title: `${unit.callsign} 航路被环境边界阻断`, message: '海陆域规则拒绝本段移动，单位已停车等待新命令。',
            position: [...unit.position], unitId: unit.id });
          continue;
        }
        unit.position = [...targetWaypoint.position];
        unit.waypoints.shift();
        if (assignedMission?.type === 'aew_support' || assignedMission?.type === 'tanker_support') {
          unit.missionState = 'on_station';
        }
      } else {
        const candidate = turf.destination(
          unit.position,
          stepDistKm,
          unit.heading,
          { units: 'kilometers' }
        ).geometry.coordinates as [number, number];
        if (isRouteAllowed(unit.domain, unit.position, candidate, environment)) unit.position = candidate;
        else {
          unit.speedKts = unit.targetSpeedKts = 0;
          unit.waypoints = [];
          logs.push({ id: `environment_block_${unit.id}_${nextSimTime}`, simTime: nextSimTime,
            side: unit.side, category: 'DOCTRINE', severity: 'warning',
            title: `${unit.callsign} 航路被环境边界阻断`, message: '海陆域规则拒绝本段移动，单位已停车等待新命令。',
            position: [...unit.position], unitId: unit.id });
        }
      }
    } else {
      if (unit.domain === 'air') {
        unit.heading = (unit.heading + 1.8 * dtSec) % 360;
      }
      const candidate = turf.destination(
        unit.position,
        stepDistKm,
        unit.heading,
        { units: 'kilometers' }
      ).geometry.coordinates as [number, number];
      if (isRouteAllowed(unit.domain, unit.position, candidate, environment)) unit.position = candidate;
      else unit.speedKts = unit.targetSpeedKts = 0;
    }
  }
}
