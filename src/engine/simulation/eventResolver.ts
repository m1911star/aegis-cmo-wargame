import type {
  CombatLogEntry,
  EquipmentCatalog,
  ObjectiveProgress,
  RuntimeScenarioEvent,
  RuntimeUnit,
  ScenarioObjective,
  ScoreLedger,
  TacticalContact,
  TacticalMission,
  VictoryConditionRule,
} from '../../types/wargame';
import { evaluateObjectives } from '../objectives';
import { getEventOccurrences } from '../scenarioEvents';
import { createRuntimeUnitFromPlacement } from './unitFactory';

export type EventResolutionContext = {
  events: RuntimeScenarioEvent[];
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  missions: TacticalMission[];
  catalog: EquipmentCatalog;
  nextSimTime: number;
  startTime: number;
  score: ScoreLedger;
  rng: () => number;
  logs: CombatLogEntry[];
  objectives: ScenarioObjective[];
  objectiveProgress: ObjectiveProgress;
  victoryConditions?: VictoryConditionRule;
};

/** Apply triggered scenario actions, then evaluate objectives for the new world. */
export function resolveEventsAndObjectives({
  events,
  units,
  contacts,
  missions,
  catalog,
  nextSimTime,
  startTime,
  score,
  rng,
  logs,
  objectives,
  objectiveProgress,
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

  return evaluateObjectives(
    objectives,
    objectiveProgress,
    units,
    contacts,
    score,
    nextSimTime,
    startTime,
    victoryConditions
  );
}
