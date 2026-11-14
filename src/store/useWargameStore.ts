import * as turf from '@turf/turf';
import { createAarLedger, recordAarTick } from '../engine/aar';
import { createRandomStream, DEFAULT_SEED, COMMAND_ACTIONS, type RecordedCommand } from '../engine/determinism';
import { canCommandUnit, contactForUnit } from '../engine/commandPolicy';
import { launchCarrierSortie } from '../engine/carrierOperations';
import { isRouteAllowed } from '../engine/environment';
import { evaluateFireControl, type FireControlSolution } from '../engine/fireControl';
import { launchGuidance } from '../engine/guidance';
import { getUnitCapabilities } from '../engine/unitCapabilities';
import { effectiveDoctrine } from '../engine/operations';
import { DEFAULT_BASEMAP, BASEMAP_PRESETS, type BasemapMode } from '../map/basemaps';
import type { PlayMode, ObjectiveProgress, BattleResult } from '../types/wargame';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  ActivePerspective,
  AutoPauseSettings,
  BattleAarLedger,
  CombatLogEntry,
  EquipmentCatalog,
  Domain,
  ReferencePoint,
  RouteLeg,
  RuntimeUnit,
  ScenarioDefinition,
  RuntimeScenarioEvent,
  ScenarioEnvironment,
  ScoreLedger,
  SideId,
  TacticalContact,
  TacticalExplosionEffect,
  TacticalMission,
  MissionType,
  OrbatGroup,
  PendingSortieOrder,
  ScenarioEventRule,
  ScenarioObjective,
  TimeScale,
  UnitCategory,
  ThreatLevel,
  UnitDoctrine,
  WeaponInFlight,
} from '../types/wargame';
import { resolveUnitConfiguration } from '../db/unitConfiguration';
import { compileScenario } from '../scenarios/compileScenario';
import { deriveMissionAssignments } from '../engine/missions';
import { createRuntimeWeaponMounts, recordWeaponLaunch } from '../engine/unitConfiguration';
import {
  BUILTIN_SCENARIOS,
  SCENARIO_EAST_SEA_THUNDER,
  instantiateScenarioUnits,
} from '../scenarios/builtinScenarios';
import {
  createRuntimeUnitFromPlacement,
  getBearingDeg,
  advanceSimulation,
  initializeWorldContacts,
} from '../engine/simulationEngine';

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
  seed: number;
  rngState: number;
  tick: number;
  pendingSimSeconds: number;
  commandSequence: number;
  commandHistory: RecordedCommand[];
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
  pendingSortieOrders: PendingSortieOrder[];
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
  setTimeScale: (scale: TimeScale) => void;
  stepSingleTick: (dtSec?: number) => void;
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

function routeLegsAllowed(unit: RuntimeUnit, waypoints: RouteLeg[], environment: ScenarioEnvironment): boolean {
  let from = unit.position;
  for (const waypoint of waypoints) {
    if (!isRouteAllowed(unit.domain, from, waypoint.position, environment)) return false;
    from = waypoint.position;
  }
  return true;
}

const TARGET_DOMAINS: readonly Domain[] = ['air', 'surface', 'subsurface', 'land'];
const THREAT_LEVELS: readonly ThreatLevel[] = ['low', 'medium', 'high', 'critical'];
const MISSION_TYPES: readonly MissionType[] = [
  'aaw_patrol', 'asuw_patrol', 'asw_patrol', 'land_strike', 'aew_support', 'escort', 'sead', 'tanker_support',
];

function resolveMissionDraft(
  state: Pick<WargameStoreState, 'referencePoints' | 'units' | 'playerSide' | 'playMode' | 'battleResult'>,
  draft: MissionReferencePointDraft,
  requiredSide?: SideId
): { name: string; type: MissionType; side: SideId; areaPolygon: [number, number][]; prosecuteOutsideAreaKm: number; escortUnitId?: string; stationRadiusKm: number } | undefined {
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (state.battleResult || !name || name.length > 80 || !MISSION_TYPES.includes(draft.type) ||
      !Number.isFinite(draft.prosecuteOutsideAreaKm) || draft.prosecuteOutsideAreaKm < 0 ||
      draft.prosecuteOutsideAreaKm > 2000 || !Array.isArray(draft.referencePointIds) ||
      draft.referencePointIds.length < 3 || new Set(draft.referencePointIds).size !== draft.referencePointIds.length) return undefined;
  const points = draft.referencePointIds.map((id) => state.referencePoints.find((point) => point.id === id));
  if (points.some((point) => !point)) return undefined;
  const side = points[0]!.side;
  if (side === 'NEUTRAL' || points.some((point) => point!.side !== side) || requiredSide && side !== requiredSide ||
      (state.playMode !== 'sandbox' && side !== state.playerSide)) return undefined;
  const areaPolygon = points.map((point) => [...point!.position] as [number, number]);
  if (new Set(areaPolygon.map(([longitude, latitude]) => `${longitude},${latitude}`)).size !== areaPolygon.length) return undefined;
  const polygon = turf.polygon([[...areaPolygon, areaPolygon[0]]]);
  if (turf.area(polygon) <= 1 || turf.kinks(polygon).features.length > 0) return undefined;
  const stationRadiusKm = draft.stationRadiusKm ?? 20;
  if (!Number.isFinite(stationRadiusKm) || stationRadiusKm < 1 || stationRadiusKm > 500) return undefined;
  const escortTarget = draft.escortUnitId ? state.units[draft.escortUnitId] : undefined;
  if (draft.type === 'escort' && (!escortTarget || escortTarget.side !== side) ||
      draft.type !== 'escort' && draft.escortUnitId) return undefined;
  return {
    name, type: draft.type, side, areaPolygon,
    prosecuteOutsideAreaKm: draft.prosecuteOutsideAreaKm,
    escortUnitId: draft.type === 'escort' ? draft.escortUnitId : undefined,
    stationRadiusKm,
  };
}

