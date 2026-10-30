import { create } from 'zustand';
import type { RecordedCommand } from '../engine/determinism';
import type { FireControlSolution } from '../engine/fireControl';

// ============================================================================
// AEGIS-CMO // UI 交互状态存储（选中单位、交互模式、地图图层）
// 职责：管理用户界面交互状态与地图显示配置
// ============================================================================

export type MapInteractionMode =
  | 'select'
  | 'plot_waypoint'
  | 'manual_engage'
  | 'place_ref_point'
  | 'spawn_unit';

export interface MapLayerVisibility {
  showRadarRings: boolean;
  showWeaponRings: boolean;
  showSonarRings: boolean;
  showWaypoints: boolean;
  showMissions: boolean;
  showAouPolygons: boolean;
  showReferencePoints: boolean;
  showSatelliteDarkTiles: boolean;
}

export interface UIStoreState {
  // --- 选中状态 ---
  selectedUnitId: string | null;
  selectedContactId: string | null;
  selectedLogId: string | null;

  // --- 地图交互 ---
  interactionMode: MapInteractionMode;
  mapLayers: MapLayerVisibility;

  // --- 待确认的风险开火 ---
  pendingRiskEngagement: {
    attackerId: string;
    contactId: string;
    weaponId: string;
    salvoCount: number;
    solution: FireControlSolution;
  } | null;

  // --- 命令历史 ---
  commandHistory: RecordedCommand[];
}

export interface UIStoreActions {
  selectUnit: (unitId: string | null) => void;
  selectContact: (contactId: string | null) => void;
  selectLogEntry: (logId: string) => void;
  setInteractionMode: (mode: MapInteractionMode) => void;
  toggleMapLayer: (layer: keyof MapLayerVisibility) => void;
  dismissRiskEngagement: () => void;
  clearSelection: () => void;
}

export const useUIStore = create<UIStoreState & UIStoreActions>()((set) => ({
  // 初始状态
  selectedUnitId: null,
  selectedContactId: null,
  selectedLogId: null,

  interactionMode: 'select',
  mapLayers: {
    showRadarRings: true,
    showWeaponRings: true,
    showSonarRings: false,
    showWaypoints: true,
    showMissions: true,
    showAouPolygons: true,
    showReferencePoints: true,
    showSatelliteDarkTiles: false,
  },

  pendingRiskEngagement: null,
  commandHistory: [],

  // Actions
  selectUnit: (unitId) =>
    set({ selectedUnitId: unitId, selectedContactId: null, interactionMode: 'select' }),

  selectContact: (contactId) =>
    set({ selectedContactId: contactId, selectedUnitId: null, interactionMode: 'select' }),

  selectLogEntry: (logId) =>
    set({ selectedLogId: logId }),

  setInteractionMode: (mode) =>
    set({ interactionMode: mode }),

  toggleMapLayer: (layer) =>
    set((state) => ({
      mapLayers: {
        ...state.mapLayers,
        [layer]: !state.mapLayers[layer],
      },
    })),

  dismissRiskEngagement: () =>
    set({ pendingRiskEngagement: null }),

  clearSelection: () =>
    set({ selectedUnitId: null, selectedContactId: null, interactionMode: 'select' }),
}));
