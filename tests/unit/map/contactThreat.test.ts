import { expect, test } from 'bun:test';
import { getBearingDeg, getDistanceKm } from '../../../src/engine/geometry';
import { estimatedContactThreatRangeKm } from '../../../src/map/contactThreat';
import type { TacticalContact } from '../../../src/types/wargame';

const contact = (extra: Partial<TacticalContact> = {}): TacticalContact => ({
  id: 'RED_CONTACT_UNKNOWN',
  actualUnitId: 'hidden-a',
  observerSide: 'RED',
  targetSide: 'BLUE',
  domain: 'surface',
  classification: 'classified',
  displayName: 'Classified surface contact',
  sidc: 'SHSPCLDD----',
  estimatedPosition: [10, 20],
  truePosition: [99, 40],
  uncertaintyRadiusKm: 5,
  heading: 0,
  speedKts: 20,
  altitudeM: 0,
  firstDetectedTime: 0,
  lastDetectedTime: 0,
  detectedBySources: [],
  threatLevel: 'critical',
  ...extra,
});

test('contact threat envelopes depend only on observed classification, never hidden identity or truth position', () => {
  const first = contact();
  const second = contact({ actualUnitId: 'different-hidden-platform', truePosition: [-100, -40] });
  expect(estimatedContactThreatRangeKm(first)).toBe(220);
  expect(estimatedContactThreatRangeKm(second)).toBe(220);
  expect(estimatedContactThreatRangeKm(contact({ classification: 'unknown' }))).toBe(0);
  expect(estimatedContactThreatRangeKm(contact({
    classification: 'identified', identifiedCategory: 'sam_battery', domain: 'land',
  }))).toBe(260);
});

test('ruler geometry reports great-circle distance and true bearing', () => {
  expect(getDistanceKm([0, 0], [1, 0])).toBeCloseTo(111.2, 0);
  expect(getBearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 6);
  expect(getBearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 6);
});
