import { createAarLedger } from '../../engine/aar';
import { canCommandUnit, contactForUnit } from '../../engine/commandPolicy';
import { createRandomStream, DEFAULT_SEED, SNAPSHOT_INTERVAL_TICKS } from '../../engine/determinism';
import { deriveMissionAssignments } from '../../engine/missions';
import {
  advanceSimulation,
  initializeWorldContacts,
  type SimulationWorldState,
} from '../../engine/simulationEngine';
import { BASEMAP_PRESETS, DEFAULT_BASEMAP } from '../../map/basemaps';
import {
  BUILTIN_SCENARIOS,
  instantiateScenarioUnits,
} from '../../scenarios/builtinScenarios';
import { INFORMATION_EXERCISE } from '../../scenarios/informationExercise';
import {
  BUILTIN_CAMPAIGN_WESTPAC,
  buildCampaignStageScenario,
  computeNextCampaignCarryover,
  createInitialCampaignState,
  type CampaignState,
} from '../../scenarios/campaign';
import { compileScenario } from '../../scenarios/compileScenario';
import type { ScenarioDefinition } from '../../types/wargame';
import { emitActionFeedback } from '../actionFeedbackBus';
import {
  AUTOSAVE_STORAGE_KEY,
  captureBattleSave,
  replayBattleRecording,
  restoreBattleSave,
  type BattleRecording,
  type BattleSnapshot,
} from '../battleRecording';
import type { StoreGet, StoreSet, WargameStoreState } from '../types';

export function createInitialStateFromScenario(
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

function readHasAutosave(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage?.getItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    return false;
  }
}

