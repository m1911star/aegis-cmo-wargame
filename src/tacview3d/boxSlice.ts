import { CMO_SECTOR_ARCS } from '../engine/cmoUnits';
import { THERMOCLINE } from '../engine/constants';
import { guidanceProfile } from '../engine/fireControl';
import { getDistanceKm } from '../engine/geometry';
import { observeMissile } from '../engine/sensors';
import { getUnitCapabilities, isActiveUnit, isUnitRadarEmittingAtTime } from '../engine/unitCapabilities';
import { resolveUnitConfiguration } from '../engine/unitConfiguration';
import type {
  ActivePerspective,
  AarEventKind,
  AarTrackSample,
  BattleAarLedger,
  CmoArcMask,
  Domain,
  EquipmentCatalog,
  RuntimeUnit,
  ScenarioEnvironment,
  ScenarioWeather,
  SideId,
  TacticalContact,
  UnitCategory,
  WeaponInFlight,
} from '../types/wargame';

export interface BoxVerticalScale {
  airScale: number;
  subScale: number;
}

export const DEFAULT_BOX_SCALES: BoxVerticalScale = {
  airScale: 4,
  subScale: 60,
};

export interface LocalBoxPoint3D {
  xKm: number;
  yKm: number;
  zKm: number;
  yScaled: number;
  altM: number;
}

export function lonLatAltToLocalBox(
  position: [number, number],
  altitudeM: number,
  center: [number, number],
  scales: BoxVerticalScale = DEFAULT_BOX_SCALES
): LocalBoxPoint3D {
  const cosLat = Math.cos((center[1] * Math.PI) / 180);
  const xKm = (position[0] - center[0]) * 111.195 * cosLat;
  const zKm = -(position[1] - center[1]) * 111.195;
  const yKm = altitudeM / 1000;
  const yScaled = altitudeM >= 0 ? yKm * scales.airScale : yKm * scales.subScale;
  return { xKm, yKm, zKm, yScaled, altM: altitudeM };
}

export interface BoxEntity3D {
  id: string;
  kind: 'unit' | 'contact';
  label: string;
  side: SideId;
  domain: Domain;
  category?: UnitCategory;
  xKm: number;
  zKm: number;
  altM: number;
  headingDeg: number;
  speedKts: number;
  isAnchor: boolean;
  uncertaintyRadiusKm?: number;
  radarEnvelope?: {
    rangeKm: number;
    startAngleDeg: number;
    sweepAngleDeg: number;
  };
  sonobuoyCylinder?: {
    radiusKm: number;
    maxDepthM: number;
    isActivePing: boolean;
  };
  trail3d?: Array<{ xKm: number; zKm: number; altM: number }>;
}

export interface BoxMissile3D {
  id: string;
  name: string;
  side: SideId;
  isInterceptor: boolean;
  xKm: number;
  zKm: number;
  altM: number;
  headingDeg: number;
  speedKts: number;
  seekerState?: WeaponInFlight['seekerState'];
  seekerCone?: {
    rangeKm: number;
    fovDeg: number;
    locked: boolean;
  };
  trail3d: Array<{ xKm: number; zKm: number; altM: number }>;
}

export interface BoxRidge3D {
  id: string;
  name: string;
  elevationM: number;
  pointsKm: Array<{ xKm: number; zKm: number }>;
}

export interface BoxSliceCommon {
  anchorCenter: [number, number];
  anchorLabel: string;
  radiusKm: number;
  thermocline: {
    upperDepthM: number;
    lowerDepthM: number;
  };
  clouds?: {
    floorM: number;
    ceilingM: number;
    condition: ScenarioWeather['condition'];
  };
  ridges: BoxRidge3D[];
}

export interface LiveBoxSlice extends BoxSliceCommon {
  mode: 'live';
  simTime: number;
  entities: BoxEntity3D[];
  missiles: BoxMissile3D[];
}

