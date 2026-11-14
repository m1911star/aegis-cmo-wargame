import { expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../../src/db';
import { instantiateScenarioUnits, SCENARIO_EAST_SEA_THUNDER as east } from '../../../src/scenarios/builtinScenarios';
import { projectTacticalState } from '../../../src/map/tacticalProjection';
import type { TacticalContact } from '../../../src/types/wargame';

test('pure tactical projection builds every GeoJSON family without exposing hidden unit IDs', () => {
  const units = instantiateScenarioUnits(east);
  const target = units.blue_ddg125_lucas;
  const awacsId = Object.values(units).find((u) => u.platformId === 'kj500_awacs')!.id;
  const contact: TacticalContact = {
    id: 'RED_CONTACT_blue_ddg125_lucas', actualUnitId: target.id, observerSide: 'RED', targetSide: 'BLUE',
    domain: 'surface', classification: 'identified', identifiedCategory: 'destroyer', displayName: 'Identified destroyer',
    sidc: target.sidc, estimatedPosition: [...target.position], truePosition: [...target.position],
    uncertaintyRadiusKm: 3, uncertaintyKind: 'circle',
    uncertaintyPolygon: [[125.4, 26], [125.5, 26], [125.5, 26.1], [125.4, 26.1], [125.4, 26]],
    heading: target.heading, speedKts: target.speedKts, altitudeM: target.altitudeM,
    firstDetectedTime: 0, lastDetectedTime: 0,
    detectedBySources: ['SKYEYE-01'],
    sourceUnitIds: [awacsId],
    fireControlSourceIds: [awacsId],
    threatLevel: 'critical',
  };
  const input = {
    units,
    contacts: { [contact.id]: contact },
    weaponsInFlight: {},
    explosions: [],
    missions: east.missions.map((mission) => ({ ...mission, assignedUnitIds: [] })),
    referencePoints: east.referencePoints,
    activePerspective: 'RED' as const,
    selectedUnitId: 'red_j20_alpha',
    selectedContactId: contact.id,
    mapLayers: { showRadarRings: true, showWeaponRings: true, showSonarRings: true,
      showWaypoints: true, showMissions: true, showAouPolygons: true, showReferencePoints: true },
    catalog,
    simTime: 0,
  };
  const snapshot = structuredClone(input);
  const projection = projectTacticalState({
    ...input,
    environment: east.environment,
    objectives: east.objectives,
  });
  expect(input).toEqual(snapshot);
  expect(projection.terrainRidges.length).toBeGreaterThan(0);
  expect(projection.controlZones).toHaveLength(0);
  expect(projection.missions.length).toBeGreaterThan(0);
  expect(projection.envelopes.some((feature) => feature.properties?.ringKind === 'threat')).toBe(true);
  expect(projection.envelopes.some((feature) => feature.properties?.ringKind === 'nez')).toBe(true);
  expect(projection.fireControlLinks.some((feature) => String(feature.properties?.linkKind).startsWith('aim_'))).toBe(true);
  expect(projection.fireControlLinks.some((feature) => feature.properties?.linkKind === 'datalink')).toBe(true);
  expect(projection.fireControlLinks.some((feature) => String(feature.properties?.label ?? '').includes('TOF'))).toBe(true);
  expect(projection.aou).toHaveLength(1);
  expect(projection.waypointLines.length).toBeGreaterThan(0);
  expect(projection.units.some((feature) => feature.properties?.entityType === 'unit')).toBe(true);
  const contactFeature = projection.units.find((feature) => feature.properties?.entityType === 'contact');
  expect(contactFeature?.properties).not.toHaveProperty('actualUnitId');
  expect(projection.referencePoints.length).toBeGreaterThan(0);

  const jointProjection = projectTacticalState({
    ...input,
    objectives: [
      {
        id: 'beach_zone',
        side: 'RED',
        title: 'Beachhead',
        type: 'control_area',
        unitIds: [],
        areaPolygon: [[120.3, 23.5], [120.8, 23.5], [120.8, 23.9], [120.3, 23.9]],
        required: true,
        points: 200,
      },
    ],
  });
  expect(jointProjection.controlZones).toHaveLength(1);

  const multiSelectProjection = projectTacticalState({
    ...input,
    selectedUnitIds: ['red_j20_alpha', 'red_055_nanchang'],
  });
  const selectedIcons = multiSelectProjection.units
    .filter((f) => f.properties?.entityType === 'unit' && String(f.properties?.icon).endsWith('__SELECTED'))
    .map((f) => f.properties?.id)
    .sort();
  expect(selectedIcons).toEqual(['red_055_nanchang', 'red_j20_alpha']);
});
