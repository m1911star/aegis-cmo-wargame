import type { MissionDefinition, RuntimeUnit, TacticalMission } from '../types/wargame';
import { isActiveUnit } from './unitCapabilities';

export function deriveMissionAssignments(
  missions: readonly MissionDefinition[],
  units: Record<string, RuntimeUnit>
): TacticalMission[] {
  const assigned = new Map<string, string[]>();
  for (const unit of Object.values(units)) {
    if (!unit.assignedMissionId || !isActiveUnit(unit)) continue;
    const ids = assigned.get(unit.assignedMissionId) ?? [];
    ids.push(unit.id);
    assigned.set(unit.assignedMissionId, ids);
  }
  return missions.map((mission) => ({
    ...mission,
    areaPolygon: mission.areaPolygon.map((p) => [...p] as [number, number]),
    doctrineOverride: mission.doctrineOverride ? {
      ...mission.doctrineOverride,
      automaticTargetDomains: mission.doctrineOverride.automaticTargetDomains
        ? [...mission.doctrineOverride.automaticTargetDomains] : undefined,
    } : undefined,
    assignedUnitIds: assigned.get(mission.id) ?? [],
  }));
}
