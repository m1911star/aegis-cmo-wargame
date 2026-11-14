import * as turf from '@turf/turf';
import type {
  ActivePerspective,
  EquipmentCatalog,
  ReferencePoint,
  RuntimeUnit,
  ScenarioEnvironment,
  ScenarioObjective,
  TacticalContact,
  TacticalExplosionEffect,
  TacticalMission,
  WeaponInFlight,
} from '../types/wargame';
import { resolveUnitConfiguration } from '../db/unitConfiguration';
import { weaponLaunchRangeKm } from '../engine/fireControl';
import { calculateRadarHorizonKm } from '../engine/geometry';
import { observeMissile } from '../engine/sensors';
import { getUnitCapabilities, isActiveUnit } from '../engine/unitCapabilities';
import { estimatedContactThreatRangeKm } from './contactThreat';

export type ProjectionLayers = {
  showRadarRings: boolean;
  showWeaponRings: boolean;
  showSonarRings: boolean;
  showWaypoints: boolean;
  showMissions: boolean;
  showAouPolygons: boolean;
  showReferencePoints: boolean;
};

export type TacticalProjectionInput = {
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  explosions: TacticalExplosionEffect[];
  missions: TacticalMission[];
  referencePoints: ReferencePoint[];
  activePerspective: ActivePerspective;
  selectedUnitId: string | null;
  selectedContactId: string | null;
  mapLayers: ProjectionLayers;
  catalog: EquipmentCatalog;
  simTime: number;
  environment?: ScenarioEnvironment;
  objectives?: ScenarioObjective[];
};

export type TacticalProjection = {
  terrainRidges: GeoJSON.Feature[];
  controlZones: GeoJSON.Feature[];
  missions: GeoJSON.Feature[];
  envelopes: GeoJSON.Feature[];
  aou: GeoJSON.Feature[];
  waypointLines: GeoJSON.Feature[];
  waypointNodes: GeoJSON.Feature[];
  missilePoints: GeoJSON.Feature[];
  missileTrails: GeoJSON.Feature[];
  units: GeoJSON.Feature[];
  referencePoints: GeoJSON.Feature[];
  explosions: GeoJSON.Feature[];
};

