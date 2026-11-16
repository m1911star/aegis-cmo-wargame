import type { EquipmentCatalog, ScenarioDefinition } from '../types/wargame';
import { array, boolean, coordinate, id, number, object, oneOf, optional, record, taggedUnion, text, isRecord, invalid, type Check } from './schema';

export const SIDC_PATTERN = /^[A-Z0-9*-]{10,20}$/;

export const sidc: Check = (value, path) => {
  text(value, path);
  if (!SIDC_PATTERN.test(value as string)) {
    invalid(path, 'expected a valid 10-20 character MIL-STD-2525 SIDC');
  }
};

export function sanitizeSidc(raw: unknown, fallback = 'SUAPMF------'): string {
  return typeof raw === 'string' && SIDC_PATTERN.test(raw) ? raw : fallback;
}

export function sanitizeMilsymbolSvg(svgHtml: string): string {
  if (!svgHtml) return '';
  return svgHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

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
const cmoArcMask = object({
  SB: optional(boolean), SMF: optional(boolean), SMA: optional(boolean), SS: optional(boolean),
  PS: optional(boolean), PMA: optional(boolean), PMF: optional(boolean), PB: optional(boolean),
});
const signatureProfile = object({
  type: oneOf([
    'radar_em', 'radar_ad', 'passive_sonar_vlf', 'passive_sonar_lf', 'passive_sonar_mf',
    'passive_sonar_hf', 'active_sonar', 'infrared_detect', 'infrared_classify',
    'visual_detect', 'visual_classify',
  ]),
  front: number(), side: number(), rear: number(), top: optional(number()),
});
const oodaProfile = object({
  detectionSec: number(0), targetingSec: number(0), evasionSec: number(0),
});
const warhead = object({
  id, dbid: optional(number(0, Number.MAX_SAFE_INTEGER, true)), name: text, type: text,
  damagePoints: number(0), explosivesType: optional(text), explosivesWeightKg: optional(number(0)),
  numberOfWarheads: optional(number(1, Number.MAX_SAFE_INTEGER, true)), description: optional(text),
});
const mountSpec = object({
  id, dbid: optional(number(0, Number.MAX_SAFE_INTEGER, true)), name: text,
  rofPerMin: number(0), capacity: count, magazineRofPerMin: number(0), magazineCapacity: count,
  damagePoints: number(0), armorGeneral: optional(number(0)),
  trainable: boolean, autonomous: boolean, localControl: optional(boolean),
  weaponIds: identifiers, sensorIds: optional(identifiers), description: optional(text),
});
const magazineSpec = object({
  id, dbid: optional(number(0, Number.MAX_SAFE_INTEGER, true)), name: text,
  rofPerMin: number(0), capacity: count, armorGeneral: optional(number(0)),
  aviationMagazine: optional(boolean), weaponIds: identifiers, description: optional(text),
});
const propulsionSpeedPoint = object({
  altitudeBand: number(1, 10, true), throttle: number(1, 4, true),
  speedKts: number(0), altitudeMinM: number(), altitudeMaxM: number(), consumptionPerHour: number(0),
});
const propulsionSpec = object({
  id, dbid: optional(number(0, Number.MAX_SAFE_INTEGER, true)), name: text, type: text,
  combinedType: optional(text), numberOfEngines: optional(number(0)), numberOfShafts: optional(number(0)),
  thrustMilitaryKn: optional(number(0)), thrustAfterburnerKn: optional(number(0)),
  speedProfile: array(propulsionSpeedPoint), description: optional(text),
});
const commSpec = object({
  id, dbid: optional(number(0, Number.MAX_SAFE_INTEGER, true)), name: text, type: text,
  supportsDatalink: boolean, supportsCec: optional(boolean),
  rangeKm: optional(number(0)), maxChannels: optional(number(0)), description: optional(text),
});
const mount = object({
  mountId: id, weaponId: id, maxAmmo: count, reloadTimeSec: number(0),
  mountSpecId: optional(id), arcs: optional(cmoArcMask),
  trainable: optional(boolean), autonomous: optional(boolean),
  internal: optional(boolean), optional: optional(boolean),
});
const sensor = object({
  ...metadata, codeName: text,
  type: oneOf(['radar_air_surface', 'radar_oth', 'esm', 'ecm_jammer', 'sonar_passive', 'sonar_active', 'irst_optical']),
  maxRangeKm: number(0), isActiveEmitter: boolean, lookDownCapable: boolean,
  detectDomains: array(domain), frequencyBand: text, jammingPowerKw: optional(number(0)),
  coverageArcDeg: optional(number(10, 360)), blindArcRearDeg: optional(number(0, 180)),
  dbid: optional(number(0, Number.MAX_SAFE_INTEGER, true)), role: optional(text), generation: optional(text),
  rangeMinKm: optional(number(0)), altitudeMinM: optional(number()), altitudeMaxM: optional(number()),
  scanIntervalSec: optional(number(0)),
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
  dbid: optional(number(0, Number.MAX_SAFE_INTEGER, true)), weaponType: optional(text), generation: optional(text),
  warheadId: optional(id), warheadCount: optional(number(1, Number.MAX_SAFE_INTEGER, true)),
  cepM: optional(number(0)), cepSurfaceM: optional(number(0)),
  maxFlightTimeSec: optional(number(0)), waypointNumber: optional(count),
  seekerSensorIds: optional(identifiers),
});
const loadout = object({
  ...metadata, codeName: text,
  role: oneOf(['aaw_cap', 'asuw_strike', 'sead_ew', 'asw_patrol', 'multi_mission']),
  compatiblePlatformIds: identifiers, speedPenaltyKts: optional(number(0)), rcsPenaltyM2: optional(number(0)),
  combatRadiusMultiplier: optional(positive), additionalSensorIds: optional(identifiers), mounts: array(mount),
  dbid: optional(number(0, Number.MAX_SAFE_INTEGER, true)), readyTimeSec: optional(number(0)),
  readyTimeSustainedSec: optional(number(0)), defaultCombatRadiusKm: optional(number(0)),
  defaultTimeOnStationMin: optional(number(0)), missionProfile: optional(text),
  payloadWeightDragModifier: optional(number(0)), quickTurnaround: optional(boolean),
  quickTurnaroundReadyTimeSec: optional(number(0)), quickTurnaroundMaxSorties: optional(count),
});
const hangar = object({
  slotId: id, squadronName: text, platformId: id, defaultLoadoutId: id,
  availableLoadoutIds: identifiers, totalAirframes: count, readyAirframes: count, launchCooldownSec: number(0),
  turnaroundSec: optional(number(0)), turnaroundSupplyBatches: optional(count),
});
const platform = object({
  ...metadata, className: text, origin: text, domain, category,
  defaultSidcRed: sidc, defaultSidcBlue: sidc,
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
  dbid: optional(number(0, Number.MAX_SAFE_INTEGER, true)),
  cmoTable: optional(oneOf(['DataAircraft', 'DataShip', 'DataSubmarine', 'DataFacility', 'DataGroundUnit'])),
  operatorCountry: optional(text), operatorService: optional(text),
  yearCommissioned: optional(number(1900, 2100, true)), yearDecommissioned: optional(number(0, 2100, true)),
  physicalSize: optional(text), ergonomics: optional(text), ooda: optional(oodaProfile),
  missileDefense: optional(number(0)), lengthM: optional(number(0)), beamOrSpanM: optional(number(0)),
  displacementTonsOrWeightKg: optional(number(0)), crew: optional(count), hypothetical: optional(boolean),
  propulsionIds: optional(identifiers), magazineIds: optional(identifiers), commIds: optional(identifiers),
  sensorMounts: optional(array(object({
    sensorId: id, componentNumber: optional(count), mastHeightM: optional(number(0)),
    arcs: optional(cmoArcMask), isFireControl: optional(boolean),
  }))),
  signatures: optional(array(signatureProfile)),
});
const catalogFields = {
  version: id, sensors: record(sensor), weapons: record(weapon),
  loadouts: record(loadout), platforms: record(platform),
  warheads: optional(record(warhead)),
  mounts: optional(record(mountSpec)),
  magazines: optional(record(magazineSpec)),
  propulsions: optional(record(propulsionSpec)),
  comms: optional(record(commSpec)),
};
const catalog = object(catalogFields);
const overlay = object(Object.fromEntries(
  Object.entries(catalogFields).map(([key, check]) => [key, optional(check)])
));
const placement = object({
  id, name: text, callsign: text, side, platformId: id, loadoutId: optional(id),
  parentGroupId: id, position: coordinate, spawnJitterKm: optional(number(0, 100)),
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
const seaState = number(0, 6, true);
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
    packageTotSec: optional(number(0)), coordinatedPackageId: optional(text),
    doctrineOverride: optional(doctrine),
  })),
  referencePoints: array(object({ id, name: text, side, position: coordinate, locked: boolean })),
  environment: optional(object({
    landPolygons: array(environmentPolygon),
    acousticZones: array(object({
      id, name: text, areaPolygon: array(coordinate, 3), kind: oneOf(['shallow', 'deep']),
      sonarRangeFactor: number(0.1, 2),
    })),
    weather: optional(object({
      condition: oneOf(['clear', 'overcast', 'rain_storm', 'typhoon_edge']),
      seaState,
      cloudFloorM: number(0, 20000),
      cloudCeilingM: number(0, 25000),
    })),
    weatherZones: optional(array(object({
      id, name: text, areaPolygon: array(coordinate, 3),
      condition: oneOf(['rain_storm', 'heavy_fog']),
      seaStateOverride: optional(seaState),
    }))),
    satellitePasses: optional(array(object({
      id, name: text, side,
      sensorKind: oneOf(['eo_optical', 'sar_radar', 'elint_esm']),
      firstPassSec: number(0),
      intervalSec: number(30),
      swathPolygon: array(coordinate, 3),
    }))),
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
