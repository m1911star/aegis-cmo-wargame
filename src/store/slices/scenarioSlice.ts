import * as turf from '../../engine/turfGeo';
import { createAarLedger } from '../../engine/aar';
import { canCommandUnit, contactForUnit } from '../../engine/commandPolicy';
import { createRandomStream, DEFAULT_SEED, SNAPSHOT_INTERVAL_TICKS } from '../../engine/determinism';
import { deriveMissionAssignments } from '../../engine/missions';
import {
  advanceSimulation,
  initializeWorldContacts,
  type SimulationWorldState,
} from '../../engine/simulationEngine';
import { resolveUnitConfiguration } from '../../engine/unitConfiguration';
import { BASEMAP_PRESETS, DEFAULT_BASEMAP } from '../../map/basemaps';
import {
  BUILTIN_SCENARIOS,
  instantiateScenarioUnits,
} from '../../scenarios/builtinScenarios';
import { INFORMATION_EXERCISE } from '../../scenarios/informationExercise';
import {
  BUILTIN_CAMPAIGN_WESTPAC,
  applyCampaignResupplyChoice,
  applyCampaignRuntimeCarryover,
  buildCampaignStageScenario,
  computeNextCampaignCarryover,
  createInitialCampaignState,
  type CampaignResupplyChoice,
  type CampaignStageStart,
  type CampaignState,
} from '../../scenarios/campaign';
import { FORCE_PACKAGES, resolveEquipmentCatalog, validateCatalogIntegrity } from '../../db';
import { compileScenario } from '../../scenarios/compileScenario';
import type { EquipmentCatalog, ScenarioDefinition } from '../../types/wargame';
import { assertCatalogOverlayShape } from '../../validation/wargameSchemas';
import { emitActionFeedback } from '../actionFeedbackBus';
import {
  AUTOSAVE_STORAGE_KEY,
  advanceReplayRecordingIncremental,
  prepareBattleSave,
  isApplyingBattleRecording,
  replayBattleRecording,
  restoreBattleSave,
  type BattleRecording,
  type BattleSnapshot,
} from '../battleRecording';
import { appendReplayKeyframe, compactReplayKeyframes } from '../replayKeyframes';
import { readAutosave, writeAutosave } from '../autosaveStorage';
import type { StoreGet, StoreSet, WargameStoreState } from '../types';

export function createInitialStateFromScenario(
  definition: ScenarioDefinition,
  randomizeSpawns = false,
  requestedSeed?: number,
  campaignStart?: CampaignStageStart
) {
  const { scenario, catalog } = compileScenario(definition);
  const seed = requestedSeed ?? (randomizeSpawns ? crypto.getRandomValues(new Uint32Array(1))[0] : DEFAULT_SEED);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer');
  const random = createRandomStream(seed);
  const spawned = instantiateScenarioUnits(scenario, catalog, random.next);
  const playerSide = campaignStart?.playerSide ?? 'RED';
  const initialUnits = campaignStart
    ? applyCampaignRuntimeCarryover(spawned, campaignStart.carryover, playerSide, catalog)
    : spawned;
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

  const selectedUnitId = Object.values(warmup.nextState.units).find((u) => u.side === playerSide)?.id ?? null;

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
    selectedUnitId,
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

function readHasAutosave(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage?.getItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    return false;
  }
}

export function extractSimulationWorldState(s: WargameStoreState): SimulationWorldState {
  return {
    startTime: s.startTime,
    tick: s.tick,
    rngState: s.rngState,
    objectives: s.objectives,
    objectiveProgress: s.objectiveProgress,
    objectiveHoldProgress: s.objectiveHoldProgress,
    creditedDamage: s.creditedDamage,
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
    pendingTotStrikeOrders: s.pendingTotStrikeOrders,
    environment: s.environment,
    victoryConditions: s.currentScenario.victoryConditions,
    score: s.score,
  };
}

