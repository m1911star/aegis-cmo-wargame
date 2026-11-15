import * as turf from '../engine/turfGeo';
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
import { evaluateWeatherModifiers } from '../engine/environment';
import { evaluateFireControl, weaponLaunchRangeKm, weaponNoEscapeRangeKm } from '../engine/fireControl';
import { calculateRadarHorizonKm } from '../engine/geometry';
import { observeMissile } from '../engine/sensors';
import { getUnitCapabilities, isActiveUnit } from '../engine/unitCapabilities';
import { resolveUnitConfiguration } from '../engine/unitConfiguration';
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
  selectedUnitIds?: readonly string[];
  selectedContactId: string | null;
  hoveredContactId?: string | null;
  pendingWeaponIdForEngage?: string | null;
  pendingStrikeWaypoints?: readonly [number, number][];
  mapLayers: ProjectionLayers;
  catalog: EquipmentCatalog;
  simTime: number;
  environment?: ScenarioEnvironment;
  objectives?: ScenarioObjective[];
};

export type TacticalProjection = {
  terrainRidges: GeoJSON.Feature[];
  weatherZones: GeoJSON.Feature[];
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
  fireControlLinks: GeoJSON.Feature[];
};

export function buildSensorEnvelopeFeature(
  center: [number, number],
  radiusKm: number,
  headingDeg: number,
  coverageArcDeg = 360,
  blindArcRearDeg = 0,
  steps = 56,
  properties: Record<string, unknown> = {}
): GeoJSON.Feature {
  if (coverageArcDeg >= 360 && blindArcRearDeg <= 0) {
    return turf.circle(center, radiusKm, { steps, units: 'kilometers', properties });
  }
  // Compute visible clockwise sweep [startOffset, endOffset] relative to headingDeg
  let startOffset = -180;
  let endOffset = 180;
  if (coverageArcDeg < 360) {
    startOffset = -coverageArcDeg * 0.5;
    endOffset = coverageArcDeg * 0.5;
  }
  if (blindArcRearDeg > 0) {
    const maxNonBlind = 180 - blindArcRearDeg * 0.5;
    startOffset = Math.max(startOffset, -maxNonBlind);
    endOffset = Math.min(endOffset, maxNonBlind);
  }
  const span = Math.max(10, endOffset - startOffset);
  const segs = Math.max(12, Math.round((span / 360) * steps));
  const ring: [number, number][] = [[...center]];
  for (let i = 0; i <= segs; i++) {
    const offset = startOffset + (span * i) / segs;
    const bearing = (headingDeg + offset + 360) % 360;
    const pt = turf.destination(center, radiusKm, bearing, { units: 'kilometers' })
      .geometry.coordinates as [number, number];
    ring.push(pt);
  }
  ring.push([...center]);
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
  };
}

