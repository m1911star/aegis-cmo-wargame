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
  getDistanceKm,
  stepSimulationWorld,
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
  showSatelliteDarkTiles: boolean;
}

export interface WargameStoreState {
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
  loadScenario: (scenario: ScenarioDefinition, randomizeSpawns?: boolean) => void;
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
    salvoCount?: number
  ) => void;
  addReferencePoint: (coord: [number, number], side?: SideId) => void;
  removeReferencePoint: (rpId: string) => void;
  spawnUnitAtCoordinate: (coord: [number, number]) => void;
}

function createInitialStateFromScenario(
  definition: ScenarioDefinition,
  randomizeSpawns = false
) {
  const { scenario, catalog } = compileScenario(definition);
  const initialUnits = instantiateScenarioUnits(
    scenario,
    catalog,
    randomizeSpawns ? Math.random : () => 0.5
  );
  const startTime = Date.parse(scenario.startTimeIso);

  const initialWorld = {
    startTime,
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

  // 预运行 1 秒以生成开局初始雷达/ESM接触态势
  const warmup = stepSimulationWorld(
    initialWorld,
    catalog,
    1,
    {
      onNewContact: false,
      onMissileDetected: false,
      onUnitHitOrDestroyed: false,
    },
    'RED'
  );

  const firstRedUnitId =
    Object.values(warmup.nextState.units).find((u) => u.side === 'RED')?.id ||
    null;

  return {
    scenario,
    catalog,
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
        message: `战区C4ISR综合数据链已接通，初始发现 ${
          Object.keys(warmup.nextState.contacts).length
        } 批雷达/ESM接触目标。按 [Space] 启动半实时推演。`,
      },
      ...warmup.newLogs,
    ],
  };
}

const initialBoot = createInitialStateFromScenario(SCENARIO_EAST_SEA_THUNDER);

