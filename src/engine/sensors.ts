import * as turf from '@turf/turf';
import type { BearingObservation, CombatLogEntry, Domain, EquipmentCatalog, PlatformSpec, RuntimeUnit, ScenarioEnvironment, SensorSpec, SideId, TacticalContact, WeaponInFlight } from '../types/wargame';
import { resolveUnitConfiguration } from '../db/unitConfiguration';
import { acousticRangeFactor, evaluateWeatherModifiers, hasRadarLineOfSight } from './environment';
import { calculateRadarHorizonKm, getBearingDeg, getDistanceKm } from './geometry';
import { getUnitCapabilities, isActiveUnit, isRadioEmitting } from './unitCapabilities';
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
  sensor: Pick<SensorSpec, 'coverageArcDeg' | 'blindArcRearDeg'>
): boolean {
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
  const profile = targetSpec.rcsProfile;
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
  ecmSuppressionFactor = 0
): number {
  const horizonKm = calculateRadarHorizonKm(
    observerAltM,
    observerAntennaM,
    targetAltM
  );
  if (horizonKm <= 0) return 0;

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
    sensor.maxRangeKm * rcsFactor * clutterModifier * jammerMultiplier;
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

  const acrossThermocline =
    (observerAltM > THERMOCLINE.UPPER_BOUNDARY && targetAltM < THERMOCLINE.LOWER_BOUNDARY) ||
    (observerAltM < THERMOCLINE.LOWER_BOUNDARY && targetAltM > THERMOCLINE.UPPER_BOUNDARY);
  const thermoclineFactor = acrossThermocline ? THERMOCLINE.CROSS_LAYER_FACTOR : 1.0;

  if (sensor.type === 'sonar_active') {
    return sensor.maxRangeKm * thermoclineFactor;
  }

  const speedNoiseBonus = 1 + Math.max(0, targetSpeedKts - SONAR_DETECTION.SPEED_NOISE_THRESHOLD) * SONAR_DETECTION.SPEED_NOISE_COEFFICIENT;
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
 * 评估目标当前享有的友军电子战伴随干扰 (Escort Jamming) + 自卫干扰综合压制系数 (0.0 - 0.75)
 */
export function evaluateTargetEcmSuppression(
  target: RuntimeUnit,
  allAliveUnits: RuntimeUnit[],
  catalog: EquipmentCatalog
): number {
  const targetSpec = catalog.platforms[target.platformId];
  let bestEcm =
    isActiveUnit(target) && getUnitCapabilities(target).radarFactor > 0 && target.doctrine.emconJamming && targetSpec?.ecmStrength
      ? targetSpec.ecmStrength
      : 0;

  // 检查 75km 伴随半径内是否有开启 OECM 干扰的友军电子战机或大型舰艇
  for (const ally of allAliveUnits) {
    if (!isActiveUnit(ally) || !getUnitCapabilities(ally).radarFactor) continue;
    if (ally.side !== target.side || ally.id === target.id) continue;
    if (!ally.doctrine.emconJamming) continue;
    const allySpec = catalog.platforms[ally.platformId];
    if (!allySpec || !allySpec.ecmStrength) continue;

    const distKm = getDistanceKm(ally.position, target.position);
    if (distKm <= 75) {
      const escortEffect = allySpec.ecmStrength * (1 - distKm / 120);
      if (escortEffect > bestEcm) {
        bestEcm = escortEffect;
      }
    }
  }

  return Math.min(0.75, Math.max(0, bestEcm));
}

export function computeContactsOnly(
  units: Record<string, RuntimeUnit>, catalog: EquipmentCatalog,
  previousContacts: Record<string, TacticalContact>, nextSimTime: number, dtSec = 0,
  environment?: ScenarioEnvironment
): { contacts: Record<string, TacticalContact>; logs: CombatLogEntry[] } {
  const configurations = new Map(Object.values(units).map((unit) => [unit.id,
    resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId)]));
  const newLogs: CombatLogEntry[] = [];
  const nextContacts: Record<string, TacticalContact> = {};
  const aliveUnits = Object.values(units).filter(
    isActiveUnit
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
        aliveUnits,
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
        const weatherMods = evaluateWeatherModifiers(
          observer.position,
          observer.altitudeM,
          target.position,
          target.altitudeM,
          environment
        );

        // 计算目标相对该观察者雷达视线的姿态等效 RCS (正前/侧向/尾向 + 外挂惩罚)
        const aspectRcsM2 = calculateAspectEffectiveRcsM2(
          targetSpec,
          observer.position,
          target.position,
          target.heading,
          loadoutRcsPenalty
        );

        const sourceCount = detectingSources.length;
        for (const sensorId of configurations.get(observer.id)!.sensorIds) {
          const sensor = catalog.sensors[sensorId];
          if (!sensor) continue;
          if (!sensor.detectDomains.includes(target.domain)) continue;
          if (!isTargetWithinSensorArc(observer.heading, observer.position, target.position, sensor)) continue;

          // A. 主动雷达探测 (受姿态 RCS 与敌方 OECM 压制影响)
          if (
            sensor.type === 'radar_air_surface' ||
            sensor.type === 'radar_oth'
          ) {
            if (!observer.doctrine.emconRadar || getUnitCapabilities(observer).radarFactor === 0) continue;
            if (sensor.type === 'radar_air_surface' && !hasLineOfSight()) continue;

            const baseEffRangeKm = calculateEffectiveRadarRangeKm(
              { ...sensor, maxRangeKm: sensor.maxRangeKm * getUnitCapabilities(observer).radarFactor },
              aspectRcsM2,
              observer.altitudeM,
              obsSpec.radarAntennaHeightM,
              target.altitudeM,
              targetEcmSuppression
            );
            const effRangeKm =
              sensor.type === 'radar_air_surface' && target.altitudeM < LOW_ALTITUDE_THRESHOLD && !sensor.lookDownCapable
                ? baseEffRangeKm * weatherMods.radarClutterPenalty
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
            if (!isRadioEmitting(target, catalog)) continue;
            const horizonKm =
              calculateRadarHorizonKm(
                observer.altitudeM,
                obsSpec.radarAntennaHeightM,
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
              obsSpec.radarAntennaHeightM,
              target.altitudeM
            );
            const effRangeKm = Math.min(sensor.maxRangeKm * weatherMods.opticalFactor, horizonKm);
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
              targetSpec.acousticSignatureDb,
              target.speedKts,
              target.doctrine.emconSonar
            ) * acousticRangeFactor(observer.position, target.position, environment) *
              (sensor.type === 'sonar_passive' ? weatherMods.passiveSonarFactor : 1);

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

        nextContacts[contactKey] = {
          id: contactKey,
          actualUnitId: target.id,
          observerSide,
          targetSide: target.side,
          domain: target.domain,
          classification: bestClassification,
          identifiedCategory: bestClassification === 'identified' ? target.category : undefined,
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
          isJammingDetected: target.doctrine.emconJamming,
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

  // Memory cannot disappear merely because an unobserved target was destroyed.
  for (const previous of Object.values(previousContacts)) {
    if (nextContacts[previous.id] || nextSimTime - previous.lastDetectedTime > 120000) continue;
    const radius = Math.min(80, previous.uncertaintyRadiusKm + dtSec * 0.4);
    nextContacts[previous.id] = { ...previous, uncertaintyRadiusKm: radius,
      uncertaintyPolygon: previous.uncertaintyKind === 'circle' || !previous.uncertaintyKind
        ? buildAouPolygon(previous.estimatedPosition, radius) : previous.uncertaintyPolygon,
      emitterObserved: false };
  }
  return { contacts: nextContacts, logs: newLogs };
}

export function observeMissile(
  side: SideId, missile: WeaponInFlight, units: Record<string, RuntimeUnit>,
  catalog: EquipmentCatalog, simTime: number, receiver?: RuntimeUnit, environment?: ScenarioEnvironment,
  allowPassiveWarning = false
): TacticalContact | undefined {
  const sources: RuntimeUnit[] = [];
  for (const observer of Object.values(units)) {
    if (observer.side !== side || !isActiveUnit(observer)) continue;
    const config = resolveUnitConfiguration(catalog, observer.platformId, observer.activeLoadoutId);
    if (receiver && receiver.id !== observer.id &&
        (!catalog.platforms[receiver.platformId]?.hasDatalink || !config.platform.hasDatalink)) continue;
    const distance = getDistanceKm(observer.position, missile.position);
    const missileDomain: Domain = missile.altitudeM < 0 ? 'subsurface' : 'air';
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
        return distance <= Math.min(sensor.maxRangeKm * 0.45, horizonKm) &&
          hasRadarLineOfSight(
            observer.position, observer.altitudeM, config.platform.radarAntennaHeightM,
            missile.position, missile.altitudeM, environment
          );
      }
      if (sensor.type !== 'radar_air_surface' && sensor.type !== 'radar_oth') return false;
      if (!observer.doctrine.emconRadar || getUnitCapabilities(observer).radarFactor === 0) return false;
      if (sensor.type === 'radar_air_surface' && !hasRadarLineOfSight(
        observer.position, observer.altitudeM, config.platform.radarAntennaHeightM,
        missile.position, missile.altitudeM, environment
      )) return false;
      return distance <= calculateEffectiveRadarRangeKm(
        { ...sensor, maxRangeKm: sensor.maxRangeKm * getUnitCapabilities(observer).radarFactor },
        0.1, observer.altitudeM, config.platform.radarAntennaHeightM, missile.altitudeM
      );
    });
    if (detected) sources.push(observer);
  }
  if (!sources.length) return undefined;
  const missileDomain: Domain = missile.altitudeM < 0 ? 'subsurface' : 'air';
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
