import { COMMAND_ACTIONS, FIXED_DT_SEC, SNAPSHOT_INTERVAL_TICKS, type RecordedCommand } from '../engine/determinism';
import { summarizeAar } from '../engine/aar';
import { hasExerciseHandoffReceipt } from '../engine/exerciseTask';
import { compileScenario } from '../scenarios/compileScenario';
import { exerciseTaskOffer } from '../scenarios/informationExercise';
import {
  BUILTIN_CAMPAIGN_WESTPAC, CAMPAIGN_RESUPPLY_OPTIONS, MAX_CAMPAIGN_SUPPLY_POINTS, MIN_AIRBASE_INTEGRITY_PCT,
  type CampaignStageStart, type CampaignState,
} from '../scenarios/campaign';
import type { BattleAarLedger, ScenarioDefinition } from '../types/wargame';
import { array, boolean, id, invalid, isRecord, number, object, oneOf, optional, record, text } from '../validation/schema';
import { emitActionFeedback } from './actionFeedbackBus';
import { checkBattleArchive, checkBattleSnapshot, copyCheckedBattleSnapshot, uint32 } from './battleSnapshotDecoder';
import { checkKeyframeHistory, compactReplayKeyframes, inflateReplayKeyframe, MAX_KEYFRAMES, type CompactKeyframe } from './replayKeyframes';
import { useWargameStore, type WargameStoreState } from './useWargameStore';

export const BATTLE_RECORDING_VERSION = 2 as const;
export const EXERCISE_RECORDING_VERSION = 3 as const;
export const BATTLE_SAVE_VERSION = 3 as const;
export { SNAPSHOT_INTERVAL_TICKS };
export const RULESET_VERSION = '2026.12-ruleset-29';
export const SCENARIO_SCHEMA_VERSION = 12;
export const AUTOSAVE_STORAGE_KEY = 'aegis_cmo_autosave_v1';
export const SAVE_SLOTS_STORAGE_KEY = 'aegis_cmo_save_slots_v1';
export const MAX_BATTLE_SAVE_SLOTS = 8;

export interface SavedBattleSlot {
  slotId: string;
  label: string;
  savedAtIso: string;
  scenarioId: string;
  scenarioTitle: string;
  playerSide: 'RED' | 'BLUE' | 'NEUTRAL';
  tick: number;
  elapsedSec: number;
  save: Omit<BattleSaveState, 'version'> & { version: 1 | 2 | typeof BATTLE_SAVE_VERSION };
}

export type BattleSnapshot = ReturnType<typeof canonicalBattleState>;

export interface BattleRecording {
  version: typeof BATTLE_RECORDING_VERSION | typeof EXERCISE_RECORDING_VERSION;
  rulesetVersion: string;
  catalogVersion: string;
  scenarioSchemaVersion: number;
  scenario: ScenarioDefinition;
  seed: number;
  untilTick: number;
  commands: RecordedCommand[];
  campaignStart?: CampaignStageStart;
  snapshots?: (BattleSnapshot | CompactKeyframe)[];
  history?: BattleAarLedger;
  // Only present when re-exporting an old session with the previous reset policy.
  legacyExerciseResets?: true;
}

type CampaignCheckpoint = Pick<CampaignState, 'campaignId' | 'playerSide' | 'currentStageIndex' | 'finished' | 'carryover'>;

export interface BattleSaveState {
  kind: 'aegis_battle_save';
  version: typeof BATTLE_SAVE_VERSION;
  rulesetVersion: string;
  catalogVersion: string;
  scenarioSchemaVersion: number;
  scenario: ScenarioDefinition;
  seed: number;
  commandHistory: RecordedCommand[];
  snapshot: BattleSnapshot;
  campaign?: CampaignCheckpoint;
  campaignStart?: CampaignStageStart;
  digest: string;
}

export function computeCanonicalDigest(state: BattleSnapshot): string {
  return digestJson(state);
}

