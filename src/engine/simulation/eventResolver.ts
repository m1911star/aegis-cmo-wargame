import type {
  CombatLogEntry,
  EquipmentCatalog,
  ObjectiveHoldProgress,
  ObjectiveProgress,
  PendingSortieOrder,
  RuntimeScenarioEvent,
  RuntimeUnit,
  ScenarioObjective,
  ScoreLedger,
  TacticalContact,
  TacticalMission,
  VictoryConditionRule,
} from '../../types/wargame';
import { evaluateCarrierSortieAvailability, launchCarrierSortie } from '../carrierOperations';
import { evaluateObjectives, resolveWithdrawalAreas } from '../objectives';
import { getEventOccurrences } from '../scenarioEvents';
import { createRuntimeUnitFromPlacement } from './unitFactory';

const THREAT_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

export type EventResolutionContext = {
  events: RuntimeScenarioEvent[];
  pendingSortieOrders: PendingSortieOrder[];
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  missions: TacticalMission[];
  catalog: EquipmentCatalog;
  nextSimTime: number;
  startTime: number;
  dtSec?: number;
  score: ScoreLedger;
  rng: () => number;
  logs: CombatLogEntry[];
  objectives: ScenarioObjective[];
  objectiveProgress: ObjectiveProgress;
  objectiveHoldProgress?: ObjectiveHoldProgress;
  victoryConditions?: VictoryConditionRule;
};

