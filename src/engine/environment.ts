import * as turf from '@turf/turf';
import type { Domain, ScenarioEnvironment } from '../types/wargame';

export const EMPTY_ENVIRONMENT: ScenarioEnvironment = {
  landPolygons: [],
  acousticZones: [],
};

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