function digestJson(value: unknown): string {
  const payload = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= ch + (i & 255);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function captureBattleRecording(): BattleRecording {
  const state = useWargameStore.getState();
  const keyframes = state.replaySnapshots.filter((frame) => frame.tick <= state.tick);
  const hasTask = state.exerciseTask !== undefined || keyframes.some((frame) => frame.exerciseTask !== undefined) ||
    state.commandHistory.some(({ action }) => exerciseCommands.has(action));
  return structuredClone({
    version: hasTask ? EXERCISE_RECORDING_VERSION : BATTLE_RECORDING_VERSION,
    rulesetVersion: RULESET_VERSION,
    catalogVersion: state.catalog.version,
    scenarioSchemaVersion: SCENARIO_SCHEMA_VERSION,
    scenario: state.currentScenario,
    seed: state.seed,
    untilTick: state.tick,
    commands: state.commandHistory,
    campaignStart: state.campaignStageStart,
    ...(keyframes.length ? compactReplayKeyframes(keyframes) : {}),
    ...(hasLegacyExerciseReset(state.commandHistory) && { legacyExerciseResets: true as const }),
  });
}

// Rendering, selection, wall-clock timestamps and fractional frame budgets are not simulation state.
export function canonicalBattleState(state: WargameStoreState = useWargameStore.getState()) {
  return structuredClone(battleSnapshotFields(state));
}

function battleSnapshotFields(state: WargameStoreState) {
  return { tick: state.tick, startTime: state.startTime, simTime: state.simTime,
    rngState: state.rngState, units: state.units, contacts: state.contacts, weaponsInFlight: state.weaponsInFlight,
    explosions: state.explosions, missions: state.missions, events: state.events,
    pendingSortieOrders: state.pendingSortieOrders,
    pendingTotStrikeOrders: state.pendingTotStrikeOrders,
    groups: state.groups, objectives: state.objectives,
    environment: state.environment, score: state.score,
    objectiveProgress: state.objectiveProgress,
    objectiveHoldProgress: state.objectiveHoldProgress,
    ...(state.exerciseTask && { exerciseTask: state.exerciseTask }),
    battleResult: state.battleResult,
    creditedDamage: state.creditedDamage, detectedMissileIds: state.detectedMissileIds, aar: state.aar,
    playerSide: state.playerSide, playMode: state.playMode, referencePoints: state.referencePoints,
    commandSequence: state.commandSequence };
}

export function captureBattleSave(): BattleSaveState {
  const state = useWargameStore.getState();
  if (state.replayPlayer) {
    throw new Error('请先退出地图回放，再保存断点存档。');
  }
  return structuredClone(prepareBattleSave(state));
}

export function prepareBattleSave(state: WargameStoreState): BattleSaveState {
  const snapshot = battleSnapshotFields(state);
  const campaign = state.campaignState && {
    campaignId: state.campaignState.campaignId,
    playerSide: state.campaignState.playerSide,
    currentStageIndex: state.campaignState.currentStageIndex,
    finished: state.campaignState.finished,
    carryover: state.campaignState.carryover,
  };
  const envelope: Omit<BattleSaveState, 'digest'> = {
    kind: 'aegis_battle_save',
    version: BATTLE_SAVE_VERSION,
    rulesetVersion: RULESET_VERSION,
    catalogVersion: state.catalog.version,
    scenarioSchemaVersion: SCENARIO_SCHEMA_VERSION,
    scenario: state.currentScenario,
    seed: state.seed,
    commandHistory: state.commandHistory,
    snapshot,
    campaign: campaign ?? undefined,
    campaignStart: state.campaignStageStart,
  };
  return { ...envelope, digest: digestJson(envelope) };
}

export function captureShareableAarPackage() {
  const state = useWargameStore.getState();
  return structuredClone({
    kind: 'aegis_aar_package' as const,
    version: 1 as const,
    rulesetVersion: RULESET_VERSION,
    catalogVersion: state.catalog.version,
    scenarioId: state.currentScenario.id,
    scenarioTitle: state.currentScenario.title,
    tick: state.tick,
    simTime: state.simTime,
    battleResult: state.battleResult,
    score: state.score,
    summary: summarizeAar(state.aar),
    aar: state.aar,
    catalogSnapshot: state.catalog,
  });
}

export function isBattleRecordingVersion(version: unknown): version is BattleRecording['version'] {
  return version === BATTLE_RECORDING_VERSION || version === EXERCISE_RECORDING_VERSION;
}

const exerciseCommands = new Set(['planExerciseTask', 'reassignExerciseTask', 'setExerciseTaskPaused', 'stopExerciseTask']);
const isSeatOrModeCommand = (action: string) => action === 'setPlayerSide' || action === 'setPlayMode';

function hasLegacyExerciseReset(commands: readonly RecordedCommand[]): boolean {
  let planned = false;
  for (const { action } of commands) {
    if (planned && isSeatOrModeCommand(action)) return true;
    if (action === 'planExerciseTask') planned = true;
  }
  return false;
}

function validateCommandList(commands: RecordedCommand[], untilTick: number, path: string) {
  for (const [i, command] of commands.entries()) {
    if (!isRecord(command) || !COMMAND_ACTIONS.includes(command.action as typeof COMMAND_ACTIONS[number]) ||
        !Number.isSafeInteger(command.tick) || command.tick < 0 || command.tick > untilTick ||
        command.sequence !== i || !Array.isArray(command.args) ||
        (i > 0 && command.tick < commands[i - 1].tick)) invalid(`${path}[${i}]`, 'invalid command sequence');
  }
}

function checkExerciseTaskSnapshot(snapshot: BattleSnapshot | CompactKeyframe, scenario: ScenarioDefinition, path: string) {
  const task = snapshot.exerciseTask;
  if (task === undefined) return;
  if (!Array.isArray(snapshot.objectives) || snapshot.playMode !== 'command') invalid(path, 'invalid exercise task context');
  const offer = exerciseTaskOffer(scenario, snapshot.playerSide, snapshot.objectives);
  if (!offer) invalid(path, 'exercise task does not belong to this seat');
  const tick = number(0, offer.deadlineTick, true);
  object({
    criterion: object(Object.fromEntries(Object.entries(offer.criterion).map(([key, value]) => [key, oneOf([value])]))),
    phase: oneOf(['scheduled', 'running', 'paused', 'completed', 'stopped']),
    assignedUnitId: id,
    opensAtTick: tick,
    closesAtTick: tick,
    reassignedAtTick: optional(number(0, snapshot.tick, true)),
  })(task, path);
  const unit = snapshot.units?.[task.assignedUnitId];
  if (!unit || unit.side !== offer.criterion.side ||
      (offer.criterion.kind === 'friendly_handoff' && (unit.id !== offer.criterion.unitId || unit.domain !== 'surface' ||
        task.reassignedAtTick !== undefined || !Array.isArray(unit.completedWithdrawalObjectiveIds)))) {
    invalid(`${path}.assignedUnitId`, 'invalid friendly assignment');
  }
  if (task.opensAtTick > task.closesAtTick) invalid(path, 'invalid exercise task window');
  const endPath = `${path}.end`;
  if (task.phase === 'completed' || task.phase === 'stopped') {
    const reasons = task.phase === 'completed'
      ? offer.criterion.kind === 'observe_marker' ? ['marker_report'] : ['handoff_receipt']
      : ['cancelled', 'window_closed', 'exercise_ended', ...(offer.criterion.kind === 'friendly_handoff'
        ? ['handoff_before_open', 'handoff_while_paused'] : [])];
    object({ tick: number(0, Math.min(task.closesAtTick, snapshot.tick), true), reason: oneOf(reasons) })(task.end, endPath);
    const end = task.end;
    if (end.reason === 'marker_report') id(end.contactId, `${endPath}.contactId`);
    if ((task.phase === 'completed' && end.tick < task.opensAtTick) ||
        (end.reason === 'window_closed' && end.tick !== task.closesAtTick) ||
        (end.reason === 'handoff_before_open' && end.tick >= task.opensAtTick) ||
        (end.reason === 'handoff_while_paused' && end.tick < task.opensAtTick) ||
        (task.reassignedAtTick !== undefined && task.reassignedAtTick > end.tick) ||
        (['handoff_receipt', 'handoff_before_open', 'handoff_while_paused'].includes(end.reason) && !hasExerciseHandoffReceipt(task, unit))) {
      invalid(endPath, 'inconsistent task evidence');
    }
  } else if (task.end !== undefined || snapshot.battleResult || hasExerciseHandoffReceipt(task, unit) || snapshot.tick >= task.closesAtTick ||
      (task.phase === 'scheduled' && snapshot.tick >= task.opensAtTick) ||
      (task.phase === 'running' && snapshot.tick < task.opensAtTick)) {
    invalid(path, 'inconsistent active task');
  }
}

const campaignStageCount = BUILTIN_CAMPAIGN_WESTPAC.stages.length;
const campaignCount = number(0, campaignStageCount, true);
const checkCampaignCarryover = object({
  completedStages: campaignCount,
  cumulativeScore: number(0),
  readinessMultiplier: number(0.75, 1.1),
  supplyPoints: number(0, MAX_CAMPAIGN_SUPPLY_POINTS, true),
  airbaseIntegrityPct: number(MIN_AIRBASE_INTEGRITY_PCT, 100, true),
  victoryCount: campaignCount,
  costlyVictoryCount: campaignCount,
  defeatCount: campaignCount,
  airframeAttritionDebt: number(0, 8, true),
  platformDamageDebt: record(number(0, 0.45)),
  scarceAmmoDebt: record(number(0, Number.MAX_SAFE_INTEGER, true)),
  lastOutcome: optional(oneOf(['victory', 'costly_victory', 'defeat', 'draw'])),
  lastResupplyChoice: optional(oneOf(CAMPAIGN_RESUPPLY_OPTIONS.map((choice) => choice.id))),
  stageModifiers: array(text),
  notes: array(text),
});
const checkCampaignSeat = oneOf(['RED', 'BLUE']);
const checkCampaignCheckpoint = object({
  campaignId: oneOf([BUILTIN_CAMPAIGN_WESTPAC.id]),
  playerSide: checkCampaignSeat,
  currentStageIndex: number(0, campaignStageCount - 1, true),
  finished: boolean,
  carryover: checkCampaignCarryover,
});
const checkCampaignStart = object({ playerSide: checkCampaignSeat, carryover: checkCampaignCarryover });

function readCampaignStart(value: CampaignStageStart | undefined, scenarioId: string): CampaignStageStart | undefined {
  if (value === undefined) return undefined;
  checkCampaignStart(value, 'campaignStart');
  const index = value.carryover.completedStages;
  const stage = BUILTIN_CAMPAIGN_WESTPAC.stages[index];
  if (!stage || scenarioId !== `${stage.scenarioId}__campaign_s${index + 1}`) {
    invalid('campaignStart', 'campaign stage does not match the scenario');
  }
  return value;
}

function readCampaignCheckpoint(value: CampaignCheckpoint | undefined, scenarioId: string, snapshot: BattleSnapshot): CampaignState | null {
  if (value === undefined) return null;
  checkCampaignCheckpoint(value, 'save.campaign');
  const { campaignId, playerSide, currentStageIndex, finished, carryover } = value;
  const stage = BUILTIN_CAMPAIGN_WESTPAC.stages[currentStageIndex];
  if (scenarioId !== `${stage.scenarioId}__campaign_s${currentStageIndex + 1}` || playerSide !== snapshot.playerSide ||
      carryover.completedStages !== currentStageIndex + Number(finished) ||
      (finished && (currentStageIndex + 1 !== campaignStageCount || !snapshot.battleResult))) {
    invalid('save.campaign', 'campaign stage does not match the saved battle');
  }
  return {
    campaignId, title: BUILTIN_CAMPAIGN_WESTPAC.title, playerSide, currentStageIndex, finished, carryover,
    totalStages: campaignStageCount,
    supplyPoints: carryover.supplyPoints,
    airbaseIntegrityPct: carryover.airbaseIntegrityPct,
    stageModifiers: [...carryover.stageModifiers],
  };
}

export function restoreBattleSave(input: unknown): BattleSnapshot {
  if (!isRecord(input)) {
    throw new Error('Invalid battle save header');
  }
  const save = input as Partial<SavedBattleSlot['save']>;
  if (save.kind !== 'aegis_battle_save' || (save.version !== 1 && save.version !== 2 && save.version !== BATTLE_SAVE_VERSION)) {
    throw new Error(`Unsupported save version ${String(save.version ?? 'missing')}; expected v1, v2 or v${BATTLE_SAVE_VERSION}`);
  }
  if (save.rulesetVersion !== RULESET_VERSION) {
    throw new Error(`Incompatible ruleset version ${String(save.rulesetVersion ?? 'missing')}; expected ${RULESET_VERSION}`);
  }
  if (save.scenarioSchemaVersion !== SCENARIO_SCHEMA_VERSION) {
    throw new Error(`Incompatible scenario schema version ${String(save.scenarioSchemaVersion ?? 'missing')}; expected ${SCENARIO_SCHEMA_VERSION}`);
  }
  const { digest, ...envelope } = input;
  text(digest, 'save.digest');
  const { snapshot } = save;
  const { campaign, campaignStart } = save.version === 1 ? {} : save;
  const expectedDigest = save.version === BATTLE_SAVE_VERSION
    ? digestJson(envelope)
    : save.version === 2 ? digestJson({ snapshot, campaign, campaignStart }) : digestJson(snapshot ?? null);
  if (expectedDigest !== digest) throw new Error('Battle save digest mismatch (corrupted or tampered state)');

  uint32(save.seed, 'save.seed');
  if (!Array.isArray(save.commandHistory)) invalid('save.commandHistory', 'expected an array');
  const compiled = compileScenario(save.scenario);
  if (save.catalogVersion !== compiled.catalog.version) {
    throw new Error(`Incompatible catalog version ${String(save.catalogVersion ?? 'missing')}; scenario resolves to ${compiled.catalog.version}`);
  }
  checkBattleSnapshot(snapshot, 'save.snapshot', compiled.scenario, false);
  if (snapshot.commandSequence !== save.commandHistory.length) {
    invalid('save.snapshot.commandSequence', 'save command history length mismatch');
  }
  validateCommandList(save.commandHistory, snapshot.tick, 'save.commandHistory');
  checkExerciseTaskSnapshot(snapshot, compiled.scenario, 'save.snapshot.exerciseTask');
  const restoredCampaign = readCampaignCheckpoint(structuredClone(campaign), compiled.scenario.id, snapshot);
  const start = readCampaignStart(structuredClone(campaignStart) ?? (restoredCampaign && !restoredCampaign.finished ? restoredCampaign : undefined), compiled.scenario.id);
  if (restoredCampaign && start && restoredCampaign.playerSide !== start.playerSide) {
    invalid('campaignStart', 'command seat does not match the campaign');
  }
  const restored = copyCheckedBattleSnapshot(snapshot);

  const previous = useWargameStore.getState();
  try {
    useWargameStore.getState().loadScenario(compiled.scenario, false, save.seed);
    useWargameStore.setState({
      ...restored,
      campaignState: restoredCampaign,
      campaignStageStart: start ? { playerSide: start.playerSide, carryover: start.carryover } : undefined,
      commandHistory: structuredClone(save.commandHistory),
      replaySnapshots: [restored],
      activePerspective: restored.playerSide,
      timeScale: 0,
      pendingSimSeconds: 0,
      selectedUnitId: null,
      selectedUnitIds: [],
      selectedContactId: null,
      pendingRiskEngagement: null,
      pendingSpawnConfig: null,
      pendingForcePackageConfig: null,
      pendingPolygonDraft: null,
      pendingWeaponIdForEngage: null,
      pendingStrikeWaypoints: [],
      interactionMode: 'select',
    });
    if (save.version === 1 && /__campaign_s\d+$/.test(compiled.scenario.id)) {
      emitActionFeedback('warning', '这份旧存档仅恢复本局，不含战役阶段和补给记录。');
    }
    return canonicalBattleState();
  } catch (error) {
    useWargameStore.setState(previous, true);
    throw error;
  }
}

let replayApplicationDepth = 0;
let replayingLegacyExerciseHistory = false;

export function isApplyingBattleRecording(): boolean {
  return replayApplicationDepth > 0;
}

export function isReplayingLegacyExerciseHistory(): boolean {
  return replayingLegacyExerciseHistory;
}

function applyRecordedCommand(recording: BattleRecording, command: RecordedCommand, state: WargameStoreState) {
  const previousLegacyHistory = replayingLegacyExerciseHistory;
  replayingLegacyExerciseHistory = recording.version === BATTLE_RECORDING_VERSION || recording.legacyExerciseResets === true;
  try {
    const action = state[command.action as typeof COMMAND_ACTIONS[number]] as (...args: unknown[]) => void;
    // JSON encodes optional positional arguments as null.
    action(...structuredClone(command.args).map((arg) => arg === null ? undefined : arg));
  } finally {
    replayingLegacyExerciseHistory = previousLegacyHistory;
  }
  const next = useWargameStore.getState();
  if (next.commandSequence !== command.sequence + 1) throw new Error('Recorded command is incompatible with the current rules');
  return next;
}

export function advanceReplayRecordingIncremental(
  recording: BattleRecording,
  targetTick: number,
  batchTicks = 60
) {
  const previous = useWargameStore.getState();
  if (
    targetTick < previous.tick ||
    targetTick > recording.untilTick ||
    previous.currentScenario.id !== recording.scenario.id ||
    previous.seed !== recording.seed
  ) {
    return replayBattleRecording(recording, batchTicks, targetTick);
  }
  if (targetTick === previous.tick) {
    return canonicalBattleState();
  }

  replayApplicationDepth++;
  try {
    useWargameStore.setState({
      autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false },
    });
    let index = previous.commandSequence;
    while (true) {
      let state = useWargameStore.getState();
      while (recording.commands[index]?.tick === state.tick) {
        state = applyRecordedCommand(recording, recording.commands[index++], state);
      }
      if (state.tick >= targetTick) break;
      if (state.battleResult) throw new Error('Recording advances past the end of the battle');
      const nextCommandTick = recording.commands[index]?.tick ?? targetTick;
      const ticks = Math.min(batchTicks, nextCommandTick - state.tick, targetTick - state.tick);
      state.stepSingleTick(ticks * FIXED_DT_SEC);
    }
    useWargameStore.setState({
      autoPause: previous.autoPause,
      timeScale: 0,
      pendingRiskEngagement: null,
      pendingSpawnConfig: null,
      pendingForcePackageConfig: null,
      pendingPolygonDraft: null,
      pendingWeaponIdForEngage: null,
      pendingStrikeWaypoints: [],
      interactionMode: 'select',
    });
    return canonicalBattleState();
  } catch {
    useWargameStore.setState(previous, true);
    return replayBattleRecording(recording, batchTicks, targetTick);
  } finally {
    replayApplicationDepth--;
  }
}