export const useWargameStore = create<WargameStoreState>()(
  subscribeWithSelector((set, get) => ({
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
      showSatelliteDarkTiles: false, // 默认使用清爽纯粹的军工海陆矢量底图（无第三方水印干扰）
    },
    cameraFlyToRequest: null,
    activeModal: 'none',

    loadScenario: (scenario, randomizeSpawns = false) => {
      const boot = createInitialStateFromScenario(scenario, randomizeSpawns);
      set((state) => {
        const exists = state.availableScenarios.some(
          (s) => s.id === scenario.id
        );
        return {
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
      get().loadScenario(current, randomizeSpawns);
    },

    setTimeScale: (scale) =>
      set({
        timeScale: scale,
        lastAutoPauseBanner: scale > 0 ? null : get().lastAutoPauseBanner,
      }),

    stepSingleTick: (dtSec = 2) => {
      const s = get();
      const result = stepSimulationWorld(
        {
          startTime: s.startTime,
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
        dtSec,
        s.autoPause,
        s.activePerspective
      );

      set((prev) => ({
        simTime: result.nextState.simTime,
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
        interactionMode: 'select',
      }),

    toggleAutoPause: (key) =>
      set((s) => ({
        autoPause: { ...s.autoPause, [key]: !s.autoPause[key] },
      })),

    clearAutoPauseBanner: () => set({ lastAutoPauseBanner: null }),

    selectUnit: (unitId) =>
      set({
        selectedUnitId: unitId,
        selectedContactId: null,
        interactionMode: 'select',
      }),

    selectContact: (contactId) =>
      set({
        selectedContactId: contactId,
        interactionMode: 'select',
      }),

    setInteractionMode: (mode) => set({ interactionMode: mode }),

    startManualEngage: (weaponId, salvoCount = 2) =>
      set({
        interactionMode: 'manual_engage',
        pendingWeaponIdForEngage: weaponId || null,
        pendingSalvoCount: salvoCount,
      }),

    startSpawnUnitOnMap: (config) =>
      set({
        interactionMode: 'spawn_unit',
        pendingSpawnConfig: config,
        activeModal: 'none',
      }),

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
        if (!unit || unit.hp <= 0) return s;
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
          id: `log_wp_${Date.now()}_${unitId}`,
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
        if (!unit) return s;
        return {
          units: {
            ...s.units,
            [unitId]: { ...unit, waypoints: [] },
          },
        };
      }),

    updateUnitDoctrine: (unitId, patch) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!unit) return s;
        const updatedDoctrine = { ...unit.doctrine, ...patch };
        const newLog: CombatLogEntry = {
          id: `log_doc_${Date.now()}_${unitId}`,
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
        if (!unit) return s;
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
        if (!unit || unit.hp <= 0 || !loadout || unit.activeLoadoutId === loadoutId) return s;
        if (!loadout.compatiblePlatformIds.includes(unit.platformId)) return s;
        const previous = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
        const configuration = resolveUnitConfiguration(s.catalog, unit.platformId, loadoutId);
        const nextMounts = createRuntimeWeaponMounts(configuration, s.catalog, unit.weaponUsage, s.simTime);
        const adjustSpeed = (speed: number) => Math.abs(speed - previous.cruiseSpeedKts) < 0.5
          ? configuration.cruiseSpeedKts : Math.min(speed, configuration.maxSpeedKts);

        const loadoutLog: CombatLogEntry = {
          id: `log_loadout_${Date.now()}_${unitId}`,
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
        if (!carrier || carrier.hp <= 0) return s;

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
        const newAirUnitId = `sortie_${carrier.id}_${hangarSlotId}_${Date.now().toString(36)}_${sortieIndex}`;
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
          id: `log_sortie_${Date.now()}_${newAirUnitId}`,
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
        if (!unit) return s;
        if (missionId && !s.missions.some((mission) => mission.id === missionId && mission.side === unit.side)) return s;
        const units = { ...s.units, [unitId]: { ...unit, assignedMissionId: missionId } };
        return {
          missions: deriveMissionAssignments(s.missions, units),
          units,
        };
      }),

    toggleMissionActive: (missionId) =>
      set((s) => ({
        missions: s.missions.map((m) =>
          m.id === missionId ? { ...m, isActive: !m.isActive } : m
        ),
      })),

    executeManualEngage: (
      attackerId,
      targetIdOrContactId,
      weaponId,
      salvoCount
    ) =>
      set((s) => {
        const attacker = s.units[attackerId];
        if (!attacker || attacker.hp <= 0) return s;

        const contact = s.contacts[targetIdOrContactId];
        const actualTargetId = contact
          ? contact.actualUnitId
          : targetIdOrContactId;
        const targetUnit = s.units[actualTargetId];
        if (
          !targetUnit ||
          targetUnit.hp <= 0 ||
          targetUnit.side === attacker.side
        ) {
          return s;
        }

        const distKm = getDistanceKm(attacker.position, targetUnit.position);

        const candidateMount = attacker.mounts.find((m) => {
          if (m.currentAmmo <= 0 || m.cooldownRemainingSec > 0) return false;
          if (weaponId && m.weaponId !== weaponId) return false;
          const wSpec = s.catalog.weapons[m.weaponId];
          if (!wSpec) return false;
          if (!wSpec.targetDomains.includes(targetUnit.domain)) return false;
          return distKm <= wSpec.maxRangeKm && distKm >= wSpec.minRangeKm;
        });

        if (!candidateMount) {
          const rejectLog: CombatLogEntry = {
            id: `log_err_engage_${Date.now()}`,
            simTime: s.simTime,
            side: attacker.side,
            category: 'DOCTRINE',
            severity: 'warning',
            title: `火力分配被拒绝: 武器冷却、超出射程或无匹配弹药`,
            message: `${attacker.name} 距离目标 ${targetUnit.callsign} 为 ${distKm.toFixed(
              1
            )} km，当前选中武器尚未就绪或不满足射程、作战域约束。`,
            position: [...attacker.position],
            unitId: attacker.id,
          };
          return {
            interactionMode: 'select',
            logs: [rejectLog, ...s.logs].slice(0, 250),
          };
        }

        const wSpec = s.catalog.weapons[candidateMount.weaponId]!;
        const requestedSalvo = salvoCount ?? attacker.doctrine.salvoSize ?? wSpec.salvoDefault;
        if (!Number.isSafeInteger(requestedSalvo) || requestedSalvo <= 0) return s;
        const actualSalvo = Math.min(
          requestedSalvo,
          candidateMount.currentAmmo
        );

        const nextWeaponsInFlight = { ...s.weaponsInFlight };
        for (let i = 0; i < actualSalvo; i++) {
          const mslId = `msl_manual_${s.simTime}_${attacker.id}_${s.score.redMissilesFired + s.score.blueMissilesFired + i}`;
          nextWeaponsInFlight[mslId] = {
            id: mslId,
            weaponId: wSpec.id,
            name: wSpec.codeName,
            side: attacker.side,
            shooterId: attacker.id,
            shooterName: attacker.callsign,
            targetId: targetUnit.id,
            targetType: 'unit',
            position: [...attacker.position],
            launchPosition: [...attacker.position],
            trail: [[...attacker.position]],
            altitudeM: wSpec.cruiseAltitudeM,
            heading: getBearingDeg(attacker.position, targetUnit.position),
            speedKts: wSpec.speedKts,
            distanceRemainingKm: distKm,
            maxRangeKm: wSpec.maxRangeKm,
            traveledKm: 0,
            basePk: wSpec.basePk,
            warheadDamage: wSpec.warheadDamage,
            requiresDatalinkBeyondHorizon: wSpec.requiresDatalinkBeyondHorizon,
            datalinkSupported: true,
          };
        }

        const nextMounts = attacker.mounts.map((m) =>
          m.mountId === candidateMount.mountId
            ? {
                ...m,
                currentAmmo: m.currentAmmo - actualSalvo,
                cooldownRemainingSec: m.reloadTimeSec,
              }
            : m
        );

        const nextScore = { ...s.score };
        const updatedAttacker = { ...attacker };
        recordWeaponLaunch(updatedAttacker, candidateMount, actualSalvo, s.simTime);
        if (attacker.side === 'RED') nextScore.redMissilesFired += actualSalvo;
        else nextScore.blueMissilesFired += actualSalvo;

        const fireLog: CombatLogEntry = {
          id: `log_man_fire_${Date.now()}`,
          simTime: s.simTime,
          side: attacker.side,
          category: 'LAUNCH',
          severity: 'warning',
          title: `[手动齐射指令] ${attacker.callsign} 发射 ${actualSalvo} 枚 ${wSpec.codeName}`,
          message: `指挥所人工接管火控：${attacker.name} 对 ${targetUnit.name}（距离 ${distKm.toFixed(
            1
          )} km）实施 ${actualSalvo} 发精确齐射！`,
          position: [...attacker.position],
          unitId: attacker.id,
        };

        return {
          weaponsInFlight: nextWeaponsInFlight,
          score: nextScore,
          interactionMode: 'select',
          pendingWeaponIdForEngage: null,
          units: {
            ...s.units,
            [attacker.id]: {
              ...updatedAttacker,
              status: 'engaged',
              mounts: nextMounts,
            },
          },
          logs: [fireLog, ...s.logs].slice(0, 250),
        };
      }),

    addReferencePoint: (coord, side) =>
      set((s) => {
        const rpSide: SideId =
          side || (s.activePerspective === 'BLUE' ? 'BLUE' : 'RED');
        const idx = s.referencePoints.length + 1;
        const newRp: ReferencePoint = {
          id: `rp_${Date.now()}`,
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
        referencePoints: s.referencePoints.filter((r) => r.id !== rpId),
      })),

    spawnUnitAtCoordinate: (coord) =>
      set((s) => {
        const cfg = s.pendingSpawnConfig;
        if (!cfg) return { interactionMode: 'select' };
        const spec = s.catalog.platforms[cfg.platformId];
        if (!spec) return { interactionMode: 'select' };

        const newId = `unit_spawn_${Date.now().toString(36)}`;
        const defaultGroup =
          s.currentScenario.groups.find((g) => g.side === cfg.side)?.id ||
          'custom_group';

        const newUnit = createRuntimeUnitFromPlacement(
          {
            id: newId,
            name: cfg.name || spec.name,
            callsign:
              cfg.callsign ||
              `${cfg.side}-${Math.floor(Math.random() * 899 + 100)}`,
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
          id: `log_spawn_${Date.now()}`,
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
  }))
);
