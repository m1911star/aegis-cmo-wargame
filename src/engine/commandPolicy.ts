import type { CombatLogEntry, PlayMode, RuntimeUnit, ScenarioObjective, SideId, TacticalContact } from '../types/wargame';
import { objectiveResolutionLogId } from './objectives';
import { isActiveUnit } from './unitCapabilities';

export interface CommandContext {
  playerSide: SideId;
  playMode: PlayMode;
  battleResult?: unknown;
}

export function canCommandUnit(context: CommandContext, unit?: RuntimeUnit): unit is RuntimeUnit {
  return !!unit && !context.battleResult && isActiveUnit(unit) &&
    (context.playMode === 'sandbox' || unit.side === context.playerSide);
}

export function visibleLogs(logs: CombatLogEntry[], side: SideId, reveal: boolean, objectives: readonly ScenarioObjective[]) {
  if (reveal) return logs;
  const areaGoals = objectives.filter((goal) => goal.type === 'control_area' && goal.side === side);
  return logs.filter((log) => (log.side === side || log.side === 'SYSTEM') &&
    !(log.category === 'EVENT' && areaGoals.some((goal) => log.id === objectiveResolutionLogId(goal.id, log.simTime))));
}

export function contactForUnit(contacts: Record<string, TacticalContact>, side: SideId, unitId: string) {
  return Object.values(contacts).find((contact) => contact.observerSide === side && contact.actualUnitId === unitId);
}
