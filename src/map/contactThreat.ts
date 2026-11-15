import type { TacticalContact, UnitCategory } from '../types/wargame';

const IDENTIFIED_CATEGORY_RANGE_KM: Partial<Record<UnitCategory, number>> = {
  fighter: 165,
  stealth_fighter: 220,
  ew_aircraft: 180,
  awacs: 0,
  bomber: 400,
  mpa_uav: 80,
  carrier: 120,
  amphibious: 60,
  destroyer: 250,
  frigate: 180,
  ssn: 50,
  sam_battery: 260,
  asm_battery: 400,
  ground_force: 45,
  airbase: 220,
  radar_site: 0,
  sonobuoy: 0,
};

/** Estimated envelope from observed classification only; never accepts a runtime unit or catalog. */
export function estimatedContactThreatRangeKm(contact: TacticalContact): number {
  if (contact.classification === 'unknown') return 0;
  if (contact.classification === 'identified' && contact.identifiedCategory) {
    return IDENTIFIED_CATEGORY_RANGE_KM[contact.identifiedCategory] ?? 0;
  }
  if (contact.domain === 'air') return contact.threatLevel === 'critical' ? 200 : 140;
  if (contact.domain === 'surface') return contact.threatLevel === 'critical' ? 220 : 150;
  if (contact.domain === 'subsurface') return 45;
  return contact.threatLevel === 'critical' ? 180 : 120;
}
