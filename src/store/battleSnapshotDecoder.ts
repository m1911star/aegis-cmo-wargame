import { FIXED_DT_SEC } from '../engine/determinism';
import type { ScenarioDefinition } from '../types/wargame';
import { array, boolean, coordinate, id, invalid, isRecord, number, object, oneOf, optional, record, text, type Check } from '../validation/schema';
import { assertScenarioShape, sidc } from '../validation/wargameSchemas';
import type { BattleSnapshot } from './battleRecording';
import type { CompactKeyframe } from './replayKeyframes';

const finite = number();
const count = number(0, Number.MAX_SAFE_INTEGER, true);
export const uint32 = number(0, 0xffffffff, true);
const sides = oneOf(['RED', 'BLUE', 'NEUTRAL']);
const domain = oneOf(['air', 'surface', 'subsurface', 'land']);
const status = oneOf(['operational', 'engaged', 'evading', 'returning', 'recovered', 'destroyed']);
const threat = oneOf(['low', 'medium', 'high', 'critical']);
const outcomes = oneOf(['victory', 'costly_victory', 'defeat', 'draw']);
const ids = array(id);
const points = array(coordinate);
const route = array(object({ position: coordinate, speedKts: optional(finite), altitudeM: optional(finite) }));
const savedRoute = { resumeWaypoints: route, managedWaypointPosition: optional(coordinate) };

// Validate runtime shapes, not opening-placement semantics: a live unit may
// have moved, been recovered, or lost a referenced unit since the opening.
function entities(fields: Record<string, Check>): Check {
  const check = object({ id, ...fields });
  return (value, path) => {
    if (!isRecord(value)) invalid(path, 'expected a dictionary');
    for (const [key, entity] of Object.entries(value)) {
      id(key, `${path} key`);
      check(entity, `${path}.${key}`);
      if ((entity as { id: string }).id !== key) invalid(`${path}.${key}.id`, 'does not match its dictionary key');
    }
  };
}

const units = entities({
  name: text, callsign: text, side: sides, domain, category: id, sidc, platformId: id, activeLoadoutId: optional(id),
  parentGroupId: id, position: coordinate, recoveryPosition: optional(coordinate),
  altitudeM: finite, targetAltitudeM: finite, heading: finite, speedKts: finite, targetSpeedKts: finite,
  waypoints: route, hp: finite, maxHp: number(Number.MIN_VALUE), status, fuelRemainingSec: finite, maxFuelSec: finite,
  doctrine: object({ roe: oneOf(['free', 'tight', 'hold']), emconRadar: boolean, emconSonar: boolean, emconJamming: boolean,
    autoEvade: boolean, engageOpportunityTargets: boolean, salvoSize: count, automaticFireRangeFraction: finite,
    minimumWeaponReserve: count, automaticTargetDomains: array(domain), minimumAutomaticThreat: threat }),
  countermeasures: object({ chaff: count, flares: count, acousticDecoys: count, cooldownUntil: finite }),
  airRefuelState: optional(object({ ...savedRoute, tankerId: id, phase: oneOf(['rendezvous', 'refueling']) })),
  evasionState: optional(object({ ...savedRoute, threatContactId: id, untilSimTime: finite, resumeStatus: oneOf(['operational', 'engaged']) })),
  baffleClearState: optional(object({ savedHeading: finite, savedWaypoints: route, managedWaypointPosition: optional(coordinate),
    untilSimTime: finite, nextAtSimTime: finite })),
  aarFuelRemainingSec: finite, aarQueue: ids, deployableInventory: record(count), completedWithdrawalObjectiveIds: ids,
  mounts: array(object({ mountId: id, weaponId: id, weaponName: text, maxAmmo: count, currentAmmo: count,
    reloadTimeSec: finite, cooldownRemainingSec: finite, magazineReloadRemainingSec: optional(finite) })),
  magazineStores: optional(record(count)), oodaLocks: optional(record(finite)),
  weaponUsage: record(object({ expended: count, cooldownUntil: finite })),
  hangar: array(object({ slotId: id, squadronName: text, platformId: id, selectedLoadoutId: id, availableLoadoutIds: ids,
    readyAirframes: count, reserveAirframes: count, totalAirframes: count, launchCooldownSec: finite,
    cooldownRemainingSec: finite, turnaroundSec: finite, turnaroundSupplies: count,
    turnaroundQueue: array(object({ sortieId: id, previousLoadoutId: optional(id), readyAtSimTime: finite })),
    activeSortieIds: ids, nextSortieNumber: count })),
});

const contacts = entities({
  actualUnitId: id, observerSide: sides, targetSide: sides, domain, displayName: text, sidc,
  classification: oneOf(['unknown', 'classified', 'identified']), threatLevel: threat,
  estimatedPosition: coordinate, truePosition: coordinate, uncertaintyRadiusKm: finite, uncertaintyPolygon: optional(points),
  bearingObservations: optional(array(object({ sourceUnitId: id, origin: coordinate, bearingDeg: finite, errorDeg: finite, maxRangeKm: finite }))),
  heading: finite, speedKts: finite, altitudeM: finite, firstDetectedTime: finite, lastDetectedTime: finite,
  detectedBySources: array(text), sourceUnitIds: optional(ids), fireControlSourceIds: optional(ids),
});

const inFlight = entities({
  weaponId: id, name: text, side: sides, shooterId: id, shooterName: text, targetId: id,
  targetType: oneOf(['unit', 'missile', 'area']), position: coordinate, launchPosition: coordinate, trail: points,
  altitudeTrail: optional(array(finite)), altitudeM: finite, heading: finite, speedKts: finite,
  distanceRemainingKm: finite, maxRangeKm: finite, traveledKm: finite, basePk: finite, warheadDamage: finite,
  aimPosition: optional(coordinate), waypoints: optional(points),
});

