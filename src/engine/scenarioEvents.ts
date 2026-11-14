import { booleanPointInPolygon, polygon } from '@turf/turf';
import type { RuntimeScenarioEvent, RuntimeUnit, TacticalContact } from '../types/wargame';

const CLASSIFICATION_RANK = { unknown: 0, classified: 1, identified: 2 } as const;

export function getEventOccurrences(
  event: RuntimeScenarioEvent,
  units: Record<string, RuntimeUnit>,
  contacts: Record<string, TacticalContact>,
  elapsedSec: number
): number {
  const trigger = event.trigger;
  if (trigger.type === 'TIME_ELAPSED') {
    if (elapsedSec < trigger.elapsedSec) return 0;
    const interval = event.repeatable ? event.repeatIntervalSec : undefined;
    const due = interval && interval > 0
      ? Math.floor((elapsedSec - trigger.elapsedSec) / interval) + 1
      : 1;
    return Math.max(0, due - (event.fireCount ?? (event.hasFired ? 1 : 0)));
  }

  let matches: string[];
  if (trigger.type === 'UNIT_DESTROYED') {
    matches = Object.values(units).filter((unit) =>
      (unit.hp <= 0 || unit.status === 'destroyed') &&
      (!trigger.unitId || trigger.unitId === unit.id) &&
      (!trigger.targetSide || trigger.targetSide === unit.side) &&
      (!trigger.targetCategory || trigger.targetCategory === unit.category)
    ).map((unit) => unit.id);
  } else if (trigger.type === 'UNIT_DETECTED') {
    const minimumRank = CLASSIFICATION_RANK[trigger.minimumClassification ?? 'unknown'];
    matches = Object.values(contacts).filter((contact) =>
      contact.observerSide === trigger.observerSide &&
      CLASSIFICATION_RANK[contact.classification] >= minimumRank &&
      (!trigger.targetUnitId || trigger.targetUnitId === contact.actualUnitId) &&
      (!trigger.targetCategory || trigger.targetCategory === contact.identifiedCategory) &&
      (!trigger.targetDomain || trigger.targetDomain === contact.domain)
    ).map((contact) => contact.actualUnitId);
  } else {
    const area = polygon([[...trigger.areaPolygon, trigger.areaPolygon[0]]]);
    matches = Object.values(units).filter((unit) =>
      unit.hp > 0 && unit.status !== 'destroyed' && unit.side === trigger.side &&
      (!trigger.unitCategory || trigger.unitCategory === unit.category) &&
      booleanPointInPolygon(unit.position, area)
    ).map((unit) => unit.id);
  }
  const previous = new Set(event.matchedUnitIds ?? []);
  event.matchedUnitIds = [...new Set(matches)];
  return event.repeatable
    ? event.matchedUnitIds.filter((id) => !previous.has(id)).length
    : Number(matches.length > 0 && !event.hasFired);
}
