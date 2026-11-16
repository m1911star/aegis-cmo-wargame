import * as turf from './turfGeo';
import type { BearingObservation, CombatLogEntry, Domain, EquipmentCatalog, PlatformSensorMount, PlatformSpec, RuntimeUnit, ScenarioEnvironment, SensorSpec, SideId, TacticalContact, WeaponInFlight } from '../types/wargame';
import { isBearingInCmoArcs, resolvePlatformAcousticDb, resolvePlatformRcsProfile } from './cmoUnits';
import { resolveUnitConfiguration } from './unitConfiguration';
import {
  acousticRangeFactor,
  evaluateWeatherModifiers,
  hasRadarLineOfSight,
  isPointInCompiledPolygon,
} from './environment';
import { calculateRadarHorizonKm, getBearingDeg, getDistanceKm } from './geometry';
import { compareRuntimeUnits, getUnitCapabilities, isActiveUnit, isRadioEmitting } from './unitCapabilities';
import {
  REFERENCE_RCS_M2,
  RCS_ASPECT_ANGLE,
  ECM_SUPPRESSION,
  SEA_CLUTTER_FACTOR,
  COUNTER_STEALTH_MIN_RCS,
  THERMOCLINE,
  ACTIVE_SONAR_PING_BONUS,
  SONAR_DETECTION,
  LOW_ALTITUDE_THRESHOLD,
} from './constants';

/**
 * 1. ★ 传感器方位视界与尾流挡音盲区几何判定 (Sensor Azimuth Arc & Sonar Rear Baffles)
 * - coverageArcDeg < 360: 仅机头/舰首正前 ±(coverageArcDeg/2) 扇区内有效
 * - blindArcRearDeg > 0: 正尾向 ±(blindArcRearDeg/2) 为螺旋桨空泡/挡音盲区 (Baffles)
 */
export function isTargetWithinSensorArc(
  observerHeadingDeg: number,
  observerPosition: [number, number],
  targetPosition: [number, number],
  sensor: Pick<SensorSpec, 'coverageArcDeg' | 'blindArcRearDeg'>,
  sensorMount?: Pick<PlatformSensorMount, 'arcs'>
): boolean {
  if (sensorMount?.arcs) {
    if (getDistanceKm(observerPosition, targetPosition) <= 0.05) return true;
    const bearingToTarget = getBearingDeg(observerPosition, targetPosition);
    return isBearingInCmoArcs(observerHeadingDeg, bearingToTarget, sensorMount.arcs);
  }
  const coverage = sensor.coverageArcDeg ?? 360;
  const blindRear = sensor.blindArcRearDeg ?? 0;
  if (coverage >= 360 && blindRear <= 0) return true;
  if (getDistanceKm(observerPosition, targetPosition) <= 0.05) return true;

  const bearingToTarget = getBearingDeg(observerPosition, targetPosition);
  const offNoseDeg = Math.abs(((bearingToTarget - observerHeadingDeg + 540) % 360) - 180);
  if (coverage < 360 && offNoseDeg > coverage * 0.5) {
    return false;
  }
  if (blindRear > 0 && 180 - offNoseDeg <= blindRear * 0.5) {
    return false;
  }
  return true;
}

/**
 * 2. ★ 计算考虑目标姿态角 (Aspect Angle) 与挂载方案 (Loadout) 后的瞬时等效 RCS (m²)
 * - 正前方 (0° ~ 35°): frontalM2 (五代机隐身最优区)
 * - 正侧向 (35° ~ 135°): beamM2 (侧翼进气道与垂尾强反射，RCS 暴增 15~35 倍)
 * - 尾喷口向 (135° ~ 180°): rearM2
 */
export function calculateAspectEffectiveRcsM2(
  targetSpec: PlatformSpec,
  observerPosition: [number, number],
  targetPosition: [number, number],
  targetHeadingDeg: number,
  loadoutRcsPenaltyM2 = 0
): number {
  const profile = resolvePlatformRcsProfile(targetSpec);
  if (!profile) {
    return Math.max(0.001, targetSpec.rcsM2 + loadoutRcsPenaltyM2);
  }

  // 计算从目标指向观察者的方位角，与目标当前机头航向的夹角 (0° = 正对雷达, 90° = 侧身暴露, 180° = 背对雷达)
  const bearingTargetToObs = getBearingDeg(targetPosition, observerPosition);
  const rawDiff = Math.abs(bearingTargetToObs - targetHeadingDeg) % 360;
  const aspectAngleDeg = rawDiff > 180 ? 360 - rawDiff : rawDiff;

  let baseRcs: number;
  if (aspectAngleDeg <= RCS_ASPECT_ANGLE.FRONTAL_MAX) {
    baseRcs = profile.frontalM2;
  } else if (aspectAngleDeg <= RCS_ASPECT_ANGLE.BEAM_MAX) {
    // 在正前方到侧向之间平滑过渡至侧向峰值 beamM2
    const t =
      1 - Math.abs(aspectAngleDeg - RCS_ASPECT_ANGLE.BEAM_PEAK) / RCS_ASPECT_ANGLE.TRANSITION_HALF_WIDTH;
    baseRcs =
      profile.frontalM2 +
      Math.max(0.25, Math.min(1, t)) * (profile.beamM2 - profile.frontalM2);
  } else {
    baseRcs = profile.rearM2;
  }

  return Math.max(0.001, baseRcs + loadoutRcsPenaltyM2);
}

