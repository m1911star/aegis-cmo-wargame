import type {
  BattleResult,
  CombatLogEntry,
  MissionDefinition,
  ObjectiveProgress,
  RuntimeScenarioEvent,
  RuntimeUnit,
  ScenarioObjective,
  ScoreLedger,
  SideId,
  TacticalContact,
  TacticalExplosionEffect,
  TacticalMission,
  VictoryConditionRule,
  WeaponInFlight,
} from '../../types/wargame';

export interface SimulationWorldState {
  tick?: number;
  rngState?: number;
  objectives?: ScenarioObjective[];
  objectiveProgress?: ObjectiveProgress;
  battleResult?: BattleResult;
  creditedDamage?: Record<string, number>;
  detectedMissileIds?: string[];
  startTime?: number;
  simTime: number;
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  explosions: TacticalExplosionEffect[];
  missions: MissionDefinition[];
  events?: RuntimeScenarioEvent[];
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
