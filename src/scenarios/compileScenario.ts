import * as turf from '@turf/turf';
import type { EquipmentCatalog, InitialUnitPlacement, RouteLeg, ScenarioDefinition } from '../types/wargame';
import { cloneEnvironment, isPointOnLand, isRouteAllowed } from '../engine/environment';
import { resolveEquipmentCatalog, validateCatalogIntegrity } from '../db';
import { resolveUnitConfiguration } from '../db/unitConfiguration';
import { assertScenarioShape } from '../validation/wargameSchemas';
import { invalid } from '../validation/schema';

export function compileScenario(
  input: unknown,
  catalogOverride?: EquipmentCatalog
): { scenario: ScenarioDefinition; catalog: EquipmentCatalog } {
  assertScenarioShape(input);
  const catalog = catalogOverride ?? resolveEquipmentCatalog(input.customCatalogOverlay);
  const integrity = validateCatalogIntegrity(catalog);
  if (!integrity.valid) invalid('catalog', integrity.errors.join('; '));
  if (!Number.isFinite(Date.parse(input.startTimeIso))) invalid('scenario.startTimeIso', 'invalid date');

  // Normalize a copy: imported definitions and shared built-ins remain immutable.
  const scenario = structuredClone(input);
  const index = <T extends { id: string }>(items: T[], path: string) => {
    const result = new Map<string, T>();
    for (const item of items) {
      if (result.has(item.id)) invalid(path, `duplicate id ${item.id}`);
      result.set(item.id, item);
    }
    return result;
  };
  const groups = index(scenario.groups, 'scenario.groups');
  const missions = index(scenario.missions, 'scenario.missions');
  index(scenario.referencePoints, 'scenario.referencePoints');
  index(scenario.events ?? [], 'scenario.events');
  scenario.environment = cloneEnvironment(scenario.environment);
  index(scenario.environment.landPolygons, 'scenario.environment.landPolygons');
  index(scenario.environment.acousticZones, 'scenario.environment.acousticZones');
  for (const polygon of [...scenario.environment.landPolygons, ...scenario.environment.acousticZones]) {
    const feature = turf.polygon([[...polygon.areaPolygon, polygon.areaPolygon[0]]]);
    if (turf.area(feature) <= 1 || turf.kinks(feature).features.length > 0) {
      invalid(`scenario.environment.${polygon.id}`, 'environment polygon must be non-degenerate and non-self-intersecting');
    }
  }
  const placements: InitialUnitPlacement[] = [
    ...scenario.units,
    ...(scenario.events ?? []).flatMap((event) => event.actions.flatMap((action) =>
      action.type === 'SPAWN_REINFORCEMENTS' ? action.units : []
    )),
  ];
  const units = index(placements, 'scenario units and reinforcements');
  index(scenario.objectives ?? [], 'scenario.objectives');
  if (scenario.objectives?.length && !scenario.victoryConditions) invalid('scenario.objectives', 'objectives require a time limit');
  for (const objective of scenario.objectives ?? []) {
    if (objective.holdDurationSec !== undefined && objective.type !== 'control_area') {
      invalid(`objective.${objective.id}`, 'holdDurationSec is only valid on control_area objectives');
    }
    if (objective.type === 'control_area') {
      if (!objective.areaPolygon || objective.areaPolygon.length < 3) {
        invalid(`objective.${objective.id}`, 'control_area objectives require at least 3 polygon vertices');
      } else {
        const feature = turf.polygon([[...objective.areaPolygon, objective.areaPolygon[0]]]);
        if (turf.area(feature) <= 1 || turf.kinks(feature).features.length > 0) {
          invalid(`objective.${objective.id}`, 'control_area polygon must be non-degenerate and non-self-intersecting');
        }
      }
    } else if (objective.unitIds.length === 0) {
      invalid(`objective.${objective.id}`, 'objective requires at least one unit target');
    }
    if (new Set(objective.unitIds).size !== objective.unitIds.length) invalid(`objective.${objective.id}`, 'duplicate target');
    for (const target of objective.unitIds) {
      const placement = units.get(target);
      if (!placement) invalid(`objective.${objective.id}`, `unknown unit ${target}`);
      if (objective.type === 'withdraw' && placement.side !== objective.side) {
        invalid(`objective.${objective.id}`, 'withdraw targets must belong to the objective side');
      }
      const domain = catalog.platforms[placement.platformId]?.domain;
      if (objective.type === 'withdraw' && objective.withdrawUnitDomains && domain &&
          !objective.withdrawUnitDomains.includes(domain)) {
        invalid(`objective.${objective.id}`, `withdraw target ${target} has a disallowed domain`);
      }
    }
    if (objective.withdrawAreaPolygon && objective.type !== 'withdraw') {
      invalid(`objective.${objective.id}`, 'withdrawAreaPolygon only applies to withdraw goals');
    }
    if (objective.withdrawUnitDomains && objective.type !== 'withdraw') {
      invalid(`objective.${objective.id}`, 'withdrawUnitDomains only applies to withdraw goals');
    }
    if (objective.withdrawUnitDomains && new Set(objective.withdrawUnitDomains).size !== objective.withdrawUnitDomains.length) {
      invalid(`objective.${objective.id}`, 'duplicate withdraw domain');
    }
    if (objective.withdrawAreaPolygon) {
      const feature = turf.polygon([[...objective.withdrawAreaPolygon, objective.withdrawAreaPolygon[0]]]);
      if (turf.area(feature) <= 1 || turf.kinks(feature).features.length > 0) {
        invalid(`objective.${objective.id}`, 'withdraw area must be non-degenerate and non-self-intersecting');
      }
    }
    if (objective.criticalFailure && objective.type !== 'preserve') invalid(`objective.${objective.id}`, 'immediate failure requires an explicit preservation objective');
    if (objective.preserveCapability && objective.type !== 'preserve') invalid(`objective.${objective.id}`, 'preserveCapability only applies to preservation goals');
  }

  for (const mission of scenario.missions) {
    if (mission.type === 'escort') {
      const escortTarget = mission.escortUnitId ? units.get(mission.escortUnitId) : undefined;
      if (!escortTarget || escortTarget.side !== mission.side) {
        invalid(`mission.${mission.id}`, 'escort missions require a same-side escortUnitId');
      }
    } else if (mission.escortUnitId) {
      invalid(`mission.${mission.id}`, 'escortUnitId only applies to escort missions');
    }
  }

  // Legacy mission-side lists are migrated once; unit-side assignments are canonical.
  for (const mission of scenario.missions) {
    const ids = mission.assignedUnitIds ?? [];
    if (new Set(ids).size !== ids.length) invalid(`mission.${mission.id}`, 'duplicate assigned unit');
    for (const unitId of ids) {
      const placement = units.get(unitId);
      if (!placement) invalid(`mission.${mission.id}`, `unknown unit ${unitId}`);
      if (placement.assignedMissionId && placement.assignedMissionId !== mission.id) {
        invalid(`unit.${unitId}`, 'conflicting mission assignments');
      }
      placement.assignedMissionId = mission.id;
    }
    delete mission.assignedUnitIds;
  }

  for (const placement of placements) {
    const path = `unit.${placement.id}`;
    const group = groups.get(placement.parentGroupId);
    if (!group || group.side !== placement.side) invalid(path, 'unknown group or group-side mismatch');
    let configuration;
    try {
      configuration = resolveUnitConfiguration(catalog, placement.platformId, placement.loadoutId);
    } catch (error) {
      invalid(path, error instanceof Error ? error.message : 'invalid equipment configuration');
    }
    placement.waypoints = placement.waypoints?.map((waypoint, index): RouteLeg => {
      const leg: RouteLeg = Array.isArray(waypoint)
        ? { position: [...waypoint] as [number, number] }
        : { ...waypoint, position: [...waypoint.position] as [number, number] };
      if (leg.speedKts !== undefined && leg.speedKts > configuration.maxSpeedKts) {
        invalid(`${path}.waypoints[${index}].speedKts`, 'exceeds the configured platform limit');
      }
      if (leg.altitudeM !== undefined &&
          (leg.altitudeM < configuration.platform.minAltitudeM || leg.altitudeM > configuration.platform.maxAltitudeM)) {
        invalid(`${path}.waypoints[${index}].altitudeM`, 'outside platform limits');
      }
      return leg;
    });
    const startsOnLand = isPointOnLand(placement.position, scenario.environment);
    if ((configuration.platform.domain === 'surface' || configuration.platform.domain === 'subsurface') && startsOnLand ||
        configuration.platform.domain === 'land' && scenario.environment.landPolygons.length > 0 && !startsOnLand) {
      invalid(`${path}.position`, 'outside the configured domain environment');
    }
    let routeStart = placement.position;
    for (const [index, leg] of (placement.waypoints ?? []).entries()) {
      if (Array.isArray(leg) || !isRouteAllowed(configuration.platform.domain, routeStart, leg.position, scenario.environment)) {
        invalid(`${path}.waypoints[${index}]`, 'route crosses the configured land/sea boundary');
      }
      routeStart = leg.position;
    }
    if (placement.speedKts !== undefined && placement.speedKts > configuration.maxSpeedKts) {
      invalid(`${path}.speedKts`, 'exceeds the configured platform limit');
    }
    if (placement.altitudeM !== undefined && (placement.altitudeM < configuration.platform.minAltitudeM || placement.altitudeM > configuration.platform.maxAltitudeM)) {
      invalid(`${path}.altitudeM`, 'outside platform limits');
    }
    if (placement.assignedMissionId) {
      const mission = missions.get(placement.assignedMissionId);
      if (!mission || mission.side !== placement.side) invalid(path, 'unknown mission or mission-side mismatch');
    }
  }

  for (const event of scenario.events ?? []) {
    const path = `event.${event.id}`;
    if (event.repeatIntervalSec !== undefined && (!event.repeatable || event.trigger.type !== 'TIME_ELAPSED')) {
      invalid(path, 'repeatIntervalSec is only supported for repeatable time triggers');
    }
    if (event.repeatable && event.trigger.type === 'TIME_ELAPSED' && event.repeatIntervalSec === undefined) {
      invalid(path, 'repeatable time triggers require repeatIntervalSec');
    }
    const trigger = event.trigger;
    const targetId = trigger.type === 'UNIT_DESTROYED' ? trigger.unitId
      : trigger.type === 'UNIT_DETECTED' ? trigger.targetUnitId : undefined;
    if (targetId && !units.has(targetId)) invalid(path, `unknown trigger unit ${targetId}`);
    for (const action of event.actions) {
      if (action.type === 'ACTIVATE_MISSION' && !missions.has(action.missionId)) invalid(path, `unknown mission ${action.missionId}`);
      if (action.type === 'UPDATE_SIDE_DOCTRINE' && action.groupId) {
        const group = groups.get(action.groupId);
        if (!group || group.side !== action.side) invalid(path, 'unknown doctrine group or side mismatch');
      }
      if (action.type === 'LAUNCH_SORTIE') {
        const carrier = units.get(action.carrierUnitId);
        const slot = carrier ? catalog.platforms[carrier.platformId]?.hangarSlots?.find((candidate) => candidate.slotId === action.hangarSlotId) : undefined;
        if (!carrier || !slot) invalid(path, 'unknown carrier or hangar slot');
        if (action.loadoutId && !slot.availableLoadoutIds.includes(action.loadoutId)) invalid(path, 'unavailable sortie loadout');
        if (action.assignedMissionId) {
          const mission = missions.get(action.assignedMissionId);
          if (!mission || mission.side !== carrier.side) invalid(path, 'unknown sortie mission or side mismatch');
        }
      }
      if (action.type === 'ASSIGN_MISSION') {
        if (action.side === 'NEUTRAL') invalid(path, 'neutral side cannot receive missions');
        const targetUnit = action.unitId ? units.get(action.unitId) : undefined;
        const targetGroup = action.groupId ? groups.get(action.groupId) : undefined;
        if (action.unitId && (!targetUnit || targetUnit.side !== action.side)) invalid(path, 'unknown assignment unit or side mismatch');
        if (action.groupId && (!targetGroup || targetGroup.side !== action.side)) invalid(path, 'unknown assignment group or side mismatch');
        if (action.missionId) {
          const mission = missions.get(action.missionId);
          if (!mission || mission.side !== action.side) invalid(path, 'unknown assigned mission or side mismatch');
        }
      }
      if (action.type === 'TOGGLE_SIDE_EMCON' || action.type === 'COORDINATE_ATTACK') {
        if (action.side === 'NEUTRAL') invalid(path, 'neutral side cannot receive tactical reactions');
        if (action.groupId) {
          const group = groups.get(action.groupId);
          if (!group || group.side !== action.side) invalid(path, 'unknown reaction group or side mismatch');
        }
      }
      if (action.type === 'AWARD_SCORE' && action.side === 'NEUTRAL') invalid(path, 'neutral side has no score ledger');
    }
  }
  // A definition never persists the event runner's progress, including legacy hasFired.
  scenario.events = scenario.events?.map((event) => ({
    id: event.id, name: event.name, description: event.description,
    repeatable: event.repeatable, repeatIntervalSec: event.repeatIntervalSec,
    trigger: event.trigger, actions: event.actions,
  }));
  const victory = scenario.victoryConditions;
  if (victory && victory.tacticalVictoryThreshold > victory.decisiveVictoryThreshold) invalid('victoryConditions', 'tactical threshold exceeds decisive threshold');
  for (const bonus of victory?.keyTargetBonuses ?? []) {
    if (bonus.unitId && !units.has(bonus.unitId)) invalid('victoryConditions', `unknown unit ${bonus.unitId}`);
  }
  return { scenario, catalog };
}