export interface BoxAarTrack3D {
  unitId: string;
  label: string;
  side: SideId;
  domain?: Domain;
  points: Array<{
    tick: number;
    simTime: number;
    xKm: number;
    zKm: number;
    altM: number;
    status: RuntimeUnit['status'];
  }>;
}

export interface BoxAarEvent3D {
  id: string;
  tick: number;
  simTime: number;
  side: SideId | 'SYSTEM';
  kind: AarEventKind;
  title: string;
  xKm: number;
  zKm: number;
  altM: number;
}

export interface AarBoxSlice extends BoxSliceCommon {
  mode: 'aar';
  upToTick: number;
  unitTracks: BoxAarTrack3D[];
  eventMarkers: BoxAarEvent3D[];
}

export type TacticalBoxSlice = LiveBoxSlice | AarBoxSlice;

function extractLocalRidges(
  anchorCenter: [number, number],
  radiusKm: number,
  environment?: ScenarioEnvironment
): BoxRidge3D[] {
  const ridges: BoxRidge3D[] = [];
  const landPolygons = environment?.landPolygons ?? [];
  const cosLat = Math.cos((anchorCenter[1] * Math.PI) / 180);

  for (const poly of landPolygons) {
    const elevationM = poly.elevationM ?? 0;
    if (elevationM <= 0 || poly.areaPolygon.length < 3) continue;

    let minDist = Infinity;
    const pointsKm: Array<{ xKm: number; zKm: number }> = [];
    for (const pt of poly.areaPolygon) {
      const d = getDistanceKm(anchorCenter, pt);
      if (d < minDist) minDist = d;
      pointsKm.push({
        xKm: (pt[0] - anchorCenter[0]) * 111.195 * cosLat,
        zKm: -(pt[1] - anchorCenter[1]) * 111.195,
      });
    }
    if (minDist <= radiusKm * 1.35) {
      ridges.push({
        id: poly.id,
        name: poly.name,
        elevationM,
        pointsKm,
      });
    }
  }
  return ridges;
}

function extractClouds(environment?: ScenarioEnvironment): BoxSliceCommon['clouds'] {
  const weather = environment?.weather;
  if (!weather) return undefined;
  return {
    floorM: weather.cloudFloorM,
    ceilingM: weather.cloudCeilingM,
    condition: weather.condition,
  };
}

function deriveArcSpanFromCmoMask(arcs?: CmoArcMask): { startAngleDeg: number; sweepAngleDeg: number } | undefined {
  if (!arcs) return undefined;
  const enabled = CMO_SECTOR_ARCS.map((s) => Boolean(arcs[s]));
  const count = enabled.filter(Boolean).length;
  if (count === 0 || count === 8) return undefined;
  // Find longest contiguous disabled gap so enabled span wraps cleanly across 0°
  let bestGapStart = 0;
  let bestGapLen = 0;
  for (let i = 0; i < 8; i++) {
    let len = 0;
    while (len < 8 && !enabled[(i + len) % 8]) len++;
    if (len > bestGapLen) {
      bestGapLen = len;
      bestGapStart = i;
    }
  }
  const enabledStartIdx = (bestGapStart + bestGapLen) % 8;
  const enabledCount = 8 - bestGapLen;
  const startDeg = enabledStartIdx * 45;
  const normalizedStart = startDeg > 180 ? startDeg - 360 : startDeg;
  return {
    startAngleDeg: normalizedStart,
    sweepAngleDeg: enabledCount * 45,
  };
}

export interface BuildLiveBoxSliceInput {
  anchorCenter: [number, number];
  anchorLabel: string;
  anchorId?: string | null;
  radiusKm?: number;
  activePerspective: ActivePerspective;
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  detectedMissileIds?: readonly string[];
  aarTracks?: readonly AarTrackSample[];
  catalog: EquipmentCatalog;
  simTime: number;
  environment?: ScenarioEnvironment;
}

