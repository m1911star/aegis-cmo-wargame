import * as turf from '@turf/turf';
import type { Domain, ScenarioEnvironment } from '../types/wargame';
import { getDistanceKm } from './geometry';

export const EMPTY_ENVIRONMENT: ScenarioEnvironment = {
  landPolygons: [],
  acousticZones: [],
};

const EFFECTIVE_EARTH_RADIUS_KM = 8495; // 4/3 Earth radius standard refraction.

export function cloneEnvironment(environment?: ScenarioEnvironment): ScenarioEnvironment {
  return {
    landPolygons: (environment?.landPolygons ?? []).map((polygon) => ({
      ...polygon,
      areaPolygon: polygon.areaPolygon.map((point) => [...point] as [number, number]),
    })),
    acousticZones: (environment?.acousticZones ?? []).map((zone) => ({
      ...zone,
      areaPolygon: zone.areaPolygon.map((point) => [...point] as [number, number]),
    })),
  };
}

function polygonFeature(areaPolygon: [number, number][]) {
  return turf.polygon([[...areaPolygon, areaPolygon[0]]]);
}

export function isPointOnLand(position: [number, number], environment?: ScenarioEnvironment): boolean {
  return (environment?.landPolygons ?? []).some((land) =>
    turf.booleanPointInPolygon(position, polygonFeature(land.areaPolygon))
  );
}

export function isRouteAllowed(
  domain: Domain,
  from: [number, number],
  to: [number, number],
  environment?: ScenarioEnvironment
): boolean {
  const land = environment?.landPolygons ?? [];
  if (domain === 'air' || land.length === 0) return true;
  if (domain === 'land') {
    const midpoint = turf.midpoint(from, to).geometry.coordinates as [number, number];
    return [from, midpoint, to].every((position) => isPointOnLand(position, environment));
  }
  const route = turf.lineString([from, to]);
  return !land.some((polygon) =>
    turf.booleanIntersects(route, polygonFeature(polygon.areaPolygon)) ||
    turf.booleanPointInPolygon(to, polygonFeature(polygon.areaPolygon))
  );
}

export function hasRadarLineOfSight(
  observerPos: [number, number],
  observerAltM: number,
  observerAntennaM: number,
  targetPos: [number, number],
  targetAltM: number,
  environment?: ScenarioEnvironment
): boolean {
  const land = environment?.landPolygons;
  if (!land?.length) return true;
  if (observerAltM < 0 || targetAltM < 0) return true;
  const elevated = land.filter((polygon) => (polygon.elevationM ?? 0) > 0);
  if (!elevated.length) return true;

  const totalKm = getDistanceKm(observerPos, targetPos);
  if (totalKm <= 0.05) return true;
  const hObs = Math.max(0, observerAltM) + Math.max(0, observerAntennaM);
  const hTgt = Math.max(0, targetAltM);
  const ray = turf.lineString([observerPos, targetPos]);
  const samples = 16;

  for (const polygon of elevated) {
    const feature = polygonFeature(polygon.areaPolygon);
    // Do not self-occlude a coastal/island unit standing inside its own simplified polygon.
    if (
      turf.booleanPointInPolygon(observerPos, feature) ||
      turf.booleanPointInPolygon(targetPos, feature)
    ) {
      continue;
    }
    if (!turf.booleanIntersects(ray, feature)) continue;
    const terrainHeightM = polygon.elevationM ?? 0;
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const samplePos: [number, number] = [
        observerPos[0] + (targetPos[0] - observerPos[0]) * t,
        observerPos[1] + (targetPos[1] - observerPos[1]) * t,
      ];
      if (!turf.booleanPointInPolygon(samplePos, feature)) continue;
      const d1 = t * totalKm;
      const d2 = (1 - t) * totalKm;
      const earthBulgeM = ((d1 * d2) / (2 * EFFECTIVE_EARTH_RADIUS_KM)) * 1000;
      const rayAltM = hObs * (1 - t) + hTgt * t - earthBulgeM;
      if (terrainHeightM > rayAltM) return false;
    }
  }

  return true;
}

export function acousticRangeFactor(
  observer: [number, number],
  target: [number, number],
  environment?: ScenarioEnvironment
): number {
  if (!environment?.acousticZones.length) return 1;
  const midpoint = turf.midpoint(observer, target).geometry.coordinates as [number, number];
  return environment.acousticZones.find((zone) =>
    turf.booleanPointInPolygon(midpoint, polygonFeature(zone.areaPolygon))
  )?.sonarRangeFactor ?? 1;
}
