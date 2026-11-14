import { COMMAND_ACTIONS, FIXED_DT_SEC, SNAPSHOT_INTERVAL_TICKS, type RecordedCommand } from '../engine/determinism';
import { summarizeAar } from '../engine/aar';
import { compileScenario } from '../scenarios/compileScenario';
import type { ScenarioDefinition } from '../types/wargame';
import { useWargameStore, type WargameStoreState } from './useWargameStore';

export const BATTLE_RECORDING_VERSION = 2 as const;
export const BATTLE_SAVE_VERSION = 1 as const;
export { SNAPSHOT_INTERVAL_TICKS };
export const RULESET_VERSION = '2026.12-ruleset-21';
export const SCENARIO_SCHEMA_VERSION = 12;
export const AUTOSAVE_STORAGE_KEY = 'aegis_cmo_autosave_v1';

export type BattleSnapshot = ReturnType<typeof canonicalBattleState>;

export interface BattleRecording {
  version: typeof BATTLE_RECORDING_VERSION;
  rulesetVersion: string;
  catalogVersion: string;
  scenarioSchemaVersion: number;
  scenario: ScenarioDefinition;
  seed: number;
  untilTick: number;
  commands: RecordedCommand[];
  snapshots?: BattleSnapshot[];
}

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
  digest: string;
}

export function computeCanonicalDigest(state: BattleSnapshot): string {
  const payload = JSON.stringify(state);
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
  return structuredClone({
    version: BATTLE_RECORDING_VERSION,
    rulesetVersion: RULESET_VERSION,
    catalogVersion: state.catalog.version,
    scenarioSchemaVersion: SCENARIO_SCHEMA_VERSION,
    scenario: state.currentScenario,
    seed: state.seed,
    untilTick: state.tick,
    commands: state.commandHistory,
    snapshots: state.replaySnapshots.length > 0 ? state.replaySnapshots : undefined,
  });
}

// Rendering, selection, wall-clock timestamps and fractional frame budgets are not simulation state.
export function canonicalBattleState(state: WargameStoreState = useWargameStore.getState()) {
  return structuredClone({ tick: state.tick, startTime: state.startTime, simTime: state.simTime,
    rngState: state.rngState, units: state.units, contacts: state.contacts, weaponsInFlight: state.weaponsInFlight,
    explosions: state.explosions, missions: state.missions, events: state.events,
    groups: state.groups, objectives: state.objectives,
    environment: state.environment, score: state.score,
    objectiveProgress: state.objectiveProgress, battleResult: state.battleResult,
    creditedDamage: state.creditedDamage, detectedMissileIds: state.detectedMissileIds, aar: state.aar,
    playerSide: state.playerSide, playMode: state.playMode, referencePoints: state.referencePoints,
    commandSequence: state.commandSequence });
}

export function captureBattleSave(): BattleSaveState {
  const state = useWargameStore.getState();
  const snapshot = canonicalBattleState(state);
  return structuredClone({
    kind: 'aegis_battle_save',
    version: BATTLE_SAVE_VERSION,
    rulesetVersion: RULESET_VERSION,
    catalogVersion: state.catalog.version,
    scenarioSchemaVersion: SCENARIO_SCHEMA_VERSION,
    scenario: state.currentScenario,
    seed: state.seed,
    commandHistory: state.commandHistory,
    snapshot,
    digest: computeCanonicalDigest(snapshot),
  });
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

function validateCommandList(commands: RecordedCommand[], untilTick: number) {
  for (const [i, command] of commands.entries()) {
    if (!COMMAND_ACTIONS.includes(command.action as typeof COMMAND_ACTIONS[number]) ||
        !Number.isSafeInteger(command.tick) || command.tick < 0 || command.tick > untilTick ||
        command.sequence !== i || !Array.isArray(command.args) ||
        (i > 0 && command.tick < commands[i - 1].tick)) throw new Error('Invalid command sequence');
  }
}

export function restoreBattleSave(input: unknown): BattleSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid battle save header');
  }
  const save = input as Partial<BattleSaveState>;
  if (save.kind !== 'aegis_battle_save' || save.version !== BATTLE_SAVE_VERSION) {
    throw new Error(`Unsupported save version ${String(save.version ?? 'missing')}; expected v${BATTLE_SAVE_VERSION}`);
  }
  if (save.rulesetVersion !== RULESET_VERSION) {
    throw new Error(`Incompatible ruleset version ${String(save.rulesetVersion ?? 'missing')}; expected ${RULESET_VERSION}`);
  }
  if (save.scenarioSchemaVersion !== SCENARIO_SCHEMA_VERSION) {
    throw new Error(`Incompatible scenario schema version ${String(save.scenarioSchemaVersion ?? 'missing')}; expected ${SCENARIO_SCHEMA_VERSION}`);
  }
  if (!Number.isSafeInteger(save.seed) || !Array.isArray(save.commandHistory) || !save.snapshot || typeof save.digest !== 'string') {
    throw new Error('Invalid battle save payload');
  }
  if (!Number.isSafeInteger(save.snapshot.tick) || save.snapshot.tick < 0 || save.snapshot.tick > 200000) {
    throw new Error('Invalid save snapshot tick');
  }
  if (save.snapshot.commandSequence !== save.commandHistory.length) {
    throw new Error('Save command history length mismatch');
  }
  validateCommandList(save.commandHistory, save.snapshot.tick);
  const compiled = compileScenario(save.scenario);
  if (save.catalogVersion !== compiled.catalog.version) {
    throw new Error(`Incompatible catalog version ${String(save.catalogVersion ?? 'missing')}; scenario resolves to ${compiled.catalog.version}`);
  }
  const clonedSnapshot = structuredClone(save.snapshot);
  if (computeCanonicalDigest(clonedSnapshot) !== save.digest) {
    throw new Error('Battle save digest mismatch (corrupted or tampered state)');
  }

  const previous = useWargameStore.getState();
  try {
    useWargameStore.getState().loadScenario(compiled.scenario, false, save.seed);
    useWargameStore.setState({
      ...clonedSnapshot,
      commandHistory: structuredClone(save.commandHistory),
      replaySnapshots: [structuredClone(clonedSnapshot)],
      activePerspective: clonedSnapshot.playerSide,
      timeScale: 0,
      pendingSimSeconds: 0,
      selectedUnitId: null,
      selectedContactId: null,
      pendingRiskEngagement: null,
      pendingSpawnConfig: null,
      pendingWeaponIdForEngage: null,
      interactionMode: 'select',
    });
    return canonicalBattleState();
  } catch (error) {
    useWargameStore.setState(previous, true);
    throw error;
  }
}