function createInitialStateFromScenario(
  definition: ScenarioDefinition,
  randomizeSpawns = false,
  requestedSeed?: number
) {
  const { scenario, catalog } = compileScenario(definition);
  const seed = requestedSeed ?? (randomizeSpawns ? crypto.getRandomValues(new Uint32Array(1))[0] : DEFAULT_SEED);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer');
  const random = createRandomStream(seed);
  const initialUnits = instantiateScenarioUnits(
    scenario,
    catalog,
    random.next
  );
  const startTime = Date.parse(scenario.startTimeIso);

  const initialWorld = {
    startTime,
    tick: 0,
    rngState: random.state(),
    objectives: scenario.objectives ?? [],
    objectiveProgress: {},
    creditedDamage: {},
    aar: createAarLedger(),
    simTime: startTime,
    units: initialUnits,
    contacts: {},
    weaponsInFlight: {},
    explosions: [],
    missions: deriveMissionAssignments(scenario.missions, initialUnits),
    environment: scenario.environment,
    pendingSortieOrders: [],
    events: (scenario.events || []).map((ev) => ({
      ...ev,
      hasFired: false,
      fireCount: 0,
      matchedUnitIds: [],
    })),
    victoryConditions: scenario.victoryConditions,
    score: {
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
  };

  const warmup = initializeWorldContacts(initialWorld, catalog);

  const firstRedUnitId =
    Object.values(warmup.nextState.units).find((u) => u.side === 'RED')?.id ||
    null;

  return {
    scenario,
    catalog,
    groups: scenario.groups.map((group) => ({ ...group })),
    objectives: (scenario.objectives ?? []).map((objective) => ({ ...objective, unitIds: [...objective.unitIds] })),
    seed,
    rngState: random.state(),
    startTime,
    simTime: warmup.nextState.simTime,
    units: warmup.nextState.units,
    contacts: warmup.nextState.contacts,
    weaponsInFlight: warmup.nextState.weaponsInFlight,
    explosions: warmup.nextState.explosions,
    missions: warmup.nextState.missions,
    events: warmup.nextState.events || [],
    pendingSortieOrders: warmup.nextState.pendingSortieOrders ?? [],
    environment: warmup.nextState.environment!,
    aar: warmup.nextState.aar ?? createAarLedger(),
    referencePoints: scenario.referencePoints.map((rp) => ({
      ...rp,
      position: [...rp.position] as [number, number],
    })),
    score: warmup.nextState.score,
    selectedUnitId: firstRedUnitId,
    logs: [
      {
        id: `log_init_${startTime}`,
        simTime: startTime,
        side: 'SYSTEM' as const,
        category: 'SYSTEM' as const,
        severity: 'info' as const,
        title: `战役想定已载入: ${scenario.title}`,
        message: '初始感知已生成，尚未移动或发射。请先选择控制席位、查看任务目标，再按 [Space] 开始。',
      },
      ...warmup.newLogs,
    ],
  };
}

const initialBoot = createInitialStateFromScenario(SCENARIO_EAST_SEA_THUNDER);

export const useWargameStore = create<WargameStoreState>()(
  subscribeWithSelector((set, get) => {
    const state: WargameStoreState = {
    basemapMode: DEFAULT_BASEMAP,
    setBasemapMode: (mode) => {
      if (Object.hasOwn(BASEMAP_PRESETS, mode)) set({ basemapMode: mode });
    },
    playerSide: 'RED', playMode: 'command',
    seed: initialBoot.seed, rngState: initialBoot.rngState, tick: 0,
    pendingSimSeconds: 0, commandSequence: 0, commandHistory: [],
    objectiveProgress: {}, battleResult: undefined, creditedDamage: {}, detectedMissileIds: [], aar: initialBoot.aar, pendingRiskEngagement: null,
    setPlayerSide: (side) => {
      const s = get();
      if (s.tick !== 0 || s.timeScale !== 0) return;
      set({ playerSide: side, activePerspective: side, selectedContactId: null,
        selectedUnitId: Object.values(s.units).find((u) => u.side === side)?.id ?? null });
    },
    setPlayMode: (mode) => set({ playMode: mode, timeScale: 0, pendingRiskEngagement: null,
      selectedUnitId: null, selectedContactId: null, interactionMode: 'select', activePerspective: get().playerSide }),
    dismissRiskEngagement: () => set({ pendingRiskEngagement: null }),
    selectLogEntry: (id) => {
      const s = get(); const log = s.logs.find((l) => l.id === id);
      if (!log || (s.playMode !== 'sandbox' && log.side !== s.playerSide && log.side !== 'SYSTEM')) return;
      if (log.contactId) {
        const contact = s.contacts[log.contactId];
        if (contact) { s.selectContact(contact.id); s.flyToPosition(contact.estimatedPosition); }
      } else if (log.unitId) {
        const unit = s.units[log.unitId];
        s.selectUnit(log.unitId);
        if (unit && (unit.side === s.playerSide || s.playMode === 'sandbox')) s.flyToPosition(unit.position);
      } else if (log.position) s.flyToPosition(log.position);
    },
    currentScenario: initialBoot.scenario,
    availableScenarios: BUILTIN_SCENARIOS,
    catalog: initialBoot.catalog,
    groups: initialBoot.groups,
    objectives: initialBoot.objectives,

    startTime: initialBoot.startTime,
    simTime: initialBoot.simTime,
    timeScale: 0,
    activePerspective: 'RED',
    autoPause: {
      onNewContact: false,
      onMissileDetected: true,
      onUnitHitOrDestroyed: true,
    },
    lastAutoPauseBanner: null,

    units: initialBoot.units,
    contacts: initialBoot.contacts,
    weaponsInFlight: initialBoot.weaponsInFlight,
    explosions: initialBoot.explosions,
    missions: initialBoot.missions,
    events: initialBoot.events,
    pendingSortieOrders: initialBoot.pendingSortieOrders,
    environment: initialBoot.environment,
    referencePoints: initialBoot.referencePoints,
    logs: initialBoot.logs,
    score: initialBoot.score,

    selectedUnitId: initialBoot.selectedUnitId,
    selectedContactId: null,
    interactionMode: 'select',
    pendingWeaponIdForEngage: null,
    pendingSalvoCount: 2,
    pendingSpawnConfig: null,
    mapLayers: {
      showRadarRings: true,
      showWeaponRings: true,
      showSonarRings: true,
      showWaypoints: true,
      showMissions: true,
      showAouPolygons: true,
      showReferencePoints: true,
    },
    cameraFlyToRequest: null,
    activeModal: 'none',

    loadScenario: (scenario, randomizeSpawns = false, seed) => {
      const boot = createInitialStateFromScenario(scenario, randomizeSpawns, seed);
      set((state) => {
        const exists = state.availableScenarios.some(
          (s) => s.id === scenario.id
        );
        return {
          playerSide: 'RED', playMode: 'command', activePerspective: 'RED',
          seed: boot.seed, rngState: boot.rngState, tick: 0, pendingSimSeconds: 0,
          commandSequence: 0, commandHistory: [], objectiveProgress: {}, battleResult: undefined,
          creditedDamage: {}, detectedMissileIds: [], aar: boot.aar, pendingRiskEngagement: null,
          pendingSpawnConfig: null, pendingWeaponIdForEngage: null,
          currentScenario: boot.scenario,
          availableScenarios: exists
            ? state.availableScenarios
            : [boot.scenario, ...state.availableScenarios],
          catalog: boot.catalog,
          groups: boot.groups,
          objectives: boot.objectives,
          startTime: boot.startTime,
          simTime: boot.simTime,
          timeScale: 0,
          lastAutoPauseBanner: null,
          units: boot.units,
          contacts: boot.contacts,
          weaponsInFlight: boot.weaponsInFlight,
          explosions: boot.explosions,
          missions: boot.missions,
          events: boot.events,
          pendingSortieOrders: boot.pendingSortieOrders,
          environment: boot.environment,
          referencePoints: boot.referencePoints,
          logs: boot.logs,
          score: boot.score,
          selectedUnitId: boot.selectedUnitId,
          selectedContactId: null,
          interactionMode: 'select',
          cameraFlyToRequest: {
            center: scenario.initialCamera.center,
            zoom: scenario.initialCamera.zoom,
            timestamp: Date.now(),
          },
        };
      });
    },

    resetScenario: (randomizeSpawns = false) => {
      const current = get().currentScenario;
      get().loadScenario(current, randomizeSpawns, randomizeSpawns ? undefined : get().seed);
    },

    setTimeScale: (scale) =>
      set({
        timeScale: get().battleResult || get().pendingRiskEngagement ? 0 : scale,
        lastAutoPauseBanner: scale > 0 ? null : get().lastAutoPauseBanner,
      }),

    stepSingleTick: (dtSec = 2) => {
      const s = get();
      if (s.battleResult) return;
      const result = advanceSimulation(
        {
          startTime: s.startTime,
          tick: s.tick, rngState: s.rngState, objectives: s.objectives,
          objectiveProgress: s.objectiveProgress, creditedDamage: s.creditedDamage,
          detectedMissileIds: s.detectedMissileIds,
          aar: s.aar,
          simTime: s.simTime,
          units: s.units,
          contacts: s.contacts,
          weaponsInFlight: s.weaponsInFlight,
          explosions: s.explosions,
          missions: s.missions,
          events: s.events,
          pendingSortieOrders: s.pendingSortieOrders,
          environment: s.environment,
          victoryConditions: s.currentScenario.victoryConditions,
          score: s.score,
        },
        s.catalog,
        dtSec + s.pendingSimSeconds,
        s.autoPause,
        s.playerSide
      );

      set((prev) => ({
        simTime: result.nextState.simTime,
        tick: result.nextState.tick ?? s.tick, rngState: result.nextState.rngState ?? s.rngState,
        pendingSimSeconds: result.remainingSec, objectiveProgress: result.nextState.objectiveProgress ?? {},
        objectives: result.nextState.objectives ?? prev.objectives,
        battleResult: result.nextState.battleResult, creditedDamage: result.nextState.creditedDamage ?? {},
        detectedMissileIds: result.nextState.detectedMissileIds ?? [],
        aar: result.nextState.aar ?? prev.aar,
        units: result.nextState.units,
        contacts: result.nextState.contacts,
        weaponsInFlight: result.nextState.weaponsInFlight,
        explosions: result.nextState.explosions,
        missions: result.nextState.missions,
        events: result.nextState.events || prev.events,
        pendingSortieOrders: result.nextState.pendingSortieOrders ?? prev.pendingSortieOrders,
        environment: result.nextState.environment ?? prev.environment,
        score: result.nextState.score,
        timeScale: result.shouldAutoPause ? 0 : prev.timeScale,
        lastAutoPauseBanner: result.shouldAutoPause
          ? result.autoPauseReason || '关键战术事件触发自动暂停'
          : prev.lastAutoPauseBanner,
        logs:
          result.newLogs.length > 0
            ? [...result.newLogs.reverse(), ...prev.logs].slice(0, 250)
            : prev.logs,
      }));
    },

    setActivePerspective: (p) =>
      set({
        activePerspective: p,
        selectedUnitId: null, selectedContactId: null, pendingRiskEngagement: null,
        interactionMode: 'select',
      }),

    toggleAutoPause: (key) =>
      set((s) => ({
        autoPause: { ...s.autoPause, [key]: !s.autoPause[key] },
      })),

    clearAutoPauseBanner: () => set({ lastAutoPauseBanner: null }),

    selectUnit: (unitId) => {
      const s = get(); const unit = unitId ? s.units[unitId] : undefined;
      if (unit && unit.side !== s.playerSide && s.playMode !== 'sandbox') {
        const contact = contactForUnit(s.contacts, s.playerSide, unit.id);
        set({ selectedUnitId: null, selectedContactId: contact?.id ?? null, interactionMode: 'select' });
        return;
      }
      set({ selectedUnitId: unit?.id ?? null, selectedContactId: null, interactionMode: 'select' });
    },
    selectContact: (contactId) => {
      const s = get(); const contact = contactId ? s.contacts[contactId] : undefined;
      if (contact && contact.observerSide !== s.playerSide && s.playMode !== 'sandbox') return;
      set({ selectedContactId: contact?.id ?? null, interactionMode: 'select' });
    },

    setInteractionMode: (mode) => set({ interactionMode: mode }),

    startManualEngage: (weaponId, salvoCount = 2) => {
      const s = get(); if (!canCommandUnit(s, s.units[s.selectedUnitId ?? ''])) return;
      set({
        interactionMode: 'manual_engage',
        pendingWeaponIdForEngage: weaponId || null,
        pendingSalvoCount: salvoCount,
      });
    },

    startSpawnUnitOnMap: (config) => {
      if (get().playMode !== 'sandbox' || get().battleResult) return;
      set({
        interactionMode: 'spawn_unit',
        pendingSpawnConfig: config,
        activeModal: 'none',
      });
    },

    toggleMapLayer: (layer) =>
      set((s) => ({
        mapLayers: { ...s.mapLayers, [layer]: !s.mapLayers[layer] },
      })),

    flyToPosition: (center, zoom) =>
      set({
        cameraFlyToRequest: { center, zoom, timestamp: Date.now() },
      }),

    setActiveModal: (modal) => set({ activeModal: modal }),

    appendUnitWaypoint: (unitId, coord, replaceAll = false, speedKts, altitudeM) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit) || !Array.isArray(coord) || coord.length !== 2 ||
            !Number.isFinite(coord[0]) || Math.abs(coord[0]) > 180 ||
            !Number.isFinite(coord[1]) || Math.abs(coord[1]) > 90) return s;
        const configuration = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
        if (speedKts !== undefined && (!Number.isFinite(speedKts) || speedKts < 0 || speedKts > configuration.maxSpeedKts) ||
            altitudeM !== undefined && (!Number.isFinite(altitudeM) || altitudeM < configuration.platform.minAltitudeM ||
              altitudeM > configuration.platform.maxAltitudeM)) return s;
        const leg: RouteLeg = { position: [...coord], speedKts, altitudeM };
        const nextWaypoints = replaceAll ? [leg] : [...unit.waypoints, leg];
        if (!routeLegsAllowed(unit, nextWaypoints, s.environment)) return s;
        const nextHeading = nextWaypoints.length > 0
          ? getBearingDeg(unit.position, nextWaypoints[0].position) : unit.heading;
        const nextSpeed = unit.speedKts < 1 && configuration.maxSpeedKts > 0
          ? configuration.cruiseSpeedKts : unit.speedKts;

        const newLog: CombatLogEntry = {
          id: `log_wp_${s.tick}_${s.commandSequence}_${unitId}`,
          simTime: s.simTime,
          side: unit.side,
          category: 'DOCTRINE',
          severity: 'info',
          title: `${unit.callsign} 机动航路点已更新`,
          message: `${unit.name} 设定新航向 ${Math.round(nextHeading)}°，共 ${nextWaypoints.length} 个规划航段` +
            `${speedKts !== undefined ? ` · ${speedKts}kt` : ''}${altitudeM !== undefined ? ` · ${altitudeM}m` : ''}。`,
          position: [...coord],
          unitId,
        };

        return {
          units: {
            ...s.units,
            [unitId]: {
              ...unit,
              waypoints: nextWaypoints,
              navigationMode: 'manual', missionTargetId: undefined,
              formationLeaderId: undefined, formationOffset: undefined,
              heading: nextHeading,
              speedKts: nextSpeed,
              targetSpeedKts: Math.max(unit.targetSpeedKts, nextSpeed),
            },
          },
          logs: [newLog, ...s.logs].slice(0, 250),
        };
      }),

    updateUnitWaypoint: (unitId, index, patch) => set((s) => {
      const unit = s.units[unitId];
      if (!canCommandUnit(s, unit) || !Number.isSafeInteger(index) || index < 0 || index >= unit.waypoints.length) return s;
      const configuration = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
      const current = unit.waypoints[index];
      const position = patch.position ?? current.position;
      const speedKts = patch.speedKts ?? current.speedKts;
      const altitudeM = patch.altitudeM ?? current.altitudeM;
      if (!Array.isArray(position) || position.length !== 2 || !Number.isFinite(position[0]) || Math.abs(position[0]) > 180 ||
          !Number.isFinite(position[1]) || Math.abs(position[1]) > 90 ||
          speedKts !== undefined && (!Number.isFinite(speedKts) || speedKts < 0 || speedKts > configuration.maxSpeedKts) ||
          altitudeM !== undefined && (!Number.isFinite(altitudeM) || altitudeM < configuration.platform.minAltitudeM ||
            altitudeM > configuration.platform.maxAltitudeM)) return s;
      const waypoints = unit.waypoints.map((waypoint, waypointIndex) => waypointIndex === index
        ? { position: [...position] as [number, number], speedKts, altitudeM }
        : waypoint);
      if (!routeLegsAllowed(unit, waypoints, s.environment)) return s;
      return { units: { ...s.units, [unitId]: { ...unit, waypoints } } };
    }),

    removeUnitWaypoint: (unitId, index) => set((s) => {
      const unit = s.units[unitId];
      if (!canCommandUnit(s, unit) || !Number.isSafeInteger(index) || index < 0 || index >= unit.waypoints.length) return s;
      return { units: { ...s.units, [unitId]: { ...unit,
        waypoints: unit.waypoints.filter((_, waypointIndex) => waypointIndex !== index) } } };
    }),

    clearUnitWaypoints: (unitId) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        return {
          units: {
            ...s.units,
            [unitId]: { ...unit, waypoints: [], navigationMode: 'manual', missionTargetId: undefined,
              formationLeaderId: undefined, formationOffset: undefined },
          },
        };
      }),

    setGroupFormation: (groupId, leaderUnitId, spacingKm = 10) => set((s) => {
      if (s.battleResult || !Number.isFinite(spacingKm) || spacingKm < 1 || spacingKm > 100) return s;
      const members = Object.values(s.units).filter((unit) => unit.parentGroupId === groupId &&
        unit.hp > 0 && unit.status !== 'destroyed' && unit.status !== 'recovered').sort((a, b) => a.id.localeCompare(b.id));
      if (members.length === 0 || (s.playMode !== 'sandbox' && members.some((unit) => unit.side !== s.playerSide))) return s;
      if (!leaderUnitId) {
        if (!members.some((unit) => unit.navigationMode === 'formation' || unit.formationLeaderId)) return s;
        const units = { ...s.units };
        for (const member of members) units[member.id] = {
          ...member,
          navigationMode: member.assignedMissionId ? 'mission' : 'manual',
          formationLeaderId: undefined,
          formationOffset: undefined,
          waypoints: [],
        };
        return { units };
      }
      const leader = members.find((member) => member.id === leaderUnitId);
      if (!leader || !canCommandUnit(s, leader) || members.length < 2) return s;
      const units = { ...s.units, [leader.id]: {
        ...leader,
        navigationMode: leader.navigationMode === 'formation'
          ? leader.assignedMissionId ? 'mission' as const : 'manual' as const
          : leader.navigationMode,
        formationLeaderId: undefined,
        formationOffset: undefined,
      } };
      members.filter((member) => member.id !== leader.id).forEach((member, index) => {
        const rank = Math.floor(index / 2) + 1;
        units[member.id] = {
          ...member,
          navigationMode: 'formation',
          formationLeaderId: leader.id,
          formationOffset: {
            relativeBearingDeg: index % 2 === 0 ? 150 : 210,
            distanceKm: spacingKm * rank,
          },
          waypoints: [],
          missionTargetId: undefined,
        };
      });
      const log: CombatLogEntry = {
        id: `formation_${groupId}_${s.tick}_${s.commandSequence}`,
        simTime: s.simTime,
        side: leader.side,
        category: 'DOCTRINE',
        severity: 'info',
        title: `编队领航：${leader.callsign}`,
        message: `${members.length} 个单位按 ${spacingKm} km 间隔同步跟进；返航优先于编队。`,
        unitId: leader.id,
      };
      return { units, logs: [log, ...s.logs].slice(0, 250) };
    }),

    requestAirRefuel: (receiverUnitId, tankerUnitId) => set((s) => {
      const receiver = s.units[receiverUnitId];
      const tanker = s.units[tankerUnitId];
      const tankerSpec = tanker ? s.catalog.platforms[tanker.platformId] : undefined;
      const receiverSpec = receiver ? s.catalog.platforms[receiver.platformId] : undefined;
      if (!canCommandUnit(s, receiver) || !tanker || getUnitCapabilities(tanker).speedFactor <= 0 ||
          tanker.domain !== 'air' || tanker.category !== 'tanker' || tanker.side !== receiver.side || receiver.domain !== 'air' || receiver.category === 'tanker' ||
          receiverSpec?.canReceiveAar === false || !tankerSpec?.aarFuelCapacitySec ||
          !tankerSpec.aarTransferRateSecPerSec || tanker.aarFuelRemainingSec <= 0 || receiver.airRefuelState ||
          tanker.aarQueue.includes(receiver.id) || receiver.fuelRemainingSec >= receiver.maxFuelSec) return s;
      const receiverClone: RuntimeUnit = {
        ...receiver,
        navigationMode: 'manual',
        missionTargetId: undefined,
        waypoints: [{ position: [...tanker.position], speedKts: tanker.targetSpeedKts, altitudeM: tanker.targetAltitudeM }],
        airRefuelState: {
          tankerId: tanker.id,
          phase: 'rendezvous',
          resumeNavigationMode: receiver.navigationMode,
          resumeWaypoints: receiver.waypoints.map((waypoint) => ({
            ...waypoint, position: [...waypoint.position] as [number, number],
          })),
          resumeMissionTargetId: receiver.missionTargetId,
          resumeMissionState: receiver.missionState,
        },
      };
      const tankerClone = { ...tanker, aarQueue: [...tanker.aarQueue, receiver.id] };
      const log: CombatLogEntry = {
        id: `aar_request_${s.tick}_${s.commandSequence}_${receiver.id}`,
        simTime: s.simTime,
        side: receiver.side,
        category: 'DOCTRINE',
        severity: 'info',
        title: `${receiver.callsign} 请求空中加油`,
        message: `已加入 ${tanker.callsign} 队列第 ${tankerClone.aarQueue.length} 位。`,
        unitId: receiver.id,
      };
      return { units: { ...s.units, [receiver.id]: receiverClone, [tanker.id]: tankerClone },
        logs: [log, ...s.logs].slice(0, 250) };
    }),

    deployCarriedPlatform: (launcherUnitId, platformId) => set((s) => {
      const launcher = s.units[launcherUnitId];
      const deployableSpec = s.catalog.platforms[platformId];
      const remaining = launcher?.deployableInventory[platformId] ?? 0;
      if (!canCommandUnit(s, launcher) || remaining <= 0 || !deployableSpec || deployableSpec.domain !== 'air' ||
          !['decoy', 'mpa_uav'].includes(deployableSpec.category)) return s;
      const id = `deployable_${launcher.id}_${platformId}_${s.tick}_${s.commandSequence}`;
      if (s.units[id]) return s;
      const deployed = createRuntimeUnitFromPlacement({
        id,
        name: `${deployableSpec.name} #${remaining}`,
        callsign: `${deployableSpec.category === 'decoy' ? 'DECOY' : 'UAV'}-${s.commandSequence + 1}`,
        side: launcher.side,
        platformId,
        parentGroupId: launcher.parentGroupId,
        position: [...launcher.position],
        altitudeM: Math.max(deployableSpec.minAltitudeM, Math.min(deployableSpec.maxAltitudeM, launcher.altitudeM)),
        heading: launcher.heading,
        speedKts: deployableSpec.cruiseSpeedKts,
      }, s.catalog);
      deployed.deployedByUnitId = launcher.id;
      deployed.waypoints = [{
        position: turf.destination(launcher.position, 250, launcher.heading, { units: 'kilometers' })
          .geometry.coordinates as [number, number],
        speedKts: deployableSpec.cruiseSpeedKts,
        altitudeM: deployed.altitudeM,
      }];
      const launcherClone = { ...launcher, deployableInventory: {
        ...launcher.deployableInventory, [platformId]: remaining - 1,
      } };
      const log: CombatLogEntry = {
        id: `deployable_launch_${id}`,
        simTime: s.simTime,
        side: launcher.side,
        category: 'EVENT',
        severity: 'info',
        title: `${launcher.callsign} 释放 ${deployableSpec.name}`,
        message: `剩余库存 ${remaining - 1}；平台作为独立可观测实体进入战场。`,
        position: [...launcher.position],
        unitId: deployed.id,
        aarType: 'sortie',
      };
      return { units: { ...s.units, [launcher.id]: launcherClone, [deployed.id]: deployed },
        selectedUnitId: deployed.id, logs: [log, ...s.logs].slice(0, 250) };
    }),

    updateUnitDoctrine: (unitId, patch) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        if (patch.salvoSize !== undefined && (!Number.isSafeInteger(patch.salvoSize) || patch.salvoSize < 1) ||
            patch.automaticFireRangeFraction !== undefined && (!Number.isFinite(patch.automaticFireRangeFraction) ||
              patch.automaticFireRangeFraction < 0.05 || patch.automaticFireRangeFraction > 1) ||
            patch.minimumWeaponReserve !== undefined && (!Number.isSafeInteger(patch.minimumWeaponReserve) || patch.minimumWeaponReserve < 0) ||
            patch.minimumAutomaticThreat !== undefined && !THREAT_LEVELS.includes(patch.minimumAutomaticThreat) ||
            patch.automaticTargetDomains !== undefined && (!Array.isArray(patch.automaticTargetDomains) ||
              new Set(patch.automaticTargetDomains).size !== patch.automaticTargetDomains.length ||
              patch.automaticTargetDomains.some((domain) => !TARGET_DOMAINS.includes(domain)))) return s;
        const updatedDoctrine = {
          ...unit.doctrine,
          ...patch,
          automaticTargetDomains: patch.automaticTargetDomains
            ? [...patch.automaticTargetDomains] : [...unit.doctrine.automaticTargetDomains],
        };
        const newLog: CombatLogEntry = {
          id: `log_doc_${s.tick}_${s.commandSequence}_${unitId}`,
          simTime: s.simTime,
          side: unit.side,
          category: 'DOCTRINE',
          severity: 'info',
          title: `${unit.callsign} 作战条令/EMCON变更`,
          message: `${unit.name} 条令更新: ROE=${updatedDoctrine.roe.toUpperCase()} | 主动雷达=${
            updatedDoctrine.emconRadar ? '辐射开机' : 'EMCON静默'
          } | 电子干扰=${updatedDoctrine.emconJamming ? '有源压制ON' : '关闭'}。`,
          position: [...unit.position],
          unitId,
        };
        return {
          units: {
            ...s.units,
            [unitId]: {
              ...unit,
              doctrine: updatedDoctrine,
            },
          },
          logs: [newLog, ...s.logs].slice(0, 250),
        };
      }),

    updateUnitKinematics: (unitId, speedKts, altitudeM) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        const configuration = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
        const spec = configuration.platform;
        const clampedSpeed =
          speedKts !== undefined && spec
            ? Math.max(0, Math.min(configuration.maxSpeedKts, speedKts))
            : unit.targetSpeedKts;
        const clampedAlt =
          altitudeM !== undefined && spec
            ? Math.max(
                spec.minAltitudeM,
                Math.min(spec.maxAltitudeM, altitudeM)
              )
            : unit.targetAltitudeM;

        return {
          units: {
            ...s.units,
            [unitId]: {
              ...unit,
              targetSpeedKts: clampedSpeed,
              speedKts: clampedSpeed,
              targetAltitudeM: clampedAlt,
            },
          },
        };
      }),

    // ★ 新增：实时切换单位战术挂载方案 (Switch Loadout Profile)
    switchUnitLoadout: (unitId, loadoutId) =>
      set((s) => {
        const unit = s.units[unitId];
        const loadout = s.catalog.loadouts[loadoutId];
        if (!canCommandUnit(s, unit) || !loadout || unit.activeLoadoutId === loadoutId) return s;
        if (s.tick > 0 && s.playMode !== 'sandbox') return s;
        if (!loadout.compatiblePlatformIds.includes(unit.platformId)) return s;
        const previous = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
        const configuration = resolveUnitConfiguration(s.catalog, unit.platformId, loadoutId);
        const nextMounts = createRuntimeWeaponMounts(configuration, s.catalog, unit.weaponUsage, s.simTime);
        const adjustSpeed = (speed: number) => Math.abs(speed - previous.cruiseSpeedKts) < 0.5
          ? configuration.cruiseSpeedKts : Math.min(speed, configuration.maxSpeedKts);

        const loadoutLog: CombatLogEntry = {
          id: `log_loadout_${s.tick}_${s.commandSequence}_${unitId}`,
          simTime: s.simTime,
          side: unit.side,
          category: 'DOCTRINE',
          severity: 'info',
          title: `${unit.callsign} 切换战术挂载方案: ${loadout.codeName}`,
          message: `${unit.name} 已换装 [${loadout.name}]。`,
          position: [...unit.position],
          unitId,
        };

        return {
          units: {
            ...s.units,
            [unitId]: {
              ...unit,
              activeLoadoutId: loadoutId,
              mounts: nextMounts,
              maxFuelSec: configuration.maxFuelSec,
              fuelRemainingSec: unit.maxFuelSec > 0
                ? configuration.maxFuelSec * Math.max(0, Math.min(1, unit.fuelRemainingSec / unit.maxFuelSec))
                : 0,
              speedKts: adjustSpeed(unit.speedKts),
              targetSpeedKts: adjustSpeed(unit.targetSpeedKts),
            },
          },
          logs: [loadoutLog, ...s.logs].slice(0, 250),
        };
      }),

    // ★ 新增：从航母/两栖舰/基地机库弹射放飞舰载机编队 (Launch Carrier Aircraft Sortie)
    launchCarrierAircraft: (carrierUnitId, hangarSlotId, customLoadoutId) =>
      set((s) => {
        const carrier = s.units[carrierUnitId];
        if (!canCommandUnit(s, carrier)) return s;
        const carrierClone: RuntimeUnit = {
          ...carrier,
          hangar: carrier.hangar.map((slot) => ({
            ...slot,
            activeSortieIds: [...slot.activeSortieIds],
            turnaroundQueue: slot.turnaroundQueue.map((entry) => ({ ...entry })),
          })),
        };
        const units = { ...s.units, [carrier.id]: carrierClone };
        const launchedUnit = launchCarrierSortie(units, s.catalog, carrierUnitId, hangarSlotId, customLoadoutId);
        if (!launchedUnit) return s;
        const loadoutId = launchedUnit.activeLoadoutId!;
        const launchLog: CombatLogEntry = {
          id: `log_sortie_${s.tick}_${s.commandSequence}_${launchedUnit.id}`,
          simTime: s.simTime,
          side: carrier.side,
          category: 'EVENT',
          severity: 'info',
          title: `[甲板弹射升空] ${carrier.callsign} 放飞 ${launchedUnit.name}`,
          message: `${carrier.name} 电磁弹射放飞 ${launchedUnit.name} (${launchedUnit.callsign})，挂载方案: ${
            s.catalog.loadouts[loadoutId]?.name || loadoutId
          }。`,
          position: [...launchedUnit.position],
          unitId: launchedUnit.id,
          aarType: 'sortie',
        };
        return {
          units,
          score: { ...s.score, sortiesLaunched: (s.score.sortiesLaunched || 0) + 1 },
          selectedUnitId: launchedUnit.id,
          logs: [launchLog, ...s.logs].slice(0, 250),
        };
      }),

    assignUnitMission: (unitId, missionId) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        if (missionId && !s.missions.some((mission) => mission.id === missionId && mission.side === unit.side)) return s;
        const units = { ...s.units, [unitId]: { ...unit, assignedMissionId: missionId,
          navigationMode: missionId ? 'mission' as const : 'manual' as const,
          missionTargetId: undefined, missionState: missionId ? 'ingress' as const : undefined,
          missionRouteIndex: 0, formationLeaderId: undefined, formationOffset: undefined, waypoints: [] } };
        return {
          missions: deriveMissionAssignments(s.missions, units),
          units,
        };
      }),

    createMissionFromReferencePoints: (draft) => set((s) => {
      const resolved = resolveMissionDraft(s, draft);
      if (!resolved) return s;
      const missionId = `mission_${resolved.side.toLowerCase()}_${s.tick}_${s.commandSequence}`;
      if (s.missions.some((mission) => mission.id === missionId)) return s;
      const mission: TacticalMission = {
        id: missionId,
        ...resolved,
        isActive: true,
        assignedUnitIds: [],
        description: `由 ${draft.referencePointIds.length} 个战术参考点创建的玩家任务区。`,
      };
      const log: CombatLogEntry = {
        id: `mission_created_${missionId}`,
        simTime: s.simTime,
        side: resolved.side,
        category: 'DOCTRINE',
        severity: 'info',
        title: `任务已创建：${resolved.name}`,
        message: `${resolved.type} · 区域参考点 ${draft.referencePointIds.length} 个 · 区外追击 ${resolved.prosecuteOutsideAreaKm} km。`,
      };
      return { missions: [...s.missions, mission], logs: [log, ...s.logs].slice(0, 250) };
    }),

    updateMissionFromReferencePoints: (missionId, draft) => set((s) => {
      const mission = s.missions.find((candidate) => candidate.id === missionId);
      if (!mission || (s.playMode !== 'sandbox' && mission.side !== s.playerSide)) return s;
      const resolved = resolveMissionDraft(s, draft, mission.side);
      if (!resolved) return s;
      const missions = s.missions.map((candidate) => candidate.id === missionId
        ? { ...candidate, ...resolved, areaPolygon: resolved.areaPolygon.map((point) => [...point] as [number, number]) }
        : candidate);
      const log: CombatLogEntry = {
        id: `mission_updated_${missionId}_${s.tick}_${s.commandSequence}`,
        simTime: s.simTime,
        side: mission.side,
        category: 'DOCTRINE',
        severity: 'info',
        title: `任务已更新：${resolved.name}`,
        message: `${resolved.type} · 区域参考点 ${draft.referencePointIds.length} 个 · 区外追击 ${resolved.prosecuteOutsideAreaKm} km。`,
      };
      return { missions, logs: [log, ...s.logs].slice(0, 250) };
    }),

    deleteMission: (missionId) => set((s) => {
      const mission = s.missions.find((candidate) => candidate.id === missionId);
      if (s.battleResult || !mission || (s.playMode !== 'sandbox' && mission.side !== s.playerSide)) return s;
      const units = Object.fromEntries(Object.entries(s.units).map(([id, unit]) => [id,
        unit.assignedMissionId === missionId
          ? { ...unit, assignedMissionId: undefined, navigationMode: 'manual' as const,
            missionTargetId: undefined, missionState: undefined, missionRouteIndex: 0, waypoints: [] }
          : unit,
      ]));
      const missions = deriveMissionAssignments(s.missions.filter((candidate) => candidate.id !== missionId), units);
      const log: CombatLogEntry = {
        id: `mission_deleted_${missionId}_${s.tick}_${s.commandSequence}`,
        simTime: s.simTime,
        side: mission.side,
        category: 'DOCTRINE',
        severity: 'warning',
        title: `任务已删除：${mission.name}`,
        message: '原配属算子已解除任务并切换为手动导航。',
      };
      return { units, missions, logs: [log, ...s.logs].slice(0, 250) };
    }),

    toggleMissionActive: (missionId) => set((s) => {
      const mission = s.missions.find((m) => m.id === missionId);
      if (s.battleResult || !mission || (s.playMode !== 'sandbox' && mission.side !== s.playerSide)) return s;
      return { missions: s.missions.map((m) => m.id === missionId &&
        (s.playMode === 'sandbox' || m.side === s.playerSide) ? { ...m, isActive: !m.isActive } : m) };
    }),

    moveUnitInSandbox: (unitId, coord) => set((s) => {
      const unit = s.units[unitId];
      if (s.playMode !== 'sandbox' || s.battleResult || !unit || !Array.isArray(coord) || coord.length !== 2 ||
          !Number.isFinite(coord[0]) || Math.abs(coord[0]) > 180 || !Number.isFinite(coord[1]) || Math.abs(coord[1]) > 90 ||
          !isRouteAllowed(unit.domain, unit.position, coord, s.environment)) return s;
      return { units: { ...s.units, [unitId]: { ...unit, position: [...coord], waypoints: [] } }, interactionMode: 'select' };
    }),

    updateScenarioGroup: (groupId, patch) => set((s) => {
      const group = s.groups.find((candidate) => candidate.id === groupId);
      const name = patch.name?.trim();
      const commandTitle = patch.commandTitle?.trim();
      const description = patch.description?.trim();
      if (s.playMode !== 'sandbox' || !group || !name || !commandTitle || !description ||
          name.length > 100 || commandTitle.length > 100 || description.length > 500) return s;
      return { groups: s.groups.map((candidate) => candidate.id === groupId
        ? { ...candidate, name, commandTitle, description } : candidate) };
    }),

    assignUnitGroup: (unitId, groupId) => set((s) => {
      const unit = s.units[unitId];
      const group = s.groups.find((candidate) => candidate.id === groupId);
      if (s.playMode !== 'sandbox' || !unit || !group || unit.side !== group.side || unit.parentGroupId === groupId) return s;
      return { units: { ...s.units, [unitId]: { ...unit, parentGroupId: groupId,
        formationLeaderId: undefined, formationOffset: undefined,
        navigationMode: unit.navigationMode === 'formation' ? unit.assignedMissionId ? 'mission' : 'manual' : unit.navigationMode } } };
    }),

    upsertObjective: (draft) => set((s) => {
      const title = draft.title?.trim();
      const id = draft.id ?? `objective_${s.tick}_${s.commandSequence}`;
      const allowedTypes: ScenarioObjective['type'][] = ['destroy', 'disable', 'preserve', 'observe', 'withdraw'];
      if (s.playMode !== 'sandbox' || !title || title.length > 120 || !['RED', 'BLUE'].includes(draft.side) ||
          !allowedTypes.includes(draft.type) || !Array.isArray(draft.unitIds) || draft.unitIds.length === 0 ||
          new Set(draft.unitIds).size !== draft.unitIds.length || draft.unitIds.some((unitId) => !s.units[unitId]) ||
          !Number.isSafeInteger(draft.points) || draft.points < 0 ||
          draft.criticalFailure && draft.type !== 'preserve' || draft.preserveCapability && draft.type !== 'preserve') return s;
      const objective: ScenarioObjective = { id, title, side: draft.side, type: draft.type,
        unitIds: [...draft.unitIds], required: draft.required, points: draft.points,
        criticalFailure: draft.criticalFailure, preserveCapability: draft.preserveCapability };
      const exists = s.objectives.some((candidate) => candidate.id === id);
      const objectiveProgress = { ...s.objectiveProgress }; delete objectiveProgress[id];
      return { objectives: exists ? s.objectives.map((candidate) => candidate.id === id ? objective : candidate)
        : [...s.objectives, objective], objectiveProgress };
    }),

    deleteObjective: (objectiveId) => set((s) => {
      if (s.playMode !== 'sandbox' || !s.objectives.some((objective) => objective.id === objectiveId)) return s;
      const objectiveProgress = { ...s.objectiveProgress }; delete objectiveProgress[objectiveId];
      return { objectives: s.objectives.filter((objective) => objective.id !== objectiveId), objectiveProgress };
    }),

    createAreaEventFromReferencePoints: (draft) => set((s) => {
      if (s.playMode !== 'sandbox' || !draft.message?.trim()) return s;
      const resolved = resolveMissionDraft(s, {
        name: draft.name,
        type: 'aaw_patrol',
        referencePointIds: draft.referencePointIds,
        prosecuteOutsideAreaKm: 0,
      });
      if (!resolved || resolved.side !== draft.side) return s;
      const id = `event_area_${s.tick}_${s.commandSequence}`;
      const event: RuntimeScenarioEvent = {
        id, name: resolved.name, description: '由战术参考点创建的区域进入触发器。',
        trigger: { type: 'UNIT_ENTERS_AREA', side: draft.side, unitCategory: draft.unitCategory,
          areaPolygon: resolved.areaPolygon.map((point) => [...point] as [number, number]) },
        actions: [{ type: 'BROADCAST_MESSAGE', side: draft.side, severity: 'warning',
          title: resolved.name, message: draft.message.trim() }],
        hasFired: false, fireCount: 0, matchedUnitIds: [],
      };
      return { events: [...s.events, event] };
    }),

    deleteScenarioEvent: (eventId) => set((s) => {
      if (s.playMode !== 'sandbox' || !s.events.some((event) => event.id === eventId)) return s;
      return { events: s.events.filter((event) => event.id !== eventId),
        score: { ...s.score, firedEventIds: s.score.firedEventIds.filter((id) => id !== eventId) } };
    }),

    executeManualEngage: (attackerId, targetId, weaponId, salvoCount, acceptRisk = false) => set((s) => {
      const attacker = s.units[attackerId];
      if (!canCommandUnit(s, attacker)) return s;
      const contact = s.contacts[targetId] ?? contactForUnit(s.contacts, attacker.side, targetId);
      const mounts = attacker.mounts.filter((m) => !weaponId || m.weaponId === weaponId);
      const solutions = mounts.flatMap((mount) => {
        const weapon = s.catalog.weapons[mount.weaponId];
        return weapon ? [{ mount, weapon, solution: evaluateFireControl({ ...attacker, doctrine: effectiveDoctrine(attacker, s.missions) }, contact, mount, weapon, s.catalog, s.units, s.simTime) }] : [];
      });
      const chosen = solutions.find((entry) => entry.solution.status === 'executable') ??
        solutions.find((entry) => entry.solution.status === 'risky') ?? solutions[0];
      const requestedSalvo = salvoCount ?? attacker.doctrine.salvoSize;
      if (!Number.isSafeInteger(requestedSalvo) || requestedSalvo <= 0) return s;
      if (!chosen || chosen.solution.status === 'blocked' || !contact) {
        const log: CombatLogEntry = { id: `fire_rejected_${s.tick}_${s.commandSequence}`, simTime: s.simTime,
          side: attacker.side, category: 'DOCTRINE', severity: 'warning', title: '火力指令未执行',
          message: chosen?.solution.hardBlockReasons.join('；') || '无匹配武器或情报接触', unitId: attacker.id };
        return { pendingRiskEngagement: null, interactionMode: 'select', logs: [log, ...s.logs].slice(0, 250) };
      }
      const { mount, weapon, solution } = chosen;
      if (solution.status === 'risky' && !acceptRisk) return {
        timeScale: 0, interactionMode: 'select',
        pendingRiskEngagement: { attackerId, contactId: contact.id, weaponId: weapon.id, salvoCount: requestedSalvo, solution },
      };
      const salvo = Math.min(requestedSalvo, mount.currentAmmo);
      const weaponsInFlight = { ...s.weaponsInFlight };
      const areaAttack = weapon.guidance === 'anti_radiation' && contact.lastEmitterDetectedTime !== undefined;
      for (let i = 0; i < salvo; i++) {
        const id = `manual_${s.tick}_${s.commandSequence}_${attacker.id}_${i}`;
        weaponsInFlight[id] = { id, weaponId: weapon.id, name: weapon.codeName, side: attacker.side,
          shooterId: attacker.id, shooterName: attacker.callsign,
          targetId: areaAttack ? contact.id : contact.actualUnitId,
          targetType: areaAttack ? 'area' : 'unit',
          position: [...attacker.position], launchPosition: [...attacker.position], trail: [[...attacker.position]],
          altitudeM: weapon.launchMedium === 'air_drop' ? attacker.altitudeM : weapon.cruiseAltitudeM,
          heading: getBearingDeg(attacker.position, contact.estimatedPosition),
          speedKts: weapon.launchMedium === 'air_drop' ? weapon.airDropSpeedKts! : weapon.speedKts,
          distanceRemainingKm: solution.distanceKm!,
          maxRangeKm: weapon.launchMedium === 'air_drop' ? weapon.airDropRangeKm! : weapon.maxRangeKm,
          traveledKm: 0, basePk: weapon.basePk, warheadDamage: weapon.warheadDamage,
          requiresDatalinkBeyondHorizon: weapon.requiresDatalinkBeyondHorizon,
          datalinkSupported: solution.supportSourceIds.length > 0,
          deliveryPhase: weapon.launchMedium === 'air_drop' ? 'air_drop' : undefined,
          ...launchGuidance(contact) };
      }
      const updatedAttacker = { ...attacker, status: 'engaged' as const, mounts: attacker.mounts.map((m) =>
        m.mountId === mount.mountId ? { ...m, currentAmmo: m.currentAmmo - salvo,
          cooldownRemainingSec: m.reloadTimeSec * getUnitCapabilities(attacker).reloadFactor } : m) };
      recordWeaponLaunch(updatedAttacker, mount, salvo, s.simTime);
      const score = { ...s.score };
      if (attacker.side === 'RED') score.redMissilesFired += salvo; else score.blueMissilesFired += salvo;
      const log: CombatLogEntry = { id: `manual_log_${s.tick}_${s.commandSequence}`, simTime: s.simTime,
        side: attacker.side, category: 'LAUNCH', severity: 'warning', title: `${attacker.callsign} 发射 ${salvo} 枚 ${weapon.codeName}`,
        message: `${areaAttack ? '按最近辐射方位/AOU发射，不绑定隐藏平台' : `瞄准 ${contact.displayName}`}（估计距离 ${solution.distanceKm!.toFixed(1)} km）。${solution.riskWarnings.join('；')}`,
        unitId: attacker.id, position: [...attacker.position], weaponId: weapon.id,
        targetUnitId: areaAttack ? undefined : contact.actualUnitId, quantity: salvo };
      return { units: { ...s.units, [attacker.id]: updatedAttacker }, score, weaponsInFlight,
        pendingRiskEngagement: null, pendingWeaponIdForEngage: null, interactionMode: 'select', logs: [log, ...s.logs].slice(0, 250) };
    }),

    addReferencePoint: (coord, side) =>
      set((s) => {
        const rpSide: SideId =
          s.playMode === 'sandbox' ? (side || s.playerSide) : s.playerSide;
        const idx = s.referencePoints.length + 1;
        const newRp: ReferencePoint = {
          id: `rp_${s.tick}_${s.commandSequence}`,
          name: `RP-${idx} (${coord[0].toFixed(1)}E,${coord[1].toFixed(1)}N)`,
          side: rpSide,
          position: [...coord],
          locked: false,
        };
        return {
          referencePoints: [...s.referencePoints, newRp],
          interactionMode: 'select',
        };
      }),

    removeReferencePoint: (rpId) =>
      set((s) => ({
        referencePoints: s.referencePoints.filter((r) => r.id !== rpId || r.locked || (s.playMode !== 'sandbox' && r.side !== s.playerSide)),
      })),

    spawnUnitAtCoordinate: (coord) =>
      set((s) => {
        const cfg = s.pendingSpawnConfig;
        if (!cfg || s.playMode !== 'sandbox' || s.battleResult) return { interactionMode: 'select' };
        const spec = s.catalog.platforms[cfg.platformId];
        if (!spec) return { interactionMode: 'select' };

        const newId = `unit_spawn_${s.tick}_${s.commandSequence}`;
        const defaultGroup =
          s.currentScenario.groups.find((g) => g.side === cfg.side)?.id ||
          'custom_group';

        const newUnit = createRuntimeUnitFromPlacement(
          {
            id: newId,
            name: cfg.name || spec.name,
            callsign:
              cfg.callsign ||
              `${cfg.side}-${s.commandSequence + 100}`,
            side: cfg.side,
            platformId: spec.id,
            loadoutId: cfg.loadoutId || spec.defaultLoadoutId,
            parentGroupId: defaultGroup,
            position: [...coord],
            heading: cfg.side === 'RED' ? 95 : 275,
          },
          s.catalog
        );

        const spawnLog: CombatLogEntry = {
          id: `log_spawn_${s.tick}_${s.commandSequence}`,
          simTime: s.simTime,
          side: cfg.side,
          category: 'SYSTEM',
          severity: 'info',
          title: `战场实时增援算子已投放: ${newUnit.name}`,
          message: `已在坐标 [${coord[0].toFixed(2)}°E, ${coord[1].toFixed(
            2
          )}°N] 实时部署 ${spec.className} (${newUnit.callsign})。`,
          position: [...coord],
          unitId: newId,
        };

        return {
          units: {
            ...s.units,
            [newId]: newUnit,
          },
          selectedUnitId: newId,
          interactionMode: 'select',
          pendingSpawnConfig: null,
          logs: [spawnLog, ...s.logs].slice(0, 250),
        };
      }),
    };
    for (const name of COMMAND_ACTIONS) {
      const action = state[name] as (...args: unknown[]) => void;
      Object.assign(state, { [name]: (...args: unknown[]) => {
        const before = get();
        action(...args);
        if (get() !== before) {
          const after = get();
          const previousLogIds = new Set(before.logs.map((log) => log.id));
          const commandLogs = after.logs.filter((log) => !previousLogIds.has(log.id));
          const aar = {
            events: after.aar.events.map((event) => ({ ...event })),
            tracks: after.aar.tracks.map((sample) => ({ ...sample, position: [...sample.position] as [number, number] })),
          };
          recordAarTick(aar, before.tick, before.simTime, after.units, commandLogs, false, false);
          set({ commandSequence: before.commandSequence + 1, aar,
            commandHistory: [...after.commandHistory, { tick: before.tick, sequence: before.commandSequence,
              action: name, args: structuredClone(args) }] });
        }
      } });
    }
    return state;
  })
);
