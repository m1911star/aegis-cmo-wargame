import type { StoreApi } from 'zustand';
import type { RecordedCommand } from '../engine/determinism';
import type { FireControlSolution } from '../engine/fireControl';
import type { SimulationStepResult } from '../engine/simulationEngine';
import type { BasemapMode } from '../map/basemaps';
import type { CampaignState } from '../scenarios/campaign';
import type {
  ActivePerspective,
  AutoPauseSettings,
  BattleAarLedger,
  BattleResult,
  CombatLogEntry,
  Domain,
  EquipmentCatalog,
  MissionType,
  ObjectiveProgress,
  OrbatGroup,
  PlayMode,
  ReferencePoint,
  RouteLeg,
  RuntimeScenarioEvent,
  RuntimeUnit,
  ScenarioDefinition,
  ScenarioEnvironment,
  ScenarioObjective,
  ScoreLedger,
  SideId,
  TacticalContact,
  TacticalExplosionEffect,
  TacticalMission,
  TimeScale,
  UnitCategory,
  UnitDoctrine,
  WeaponInFlight,
} from '../types/wargame';
import type { BattleRecording, BattleSnapshot } from './battleRecording';

export type MapInteractionMode =
  | 'select'
  | 'plot_waypoint'
  | 'manual_engage'
  | 'place_ref_point'
  | 'measure'
  | 'move_unit'
  | 'spawn_unit';

export interface MissionReferencePointDraft {
  name: string;
  type: MissionType;
  referencePointIds: string[];
  prosecuteOutsideAreaKm: number;
  escortUnitId?: string;
  stationRadiusKm?: number;
}

export interface ObjectiveDraft {
  id?: string;
  title: string;
  side: 'RED' | 'BLUE';
  type: ScenarioObjective['type'];
  unitIds: string[];
  required: boolean;
  points: number;
  criticalFailure?: boolean;
  preserveCapability?: boolean;
}

export interface AreaEventDraft {
  name: string;
  side: SideId;
  referencePointIds: string[];
  unitCategory?: UnitCategory;
  message: string;
}

export interface MapLayerVisibility {
  showRadarRings: boolean;
  showWeaponRings: boolean;
  showSonarRings: boolean;
  showWaypoints: boolean;
  showMissions: boolean;
  showAouPolygons: boolean;
  showReferencePoints: boolean;
}

export interface WargameStoreState {
  basemapMode: BasemapMode;
  setBasemapMode: (mode: BasemapMode) => void;
  playerSide: SideId;
  playMode: PlayMode;
  campaignState: CampaignState | null;
  seed: number;
  rngState: number;
  tick: number;
  pendingSimSeconds: number;
  commandSequence: number;
  commandHistory: RecordedCommand[];
  replaySnapshots: BattleSnapshot[];
  objectiveProgress: ObjectiveProgress;
  battleResult?: BattleResult;
  creditedDamage: Record<string, number>;
  detectedMissileIds: string[];
  aar: BattleAarLedger;
  pendingRiskEngagement: { attackerId: string; contactId: string; weaponId: string; salvoCount: number; solution: FireControlSolution } | null;
  setPlayerSide: (side: 'RED' | 'BLUE') => void;
  setPlayMode: (mode: PlayMode) => void;
  dismissRiskEngagement: () => void;
  selectLogEntry: (logId: string) => void;
  hasAutosave: boolean;
  saveAutosaveCheckpoint: () => void;
  restoreAutosaveCheckpoint: () => boolean;
  replayPlayer: { recording: BattleRecording; currentTick: number; isPlaying: boolean; speed: 1 | 5 | 15 } | null;
  startReplayPlayer: (recording: BattleRecording, startTick?: number) => void;
  setReplayPlayerPlaying: (playing: boolean) => void;
  setReplayPlayerSpeed: (speed: 1 | 5 | 15) => void;
  seekReplayPlayer: (tick: number) => void;
  exitReplayPlayer: () => void;

  // --- 想定与装备目录 ---
  currentScenario: ScenarioDefinition;
  availableScenarios: ScenarioDefinition[];
  catalog: EquipmentCatalog;
  groups: OrbatGroup[];
  objectives: ScenarioObjective[];

  // --- 半实时时钟与视角 ---
  startTime: number;
  simTime: number;
  timeScale: TimeScale;
  activePerspective: ActivePerspective;
  autoPause: AutoPauseSettings;
  lastAutoPauseBanner: string | null;

  // --- 战场实时态势实体 ---
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  explosions: TacticalExplosionEffect[];
  missions: TacticalMission[];
  events: RuntimeScenarioEvent[];
  environment: ScenarioEnvironment;
  referencePoints: ReferencePoint[];
  logs: CombatLogEntry[];
  score: ScoreLedger;

