export const FIXED_DT_SEC = 0.25;
export const DEFAULT_SEED = 20261028;
export const COMMAND_ACTIONS = ['setPlayerSide', 'setPlayMode', 'appendUnitWaypoint', 'updateUnitWaypoint',
  'removeUnitWaypoint', 'clearUnitWaypoints', 'setGroupFormation', 'requestAirRefuel', 'deployCarriedPlatform',
  'updateUnitDoctrine', 'updateUnitKinematics', 'switchUnitLoadout', 'launchCarrierAircraft',
  'assignUnitMission', 'createMissionFromReferencePoints', 'updateMissionFromReferencePoints',
  'deleteMission', 'toggleMissionActive', 'moveUnitInSandbox', 'updateScenarioGroup', 'assignUnitGroup',
  'upsertObjective', 'deleteObjective', 'createAreaEventFromReferencePoints', 'deleteScenarioEvent',
  'executeManualEngage', 'addReferencePoint',
  'removeReferencePoint', 'startSpawnUnitOnMap', 'spawnUnitAtCoordinate'] as const;

export function createRandomStream(initialState: number) {
  let state = initialState >>> 0;
  return {
    next: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let n = Math.imul(state ^ (state >>> 15), state | 1);
      n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
      return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    },
    state: () => state,
  };
}

export interface RecordedCommand {
  tick: number;
  sequence: number;
  action: string;
  args: unknown[];
}
