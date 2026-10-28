import type { EquipmentCatalog, InitialUnitPlacement, ScenarioDefinition } from '../types/wargame';
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
  const placements: InitialUnitPlacement[] = [
    ...scenario.units,
    ...(scenario.events ?? []).flatMap((event) => event.actions.flatMap((action) =>
      action.type === 'SPAWN_REINFORCEMENTS' ? action.units : []
    )),
  ];
  const units = index(placements, 'scenario units and reinforcements');

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
