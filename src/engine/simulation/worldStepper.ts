import { createAarLedger, recordAarTick } from '../aar';
import { processPendingSortieOrders } from '../carrierOperations';
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
import { advanceAirRefueling } from './airRefueling';
import { processPendingTotStrikeOrders, runAutoDefense } from './autoDefense';
import { resolveEventsAndObjectives } from './eventResolver';
import { runEvasionAndSoftKill } from './evasion';
import type {
  PauseTrigger,
  SimulationStepResult,
  SimulationWorldState,
} from './types';
import { advanceUnitPhysics } from './unitPhysics';
import { advanceWeaponPhysics } from './weaponPhysics';

function cloneUnitForStepping(unit: RuntimeUnit): RuntimeUnit {
  return {
    ...unit,
    position: [...unit.position],
    subsystems: unit.subsystems ? { ...unit.subsystems } : undefined,
    waypoints: unit.waypoints.map((waypoint) => ({
      ...waypoint,
      position: [...waypoint.position] as [number, number],
    })),
    doctrine: {
      ...unit.doctrine,
      automaticTargetDomains: [...unit.doctrine.automaticTargetDomains],
    },
    coordinatedAttack: unit.coordinatedAttack ? { ...unit.coordinatedAttack } : undefined,
    aarQueue: [...unit.aarQueue],
    deployableInventory: { ...unit.deployableInventory },
    completedWithdrawalObjectiveIds: [...unit.completedWithdrawalObjectiveIds],
    airRefuelState: unit.airRefuelState
      ? {
          ...unit.airRefuelState,
          resumeWaypoints: unit.airRefuelState.resumeWaypoints.map((waypoint) => ({
            ...waypoint,
            position: [...waypoint.position] as [number, number],
          })),
        }
      : undefined,
    countermeasures: { ...unit.countermeasures },
    countermeasureEffect: unit.countermeasureEffect ? { ...unit.countermeasureEffect } : undefined,
    evasionState: unit.evasionState
      ? {
          ...unit.evasionState,
          resumeWaypoints: unit.evasionState.resumeWaypoints.map((waypoint) => ({
            ...waypoint,
            position: [...waypoint.position] as [number, number],
          })),
          resumeFormationOffset: unit.evasionState.resumeFormationOffset
            ? { ...unit.evasionState.resumeFormationOffset }
            : undefined,
        }
      : undefined,
    baffleClearState: unit.baffleClearState
      ? {
          ...unit.baffleClearState,
          savedWaypoints: unit.baffleClearState.savedWaypoints.map((waypoint) => ({
            ...waypoint,
            position: [...waypoint.position] as [number, number],
          })),
        }
      : undefined,
    mounts: unit.mounts.map((mount) => ({ ...mount })),
    hangar: (unit.hangar || []).map((slot) => ({
      ...slot,
      turnaroundQueue: slot.turnaroundQueue.map((entry) => ({ ...entry })),
      activeSortieIds: [...slot.activeSortieIds],
    })),
  };
}

type WorkingWorldState = SimulationWorldState & { missions: ReturnType<typeof deriveMissionAssignments> };

function cloneWorldForStepping(world: SimulationWorldState): WorkingWorldState {
  const units: Record<string, RuntimeUnit> = {};
  for (const [id, unit] of Object.entries(world.units)) {
    units[id] = cloneUnitForStepping(unit);
  }
  const weaponsInFlight: Record<string, WeaponInFlight> = {};
  for (const [id, weapon] of Object.entries(world.weaponsInFlight)) {
    weaponsInFlight[id] = {
      ...weapon,
      position: [...weapon.position],
      trail: [...weapon.trail],
      waypoints: weapon.waypoints ? weapon.waypoints.map((wp) => [...wp] as [number, number]) : undefined,
    };
  }
  const events: RuntimeScenarioEvent[] = (world.events || []).map((event) => ({
    ...event,
    matchedUnitIds: [...(event.matchedUnitIds ?? [])],
  }));
  return {
    ...world,
    startTime: world.startTime ?? world.simTime,
    tick: world.tick ?? 0,
    rngState: world.rngState ?? DEFAULT_SEED,
    units,
    weaponsInFlight,
    explosions: [...world.explosions],
    missions: deriveMissionAssignments(world.missions, units),
    events,
    pendingSortieOrders: (world.pendingSortieOrders ?? []).map((order) => ({ ...order })),
    pendingTotStrikeOrders: (world.pendingTotStrikeOrders ?? []).map((order) => ({
      ...order,
      doglegWaypoints: order.doglegWaypoints ? order.doglegWaypoints.map((wp) => [...wp] as [number, number]) : undefined,
    })),
    score: {
      ...world.score,
      firedEventIds: [...(world.score.firedEventIds || [])],
      sortiesLaunched: world.score.sortiesLaunched ?? 0,
    },
    creditedDamage: { ...world.creditedDamage },
    detectedMissileIds: world.detectedMissileIds ? [...world.detectedMissileIds] : undefined,
    objectiveProgress: world.objectiveProgress ? { ...world.objectiveProgress } : {},
    objectiveHoldProgress: world.objectiveHoldProgress ? { ...world.objectiveHoldProgress } : {},
    aar: world.aar
      ? {
          events: [...world.aar.events],
          tracks: [...world.aar.tracks],
        }
      : createAarLedger(),
  };
}