export function createScenarioSlice(set: StoreSet, get: StoreGet) {
  const initialBoot = createInitialStateFromScenario(INFORMATION_EXERCISE);
  let liveBattleBeforeReplay: WargameStoreState | undefined;
  let autosaveGeneration = 0;
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let latestAutosave = 0;
  let autosaveAt = -Infinity;
  let autosaveQueue = Promise.resolve();
  const cancelQueuedAutosave = () => {
    autosaveGeneration++;
    if (autosaveTimer !== undefined) clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
    autosaveAt = -Infinity;
  };

  return {
    basemapMode: DEFAULT_BASEMAP,
    setBasemapMode: (mode: WargameStoreState['basemapMode']) => {
      if (Object.hasOwn(BASEMAP_PRESETS, mode)) set({ basemapMode: mode });
    },
    playerSide: 'RED' as const,
    playMode: 'command' as const,
    campaignState: null,
    campaignStageStart: undefined,
    hasAutosave: readHasAutosave(),
    refreshAutosaveAvailability: async () => {
      if (typeof indexedDB === 'undefined') return;
      try { if (await readAutosave()) set({ hasAutosave: true }); } catch { /* A manual export is still available. */ }
    },
    replayPlayer: null,
    seed: initialBoot.seed,
    rngState: initialBoot.rngState,
    tick: 0,
    pendingSimSeconds: 0,
    commandSequence: 0,
    commandHistory: [],
    replaySnapshots: [],
    objectiveProgress: {},
    objectiveHoldProgress: {},
    battleResult: undefined,
    creditedDamage: {},
    detectedMissileIds: [],
    aar: initialBoot.aar,
    pendingRiskEngagement: null,
    setPlayerSide: (side: 'RED' | 'BLUE') => {
      const s = get();
      if (s.campaignState || s.tick !== 0 || s.timeScale !== 0 || s.playerSide === side) return;
      const firstUnitId = Object.values(s.units).find((u) => u.side === side)?.id ?? null;
      set({
        playerSide: side,
        activePerspective: side,
        selectedContactId: null,
        selectedUnitId: firstUnitId,
        selectedUnitIds: firstUnitId ? [firstUnitId] : [],
      });
    },
    setPlayMode: (mode: WargameStoreState['playMode']) => {
      if (get().playMode === mode) return;
      set({
        playMode: mode, timeScale: 0, pendingRiskEngagement: null,
        selectedUnitId: null, selectedUnitIds: [], selectedContactId: null, interactionMode: 'select', activePerspective: get().playerSide,
      });
    },
    dismissRiskEngagement: () => set({ pendingRiskEngagement: null }),
    selectLogEntry: (id: string) => {
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
    timeScale: 0 as const,
    activePerspective: 'RED' as const,
    autoPause: {
      onNewContact: false,
      onMissileDetected: false,
      onUnitHitOrDestroyed: false,
    },
    lastAutoPauseBanner: null,

    units: initialBoot.units,
    contacts: initialBoot.contacts,
    weaponsInFlight: initialBoot.weaponsInFlight,
    explosions: initialBoot.explosions,
    missions: initialBoot.missions,
    events: initialBoot.events,
    pendingSortieOrders: initialBoot.pendingSortieOrders,
    pendingTotStrikeOrders: [],
    environment: initialBoot.environment,
    referencePoints: initialBoot.referencePoints,
    logs: initialBoot.logs,
    score: initialBoot.score,

    selectedUnitId: initialBoot.selectedUnitId,
    selectedUnitIds: initialBoot.selectedUnitId ? [initialBoot.selectedUnitId] : [],
    selectedContactId: null,
    interactionMode: 'select' as const,
    pendingWeaponIdForEngage: null,
    pendingSalvoCount: 2,
    pendingStrikeWaypoints: [],
    appendPendingStrikeWaypoint: (coord: [number, number]) =>
      set((s) => {
        if (!Array.isArray(coord) || coord.length !== 2 || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return s;
        if (s.pendingStrikeWaypoints.length >= 4) return s;
        return { pendingStrikeWaypoints: [...s.pendingStrikeWaypoints, [...coord] as [number, number]] };
      }),
    clearPendingStrikeWaypoints: () => set({ pendingStrikeWaypoints: [] }),
    pendingSpawnConfig: null,
    pendingForcePackageConfig: null,
    pendingPolygonDraft: null,
    startPolygonDraw: (config: Omit<NonNullable<WargameStoreState['pendingPolygonDraft']>, 'vertices'>) => {
      const s = get();
      if (s.playMode !== 'sandbox') {
        emitActionFeedback('warning', '请先切换至沙盒模式再在地图上标绘多边形');
        return;
      }
      set({
        pendingPolygonDraft: { ...config, vertices: [] },
        interactionMode: 'draw_polygon',
        activeModal: 'none',
      });
      emitActionFeedback('info', `已进入地图多边形标绘：依次左键点击海图添加顶点（≥3），点击顶部「闭合保存」完成`);
    },
    appendPolygonDrawVertex: (coord: [number, number]) =>
      set((s) => {
        if (!s.pendingPolygonDraft || !Array.isArray(coord) || coord.length !== 2 ||
            !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return s;
        if (s.pendingPolygonDraft.vertices.length >= 64) return s;
        return {
          pendingPolygonDraft: {
            ...s.pendingPolygonDraft,
            vertices: [...s.pendingPolygonDraft.vertices, [Number(coord[0].toFixed(4)), Number(coord[1].toFixed(4))]],
          },
        };
      }),
    undoPolygonDrawVertex: () =>
      set((s) => {
        if (!s.pendingPolygonDraft || s.pendingPolygonDraft.vertices.length === 0) return s;
        return {
          pendingPolygonDraft: {
            ...s.pendingPolygonDraft,
            vertices: s.pendingPolygonDraft.vertices.slice(0, -1),
          },
        };
      }),
    cancelPolygonDraw: () =>
      set({
        pendingPolygonDraft: null,
        interactionMode: 'select',
      }),
    commitPolygonDraw: () => {
      const s = get();
      const draft = s.pendingPolygonDraft;
      if (!draft || draft.vertices.length < 3) {
        emitActionFeedback('warning', '多边形至少需要标绘 3 个顶点');
        return false;
      }
      const poly = turf.polygon([[...draft.vertices, draft.vertices[0]]]);
      if (turf.area(poly) <= 1 || turf.kinks(poly).features.length > 0) {
        emitActionFeedback('warning', '多边形存在自相交或退化边，请撤销调整顶点');
        return false;
      }
      const beforeSeq = get().commandSequence;
      if (draft.targetKind === 'control_area') {
        get().upsertObjective({
          title: draft.name.trim() || '新建夺控区',
          side: draft.side ?? 'RED',
          type: 'control_area',
          unitIds: [],
          areaPolygon: draft.vertices,
          controlDomains: ['land', 'surface'],
          holdDurationSec: draft.holdDurationSec,
          required: true,
          points: draft.pointsScore ?? 200,
        });
      } else if (draft.targetKind === 'land') {
        get().upsertEnvironmentPolygon({
          kind: 'land',
          name: draft.name.trim() || '高地/岛屿遮蔽区',
          areaPolygon: draft.vertices,
          elevationM: draft.elevationM ?? 600,
        });
      } else if (draft.targetKind === 'acoustic_shallow' || draft.targetKind === 'acoustic_deep') {
        get().upsertEnvironmentPolygon({
          kind: 'acoustic',
          name: draft.name.trim() || (draft.targetKind === 'acoustic_shallow' ? '浅海声学杂波区' : '深海汇聚声道区'),
          areaPolygon: draft.vertices,
          acousticKind: draft.targetKind === 'acoustic_shallow' ? 'shallow' : 'deep',
        });
      } else {
        get().upsertEnvironmentPolygon({
          kind: 'weather',
          name: draft.name.trim() || (draft.targetKind === 'weather_rain' ? '雷暴强降雨区' : '海雾低能见区'),
          areaPolygon: draft.vertices,
          condition: draft.targetKind === 'weather_rain' ? 'rain_storm' : 'heavy_fog',
          seaStateOverride: draft.seaStateOverride,
        });
      }
      if (get().commandSequence <= beforeSeq) {
        return false;
      }
      set({
        pendingPolygonDraft: null,
        interactionMode: 'select',
        activeModal: 'builder',
      });
      emitActionFeedback('info', `已完成标绘并保存：${draft.name}`);
      return true;
    },
    mapLayers: {
      showRadarRings: true,
      showWeaponRings: true,
      showSonarRings: true,
      showWaypoints: true,
      showMissions: true,
      showAouPolygons: true,
      showReferencePoints: true,
      show3dTerrain: false,
    },
    tacview3dOpen: false,
    cameraFlyToRequest: null,
    activeModal: 'none' as const,

    importCatalogJson: (rawInput: unknown, mode: 'merge' | 'replace' = 'merge') => {
      try {
        const parsed = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
        assertCatalogOverlayShape(parsed);
        const s = get();
        const prevOverlay = mode === 'merge' ? s.currentScenario.customCatalogOverlay : undefined;
        const mergeSection = <T>(
          a: Record<string, T> | undefined,
          b: Record<string, T> | undefined
        ): Record<string, T> | undefined => {
          if (!a && !b) return undefined;
          return { ...(a ?? {}), ...(b ?? {}) };
        };
        const nextOverlay: Partial<EquipmentCatalog> = {
          version: parsed.version || prevOverlay?.version || 'cmo_hotload_overlay',
          sensors: mergeSection(prevOverlay?.sensors, parsed.sensors),
          weapons: mergeSection(prevOverlay?.weapons, parsed.weapons),
          loadouts: mergeSection(prevOverlay?.loadouts, parsed.loadouts),
          platforms: mergeSection(prevOverlay?.platforms, parsed.platforms),
          warheads: mergeSection(prevOverlay?.warheads, parsed.warheads),
          mounts: mergeSection(prevOverlay?.mounts, parsed.mounts),
          magazines: mergeSection(prevOverlay?.magazines, parsed.magazines),
          propulsions: mergeSection(prevOverlay?.propulsions, parsed.propulsions),
          comms: mergeSection(prevOverlay?.comms, parsed.comms),
        };
        const nextCatalog = resolveEquipmentCatalog(nextOverlay);
        const integrity = validateCatalogIntegrity(nextCatalog);
        if (!integrity.valid) {
          const err = integrity.errors.slice(0, 3).join('；');
          emitActionFeedback('error', `装备目录引用校验失败：${err}`);
          return { ok: false, error: err };
        }
        for (const unit of Object.values(s.units)) {
          resolveUnitConfiguration(nextCatalog, unit.platformId, unit.activeLoadoutId);
        }
        const summary = [
          parsed.platforms && `${Object.keys(parsed.platforms).length} 平台`,
          parsed.weapons && `${Object.keys(parsed.weapons).length} 武器`,
          parsed.sensors && `${Object.keys(parsed.sensors).length} 传感器`,
          parsed.loadouts && `${Object.keys(parsed.loadouts).length} 挂载`,
        ]
          .filter(Boolean)
          .join(' / ') || '0 新增条目';
        set({
          catalog: nextCatalog,
          currentScenario: {
            ...s.currentScenario,
            customCatalogOverlay: nextOverlay,
          },
        });
        emitActionFeedback('info', `已热加载装备目录 (${mode === 'merge' ? '合并' : '替换覆盖'})：${summary}`);
        return { ok: true, importedSummary: summary };
      } catch (error) {
        const msg = error instanceof Error ? error.message : '无效的 Catalog JSON';
        emitActionFeedback('error', `导入装备目录失败：${msg}`);
        return { ok: false, error: msg };
      }
    },

    resetCatalogToDefault: () => {
      const s = get();
      const builtinMatch = BUILTIN_SCENARIOS.find((sc) => sc.id === s.currentScenario.id);
      const baseOverlay = builtinMatch?.customCatalogOverlay;
      const baseCatalog = resolveEquipmentCatalog(baseOverlay);
      try {
        for (const unit of Object.values(s.units)) {
          resolveUnitConfiguration(baseCatalog, unit.platformId, unit.activeLoadoutId);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : '当前战场存在依赖热加载目录的已部署单位';
        emitActionFeedback('warning', `无法重置：当前战场仍有算子依赖外挂装备（${msg}）`);
        return { ok: false, error: msg };
      }
      set({
        catalog: baseCatalog,
        currentScenario: {
          ...s.currentScenario,
          customCatalogOverlay: baseOverlay ? structuredClone(baseOverlay) : undefined,
        },
      });
      emitActionFeedback('info', '已重置为内置标准装备目录');
      return { ok: true };
    },

    loadScenario: (scenario: ScenarioDefinition, randomizeSpawns = false, seed?: number, campaignStart?: CampaignStageStart) => {
      const boot = createInitialStateFromScenario(scenario, randomizeSpawns, seed, campaignStart);
      const playerSide = campaignStart?.playerSide ?? 'RED';
      const applyingRecording = isApplyingBattleRecording();
      if (!applyingRecording) {
        liveBattleBeforeReplay = undefined;
        cancelQueuedAutosave();
      }
      set((state) => {
        const exists = state.availableScenarios.some(
          (s) => s.id === scenario.id
        );
        return {
          playerSide, playMode: 'command', activePerspective: playerSide,
          campaignState: null, campaignStageStart: campaignStart,
          replayPlayer: applyingRecording ? state.replayPlayer : null,
          seed: boot.seed, rngState: boot.rngState, tick: 0, pendingSimSeconds: 0,
          commandSequence: 0, commandHistory: [], replaySnapshots: [], objectiveProgress: {}, objectiveHoldProgress: {}, battleResult: undefined,
          creditedDamage: {}, detectedMissileIds: [], aar: boot.aar, pendingRiskEngagement: null,
          pendingSpawnConfig: null, pendingForcePackageConfig: null, pendingPolygonDraft: null,
          pendingWeaponIdForEngage: null, pendingStrikeWaypoints: [],
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
          pendingTotStrikeOrders: [],
          environment: boot.environment,
          referencePoints: boot.referencePoints,
          logs: boot.logs,
          score: boot.score,
          selectedUnitId: boot.selectedUnitId,
          selectedUnitIds: boot.selectedUnitId ? [boot.selectedUnitId] : [],
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
      const prevCampaign = get().campaignState;
      get().loadScenario(current, randomizeSpawns, randomizeSpawns ? undefined : get().seed, get().campaignStageStart);
      if (prevCampaign) set({ campaignState: prevCampaign });
    },

    startCampaign: (side?: 'RED' | 'BLUE') => {
      const chosenSide: 'RED' | 'BLUE' = side ?? (get().playerSide === 'BLUE' ? 'BLUE' : 'RED');
      const campaignState = createInitialCampaignState(BUILTIN_CAMPAIGN_WESTPAC, chosenSide);
      const firstStage = BUILTIN_CAMPAIGN_WESTPAC.stages[0];
      const base = BUILTIN_SCENARIOS.find((candidate) => candidate.id === firstStage.scenarioId) ?? BUILTIN_SCENARIOS[0];
      const stageScenario = buildCampaignStageScenario(base, campaignState.carryover, chosenSide, 0);
      get().loadScenario(stageScenario, false, DEFAULT_SEED, { playerSide: chosenSide, carryover: campaignState.carryover });
      set({ campaignState });
    },

    advanceCampaignStage: (resupplyChoice: CampaignResupplyChoice = 'balanced') => {
      const state = get();
      const campaign = state.campaignState;
      if (!campaign || !state.battleResult || campaign.finished) return;
      const sideScore = campaign.playerSide === 'RED' ? state.score.redScore : state.score.blueScore;
      const ownLosses = campaign.playerSide === 'RED' ? state.score.redLosses : state.score.blueLosses;
      const rawCarryover = computeNextCampaignCarryover(
        campaign.carryover,
        state.battleResult,
        campaign.playerSide,
        sideScore,
        ownLosses,
        state.units
      );
      const nextCarryover = applyCampaignResupplyChoice(rawCarryover, resupplyChoice);
      const nextIndex = campaign.currentStageIndex + 1;
      if (nextIndex >= BUILTIN_CAMPAIGN_WESTPAC.stages.length) {
        set({
          campaignState: {
            ...campaign,
            finished: true,
            supplyPoints: nextCarryover.supplyPoints,
            airbaseIntegrityPct: nextCarryover.airbaseIntegrityPct,
            stageModifiers: [...nextCarryover.stageModifiers],
            carryover: nextCarryover,
          },
        });
        return;
      }
      const nextStageDef = BUILTIN_CAMPAIGN_WESTPAC.stages[nextIndex];
      const base = BUILTIN_SCENARIOS.find((candidate) => candidate.id === nextStageDef.scenarioId) ?? BUILTIN_SCENARIOS[0];
      const stageScenario = buildCampaignStageScenario(base, nextCarryover, campaign.playerSide, nextIndex);
      const nextCampaignState: CampaignState = {
        ...campaign,
        currentStageIndex: nextIndex,
        supplyPoints: nextCarryover.supplyPoints,
        airbaseIntegrityPct: nextCarryover.airbaseIntegrityPct,
        stageModifiers: [...nextCarryover.stageModifiers],
        carryover: nextCarryover,
      };
      get().loadScenario(stageScenario, false, DEFAULT_SEED + nextIndex, { playerSide: campaign.playerSide, carryover: nextCarryover });
      set({ campaignState: nextCampaignState });
    },

    exitCampaign: () => set({ campaignState: null }),

    saveAutosaveCheckpoint: () => {
      if (typeof window === 'undefined' || get().replayPlayer || isApplyingBattleRecording()) return;
      const state = get();
      const generation = autosaveGeneration;
      const sequence = ++latestAutosave;
      if (autosaveTimer !== undefined) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        autosaveTimer = undefined;
        autosaveQueue = autosaveQueue.then(async () => {
          if (generation !== autosaveGeneration || sequence !== latestAutosave) return;
          try {
            await writeAutosave(prepareBattleSave(state));
            if (generation === autosaveGeneration && sequence === latestAutosave) set({ hasAutosave: true });
          } catch (error) {
            if (generation === autosaveGeneration && sequence === latestAutosave) {
              emitActionFeedback('warning', `自动存档写入失败，旧档未更改：${error instanceof Error ? error.message : '未知错误'}`);
            }
          }
        });
      }, 0);
    },

    restoreAutosaveCheckpoint: async () => {
      if (typeof window === 'undefined') return false;
      const before = get();
      try {
        await autosaveQueue;
        const current = await readAutosave().catch(() => undefined);
        const legacy = current === undefined ? window.localStorage.getItem(AUTOSAVE_STORAGE_KEY) : null;
        if (current === undefined && !legacy) {
          emitActionFeedback('warning', '未找到本地自动断点存档');
          return false;
        }
        const after = get();
        if (after.currentScenario !== before.currentScenario || after.tick !== before.tick || after.commandSequence !== before.commandSequence || after.replayPlayer) {
          emitActionFeedback('warning', '当前局面已经变化，未恢复旧的断点');
          return false;
        }
        restoreBattleSave(current ?? JSON.parse(legacy!));
        emitActionFeedback('info', '已恢复上局断点存档');
        return true;
      } catch (error) {
        emitActionFeedback('error', `断点存档恢复失败：${error instanceof Error ? error.message : '未知错误'}`);
        return false;
      }
    },

    startReplayPlayer: (recording: BattleRecording, startTick = 0) => {
      try {
        const clamped = Math.max(0, Math.min(startTick, recording.untilTick));
        const original = liveBattleBeforeReplay ?? get();
        replayBattleRecording(recording, 60, clamped);
        cancelQueuedAutosave();
        const enrichedRecording: BattleRecording =
          recording.snapshots && recording.snapshots.length > 0
            ? recording
            : { ...recording, ...compactReplayKeyframes(get().replaySnapshots) };
        liveBattleBeforeReplay = original;
        set({
          replayPlayer: { recording: enrichedRecording, currentTick: clamped, isPlaying: false, speed: 5 },
          activeModal: 'none',
          timeScale: 0,
        });
        emitActionFeedback('info', `已进入地图回放模式（Tick ${clamped} / ${recording.untilTick}）`);
      } catch (error) {
        emitActionFeedback('error', error instanceof Error ? error.message : '无法启动地图回放');
      }
    },

    setReplayPlayerPlaying: (playing: boolean) =>
      set((s) => (s.replayPlayer ? { replayPlayer: { ...s.replayPlayer, isPlaying: playing } } : s)),

    setReplayPlayerSpeed: (speed: 1 | 5 | 15) =>
      set((s) => (s.replayPlayer ? { replayPlayer: { ...s.replayPlayer, speed } } : s)),

    seekReplayPlayer: (targetTick: number) => {
      const player = get().replayPlayer;
      if (!player) return;
      const clamped = Math.max(0, Math.min(targetTick, player.recording.untilTick));
      try {
        if (clamped >= player.currentTick && get().tick === player.currentTick) {
          advanceReplayRecordingIncremental(player.recording, clamped, 60);
        } else {
          replayBattleRecording(player.recording, 60, clamped);
        }
        const reachedEnd = clamped >= player.recording.untilTick;
        set({
          replayPlayer: {
            ...player,
            currentTick: clamped,
            isPlaying: reachedEnd ? false : player.isPlaying,
          },
        });
      } catch (error) {
        set({ replayPlayer: { ...player, isPlaying: false } });
        emitActionFeedback('error', error instanceof Error ? error.message : '回放跳转失败');
      }
    },

    exitReplayPlayer: () => {
      const player = get().replayPlayer;
      const original = liveBattleBeforeReplay;
      liveBattleBeforeReplay = undefined;
      if (original) set({ ...original, timeScale: 0, pendingSimSeconds: 0, activeModal: 'none' }, true);
      else set({ replayPlayer: null });
      if (player) {
        emitActionFeedback('info', '已退出地图回放');
      }
    },

    setTimeScale: (scale: WargameStoreState['timeScale']) => {
      const s = get();
      if (s.replayPlayer) {
        set({ timeScale: 0 });
        return;
      }
      set({
        timeScale: s.battleResult || s.pendingRiskEngagement ? 0 : scale,
        lastAutoPauseBanner: scale > 0 ? null : s.lastAutoPauseBanner,
      });
      if (scale === 0 && s.tick > 0) {
        get().saveAutosaveCheckpoint();
      }
    },

    stepSingleTick: (dtSec = 2) => {
      const s = get();
      if (s.battleResult || (s.replayPlayer && !isApplyingBattleRecording())) return;
      const world = extractSimulationWorldState(s);
      const result = advanceSimulation(
        world,
        s.catalog,
        dtSec + s.pendingSimSeconds,
        s.autoPause,
        s.playerSide
      );
      get().applySimulationResult(result);
    },

    applySimulationResult: (
      result: Parameters<WargameStoreState['applySimulationResult']>[0],
      expectedTick?: number,
      expectedCommandSequence?: number,
      expectedScenarioId?: string
    ) => {
      let applied = false;
      const prevTick = get().tick;
      set((prev) => {
        if (prev.battleResult || (prev.replayPlayer && !isApplyingBattleRecording())) return prev;
        if (expectedTick !== undefined && prev.tick !== expectedTick) return prev;
        if (expectedCommandSequence !== undefined && prev.commandSequence !== expectedCommandSequence) return prev;
        if (expectedScenarioId !== undefined && prev.currentScenario.id !== expectedScenarioId) return prev;
        applied = true;
        const nextTick = result.nextState.tick ?? prev.tick;
        let replaySnapshots = prev.replaySnapshots;
        const crossedSnapshotBoundary =
          nextTick > prev.tick &&
          Math.floor(nextTick / SNAPSHOT_INTERVAL_TICKS) > Math.floor(prev.tick / SNAPSHOT_INTERVAL_TICKS);
        if (crossedSnapshotBoundary) {
          const snap: BattleSnapshot = {
            tick: nextTick,
            startTime: result.nextState.startTime ?? prev.startTime,
            simTime: result.nextState.simTime,
            rngState: result.nextState.rngState ?? prev.rngState,
            units: result.nextState.units,
            contacts: result.nextState.contacts,
            weaponsInFlight: result.nextState.weaponsInFlight,
            explosions: result.nextState.explosions,
            missions: result.nextState.missions,
            events: result.nextState.events || prev.events,
            pendingSortieOrders: result.nextState.pendingSortieOrders ?? prev.pendingSortieOrders,
            pendingTotStrikeOrders: result.nextState.pendingTotStrikeOrders ?? prev.pendingTotStrikeOrders,
            groups: prev.groups,
            objectives: result.nextState.objectives ?? prev.objectives,
            environment: result.nextState.environment ?? prev.environment,
            score: result.nextState.score,
            objectiveProgress: result.nextState.objectiveProgress ?? {},
            objectiveHoldProgress: result.nextState.objectiveHoldProgress ?? {},
            battleResult: result.nextState.battleResult,
            creditedDamage: result.nextState.creditedDamage ?? {},
            detectedMissileIds: result.nextState.detectedMissileIds ?? [],
            aar: result.nextState.aar ?? prev.aar,
            playerSide: prev.playerSide,
            playMode: prev.playMode,
            referencePoints: prev.referencePoints,
            commandSequence: prev.commandSequence,
          };
          replaySnapshots = appendReplayKeyframe(prev.replaySnapshots, snap);
        }
        return {
          simTime: result.nextState.simTime,
          tick: nextTick,
          rngState: result.nextState.rngState ?? prev.rngState,
          pendingSimSeconds: result.remainingSec,
          replaySnapshots,
          objectiveProgress: result.nextState.objectiveProgress ?? {},
          objectiveHoldProgress: result.nextState.objectiveHoldProgress ?? {},
          objectives: result.nextState.objectives ?? prev.objectives,
          battleResult: result.nextState.battleResult,
          creditedDamage: result.nextState.creditedDamage ?? {},
          detectedMissileIds: result.nextState.detectedMissileIds ?? [],
          aar: result.nextState.aar ?? prev.aar,
          units: result.nextState.units,
          contacts: result.nextState.contacts,
          weaponsInFlight: result.nextState.weaponsInFlight,
          explosions: result.nextState.explosions,
          missions: result.nextState.missions,
          events: result.nextState.events || prev.events,
          pendingSortieOrders: result.nextState.pendingSortieOrders ?? prev.pendingSortieOrders,
          pendingTotStrikeOrders: result.nextState.pendingTotStrikeOrders ?? prev.pendingTotStrikeOrders,
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
        };
      });
      if (applied && typeof window !== 'undefined' && !get().replayPlayer) {
        const after = get();
        if (after.battleResult || (after.tick > prevTick && performance.now() - autosaveAt >= 5000)) {
          autosaveAt = performance.now();
          get().saveAutosaveCheckpoint();
        }
      }
      return applied;
    },

    setActivePerspective: (p: WargameStoreState['activePerspective']) =>
      set({
        activePerspective: p,
        selectedUnitId: null, selectedUnitIds: [], selectedContactId: null, pendingRiskEngagement: null,
        interactionMode: 'select',
      }),

    toggleAutoPause: (key: keyof WargameStoreState['autoPause']) =>
      set((s) => ({
        autoPause: { ...s.autoPause, [key]: !s.autoPause[key] },
      })),

    clearAutoPauseBanner: () => set({ lastAutoPauseBanner: null }),

    selectUnit: (unitId: string | null) => {
      const s = get(); const unit = unitId ? s.units[unitId] : undefined;
      if (unit && unit.side !== s.playerSide && s.playMode !== 'sandbox') {
        const contact = contactForUnit(s.contacts, s.playerSide, unit.id);
        set({ selectedUnitId: null, selectedUnitIds: [], selectedContactId: contact?.id ?? null, interactionMode: 'select' });
        return;
      }
      set({
        selectedUnitId: unit?.id ?? null,
        selectedUnitIds: unit ? [unit.id] : [],
        selectedContactId: null,
        interactionMode: 'select',
      });
    },

    selectMultipleUnits: (unitIds: string[], additive = false) => {
      const s = get();
      const base = additive ? s.selectedUnitIds : [];
      const merged = [...new Set([...base, ...unitIds])]
        .filter((id) => {
          const u = s.units[id];
          return !!u && u.hp > 0 && u.status !== 'destroyed' && u.status !== 'recovered' && canCommandUnit(s, u);
        })
        .sort((a, b) => a.localeCompare(b));
      set({
        selectedUnitIds: merged,
        selectedUnitId: merged[0] ?? null,
        selectedContactId: null,
        interactionMode: 'select',
      });
    },

    toggleUnitSelection: (unitId: string) => {
      const s = get();
      const unit = s.units[unitId];
      if (!unit || !canCommandUnit(s, unit)) return;
      const exists = s.selectedUnitIds.includes(unitId);
      const next = exists
        ? s.selectedUnitIds.filter((id) => id !== unitId)
        : [...s.selectedUnitIds, unitId].sort((a, b) => a.localeCompare(b));
      set({
        selectedUnitIds: next,
        selectedUnitId: next.includes(s.selectedUnitId ?? '') ? s.selectedUnitId : next[0] ?? null,
        selectedContactId: null,
        interactionMode: 'select',
      });
    },

    selectContact: (contactId: string | null) => {
      const s = get(); const contact = contactId ? s.contacts[contactId] : undefined;
      if (contact && contact.observerSide !== s.playerSide && s.playMode !== 'sandbox') return;
      set({ selectedContactId: contact?.id ?? null, interactionMode: 'select' });
    },

    setInteractionMode: (mode: WargameStoreState['interactionMode']) =>
      set((s) => ({
        interactionMode: mode,
        pendingStrikeWaypoints: mode === 'manual_engage' ? s.pendingStrikeWaypoints : [],
      })),

    startManualEngage: (weaponId?: string, salvoCount = 2) => {
      const s = get(); if (!canCommandUnit(s, s.units[s.selectedUnitId ?? ''])) return;
      set({
        interactionMode: 'manual_engage',
        pendingWeaponIdForEngage: weaponId || null,
        pendingSalvoCount: salvoCount,
        pendingStrikeWaypoints: [],
      });
    },

    startSpawnUnitOnMap: (config: NonNullable<WargameStoreState['pendingSpawnConfig']>) => {
      if (get().playMode !== 'sandbox' || get().battleResult) return;
      set({
        interactionMode: 'spawn_unit',
        pendingSpawnConfig: config,
        pendingForcePackageConfig: null,
        activeModal: 'none',
      });
    },
    startForcePackageSpawnOnMap: (config: NonNullable<WargameStoreState['pendingForcePackageConfig']>) => {
      const state = get();
      const group = state.groups.find((candidate) => candidate.id === config.parentGroupId);
      if (state.playMode !== 'sandbox' || state.battleResult ||
          !FORCE_PACKAGES[config.forcePackageId] || !group || group.side !== config.side) return;
      set({
        interactionMode: 'spawn_unit',
        pendingSpawnConfig: null,
        pendingForcePackageConfig: config,
        activeModal: 'none',
      });
    },

    toggleMapLayer: (layer: keyof WargameStoreState['mapLayers']) =>
      set((s) => ({
        mapLayers: { ...s.mapLayers, [layer]: !s.mapLayers[layer] },
      })),
    toggleTacview3d: (open?: boolean) =>
      set((s) => ({
        tacview3dOpen: open ?? !s.tacview3dOpen,
      })),

    flyToPosition: (center: [number, number], zoom?: number) =>
      set({
        cameraFlyToRequest: { center, zoom, timestamp: Date.now() },
      }),

    setActiveModal: (modal: WargameStoreState['activeModal']) => set({ activeModal: modal }),
  };
}
