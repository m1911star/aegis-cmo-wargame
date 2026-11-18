import * as turf from './turfGeo';
import type { Domain, ScenarioEnvironment, WeaponSpec } from '../types/wargame';
import { getBearingDeg, getDistanceKm } from './geometry';

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
    weather: environment?.weather ? { ...environment.weather } : undefined,
    weatherZones: environment?.weatherZones
      ? environment.weatherZones.map((zone) => ({
          ...zone,
          areaPolygon: zone.areaPolygon.map((point) => [...point] as [number, number]),
        }))
      : undefined,
    satellitePasses: environment?.satellitePasses
      ? environment.satellitePasses.map((pass) => ({
          ...pass,
          swathPolygon: pass.swathPolygon.map((point) => [...point] as [number, number]),
        }))
      : undefined,
  };
}

export interface CompiledPolygon {
  feature: ReturnType<typeof turf.polygon>;
  boundary: ReturnType<typeof turf.lineString>;
  bbox: [number, number, number, number];
}

const polygonWeakCache = new WeakMap<readonly [number, number][], CompiledPolygon>();
const polygonSigCache = new Map<string, CompiledPolygon>();

export function getCompiledPolygon(areaPolygon: readonly [number, number][]): CompiledPolygon {
  const weakHit = polygonWeakCache.get(areaPolygon);
  if (weakHit) return weakHit;

  let sig = `${areaPolygon.length}`;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < areaPolygon.length; i++) {
    const pt = areaPolygon[i];
    sig += `|${pt[0]},${pt[1]}`;
    if (pt[0] < minLon) minLon = pt[0];
    if (pt[0] > maxLon) maxLon = pt[0];
    if (pt[1] < minLat) minLat = pt[1];
    if (pt[1] > maxLat) maxLat = pt[1];
  }

  let compiled = polygonSigCache.get(sig);
  if (!compiled) {
    const closedRing = [...areaPolygon, areaPolygon[0]];
    compiled = {
      feature: turf.polygon([closedRing]),
      boundary: turf.lineString(closedRing),
      bbox: [minLon, minLat, maxLon, maxLat],
    };
    if (polygonSigCache.size >= 512) {
      const oldestKey = polygonSigCache.keys().next().value;
      if (oldestKey !== undefined) polygonSigCache.delete(oldestKey);
    }
    polygonSigCache.set(sig, compiled);
  }
  polygonWeakCache.set(areaPolygon, compiled);
  return compiled;
}

export function pointInBbox(
  point: readonly [number, number],
  bbox: readonly [number, number, number, number]
): boolean {
  return (
    point[0] >= bbox[0] &&
    point[0] <= bbox[2] &&
    point[1] >= bbox[1] &&
    point[1] <= bbox[3]
  );
}

export function segmentOverlapsBbox(
  a: readonly [number, number],
  b: readonly [number, number],
  bbox: readonly [number, number, number, number]
): boolean {
  const segMinLon = a[0] < b[0] ? a[0] : b[0];
  const segMaxLon = a[0] > b[0] ? a[0] : b[0];
  if (segMaxLon < bbox[0] || segMinLon > bbox[2]) return false;
  const segMinLat = a[1] < b[1] ? a[1] : b[1];
  const segMaxLat = a[1] > b[1] ? a[1] : b[1];
  return segMaxLat >= bbox[1] && segMinLat <= bbox[3];
}

export function isPointInCompiledPolygon(
  position: [number, number],
  areaPolygon: readonly [number, number][]
): boolean {
  const compiled = getCompiledPolygon(areaPolygon);
  if (!pointInBbox(position, compiled.bbox)) return false;
  return turf.booleanPointInPolygon(position, compiled.feature);
}

