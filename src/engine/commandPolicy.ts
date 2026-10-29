import type { CombatLogEntry, PlayMode, RuntimeUnit, SideId, TacticalContact } from '../types/wargame';
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

export function visibleLogs(logs: CombatLogEntry[], side: SideId, sandbox: boolean) {
  return sandbox ? logs : logs.filter((log) => log.side === side || log.side === 'SYSTEM');
}

export function contactForUnit(contacts: Record<string, TacticalContact>, side: SideId, unitId: string) {
  return Object.values(contacts).find((contact) => contact.observerSide === side && contact.actualUnitId === unitId);
}