export function replayBattleRecording(input: unknown, batchTicks = 1, targetTick?: number) {
  if (!isRecord(input)) {
    throw new Error('Invalid recording header');
  }
  const recording = input as Partial<BattleRecording>;
  if (!isBattleRecordingVersion(recording.version)) {
    const received = recording.version === 1 ? 'legacy v1' : String(recording.version ?? 'missing');
    throw new Error(`Unsupported recording version ${received}; expected v${BATTLE_RECORDING_VERSION} or v${EXERCISE_RECORDING_VERSION}`);
  }
  if (recording.rulesetVersion !== RULESET_VERSION) {
    throw new Error(`Incompatible ruleset version ${String(recording.rulesetVersion ?? 'missing')}; expected ${RULESET_VERSION}`);
  }
  if (recording.scenarioSchemaVersion !== SCENARIO_SCHEMA_VERSION) {
    throw new Error(`Incompatible scenario schema version ${String(recording.scenarioSchemaVersion ?? 'missing')}; expected ${SCENARIO_SCHEMA_VERSION}`);
  }
  uint32(recording.seed, 'recording.seed');
  if (!Number.isSafeInteger(recording.untilTick) || recording.untilTick! < 0 || recording.untilTick! > 200000 ||
      !Array.isArray(recording.commands) || recording.commands.length > 10000 ||
      !Number.isSafeInteger(batchTicks) || batchTicks < 1) throw new Error('Invalid recording header');
  const replayUntilTick = targetTick ?? recording.untilTick!;
  if (!Number.isSafeInteger(replayUntilTick) || replayUntilTick < 0 || replayUntilTick > recording.untilTick!) {
    throw new Error(`Invalid replay target Tick ${String(replayUntilTick)}`);
  }
  const compiled = compileScenario(recording.scenario);
  if (recording.catalogVersion !== compiled.catalog.version) {
    throw new Error(`Incompatible catalog version ${String(recording.catalogVersion ?? 'missing')}; scenario resolves to ${compiled.catalog.version}`);
  }
  const validRecording = recording as BattleRecording;
  const campaignStart = readCampaignStart(validRecording.campaignStart, compiled.scenario.id);
  validateCommandList(validRecording.commands, validRecording.untilTick, 'recording.commands');
  if (validRecording.legacyExerciseResets !== undefined &&
      (validRecording.legacyExerciseResets !== true || validRecording.version !== EXERCISE_RECORDING_VERSION ||
        !hasLegacyExerciseReset(validRecording.commands))) {
    invalid('recording.legacyExerciseResets', 'invalid legacy exercise history marker');
  }
  if (validRecording.version === EXERCISE_RECORDING_VERSION && !validRecording.legacyExerciseResets &&
      hasLegacyExerciseReset(validRecording.commands)) {
    invalid('recording.commands', 'the seat or mode cannot change after an exercise task is planned');
  }

  let bestSnapshot: BattleSnapshot | CompactKeyframe | undefined;
  if (validRecording.history !== undefined) checkBattleArchive(validRecording.history, 'recording.history');
  if (validRecording.snapshots !== undefined && (!Array.isArray(validRecording.snapshots) || validRecording.snapshots.length > MAX_KEYFRAMES)) {
    throw new Error('Invalid recording snapshot count');
  }
  if (validRecording.snapshots?.length) {
    let prevSnapTick = -1;
    for (const [index, snap] of validRecording.snapshots.entries()) {
      const path = `recording.snapshots[${index}]`;
      checkBattleSnapshot(snap, path, compiled.scenario, isRecord(snap) && Object.hasOwn(snap, 'history'));
      if (snap.tick > validRecording.untilTick || snap.tick <= prevSnapTick) {
        invalid(`${path}.tick`, 'snapshots must be ascending within the recording');
      }
      if (snap.commandSequence > validRecording.commands.length) {
        invalid(`${path}.commandSequence`, 'outside the recording command list');
      }
      if (snap.commandSequence > 0 && validRecording.commands[snap.commandSequence - 1].tick > snap.tick) {
        invalid(`${path}.commandSequence`, 'misaligned with the recording snapshot tick');
      }
      if (snap.commandSequence < validRecording.commands.length && validRecording.commands[snap.commandSequence].tick < snap.tick) {
        invalid(`${path}.commandSequence`, 'misaligned with the next recorded command');
      }
      if ('history' in snap) checkKeyframeHistory(snap, validRecording.history, `${path}.history`);
      checkExerciseTaskSnapshot(snap, compiled.scenario, `${path}.exerciseTask`);
      prevSnapTick = snap.tick;
      if (snap.tick <= replayUntilTick) {
        bestSnapshot = snap;
      }
    }
  }

  if (!campaignStart && /__campaign_s\d+$/.test(compiled.scenario.id) && !(bestSnapshot && bestSnapshot.tick > 0)) {
    throw new Error('旧战役录像不含阶段初始状态，无法跳到首个关键帧之前');
  }
  const previous = useWargameStore.getState();
  replayApplicationDepth++;
  try {
    useWargameStore.getState().loadScenario(compiled.scenario, false, validRecording.seed, campaignStart);
    useWargameStore.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
    let index = 0;
    if (bestSnapshot && bestSnapshot.tick > 0) {
      const restored = copyCheckedBattleSnapshot(inflateReplayKeyframe(bestSnapshot, validRecording.history));
      useWargameStore.setState({
        ...restored,
        activePerspective: restored.playerSide,
        commandHistory: structuredClone(validRecording.commands.slice(0, restored.commandSequence)),
        replaySnapshots: [restored],
      });
      index = restored.commandSequence;
    }
    while (true) {
      let state = useWargameStore.getState();
      while (validRecording.commands[index]?.tick === state.tick) {
        state = applyRecordedCommand(validRecording, validRecording.commands[index++], state);
      }
      if (state.tick >= replayUntilTick) break;
      if (state.battleResult) throw new Error('Recording advances past the end of the battle');
      const nextCommandTick = validRecording.commands[index]?.tick ?? replayUntilTick;
      const ticks = Math.min(batchTicks, nextCommandTick - state.tick, replayUntilTick - state.tick);
      state.stepSingleTick(ticks * FIXED_DT_SEC);
    }
    useWargameStore.setState({ autoPause: previous.autoPause, timeScale: 0,
      pendingRiskEngagement: null, pendingSpawnConfig: null, pendingForcePackageConfig: null,
      pendingPolygonDraft: null, pendingWeaponIdForEngage: null, interactionMode: 'select' });
    return canonicalBattleState();
  } catch (error) {
    useWargameStore.setState(previous, true);
    throw error;
  } finally {
    replayApplicationDepth--;
  }
}

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultBrowserStorage(): MinimalStorage | undefined {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function listBattleSaveSlots(storage: Pick<Storage, 'getItem'> | undefined = defaultBrowserStorage()): SavedBattleSlot[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SAVE_SLOTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedBattleSlot =>
        !!item &&
        typeof item === 'object' &&
        typeof item.slotId === 'string' &&
        typeof item.label === 'string' &&
        typeof item.savedAtIso === 'string' &&
        !!item.save &&
        item.save.kind === 'aegis_battle_save'
    );
  } catch {
    return [];
  }
}