export function isPointOnLand(position: [number, number], environment?: ScenarioEnvironment): boolean {
  const land = environment?.landPolygons;
  if (!land || land.length === 0) return false;
  for (let i = 0; i < land.length; i++) {
    if (isPointInCompiledPolygon(position, land[i].areaPolygon)) return true;
  }
  return false;
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
    const midpoint: [number, number] = [(from[0] + to[0]) * 0.5, (from[1] + to[1]) * 0.5];
    return (
      isPointOnLand(from, environment) &&
      isPointOnLand(midpoint, environment) &&
      isPointOnLand(to, environment)
    );
  }
  let route: ReturnType<typeof turf.lineString> | undefined;
  for (let i = 0; i < land.length; i++) {
    const compiled = getCompiledPolygon(land[i].areaPolygon);
    if (!segmentOverlapsBbox(from, to, compiled.bbox)) continue;
    if (pointInBbox(to, compiled.bbox) && turf.booleanPointInPolygon(to, compiled.feature)) {
      return false;
    }
    route ??= turf.lineString([from, to]);
    if (turf.booleanIntersects(route, compiled.feature)) return false;
  }
  return true;
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

  let hasElevatedCandidate = false;
  for (let i = 0; i < land.length; i++) {
    if ((land[i].elevationM ?? 0) > 0) {
      hasElevatedCandidate = true;
      break;
    }
  }
  if (!hasElevatedCandidate) return true;

  const totalKm = getDistanceKm(observerPos, targetPos);
  if (totalKm <= 0.05) return true;
  const hObs = Math.max(0, observerAltM) + Math.max(0, observerAntennaM);
  const hTgt = Math.max(0, targetAltM);
  let ray: ReturnType<typeof turf.lineString> | undefined;
  const samples = 16;

  for (let p = 0; p < land.length; p++) {
    const polygon = land[p];
    const terrainHeightM = polygon.elevationM ?? 0;
    if (terrainHeightM <= 0) continue;
    const compiled = getCompiledPolygon(polygon.areaPolygon);
    if (!segmentOverlapsBbox(observerPos, targetPos, compiled.bbox)) continue;

    ray ??= turf.lineString([observerPos, targetPos]);
    if (!turf.booleanIntersects(ray, compiled.feature)) continue;

    const inPoly: boolean[] = new Array(samples + 1);
    inPoly[0] = pointInBbox(observerPos, compiled.bbox) && turf.booleanPointInPolygon(observerPos, compiled.feature);
    inPoly[samples] = pointInBbox(targetPos, compiled.bbox) && turf.booleanPointInPolygon(targetPos, compiled.feature);
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const samplePos: [number, number] = [
        observerPos[0] + (targetPos[0] - observerPos[0]) * t,
        observerPos[1] + (targetPos[1] - observerPos[1]) * t,
      ];
      inPoly[i] = pointInBbox(samplePos, compiled.bbox) && turf.booleanPointInPolygon(samplePos, compiled.feature);
    }

    // Samples continuously inside an endpoint's own plateau do not self-occlude;
    // only polygon segments entered AFTER exiting into open air/valley count as intervening ridges.
    const firstExit = inPoly.indexOf(false);
    if (firstExit === -1) continue;
    const lastExit = inPoly.lastIndexOf(false);

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
  const land = environment?.landPolygons;
  if (
    !land?.length ||
    missileAltM < 0 ||
    weapon.guidance === 'hypersonic_glide' ||
    weapon.flightProfile === 'hypersonic_glide' ||
    weapon.flightProfile === 'ballistic_loft'
  ) {
    return { impacted: false };
  }

  let hasElevated = false;
  for (let i = 0; i < land.length; i++) {
    if ((land[i].elevationM ?? 0) > 0) {
      hasElevated = true;
      break;
    }
  }
  if (!hasElevated) return { impacted: false };

  // Terrain-following Land-Attack Cruise Missiles (TERCOM) climb 60m AGL over ridges
  if (weapon.category === 'lacm') {
    let maxElev = 0;
    for (let i = 0; i < land.length; i++) {
      const poly = land[i];
      const elev = poly.elevationM ?? 0;
      if (elev <= 0) continue;
      if (
        isPointInCompiledPolygon(toPos, poly.areaPolygon) ||
        isPointInCompiledPolygon(fromPos, poly.areaPolygon)
      ) {
        if (elev > maxElev) maxElev = elev;
      }
    }
    const desiredAltM = maxElev > 0 ? Math.max(weapon.cruiseAltitudeM, maxElev + 60) : weapon.cruiseAltitudeM;
    return { impacted: false, terrainFollowAltitudeM: desiredAltM };
  }

  let segment: ReturnType<typeof turf.lineString> | undefined;
  const moved = fromPos[0] !== toPos[0] || fromPos[1] !== toPos[1];

  for (let i = 0; i < land.length; i++) {
    const poly = land[i];
    const terrainHeightM = poly.elevationM ?? 0;
    if (terrainHeightM <= 0 || missileAltM >= terrainHeightM) continue;
    const compiled = getCompiledPolygon(poly.areaPolygon);
    if (!segmentOverlapsBbox(fromPos, toPos, compiled.bbox)) continue;
    if (pointInBbox(launchPos, compiled.bbox) && turf.booleanPointInPolygon(launchPos, compiled.feature)) continue;
    if (targetPos && pointInBbox(targetPos, compiled.bbox) && turf.booleanPointInPolygon(targetPos, compiled.feature)) continue;

    const toInside = pointInBbox(toPos, compiled.bbox) && turf.booleanPointInPolygon(toPos, compiled.feature);
    let hit = toInside;
    if (!hit && moved) {
      segment ??= turf.lineString([fromPos, toPos]);
      hit = turf.booleanIntersects(segment, compiled.feature);
    }
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
  const zones = environment?.acousticZones;
  if (!zones?.length) return 1;
  const midpoint = turf.midpoint(observer, target).geometry.coordinates as [number, number];
  for (let i = 0; i < zones.length; i++) {
    if (isPointInCompiledPolygon(midpoint, zones[i].areaPolygon)) {
      return zones[i].sonarRangeFactor;
    }
  }
  return 1;
}