export function createScenarioSlice(set: StoreSet, get: StoreGet) {
  const initialBoot = createInitialStateFromScenario(INFORMATION_EXERCISE);

  return {
    basemapMode: DEFAULT_BASEMAP,
    setBasemapMode: (mode: WargameStoreState['basemapMode']) => {
      if (Object.hasOwn(BASEMAP_PRESETS, mode)) set({ basemapMode: mode });
    },
    playerSide: 'RED' as const,
    playMode: 'command' as const,
    campaignState: null,
    hasAutosave: readHasAutosave(),
    replayPlayer: null,
    seed: initialBoot.seed,
    rngState: initialBoot.rngState,
    tick: 0,
    pendingSimSeconds: 0,
    commandSequence: 0,
    commandHistory: [],
    replaySnapshots: [],
    objectiveProgress: {},
    battleResult: undefined,
    creditedDamage: {},
    detectedMissileIds: [],
    aar: initialBoot.aar,
    pendingRiskEngagement: null,
    setPlayerSide: (side: 'RED' | 'BLUE') => {
      const s = get();
      if (s.tick !== 0 || s.timeScale !== 0) return;
      set({ playerSide: side, activePerspective: side, selectedContactId: null,
        selectedUnitId: Object.values(s.units).find((u) => u.side === side)?.id ?? null });
    },
    setPlayMode: (mode: WargameStoreState['playMode']) => set({
      playMode: mode, timeScale: 0, pendingRiskEngagement: null,
      selectedUnitId: null, selectedContactId: null, interactionMode: 'select', activePerspective: get().playerSide,
    }),
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
    environment: initialBoot.environment,
    referencePoints: initialBoot.referencePoints,
    logs: initialBoot.logs,
    score: initialBoot.score,

    selectedUnitId: initialBoot.selectedUnitId,
    selectedContactId: null,
    interactionMode: 'select' as const,
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
    activeModal: 'none' as const,

    loadScenario: (scenario: ScenarioDefinition, randomizeSpawns = false, seed?: number) => {
      const boot = createInitialStateFromScenario(scenario, randomizeSpawns, seed);
      set((state) => {
        const exists = state.availableScenarios.some(
          (s) => s.id === scenario.id
        );
        return {
          playerSide: 'RED', playMode: 'command', activePerspective: 'RED',
          campaignState: null,
          seed: boot.seed, rngState: boot.rngState, tick: 0, pendingSimSeconds: 0,
          commandSequence: 0, commandHistory: [], replaySnapshots: [], objectiveProgress: {}, battleResult: undefined,
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
      const prevCampaign = get().campaignState;
      get().loadScenario(current, randomizeSpawns, randomizeSpawns ? undefined : get().seed);
      if (prevCampaign) {
        set({ campaignState: prevCampaign, playerSide: prevCampaign.playerSide, activePerspective: prevCampaign.playerSide });
      }
    },

    startCampaign: (side?: 'RED' | 'BLUE') => {
      const chosenSide: 'RED' | 'BLUE' = side ?? (get().playerSide === 'BLUE' ? 'BLUE' : 'RED');
      const campaignState = createInitialCampaignState(BUILTIN_CAMPAIGN_WESTPAC, chosenSide);
      const firstStage = BUILTIN_CAMPAIGN_WESTPAC.stages[0];
      const base = BUILTIN_SCENARIOS.find((candidate) => candidate.id === firstStage.scenarioId) ?? BUILTIN_SCENARIOS[0];
      const stageScenario = buildCampaignStageScenario(base, campaignState.carryover, chosenSide, 0);
      get().loadScenario(stageScenario, false, DEFAULT_SEED);
      set({
        campaignState,
        playerSide: chosenSide,
        activePerspective: chosenSide,
        selectedUnitId: Object.values(get().units).find((u) => u.side === chosenSide)?.id ?? null,
      });
    },

    advanceCampaignStage: () => {
      const state = get();
      const campaign = state.campaignState;
      if (!campaign || !state.battleResult || campaign.finished) return;
      const sideScore = campaign.playerSide === 'RED' ? state.score.redScore : state.score.blueScore;
      const ownLosses = campaign.playerSide === 'RED' ? state.score.redLosses : state.score.blueLosses;
      const nextCarryover = computeNextCampaignCarryover(
        campaign.carryover,
        state.battleResult,
        campaign.playerSide,
        sideScore,
        ownLosses
      );
      const nextIndex = campaign.currentStageIndex + 1;
      if (nextIndex >= BUILTIN_CAMPAIGN_WESTPAC.stages.length) {
        set({
          campaignState: {
            ...campaign,
            finished: true,
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
        carryover: nextCarryover,
      };
      get().loadScenario(stageScenario, false, DEFAULT_SEED + nextIndex);
      set({
        campaignState: nextCampaignState,
        playerSide: campaign.playerSide,
        activePerspective: campaign.playerSide,
        selectedUnitId: Object.values(get().units).find((u) => u.side === campaign.playerSide)?.id ?? null,
      });
    },

    exitCampaign: () => set({ campaignState: null }),

    saveAutosaveCheckpoint: () => {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        const save = captureBattleSave();
        window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(save));
        set({ hasAutosave: true });
      } catch {
        // Ignore storage quota or private mode failures.
      }
    },

    restoreAutosaveCheckpoint: () => {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return false;
        const raw = window.localStorage.getItem(AUTOSAVE_STORAGE_KEY);
        if (!raw) {
          emitActionFeedback('warning', '未找到本地自动断点存档');
          return false;
        }
        restoreBattleSave(JSON.parse(raw));
        emitActionFeedback('info', '已恢复上局断点存档');
        return true;
      } catch (error) {
        emitActionFeedback(
          'error',
          `断点存档恢复失败（版本或校验不匹配）：${error instanceof Error ? error.message : '未知错误'}`
        );
        return false;
      }
    },

    startReplayPlayer: (recording: BattleRecording, startTick = 0) => {
      try {
        const clamped = Math.max(0, Math.min(startTick, recording.untilTick));
        replayBattleRecording(recording, 60, clamped);
        set({
          replayPlayer: { recording, currentTick: clamped, isPlaying: false, speed: 5 },
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
        replayBattleRecording(player.recording, 60, clamped);
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
      set({ replayPlayer: null });
      if (player) {
        emitActionFeedback('info', '已退出地图回放模式');
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
      if (s.battleResult) return;
      const world: SimulationWorldState = {
        startTime: s.startTime,
        tick: s.tick,
        rngState: s.rngState,
        objectives: s.objectives,
        objectiveProgress: s.objectiveProgress,
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
        environment: s.environment,
        victoryConditions: s.currentScenario.victoryConditions,
        score: s.score,
      };
      const result = advanceSimulation(
        world,
        s.catalog,
        dtSec + s.pendingSimSeconds,
        s.autoPause,
        s.playerSide
      );
      const prevTick = s.tick;
      const applied = get().applySimulationResult(result);
      if (applied && typeof window !== 'undefined' && !s.replayPlayer) {
        const after = get();
        if (after.battleResult || Math.floor(after.tick / 120) > Math.floor(prevTick / 120)) {
          get().saveAutosaveCheckpoint();
        }
      }
    },

    applySimulationResult: (
      result: Parameters<WargameStoreState['applySimulationResult']>[0],
      expectedTick?: number,
      expectedCommandSequence?: number,
      expectedScenarioId?: string
    ) => {
      let applied = false;
      set((prev) => {
        if (prev.battleResult) return prev;
        if (expectedTick !== undefined && prev.tick !== expectedTick) return prev;
        if (expectedCommandSequence !== undefined && prev.commandSequence !== expectedCommandSequence) return prev;
        if (expectedScenarioId !== undefined && prev.currentScenario.id !== expectedScenarioId) return prev;
        applied = true;
        const nextTick = result.nextState.tick ?? prev.tick;
        let replaySnapshots = prev.replaySnapshots;
        const crossedSnapshotBoundary =
          nextTick > prev.tick &&
          Math.floor(nextTick / SNAPSHOT_INTERVAL_TICKS) > Math.floor(prev.tick / SNAPSHOT_INTERVAL_TICKS);
        if (crossedSnapshotBoundary && prev.replaySnapshots.length < 50) {
          const snap: BattleSnapshot = structuredClone({
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
            groups: prev.groups,
            objectives: result.nextState.objectives ?? prev.objectives,
            environment: result.nextState.environment ?? prev.environment,
            score: result.nextState.score,
            objectiveProgress: result.nextState.objectiveProgress ?? {},
            battleResult: result.nextState.battleResult,
            creditedDamage: result.nextState.creditedDamage ?? {},
            detectedMissileIds: result.nextState.detectedMissileIds ?? [],
            aar: result.nextState.aar ?? prev.aar,
            playerSide: prev.playerSide,
            playMode: prev.playMode,
            referencePoints: prev.referencePoints,
            commandSequence: prev.commandSequence,
          });
          replaySnapshots = [...prev.replaySnapshots, snap];
        }
        return {
          simTime: result.nextState.simTime,
          tick: nextTick,
          rngState: result.nextState.rngState ?? prev.rngState,
          pendingSimSeconds: result.remainingSec,
          replaySnapshots,
          objectiveProgress: result.nextState.objectiveProgress ?? {},
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
      return applied;
    },

    setActivePerspective: (p: WargameStoreState['activePerspective']) =>
      set({
        activePerspective: p,
        selectedUnitId: null, selectedContactId: null, pendingRiskEngagement: null,
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
        set({ selectedUnitId: null, selectedContactId: contact?.id ?? null, interactionMode: 'select' });
        return;
      }
      set({ selectedUnitId: unit?.id ?? null, selectedContactId: null, interactionMode: 'select' });
    },

    selectContact: (contactId: string | null) => {
      const s = get(); const contact = contactId ? s.contacts[contactId] : undefined;
      if (contact && contact.observerSide !== s.playerSide && s.playMode !== 'sandbox') return;
      set({ selectedContactId: contact?.id ?? null, interactionMode: 'select' });
    },

    setInteractionMode: (mode: WargameStoreState['interactionMode']) => set({ interactionMode: mode }),

    startManualEngage: (weaponId?: string, salvoCount = 2) => {
      const s = get(); if (!canCommandUnit(s, s.units[s.selectedUnitId ?? ''])) return;
      set({
        interactionMode: 'manual_engage',
        pendingWeaponIdForEngage: weaponId || null,
        pendingSalvoCount: salvoCount,
      });
    },

    startSpawnUnitOnMap: (config: NonNullable<WargameStoreState['pendingSpawnConfig']>) => {
      if (get().playMode !== 'sandbox' || get().battleResult) return;
      set({
        interactionMode: 'spawn_unit',
        pendingSpawnConfig: config,
        activeModal: 'none',
      });
    },

    toggleMapLayer: (layer: keyof WargameStoreState['mapLayers']) =>
      set((s) => ({
        mapLayers: { ...s.mapLayers, [layer]: !s.mapLayers[layer] },
      })),

    flyToPosition: (center: [number, number], zoom?: number) =>
      set({
        cameraFlyToRequest: { center, zoom, timestamp: Date.now() },
      }),

    setActiveModal: (modal: WargameStoreState['activeModal']) => set({ activeModal: modal }),
  };
}
