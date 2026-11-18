import type {
  EquipmentCatalog,
  MissionDefinition,
  RuntimeUnit,
  TacticalContact,
  TacticalMission,
  WeaponInFlight,
} from '../types/wargame';
import { getCompiledPolygon, pointInBbox } from './environment';
import { getDistanceKm } from './geometry';
import * as turf from './turfGeo';
import { isActiveUnit } from './unitCapabilities';

const RADAR_EMITTER_CATEGORIES = new Set<RuntimeUnit['category']>([
  'sam_battery',
  'radar_site',
  'destroyer',
  'awacs',
]);

const SAM_RADAR_THREAT_CATEGORIES = new Set<RuntimeUnit['category']>([
  'sam_battery',
  'radar_site',
]);

export function deriveMissionAssignments(
  missions: readonly MissionDefinition[],
  units: Record<string, RuntimeUnit>
): TacticalMission[] {
  const assigned = new Map<string, string[]>();
  for (const unit of Object.values(units)) {
    if (!unit.assignedMissionId || !isActiveUnit(unit)) continue;
    const ids = assigned.get(unit.assignedMissionId) ?? [];
    ids.push(unit.id);
    assigned.set(unit.assignedMissionId, ids);
  }
  return missions.map((mission) => ({
    ...mission,
    areaPolygon: mission.areaPolygon,
    doctrineOverride: mission.doctrineOverride ? {
      ...mission.doctrineOverride,
      automaticTargetDomains: mission.doctrineOverride.automaticTargetDomains
        ? [...mission.doctrineOverride.automaticTargetDomains] : undefined,
    } : undefined,
    assignedUnitIds: assigned.get(mission.id) ?? [],
  }));
}

export function unitHasArmWeapon(unit: RuntimeUnit, catalog: EquipmentCatalog): boolean {
  return unit.mounts.some(
    (mount) => mount.currentAmmo > 0 && catalog.weapons[mount.weaponId]?.category === 'arm'
  );
}

export function isSeadOrEwUnit(
  unit: RuntimeUnit,
  catalog: EquipmentCatalog,
  mission?: MissionDefinition
): boolean {
  return (
    mission?.type === 'sead' ||
    unit.category === 'ew_aircraft' ||
    unitHasArmWeapon(unit, catalog)
  );
}

export function isPriorityRadarEmitterCategory(
  category: TacticalContact['identifiedCategory'] | undefined
): boolean {
  return !!category && RADAR_EMITTER_CATEGORIES.has(category);
}

export function getSeadTargetPriority(contact: TacticalContact): number {
  const isEmitterObserved = contact.emitterObserved === true;
  const isPriorityCategory = isPriorityRadarEmitterCategory(contact.identifiedCategory);
  const isUnidentifiedLandEmitter =
    isEmitterObserved && contact.domain === 'land' && !contact.identifiedCategory;
  if (isEmitterObserved && (isPriorityCategory || isUnidentifiedLandEmitter)) return 0;
  if (isEmitterObserved) return 1;
  if (isPriorityCategory) return 2;
  return 3;
}

export interface StrikeCoordinationContext {
  hasFriendlySeadSupport: boolean;
  hasActiveSamRadarThreats: boolean;
  armInFlightTargetIds: Set<string>;
  armInFlightAny: boolean;
  friendlyTargetedContactIds: Set<string>;
  inboundFriendlyMissileCount: Map<string, number>;
}

function isUnitNearMissionArea(
  position: [number, number],
  mission: MissionDefinition,
  maxDistanceKm: number
): boolean {
  const compiled = getCompiledPolygon(mission.areaPolygon);
  if (pointInBbox(position, compiled.bbox) && turf.booleanPointInPolygon(position, compiled.feature)) {
    return true;
  }
  return turf.pointToLineDistance(position, compiled.boundary, { units: 'kilometers' }) <= maxDistanceKm;
}