export function localSeaStateAt(
  position: [number, number],
  environment?: ScenarioEnvironment
): number {
  let seaState: number = environment?.weather?.seaState ?? 2;
  const zones = environment?.weatherZones;
  if (zones?.length) {
    for (let i = 0; i < zones.length; i++) {
      const override = zones[i].seaStateOverride;
      if (override !== undefined && override > seaState && isPointInCompiledPolygon(position, zones[i].areaPolygon)) {
        seaState = override;
      }
    }
  }
  return seaState;
}

export interface WeatherModifiers {
  opticalFactor: number;
  radarClutterPenalty: number;
  passiveSonarFactor: number;
  localSeaState: number;
  inStormZone: boolean;
}

const NEUTRAL_WEATHER_MODS: WeatherModifiers = {
  opticalFactor: 1,
  radarClutterPenalty: 1,
  passiveSonarFactor: 1,
  localSeaState: 2,
  inStormZone: false,
};

export function evaluateWeatherModifiers(
  observerPos: [number, number],
  observerAltM: number,
  targetPos: [number, number],
  targetAltM: number,
  environment?: ScenarioEnvironment
): WeatherModifiers {
  const weather = environment?.weather;
  const zones = environment?.weatherZones;
  if (!weather && (!zones || zones.length === 0)) {
    return NEUTRAL_WEATHER_MODS;
  }

  let opticalFactor = 1;
  let inStormZone = false;
  let localSeaState: number = weather?.seaState ?? 2;

  if (weather && weather.condition !== 'clear') {
    const minAlt = Math.min(observerAltM, targetAltM);
    const maxAlt = Math.max(observerAltM, targetAltM);
    const crossesCloudLayer =
      minAlt < weather.cloudCeilingM && maxAlt > weather.cloudFloorM;
    if (crossesCloudLayer) {
      opticalFactor *= weather.condition === 'overcast' ? 0.42 : 0.28;
    } else if (weather.condition === 'rain_storm' || weather.condition === 'typhoon_edge') {
      if (maxAlt <= weather.cloudFloorM) {
        opticalFactor *= 0.55;
      }
    }
  }

  if (zones && zones.length > 0) {
    const midpoint: [number, number] = [
      (observerPos[0] + targetPos[0]) * 0.5,
      (observerPos[1] + targetPos[1]) * 0.5,
    ];
    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      const hit =
        isPointInCompiledPolygon(observerPos, zone.areaPolygon) ||
        isPointInCompiledPolygon(targetPos, zone.areaPolygon) ||
        isPointInCompiledPolygon(midpoint, zone.areaPolygon);
      if (hit) {
        inStormZone = true;
        opticalFactor *= zone.condition === 'rain_storm' ? 0.32 : 0.25;
        if (zone.seaStateOverride !== undefined && zone.seaStateOverride > localSeaState) {
          localSeaState = zone.seaStateOverride;
        }
      }
    }
  }

  const radarClutterPenalty =
    localSeaState >= 4 ? Math.max(0.55, 1 - (localSeaState - 3) * 0.12) : 1;
  const passiveSonarFactor =
    localSeaState >= 4 ? Math.max(0.55, 1 - (localSeaState - 3) * 0.12) : 1;

  return {
    opticalFactor: Math.max(0.15, Number(opticalFactor.toFixed(3))),
    radarClutterPenalty: Number(radarClutterPenalty.toFixed(3)),
    passiveSonarFactor: Number(passiveSonarFactor.toFixed(3)),
    localSeaState,
    inStormZone,
  };
}

function generatePolygonFlankCandidates(
  fromPos: [number, number],
  toPos: [number, number],
  polygons: ScenarioEnvironment['landPolygons']
): [number, number][] {
  const candidates: [number, number][] = [];
  const mainBearing = getBearingDeg(fromPos, toPos);
  const mid: [number, number] = [(fromPos[0] + toPos[0]) * 0.5, (fromPos[1] + toPos[1]) * 0.5];

  for (const poly of polygons) {
    if (poly.areaPolygon.length < 3) continue;
    let sumLon = 0;
    let sumLat = 0;
    for (const pt of poly.areaPolygon) {
      sumLon += pt[0];
      sumLat += pt[1];
    }
    const centroid: [number, number] = [
      sumLon / poly.areaPolygon.length,
      sumLat / poly.areaPolygon.length,
    ];
    for (const vertex of poly.areaPolygon) {
      const outBearing = getBearingDeg(centroid, vertex);
      for (const clearanceKm of [8, 16, 28]) {
        const pt = turf.destination(vertex, clearanceKm, outBearing, {
          units: 'kilometers',
        }).geometry.coordinates as [number, number];
        candidates.push([Number(pt[0].toFixed(4)), Number(pt[1].toFixed(4))]);
      }
    }
  }

  for (const sideSign of [1, -1]) {
    const perpBearing = (mainBearing + sideSign * 90 + 360) % 360;
    for (const offsetKm of [15, 30, 50, 80]) {
      const pt = turf.destination(mid, offsetKm, perpBearing, {
        units: 'kilometers',
      }).geometry.coordinates as [number, number];
      candidates.push([Number(pt[0].toFixed(4)), Number(pt[1].toFixed(4))]);
    }
  }
  return candidates;
}

