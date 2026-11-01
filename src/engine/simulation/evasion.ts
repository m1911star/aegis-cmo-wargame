import * as turf from '@turf/turf';
import type { CombatLogEntry, EquipmentCatalog, RuntimeUnit, WeaponInFlight } from '../../types/wargame';
import { resolveUnitConfiguration } from '../../db/unitConfiguration';
import { getBearingDeg, getDistanceKm } from '../geometry';
import { observeMissile } from '../sensors';
import { isActiveUnit } from '../unitCapabilities';

const EVASION_MEMORY_MS = 10_000;

function angularDifference(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function restoreEvasion(unit: RuntimeUnit): void {
  const state = unit.evasionState;
  if (!state) return;
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
  for (const unit of Object.values(units)) {
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
    const observedThreats = Object.values(weaponsInFlight).flatMap((missile) => {
      if (missile.side === unit.side || missile.targetType === 'missile') return [];
      const observed = observeMissile(unit.side, missile, units, catalog, nextSimTime);
      if (!observed) return [];
      const distanceKm = getDistanceKm(unit.position, observed.estimatedPosition);
      const bearingToUnit = getBearingDeg(observed.estimatedPosition, unit.position);
      if (distanceKm > triggerRangeKm || angularDifference(observed.heading, bearingToUnit) > 65) return [];
      return [{ missile, observed, distanceKm }];
    }).sort((a, b) => a.distanceKm - b.distanceKm || a.missile.id.localeCompare(b.missile.id));
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
    unit.waypoints = [{ position: evadePoint, speedKts: Math.min(configuration.maxSpeedKts, configuration.cruiseSpeedKts * 1.15) }];
  }
}