/**
 * 3. 计算考虑目标 RCS 四次方根律、米波反隐身修正与有源电子干扰 (OECM) 压制后的实际雷达探测距离 (km)
 * @param ecmSuppressionFactor 电子干扰压制因子 (0.0 = 无干扰, 0.65 = 强伴随干扰)，将雷达烧穿距离压缩为 (1 - factor * 0.65)
 */
export function calculateEffectiveRadarRangeKm(
  sensor: SensorSpec,
  targetRcsM2: number,
  observerAltM: number,
  observerAntennaM: number,
  targetAltM: number,
  ecmSuppressionFactor = 0,
  rangeMultiplier = 1
): number {
  const horizonKm = calculateRadarHorizonKm(
    observerAltM,
    observerAntennaM,
    targetAltM
  );
  if (horizonKm <= 0 || rangeMultiplier <= 0) return 0;

  const isCounterStealthBand =
    sensor.type === 'radar_oth' ||
    sensor.frequencyBand.includes('VHF') ||
    sensor.frequencyBand.includes('UHF');

  const effectiveRcs = isCounterStealthBand
    ? Math.max(targetRcsM2, COUNTER_STEALTH_MIN_RCS)
    : Math.max(targetRcsM2, 0.001);

  const rcsFactor = Math.pow(effectiveRcs / REFERENCE_RCS_M2, 0.25);
  const clutterModifier =
    targetAltM > 0 && targetAltM < LOW_ALTITUDE_THRESHOLD && !sensor.lookDownCapable
      ? SEA_CLUTTER_FACTOR
      : 1.0;

  // 电子战压制效应 (Burn-through Range Reduction)：米波/数字阵列雷达抗干扰稍强
  const eccmResistance = isCounterStealthBand ? ECM_SUPPRESSION.COUNTER_STEALTH_ECCM_BONUS : 0.0;
  const jammerMultiplier = Math.max(
    ECM_SUPPRESSION.MIN_DETECTION_RATIO,
    1 - Math.max(0, ecmSuppressionFactor) * (ECM_SUPPRESSION.MAX_BURN_THROUGH_REDUCTION - eccmResistance * 0.25)
  );

  const powerLimitedRangeKm =
    sensor.maxRangeKm * rangeMultiplier * rcsFactor * clutterModifier * jammerMultiplier;
  return Math.min(horizonKm, powerLimitedRangeKm);
}

/**
 * 4. 计算水声声呐探测距离 (考虑温跃层深度 -120m 遮蔽与主动/被动声呐特性)
 */
export function calculateSonarDetectionRangeKm(
  sensor: SensorSpec,
  observerAltM: number,
  targetAltM: number,
  targetAcousticDb: number,
  targetSpeedKts: number,
  targetSonarActive: boolean
): number {
  if (sensor.type === 'sonar_passive' && targetSonarActive) {
    return sensor.maxRangeKm * ACTIVE_SONAR_PING_BONUS;
  }

  const isVariableDepth = /towed|dipping|sonobuoy|dicass|difar|vds/i.test(
    `${sensor.id} ${sensor.name} ${sensor.codeName ?? ''}`
  );

  const acrossThermocline =
    (observerAltM > THERMOCLINE.UPPER_BOUNDARY && targetAltM < THERMOCLINE.LOWER_BOUNDARY) ||
    (observerAltM < THERMOCLINE.LOWER_BOUNDARY && targetAltM > THERMOCLINE.UPPER_BOUNDARY);
  const sameDeepLayer =
    observerAltM < THERMOCLINE.LOWER_BOUNDARY && targetAltM < THERMOCLINE.LOWER_BOUNDARY;
  const thermoclineFactor = acrossThermocline
    ? (isVariableDepth
        ? THERMOCLINE.VARIABLE_DEPTH_CROSS_LAYER_FACTOR
        : THERMOCLINE.HULL_CROSS_LAYER_FACTOR)
    : sameDeepLayer
      ? THERMOCLINE.SAME_DEEP_LAYER_BONUS
      : 1.0;

  if (sensor.type === 'sonar_active') {
    return sensor.maxRangeKm * thermoclineFactor;
  }

  const excessSpeed = Math.max(0, targetSpeedKts - SONAR_DETECTION.SPEED_NOISE_THRESHOLD);
  const speedNoiseBonus =
    1 + Math.pow(excessSpeed, SONAR_DETECTION.SPEED_NOISE_EXPONENT) * SONAR_DETECTION.SPEED_NOISE_COEFFICIENT;
  const acousticFactor = Math.max(
    SONAR_DETECTION.MIN_ACOUSTIC_FACTOR,
    (targetAcousticDb - SONAR_DETECTION.BASELINE_ACOUSTIC_DB) / SONAR_DETECTION.ACOUSTIC_NORMALIZATION
  );
  return (
    sensor.maxRangeKm * acousticFactor * speedNoiseBonus * thermoclineFactor
  );
}

export function buildAouPolygon(
  center: [number, number],
  radiusKm: number
): [number, number][] {
  if (radiusKm <= 0.8) return [];
  const circle = turf.circle(center, radiusKm, {
    steps: 16,
    units: 'kilometers',
  });
  return circle.geometry.coordinates[0] as [number, number][];
}

export function buildBearingCorridor(observation: BearingObservation): [number, number][] {
  const nearKm = Math.min(1, observation.maxRangeKm * 0.02);
  const leftNear = turf.destination(observation.origin, nearKm, observation.bearingDeg - observation.errorDeg,
    { units: 'kilometers' }).geometry.coordinates as [number, number];
  const leftFar = turf.destination(observation.origin, observation.maxRangeKm, observation.bearingDeg - observation.errorDeg,
    { units: 'kilometers' }).geometry.coordinates as [number, number];
  const rightFar = turf.destination(observation.origin, observation.maxRangeKm, observation.bearingDeg + observation.errorDeg,
    { units: 'kilometers' }).geometry.coordinates as [number, number];
  const rightNear = turf.destination(observation.origin, nearKm, observation.bearingDeg + observation.errorDeg,
    { units: 'kilometers' }).geometry.coordinates as [number, number];
  return [leftNear, leftFar, rightFar, rightNear, leftNear];
}