/**
 * Compute a deterministic 1-point dogleg bypass around intervening mountain ridges
 * when a straight missile path would impact terrain (`elevationM > cruiseAltitudeM`).
 */
export function computeMissileTerrainDogleg(
  launchPos: [number, number],
  targetPos: [number, number],
  weapon: WeaponSpec,
  environment?: ScenarioEnvironment
): [number, number][] | undefined {
  if (!environment?.landPolygons?.length || weapon.launchMedium === 'air_drop') {
    return undefined;
  }
  const direct = resolveMissileTerrainInteraction(
    launchPos,
    targetPos,
    launchPos,
    targetPos,
    weapon.cruiseAltitudeM,
    weapon,
    environment
  );
  if (!direct.impacted) return undefined;

  const elevated = environment.landPolygons.filter(
    (p) => (p.elevationM ?? 0) > weapon.cruiseAltitudeM
  );
  const candidates = generatePolygonFlankCandidates(launchPos, targetPos, elevated);
  let bestWp: [number, number] | undefined;
  let bestDistKm = Infinity;

  for (const wp of candidates) {
    const totalKm = getDistanceKm(launchPos, wp) + getDistanceKm(wp, targetPos);
    if (totalKm > weapon.maxRangeKm * 0.99 || totalKm >= bestDistKm) continue;
    const leg1 = resolveMissileTerrainInteraction(
      launchPos,
      wp,
      launchPos,
      targetPos,
      weapon.cruiseAltitudeM,
      weapon,
      environment
    );
    if (leg1.impacted) continue;
    const leg2 = resolveMissileTerrainInteraction(
      wp,
      targetPos,
      launchPos,
      targetPos,
      weapon.cruiseAltitudeM,
      weapon,
      environment
    );
    if (leg2.impacted) continue;
    bestDistKm = totalKm;
    bestWp = wp;
  }

  return bestWp ? [bestWp] : undefined;
}

/**
 * Compute unit ingress waypoints that route around coastlines (for sea units)
 * or terrain ridges higher than `unitAltitudeM` (for low-altitude strike aircraft).
 */
export function computeNavigationBypassWaypoints(
  domain: Domain,
  unitAltitudeM: number,
  fromPos: [number, number],
  toPos: [number, number],
  environment?: ScenarioEnvironment
): [number, number][] {
  const land = environment?.landPolygons;
  if (!land?.length) return [[...toPos]];

  const checkClear = (a: [number, number], b: [number, number]): boolean => {
    if (domain === 'surface' || domain === 'subsurface') {
      return isRouteAllowed(domain, a, b, environment);
    }
    if (domain === 'air') {
      const seg = turf.lineString([a, b]);
      for (const poly of land) {
        const elev = poly.elevationM ?? 0;
        if (elev <= 0 || unitAltitudeM >= elev + 50) continue;
        const compiled = getCompiledPolygon(poly.areaPolygon);
        if (!segmentOverlapsBbox(a, b, compiled.bbox)) continue;
        if (turf.booleanIntersects(seg, compiled.feature)) return false;
      }
      return true;
    }
    return isRouteAllowed(domain, a, b, environment);
  };

  if (checkClear(fromPos, toPos)) return [[...toPos]];

  const relevantPolygons =
    domain === 'air'
      ? land.filter((p) => (p.elevationM ?? 0) > Math.max(0, unitAltitudeM - 50))
      : land;
  const candidates = generatePolygonFlankCandidates(fromPos, toPos, relevantPolygons);
  let bestWp: [number, number] | undefined;
  let bestDistKm = Infinity;

  for (const wp of candidates) {
    const totalKm = getDistanceKm(fromPos, wp) + getDistanceKm(wp, toPos);
    if (totalKm >= bestDistKm) continue;
    if (checkClear(fromPos, wp) && checkClear(wp, toPos)) {
      bestDistKm = totalKm;
      bestWp = wp;
    }
  }
  return bestWp ? [bestWp, [...toPos]] : [[...toPos]];
}
