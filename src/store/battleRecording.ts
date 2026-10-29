import { COMMAND_ACTIONS, FIXED_DT_SEC, type RecordedCommand } from '../engine/determinism';
import { compileScenario } from '../scenarios/compileScenario';
import type { ScenarioDefinition } from '../types/wargame';
import { useWargameStore, type WargameStoreState } from './useWargameStore';

export interface BattleRecording {
  version: 1;
  scenario: ScenarioDefinition;
  seed: number;
  untilTick: number;
  commands: RecordedCommand[];
}

export function captureBattleRecording(): BattleRecording {
  const state = useWargameStore.getState();
  return structuredClone({ version: 1, scenario: state.currentScenario, seed: state.seed,
    untilTick: state.tick, commands: state.commandHistory });
}

// Rendering, selection, wall-clock timestamps and fractional frame budgets are not simulation state.
export function canonicalBattleState(state: WargameStoreState = useWargameStore.getState()) {
  return structuredClone({ tick: state.tick, startTime: state.startTime, simTime: state.simTime,
    rngState: state.rngState, units: state.units, contacts: state.contacts, weaponsInFlight: state.weaponsInFlight,
    explosions: state.explosions, missions: state.missions, events: state.events, score: state.score,
    objectiveProgress: state.objectiveProgress, battleResult: state.battleResult,
    creditedDamage: state.creditedDamage, detectedMissileIds: state.detectedMissileIds,
    playerSide: state.playerSide, playMode: state.playMode, referencePoints: state.referencePoints,
    commandSequence: state.commandSequence });
}

export function replayBattleRecording(recording: BattleRecording, batchTicks = 1) {
  if (recording.version !== 1 || !Number.isSafeInteger(recording.seed) ||
      !Number.isSafeInteger(recording.untilTick) || recording.untilTick < 0 || recording.untilTick > 200000 ||
      !Array.isArray(recording.commands) || recording.commands.length > 10000 ||
      !Number.isSafeInteger(batchTicks) || batchTicks < 1) throw new Error('Invalid recording header');
  compileScenario(recording.scenario);
  for (const [i, command] of recording.commands.entries()) {
    if (!COMMAND_ACTIONS.includes(command.action as typeof COMMAND_ACTIONS[number]) ||
        !Number.isSafeInteger(command.tick) || command.tick < 0 || command.tick > recording.untilTick ||
        command.sequence !== i || !Array.isArray(command.args) ||
        (i > 0 && command.tick < recording.commands[i - 1].tick)) throw new Error('Invalid command sequence');
  }
  const previous = useWargameStore.getState();
  try {
    useWargameStore.getState().loadScenario(recording.scenario, false, recording.seed);
    useWargameStore.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
    let index = 0;
    while (true) {
      let state = useWargameStore.getState();
      while (recording.commands[index]?.tick === state.tick) {
        const command = recording.commands[index++];
        const action = state[command.action as typeof COMMAND_ACTIONS[number]] as (...args: unknown[]) => void;
        // JSON encodes optional positional arguments as null.
        action(...structuredClone(command.args).map((arg) => arg === null ? undefined : arg));
        state = useWargameStore.getState();
        if (state.commandSequence !== command.sequence + 1) throw new Error('Recorded command is incompatible with the current rules');
      }
      if (state.tick >= recording.untilTick) break;
      if (state.battleResult) throw new Error('Recording advances past the end of the battle');
      const nextCommandTick = recording.commands[index]?.tick ?? recording.untilTick;
      const ticks = Math.min(batchTicks, nextCommandTick - state.tick, recording.untilTick - state.tick);
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
