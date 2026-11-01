import { COMMAND_ACTIONS, FIXED_DT_SEC, type RecordedCommand } from '../engine/determinism';
import { compileScenario } from '../scenarios/compileScenario';
import type { ScenarioDefinition } from '../types/wargame';
import { useWargameStore, type WargameStoreState } from './useWargameStore';

export const BATTLE_RECORDING_VERSION = 2 as const;
export const RULESET_VERSION = '2026.11-ruleset-15';
export const SCENARIO_SCHEMA_VERSION = 8;

export interface BattleRecording {
  version: typeof BATTLE_RECORDING_VERSION;
  rulesetVersion: string;
  catalogVersion: string;
  scenarioSchemaVersion: number;
  scenario: ScenarioDefinition;
  seed: number;
  untilTick: number;
  commands: RecordedCommand[];
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
  for (const [i, command] of validRecording.commands.entries()) {
    if (!COMMAND_ACTIONS.includes(command.action as typeof COMMAND_ACTIONS[number]) ||
        !Number.isSafeInteger(command.tick) || command.tick < 0 || command.tick > validRecording.untilTick ||
        command.sequence !== i || !Array.isArray(command.args) ||
        (i > 0 && command.tick < validRecording.commands[i - 1].tick)) throw new Error('Invalid command sequence');
  }
  const previous = useWargameStore.getState();
  try {
    useWargameStore.getState().loadScenario(compiled.scenario, false, validRecording.seed);
    useWargameStore.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
    let index = 0;
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
    }
    useWargameStore.setState({ autoPause: previous.autoPause, timeScale: 0,
      pendingRiskEngagement: null, pendingSpawnConfig: null, pendingWeaponIdForEngage: null, interactionMode: 'select' });
    return canonicalBattleState();
  } catch (error) {
    useWargameStore.setState(previous, true);
    throw error;
  }
}
