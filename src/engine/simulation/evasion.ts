import * as turf from '@turf/turf';
import type { CombatLogEntry, EquipmentCatalog, RuntimeUnit, SideId, TacticalContact, WeaponInFlight } from '../../types/wargame';
import { resolveUnitConfiguration } from '../unitConfiguration';
import { getBearingDeg, getDistanceKm } from '../geometry';
import { observeMissile } from '../sensors';
import { compareRuntimeUnits, isActiveUnit } from '../unitCapabilities';

const EVASION_MEMORY_MS = 10_000;

function angularDifference(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function syncExternalEvasionRoute(unit: RuntimeUnit): void {
  const state = unit.evasionState;
  if (!state) return;
  const managed = state.managedWaypointPosition;
  const external = unit.waypoints
    .filter(
      (waypoint) =>
        !managed ||
        Math.abs(waypoint.position[0] - managed[0]) > 1e-7 ||
        Math.abs(waypoint.position[1] - managed[1]) > 1e-7
    )
    .map((waypoint) => ({
      ...waypoint,
      position: [...waypoint.position] as [number, number],
    }));
  if (external.length > 0) {
    state.resumeNavigationMode = 'manual';
    state.resumeWaypoints = external;
    state.resumeMissionTargetId = undefined;
    state.resumeFormationLeaderId = undefined;
    state.resumeFormationOffset = undefined;
  }
}

function restoreEvasion(unit: RuntimeUnit): void {
  const state = unit.evasionState;
  if (!state) return;
  syncExternalEvasionRoute(unit);
  unit.status = state.resumeStatus;
  unit.navigationMode = state.resumeNavigationMode;
  unit.waypoints = state.resumeWaypoints.map((waypoint) => ({
    ...waypoint,
    position: [...waypoint.position] as [number, number],
  }));
  unit.missionTargetId = state.resumeMissionTargetId;
  unit.missionState = state.resumeMissionState;
  unit.formationLeaderId = state.resumeFormationLeaderId;
  unit.formationOffset = state.resumeFormationOffset ? { ...state.resumeFormationOffset } : undefined;
  unit.evasionState = undefined;
}

export type EvasionContext = {
  units: Record<string, RuntimeUnit>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  catalog: EquipmentCatalog;
  nextSimTime: number;
  logs: CombatLogEntry[];
};

/** React only to side-observed, geometrically closing missiles; never inspect hidden target IDs. */
export function runEvasionAndSoftKill({
  units,
  weaponsInFlight,
  catalog,
  nextSimTime,
  logs,
}: EvasionContext): void {
  const activeUnits = Object.values(units)
    .filter(isActiveUnit)
    .sort(compareRuntimeUnits);
  const observersBySide: Record<SideId, RuntimeUnit[]> = {
    RED: activeUnits.filter((u) => u.side === 'RED'),
    BLUE: activeUnits.filter((u) => u.side === 'BLUE'),
    NEUTRAL: [],
  };
  const nonInterceptorMissiles = Object.values(weaponsInFlight).filter(
    (m) => m.targetType !== 'missile'
  );
  const observationCache = new Map<
    string,
    Array<{ missile: WeaponInFlight; observed: TacticalContact }>
  >();
  const getObservedFor = (side: SideId, allowPassive: boolean) => {
    const key = `${side}:${allowPassive ? 1 : 0}`;
    let cached = observationCache.get(key);
    if (!cached) {
      const sideObservers = observersBySide[side] ?? [];
      cached = [];
      for (const missile of nonInterceptorMissiles) {
        if (missile.side === side) continue;
        const observed = observeMissile(
          side,
          missile,
          units,
          catalog,
          nextSimTime,
          undefined,
          undefined,
          allowPassive,
          sideObservers
        );
        if (observed) cached.push({ missile, observed });
      }
      observationCache.set(key, cached);
    }
    return cached;
  };

  for (const unit of Object.values(units).sort(compareRuntimeUnits)) {
    if (unit.countermeasureEffect && unit.countermeasureEffect.expiresAtSimTime <= nextSimTime) {
      unit.countermeasureEffect = undefined;
    }
    if (!isActiveUnit(unit)) continue;
    if (unit.status === 'returning' || !unit.doctrine.autoEvade) {
      if (unit.status === 'evading') restoreEvasion(unit);
      else unit.evasionState = undefined;
      continue;
    }
    const triggerRangeKm = unit.domain === 'air' ? 45
      : unit.domain === 'surface' ? 30 : unit.domain === 'subsurface' ? 15 : 8;
    const observedThreats = getObservedFor(unit.side, unit.domain === 'air')
      .flatMap(({ missile, observed }) => {
        const distanceKm = getDistanceKm(unit.position, observed.estimatedPosition);
        const bearingToUnit = getBearingDeg(observed.estimatedPosition, unit.position);
        if (distanceKm > triggerRangeKm || angularDifference(observed.heading, bearingToUnit) > 65) return [];
        return [{ missile, observed, distanceKm }];
      })
      .sort((a, b) => a.distanceKm - b.distanceKm || a.missile.id.localeCompare(b.missile.id));
    const threat = observedThreats[0];

    if (!threat) {
      if (unit.evasionState && nextSimTime >= unit.evasionState.untilSimTime) restoreEvasion(unit);
      continue;
    }

    if (!unit.evasionState) {
      unit.evasionState = {
        threatContactId: threat.observed.id,
        untilSimTime: nextSimTime + EVASION_MEMORY_MS,
        resumeStatus: unit.status === 'engaged' ? 'engaged' : 'operational',
        resumeNavigationMode: unit.navigationMode,
        resumeWaypoints: unit.waypoints.map((waypoint) => ({
          ...waypoint,
          position: [...waypoint.position] as [number, number],
        })),
        resumeMissionTargetId: unit.missionTargetId,
        resumeMissionState: unit.missionState,
        resumeFormationLeaderId: unit.formationLeaderId,
        resumeFormationOffset: unit.formationOffset ? { ...unit.formationOffset } : undefined,
      };
      logs.push({
        id: `evade_${unit.id}_${nextSimTime}`,
        simTime: nextSimTime,
        side: unit.side,
        category: 'DOCTRINE',
        severity: 'warning',
        title: `${unit.callsign} 自动规避来袭武器`,
        message: `本方传感器在 ${threat.distanceKm.toFixed(1)} km 捕获闭合航迹，执行 Beam 机动。`,
        position: [...unit.position],
        unitId: unit.id,
      });
    } else {
      syncExternalEvasionRoute(unit);
      unit.evasionState.threatContactId = threat.observed.id;
      unit.evasionState.untilSimTime = nextSimTime + EVASION_MEMORY_MS;
    }

    if (unit.countermeasures.cooldownUntil <= nextSimTime) {
      let chaff = false;
      let flares = false;
      let acoustic = false;
      if ((unit.domain === 'air' || unit.domain === 'surface' || unit.domain === 'land') && unit.countermeasures.chaff > 0) {
        unit.countermeasures.chaff -= 1;
        chaff = true;
      }
      if (unit.domain === 'air' && unit.countermeasures.flares > 0) {
        unit.countermeasures.flares -= 1;
        flares = true;
      }
      if (unit.domain === 'subsurface' && unit.countermeasures.acousticDecoys > 0) {
        unit.countermeasures.acousticDecoys -= 1;
        acoustic = true;
      }
      if (chaff || flares || acoustic) {
        unit.countermeasures.cooldownUntil = nextSimTime + 15_000;
        unit.countermeasureEffect = {
          chaff: chaff || unit.countermeasureEffect?.chaff === true,
          flares: flares || unit.countermeasureEffect?.flares === true,
          acoustic: acoustic || unit.countermeasureEffect?.acoustic === true,
          expiresAtSimTime: nextSimTime + 20_000,
        };
        logs.push({
          id: `countermeasure_${unit.id}_${nextSimTime}`,
          simTime: nextSimTime,
          side: unit.side,
          category: 'DOCTRINE',
          severity: 'info',
          title: `${unit.callsign} 投放软杀伤诱饵`,
          message: [chaff && '箔条', flares && '红外诱饵', acoustic && '水声诱饵'].filter(Boolean).join('、'),
          position: [...unit.position],
          unitId: unit.id,
        });
      }
    }

    const configuration = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
    const leftBeam = (threat.observed.heading + 90) % 360;
    const rightBeam = (threat.observed.heading + 270) % 360;
    const beamHeading = angularDifference(unit.heading, leftBeam) <= angularDifference(unit.heading, rightBeam)
      ? leftBeam : rightBeam;
    const evadeDistanceKm = unit.domain === 'air' ? 25 : unit.domain === 'surface' ? 12 : 6;
    const evadePoint = turf.destination(unit.position, evadeDistanceKm, beamHeading, { units: 'kilometers' })
      .geometry.coordinates as [number, number];
    unit.status = 'evading';
    unit.navigationMode = 'manual';
    unit.formationLeaderId = undefined;
    unit.formationOffset = undefined;
    unit.missionTargetId = undefined;
    unit.targetSpeedKts = Math.max(unit.targetSpeedKts, configuration.cruiseSpeedKts);
    unit.evasionState.managedWaypointPosition = [...evadePoint];
    unit.waypoints = [{ position: evadePoint, speedKts: Math.min(configuration.maxSpeedKts, configuration.cruiseSpeedKts * 1.15) }];
  }
}