export function buildLiveBoxSlice({
  anchorCenter,
  anchorLabel,
  anchorId,
  radiusKm = 120,
  activePerspective,
  units,
  contacts,
  weaponsInFlight,
  detectedMissileIds = [],
  aarTracks,
  catalog,
  simTime,
  environment,
}: BuildLiveBoxSliceInput): LiveBoxSlice {
  const entities: BoxEntity3D[] = [];
  const detectedSet = new Set(detectedMissileIds);
  const recentTracksByUnit = new Map<string, AarTrackSample[]>();
  if (aarTracks && aarTracks.length > 0) {
    for (const sample of aarTracks) {
      let list = recentTracksByUnit.get(sample.unitId);
      if (!list) {
        list = [];
        recentTracksByUnit.set(sample.unitId, list);
      }
      list.push(sample);
    }
  }

  for (const unit of Object.values(units)) {
    if (!isActiveUnit(unit)) continue;
    if (activePerspective !== 'GOD' && unit.side !== activePerspective) continue;
    if (getDistanceKm(anchorCenter, unit.position) > radiusKm) continue;
    const pt = lonLatAltToLocalBox(unit.position, unit.altitudeM, anchorCenter);
    const cfg = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
    const caps = getUnitCapabilities(unit);

    let radarEnvelope: BoxEntity3D['radarEnvelope'];
    if (isUnitRadarEmittingAtTime(unit, simTime, weaponsInFlight, catalog) && caps.radarFactor > 0) {
      let bestRange = 0;
      let bestSensorMount: (typeof cfg.sensorMounts)[number] | undefined;
      for (const sm of cfg.sensorMounts) {
        const s = catalog.sensors[sm.sensorId];
        if (!s || (s.type !== 'radar_air_surface' && s.type !== 'radar_oth')) continue;
        const r = s.maxRangeKm * caps.radarFactor;
        if (r > bestRange) {
          bestRange = r;
          bestSensorMount = sm;
        }
      }
      if (bestRange > 0 && bestSensorMount) {
        const s = catalog.sensors[bestSensorMount.sensorId]!;
        const cmoSpan = deriveArcSpanFromCmoMask(bestSensorMount.arcs);
        const cov = s.coverageArcDeg ?? 360;
        radarEnvelope = {
          rangeKm: Number(Math.min(radiusKm * 0.92, bestRange).toFixed(1)),
          startAngleDeg: cmoSpan ? cmoSpan.startAngleDeg : cov < 360 ? -cov * 0.5 : -180,
          sweepAngleDeg: cmoSpan ? cmoSpan.sweepAngleDeg : cov < 360 ? cov : 360,
        };
      }
    }

    let sonobuoyCylinder: BoxEntity3D['sonobuoyCylinder'];
    if (unit.category === 'sonobuoy') {
      let maxSonarKm = 14;
      for (const sId of cfg.sensorIds) {
        const s = catalog.sensors[sId];
        if (s && (s.type === 'sonar_passive' || s.type === 'sonar_active')) {
          if (s.maxRangeKm > maxSonarKm) maxSonarKm = s.maxRangeKm;
        }
      }
      sonobuoyCylinder = {
        radiusKm: Number(Math.min(radiusKm * 0.5, maxSonarKm).toFixed(1)),
        maxDepthM: -220,
        isActivePing: Boolean(unit.doctrine.emconSonar),
      };
    }

    let trail3d: BoxEntity3D['trail3d'];
    const unitHistory = recentTracksByUnit.get(unit.id);
    if (unitHistory && unitHistory.length > 0) {
      const tail = unitHistory.slice(-16);
      trail3d = tail.map((s) => {
        const p = lonLatAltToLocalBox(s.position, s.altitudeM, anchorCenter);
        return { xKm: p.xKm, zKm: p.zKm, altM: s.altitudeM };
      });
      trail3d.push({ xKm: pt.xKm, zKm: pt.zKm, altM: unit.altitudeM });
    }

    entities.push({
      id: unit.id,
      kind: 'unit',
      label: unit.callsign,
      side: unit.side,
      domain: unit.domain,
      category: unit.category,
      xKm: pt.xKm,
      zKm: pt.zKm,
      altM: unit.altitudeM,
      headingDeg: unit.heading,
      speedKts: unit.speedKts,
      isAnchor: unit.id === anchorId,
      radarEnvelope,
      sonobuoyCylinder,
      trail3d,
    });
  }

  if (activePerspective !== 'GOD') {
    for (const contact of Object.values(contacts)) {
      if (contact.observerSide !== activePerspective) continue;
      if (getDistanceKm(anchorCenter, contact.estimatedPosition) > radiusKm) continue;
      const pt = lonLatAltToLocalBox(contact.estimatedPosition, contact.altitudeM, anchorCenter);
      entities.push({
        id: contact.id,
        kind: 'contact',
        label: contact.displayName,
        side: contact.targetSide,
        domain: contact.domain,
        category: contact.identifiedCategory,
        xKm: pt.xKm,
        zKm: pt.zKm,
        altM: contact.altitudeM,
        headingDeg: contact.heading,
        speedKts: contact.speedKts,
        isAnchor: contact.id === anchorId,
        uncertaintyRadiusKm: contact.uncertaintyRadiusKm,
      });
    }
  }

  const missiles: BoxMissile3D[] = [];
  for (const missile of Object.values(weaponsInFlight)) {
    const isOwnOrGod = activePerspective === 'GOD' || missile.side === activePerspective;
    const isVisible =
      isOwnOrGod ||
      detectedSet.has(missile.id) ||
      !!observeMissile(activePerspective, missile, units, catalog, simTime, undefined, environment);
    if (!isVisible) continue;
    if (getDistanceKm(anchorCenter, missile.position) > radiusKm) continue;

    const headPt = lonLatAltToLocalBox(missile.position, missile.altitudeM, anchorCenter);
    const trail3d: BoxMissile3D['trail3d'] = [];

    if (isOwnOrGod) {
      const len = missile.trail.length;
      for (let i = 0; i < len; i++) {
        const pos = missile.trail[i];
        const altM = missile.altitudeTrail?.[i] ?? missile.altitudeM;
        const p = lonLatAltToLocalBox(pos, altM, anchorCenter);
        trail3d.push({ xKm: p.xKm, zKm: p.zKm, altM });
      }
      if (len === 0) {
        trail3d.push({ xKm: headPt.xKm, zKm: headPt.zKm, altM: missile.altitudeM });
      }
    } else {
      trail3d.push({ xKm: headPt.xKm, zKm: headPt.zKm, altM: missile.altitudeM });
    }

    let seekerCone: BoxMissile3D['seekerCone'];
    if (
      isOwnOrGod &&
      (missile.seekerState === 'terminal_searching' || missile.seekerState === 'terminal_locked')
    ) {
      const wSpec = catalog.weapons[missile.weaponId];
      if (wSpec) {
        const prof = guidanceProfile(wSpec);
        seekerCone = {
          rangeKm: Number(Math.max(4, Math.min(35, prof.seekerRangeKm)).toFixed(1)),
          fovDeg: Math.max(12, Math.min(120, prof.seekerFovDeg)),
          locked: missile.seekerState === 'terminal_locked',
        };
      }
    }

    missiles.push({
      id: missile.id,
      name: isOwnOrGod ? missile.name : '来袭武器',
      side: missile.side,
      isInterceptor: missile.targetType === 'missile',
      xKm: headPt.xKm,
      zKm: headPt.zKm,
      altM: missile.altitudeM,
      headingDeg: missile.heading,
      speedKts: missile.speedKts,
      seekerState: isOwnOrGod ? missile.seekerState : undefined,
      seekerCone,
      trail3d,
    });
  }

  return {
    mode: 'live',
    anchorCenter,
    anchorLabel,
    radiusKm,
    simTime,
    thermocline: {
      upperDepthM: THERMOCLINE.UPPER_BOUNDARY,
      lowerDepthM: THERMOCLINE.LOWER_BOUNDARY,
    },
    clouds: extractClouds(environment),
    ridges: extractLocalRidges(anchorCenter, radiusKm, environment),
    entities,
    missiles,
  };
}

