import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { recordAarTick } from '../engine/aar';
import { COMMAND_ACTIONS } from '../engine/determinism';
import { isApplyingBattleRecording } from './battleRecording';
import { createCommandSlice } from './slices/commandSlice';
import { createExerciseTaskSlice } from './slices/exerciseTaskSlice';
import { createMissionAndBuilderSlice } from './slices/missionAndBuilderSlice';
import { createScenarioSlice, extractSimulationWorldState } from './slices/scenarioSlice';
import type { WargameStoreState } from './types';

export { extractSimulationWorldState };

export type {
  AreaEventDraft,
  MapInteractionMode,
  MapLayerVisibility,
  MissionReferencePointDraft,
  ObjectiveDraft,
  WargameStoreState,
} from './types';

export const useWargameStore = create<WargameStoreState>()(
  subscribeWithSelector((set, get) => {
    const state: WargameStoreState = {
      ...createScenarioSlice(set, get),
      ...createCommandSlice(set),
      ...createExerciseTaskSlice(set, get),
      ...createMissionAndBuilderSlice(set),
    };
    for (const name of COMMAND_ACTIONS) {
      const action = state[name] as (...args: unknown[]) => void;
      Object.assign(state, { [name]: (...args: unknown[]) => {
        const before = get();
        if (before.replayPlayer && !isApplyingBattleRecording()) return;
        action(...args);
        if (get() !== before) {
          const after = get();
          const previousLogIds = new Set(before.logs.map((log) => log.id));
          const commandLogs = after.logs.filter((log) => !previousLogIds.has(log.id));
          const aar = {
            events: [...after.aar.events],
            tracks: [...after.aar.tracks],
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