export function replayBattleRecording(input: unknown, batchTicks = 1, targetTick?: number) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid recording header');
  }
  const recording = input as Partial<BattleRecording>;
  if (recording.version !== BATTLE_RECORDING_VERSION) {
    const received = recording.version === 1 ? 'legacy v1' : String(recording.version ?? 'missing');
    throw new Error(`Unsupported recording version ${received}; expected v${BATTLE_RECORDING_VERSION}`);
  }
  if (recording.rulesetVersion !== RULESET_VERSION) {
    throw new Error(`Incompatible ruleset version ${String(recording.rulesetVersion ?? 'missing')}; expected ${RULESET_VERSION}`);
  }
  if (recording.scenarioSchemaVersion !== SCENARIO_SCHEMA_VERSION) {
    throw new Error(`Incompatible scenario schema version ${String(recording.scenarioSchemaVersion ?? 'missing')}; expected ${SCENARIO_SCHEMA_VERSION}`);
  }
  if (!Number.isSafeInteger(recording.seed) ||
      !Number.isSafeInteger(recording.untilTick) || recording.untilTick! < 0 || recording.untilTick! > 200000 ||
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
  validateCommandList(validRecording.commands, validRecording.untilTick);

  let bestSnapshot: BattleSnapshot | undefined;
  if (Array.isArray(validRecording.snapshots)) {
    let prevSnapTick = -1;
    for (const snap of validRecording.snapshots) {
      if (!snap || typeof snap !== 'object' || !Number.isSafeInteger(snap.tick) ||
          snap.tick < 0 || snap.tick > validRecording.untilTick || snap.tick <= prevSnapTick ||
          !Number.isSafeInteger(snap.commandSequence) || snap.commandSequence < 0 ||
          snap.commandSequence > validRecording.commands.length) {
        throw new Error('Invalid recording snapshot metadata');
      }
      if (snap.commandSequence > 0 && validRecording.commands[snap.commandSequence - 1].tick > snap.tick) {
        throw new Error('Invalid recording snapshot command alignment');
      }
      if (snap.commandSequence < validRecording.commands.length && validRecording.commands[snap.commandSequence].tick < snap.tick) {
        throw new Error('Invalid recording snapshot future command alignment');
      }
      prevSnapTick = snap.tick;
      if (snap.tick <= replayUntilTick) {
        bestSnapshot = snap;
      }
    }
  }

  const previous = useWargameStore.getState();
  try {
    useWargameStore.getState().loadScenario(compiled.scenario, false, validRecording.seed);
    useWargameStore.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
    let index = 0;
    if (bestSnapshot && bestSnapshot.tick > 0) {
      const restored = structuredClone(bestSnapshot);
      useWargameStore.setState({
        ...restored,
        activePerspective: restored.playerSide,
        commandHistory: structuredClone(validRecording.commands.slice(0, restored.commandSequence)),
      });
      index = restored.commandSequence;
    }
    const collectedSnapshots: BattleSnapshot[] = validRecording.snapshots ? structuredClone(validRecording.snapshots) : [];
    while (true) {
      let state = useWargameStore.getState();
      while (validRecording.commands[index]?.tick === state.tick) {
        const command = validRecording.commands[index++];
        const action = state[command.action as typeof COMMAND_ACTIONS[number]] as (...args: unknown[]) => void;
        // JSON encodes optional positional arguments as null.
        action(...structuredClone(command.args).map((arg) => arg === null ? undefined : arg));
        state = useWargameStore.getState();
        if (state.commandSequence !== command.sequence + 1) throw new Error('Recorded command is incompatible with the current rules');
      }
      if (state.tick >= replayUntilTick) break;
      if (state.battleResult) throw new Error('Recording advances past the end of the battle');
      const nextCommandTick = validRecording.commands[index]?.tick ?? replayUntilTick;
      const ticks = Math.min(batchTicks, nextCommandTick - state.tick, replayUntilTick - state.tick);
      state.stepSingleTick(ticks * FIXED_DT_SEC);
      const afterStep = useWargameStore.getState();
      if (!validRecording.snapshots && afterStep.tick > 0 && afterStep.tick % SNAPSHOT_INTERVAL_TICKS === 0 &&
          collectedSnapshots.length < 60) {
        collectedSnapshots.push(canonicalBattleState(afterStep));
      }
    }
    useWargameStore.setState({ autoPause: previous.autoPause, timeScale: 0,
      replaySnapshots: collectedSnapshots.length ? collectedSnapshots : useWargameStore.getState().replaySnapshots,
      pendingRiskEngagement: null, pendingSpawnConfig: null, pendingWeaponIdForEngage: null, interactionMode: 'select' });
    return canonicalBattleState();
  } catch (error) {
    useWargameStore.setState(previous, true);
    throw error;
  }
}