export function fuseBearingObservations(observations: BearingObservation[]) {
  if (observations.length < 2) return undefined;
  const [first, second] = observations;
  const line = (observation: BearingObservation) => turf.lineString([
    observation.origin,
    turf.destination(observation.origin, observation.maxRangeKm, observation.bearingDeg,
      { units: 'kilometers' }).geometry.coordinates,
  ]);
  const intersections = turf.lineIntersect(line(first), line(second));
  const estimatedPosition = intersections.features[0]?.geometry.coordinates as [number, number] | undefined;
  if (!estimatedPosition) return undefined;
  const crossingAngle = Math.max(10, Math.min(90,
    Math.abs(((first.bearingDeg - second.bearingDeg + 540) % 360) - 180)));
  const majorKm = Math.max(2, Math.min(25,
    (first.errorDeg + second.errorDeg) * 1.8 / Math.sin(crossingAngle * Math.PI / 180)));
  const minorKm = Math.max(1, majorKm * 0.38);
  const ellipse = turf.ellipse(estimatedPosition, majorKm, minorKm, {
    angle: first.bearingDeg,
    steps: 24,
    units: 'kilometers',
  });
  return {
    estimatedPosition,
    uncertaintyRadiusKm: majorKm,
    uncertaintyPolygon: ellipse.geometry.coordinates[0] as [number, number][],
  };
}

export function getContactSidc(
  domain: Domain,
  classification: TacticalContact['classification'],
  targetSide: SideId
): string {
  const aff =
    classification === 'unknown' ? 'U' : targetSide === 'RED' ? 'H' : 'F';
  switch (domain) {
    case 'air':
      return `S${aff}APMF------`;
    case 'surface':
      return `S${aff}SPCLDD----`;
    case 'subsurface':
      return `S${aff}UPSN------`;
    case 'land':
      return `S${aff}GPUCDM----`;
  }
}

/**
 * 计算单位当前开启 OECM 后的有效干扰压制强度 (0.0 - 0.75) 与覆盖半径 (km)
 * 同时考虑平台基础 ecmStrength 与挂载的 ecm_jammer 传感器功率 (jammingPowerKw / maxRangeKm)
 */
export function resolveUnitJammingCapability(
  unit: RuntimeUnit,
  catalog: EquipmentCatalog
): { strength: number; effectiveRadiusKm: number } {
  if (!isActiveUnit(unit) || !unit.doctrine.emconJamming || getUnitCapabilities(unit).radarFactor <= 0) {
    return { strength: 0, effectiveRadiusKm: 0 };
  }
  const config = resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId);
  let strength = config.platform.ecmStrength ?? 0;
  let effectiveRadiusKm = strength > 0 ? 75 : 0;
  for (const sensorId of config.sensorIds) {
    const sensor = catalog.sensors[sensorId];
    if (!sensor || sensor.type !== 'ecm_jammer') continue;
    const podStrength = Math.min(0.75, Math.max(0.25, (sensor.jammingPowerKw ?? 90) / 200));
    if (podStrength > strength) strength = podStrength;
    const podRadius = Math.max(75, Math.min(180, sensor.maxRangeKm * 0.45));
    if (podRadius > effectiveRadiusKm) effectiveRadiusKm = podRadius;
  }
  return {
    strength: Math.min(0.75, Math.max(0, strength)),
    effectiveRadiusKm,
  };
}

/**
 * 评估目标当前享有的友军电子战伴随/防区外干扰 + 自卫干扰综合压制系数 (0.0 - 0.75)
 */
export function evaluateTargetEcmSuppression(
  target: RuntimeUnit,
  allAliveUnits: RuntimeUnit[],
  catalog: EquipmentCatalog
): number {
  let bestEcm = resolveUnitJammingCapability(target, catalog).strength;

  // 检查有效干扰半径内是否有开启 OECM 干扰的友军电子战机或大型舰艇
  for (const ally of allAliveUnits) {
    if (ally.side !== target.side || ally.id === target.id) continue;
    const allyJamming = resolveUnitJammingCapability(ally, catalog);
    if (allyJamming.strength <= 0 || allyJamming.effectiveRadiusKm <= 0) continue;

    const distKm = getDistanceKm(ally.position, target.position);
    if (distKm <= allyJamming.effectiveRadiusKm) {
      const falloffDenominator = allyJamming.effectiveRadiusKm * 1.45;
      const escortEffect = allyJamming.strength * (1 - distKm / falloffDenominator);
      if (escortEffect > bestEcm) {
        bestEcm = escortEffect;
      }
    }
  }

  return Math.min(0.75, Math.max(0, bestEcm));
}

const SATELLITE_PASS_WINDOW_SEC = 15;

export function isSatellitePassActive(
  firstPassSec: number,
  intervalSec: number,
  elapsedSec: number
): boolean {
  if (elapsedSec <= 0 || elapsedSec + 1e-9 < firstPassSec || intervalSec <= 0) return false;
  const phase = (elapsedSec - firstPassSec) % intervalSec;
  return phase >= 0 && phase <= SATELLITE_PASS_WINDOW_SEC;
}