export const checkBattleArchive = object({
  events: array(object({ id, tick: count, simTime: finite, side: oneOf(['RED', 'BLUE', 'NEUTRAL', 'SYSTEM']), title: text,
    kind: oneOf(['launch', 'hit', 'intercept', 'loss', 'sortie', 'recovery', 'turnaround', 'hangar_loss', 'miss']),
    unitId: optional(id), targetUnitId: optional(id), weaponId: optional(id), quantity: count,
    position: optional(coordinate), altitudeM: optional(finite) })),
  tracks: array(object({ tick: count, simTime: finite, unitId: id, side: sides, position: coordinate, altitudeM: finite, status })),
});

const arrayShape: Check = (value, path) => { if (!Array.isArray(value)) invalid(path, 'expected an array'); };
const objectShape = object({});
const { aar, ...coreFields } = {
  tick: number(0, 200_000, true), startTime: finite, simTime: finite, rngState: uint32,
  units, contacts, weaponsInFlight: inFlight,
  explosions: array(object({ id, position: coordinate, type: oneOf(['hit', 'destroy', 'intercept', 'miss', 'launch']),
    side: sides, label: text, createdAtSimTime: finite, radiusKm: finite })),
  missions: array(object({ assignedUnitIds: ids })),
  events: array(object({ hasFired: optional(boolean), fireCount: optional(count), matchedUnitIds: optional(ids) })),
  pendingSortieOrders: optional(array(object({ orderId: id, eventId: id, carrierUnitId: id, hangarSlotId: id,
    loadoutId: optional(id), assignedMissionId: optional(id), earliestLaunchTime: finite, attempts: count,
    status: oneOf(['pending', 'failed']), failureReason: optional(text) }))),
  pendingTotStrikeOrders: optional(array(object({ orderId: id, shooterId: id, contactId: id, weaponId: id, salvoCount: count,
    launchAtSimTime: finite, plannedImpactSimTime: finite, doglegWaypoints: optional(points) }))),
  groups: arrayShape, objectives: arrayShape, referencePoints: arrayShape, environment: objectShape,
  score: object({ redLosses: count, blueLosses: count, redMissilesFired: count, blueMissilesFired: count,
    redInterceptions: count, blueInterceptions: count, redScore: finite, blueScore: finite, firedEventIds: ids, sortiesLaunched: count }),
  objectiveProgress: record(oneOf(['pending', 'achieved', 'failed'])), objectiveHoldProgress: optional(record(number(0))),
  exerciseTask: optional(objectShape),  // Scenario-specific evidence checked by the recording reader.
  battleResult: optional(object({ endedAt: finite, reason: oneOf(['time_limit', 'critical_objective']),
    outcomes: object({ RED: outcomes, BLUE: outcomes }) })),
  creditedDamage: record(finite), detectedMissileIds: ids, aar: checkBattleArchive,
  playerSide: sides, playMode: oneOf(['command', 'sandbox']), commandSequence: count,
} satisfies Record<keyof BattleSnapshot, Check>;

const fullFields = { ...coreFields, aar };
const compactFields = { ...coreFields, history: objectShape };
const checkFull = object(fullFields);
const checkCompact = object(compactFields);

export function checkBattleSnapshot(value: unknown, path: string, scenario: ScenarioDefinition, compact: false): asserts value is BattleSnapshot;
export function checkBattleSnapshot(value: unknown, path: string, scenario: ScenarioDefinition, compact: boolean): asserts value is BattleSnapshot | CompactKeyframe;
export function checkBattleSnapshot(value: unknown, path: string, scenario: ScenarioDefinition, compact: boolean) {
  if (!isRecord(value)) invalid(path, 'expected a snapshot object');
  const allowed = compact ? compactFields : fullFields;
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(allowed, key)) invalid(`${path}.${key}`, 'unexpected snapshot field');
  }
  (compact ? checkCompact : checkFull)(value, path);
  if (value.startTime !== Date.parse(scenario.startTimeIso)) invalid(`${path}.startTime`, 'does not match the scenario opening');
  if (value.simTime !== (value.startTime as number) + (value.tick as number) * FIXED_DT_SEC * 1000) {
    invalid(`${path}.simTime`, 'does not match the snapshot tick');
  }

  // Reuse the scenario's data schemas for shared definitions, without applying
  // opening-only cross-references/domain rules to runtime state.
  const { groups, objectives, referencePoints, environment, missions, events } = value;
  try {
    assertScenarioShape({ ...scenario, units: [], customCatalogOverlay: undefined,
      groups, objectives, referencePoints, environment, missions, events });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('scenario.')) {
      throw new Error(`${path}${error.message.slice('scenario'.length)}`);
    }
    throw error;
  }
}

export function copyCheckedBattleSnapshot(snapshot: BattleSnapshot): BattleSnapshot {
  // Copy only approved fields; never merge a raw file object into the store.
  const fields = Object.fromEntries(Object.entries(snapshot).filter(([key]) => Object.hasOwn(fullFields, key)));
  return structuredClone({
    ...fields,
    pendingSortieOrders: snapshot.pendingSortieOrders ?? [],
    pendingTotStrikeOrders: snapshot.pendingTotStrikeOrders ?? [],
    objectiveHoldProgress: snapshot.objectiveHoldProgress ?? {},
  }) as BattleSnapshot;
}