export function saveBattleToSlot(
  label?: string,
  overwriteSlotId?: string,
  storage: MinimalStorage | undefined = defaultBrowserStorage()
): SavedBattleSlot {
  if (!storage) throw new Error('当前环境不支持本地持久化存储');
  const state = useWargameStore.getState();
  const save = captureBattleSave();
  const elapsedSec = Math.max(0, Math.round((state.simTime - state.startTime) / 1000));
  const cleanTitle = state.currentScenario.title.split('//').pop()?.trim() || state.currentScenario.title;
  const resolvedLabel = (label?.trim() || `${cleanTitle} · T+${Math.floor(elapsedSec / 60)}m`).slice(0, 64);
  const slotId = overwriteSlotId || `slot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const entry: SavedBattleSlot = {
    slotId,
    label: resolvedLabel,
    savedAtIso: new Date().toISOString(),
    scenarioId: state.currentScenario.id,
    scenarioTitle: state.currentScenario.title,
    playerSide: state.playerSide,
    tick: state.tick,
    elapsedSec,
    save,
  };
  const existing = listBattleSaveSlots(storage).filter((s) => s.slotId !== slotId);
  const nextSlots = [entry, ...existing].slice(0, MAX_BATTLE_SAVE_SLOTS);
  storage.setItem(SAVE_SLOTS_STORAGE_KEY, JSON.stringify(nextSlots));
  return entry;
}

export function loadBattleFromSlot(
  slotId: string,
  storage: Pick<Storage, 'getItem'> | undefined = defaultBrowserStorage()
): BattleSnapshot {
  const slots = listBattleSaveSlots(storage);
  const found = slots.find((s) => s.slotId === slotId);
  if (!found) throw new Error('未找到指定的存档槽位');
  return restoreBattleSave(found.save);
}

export function deleteBattleSaveSlot(
  slotId: string,
  storage: MinimalStorage | undefined = defaultBrowserStorage()
): SavedBattleSlot[] {
  if (!storage) return [];
  const next = listBattleSaveSlots(storage).filter((s) => s.slotId !== slotId);
  storage.setItem(SAVE_SLOTS_STORAGE_KEY, JSON.stringify(next));
  return next;
}