export function hasDirectReconBdaCoverage(
  observerSide: SideId,
  position: [number, number],
  altitudeM: number,
  units: Record<string, RuntimeUnit>,
  catalog: EquipmentCatalog,
  environment?: ScenarioEnvironment,
  elapsedSec = 0
): boolean {
  // 1. Active SAR or clear-sky EO satellite pass over position
  for (const pass of environment?.satellitePasses ?? []) {
    if (pass.side !== observerSide || !isSatellitePassActive(pass.firstPassSec, pass.intervalSec, elapsedSec)) continue;
    if (!isPointInCompiledPolygon(position, pass.swathPolygon)) continue;
    if (pass.sensorKind === 'sar_radar') return true;
    if (pass.sensorKind === 'eo_optical') {
      const mods = evaluateWeatherModifiers(position, 400_000, position, Math.max(0, altitudeM), environment);
      if (mods.opticalFactor >= 0.5) return true;
    }
  }
  // 2. Close friendly recon aircraft/UAV/ship with clear IRST/EO or active radar within 35 km
  for (const observer of Object.values(units)) {
    if (observer.side !== observerSide || !isActiveUnit(observer)) continue;
    const distKm = getDistanceKm(observer.position, position);
    if (distKm > 38) continue;
    const config = resolveUnitConfiguration(catalog, observer.platformId, observer.activeLoadoutId);
    if (!hasRadarLineOfSight(observer.position, observer.altitudeM, config.platform.radarAntennaHeightM, position, Math.max(0, altitudeM), environment)) {
      continue;
    }
    for (const sm of config.sensorMounts) {
      const sensor = catalog.sensors[sm.sensorId];
      if (!sensor || !isTargetWithinSensorArc(observer.heading, observer.position, position, sensor, sm)) continue;
      if (sensor.type === 'irst_optical') {
        const mods = evaluateWeatherModifiers(observer.position, observer.altitudeM, position, Math.max(0, altitudeM), environment);
        if (distKm <= Math.min(35, sensor.maxRangeKm * mods.opticalFactor)) return true;
      }
      if (sensor.type === 'radar_air_surface' && observer.doctrine.emconRadar && getUnitCapabilities(observer).radarFactor > 0 && distKm <= 35) {
        return true;
      }
    }
  }
  return false;
}

