import type { BattleResult, CombatLogEntry, ObjectiveProgress, RuntimeUnit, ScenarioObjective, ScoreLedger, TacticalContact, VictoryConditionRule } from '../types/wargame';
import { getUnitCapabilities } from './unitCapabilities';

export function creditDamage(
  score: ScoreLedger, victim: RuntimeUnit, ledger: Record<string, number>, fraction: number,
  victory?: VictoryConditionRule
): number {
  if (victim.side === 'NEUTRAL') return 0;
  const base = victim.category === 'carrier' ? 400 : ['awacs', 'ssn'].includes(victim.category) ? 220 : 150;
  const bonus = (victory?.keyTargetBonuses ?? []).filter((rule) =>
    rule.victimSide === victim.side && (!rule.unitId || rule.unitId === victim.id) &&
    (!rule.category || rule.category === victim.category)
  ).reduce((sum, rule) => sum + rule.bonusPoints, 0);
  const total = Math.round(base * Math.max(0, Math.min(1, fraction))) + (fraction >= 1 ? bonus : 0);
  const reward = Math.max(0, total - (ledger[victim.id] ?? 0));
  ledger[victim.id] = Math.max(ledger[victim.id] ?? 0, total);
  if (victim.side === 'RED') score.blueScore += reward;
  else score.redScore += reward;
  return reward;
}

export function evaluateObjectives(
  objectives: ScenarioObjective[], previous: ObjectiveProgress, units: Record<string, RuntimeUnit>,
  contacts: Record<string, TacticalContact>, score: ScoreLedger, simTime: number, startTime: number,
  victory?: VictoryConditionRule
) {
  const progress = { ...previous };
  const logs: CombatLogEntry[] = [];
  const timedOut = !!victory && simTime - startTime >= victory.durationSec * 1000;
  for (const objective of objectives) {
    if (previous[objective.id] === 'achieved' || previous[objective.id] === 'failed') continue;
    const targets = objective.unitIds.map((id) => units[id]);
    const destroyed = (unit: RuntimeUnit | undefined) => !!unit && (unit.hp <= 0 || unit.status === 'destroyed');
    const preservationLost = (unit: RuntimeUnit | undefined) => destroyed(unit) ||
      (!!unit && objective.preserveCapability === true && getUnitCapabilities(unit).state === 'mission_killed');
    const allPresent = targets.every(Boolean);
    const achieved = objective.type === 'destroy' ? targets.every(destroyed)
      : objective.type === 'disable' ? allPresent && targets.every((unit) => getUnitCapabilities(unit).state === 'mission_killed')
      : objective.type === 'preserve' ? timedOut && allPresent && targets.every((unit) => !preservationLost(unit))
      : objective.type === 'withdraw' ? allPresent && targets.every((unit) => unit.status === 'recovered')
      : objective.unitIds.every((id) => Object.values(contacts).some((contact) => contact.observerSide === objective.side && contact.actualUnitId === id));
    const failed = !achieved && (timedOut || (objective.type === 'preserve' && targets.some(preservationLost)));
    progress[objective.id] = achieved ? 'achieved' : failed ? 'failed' : 'pending';
    if (achieved) {
      if (objective.side === 'RED') score.redScore += objective.points;
      else score.blueScore += objective.points;
    }
    if (achieved || failed) logs.push({ id: `objective_${objective.id}_${simTime}`, simTime,
      side: objective.side, category: 'EVENT', severity: failed ? 'warning' : 'info',
      title: `${achieved ? '目标达成' : '目标未达成'}：${objective.title}`,
      message: achieved ? `任务奖励 ${objective.points} 分。` : '按该目标的必需性和失败规则结算，不以单次战损统一判负。' });
  }
  const critical = objectives.filter((o) => o.criticalFailure && progress[o.id] === 'failed');
  let battleResult: BattleResult | undefined;
  if (timedOut || critical.length) {
    const outcome = (side: 'RED' | 'BLUE'): BattleResult['outcomes']['RED'] => {
      if (critical.some((o) => o.side === side)) return 'defeat';
      const required = objectives.filter((o) => o.side === side && o.required);
      if (required.length) {
        if (!required.every((o) => progress[o.id] === 'achieved')) return 'defeat';
        return (side === 'RED' ? score.redLosses : score.blueLosses) > 0 ? 'costly_victory' : 'victory';
      }
      const advantage = side === 'RED' ? score.redScore - score.blueScore : score.blueScore - score.redScore;
      const threshold = victory?.tacticalVictoryThreshold ?? 120;
      return advantage >= threshold ? 'victory' : advantage <= -threshold ? 'defeat' : 'draw';
    };
    battleResult = { endedAt: simTime, reason: critical.length ? 'critical_objective' : 'time_limit',
      outcomes: { RED: outcome('RED'), BLUE: outcome('BLUE') } };
    logs.push({ id: `battle_end_${simTime}`, simTime, side: 'SYSTEM', category: 'EVENT', severity: 'info',
      title: '想定结束', message: '仿真已停止。请核对主要目标、付出的代价与关键战报。' });
  }
  return { progress, logs, battleResult };
}