export function projectTacticalState(input: TacticalProjectionInput): TacticalProjection {
  const {
    units, contacts, weaponsInFlight, explosions, missions, referencePoints,
    activePerspective, selectedUnitId, selectedContactId, mapLayers, catalog, simTime,
    environment, objectives,
  } = input;

  const terrainRidges: GeoJSON.Feature[] = (environment?.landPolygons ?? [])
    .filter((polygon) => (polygon.elevationM ?? 0) > 0 && polygon.areaPolygon.length >= 3)
    .map((polygon) => ({
      type: 'Feature',
      properties: {
        id: polygon.id,
        label: `${polygon.name} (${polygon.elevationM}m)`,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[...polygon.areaPolygon, polygon.areaPolygon[0]]],
      },
    }));

  const controlZones: GeoJSON.Feature[] = (objectives ?? [])
    .filter((objective) =>
      objective.type === 'control_area' &&
      objective.areaPolygon &&
      objective.areaPolygon.length >= 3 &&
      (activePerspective === 'GOD' || objective.side === activePerspective)
    )
    .map((objective) => ({
      type: 'Feature',
      properties: {
        id: objective.id,
        side: objective.side,
        label: `夺控区: ${objective.title}`,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[...objective.areaPolygon!, objective.areaPolygon![0]]],
      },
    }));
  const visibleUnits = Object.values(units).filter((unit) =>
    isActiveUnit(unit) && (activePerspective === 'GOD' || unit.side === activePerspective));
  const visibleContacts = activePerspective === 'GOD' ? [] : Object.values(contacts)
    .filter((contact) => contact.observerSide === activePerspective);

  const missionFeatures: GeoJSON.Feature[] = [];
  if (mapLayers.showMissions) for (const mission of missions) {
    if (activePerspective !== 'GOD' && mission.side !== activePerspective) continue;
    if (mission.areaPolygon.length < 3) continue;
    missionFeatures.push({
      type: 'Feature',
      properties: { id: mission.id, name: `${mission.name} [${mission.isActive ? 'ACTIVE' : 'STANDBY'}]`,
        side: mission.side, isActive: mission.isActive },
      geometry: { type: 'Polygon', coordinates: [[...mission.areaPolygon, mission.areaPolygon[0]]] },
    });
  }

  const envelopeFeatures: GeoJSON.Feature[] = [];
  for (const unit of visibleUnits) {
    const isSelected = unit.id === selectedUnitId;
    const spec = catalog.platforms[unit.platformId];
    if (!spec) continue;
    const configuration = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
    if ((mapLayers.showRadarRings || isSelected) && unit.doctrine.emconRadar && getUnitCapabilities(unit).radarFactor > 0) {
      for (const sensorId of configuration.sensorIds) {
        const sensor = catalog.sensors[sensorId];
        if (!sensor || (sensor.type !== 'radar_air_surface' && sensor.type !== 'radar_oth')) continue;
        envelopeFeatures.push(turf.circle(unit.position, sensor.maxRangeKm * getUnitCapabilities(unit).radarFactor, {
          steps: 64, units: 'kilometers', properties: { ringKind: 'radar', side: unit.side, isSelected,
            label: `${unit.callsign} 雷达包线 (${sensor.maxRangeKm}km)` },
        }));
        if (isSelected && unit.domain === 'surface') {
          const horizonKm = calculateRadarHorizonKm(unit.altitudeM, spec.radarAntennaHeightM, 12);
          envelopeFeatures.push(turf.circle(unit.position, horizonKm, {
            steps: 48, units: 'kilometers', properties: { ringKind: 'horizon', side: unit.side,
              isSelected: true, label: `掠海视距盲区界 (${horizonKm.toFixed(0)}km)` },
          }));
        }
      }
    }
    if (mapLayers.showWeaponRings || isSelected) {
      const mount = [...unit.mounts].filter((candidate) => candidate.currentAmmo > 0)
        .sort((a, b) => (catalog.weapons[b.weaponId] ? weaponLaunchRangeKm(catalog.weapons[b.weaponId]) : 0) -
          (catalog.weapons[a.weaponId] ? weaponLaunchRangeKm(catalog.weapons[a.weaponId]) : 0))[0];
      const weapon = mount ? catalog.weapons[mount.weaponId] : undefined;
      if (weapon && (isSelected || unit.category === 'sam_battery' || unit.category === 'destroyer')) {
        envelopeFeatures.push(turf.circle(unit.position, weaponLaunchRangeKm(weapon), {
          steps: 64, units: 'kilometers', properties: { ringKind: 'weapon', side: unit.side, isSelected,
            label: `${weapon.codeName} 发射包线 (${weaponLaunchRangeKm(weapon)}km)` },
        }));
      }
    }
    if ((mapLayers.showSonarRings || isSelected) && (unit.domain === 'subsurface' || unit.domain === 'surface')) {
      for (const sensorId of configuration.sensorIds) {
        const sensor = catalog.sensors[sensorId];
        if (sensor?.type === 'sonar_passive') envelopeFeatures.push(turf.circle(
          unit.position, sensor.maxRangeKm * getUnitCapabilities(unit).radarFactor,
          { steps: 48, units: 'kilometers', properties: { ringKind: 'sonar', side: unit.side, isSelected } }
        ));
      }
    }
  }
  const selectedContact = visibleContacts.find((contact) => contact.id === selectedContactId);
  if (selectedContact) {
    const rangeKm = estimatedContactThreatRangeKm(selectedContact);
    if (rangeKm > 0) envelopeFeatures.push(turf.circle(selectedContact.estimatedPosition, rangeKm, {
      steps: 64, units: 'kilometers', properties: { ringKind: 'threat', side: selectedContact.targetSide,
        isSelected: true, label: `基于已知分类的推测威胁圈 (${rangeKm}km)` },
    }));
  }

  const aouFeatures = mapLayers.showAouPolygons ? visibleContacts.flatMap<GeoJSON.Feature>((contact) =>
    contact.uncertaintyPolygon && contact.uncertaintyPolygon.length >= 4 ? [{
      type: 'Feature', properties: { id: contact.id, radiusKm: contact.uncertaintyRadiusKm,
        label: `AOU ${contact.uncertaintyRadiusKm}km` },
      geometry: { type: 'Polygon', coordinates: [contact.uncertaintyPolygon] },
    }] : []) : [];

  const waypointLines: GeoJSON.Feature[] = [];
  const waypointNodes: GeoJSON.Feature[] = [];
  if (mapLayers.showWaypoints) for (const unit of visibleUnits) {
    if (unit.waypoints.length) {
      waypointLines.push({ type: 'Feature', properties: { unitId: unit.id, side: unit.side, isSelected: unit.id === selectedUnitId },
        geometry: { type: 'LineString', coordinates: [unit.position, ...unit.waypoints.map((waypoint) => waypoint.position)] } });
      unit.waypoints.forEach((waypoint, index) => waypointNodes.push({
        type: 'Feature', properties: { unitId: unit.id,
          label: `WP-${index + 1}${waypoint.speedKts !== undefined ? ` · ${waypoint.speedKts}kt` : ''}${waypoint.altitudeM !== undefined ? ` · ${waypoint.altitudeM}m` : ''}`,
          side: unit.side }, geometry: { type: 'Point', coordinates: waypoint.position },
      }));
    }
    if (unit.speedKts > 5) {
      const tip = turf.destination(unit.position, Math.min(45, Math.max(12, unit.speedKts * 0.06)), unit.heading,
        { units: 'kilometers' });
      waypointLines.push({ type: 'Feature', properties: { unitId: unit.id, side: unit.side, isVector: true },
        geometry: { type: 'LineString', coordinates: [unit.position, tip.geometry.coordinates] } });
    }
  }

  const missilePoints: GeoJSON.Feature[] = [];
  const missileTrails: GeoJSON.Feature[] = [];
  for (const missile of Object.values(weaponsInFlight)) {
    const visible = activePerspective === 'GOD' || missile.side === activePerspective ||
      !!observeMissile(activePerspective, missile, units, catalog, simTime);
    if (!visible) continue;
    missilePoints.push({ type: 'Feature', properties: { id: missile.id,
      name: activePerspective === 'GOD' || missile.side === activePerspective ? missile.name : '来袭武器',
      side: missile.side, heading: missile.heading,
      icon: missile.targetType === 'missile' ? 'MISSILE_INT' : missile.side === 'RED' ? 'MISSILE_RED' : 'MISSILE_BLUE',
      speedMach: (missile.speedKts / 661).toFixed(1) }, geometry: { type: 'Point', coordinates: missile.position } });
    if (missile.trail.length >= 2 && (activePerspective === 'GOD' || missile.side === activePerspective)) {
      missileTrails.push({ type: 'Feature', properties: { id: missile.id, side: missile.side,
        isInterceptor: missile.targetType === 'missile' }, geometry: { type: 'LineString', coordinates: missile.trail } });
    }
  }

  const unitFeatures: GeoJSON.Feature[] = visibleUnits.map((unit) => {
    const altitude = unit.domain === 'air' ? `FL${Math.round(unit.altitudeM / 30.48).toString().padStart(3, '0')}`
      : unit.domain === 'subsurface' ? `${Math.round(unit.altitudeM)}m` : `${Math.round(unit.speedKts)}kt`;
    return { type: 'Feature', properties: { id: unit.id, entityType: 'unit', callsign: unit.callsign,
      name: unit.name, side: unit.side, icon: `${unit.sidc}__${unit.id === selectedUnitId ? 'SELECTED' : 'NORMAL'}`,
      subLabel: `${unit.callsign} [${altitude}]`, hpPct: Math.round(unit.hp / unit.maxHp * 100),
      emconStr: unit.doctrine.emconRadar ? 'RADAR:ON' : 'EMCON' }, geometry: { type: 'Point', coordinates: unit.position } };
  });
  const contactFeatures: GeoJSON.Feature[] = visibleContacts.map((contact) => ({
    type: 'Feature', properties: { id: contact.id, entityType: 'contact', name: contact.displayName,
      icon: `${contact.sidc}__${contact.id === selectedContactId ? 'SELECTED' : 'CONTACT'}`,
      subLabel: `${contact.displayName} (${contact.uncertaintyKind === 'bearing_corridor' ? 'LOB' : `±${contact.uncertaintyRadiusKm}km`})` },
    geometry: { type: 'Point', coordinates: contact.estimatedPosition },
  }));

  const referencePointFeatures: GeoJSON.Feature[] = mapLayers.showReferencePoints ? referencePoints
    .filter((point) => activePerspective === 'GOD' || point.side === activePerspective)
    .map((point) => ({ type: 'Feature', properties: { id: point.id, name: point.name,
      icon: point.side === 'RED' ? 'RP_MARKER_RED' : 'RP_MARKER_BLUE' }, geometry: { type: 'Point', coordinates: point.position } })) : [];
  const explosionFeatures: GeoJSON.Feature[] = explosions
    .filter((effect) => activePerspective === 'GOD' || effect.side === activePerspective)
    .map((effect) => ({ type: 'Feature', properties: { id: effect.id, type: effect.type, label: effect.label },
      geometry: { type: 'Point', coordinates: effect.position } }));

  return {
    terrainRidges,
    controlZones,
    missions: missionFeatures,
    envelopes: envelopeFeatures,
    aou: aouFeatures,
    waypointLines,
    waypointNodes,
    missilePoints,
    missileTrails,
    units: [...unitFeatures, ...contactFeatures],
    referencePoints: referencePointFeatures,
    explosions: explosionFeatures,
  };
}