export function assessStrikeCoordination(
  unit: RuntimeUnit,
  mission: MissionDefinition,
  units: Record<string, RuntimeUnit>,
  contacts: Record<string, TacticalContact>,
  missions: readonly MissionDefinition[],
  catalog: EquipmentCatalog,
  simTime: number,
  weaponsInFlight: Record<string, WeaponInFlight>
): StrikeCoordinationContext {
  const activeMissions = new Map(
    missions.filter((m) => m.isActive).map((m) => [m.id, m])
  );
  const friendlyTargetedContactIds = new Set<string>();
  const inboundFriendlyMissileCount = new Map<string, number>();
  const armInFlightTargetIds = new Set<string>();
  let armInFlightAny = false;

  for (const weapon of Object.values(weaponsInFlight)) {
    if (weapon.side !== unit.side || weapon.isIntercepted || weapon.targetType === 'missile') continue;
    inboundFriendlyMissileCount.set(
      weapon.targetId,
      (inboundFriendlyMissileCount.get(weapon.targetId) ?? 0) + 1
    );
    if (catalog.weapons[weapon.weaponId]?.category === 'arm') {
      armInFlightAny = true;
      armInFlightTargetIds.add(weapon.targetId);
    }
  }

  let hasFriendlySeadSupport = false;
  for (const other of Object.values(units)) {
    if (other.id === unit.id || other.side !== unit.side || !isActiveUnit(other) || other.status === 'returning') {
      continue;
    }
    if (other.missionTargetId) {
      friendlyTargetedContactIds.add(other.missionTargetId);
    }
    const otherMission = other.assignedMissionId ? activeMissions.get(other.assignedMissionId) : undefined;
    if (!isSeadOrEwUnit(other, catalog, otherMission)) continue;

    const sameMission = other.assignedMissionId === mission.id;
    const nearStrikeArea =
      isUnitNearMissionArea(other.position, mission, 180) ||
      getDistanceKm(other.position, unit.position) <= 180;
    const activelySuppressing =
      otherMission?.type === 'sead' ||
      other.missionState === 'engaging' ||
      (other.category === 'ew_aircraft' && other.doctrine.emconJamming);

    if (sameMission || (activelySuppressing && (nearStrikeArea || armInFlightAny))) {
      hasFriendlySeadSupport = true;
    }
  }

  let hasActiveSamRadarThreats = false;
  for (const contact of Object.values(contacts)) {
    if (contact.observerSide !== unit.side || simTime - contact.lastDetectedTime > 10_000) continue;
    if (contact.emitterObserved !== true) continue;
    if (
      contact.identifiedCategory &&
      (SAM_RADAR_THREAT_CATEGORIES.has(contact.identifiedCategory) ||
        ((mission.type === 'asuw_patrol' || mission.type === 'maritime_strike') &&
          contact.identifiedCategory === 'destroyer'))
    ) {
      hasActiveSamRadarThreats = true;
      break;
    }
  }

  return {
    hasFriendlySeadSupport,
    hasActiveSamRadarThreats,
    armInFlightTargetIds,
    armInFlightAny,
    friendlyTargetedContactIds,
    inboundFriendlyMissileCount,
  };
}

export function isActiveSamRadarContact(
  contact: TacticalContact,
  missionType: MissionDefinition['type']
): boolean {
  if (contact.emitterObserved !== true) return false;
  if (contact.bdaStatus === 'damaged_suspected' || contact.bdaStatus === 'kill_unconfirmed') {
    return false;
  }
  if (!contact.identifiedCategory) return false;
  if (SAM_RADAR_THREAT_CATEGORIES.has(contact.identifiedCategory)) return true;
  return (
    (missionType === 'asuw_patrol' || missionType === 'maritime_strike') &&
    contact.identifiedCategory === 'destroyer'
  );
}

export function getStrikeTargetPriority(
  contact: TacticalContact,
  missionType: MissionDefinition['type'],
  coordination: StrikeCoordinationContext
): number {
  if (contact.bdaStatus === 'kill_unconfirmed') return 5;
  const alreadyTargeted =
    coordination.friendlyTargetedContactIds.has(contact.id) ||
    (coordination.inboundFriendlyMissileCount.get(contact.actualUnitId) ?? 0) > 0 ||
    (coordination.inboundFriendlyMissileCount.get(contact.id) ?? 0) > 0;
  const activeSamThreat =
    coordination.hasFriendlySeadSupport &&
    coordination.hasActiveSamRadarThreats &&
    isActiveSamRadarContact(contact, missionType);

  if (activeSamThreat) {
    return alreadyTargeted ? 4 : 3;
  }
  if (
    missionType === 'maritime_strike' &&
    (contact.identifiedCategory === 'carrier' || contact.identifiedCategory === 'amphibious')
  ) {
    return alreadyTargeted ? 1 : 0;
  }
  return missionType === 'maritime_strike'
    ? alreadyTargeted ? 2 : 1
    : alreadyTargeted ? 1 : 0;
}