  // --- C2 指挥台交互状态 ---
  selectedUnitId: string | null;
  selectedContactId: string | null;
  interactionMode: MapInteractionMode;
  pendingWeaponIdForEngage: string | null;
  pendingSalvoCount: number;
  pendingSpawnConfig: {
    platformId: string;
    loadoutId?: string;
    side: SideId;
    name: string;
    callsign: string;
  } | null;
  mapLayers: MapLayerVisibility;
  cameraFlyToRequest: {
    center: [number, number];
    zoom?: number;
    timestamp: number;
  } | null;

  // --- 弹窗控制 ---
  activeModal:
    | 'none'
    | 'briefing'
    | 'scenario_io'
    | 'aar'
    | 'builder'
    | 'catalog_viewer'
    | 'unit_spawner';

  // --- Actions ---
  loadScenario: (scenario: ScenarioDefinition, randomizeSpawns?: boolean, seed?: number) => void;
  resetScenario: (randomizeSpawns?: boolean) => void;
  startCampaign: (side?: 'RED' | 'BLUE') => void;
  advanceCampaignStage: () => void;
  exitCampaign: () => void;
  setTimeScale: (scale: TimeScale) => void;
  stepSingleTick: (dtSec?: number) => void;
  applySimulationResult: (
    result: SimulationStepResult & { remainingSec: number },
    expectedTick?: number,
    expectedCommandSequence?: number,
    expectedScenarioId?: string
  ) => boolean;
  setActivePerspective: (p: ActivePerspective) => void;
  toggleAutoPause: (key: keyof AutoPauseSettings) => void;
  clearAutoPauseBanner: () => void;

  selectUnit: (unitId: string | null) => void;
  selectContact: (contactId: string | null) => void;
  setInteractionMode: (mode: MapInteractionMode) => void;
  startManualEngage: (weaponId?: string, salvoCount?: number) => void;
  startSpawnUnitOnMap: (config: {
    platformId: string;
    loadoutId?: string;
    side: SideId;
    name: string;
    callsign: string;
  }) => void;
  toggleMapLayer: (layer: keyof MapLayerVisibility) => void;
  flyToPosition: (center: [number, number], zoom?: number) => void;
  setActiveModal: (modal: WargameStoreState['activeModal']) => void;

  // --- 参谋作业指令 (Tactical Orders) ---
  appendUnitWaypoint: (
    unitId: string,
    coord: [number, number],
    replaceAll?: boolean,
    speedKts?: number,
    altitudeM?: number
  ) => void;
  updateUnitWaypoint: (unitId: string, index: number, patch: Partial<RouteLeg>) => void;
  removeUnitWaypoint: (unitId: string, index: number) => void;
  clearUnitWaypoints: (unitId: string) => void;
  setGroupFormation: (groupId: string, leaderUnitId?: string, spacingKm?: number) => void;
  requestAirRefuel: (receiverUnitId: string, tankerUnitId: string) => void;
  deployCarriedPlatform: (launcherUnitId: string, platformId: string) => void;
  deployCountermeasure: (unitId: string, kind: 'chaff' | 'flares' | 'acousticDecoys') => void;
  cancelUnitReturn: (unitId: string) => void;
  updateUnitDoctrine: (unitId: string, patch: Partial<UnitDoctrine>) => void;
  updateUnitKinematics: (
    unitId: string,
    speedKts?: number,
    altitudeM?: number
  ) => void;
  switchUnitLoadout: (unitId: string, loadoutId: string) => void;
  launchCarrierAircraft: (
    carrierUnitId: string,
    hangarSlotId: string,
    loadoutId?: string
  ) => void;
  assignUnitMission: (unitId: string, missionId: string | undefined) => void;
  createMissionFromReferencePoints: (draft: MissionReferencePointDraft) => void;
  updateMissionFromReferencePoints: (missionId: string, draft: MissionReferencePointDraft) => void;
  updateMissionDoctrine: (missionId: string, override: Partial<UnitDoctrine>) => void;
  deleteMission: (missionId: string) => void;
  toggleMissionActive: (missionId: string) => void;
  moveUnitInSandbox: (unitId: string, coord: [number, number]) => void;
  updateScenarioGroup: (groupId: string, patch: Pick<OrbatGroup, 'name' | 'commandTitle' | 'description'>) => void;
  assignUnitGroup: (unitId: string, groupId: string) => void;
  upsertObjective: (draft: ObjectiveDraft) => void;
  deleteObjective: (objectiveId: string) => void;
  createAreaEventFromReferencePoints: (draft: AreaEventDraft) => void;
  deleteScenarioEvent: (eventId: string) => void;
  executeManualEngage: (
    attackerId: string,
    targetId: string,
    weaponId?: string,
    salvoCount?: number,
    acceptRisk?: boolean
  ) => void;
  addReferencePoint: (coord: [number, number], side?: SideId) => void;
  removeReferencePoint: (rpId: string) => void;
  spawnUnitAtCoordinate: (coord: [number, number]) => void;
}

export type StoreSet = StoreApi<WargameStoreState>['setState'];
export type StoreGet = StoreApi<WargameStoreState>['getState'];
