import * as turf from '@turf/turf';
import { resolveUnitConfiguration } from '../../db/unitConfiguration';
import type {
  CombatLogEntry,
  EquipmentCatalog,
  RuntimeUnit,
  ScoreLedger,
  TacticalContact,
  TacticalMission,
} from '../../types/wargame';
import { getBearingDeg, getDistanceKm } from '../geometry';
import { updateUnitOperations } from '../operations';
import { getUnitCapabilities, isActiveUnit } from '../unitCapabilities';

const KTS_TO_KMPH = 1.852;

export type UnitPhysicsContext = {
  units: Record<string, RuntimeUnit>;
  previousContacts: Record<string, TacticalContact>;
  missions: TacticalMission[];
  catalog: EquipmentCatalog;
  nextSimTime: number;
  dtSec: number;
  score: ScoreLedger;
  logs: CombatLogEntry[];
};

/** Advance platform readiness, operations, navigation and kinematics for one tick. */
export function advanceUnitPhysics({
  units,
  previousContacts,
  missions,
  catalog,
  nextSimTime,
  dtSec,
  score,
  logs,
}: UnitPhysicsContext): void {
  const configurations = new Map(
    Object.values(units).map((unit) => [
      unit.id,
      resolveUnitConfiguration(
        catalog,
        unit.platformId,
        unit.activeLoadoutId
      ),
    ])
  );

  for (const unit of Object.values(units)) {
    if (!isActiveUnit(unit)) continue;

    for (const mount of unit.mounts) {
      if (mount.cooldownRemainingSec > 0) {
        mount.cooldownRemainingSec = Math.max(
          0,
          mount.cooldownRemainingSec - dtSec
        );
      }
    }

    for (const slot of unit.hangar || []) {
      const wasPreparing =
        slot.cooldownRemainingSec > 0 || slot.readyAirframes === 0;
      if (slot.cooldownRemainingSec > 0) {
        slot.cooldownRemainingSec = Math.max(
          0,
          slot.cooldownRemainingSec - dtSec
        );
      }
      if (
        wasPreparing &&
        slot.cooldownRemainingSec === 0 &&
        slot.reserveAirframes > 0
      ) {
        slot.reserveAirframes -= 1;
        slot.readyAirframes += 1;
      }
    }

    const configuration = configurations.get(unit.id)!;
    updateUnitOperations(
      unit,
      units,
      previousContacts,
      missions,
      catalog,
      nextSimTime,
      dtSec,
      score,
      logs
    );
    if (!isActiveUnit(unit)) continue;

    const speedLimit =
      configuration.maxSpeedKts * getUnitCapabilities(unit).speedFactor;
    unit.targetSpeedKts = Math.max(
      0,
      Math.min(speedLimit, unit.targetSpeedKts)
    );
    unit.speedKts = Math.max(0, Math.min(speedLimit, unit.speedKts));

    if (Math.abs(unit.altitudeM - unit.targetAltitudeM) > 1) {
      const climbRateMps = unit.domain === 'air' ? 35 : 4;
      const maxDeltaAlt = climbRateMps * dtSec;
      const diff = unit.targetAltitudeM - unit.altitudeM;
      unit.altitudeM +=
        Math.sign(diff) * Math.min(Math.abs(diff), maxDeltaAlt);
    }

    if (Math.abs(unit.speedKts - unit.targetSpeedKts) > 0.5) {
      const accelKtsPerSec = unit.domain === 'air' ? 15 : 1.5;
      const diff = unit.targetSpeedKts - unit.speedKts;
      unit.speedKts +=
        Math.sign(diff) * Math.min(Math.abs(diff), accelKtsPerSec * dtSec);
    }

    if (
      unit.waypoints.length === 0 &&
      unit.assignedMissionId &&
      unit.navigationMode !== 'manual' &&
      unit.status !== 'returning'
    ) {
      const mission = missions.find(
        (candidate) =>
          candidate.id === unit.assignedMissionId && candidate.isActive
      );
      if (mission && mission.areaPolygon.length >= 3) {
        unit.waypoints.push(
          turf.pointOnFeature(
            turf.polygon([
              [...mission.areaPolygon, mission.areaPolygon[0]],
            ])
          ).geometry.coordinates as [number, number]
        );
      }
    }

    if (unit.speedKts <= 0.1) continue;
    const stepDistKm = (unit.speedKts * KTS_TO_KMPH * dtSec) / 3600;

    if (unit.waypoints.length > 0) {
      const targetWaypoint = unit.waypoints[0];
      const distanceToWaypointKm = getDistanceKm(
        unit.position,
        targetWaypoint
      );
      unit.heading = getBearingDeg(unit.position, targetWaypoint);

      if (distanceToWaypointKm <= stepDistKm * 1.25) {
        unit.position = [...targetWaypoint];
        unit.waypoints.shift();
      } else {
        unit.position = turf.destination(
          unit.position,
          stepDistKm,
          unit.heading,
          { units: 'kilometers' }
        ).geometry.coordinates as [number, number];
      }
    } else {
      if (unit.domain === 'air') {
        unit.heading = (unit.heading + 1.8 * dtSec) % 360;
      }
      unit.position = turf.destination(
        unit.position,
        stepDistKm,
        unit.heading,
        { units: 'kilometers' }
      ).geometry.coordinates as [number, number];
    }
  }
}
