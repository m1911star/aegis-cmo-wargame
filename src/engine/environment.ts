import * as turf from '@turf/turf';
import type { Domain, ScenarioEnvironment, WeaponSpec } from '../types/wargame';
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
    if (!turf.booleanIntersects(ray, feature)) continue;

    const inPoly: boolean[] = new Array(samples + 1);
    inPoly[0] = turf.booleanPointInPolygon(observerPos, feature);
    inPoly[samples] = turf.booleanPointInPolygon(targetPos, feature);
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const samplePos: [number, number] = [
        observerPos[0] + (targetPos[0] - observerPos[0]) * t,
        observerPos[1] + (targetPos[1] - observerPos[1]) * t,
      ];
      inPoly[i] = turf.booleanPointInPolygon(samplePos, feature);
    }

    // Samples continuously inside an endpoint's own plateau do not self-occlude;
    // only polygon segments entered AFTER exiting into open air/valley count as intervening ridges.
    const firstExit = inPoly.indexOf(false);
    if (firstExit === -1) continue;
    const lastExit = inPoly.lastIndexOf(false);

    const terrainHeightM = polygon.elevationM ?? 0;
    for (let i = Math.max(1, firstExit + 1); i < lastExit; i++) {
      if (!inPoly[i]) continue;
      const t = i / samples;
      const d1 = t * totalKm;
      const d2 = (1 - t) * totalKm;
      const earthBulgeM = ((d1 * d2) / (2 * EFFECTIVE_EARTH_RADIUS_KM)) * 1000;
      const rayAltM = hObs * (1 - t) + hTgt * t - earthBulgeM;
      if (terrainHeightM > rayAltM) return false;
    }
  }

  return true;
}

export interface MissileTerrainOutcome {
  impacted: boolean;
  ridgeName?: string;
  ridgeElevationM?: number;
  terrainFollowAltitudeM?: number;
}

export function resolveMissileTerrainInteraction(
  fromPos: [number, number],
  toPos: [number, number],
  launchPos: [number, number],
  targetPos: [number, number] | undefined,
  missileAltM: number,
  weapon: WeaponSpec,
  environment?: ScenarioEnvironment
): MissileTerrainOutcome {
  if (missileAltM < 0 || weapon.guidance === 'hypersonic_glide') {
    return { impacted: false };
  }
  const elevated = (environment?.landPolygons ?? []).filter((p) => (p.elevationM ?? 0) > 0);
  if (elevated.length === 0) {
    return { impacted: false };
  }

  // Terrain-following Land-Attack Cruise Missiles (TERCOM) climb 60m AGL over ridges
  if (weapon.category === 'lacm') {
    let maxElev = 0;
    for (const poly of elevated) {
      const feature = polygonFeature(poly.areaPolygon);
      if (turf.booleanPointInPolygon(toPos, feature) || turf.booleanPointInPolygon(fromPos, feature)) {
        maxElev = Math.max(maxElev, poly.elevationM ?? 0);
      }
    }
    const desiredAltM = maxElev > 0 ? Math.max(weapon.cruiseAltitudeM, maxElev + 60) : weapon.cruiseAltitudeM;
    return { impacted: false, terrainFollowAltitudeM: desiredAltM };
  }

  const segment =
    fromPos[0] === toPos[0] && fromPos[1] === toPos[1]
      ? undefined
      : turf.lineString([fromPos, toPos]);

  for (const poly of elevated) {
    const terrainHeightM = poly.elevationM ?? 0;
    if (missileAltM >= terrainHeightM) continue;
    const feature = polygonFeature(poly.areaPolygon);
    if (turf.booleanPointInPolygon(launchPos, feature)) continue;
    if (targetPos && turf.booleanPointInPolygon(targetPos, feature)) continue;

    const hit =
      turf.booleanPointInPolygon(toPos, feature) ||
      (!!segment && turf.booleanIntersects(segment, feature));
    if (hit) {
      return {
        impacted: true,
        ridgeName: poly.name,
        ridgeElevationM: terrainHeightM,
      };
    }
  }

  return { impacted: false };
}

export const MAX_AMPHIBIOUS_STANDOFF_KM = 18;

export function findAmphibiousLandingPoint(
  shipOrigin: [number, number],
  headingDeg: number,
  environment?: ScenarioEnvironment,
  maxStandOffKm = MAX_AMPHIBIOUS_STANDOFF_KM
): [number, number] | undefined {
  if (!environment?.landPolygons.length) return undefined;
  const bearingOffsets = [0, -25, 25, -50, 50, -90, 90, -135, 135, 180];
  for (let distKm = 2; distKm <= maxStandOffKm + 1e-6; distKm += 2) {
    for (const offset of bearingOffsets) {
      const bearing = (headingDeg + offset + 360) % 360;
      const candidate = turf.destination(shipOrigin, distKm, bearing, {
        units: 'kilometers',
      }).geometry.coordinates as [number, number];
      if (isPointOnLand(candidate, environment)) {
        return [Number(candidate[0].toFixed(4)), Number(candidate[1].toFixed(4))];
      }
    }
  }
  return undefined;
}

export function findShootAndScootDestination(
  origin: [number, number],
  environment?: ScenarioEnvironment,
  distanceKm = 4.5,
  seedAngle = 0
): [number, number] | undefined {
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  for (const offset of angles) {
    const bearing = (seedAngle + offset) % 360;
    const candidate = turf.destination(origin, distanceKm, bearing, {
      units: 'kilometers',
    }).geometry.coordinates as [number, number];
    if (isRouteAllowed('land', origin, candidate, environment)) {
      return candidate;
    }
  }
  return undefined;
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