export function computeContactsOnly(
  units: Record<string, RuntimeUnit>, catalog: EquipmentCatalog,
  previousContacts: Record<string, TacticalContact>, nextSimTime: number, dtSec = 0,
  environment?: ScenarioEnvironment, startTime?: number
): { contacts: Record<string, TacticalContact>; logs: CombatLogEntry[] } {
  const aliveUnits = Object.values(units)
    .filter(isActiveUnit)
    .sort(compareRuntimeUnits);
  const configurations = new Map(
    aliveUnits.map((unit) => [
      unit.id,
      resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId),
    ])
  );
  const capabilitiesById = new Map(
    aliveUnits.map((unit) => [unit.id, getUnitCapabilities(unit)])
  );
  const observerSensorMeta = new Map<
    string,
    { sensors: { sensor: SensorSpec; mount: PlatformSensorMount }[]; domains: Set<Domain> }
  >();
  for (const unit of aliveUnits) {
    const cfg = configurations.get(unit.id)!;
    const sensors: { sensor: SensorSpec; mount: PlatformSensorMount }[] = [];
    const domains = new Set<Domain>();
    for (const mount of cfg.sensorMounts) {
      const s = catalog.sensors[mount.sensorId];
      if (!s) continue;
      sensors.push({ sensor: s, mount });
      for (const d of s.detectDomains) domains.add(d);
    }
    observerSensorMeta.set(unit.id, { sensors, domains });
  }
  const activeJammers = aliveUnits.filter(
    (unit) => resolveUnitJammingCapability(unit, catalog).strength > 0
  );
  const emittingCache = new Map<string, boolean>();
  const getIsEmitting = (unit: RuntimeUnit): boolean => {
    let val = emittingCache.get(unit.id);
    if (val === undefined) {
      val = isRadioEmitting(unit, catalog);
      emittingCache.set(unit.id, val);
    }
    return val;
  };
  const newLogs: CombatLogEntry[] = [];
  const nextContacts: Record<string, TacticalContact> = {};
  const elapsedSec = startTime !== undefined ? Math.max(0, (nextSimTime - startTime) / 1000) : 0;
  const activeSatPasses = (environment?.satellitePasses ?? []).filter((pass) =>
    isSatellitePassActive(pass.firstPassSec, pass.intervalSec, elapsedSec)
  );

  for (const observerSide of ['RED', 'BLUE'] as SideId[]) {
    const friendlyUnits = aliveUnits.filter((u) => u.side === observerSide);
    const hostileUnits = aliveUnits.filter(
      (u) => u.side !== observerSide && u.side !== 'NEUTRAL'
    );

    for (const target of hostileUnits) {
      const targetSpec = catalog.platforms[target.platformId];
      if (!targetSpec) continue;

      const loadoutRcsPenalty = configurations.get(target.id)!.rcsPenaltyM2;

      // 计算目标当前享有的综合电子战压制强度 (自身 ECM + 75km 内电子战机伴随掩护)
      const targetEcmSuppression = evaluateTargetEcmSuppression(
        target,
        activeJammers,
        catalog
      );

      const detectingSources: string[] = [];
      const sourceUnitIds: string[] = [];
      const fireControlSourceIds: string[] = [];
      const esmObservations: BearingObservation[] = [];
      let hasNonEsmDetection = false;
      let bestUncertaintyKm = Infinity;
      let bestClassification: TacticalContact['classification'] = 'unknown';
      let emitterObserved = false;

      for (const observer of friendlyUnits) {
        const obsSpec = catalog.platforms[observer.platformId];
        if (!obsSpec) continue;
        const obsMeta = observerSensorMeta.get(observer.id);
        if (!obsMeta || !obsMeta.domains.has(target.domain)) continue;

        const obsCaps = capabilitiesById.get(observer.id)!;
        const distKm = getDistanceKm(observer.position, target.position);
        let cachedLos: boolean | undefined;
        const hasLineOfSight = () => (cachedLos ??= hasRadarLineOfSight(
          observer.position,
          observer.altitudeM,
          obsSpec.radarAntennaHeightM,
          target.position,
          target.altitudeM,
          environment
        ));
        let cachedWeatherMods: ReturnType<typeof evaluateWeatherModifiers> | undefined;
        const getWeatherMods = () => (cachedWeatherMods ??= evaluateWeatherModifiers(
          observer.position,
          observer.altitudeM,
          target.position,
          target.altitudeM,
          environment
        ));
        let cachedAspectRcsM2: number | undefined;
        const getAspectRcsM2 = () => (cachedAspectRcsM2 ??= calculateAspectEffectiveRcsM2(
          targetSpec,
          observer.position,
          target.position,
          target.heading,
          loadoutRcsPenalty
        ));

        const sourceCount = detectingSources.length;
        for (const { sensor, mount } of obsMeta.sensors) {
          if (!sensor.detectDomains.includes(target.domain)) continue;
          if (!isTargetWithinSensorArc(observer.heading, observer.position, target.position, sensor, mount)) continue;
          const effectiveAntennaM = mount.mastHeightM ?? obsSpec.radarAntennaHeightM;

          // A. 主动雷达探测 (受姿态 RCS 与敌方 OECM 压制影响)
          if (
            sensor.type === 'radar_air_surface' ||
            sensor.type === 'radar_oth'
          ) {
            if (!observer.doctrine.emconRadar || obsCaps.radarFactor === 0) continue;
            if (sensor.type === 'radar_air_surface' && !hasLineOfSight()) continue;

            const baseEffRangeKm = calculateEffectiveRadarRangeKm(
              sensor,
              getAspectRcsM2(),
              observer.altitudeM,
              effectiveAntennaM,
              target.altitudeM,
              targetEcmSuppression,
              obsCaps.radarFactor
            );
            const effRangeKm =
              sensor.type === 'radar_air_surface' && target.altitudeM < LOW_ALTITUDE_THRESHOLD && !sensor.lookDownCapable
                ? baseEffRangeKm * getWeatherMods().radarClutterPenalty
                : baseEffRangeKm;

            if (distKm <= effRangeKm) {
              hasNonEsmDetection = true;
              detectingSources.push(`${observer.callsign} (${sensor.codeName})`);
              fireControlSourceIds.push(observer.id);
              const ratio = distKm / Math.max(1, effRangeKm);
              const uncertainty = ratio < 0.72 ? 0.3 : 2.5;
              if (uncertainty < bestUncertaintyKm) {
                bestUncertaintyKm = uncertainty;
              }
              if (ratio < 0.55) {
                bestClassification = 'identified';
              } else if (bestClassification === 'unknown') {
                bestClassification = 'classified';
              }
            }
          }

          // B. 被动电子支援侦察 (ESM/RWR) —— 敌方开启主动雷达或开启强 OECM 干扰都会暴露辐射方位！
          else if (sensor.type === 'esm') {
            if (!getIsEmitting(target)) continue;
            const horizonKm =
              calculateRadarHorizonKm(
                observer.altitudeM,
                effectiveAntennaM,
                target.altitudeM
              ) * 1.28;
            const esmRangeKm = Math.min(sensor.maxRangeKm, horizonKm);

            if (distKm <= esmRangeKm && hasLineOfSight()) {
              emitterObserved = true;
              const trueBearing = getBearingDeg(observer.position, target.position);
              const hash = `${observer.id}:${target.id}`.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
              const bearingBiasDeg = ((hash % 2001) / 1000 - 1) * 2;
              esmObservations.push({
                sourceUnitId: observer.id,
                origin: [...observer.position],
                bearingDeg: (trueBearing + bearingBiasDeg + 360) % 360,
                errorDeg: 2.5,
                maxRangeKm: esmRangeKm,
              });
              detectingSources.push(
                `${observer.callsign} (${
                  target.doctrine.emconJamming ? 'ESM截获强干扰源' : 'ESM截获雷达辐射'
                })`
              );
              const esmUncertaintyKm = Math.max(
                2.0,
                Math.min(22, distKm * 0.055)
              );
              if (esmUncertaintyKm < bestUncertaintyKm) {
                bestUncertaintyKm = esmUncertaintyKm;
              }
              if (bestClassification === 'unknown') {
                bestClassification = 'classified';
              }
            }
          }

          // C. 光电/红外被动搜索 (IRST/EOTS) —— 不受射频电子干扰影响，但受云层与暴雨强衰减！
          else if (sensor.type === 'irst_optical') {
            const horizonKm = calculateRadarHorizonKm(
              observer.altitudeM,
              effectiveAntennaM,
              target.altitudeM
            );
            const effRangeKm = Math.min(sensor.maxRangeKm * getWeatherMods().opticalFactor, horizonKm);
            if (distKm <= effRangeKm && hasLineOfSight()) {
              hasNonEsmDetection = true;
              detectingSources.push(`${observer.callsign} (${sensor.codeName})`);
              if (distKm <= effRangeKm * 0.65) {
                bestClassification = 'identified';
                bestUncertaintyKm = Math.min(bestUncertaintyKm, 0.2);
              } else {
                if (bestClassification === 'unknown') {
                  bestClassification = 'classified';
                }
                bestUncertaintyKm = Math.min(bestUncertaintyKm, 1.5);
              }
            }
          }

          // D. 主被动声呐探测 (Sonar)
          else if (
            sensor.type === 'sonar_passive' ||
            sensor.type === 'sonar_active'
          ) {
            if (
              sensor.type === 'sonar_active' &&
              !observer.doctrine.emconSonar
            ) {
              continue;
            }
            // Silent drifting passive DIFAR sonobuoys have no machinery noise to detect on passive sonar
            if (target.category === 'sonobuoy' && !target.doctrine.emconSonar) {
              continue;
            }
            const sonarRangeKm = calculateSonarDetectionRangeKm(
              sensor,
              observer.altitudeM,
              target.altitudeM,
              resolvePlatformAcousticDb(targetSpec),
              target.speedKts,
              target.doctrine.emconSonar
            ) * acousticRangeFactor(observer.position, target.position, environment) *
              (sensor.type === 'sonar_passive' ? getWeatherMods().passiveSonarFactor : 1);

            if (distKm <= sonarRangeKm) {
              hasNonEsmDetection = true;
              detectingSources.push(
                `${observer.callsign} (${
                  sensor.type === 'sonar_active' ? '主动声呐回波' : '被动声学监听'
                })`
              );
              const sonarUncertainty =
                sensor.type === 'sonar_active' || distKm < 18
                  ? 0.4
                  : Math.max(1.5, distKm * 0.08);
              if (sonarUncertainty < bestUncertaintyKm) {
                bestUncertaintyKm = sonarUncertainty;
              }
              if (
                target.category === 'sonobuoy' ||
                sensor.type === 'sonar_active' ||
                distKm < sonarRangeKm * 0.55
              ) {
                bestClassification = 'identified';
              } else if (bestClassification === 'unknown') {
                bestClassification = 'classified';
              }
            }
          }
        }
        if (detectingSources.length > sourceCount) sourceUnitIds.push(observer.id);
      }

      // E. 天基侦察卫星过顶条带扫掠 (Orbital Satellite ISR Passes: SAR / EO / ELINT)
      if (target.domain !== 'subsurface' && activeSatPasses.length > 0) {
        for (const pass of activeSatPasses) {
          if (pass.side !== observerSide) continue;
          if (!isPointInCompiledPolygon(target.position, pass.swathPolygon)) continue;
          if (pass.sensorKind === 'sar_radar' && (target.domain === 'land' || (target.domain === 'surface' && targetSpec.rcsM2 >= 50))) {
            hasNonEsmDetection = true;
            detectingSources.push(`${pass.name} (天基SAR穿云成像)`);
            bestUncertaintyKm = Math.min(bestUncertaintyKm, 1.2);
            if (['carrier', 'airbase', 'amphibious'].includes(target.category)) {
              bestClassification = 'identified';
            } else if (bestClassification === 'unknown') {
              bestClassification = 'classified';
            }
          } else if (pass.sensorKind === 'eo_optical' && (target.domain === 'surface' || target.domain === 'land' || target.altitudeM >= 6000)) {
            const satWeather = evaluateWeatherModifiers(target.position, 400_000, target.position, target.altitudeM, environment);
            if (satWeather.opticalFactor >= 0.5) {
              hasNonEsmDetection = true;
              detectingSources.push(`${pass.name} (天基高分光学判读)`);
              bestUncertaintyKm = Math.min(bestUncertaintyKm, 0.25);
              bestClassification = 'identified';
            }
          } else if (pass.sensorKind === 'elint_esm' && isRadioEmitting(target, catalog)) {
            emitterObserved = true;
            hasNonEsmDetection = true;
            detectingSources.push(`${pass.name} (天基ELINT电子截获)`);
            bestUncertaintyKm = Math.min(bestUncertaintyKm, 3.5);
            if (bestClassification === 'unknown') {
              bestClassification = 'classified';
            }
          }
        }
      }

      const contactKey = `${observerSide}_CONTACT_${target.id}`;
      const prevContact = previousContacts[contactKey];

      if (detectingSources.length > 0) {
        const uniqueEsmObservations = esmObservations.filter((observation, index, all) =>
          all.findIndex((candidate) => candidate.sourceUnitId === observation.sourceUnitId) === index);
        let uncertaintyKind: TacticalContact['uncertaintyKind'] = 'circle';
        let estimatedPos: [number, number] = [...target.position];
        let uncertaintyPolygon: [number, number][] | undefined;
        if (!hasNonEsmDetection && uniqueEsmObservations.length > 0) {
          const fusion = fuseBearingObservations(uniqueEsmObservations);
          if (fusion) {
            uncertaintyKind = 'ellipse';
            estimatedPos = fusion.estimatedPosition;
            bestUncertaintyKm = fusion.uncertaintyRadiusKm;
            uncertaintyPolygon = fusion.uncertaintyPolygon;
          } else {
            const observation = uniqueEsmObservations[0];
            uncertaintyKind = 'bearing_corridor';
            estimatedPos = turf.destination(
              observation.origin,
              observation.maxRangeKm * 0.5,
              observation.bearingDeg,
              { units: 'kilometers' }
            ).geometry.coordinates as [number, number];
            bestUncertaintyKm = observation.maxRangeKm * 0.5;
            uncertaintyPolygon = buildBearingCorridor(observation);
          }
        } else {
          if (new Set(sourceUnitIds).size >= 2 && bestUncertaintyKm > 1.0) {
            bestUncertaintyKm = Number((bestUncertaintyKm * 0.45).toFixed(2));
          }
          if (bestUncertaintyKm > 2.0) {
            const hashAngle =
              (target.id.charCodeAt(0) * 73 + Math.floor(nextSimTime / 10000)) % 360;
            estimatedPos = turf.destination(
              target.position,
              bestUncertaintyKm * 0.35,
              hashAngle,
              { units: 'kilometers' }
            ).geometry.coordinates as [number, number];
          }
          uncertaintyPolygon = buildAouPolygon(estimatedPos, bestUncertaintyKm);
        }

        const prefix =
          target.domain === 'air'
            ? 'BOGEY'
            : target.domain === 'surface'
            ? 'SKUNK'
            : target.domain === 'subsurface'
            ? 'GOBLIN'
            : 'SITE';

        const shortNum =
          (Math.abs(
            target.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
          ) %
            899) +
          100;

        const displayName =
          bestClassification === 'identified'
            ? `${target.callsign} · ${targetSpec.className}`
            : bestClassification === 'classified'
            ? `${prefix}-${shortNum} [疑似${
                target.domain === 'air'
                  ? '战机/预警机'
                  : target.domain === 'surface'
                  ? '大型水面舰'
                  : target.domain === 'subsurface'
                  ? '水下潜艇'
                  : '防空/导弹阵地'
              }]`
            : `${prefix}-${shortNum} [不明接触]`;

        const threatLevel: TacticalContact['threatLevel'] =
          target.category === 'sonobuoy'
            ? 'low'
            : bestClassification !== 'identified'
              ? target.domain === 'subsurface' ? 'critical' : target.domain === 'air' ? 'high' : 'high'
              : target.category === 'decoy' || target.category === 'tanker'
                ? 'low'
            : target.category === 'stealth_fighter' || target.category === 'destroyer' ||
              target.category === 'ssn' || target.category === 'sam_battery' || target.category === 'airbase'
              ? 'critical'
              : target.category === 'bomber' || target.category === 'carrier' || target.category === 'ew_aircraft' ||
                target.category === 'amphibious' || target.category === 'ground_force' || target.category === 'radar_site'
                ? 'high' : 'medium';

        const bdaStatus: TacticalContact['bdaStatus'] =
          bestClassification === 'identified'
            ? (capabilitiesById.get(target.id) ?? getUnitCapabilities(target)).state !== 'operational'
              ? 'damaged_suspected'
              : 'intact'
            : prevContact?.bdaStatus === 'damaged_suspected'
              ? 'damaged_suspected'
              : 'intact';

        nextContacts[contactKey] = {
          id: contactKey,
          actualUnitId: target.id,
          observerSide,
          targetSide: target.side,
          domain: target.domain,
          classification: bestClassification,
          identifiedCategory: bestClassification === 'identified' ? target.category : undefined,
          bdaStatus,
          displayName,
          sidc: getContactSidc(target.domain, bestClassification, target.side),
          estimatedPosition: estimatedPos,
          truePosition: [...target.position],
          uncertaintyRadiusKm: Number(bestUncertaintyKm.toFixed(1)),
          uncertaintyKind,
          uncertaintyPolygon,
          bearingObservations: uniqueEsmObservations.length ? uniqueEsmObservations : undefined,
          heading: Math.round(target.heading),
          speedKts: Math.round(target.speedKts),
          altitudeM: Math.round(target.altitudeM),
          firstDetectedTime: prevContact
            ? prevContact.firstDetectedTime
            : nextSimTime,
          lastDetectedTime: nextSimTime,
          detectedBySources: Array.from(new Set(detectingSources)).slice(0, 3),
          sourceUnitIds,
          fireControlSourceIds: [...new Set(fireControlSourceIds)],
          isJammingDetected: resolveUnitJammingCapability(target, catalog).strength > 0,
          emitterObserved,
          lastEmitterDetectedTime: emitterObserved ? nextSimTime : prevContact?.lastEmitterDetectedTime,
          threatLevel,
        };

        if (!prevContact) {
          newLogs.push({
            id: `log_det_${nextSimTime}_${contactKey}`,
            simTime: nextSimTime,
            side: observerSide,
            category: 'DETECTION',
            severity: 'warning',
            title: `发现新目标接触: ${displayName}`,
            message: `${detectingSources[0]} 捕获新目标，AOU误差半径 ${bestUncertaintyKm.toFixed(
              1
            )} km。`,
            position: estimatedPos,
            contactId: contactKey,
          });

        }
      } else if (
        prevContact &&
        nextSimTime - prevContact.lastDetectedTime <= 120000
      ) {
        const expandedRadius = Math.min(
          35,
          prevContact.uncertaintyRadiusKm + dtSec * 0.4
        );
        nextContacts[contactKey] = {
          ...prevContact,
          uncertaintyRadiusKm: Number(expandedRadius.toFixed(1)),
          uncertaintyPolygon: prevContact.uncertaintyKind === 'circle' || !prevContact.uncertaintyKind
            ? buildAouPolygon(prevContact.estimatedPosition, expandedRadius)
            : prevContact.uncertaintyPolygon,
          emitterObserved: false,
        };
      }
    }
  }

  // Memory cannot disappear merely because an unobserved target was destroyed;
  // however, once a friendly recon sensor or satellite pass sweeps a lost/unconfirmed-kill position, confirm BDA!
  for (const previous of Object.values(previousContacts)) {
    if (nextContacts[previous.id] || nextSimTime - previous.lastDetectedTime > 120000) continue;
    const truthUnit = units[previous.actualUnitId];
    const targetActuallyDead = !truthUnit || !isActiveUnit(truthUnit);
    if (
      targetActuallyDead &&
      previous.bdaStatus === 'kill_unconfirmed' &&
      hasDirectReconBdaCoverage(
        previous.observerSide,
        previous.estimatedPosition,
        previous.altitudeM,
        units,
        catalog,
        environment,
        elapsedSec
      )
    ) {
      newLogs.push({
        id: `log_bda_confirm_${nextSimTime}_${previous.id}`,
        simTime: nextSimTime,
        side: previous.observerSide,
        category: 'DETECTION',
        severity: 'info',
        title: `[BDA毁伤复核确认] ${previous.displayName} 确认已被摧毁`,
        message: '前出侦察传感器/过顶卫星复核目标海域，敌方目标已确认沉没/失能并自态势图核销。',
        position: [...previous.estimatedPosition],
      });
      continue;
    }
    const radius = Math.min(80, previous.uncertaintyRadiusKm + dtSec * 0.4);
    nextContacts[previous.id] = {
      ...previous,
      uncertaintyRadiusKm: radius,
      uncertaintyPolygon:
        previous.uncertaintyKind === 'circle' || !previous.uncertaintyKind
          ? buildAouPolygon(previous.estimatedPosition, radius)
          : previous.uncertaintyPolygon,
      emitterObserved: false,
    };
  }
  return { contacts: nextContacts, logs: newLogs };
}

