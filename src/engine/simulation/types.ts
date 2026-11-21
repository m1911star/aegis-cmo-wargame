import type {
  BattleAarLedger,
  BattleResult,
  CombatLogEntry,
  MissionDefinition,
  ObjectiveHoldProgress,
  ObjectiveProgress,
  PendingSortieOrder,
  PendingTotStrikeOrder,
  RuntimeScenarioEvent,
  RuntimeUnit,
  ScenarioEnvironment,
  ScenarioObjective,
  ScoreLedger,
  SideId,
  TacticalContact,
  TacticalExplosionEffect,
  TacticalMission,
  VictoryConditionRule,
  WeaponInFlight,
} from '../../types/wargame';

import type { ExerciseTask } from '../exerciseTask';

export interface SimulationWorldState {
  exerciseTask?: ExerciseTask;
  tick?: number;
  rngState?: number;
  objectives?: ScenarioObjective[];
  objectiveProgress?: ObjectiveProgress;
  objectiveHoldProgress?: ObjectiveHoldProgress;
  battleResult?: BattleResult;
  creditedDamage?: Record<string, number>;
  detectedMissileIds?: string[];
  aar?: BattleAarLedger;
  startTime?: number;
  simTime: number;
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  explosions: TacticalExplosionEffect[];
  missions: MissionDefinition[];
  events?: RuntimeScenarioEvent[];
  pendingSortieOrders?: PendingSortieOrder[];
  pendingTotStrikeOrders?: PendingTotStrikeOrder[];
  environment?: ScenarioEnvironment;
  victoryConditions?: VictoryConditionRule;
  score: ScoreLedger;
}

export interface SimulationStepResult {
  nextState: SimulationWorldState & { missions: TacticalMission[] };
  newLogs: CombatLogEntry[];
  shouldAutoPause: boolean;
  autoPauseReason?: string;
}

export type PauseTrigger = (
  condition: boolean,
  reason: string,
  relevantSide: SideId | 'SYSTEM'
) => void;
