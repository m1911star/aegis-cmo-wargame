import { create } from 'zustand';
import type {
  EquipmentCatalog,
  PlayMode,
  ScenarioDefinition,
  SideId,
} from '../types/wargame';
import { BUILTIN_SCENARIOS, SCENARIO_EAST_SEA_THUNDER } from '../scenarios/builtinScenarios';
import { MASTER_EQUIPMENT_CATALOG } from '../db/index';

// ============================================================================
// AEGIS-CMO // 想定配置状态存储（当前想定、装备目录、玩家设定）
// 职责：管理想定切换、装备目录与玩家配置
// ============================================================================

export interface ScenarioStoreState {
  // --- 想定与装备目录 ---
  currentScenario: ScenarioDefinition;
  availableScenarios: ScenarioDefinition[];
  catalog: EquipmentCatalog;

  // --- 玩家设定 ---
  playerSide: SideId;
  playMode: PlayMode;
}

export interface ScenarioStoreActions {
  setPlayerSide: (side: SideId) => void;
  setPlayMode: (mode: PlayMode) => void;
  loadScenario: (scenario: ScenarioDefinition) => void;
}

export const useScenarioStore = create<ScenarioStoreState & ScenarioStoreActions>()((set) => ({
  // 初始状态
  currentScenario: SCENARIO_EAST_SEA_THUNDER,
  availableScenarios: BUILTIN_SCENARIOS,
  catalog: MASTER_EQUIPMENT_CATALOG,

  playerSide: 'RED',
  playMode: 'command',

  // Actions
  setPlayerSide: (side) => set({ playerSide: side }),
  setPlayMode: (mode) => set({ playMode: mode }),

  loadScenario: (scenario) =>
    set({
      currentScenario: scenario,
      // 可能需要重新编译装备目录
      catalog: {
        ...MASTER_EQUIPMENT_CATALOG,
        ...(scenario.customCatalogOverlay || {}),
      },
    }),
}));
