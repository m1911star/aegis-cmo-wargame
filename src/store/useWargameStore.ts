import { createRandomStream, DEFAULT_SEED, COMMAND_ACTIONS, type RecordedCommand } from '../engine/determinism';
import { canCommandUnit, contactForUnit } from '../engine/commandPolicy';
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
  CombatLogEntry,
  EquipmentCatalog,
  ReferencePoint,
  RuntimeUnit,
  ScenarioDefinition,
  RuntimeScenarioEvent,
  ScoreLedger,
  SideId,
  TacticalContact,
  TacticalExplosionEffect,
  TacticalMission,
  TimeScale,
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
  | 'spawn_unit';

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
  pendingRiskEngagement: { attackerId: string; contactId: string; weaponId: string; salvoCount: number; solution: FireControlSolution } | null;
  setPlayerSide: (side: 'RED' | 'BLUE') => void;
  setPlayMode: (mode: PlayMode) => void;
  dismissRiskEngagement: () => void;
  selectLogEntry: (logId: string) => void;
  // --- 想定与装备目录 ---
  currentScenario: ScenarioDefinition;
  availableScenarios: ScenarioDefinition[];
  catalog: EquipmentCatalog;

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
    replaceAll?: boolean
  ) => void;
  clearUnitWaypoints: (unitId: string) => void;
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
  toggleMissionActive: (missionId: string) => void;
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
    objectives: scenario.objectives,
    objectiveProgress: {},
    creditedDamage: {},
    simTime: startTime,
    units: initialUnits,
    contacts: {},
    weaponsInFlight: {},
    explosions: [],
    missions: deriveMissionAssignments(scenario.missions, initialUnits),
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
    objectiveProgress: {}, battleResult: undefined, creditedDamage: {}, detectedMissileIds: [], pendingRiskEngagement: null,
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
          creditedDamage: {}, detectedMissileIds: [], pendingRiskEngagement: null,
          pendingSpawnConfig: null, pendingWeaponIdForEngage: null,
          currentScenario: boot.scenario,
          availableScenarios: exists
            ? state.availableScenarios
            : [boot.scenario, ...state.availableScenarios],
          catalog: boot.catalog,
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
          tick: s.tick, rngState: s.rngState, objectives: s.currentScenario.objectives,
          objectiveProgress: s.objectiveProgress, creditedDamage: s.creditedDamage,
          detectedMissileIds: s.detectedMissileIds,
          simTime: s.simTime,
          units: s.units,
          contacts: s.contacts,
          weaponsInFlight: s.weaponsInFlight,
          explosions: s.explosions,
          missions: s.missions,
          events: s.events,
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
        battleResult: result.nextState.battleResult, creditedDamage: result.nextState.creditedDamage ?? {},
        detectedMissileIds: result.nextState.detectedMissileIds ?? [],
        units: result.nextState.units,
        contacts: result.nextState.contacts,
        weaponsInFlight: result.nextState.weaponsInFlight,
        explosions: result.nextState.explosions,
        missions: result.nextState.missions,
        events: result.nextState.events || prev.events,
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

    appendUnitWaypoint: (unitId, coord, replaceAll = false) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        const nextWaypoints: [number, number][] = replaceAll
          ? [[...coord]]
          : [...unit.waypoints, [...coord]];
        const nextHeading =
          nextWaypoints.length > 0
            ? getBearingDeg(unit.position, nextWaypoints[0])
            : unit.heading;
        const spec = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
        const nextSpeed =
          unit.speedKts < 1 && spec && spec.maxSpeedKts > 0
            ? spec.cruiseSpeedKts
            : unit.speedKts;

        const newLog: CombatLogEntry = {
          id: `log_wp_${s.tick}_${s.commandSequence}_${unitId}`,
          simTime: s.simTime,
          side: unit.side,
          category: 'DOCTRINE',
          severity: 'info',
          title: `${unit.callsign} 机动航路点已更新`,
          message: `${unit.name} 设定新航向 ${Math.round(nextHeading)}°，共 ${
            nextWaypoints.length
          } 个规划航路点 ([${coord[0].toFixed(2)}°E, ${coord[1].toFixed(2)}°N])。`,
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
              heading: nextHeading,
              speedKts: nextSpeed,
              targetSpeedKts: Math.max(unit.targetSpeedKts, nextSpeed),
            },
          },
          logs: [newLog, ...s.logs].slice(0, 250),
        };
      }),

    clearUnitWaypoints: (unitId) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        return {
          units: {
            ...s.units,
            [unitId]: { ...unit, waypoints: [], navigationMode: 'manual', missionTargetId: undefined },
          },
        };
      }),

    updateUnitDoctrine: (unitId, patch) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        const updatedDoctrine = { ...unit.doctrine, ...patch };
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
        if (!canCommandUnit(s, carrier) || !getUnitCapabilities(carrier).canFire) return s;

        const slotIndex = carrier.hangar.findIndex(
          (h) => h.slotId === hangarSlotId
        );
        if (slotIndex === -1) return s;
        const slot = carrier.hangar[slotIndex];
        if (slot.readyAirframes <= 0 || slot.cooldownRemainingSec > 0) return s;

        const airSpec = s.catalog.platforms[slot.platformId];
        if (!airSpec) return s;

        const chosenLoadoutId = customLoadoutId || slot.selectedLoadoutId;
        if (!slot.availableLoadoutIds.includes(chosenLoadoutId)) return s;
        const loadout = s.catalog.loadouts[chosenLoadoutId];
        if (!loadout?.compatiblePlatformIds.includes(slot.platformId)) return s;
        const sortieIndex =
          slot.totalAirframes - slot.readyAirframes - slot.reserveAirframes + 1;
        const newAirUnitId = `sortie_${carrier.id}_${hangarSlotId}_${s.tick}_${s.commandSequence}_${sortieIndex}`;
        const callsignPrefix =
          carrier.side === 'RED' ? 'HAIDONG' : 'STRIKE';

        const launchedUnit = createRuntimeUnitFromPlacement(
          {
            id: newAirUnitId,
            name: `${slot.squadronName} #${sortieIndex}波次`,
            callsign: `${callsignPrefix}-${sortieIndex}0${slotIndex + 1}`,
            side: carrier.side,
            platformId: slot.platformId,
            loadoutId: chosenLoadoutId,
            parentGroupId: carrier.parentGroupId,
            position: [
              Number((carrier.position[0] + (carrier.side === 'RED' ? 0.12 : -0.12)).toFixed(4)),
              Number((carrier.position[1] + 0.08).toFixed(4)),
            ],
            altitudeM: airSpec.defaultAltitudeM,
            heading: carrier.heading,
          },
          s.catalog
        );
        launchedUnit.hostCarrierId = carrier.id;

        const nextHangar = carrier.hangar.map((h, idx) =>
          idx === slotIndex
            ? {
                ...h,
                selectedLoadoutId: chosenLoadoutId,
                readyAirframes: h.readyAirframes - 1,
                cooldownRemainingSec: h.launchCooldownSec,
              }
            : h
        );

        const launchLog: CombatLogEntry = {
          id: `log_sortie_${s.tick}_${s.commandSequence}_${newAirUnitId}`,
          simTime: s.simTime,
          side: carrier.side,
          category: 'EVENT',
          severity: 'info',
          title: `[甲板弹射升空] ${carrier.callsign} 放飞 ${launchedUnit.name}`,
          message: `${carrier.name} 电磁弹射放飞 ${launchedUnit.name} (${launchedUnit.callsign})，挂载方案: ${
            s.catalog.loadouts[chosenLoadoutId]?.name || chosenLoadoutId
          }。`,
          position: [...launchedUnit.position],
          unitId: newAirUnitId,
        };

        return {
          units: {
            ...s.units,
            [carrier.id]: {
              ...carrier,
              hangar: nextHangar,
            },
            [newAirUnitId]: launchedUnit,
          },
          score: {
            ...s.score,
            sortiesLaunched: (s.score.sortiesLaunched || 0) + 1,
          },
          selectedUnitId: newAirUnitId,
          logs: [launchLog, ...s.logs].slice(0, 250),
        };
      }),

    assignUnitMission: (unitId, missionId) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        if (missionId && !s.missions.some((mission) => mission.id === missionId && mission.side === unit.side)) return s;
        const units = { ...s.units, [unitId]: { ...unit, assignedMissionId: missionId, navigationMode: missionId ? 'mission' as const : 'manual' as const, missionTargetId: undefined, waypoints: [] } };
        return {
          missions: deriveMissionAssignments(s.missions, units),
          units,
        };
      }),

    toggleMissionActive: (missionId) => set((s) => {
      const mission = s.missions.find((m) => m.id === missionId);
      if (s.battleResult || !mission || (s.playMode !== 'sandbox' && mission.side !== s.playerSide)) return s;
      return { missions: s.missions.map((m) => m.id === missionId &&
        (s.playMode === 'sandbox' || m.side === s.playerSide) ? { ...m, isActive: !m.isActive } : m) };
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
      for (let i = 0; i < salvo; i++) {
        const id = `manual_${s.tick}_${s.commandSequence}_${attacker.id}_${i}`;
        weaponsInFlight[id] = { id, weaponId: weapon.id, name: weapon.codeName, side: attacker.side,
          shooterId: attacker.id, shooterName: attacker.callsign, targetId: contact.actualUnitId, targetType: 'unit',
          position: [...attacker.position], launchPosition: [...attacker.position], trail: [[...attacker.position]],
          altitudeM: weapon.cruiseAltitudeM, heading: getBearingDeg(attacker.position, contact.estimatedPosition),
          speedKts: weapon.speedKts, distanceRemainingKm: solution.distanceKm!, maxRangeKm: weapon.maxRangeKm,
          traveledKm: 0, basePk: weapon.basePk, warheadDamage: weapon.warheadDamage,
          requiresDatalinkBeyondHorizon: weapon.requiresDatalinkBeyondHorizon,
          datalinkSupported: solution.supportSourceIds.length > 0, ...launchGuidance(contact) };
      }
      const updatedAttacker = { ...attacker, status: 'engaged' as const, mounts: attacker.mounts.map((m) =>
        m.mountId === mount.mountId ? { ...m, currentAmmo: m.currentAmmo - salvo,
          cooldownRemainingSec: m.reloadTimeSec * getUnitCapabilities(attacker).reloadFactor } : m) };
      recordWeaponLaunch(updatedAttacker, mount, salvo, s.simTime);
      const score = { ...s.score };
      if (attacker.side === 'RED') score.redMissilesFired += salvo; else score.blueMissilesFired += salvo;
      const log: CombatLogEntry = { id: `manual_log_${s.tick}_${s.commandSequence}`, simTime: s.simTime,
        side: attacker.side, category: 'LAUNCH', severity: 'warning', title: `${attacker.callsign} 发射 ${salvo} 枚 ${weapon.codeName}`,
        message: `瞄准 ${contact.displayName}（估计距离 ${solution.distanceKm!.toFixed(1)} km）。${solution.riskWarnings.join('；')}`,
        unitId: attacker.id, position: [...attacker.position] };
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
        if (get() !== before) set({ commandSequence: before.commandSequence + 1,
          commandHistory: [...get().commandHistory, { tick: before.tick, sequence: before.commandSequence,
            action: name, args: structuredClone(args) }] });
      } });
    }
    return state;
  })
);
