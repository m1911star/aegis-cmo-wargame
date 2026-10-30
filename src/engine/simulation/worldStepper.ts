import { createRandomStream, DEFAULT_SEED, FIXED_DT_SEC } from '../determinism';
import { deriveMissionAssignments } from '../missions';
import { computeContactsOnly } from '../sensors';
import type {
  ActivePerspective,
  AutoPauseSettings,
  CombatLogEntry,
  EquipmentCatalog,
  RuntimeScenarioEvent,
  RuntimeUnit,
  ScoreLedger,
  SideId,
  WeaponInFlight,
} from '../../types/wargame';
import { runAutoDefense } from './autoDefense';
import { resolveEventsAndObjectives } from './eventResolver';
import type {
  PauseTrigger,
  SimulationStepResult,
  SimulationWorldState,
} from './types';
import { advanceUnitPhysics } from './unitPhysics';
import { advanceWeaponPhysics } from './weaponPhysics';

/** Advance the deterministic world by one simulation tick. */
export function stepSimulationWorld(
  world: SimulationWorldState,
  catalog: EquipmentCatalog,
  dtSec: number,
  autoPauseSettings: AutoPauseSettings,
  activePerspective: ActivePerspective,
  randomOverride?: () => number
): SimulationStepResult {
  if (world.battleResult) {
    return {
      nextState: {
        ...world,
        missions: deriveMissionAssignments(world.missions, world.units),
      },
      newLogs: [],
      shouldAutoPause: true,
    };
  }
  if (!Number.isFinite(dtSec) || dtSec <= 0) {
    throw new Error('Simulation step must be positive');
  }

  const random = createRandomStream(world.rngState ?? DEFAULT_SEED);
  const rng = randomOverride ?? random.next;
  const nextSimTime = world.simTime + dtSec * 1000;
  const startTime = world.startTime ?? world.simTime;

  const units: Record<string, RuntimeUnit> = {};
  for (const [id, unit] of Object.entries(world.units)) {
    units[id] = {
      ...unit,
      position: [...unit.position],
      waypoints: unit.waypoints.map((waypoint) => [...waypoint]),
      doctrine: { ...unit.doctrine },
      mounts: unit.mounts.map((mount) => ({ ...mount })),
      hangar: (unit.hangar || []).map((slot) => ({ ...slot })),
    };
  }

  const weaponsInFlight: Record<string, WeaponInFlight> = {};
  for (const [id, weapon] of Object.entries(world.weaponsInFlight)) {
    weaponsInFlight[id] = {
      ...weapon,
      position: [...weapon.position],
      trail: [...weapon.trail],
    };
  }

  const missions = deriveMissionAssignments(world.missions, units);
  const events: RuntimeScenarioEvent[] = (world.events || []).map((event) => ({
    ...event,
    matchedUnitIds: [...(event.matchedUnitIds ?? [])],
  }));
  const score: ScoreLedger = {
    ...world.score,
    firedEventIds: [...(world.score.firedEventIds || [])],
    sortiesLaunched: world.score.sortiesLaunched ?? 0,
  };
  const creditedDamage = { ...world.creditedDamage };
  const logs: CombatLogEntry[] = [];
  let shouldAutoPause = false;
  let autoPauseReason: string | undefined;

  const triggerPause: PauseTrigger = (
    condition: boolean,
    reason: string,
    relevantSide: SideId | 'SYSTEM'
  ) => {
    if (!condition) return;
    if (
      activePerspective === 'GOD' ||
      relevantSide === 'SYSTEM' ||
      relevantSide === activePerspective
    ) {
      shouldAutoPause = true;
      if (!autoPauseReason) autoPauseReason = reason;
    }
  };

  advanceUnitPhysics({
    units,
    previousContacts: world.contacts,
    missions,
    catalog,
    nextSimTime,
    dtSec,
    score,
    logs,
  });

  for (const log of logs) {
    if (log.category === 'DESTROYED') {
      triggerPause(
        autoPauseSettings.onUnitHitOrDestroyed,
        log.title,
        log.side
      );
    }
  }

  const sensed = computeContactsOnly(
    units,
    catalog,
    world.contacts,
    nextSimTime,
    dtSec
  );
  const contacts = sensed.contacts;
  logs.push(...sensed.logs);
  for (const log of sensed.logs) {
    triggerPause(autoPauseSettings.onNewContact, log.title, log.side);
  }

  const detectedMissileIds = runAutoDefense({
    units,
    missions,
    contacts,
    weaponsInFlight,
    catalog,
    nextSimTime,
    score,
    logs,
    previousDetectedMissileIds: world.detectedMissileIds,
    autoPauseSettings,
    triggerPause,
  });

  const explosions = advanceWeaponPhysics({
    units,
    contacts,
    weaponsInFlight,
    previousExplosions: world.explosions,
    catalog,
    nextSimTime,
    dtSec,
    score,
    creditedDamage,
    victoryConditions: world.victoryConditions,
    rng,
    logs,
    autoPauseSettings,
    triggerPause,
  });

  const objectiveEvaluation = resolveEventsAndObjectives({
    events,
    units,
    contacts,
    missions,
    catalog,
    nextSimTime,
    startTime,
    score,
    rng,
    logs,
    objectives: world.objectives ?? [],
    objectiveProgress: world.objectiveProgress ?? {},
    victoryConditions: world.victoryConditions,
  });
  if (objectiveEvaluation.battleResult) {
    shouldAutoPause = true;
    autoPauseReason = '想定已结束：请查看任务结算与战报';
  }
  logs.push(...objectiveEvaluation.logs);

  return {
    nextState: {
      startTime,
      tick: (world.tick ?? 0) + 1,
      rngState: random.state(),
      objectives: world.objectives,
      objectiveProgress: objectiveEvaluation.progress,
      battleResult: objectiveEvaluation.battleResult,
      creditedDamage,
      detectedMissileIds,
      simTime: nextSimTime,
      units,
      contacts,
      weaponsInFlight,
      explosions,
      missions: deriveMissionAssignments(missions, units),
      events,
      victoryConditions: world.victoryConditions,
      score,
    },
    newLogs: logs,
    shouldAutoPause,
    autoPauseReason,
  };
}

