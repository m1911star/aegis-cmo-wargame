import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  ActivePerspective,
  AutoPauseSettings,
  BattleResult,
  CombatLogEntry,
  EquipmentCatalog,
  ObjectiveProgress,
  PlayMode,
  ReferencePoint,
  RuntimeScenarioEvent,
  RuntimeUnit,
  ScenarioDefinition,
  ScoreLedger,
  SideId,
  TacticalContact,
  TacticalExplosionEffect,
  TacticalMission,
  TimeScale,
  WeaponInFlight,
} from '../types/wargame';

// ============================================================================
// AEGIS-CMO // 核心仿真状态存储（单位、接触、武器、推演时钟）
// 职责：管理战场实时态势实体与半实时推演时钟
// ============================================================================

export interface SimulationStoreState {
  // --- 半实时时钟与种子 ---
  startTime: number;
  simTime: number;
  timeScale: TimeScale;
  seed: number;
  rngState: number;
  tick: number;
  pendingSimSeconds: number;
  commandSequence: number;

  // --- 战场实时态势实体 ---
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  explosions: TacticalExplosionEffect[];
  missions: TacticalMission[];
  events: RuntimeScenarioEvent[];
  referencePoints: ReferencePoint[];
  combatLog: CombatLogEntry[];

  // --- 评分与目标进度 ---
  scoreLedger: ScoreLedger;
  objectiveProgress: ObjectiveProgress;
  battleResult?: BattleResult;
  creditedDamage: Record<string, number>;
  detectedMissileIds: string[];

  // --- 视角与自动暂停 ---
  activePerspective: ActivePerspective;
  autoPause: AutoPauseSettings;
  lastAutoPauseBanner: string | null;
}

export interface SimulationStoreActions {
  setTimeScale: (scale: TimeScale) => void;
  setActivePerspective: (perspective: ActivePerspective) => void;
  reset: () => void;
}

// 初始状态工厂函数
export function createInitialSimulationState(): SimulationStoreState {
  return {
    startTime: Date.now(),
    simTime: 0,
    timeScale: 0,
    seed: 42,
    rngState: 42,
    tick: 0,
    pendingSimSeconds: 0,
    commandSequence: 0,

    units: {},
    contacts: {},
    weaponsInFlight: {},
    explosions: [],
    missions: [],
    events: [],
    referencePoints: [],
    combatLog: [],

    scoreLedger: {
      redLosses: 0,
      blueLosses: 0,
      redMissilesFired: 0,
      blueMissilesFired: 0,
      redInterceptions: 0,
      blueInterceptions: 0,
      redScore: 0,
      blueScore: 0,
      firedEventIds: [],
      sortiesLaunched: 0,
    },
    objectiveProgress: {},
    creditedDamage: {},
    detectedMissileIds: [],

    activePerspective: 'GOD',
    autoPause: {
      onNewContact: false,
      onMissileDetected: false,
      onUnitHitOrDestroyed: false,
    },
    lastAutoPauseBanner: null,
  };
}

export const useSimulationStore = create<SimulationStoreState & SimulationStoreActions>()(
  subscribeWithSelector((set) => ({
    ...createInitialSimulationState(),

    setTimeScale: (scale) => set({ timeScale: scale }),
    setActivePerspective: (perspective) => set({ activePerspective: perspective }),
    reset: () => set(createInitialSimulationState()),
  }))
);