export function projectTacticalState(input: TacticalProjectionInput): TacticalProjection {
  const {
    units, contacts, weaponsInFlight, explosions, missions, referencePoints,
    activePerspective, selectedUnitId, selectedUnitIds, selectedContactId, hoveredContactId,
    pendingWeaponIdForEngage, pendingStrikeWaypoints, mapLayers, catalog, simTime,
    environment, objectives,
  } = input;
  const selectedSet = new Set<string>(selectedUnitIds ?? (selectedUnitId ? [selectedUnitId] : []));
  if (selectedUnitId) selectedSet.add(selectedUnitId);

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

  const weatherZones: GeoJSON.Feature[] = (environment?.weatherZones ?? [])
    .filter((zone) => zone.areaPolygon.length >= 3)
    .map((zone) => ({
      type: 'Feature',
      properties: {
        id: zone.id,
        condition: zone.condition,
        label: `${zone.name} (${zone.condition === 'rain_storm' ? '暴雨锋面' : '海雾低能见'}${zone.seaStateOverride ? ` · ${zone.seaStateOverride}级海况` : ''})`,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[...zone.areaPolygon, zone.areaPolygon[0]]],
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
    const isSelected = selectedSet.has(unit.id);
    const spec = catalog.platforms[unit.platformId];
    if (!spec) continue;
    const configuration = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
    if ((mapLayers.showRadarRings || isSelected) && unit.doctrine.emconRadar && getUnitCapabilities(unit).radarFactor > 0) {
      for (const sensorId of configuration.sensorIds) {
        const sensor = catalog.sensors[sensorId];
        if (!sensor || (sensor.type !== 'radar_air_surface' && sensor.type !== 'radar_oth')) continue;
        envelopeFeatures.push(
          buildSensorEnvelopeFeature(
            unit.position,
            sensor.maxRangeKm * getUnitCapabilities(unit).radarFactor,
            unit.heading,
            sensor.coverageArcDeg,
            sensor.blindArcRearDeg,
            64,
            {
              ringKind: 'radar',
              side: unit.side,
              isSelected,
              isSector: (sensor.coverageArcDeg ?? 360) < 360,
              label: `${unit.callsign} 雷达包线 (${sensor.maxRangeKm}km${sensor.coverageArcDeg && sensor.coverageArcDeg < 360 ? ` · ${sensor.coverageArcDeg}°` : ''})`,
            }
          )
        );
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
      const preferredMount = isSelected && pendingWeaponIdForEngage
        ? unit.mounts.find((candidate) => candidate.weaponId === pendingWeaponIdForEngage && candidate.currentAmmo > 0)
        : undefined;
      const mount = preferredMount ?? [...unit.mounts].filter((candidate) => candidate.currentAmmo > 0)
        .sort((a, b) => (catalog.weapons[b.weaponId] ? weaponLaunchRangeKm(catalog.weapons[b.weaponId]) : 0) -
          (catalog.weapons[a.weaponId] ? weaponLaunchRangeKm(catalog.weapons[a.weaponId]) : 0))[0];
      const weapon = mount ? catalog.weapons[mount.weaponId] : undefined;
      if (weapon && (isSelected || unit.category === 'sam_battery' || unit.category === 'destroyer')) {
        const maxKm = weaponLaunchRangeKm(weapon);
        envelopeFeatures.push(turf.circle(unit.position, maxKm, {
          steps: 64, units: 'kilometers', properties: { ringKind: 'weapon', side: unit.side, isSelected,
            label: `${weapon.codeName} 最大射程 (${maxKm}km)` },
        }));
        if (isSelected) {
          const nezKm = weaponNoEscapeRangeKm(weapon);
          if (nezKm > 0 && nezKm < maxKm) {
            envelopeFeatures.push(turf.circle(unit.position, nezKm, {
              steps: 48, units: 'kilometers', properties: { ringKind: 'nez', side: unit.side, isSelected: true,
                label: `${weapon.codeName} NEZ不可逃逸区 (${nezKm}km)` },
            }));
          }
        }
      }
    }
    if ((mapLayers.showSonarRings || isSelected) && (unit.domain === 'subsurface' || unit.domain === 'surface')) {
      const seaAcousticFactor = environment
        ? evaluateWeatherModifiers(unit.position, unit.altitudeM, unit.position, unit.altitudeM, environment).passiveSonarFactor
        : 1;
      const sonarScale = getUnitCapabilities(unit).sonarFactor * seaAcousticFactor;
      for (const sensorId of configuration.sensorIds) {
        const sensor = catalog.sensors[sensorId];
        if (sensor?.type === 'sonar_passive' && sonarScale > 0) {
          envelopeFeatures.push(
            buildSensorEnvelopeFeature(
              unit.position,
              sensor.maxRangeKm * sonarScale,
              unit.heading,
              sensor.coverageArcDeg,
              sensor.blindArcRearDeg,
              48,
              {
                ringKind: 'sonar',
                side: unit.side,
                isSelected,
                hasBaffle: (sensor.blindArcRearDeg ?? 0) > 0,
              }
            )
          );
        }
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
      waypointLines.push({ type: 'Feature', properties: { unitId: unit.id, side: unit.side, isSelected: selectedSet.has(unit.id) },
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
      name: unit.name, side: unit.side, icon: `${unit.sidc}__${selectedSet.has(unit.id) ? 'SELECTED' : 'NORMAL'}`,
      subLabel: `${unit.callsign} [${altitude}]`, hpPct: Math.round(unit.hp / unit.maxHp * 100),
      emconStr: unit.doctrine.emconRadar ? 'RADAR:ON' : 'EMCON' }, geometry: { type: 'Point', coordinates: unit.position } };
  });
  const contactFeatures: GeoJSON.Feature[] = visibleContacts.map((contact) => {
    const bdaTag =
      contact.bdaStatus === 'kill_unconfirmed'
        ? ' [BDA?]'
        : contact.bdaStatus === 'damaged_suspected'
          ? ' [重创]'
          : '';
    return {
      type: 'Feature',
      properties: {
        id: contact.id,
        entityType: 'contact',
        name: contact.displayName,
        icon: `${contact.sidc}__${contact.id === selectedContactId ? 'SELECTED' : 'CONTACT'}`,
        subLabel: `${contact.displayName}${bdaTag} (${contact.uncertaintyKind === 'bearing_corridor' ? 'LOB' : `±${contact.uncertaintyRadiusKm}km`})`,
      },
      geometry: { type: 'Point', coordinates: contact.estimatedPosition },
    };
  });

  const referencePointFeatures: GeoJSON.Feature[] = mapLayers.showReferencePoints ? referencePoints
    .filter((point) => activePerspective === 'GOD' || point.side === activePerspective)
    .map((point) => ({ type: 'Feature', properties: { id: point.id, name: point.name,
      icon: point.side === 'RED' ? 'RP_MARKER_RED' : 'RP_MARKER_BLUE' }, geometry: { type: 'Point', coordinates: point.position } })) : [];
  const explosionFeatures: GeoJSON.Feature[] = explosions
    .filter((effect) => activePerspective === 'GOD' || effect.side === activePerspective)
    .map((effect) => ({ type: 'Feature', properties: { id: effect.id, type: effect.type, label: effect.label },
      geometry: { type: 'Point', coordinates: effect.position } }));

  const fireControlLinks: GeoJSON.Feature[] = [];
  // 1. Active midcourse datalink lines and dogleg planned legs for friendly missiles in flight
  for (const missile of Object.values(weaponsInFlight)) {
    if (activePerspective !== 'GOD' && missile.side !== activePerspective) continue;
    if (missile.waypoints && missile.waypoints.length > 0 && missile.aimPosition) {
      fireControlLinks.push({
        type: 'Feature',
        properties: { linkKind: 'aim_risky', id: `dogleg_missile_${missile.id}` },
        geometry: {
          type: 'LineString',
          coordinates: [missile.position, ...missile.waypoints, missile.aimPosition],
        },
      });
    }
    if (!missile.datalinkSupported || !missile.seekerState?.startsWith('midcourse')) continue;
    const shooter = units[missile.shooterId];
    if (shooter && isActiveUnit(shooter)) {
      fireControlLinks.push({
        type: 'Feature',
        properties: { linkKind: 'datalink', id: `dl_missile_${missile.id}` },
        geometry: { type: 'LineString', coordinates: [shooter.position, missile.position] },
      });
    }
  }

  // 2. Live fire-control aim vector, TOF label, and CEC datalink support lines for hovered/selected target contact
  const previewContactId = hoveredContactId ?? selectedContactId;
  const previewContact = previewContactId ? visibleContacts.find((c) => c.id === previewContactId) : undefined;
  const previewShooter = selectedUnitId ? visibleUnits.find((u) => u.id === selectedUnitId) : undefined;
  if (previewShooter && previewContact && previewShooter.side === previewContact.observerSide) {
    const candidateMounts = pendingWeaponIdForEngage
      ? previewShooter.mounts.filter((m) => m.weaponId === pendingWeaponIdForEngage)
      : previewShooter.mounts.filter((m) => catalog.weapons[m.weaponId]?.targetDomains.includes(previewContact.domain));
    const chosenMount = candidateMounts.find((m) => m.currentAmmo > 0) ?? candidateMounts[0] ?? previewShooter.mounts[0];
    const chosenWeapon = chosenMount ? catalog.weapons[chosenMount.weaponId] : undefined;
    if (chosenMount && chosenWeapon) {
      const solution = evaluateFireControl(
        previewShooter,
        previewContact,
        chosenMount,
        chosenWeapon,
        catalog,
        units,
        simTime,
        'manual',
        weaponsInFlight,
        pendingStrikeWaypoints
      );
      const linkKind =
        solution.status === 'executable'
          ? 'aim_executable'
          : solution.status === 'risky'
            ? 'aim_risky'
            : 'aim_blocked';
      const strikeCoords: [number, number][] = [
        previewShooter.position,
        ...(pendingStrikeWaypoints ?? []),
        previewContact.estimatedPosition,
      ];
      fireControlLinks.push({
        type: 'Feature',
        properties: { linkKind, id: `fc_aim_${previewShooter.id}_${previewContact.id}` },
        geometry: {
          type: 'LineString',
          coordinates: strikeCoords,
        },
      });
      const midPoint: [number, number] = [
        (previewShooter.position[0] + previewContact.estimatedPosition[0]) * 0.5,
        (previewShooter.position[1] + previewContact.estimatedPosition[1]) * 0.5,
      ];
      const zoneTag = solution.withinNez ? 'NEZ内' : 'Rmax区';
      fireControlLinks.push({
        type: 'Feature',
        properties: {
          id: `fc_lbl_${previewShooter.id}_${previewContact.id}`,
          label: `${chosenWeapon.codeName} · ${(solution.distanceKm ?? 0).toFixed(0)}km [${zoneTag}] · TOF ${solution.estimatedTofSec ?? 0}s`,
        },
        geometry: { type: 'Point', coordinates: midPoint },
      });
      for (const supportId of solution.supportSourceIds) {
        if (supportId === previewShooter.id) continue;
        const supportUnit = visibleUnits.find((u) => u.id === supportId);
        if (!supportUnit) continue;
        fireControlLinks.push({
          type: 'Feature',
          properties: { linkKind: 'datalink', id: `fc_cec_${supportUnit.id}_${previewContact.id}` },
          geometry: {
            type: 'LineString',
            coordinates: [supportUnit.position, previewContact.estimatedPosition],
          },
        });
      }
    }
  }

  return {
    terrainRidges,
    weatherZones,
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
    fireControlLinks,
  };
}
