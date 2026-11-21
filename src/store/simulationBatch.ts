import { shallow } from 'zustand/shallow';
import { simulationWorkerClient, StaleSimulationBatchError } from '../engine/workerClient';
import { extractSimulationWorldState, useWargameStore, type WargameStoreState } from './useWargameStore';

// Loading (including same-ID restores) recompiles the opening placements, while live edits
// preserve this reference. Use it for clock/backlog resets, not for batch admission by itself.
export const selectSimulationSession = (state: WargameStoreState) => state.currentScenario.units;

/** Returns true only when this budget was applied to the still-current live simulation. */
export async function runSimulationBatch(
  state: WargameStoreState,
  seconds: number,
  isLoopActive: () => boolean = () => true,
  client = simulationWorkerClient,
): Promise<boolean> {
  const { currentScenario, catalog, autoPause, playerSide, playMode, timeScale, commandSequence, pendingSimSeconds } = state;
  const world = extractSimulationWorldState(state);
  const matchesInputs = (now: WargameStoreState) =>
    !now.replayPlayer && !now.battleResult &&
    now.currentScenario === currentScenario && now.catalog === catalog && now.autoPause === autoPause &&
    now.playerSide === playerSide && now.playMode === playMode && now.timeScale === timeScale &&
    now.commandSequence === commandSequence && now.pendingSimSeconds === pendingSimSeconds &&
    shallow(world, extractSimulationWorldState(now));

  if (timeScale === 0 || state.replayPlayer || state.battleResult) return false;
  // Latch changes before they can be undone (e.g. pause/resume in the same React commit).
  // Only immutable simulation inputs are observed; selection and other UI state can change freely.
  let invalidated = false;
  const unsubscribe = useWargameStore.subscribe((now) => {
    if (!invalidated && !matchesInputs(now)) invalidated = true;
  });
  const isCurrent = () => !invalidated && isLoopActive() && matchesInputs(useWargameStore.getState());

  try {
    let result;
    try {
      result = await client.runBatch(world, catalog, seconds + pendingSimSeconds, autoPause, playerSide, undefined, isCurrent);
    } catch (error) {
      if (error instanceof StaleSimulationBatchError || !isCurrent()) return false;
      useWargameStore.getState().stepSingleTick(seconds);
      return true;
    }
    return isCurrent() && useWargameStore.getState().applySimulationResult(result, state.tick, commandSequence, currentScenario.id);
  } finally {
    unsubscribe();
  }
}