export interface BuildAarBoxSliceInput {
  aar: BattleAarLedger;
  units: Record<string, RuntimeUnit>;
  upToTick: number;
  anchorCenter?: [number, number];
  anchorLabel?: string;
  radiusKm?: number;
  environment?: ScenarioEnvironment;
}

export function buildAarBoxSlice({
  aar,
  units,
  upToTick,
  anchorCenter,
  anchorLabel = '交战空域复盘',
  radiusKm = 130,
  environment,
}: BuildAarBoxSliceInput): AarBoxSlice {
  const spatialEvents = aar.events.filter(
    (e) => e.tick <= upToTick && Array.isArray(e.position) && e.position.length === 2
  );
  const filteredTracks = aar.tracks.filter((t) => t.tick <= upToTick);

  let resolvedCenter: [number, number] | undefined = anchorCenter;
  if (!resolvedCenter && spatialEvents.length > 0) {
    const latest = spatialEvents[spatialEvents.length - 1];
    resolvedCenter = latest.position!;
  }
  if (!resolvedCenter && filteredTracks.length > 0) {
    let sumLon = 0;
    let sumLat = 0;
    for (const s of filteredTracks) {
      sumLon += s.position[0];
      sumLat += s.position[1];
    }
    resolvedCenter = [sumLon / filteredTracks.length, sumLat / filteredTracks.length];
  }
  resolvedCenter ??= [123.5, 25.5];

  const grouped = new Map<string, BoxAarTrack3D>();
  for (const sample of filteredTracks) {
    if (getDistanceKm(resolvedCenter, sample.position) > radiusKm) continue;
    let track = grouped.get(sample.unitId);
    if (!track) {
      const unitMeta = units[sample.unitId];
      track = {
        unitId: sample.unitId,
        label: unitMeta?.callsign ?? sample.unitId,
        side: sample.side,
        domain: unitMeta?.domain,
        points: [],
      };
      grouped.set(sample.unitId, track);
    }
    const pt = lonLatAltToLocalBox(sample.position, sample.altitudeM, resolvedCenter);
    track.points.push({
      tick: sample.tick,
      simTime: sample.simTime,
      xKm: pt.xKm,
      zKm: pt.zKm,
      altM: sample.altitudeM,
      status: sample.status,
    });
  }

  const eventMarkers: BoxAarEvent3D[] = [];
  for (const ev of spatialEvents) {
    if (!ev.position || getDistanceKm(resolvedCenter, ev.position) > radiusKm) continue;
    const altM = ev.altitudeM ?? 0;
    const pt = lonLatAltToLocalBox(ev.position, altM, resolvedCenter);
    eventMarkers.push({
      id: ev.id,
      tick: ev.tick,
      simTime: ev.simTime,
      side: ev.side,
      kind: ev.kind,
      title: ev.title,
      xKm: pt.xKm,
      zKm: pt.zKm,
      altM,
    });
  }

  return {
    mode: 'aar',
    anchorCenter: resolvedCenter,
    anchorLabel,
    radiusKm,
    upToTick,
    thermocline: {
      upperDepthM: THERMOCLINE.UPPER_BOUNDARY,
      lowerDepthM: THERMOCLINE.LOWER_BOUNDARY,
    },
    clouds: extractClouds(environment),
    ridges: extractLocalRidges(resolvedCenter, radiusKm, environment),
    unitTracks: [...grouped.values()],
    eventMarkers,
  };
}
