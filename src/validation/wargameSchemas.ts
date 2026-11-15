import type { EquipmentCatalog, ScenarioDefinition } from '../types/wargame';
import { array, boolean, coordinate, id, number, object, oneOf, optional, record, taggedUnion, text, isRecord, invalid, type Check } from './schema';

const domain = oneOf(['air', 'surface', 'subsurface', 'land']);
const side = oneOf(['RED', 'BLUE', 'NEUTRAL']);
const category = oneOf(['fighter', 'stealth_fighter', 'ew_aircraft', 'awacs', 'tanker', 'bomber', 'mpa_uav', 'decoy', 'sonobuoy', 'carrier', 'amphibious', 'destroyer', 'frigate', 'ssn', 'sam_battery', 'asm_battery', 'ground_force', 'airbase', 'radar_site']);
const count = number(0, Number.MAX_SAFE_INTEGER, true);
const positive = number(Number.MIN_VALUE);
const identifiers = array(id);
const metadata = { id, name: text, description: text };
const waypoint: Check = (value, path) => {
  if (Array.isArray(value)) {
    coordinate(value, path);
    return;
  }
  if (!isRecord(value)) invalid(path, 'expected a coordinate or route-leg object');
  object({
    position: coordinate,
    speedKts: optional(number(0)),
    altitudeM: optional(number()),
  })(value, path);
};
const doctrine = object({
  roe: optional(oneOf(['free', 'tight', 'hold'])),
  emconRadar: optional(boolean), emconSonar: optional(boolean), emconJamming: optional(boolean),
  autoEvade: optional(boolean), engageOpportunityTargets: optional(boolean),
  salvoSize: optional(number(1, Number.MAX_SAFE_INTEGER, true)),
  automaticFireRangeFraction: optional(number(0.05, 1)),
  minimumWeaponReserve: optional(count), automaticTargetDomains: optional(array(domain)),
  minimumAutomaticThreat: optional(oneOf(['low', 'medium', 'high', 'critical'])),
  requireIdentifiedForAutoFire: optional(boolean),
  shootAndScoot: optional(boolean),
  bvrTactics: optional(oneOf(['standard', 'crank_pump'])),
  baffleClearPeriodic: optional(boolean),
});
const mount = object({ mountId: id, weaponId: id, maxAmmo: count, reloadTimeSec: number(0) });
const sensor = object({
  ...metadata, codeName: text,
  type: oneOf(['radar_air_surface', 'radar_oth', 'esm', 'ecm_jammer', 'sonar_passive', 'sonar_active', 'irst_optical']),
  maxRangeKm: number(0), isActiveEmitter: boolean, lookDownCapable: boolean,
  detectDomains: array(domain), frequencyBand: text, jammingPowerKw: optional(number(0)),
  coverageArcDeg: optional(number(10, 360)), blindArcRearDeg: optional(number(0, 180)),
});
const altitudeBand: Check = (value, path) => {
  array(number(), 2)(value, path);
  const arr = value as number[];
  if (arr.length !== 2 || arr[0] > arr[1]) invalid(path, 'expected [minAltitudeM, maxAltitudeM] with min <= max');
};
const weapon = object({
  ...metadata, codeName: text,
  category: oneOf(['aam', 'sam', 'ashm', 'lacm', 'torpedo', 'arm']),
  guidance: oneOf(['active_radar', 'semi_active_radar', 'infrared', 'hypersonic_glide', 'acoustic_homing', 'anti_radiation']),
  targetDomains: array(domain), canInterceptMissile: boolean,
  maxRangeKm: positive, minRangeKm: number(0), speedKts: positive, cruiseAltitudeM: number(),
  basePk: number(0, 1), warheadDamage: number(0), salvoDefault: number(1, Number.MAX_SAFE_INTEGER, true),
  flightProfile: optional(oneOf(['cruise_flat', 'sea_skimming', 'ballistic_loft', 'hypersonic_glide'])),
  interceptAltitudeBandM: optional(altitudeBand),
  requiresDatalinkBeyondHorizon: optional(boolean),
  launchMedium: optional(oneOf(['direct', 'air_drop'])),
  airDropRangeKm: optional(positive), airDropSpeedKts: optional(positive),
  waterEntrySpeedKts: optional(positive), waterEntryAltitudeM: optional(number(-1000, -0.1)),
  guidanceProfile: optional(object({
    activationRangeKm: optional(positive), seekerRangeKm: optional(positive),
    seekerFovDeg: optional(number(Number.MIN_VALUE, 360)), searchDurationSec: optional(positive),
    maxTrackAgeSec: optional(number(0)), maxUncertaintyKm: optional(number(0)),
    receivesUpdates: optional(boolean), requiresSupport: optional(boolean),
  })),
});
const loadout = object({
  ...metadata, codeName: text,
  role: oneOf(['aaw_cap', 'asuw_strike', 'sead_ew', 'asw_patrol', 'multi_mission']),
  compatiblePlatformIds: identifiers, speedPenaltyKts: optional(number(0)), rcsPenaltyM2: optional(number(0)),
  combatRadiusMultiplier: optional(positive), additionalSensorIds: optional(identifiers), mounts: array(mount),
});
const hangar = object({
  slotId: id, squadronName: text, platformId: id, defaultLoadoutId: id,
  availableLoadoutIds: identifiers, totalAirframes: count, readyAirframes: count, launchCooldownSec: number(0),
  turnaroundSec: optional(number(0)), turnaroundSupplyBatches: optional(count),
});
const platform = object({
  ...metadata, className: text, origin: text, domain, category,
  defaultSidcRed: text, defaultSidcBlue: text,
  maxSpeedKts: number(0), cruiseSpeedKts: number(0), defaultAltitudeM: number(),
  minAltitudeM: number(), maxAltitudeM: number(), radarAntennaHeightM: number(0),
  maxFuelSec: number(0), maxHp: positive, rcsM2: number(0),
  rcsProfile: optional(object({ frontalM2: number(0), beamM2: number(0), rearM2: number(0) })),
  ecmStrength: optional(number(0, 0.75)), acousticSignatureDb: number(0), hasDatalink: boolean,
  maxGuidanceChannels: optional(number(1, 128, true)),
  ciwsDefenseProb: number(0, 1), sensorIds: identifiers,
  defaultLoadoutId: optional(id), availableLoadoutIds: optional(identifiers),
  mounts: array(mount), hangarSlots: optional(array(hangar)),
  aarFuelCapacitySec: optional(number(0)), aarTransferRateSecPerSec: optional(number(0)),
  canReceiveAar: optional(boolean),
  deployables: optional(array(object({ platformId: id, count }))),
});
const catalogFields = {
  version: id, sensors: record(sensor), weapons: record(weapon),
  loadouts: record(loadout), platforms: record(platform),
};
const catalog = object(catalogFields);
const overlay = object(Object.fromEntries(
  Object.entries(catalogFields).map(([key, check]) => [key, optional(check)])
));
const placement = object({
  id, name: text, callsign: text, side, platformId: id, loadoutId: optional(id),
  parentGroupId: id, position: coordinate, spawnJitterKm: optional(number(0)),
  appearProbability: optional(number(0, 1)), altitudeM: optional(number()), heading: number(),
  speedKts: optional(number(0)), waypoints: optional(array(waypoint)),
  doctrine: optional(doctrine), assignedMissionId: optional(id),
  recoveryPosition: optional(coordinate),
});
const trigger = taggedUnion({
  TIME_ELAPSED: object({ elapsedSec: number(0) }),
  UNIT_DESTROYED: object({ unitId: optional(id), targetSide: optional(side), targetCategory: optional(category) }),
  UNIT_DETECTED: object({ observerSide: side, targetUnitId: optional(id), targetCategory: optional(category),
    targetDomain: optional(domain), minimumClassification: optional(oneOf(['unknown', 'classified', 'identified'])) }),
  UNIT_ENTERS_AREA: object({ side, unitCategory: optional(category), areaPolygon: array(coordinate, 3) }),
});
const action = taggedUnion({
  SPAWN_REINFORCEMENTS: object({ units: array(placement) }),
  ACTIVATE_MISSION: object({ missionId: id, isActive: boolean }),
  UPDATE_SIDE_DOCTRINE: object({ side, groupId: optional(id), doctrinePatch: doctrine }),
  LAUNCH_SORTIE: object({
    carrierUnitId: id, hangarSlotId: id, loadoutId: optional(id), assignedMissionId: optional(id),
    launchDelaySec: optional(number(0)),
  }),
  DEPLOY_CARRIED: object({
    launcherUnitId: id, platformId: id, count: optional(count), targetWaypoint: optional(coordinate),
    assignedMissionId: optional(id),
  }),
  ASSIGN_MISSION: object({ side, unitId: optional(id), groupId: optional(id), missionId: optional(id) }),
  TOGGLE_SIDE_EMCON: object({ side, groupId: optional(id), sensor: oneOf(['radar', 'sonar', 'jamming']) }),
  COORDINATE_ATTACK: object({ side, groupId: optional(id), targetDomain: optional(domain), delaySec: number(0) }),
  BROADCAST_MESSAGE: object({
    side: oneOf(['RED', 'BLUE', 'NEUTRAL', 'SYSTEM']), severity: oneOf(['info', 'warning', 'critical']),
    title: text, message: text, position: optional(coordinate),
  }),
  AWARD_SCORE: object({ side, points: number(), reason: text }),
});
const environmentPolygon = object({
  id, name: text, areaPolygon: array(coordinate, 3), elevationM: optional(number(0, 9000)),
});
const scenario = object({
  id, title: text, subtitle: text, theater: text, difficulty: oneOf(['STANDARD', 'HARD', 'EXTREME']),
  startTimeIso: text,
  initialCamera: object({ center: coordinate, zoom: number(0, 24), pitch: optional(number(0, 85)), bearing: optional(number()) }),
  briefing: object({ situation: text, redObjective: text, blueObjective: text, tacticalTips: array(text) }),
  groups: array(object({ ...metadata, side, commandTitle: text })),
  units: array(placement),
  missions: array(object({
    ...metadata, side, type: oneOf(['aaw_patrol', 'asuw_patrol', 'asw_patrol', 'land_strike', 'aew_support', 'escort', 'sead', 'tanker_support']),
    isActive: boolean, areaPolygon: array(coordinate, 3), assignedUnitIds: optional(identifiers),
    prosecuteOutsideAreaKm: number(0), escortUnitId: optional(id), stationRadiusKm: optional(number(0)),
    doctrineOverride: optional(doctrine),
  })),
  referencePoints: array(object({ id, name: text, side, position: coordinate, locked: boolean })),
  environment: optional(object({
    landPolygons: array(environmentPolygon),
    acousticZones: array(object({
      id, name: text, areaPolygon: array(coordinate, 3), kind: oneOf(['shallow', 'deep']),
      sonarRangeFactor: number(0.1, 2),
    })),
  })),
  events: optional(array(object({
    ...metadata, repeatable: optional(boolean), repeatIntervalSec: optional(number(1)), trigger, actions: array(action),
  }))),
  victoryConditions: optional(object({
    durationSec: positive, decisiveVictoryThreshold: positive, tacticalVictoryThreshold: positive,
    keyTargetBonuses: optional(array(object({ unitId: optional(id), category: optional(category), victimSide: side, bonusPoints: number(), label: text }))),
  })),
  customCatalogOverlay: optional(overlay),
  objectives: optional(array(object({
    id, side: oneOf(['RED', 'BLUE']), title: text,
    type: oneOf(['destroy', 'disable', 'preserve', 'observe', 'withdraw', 'control_area']),
    unitIds: array(id), areaPolygon: optional(array(coordinate, 3)), controlDomains: optional(array(domain)),
    holdDurationSec: optional(number(1)),
    required: boolean, points: number(0), criticalFailure: optional(boolean), preserveCapability: optional(boolean),
    withdrawAreaPolygon: optional(array(coordinate, 3)), withdrawUnitDomains: optional(array(domain, 1)),
  }))),
});

export function assertCatalogShape(value: unknown): asserts value is EquipmentCatalog {
  catalog(value, 'catalog');
}

export function assertScenarioShape(value: unknown): asserts value is ScenarioDefinition {
  scenario(value, 'scenario');
}