export function observeMissile(
  side: SideId, missile: WeaponInFlight, units: Record<string, RuntimeUnit>,
  catalog: EquipmentCatalog, simTime: number, receiver?: RuntimeUnit, environment?: ScenarioEnvironment,
  allowPassiveWarning = false,
  preSortedSideObservers?: readonly RuntimeUnit[]
): TacticalContact | undefined {
  const sources: RuntimeUnit[] = [];
  const candidateObservers =
    preSortedSideObservers ??
    Object.values(units)
      .filter((u) => u.side === side && isActiveUnit(u))
      .sort(compareRuntimeUnits);
  const missileDomain: Domain = missile.altitudeM < 0 ? 'subsurface' : 'air';
  const receiverHasDatalink = receiver
    ? !!catalog.platforms[receiver.platformId]?.hasDatalink
    : true;
  for (const observer of candidateObservers) {
    if (observer.side !== side || !isActiveUnit(observer)) continue;
    const config = resolveUnitConfiguration(catalog, observer.platformId, observer.activeLoadoutId);
    if (receiver && receiver.id !== observer.id &&
        (!receiverHasDatalink || !config.platform.hasDatalink)) continue;
    const distance = getDistanceKm(observer.position, missile.position);
    const obsCaps = getUnitCapabilities(observer);
    let cachedLos: boolean | undefined;
    const hasLos = () => (cachedLos ??= hasRadarLineOfSight(
      observer.position, observer.altitudeM, config.platform.radarAntennaHeightM,
      missile.position, missile.altitudeM, environment
    ));
    const detected = config.sensorIds.some((id) => {
      const sensor = catalog.sensors[id];
      if (!sensor?.detectDomains.includes(missileDomain)) return false;
      if (!isTargetWithinSensorArc(observer.heading, observer.position, missile.position, sensor)) return false;
      if (missileDomain === 'subsurface') {
        if (sensor.type !== 'sonar_active' && sensor.type !== 'sonar_passive') return false;
        if (sensor.type === 'sonar_active' && !observer.doctrine.emconSonar) return false;
        const torpedoNoiseRangeKm = sensor.maxRangeKm * (sensor.type === 'sonar_active' ? 1 : 0.65);
        return distance <= torpedoNoiseRangeKm;
      }
      if (allowPassiveWarning && observer.doctrine.emconRadar && sensor.type === 'irst_optical') {
        const horizonKm = calculateRadarHorizonKm(
          observer.altitudeM, config.platform.radarAntennaHeightM, missile.altitudeM
        );
        return distance <= Math.min(sensor.maxRangeKm * 0.45, horizonKm) && hasLos();
      }
      if (sensor.type !== 'radar_air_surface' && sensor.type !== 'radar_oth') return false;
      if (!observer.doctrine.emconRadar || obsCaps.radarFactor === 0) return false;
      if (sensor.type === 'radar_air_surface' && !hasLos()) return false;
      return distance <= calculateEffectiveRadarRangeKm(
        sensor,
        0.1,
        observer.altitudeM,
        config.platform.radarAntennaHeightM,
        missile.altitudeM,
        0,
        obsCaps.radarFactor
      );
    });
    if (detected) sources.push(observer);
  }
  if (!sources.length) return undefined;
  return {
    id: `${side}_MISSILE_${missile.id}`, actualUnitId: missile.id, observerSide: side,
    targetSide: missile.side, domain: missileDomain, classification: 'classified', displayName: '来袭武器',
    sidc: getContactSidc(missileDomain, 'classified', missile.side), estimatedPosition: [...missile.position],
    truePosition: [...missile.position], uncertaintyRadiusKm: 0.3,
    heading: missile.heading, speedKts: missile.speedKts, altitudeM: missile.altitudeM,
    firstDetectedTime: simTime, lastDetectedTime: simTime,
    sourceUnitIds: sources.map((u) => u.id), fireControlSourceIds: sources.map((u) => u.id),
    detectedBySources: sources.map((u) => u.callsign), threatLevel: 'critical',
  };
}