/** Initialize sensor contacts without advancing time or consuming resources. */
export function initializeWorldContacts(
  world: SimulationWorldState,
  catalog: EquipmentCatalog
): SimulationStepResult {
  const sensed = computeContactsOnly(
    world.units,
    catalog,
    world.contacts,
    world.simTime
  );
  return {
    nextState: {
      ...world,
      contacts: sensed.contacts,
      missions: deriveMissionAssignments(world.missions, world.units),
    },
    newLogs: sensed.logs,
    shouldAutoPause: false,
  };
}

/** Advance through fixed deterministic substeps until the budget or a pause ends. */
export function advanceSimulation(
  world: SimulationWorldState,
  catalog: EquipmentCatalog,
  seconds: number,
  autoPause: AutoPauseSettings,
  playerSide: ActivePerspective
): SimulationStepResult & { remainingSec: number } {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error('Invalid simulation duration');
  }
  let result: SimulationStepResult = {
    nextState: {
      ...world,
      missions: deriveMissionAssignments(world.missions, world.units),
    },
    newLogs: [],
    shouldAutoPause: false,
  };
  const logs: CombatLogEntry[] = [];
  let remainingSec = seconds;
  while (
    remainingSec + 1e-9 >= FIXED_DT_SEC &&
    !result.nextState.battleResult
  ) {
    result = stepSimulationWorld(
      result.nextState,
      catalog,
      FIXED_DT_SEC,
      autoPause,
      playerSide
    );
    logs.push(...result.newLogs);
    remainingSec = Math.max(0, remainingSec - FIXED_DT_SEC);
    if (result.shouldAutoPause) {
      remainingSec = 0;
      break;
    }
  }
  return { ...result, newLogs: logs, remainingSec };
}