/** Apply triggered scenario actions, then evaluate objectives for the new world. */
export function resolveEventsAndObjectives({
  events,
  pendingSortieOrders,
  units,
  contacts,
  missions,
  catalog,
  nextSimTime,
  startTime,
  dtSec = 0,
  score,
  rng,
  logs,
  objectives,
  objectiveProgress,
  objectiveHoldProgress = {},
  victoryConditions,
}: EventResolutionContext): ReturnType<typeof evaluateObjectives> {
  const elapsedSec = Math.max(0, (nextSimTime - startTime) / 1000);

  for (const event of events) {
    if (
      !event.repeatable &&
      (event.hasFired || score.firedEventIds.includes(event.id))
    ) {
      continue;
    }

    const occurrences = getEventOccurrences(
      event,
      units,
      contacts,
      elapsedSec
    );
    for (let occurrence = 0; occurrence < occurrences; occurrence++) {
      event.hasFired = true;
      event.fireCount = (event.fireCount ?? 0) + 1;
      if (!score.firedEventIds.includes(event.id)) {
        score.firedEventIds.push(event.id);
      }

      for (const [actionIndex, action] of event.actions.entries()) {
        if (action.type === 'SPAWN_REINFORCEMENTS') {
          for (const placement of action.units) {
            if (
              placement.appearProbability !== undefined &&
              rng() >= placement.appearProbability
            ) {
              continue;
            }
            let spawnedId = placement.id;
            let suffix = event.fireCount;
            while (Object.hasOwn(units, spawnedId)) {
              spawnedId = `${placement.id}__${event.id}_${suffix++}`;
            }
            const spawned = createRuntimeUnitFromPlacement(
              { ...placement, id: spawnedId },
              catalog,
              rng
            );
            units[spawned.id] = spawned;
            logs.push({
              id: `log_ev_spawn_${nextSimTime}_${spawned.id}`,
              simTime: nextSimTime,
              side: spawned.side,
              category: 'EVENT',
              severity: 'warning',
              title: `[战役增援抵达] ${spawned.name} 进入战区！`,
              message: `事件 [${event.name}] 触发：${spawned.name} (${spawned.callsign}) 已在 [${spawned.position[0].toFixed(
                2
              )}°E, ${spawned.position[1].toFixed(2)}°N] 投入战斗序列！`,
              position: [...spawned.position],
              unitId: spawned.id,
            });
          }
        } else if (action.type === 'ACTIVATE_MISSION') {
          for (const mission of missions) {
            if (mission.id === action.missionId) {
              mission.isActive = action.isActive;
            }
          }
        } else if (action.type === 'UPDATE_SIDE_DOCTRINE') {
          for (const unit of Object.values(units)) {
            if (unit.hp <= 0 || unit.side !== action.side) continue;
            if (action.groupId && unit.parentGroupId !== action.groupId) {
              continue;
            }
            unit.doctrine = { ...unit.doctrine, ...action.doctrinePatch };
          }
        } else if (action.type === 'LAUNCH_SORTIE') {
          const availability = evaluateCarrierSortieAvailability(
            units, catalog, action.carrierUnitId, action.hangarSlotId, action.loadoutId
          );
          const delayed = (action.launchDelaySec ?? 0) > 0;
          if (delayed || availability.status !== 'ready') {
            const orderId = `sortie_order_${event.id}_${event.fireCount}_${actionIndex}`;
            const order: PendingSortieOrder = {
              orderId,
              eventId: event.id,
              carrierUnitId: action.carrierUnitId,
              hangarSlotId: action.hangarSlotId,
              loadoutId: action.loadoutId,
              assignedMissionId: action.assignedMissionId,
              earliestLaunchTime: nextSimTime + (action.launchDelaySec ?? 0) * 1000,
              attempts: 0,
              status: availability.status === 'permanent' ? 'failed' : 'pending',
              failureReason: availability.status === 'permanent' ? availability.reason : undefined,
            };
            if (!pendingSortieOrders.some((candidate) => candidate.orderId === orderId)) {
              pendingSortieOrders.push(order);
              logs.push({
                id: `log_ev_sortie_order_${nextSimTime}_${orderId}`,
                simTime: nextSimTime,
                side: units[action.carrierUnitId]?.side ?? 'SYSTEM',
                category: 'EVENT',
                severity: order.status === 'failed' ? 'critical' : 'warning',
                title: order.status === 'failed' ? '[事件出动明确失败]' : '[事件出动进入待执行队列]',
                message: `${event.name}: ${availability.reason}${delayed ? `；最早 ${action.launchDelaySec} 秒后执行` : ''}。`,
                unitId: action.carrierUnitId,
              });
            }
          } else {
            const launched = launchCarrierSortie(
              units, catalog, action.carrierUnitId, action.hangarSlotId, action.loadoutId
            );
            if (launched) {
              if (action.assignedMissionId && missions.some((mission) =>
                mission.id === action.assignedMissionId && mission.side === launched.side)) {
                launched.assignedMissionId = action.assignedMissionId;
                launched.navigationMode = 'mission';
                launched.missionState = 'ingress';
              }
              score.sortiesLaunched = (score.sortiesLaunched ?? 0) + 1;
              logs.push({
                id: `log_ev_sortie_${nextSimTime}_${launched.id}`,
                simTime: nextSimTime,
                side: launched.side,
                category: 'EVENT',
                severity: 'warning',
                title: `[事件驱动出动] ${launched.callsign} 弹射升空`,
                message: `${event.name} 触发 ${launched.name}，挂载 ${catalog.loadouts[launched.activeLoadoutId ?? '']?.name ?? launched.activeLoadoutId ?? '默认'}。`,
                position: [...launched.position],
                unitId: launched.id,
                aarType: 'sortie',
              });
            }
          }
        } else if (action.type === 'ASSIGN_MISSION') {
          for (const unit of Object.values(units)) {
            if (unit.hp <= 0 || unit.status === 'destroyed' || unit.side !== action.side ||
                action.unitId && unit.id !== action.unitId ||
                action.groupId && unit.parentGroupId !== action.groupId) continue;
            unit.assignedMissionId = action.missionId;
            unit.navigationMode = action.missionId ? 'mission' : 'manual';
            unit.missionState = action.missionId ? 'ingress' : undefined;
            unit.missionRouteIndex = 0;
            unit.missionTargetId = undefined;
            unit.formationLeaderId = undefined;
            unit.formationOffset = undefined;
            unit.waypoints = [];
          }
        } else if (action.type === 'TOGGLE_SIDE_EMCON') {
          const field = action.sensor === 'radar' ? 'emconRadar'
            : action.sensor === 'sonar' ? 'emconSonar' : 'emconJamming';
          for (const unit of Object.values(units)) {
            if (unit.hp <= 0 || unit.status === 'destroyed' || unit.side !== action.side ||
                action.groupId && unit.parentGroupId !== action.groupId) continue;
            unit.doctrine = { ...unit.doctrine, [field]: !unit.doctrine[field] };
          }
        } else if (action.type === 'COORDINATE_ATTACK') {
          const target = Object.values(contacts).filter((contact) =>
            contact.observerSide === action.side &&
            (!action.targetDomain || contact.domain === action.targetDomain) &&
            nextSimTime - contact.lastDetectedTime <= 5000
          ).sort((a, b) => THREAT_RANK[b.threatLevel] - THREAT_RANK[a.threatLevel] ||
            b.lastDetectedTime - a.lastDetectedTime || a.id.localeCompare(b.id))[0];
          if (target) {
            let coordinatedUnits = 0;
            for (const unit of Object.values(units)) {
              if (unit.hp <= 0 || unit.status === 'destroyed' || unit.status === 'returning' ||
                  unit.side !== action.side || action.groupId && unit.parentGroupId !== action.groupId ||
                  !unit.mounts.some((mount) => mount.currentAmmo > 0)) continue;
              unit.coordinatedAttack = {
                contactId: target.id,
                releaseAtSimTime: nextSimTime + action.delaySec * 1000,
              };
              coordinatedUnits += 1;
            }
            logs.push({
              id: `log_ev_coord_${nextSimTime}_${event.id}_${event.fireCount}_${actionIndex}`,
              simTime: nextSimTime,
              side: action.side,
              category: 'DOCTRINE',
              severity: 'warning',
              title: `协同攻击窗口已建立：${coordinatedUnits} 个火力单元`,
              message: `基于本方接触 ${target.displayName}，将在 ${action.delaySec} 秒后同步释放武器。`,
              position: [...target.estimatedPosition],
              contactId: target.id,
            });
          }
        } else if (action.type === 'BROADCAST_MESSAGE') {
          logs.push({
            id: `log_ev_msg_${nextSimTime}_${event.id}_${event.fireCount}_${actionIndex}`,
            simTime: nextSimTime,
            side: action.side,
            category: 'EVENT',
            severity: action.severity,
            title: `[战役事件 // ${event.name}] ${action.title}`,
            message: action.message,
            position: action.position,
          });
        } else if (action.type === 'AWARD_SCORE') {
          if (action.side === 'RED') score.redScore += action.points;
          else score.blueScore += action.points;
        }
      }
    }
  }

  resolveWithdrawalAreas(objectives, units, nextSimTime, logs);
  return evaluateObjectives(
    objectives,
    objectiveProgress,
    units,
    contacts,
    score,
    nextSimTime,
    startTime,
    victoryConditions,
    dtSec,
    objectiveHoldProgress
  );
}