function stepWorkingWorldInPlace(
  world: WorkingWorldState,
  catalog: EquipmentCatalog,
  dtSec: number,
  autoPauseSettings: AutoPauseSettings,
  activePerspective: ActivePerspective,
  randomOverride?: () => number
): SimulationStepResult {
  if (world.battleResult) {
    world.missions = deriveMissionAssignments(world.missions, world.units);
    return {
      nextState: world,
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
  const units = world.units;
  const weaponsInFlight = world.weaponsInFlight;
  const missions = deriveMissionAssignments(world.missions, units);
  const events = (world.events || []) as RuntimeScenarioEvent[];
  let pendingSortieOrders = world.pendingSortieOrders ?? (world.pendingSortieOrders = []);
  let pendingTotStrikeOrders = world.pendingTotStrikeOrders ?? (world.pendingTotStrikeOrders = []);
  const score = world.score;
  const creditedDamage = world.creditedDamage ?? (world.creditedDamage = {});
  const aar = world.aar ?? (world.aar = createAarLedger());
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
    weaponsInFlight,
    missions,
    catalog,
    environment: world.environment,
    nextSimTime,
    dtSec,
    score,
    logs,
  });

  pendingSortieOrders = processPendingSortieOrders(
    pendingSortieOrders, units, missions, catalog, nextSimTime, score, logs, world.environment
  );
  advanceAirRefueling(units, catalog, nextSimTime, dtSec, logs);

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
    dtSec,
    world.environment,
    startTime
  );
  const contacts = sensed.contacts;
  logs.push(...sensed.logs);
  for (const log of sensed.logs) {
    triggerPause(autoPauseSettings.onNewContact, log.title, log.side);
  }

  pendingTotStrikeOrders = processPendingTotStrikeOrders(
    pendingTotStrikeOrders,
    units,
    contacts,
    missions,
    weaponsInFlight,
    catalog,
    nextSimTime,
    score,
    logs
  );

  const detectedMissileIds = runAutoDefense({
    units,
    missions,
    contacts,
    weaponsInFlight,
    catalog,
    environment: world.environment,
    nextSimTime,
    score,
    logs,
    previousDetectedMissileIds: world.detectedMissileIds,
    autoPauseSettings,
    triggerPause,
  });

  runEvasionAndSoftKill({
    units,
    weaponsInFlight,
    catalog,
    nextSimTime,
    logs,
  });

  const explosions = advanceWeaponPhysics({
    units,
    contacts,
    weaponsInFlight,
    previousExplosions: world.explosions,
    catalog,
    environment: world.environment,
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
    pendingSortieOrders,
    units,
    contacts,
    missions,
    catalog,
    environment: world.environment,
    nextSimTime,
    startTime,
    dtSec,
    score,
    rng,
    logs,
    objectives: world.objectives ?? [],
    objectiveProgress: world.objectiveProgress ?? {},
    objectiveHoldProgress: world.objectiveHoldProgress ?? {},
    victoryConditions: world.victoryConditions,
  });
  if (objectiveEvaluation.battleResult) {
    shouldAutoPause = true;
    autoPauseReason = '想定已结束：请查看任务结算与战报';
  }
  logs.push(...objectiveEvaluation.logs);
  const nextTick = (world.tick ?? 0) + 1;
  recordAarTick(aar, nextTick, nextSimTime, units, logs, !!objectiveEvaluation.battleResult);

  world.startTime = startTime;
  world.tick = nextTick;
  world.rngState = random.state();
  world.objectiveProgress = objectiveEvaluation.progress;
  world.objectiveHoldProgress = objectiveEvaluation.holdProgress;
  world.battleResult = objectiveEvaluation.battleResult;
  world.creditedDamage = creditedDamage;
  world.detectedMissileIds = detectedMissileIds;
  world.aar = aar;
  world.simTime = nextSimTime;
  world.contacts = contacts;
  world.explosions = explosions;
  world.missions = deriveMissionAssignments(missions, units);
  world.events = events;
  world.pendingSortieOrders = pendingSortieOrders;
  world.pendingTotStrikeOrders = pendingTotStrikeOrders;

  return {
    nextState: world,
    newLogs: logs,
    shouldAutoPause,
    autoPauseReason,
  };
}

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
  return stepWorkingWorldInPlace(
    cloneWorldForStepping(world),
    catalog,
    dtSec,
    autoPauseSettings,
    activePerspective,
    randomOverride
  );
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
    world.simTime,
    undefined,
    world.environment
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
  if (world.battleResult || seconds + 1e-9 < FIXED_DT_SEC) {
    return {
      nextState: {
        ...world,
        missions: deriveMissionAssignments(world.missions, world.units),
      },
      newLogs: [],
      shouldAutoPause: false,
      remainingSec: seconds,
    };
  }
  const working = cloneWorldForStepping(world);
  let result: SimulationStepResult = {
    nextState: working,
    newLogs: [],
    shouldAutoPause: false,
  };
  const logs: CombatLogEntry[] = [];
  let remainingSec = seconds;
  while (
    remainingSec + 1e-9 >= FIXED_DT_SEC &&
    !working.battleResult
  ) {
    result = stepWorkingWorldInPlace(
      working,
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
