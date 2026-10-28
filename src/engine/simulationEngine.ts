import * as turf from '@turf/turf';
import type {
  ActivePerspective,
  AutoPauseSettings,
  BattleAssessmentGrade,
  CombatLogEntry,
  Domain,
  EquipmentCatalog,
  InitialUnitPlacement,
  PlatformSpec,
  RuntimeUnit,
  RuntimeScenarioEvent,
  MissionDefinition,
  ScoreLedger,
  SensorSpec,
  SideId,
  TacticalContact,
  TacticalExplosionEffect,
  TacticalMission,
  VictoryConditionRule,
  WeaponInFlight,
} from '../types/wargame';
import { resolveUnitConfiguration } from '../db/unitConfiguration';
import { createRuntimeWeaponMounts, recordWeaponLaunch } from './unitConfiguration';
import { deriveMissionAssignments } from './missions';
import { getEventOccurrences } from './scenarioEvents';

// ============================================================================
// AEGIS-CMO // 核心物理、四层装备效应、动态想定事件与多域交战裁决引擎 v2.0
// 新增机制：
// 1. 多向 RCS 剖面 (Aspect-Dependent RCS: Frontal / Beam / Rear + Loadout 外挂惩罚)
// 2. 有源电子对抗 (OECM Escort & Self-Jamming: 压缩敌方雷达烧穿距离与导弹末端 Pk)
// 3. 超视距导弹数据链中继依赖 (CEC / Mid-course Datalink Dependency: 断链掉引导惩罚)
// 4. 航母/基地母舰机库放飞与冷却 (Carrier Hangar Sortie Launch)
// 5. 动态想定事件触发器 (Trigger -> Condition -> Action Engine) 与战役评级
// ============================================================================

const KTS_TO_KMPH = 1.852;
const REFERENCE_RCS_M2 = 5.0; // 标准四代机基准 RCS = 5.0 m²

/**
 * 1. 计算地球曲率下的雷达视距上限 (Radar Horizon Formula)
 * R_horizon (km) = 4.12 * (sqrt(h_observer_m) + sqrt(h_target_m))
 */
export function calculateRadarHorizonKm(
  observerAltitudeM: number,
  observerAntennaHeightM: number,
  targetAltitudeM: number
): number {
  const effectiveObserverHeightM = Math.max(
    2,
    Math.max(0, observerAltitudeM) + Math.max(0, observerAntennaHeightM)
  );
  if (targetAltitudeM < -5) {
    return 0;
  }
  const effectiveTargetHeightM =
    targetAltitudeM <= 0 ? 14 : Math.max(2, targetAltitudeM);

  return (
    4.12 *
    (Math.sqrt(effectiveObserverHeightM) + Math.sqrt(effectiveTargetHeightM))
  );
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
  if (aspectAngleDeg <= 35) {
    baseRcs = profile.frontalM2;
  } else if (aspectAngleDeg <= 135) {
    // 在 35° 到 90° 之间平滑过渡至侧向峰值 beamM2
    const t =
      1 - Math.abs(aspectAngleDeg - 85) / 55;
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
    ? Math.max(targetRcsM2, 0.35)
    : Math.max(targetRcsM2, 0.001);

  const rcsFactor = Math.pow(effectiveRcs / REFERENCE_RCS_M2, 0.25);
  const clutterModifier =
    targetAltM > 0 && targetAltM < 50 && !sensor.lookDownCapable ? 0.65 : 1.0;

  // 电子战压制效应 (Burn-through Range Reduction)：米波/数字阵列雷达抗干扰稍强
  const eccmResistance = isCounterStealthBand ? 0.35 : 0.0;
  const jammerMultiplier = Math.max(
    0.35,
    1 - Math.max(0, ecmSuppressionFactor) * (0.65 - eccmResistance * 0.25)
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
    return sensor.maxRangeKm * 1.65;
  }

  const acrossThermocline =
    (observerAltM > -90 && targetAltM < -140) ||
    (observerAltM < -140 && targetAltM > -90);
  const thermoclineFactor = acrossThermocline ? 0.68 : 1.0;

  if (sensor.type === 'sonar_active') {
    return sensor.maxRangeKm * thermoclineFactor;
  }

  const speedNoiseBonus = 1 + Math.max(0, targetSpeedKts - 10) * 0.035;
  const acousticFactor = Math.max(0.35, (targetAcousticDb - 75) / 40);
  return (
    sensor.maxRangeKm * acousticFactor * speedNoiseBonus * thermoclineFactor
  );
}

export function getDistanceKm(
  posA: [number, number],
  posB: [number, number]
): number {
  return turf.distance(posA, posB, { units: 'kilometers' });
}

export function getBearingDeg(
  from: [number, number],
  to: [number, number]
): number {
  const b = turf.bearing(from, to);
  return (b + 360) % 360;
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
    target.doctrine.emconJamming && targetSpec?.ecmStrength
      ? targetSpec.ecmStrength
      : 0;

  // 检查 75km 伴随半径内是否有开启 OECM 干扰的友军电子战机或大型舰艇
  for (const ally of allAliveUnits) {
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

/**
 * 根据想定胜负条件评估当前战局等级
 */
export function evaluateBattleAssessment(
  score: ScoreLedger,
  victoryRule?: VictoryConditionRule
): {
  grade: BattleAssessmentGrade;
  netRedAdvantage: number;
  summary: string;
} {
  const netRed = score.redScore - score.blueScore;
  const decisive = victoryRule?.decisiveVictoryThreshold ?? 350;
  const tactical = victoryRule?.tacticalVictoryThreshold ?? 120;

  if (netRed >= decisive) {
    return {
      grade: 'RED_DECISIVE_VICTORY',
      netRedAdvantage: netRed,
      summary: '红方取得决定性全面胜利 (DECISIVE VICTORY)',
    };
  }
  if (netRed >= tactical) {
    return {
      grade: 'RED_TACTICAL_VICTORY',
      netRedAdvantage: netRed,
      summary: '红方取得战术优势胜利 (TACTICAL VICTORY)',
    };
  }
  if (netRed <= -decisive) {
    return {
      grade: 'BLUE_DECISIVE_VICTORY',
      netRedAdvantage: netRed,
      summary: '蓝方取得决定性全面胜利 (DECISIVE VICTORY)',
    };
  }
  if (netRed <= -tactical) {
    return {
      grade: 'BLUE_TACTICAL_VICTORY',
      netRedAdvantage: netRed,
      summary: '蓝方取得战术优势胜利 (TACTICAL VICTORY)',
    };
  }
  return {
    grade: 'STRATEGIC_DRAW',
    netRedAdvantage: netRed,
    summary: '双方均势对峙 / 战术相持 (STRATEGIC DRAW)',
  };
}

/**
 * 将单个 InitialUnitPlacement（含 Loadout 挂载覆盖与随机出生点 Jitter）实例化为 RuntimeUnit
 */
export function createRuntimeUnitFromPlacement(
  placement: InitialUnitPlacement,
  catalog: EquipmentCatalog,
  rng: () => number = Math.random
): RuntimeUnit {
  const configuration = resolveUnitConfiguration(catalog, placement.platformId, placement.loadoutId);
  const spec = configuration.platform;
  const activeLoadoutId = configuration.loadoutId;

  // 处理随机出生坐标散布 (spawnJitterKm)
  let finalPos: [number, number] = [...placement.position];
  if (placement.spawnJitterKm && placement.spawnJitterKm > 0) {
    const randDistKm = rng() * placement.spawnJitterKm;
    const randAngle = rng() * 360;
    const dest = turf.destination(placement.position, randDistKm, randAngle, {
      units: 'kilometers',
    });
    finalPos = [
      Number(dest.geometry.coordinates[0].toFixed(4)),
      Number(dest.geometry.coordinates[1].toFixed(4)),
    ];
  }

  const { maxFuelSec, cruiseSpeedKts: defaultCruiseKts } = configuration;
  const speedKts = Math.max(0, Math.min(configuration.maxSpeedKts, placement.speedKts ?? defaultCruiseKts));
  const altitudeM = Math.max(spec.minAltitudeM, Math.min(spec.maxAltitudeM, placement.altitudeM ?? spec.defaultAltitudeM));

  const defaultDoctrine = {
    roe: 'free' as const,
    emconRadar:
      spec.category === 'awacs' ||
      spec.category === 'sam_battery' ||
      spec.category === 'destroyer',
    emconSonar: false,
    emconJamming: spec.category === 'ew_aircraft', // 电子战机默认开启有源压制干扰
    autoEvade: true,
    engageOpportunityTargets: true,
    salvoSize: 2,
    ...(placement.doctrine || {}),
  };

  return {
    id: placement.id,
    name: placement.name,
    callsign: placement.callsign,
    side: placement.side,
    platformId: placement.platformId,
    activeLoadoutId,
    parentGroupId: placement.parentGroupId,
    domain: spec.domain,
    category: spec.category,
    sidc:
      placement.side === 'RED' ? spec.defaultSidcRed : spec.defaultSidcBlue,
    position: finalPos,
    altitudeM,
    targetAltitudeM: altitudeM,
    heading: placement.heading,
    speedKts,
    targetSpeedKts: speedKts,
    waypoints: placement.waypoints
      ? placement.waypoints.map((wp) => [...wp])
      : [],
    hp: spec.maxHp,
    maxHp: spec.maxHp,
    fuelRemainingSec: maxFuelSec,
    maxFuelSec,
    status: 'operational',
    doctrine: defaultDoctrine,
    mounts: createRuntimeWeaponMounts(configuration, catalog),
    weaponUsage: {},
    hangar: (spec.hangarSlots || []).map((slot) => ({
      slotId: slot.slotId,
      squadronName: slot.squadronName,
      platformId: slot.platformId,
      selectedLoadoutId: slot.defaultLoadoutId,
      availableLoadoutIds: [...slot.availableLoadoutIds],
      readyAirframes: slot.readyAirframes,
      totalAirframes: slot.totalAirframes,
      reserveAirframes: slot.totalAirframes - slot.readyAirframes,
      launchCooldownSec: slot.launchCooldownSec,
      cooldownRemainingSec: slot.readyAirframes === 0 && slot.totalAirframes > 0 ? slot.launchCooldownSec : 0,
    })),
    assignedMissionId: placement.assignedMissionId,
  };
}

export interface SimulationWorldState {
  startTime?: number;
  simTime: number;
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  explosions: TacticalExplosionEffect[];
  missions: MissionDefinition[];
  events?: RuntimeScenarioEvent[];
  victoryConditions?: VictoryConditionRule;
  score: ScoreLedger;
}

export interface SimulationStepResult {
  nextState: SimulationWorldState & { missions: TacticalMission[] };
  newLogs: CombatLogEntry[];
  shouldAutoPause: boolean;
  autoPauseReason?: string;
}

/**
 * 单步推进半实时仿真内核 v2.0
 */
export function stepSimulationWorld(
  world: SimulationWorldState,
  catalog: EquipmentCatalog,
  dtSec: number,
  autoPauseSettings: AutoPauseSettings,
  activePerspective: ActivePerspective,
  rng: () => number = Math.random
): SimulationStepResult {
  const nextSimTime = world.simTime + dtSec * 1000;
  const startTime = world.startTime ?? world.simTime;

  const units: Record<string, RuntimeUnit> = {};
  for (const [id, u] of Object.entries(world.units)) {
    units[id] = {
      ...u,
      position: [...u.position],
      waypoints: u.waypoints.map((w) => [...w]),
      doctrine: { ...u.doctrine },
      mounts: u.mounts.map((m) => ({ ...m })),
      hangar: (u.hangar || []).map((h) => ({ ...h })),
    };
  }

  const weaponsInFlight: Record<string, WeaponInFlight> = {};
  for (const [id, w] of Object.entries(world.weaponsInFlight)) {
    weaponsInFlight[id] = {
      ...w,
      position: [...w.position],
      trail: [...w.trail],
    };
  }

  const nextMissions = deriveMissionAssignments(world.missions, units);

  const nextEvents: RuntimeScenarioEvent[] = (world.events || []).map((ev) => ({
    ...ev,
    matchedUnitIds: [...(ev.matchedUnitIds ?? [])],
  }));
  const configurations = new Map(Object.values(units).map((unit) => [
    unit.id, resolveUnitConfiguration(catalog, unit.platformId, unit.activeLoadoutId),
  ]));

  const score: ScoreLedger = {
    ...world.score,
    firedEventIds: [...(world.score.firedEventIds || [])],
    sortiesLaunched: world.score.sortiesLaunched ?? 0,
  };

  const newLogs: CombatLogEntry[] = [];
  let shouldAutoPause = false;
  let autoPauseReason: string | undefined;

  const triggerPauseIfMatch = (
    condition: boolean,
    reason: string,
    relevantSide: SideId | 'SYSTEM'
  ) => {
    if (!condition) return;
    if (
      activePerspective === 'GOD' ||
      relevantSide === 'SYSTEM' ||
      relevantSide === activePerspective
    ) {
      shouldAutoPause = true;
      if (!autoPauseReason) autoPauseReason = reason;
    }
  };

  // ==========================================================================
  // STEP 1: 巡逻任务 AI 航路生成、母舰机库冷却 & 平台运动学步进
  // ==========================================================================
  for (const unit of Object.values(units)) {
    if (unit.hp <= 0 || unit.status === 'destroyed') continue;

    for (const mount of unit.mounts) {
      if (mount.cooldownRemainingSec > 0) {
        mount.cooldownRemainingSec = Math.max(
          0,
          mount.cooldownRemainingSec - dtSec
        );
      }
    }

    for (const slot of unit.hangar || []) {
      const wasPreparing = slot.cooldownRemainingSec > 0 || slot.readyAirframes === 0;
      if (slot.cooldownRemainingSec > 0) {
        slot.cooldownRemainingSec = Math.max(
          0,
          slot.cooldownRemainingSec - dtSec
        );
      }
      // One reserve batch becomes ready after each deck preparation cycle.
      if (wasPreparing && slot.cooldownRemainingSec === 0 && slot.reserveAirframes > 0) {
        slot.reserveAirframes -= 1;
        slot.readyAirframes += 1;
      }
    }

    const configuration = configurations.get(unit.id)!;
    unit.targetSpeedKts = Math.max(0, Math.min(configuration.maxSpeedKts, unit.targetSpeedKts));
    unit.speedKts = Math.max(0, Math.min(configuration.maxSpeedKts, unit.speedKts));

    if (unit.domain === 'air' && unit.fuelRemainingSec > 0) {
      unit.fuelRemainingSec = Math.max(0, unit.fuelRemainingSec - dtSec);
    }

    if (Math.abs(unit.altitudeM - unit.targetAltitudeM) > 1) {
      const climbRateMps = unit.domain === 'air' ? 35 : 4;
      const maxDeltaAlt = climbRateMps * dtSec;
      const diff = unit.targetAltitudeM - unit.altitudeM;
      unit.altitudeM += Math.sign(diff) * Math.min(Math.abs(diff), maxDeltaAlt);
    }

    if (Math.abs(unit.speedKts - unit.targetSpeedKts) > 0.5) {
      const accelKtsPerSec = unit.domain === 'air' ? 15 : 1.5;
      const diff = unit.targetSpeedKts - unit.speedKts;
      unit.speedKts +=
        Math.sign(diff) * Math.min(Math.abs(diff), accelKtsPerSec * dtSec);
    }

    if (unit.waypoints.length === 0 && unit.assignedMissionId) {
      const mission = nextMissions.find(
        (m) => m.id === unit.assignedMissionId && m.isActive
      );
      if (mission && mission.areaPolygon.length >= 3) {
        const lons = mission.areaPolygon.map((p) => p[0]);
        const lats = mission.areaPolygon.map((p) => p[1]);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const nextLon = minLon + (0.2 + 0.6 * rng()) * (maxLon - minLon);
        const nextLat = minLat + (0.2 + 0.6 * rng()) * (maxLat - minLat);
        unit.waypoints.push([
          Number(nextLon.toFixed(4)),
          Number(nextLat.toFixed(4)),
        ]);
      }
    }

    if (unit.speedKts > 0.1) {
      const stepDistKm = (unit.speedKts * KTS_TO_KMPH * dtSec) / 3600;

      if (unit.waypoints.length > 0) {
        const targetWp = unit.waypoints[0];
        const distToWpKm = getDistanceKm(unit.position, targetWp);
        unit.heading = getBearingDeg(unit.position, targetWp);

        if (distToWpKm <= stepDistKm * 1.25) {
          unit.position = [...targetWp];
          unit.waypoints.shift();
        } else {
          const dest = turf.destination(unit.position, stepDistKm, unit.heading, {
            units: 'kilometers',
          });
          unit.position = dest.geometry.coordinates as [number, number];
        }
      } else {
        if (unit.domain === 'air') {
          unit.heading = (unit.heading + 1.8 * dtSec) % 360;
        }
        const dest = turf.destination(unit.position, stepDistKm, unit.heading, {
          units: 'kilometers',
        });
        unit.position = dest.geometry.coordinates as [number, number];
      }
    }
  }

  // ==========================================================================
  // STEP 2: 多域传感器探测、多向 RCS 剖面、有源电子干扰 (OECM) 与数据链融合
  // ==========================================================================
  const nextContacts: Record<string, TacticalContact> = {};
  const aliveUnits = Object.values(units).filter(
    (u) => u.hp > 0 && u.status !== 'destroyed'
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
      let bestUncertaintyKm = Infinity;
      let bestClassification: TacticalContact['classification'] = 'unknown';

      for (const observer of friendlyUnits) {
        const obsSpec = catalog.platforms[observer.platformId];
        if (!obsSpec) continue;

        const distKm = getDistanceKm(observer.position, target.position);

        // 计算目标相对该观察者雷达视线的姿态等效 RCS (正前/侧向/尾向 + 外挂惩罚)
        const aspectRcsM2 = calculateAspectEffectiveRcsM2(
          targetSpec,
          observer.position,
          target.position,
          target.heading,
          loadoutRcsPenalty
        );

        for (const sensorId of configurations.get(observer.id)!.sensorIds) {
          const sensor = catalog.sensors[sensorId];
          if (!sensor) continue;
          if (!sensor.detectDomains.includes(target.domain)) continue;

          // A. 主动雷达探测 (受姿态 RCS 与敌方 OECM 压制影响)
          if (
            sensor.type === 'radar_air_surface' ||
            sensor.type === 'radar_oth'
          ) {
            if (!observer.doctrine.emconRadar) continue;

            const effRangeKm = calculateEffectiveRadarRangeKm(
              sensor,
              aspectRcsM2,
              observer.altitudeM,
              obsSpec.radarAntennaHeightM,
              target.altitudeM,
              targetEcmSuppression
            );

            if (distKm <= effRangeKm) {
              detectingSources.push(`${observer.callsign} (${sensor.codeName})`);
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
            if (!target.doctrine.emconRadar && !target.doctrine.emconJamming)
              continue;
            const horizonKm =
              calculateRadarHorizonKm(
                observer.altitudeM,
                obsSpec.radarAntennaHeightM,
                target.altitudeM
              ) * 1.28;
            const esmRangeKm = Math.min(sensor.maxRangeKm, horizonKm);

            if (distKm <= esmRangeKm) {
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

          // C. 光电/红外被动搜索 (IRST/EOTS) —— 不受射频电子干扰影响！
          else if (sensor.type === 'irst_optical') {
            const horizonKm = calculateRadarHorizonKm(
              observer.altitudeM,
              obsSpec.radarAntennaHeightM,
              target.altitudeM
            );
            const effRangeKm = Math.min(sensor.maxRangeKm, horizonKm);
            if (distKm <= effRangeKm) {
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
            const sonarRangeKm = calculateSonarDetectionRangeKm(
              sensor,
              observer.altitudeM,
              target.altitudeM,
              targetSpec.acousticSignatureDb,
              target.speedKts,
              target.doctrine.emconSonar
            );

            if (distKm <= sonarRangeKm) {
              detectingSources.push(
                `${observer.callsign} (${
                  sensor.type === 'sonar_active' ? '主动声呐回波' : '被动拖曳阵监听'
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
      }

      const contactKey = `${observerSide}_CONTACT_${target.id}`;
      const prevContact = world.contacts[contactKey];

      if (detectingSources.length > 0) {
        if (detectingSources.length >= 2 && bestUncertaintyKm > 1.0) {
          bestUncertaintyKm = Number((bestUncertaintyKm * 0.45).toFixed(2));
        }

        let estimatedPos: [number, number] = [...target.position];
        if (bestUncertaintyKm > 2.0) {
          const hashAngle =
            (target.id.charCodeAt(0) * 73 + Math.floor(nextSimTime / 10000)) %
            360;
          const offsetDest = turf.destination(
            target.position,
            bestUncertaintyKm * 0.35,
            hashAngle,
            { units: 'kilometers' }
          );
          estimatedPos = offsetDest.geometry.coordinates as [number, number];
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
          target.category === 'stealth_fighter' ||
          target.category === 'destroyer' ||
          target.category === 'ssn' ||
          target.category === 'sam_battery'
            ? 'critical'
            : target.category === 'bomber' ||
              target.category === 'carrier' ||
              target.category === 'ew_aircraft'
            ? 'high'
            : 'medium';

        nextContacts[contactKey] = {
          id: contactKey,
          actualUnitId: target.id,
          observerSide,
          targetSide: target.side,
          domain: target.domain,
          classification: bestClassification,
          displayName,
          sidc: getContactSidc(target.domain, bestClassification, target.side),
          estimatedPosition: estimatedPos,
          truePosition: [...target.position],
          uncertaintyRadiusKm: Number(bestUncertaintyKm.toFixed(1)),
          uncertaintyPolygon: buildAouPolygon(estimatedPos, bestUncertaintyKm),
          heading: Math.round(target.heading),
          speedKts: Math.round(target.speedKts),
          altitudeM: Math.round(target.altitudeM),
          firstDetectedTime: prevContact
            ? prevContact.firstDetectedTime
            : nextSimTime,
          lastDetectedTime: nextSimTime,
          detectedBySources: Array.from(new Set(detectingSources)).slice(0, 3),
          isJammingDetected: target.doctrine.emconJamming,
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
            unitId: target.id,
          });
          triggerPauseIfMatch(
            autoPauseSettings.onNewContact,
            `[${observerSide}] 发现新战术接触: ${displayName}`,
            observerSide
          );
        }
      } else if (
        prevContact &&
        nextSimTime - prevContact.lastDetectedTime <= 25000
      ) {
        const expandedRadius = Math.min(
          35,
          prevContact.uncertaintyRadiusKm + dtSec * 0.4
        );
        nextContacts[contactKey] = {
          ...prevContact,
          uncertaintyRadiusKm: Number(expandedRadius.toFixed(1)),
          uncertaintyPolygon: buildAouPolygon(
            prevContact.estimatedPosition,
            expandedRadius
          ),
        };
      }
    }
  }

  // ==========================================================================
  // STEP 3: 防空反导拦截 AI & 条令自动火力分配
  // ==========================================================================
  for (const shooter of aliveUnits) {
    if (shooter.doctrine.roe === 'hold') continue;

    // 3A. 优先拦截来袭敌方导弹
    const samMounts = shooter.mounts.filter((m) => {
      const wSpec = catalog.weapons[m.weaponId];
      return (
        wSpec &&
        wSpec.canInterceptMissile &&
        m.currentAmmo > 0 &&
        m.cooldownRemainingSec <= 0
      );
    });

    if (samMounts.length > 0) {
      const incomingEnemyMissiles = Object.values(weaponsInFlight).filter(
        (m) =>
          m.side !== shooter.side &&
          m.targetType === 'unit' &&
          !m.isIntercepted &&
          m.altitudeM >= -5
      );

      for (const vampire of incomingEnemyMissiles) {
        const samMount = samMounts[0];
        const samSpec = catalog.weapons[samMount.weaponId];
        if (
          !samSpec ||
          samMount.currentAmmo <= 0 ||
          samMount.cooldownRemainingSec > 0
        )
          break;

        const distToVampireKm = getDistanceKm(
          shooter.position,
          vampire.position
        );
        const shooterPlatform = catalog.platforms[shooter.platformId];
        const ownHorizonKm = calculateRadarHorizonKm(
          shooter.altitudeM,
          shooterPlatform?.radarAntennaHeightM || 20,
          vampire.altitudeM
        );
        const hasFriendlyAwacsCec = aliveUnits.some(
          (u) =>
            u.side === shooter.side &&
            u.category === 'awacs' &&
            u.doctrine.emconRadar &&
            getDistanceKm(u.position, vampire.position) <= 420
        );
        const maxInterceptRangeKm = hasFriendlyAwacsCec
          ? samSpec.maxRangeKm * 0.85
          : Math.min(samSpec.maxRangeKm, ownHorizonKm);

        if (
          distToVampireKm <= maxInterceptRangeKm &&
          distToVampireKm >= samSpec.minRangeKm
        ) {
          const existingInterceptors = Object.values(weaponsInFlight).filter(
            (w) => w.side === shooter.side && w.targetId === vampire.id
          );
          if (existingInterceptors.length === 0) {
            const interceptCount = Math.min(2, samMount.currentAmmo);
            for (let i = 0; i < interceptCount; i++) {
              const interceptId = `msl_int_${nextSimTime}_${shooter.id}_${vampire.id}_${i}`;
              weaponsInFlight[interceptId] = {
                id: interceptId,
                weaponId: samSpec.id,
                name: samSpec.codeName,
                side: shooter.side,
                shooterId: shooter.id,
                shooterName: shooter.callsign,
                targetId: vampire.id,
                targetType: 'missile',
                position: [...shooter.position],
                launchPosition: [...shooter.position],
                trail: [[...shooter.position]],
                altitudeM: samSpec.cruiseAltitudeM,
                heading: getBearingDeg(shooter.position, vampire.position),
                speedKts: samSpec.speedKts,
                distanceRemainingKm: distToVampireKm,
                maxRangeKm: samSpec.maxRangeKm,
                traveledKm: 0,
                basePk: samSpec.basePk,
                warheadDamage: samSpec.warheadDamage,
                requiresDatalinkBeyondHorizon:
                  samSpec.requiresDatalinkBeyondHorizon,
                datalinkSupported: true,
              };
              samMount.currentAmmo -= 1;
              if (shooter.side === 'RED') score.redMissilesFired += 1;
              else score.blueMissilesFired += 1;
            }
            samMount.cooldownRemainingSec = samMount.reloadTimeSec;
            recordWeaponLaunch(shooter, samMount, interceptCount, nextSimTime);

            newLogs.push({
              id: `log_int_launch_${nextSimTime}_${shooter.id}_${vampire.id}`,
              simTime: nextSimTime,
              side: shooter.side,
              category: 'LAUNCH',
              severity: 'info',
              title: `${shooter.callsign} 发射防空拦截弹 (${samSpec.codeName} x${interceptCount})`,
              message: `${shooter.name} 升空拦截来袭 ${vampire.name}（距本舰 ${distToVampireKm.toFixed(
                1
              )} km${
                hasFriendlyAwacsCec && distToVampireKm > ownHorizonKm
                  ? '，由预警机CEC超视距引导'
                  : ''
              }）。`,
              position: [...shooter.position],
              unitId: shooter.id,
            });
          }
        }
      }
    }

    // 3B. 对已探明的敌方高威胁 Contact 自动开火
    if (
      shooter.doctrine.roe === 'free' &&
      shooter.doctrine.engageOpportunityTargets
    ) {
      const readyMounts = shooter.mounts.filter(
        (m) => m.currentAmmo > 0 && m.cooldownRemainingSec <= 0
      );
      if (readyMounts.length === 0) continue;

      const sideContacts = Object.values(nextContacts).filter(
        (c) =>
          c.observerSide === shooter.side &&
          c.uncertaintyRadiusKm <= 8.0 &&
          c.classification !== 'unknown'
      );

      for (const contact of sideContacts) {
        const targetUnit = units[contact.actualUnitId];
        if (!targetUnit || targetUnit.hp <= 0) continue;

        const distKm = getDistanceKm(
          shooter.position,
          contact.estimatedPosition
        );

        const matchingMount = readyMounts.find((m) => {
          const wSpec = catalog.weapons[m.weaponId];
          if (!wSpec) return false;
          if (!wSpec.targetDomains.includes(contact.domain)) return false;
          if (distKm > wSpec.maxRangeKm * 0.92 || distKm < wSpec.minRangeKm)
            return false;
          if (wSpec.canInterceptMissile && m.currentAmmo <= m.maxAmmo * 0.4) {
            return false;
          }
          return true;
        });

        if (!matchingMount) continue;
        const wSpec = catalog.weapons[matchingMount.weaponId]!;

        const inFlightToTarget = Object.values(weaponsInFlight).filter(
          (w) =>
            w.side === shooter.side &&
            w.targetType === 'unit' &&
            w.targetId === targetUnit.id
        );
        if (inFlightToTarget.length >= shooter.doctrine.salvoSize) continue;

        const salvo = Math.min(
          shooter.doctrine.salvoSize,
          matchingMount.currentAmmo
        );

        for (let i = 0; i < salvo; i++) {
          const mslId = `msl_${nextSimTime}_${shooter.id}_${targetUnit.id}_${i}`;
          weaponsInFlight[mslId] = {
            id: mslId,
            weaponId: wSpec.id,
            name: wSpec.codeName,
            side: shooter.side,
            shooterId: shooter.id,
            shooterName: shooter.callsign,
            targetId: targetUnit.id,
            targetType: 'unit',
            position: [...shooter.position],
            launchPosition: [...shooter.position],
            trail: [[...shooter.position]],
            altitudeM: wSpec.cruiseAltitudeM,
            heading: getBearingDeg(shooter.position, targetUnit.position),
            speedKts: wSpec.speedKts,
            distanceRemainingKm: distKm,
            maxRangeKm: wSpec.maxRangeKm,
            traveledKm: 0,
            basePk: wSpec.basePk,
            warheadDamage: wSpec.warheadDamage,
            requiresDatalinkBeyondHorizon: wSpec.requiresDatalinkBeyondHorizon,
            datalinkSupported: true,
          };
          matchingMount.currentAmmo -= 1;
          if (shooter.side === 'RED') score.redMissilesFired += 1;
          else score.blueMissilesFired += 1;
        }

        matchingMount.cooldownRemainingSec = matchingMount.reloadTimeSec;
        recordWeaponLaunch(shooter, matchingMount, salvo, nextSimTime);
        shooter.status = 'engaged';

        const callout =
          wSpec.category === 'aam'
            ? 'FOX-3!'
            : wSpec.category === 'ashm'
            ? 'VAMPIRE! VAMPIRE!'
            : wSpec.category === 'torpedo'
            ? 'TORPEDO IN THE WATER!'
            : 'BIRDS AWAY!';

        newLogs.push({
          id: `log_launch_${nextSimTime}_${shooter.id}_${targetUnit.id}`,
          simTime: nextSimTime,
          side: shooter.side,
          category: 'LAUNCH',
          severity: 'warning',
          title: `${callout} ${shooter.callsign} 齐射 ${salvo} 枚 ${wSpec.codeName}`,
          message: `${shooter.name} 对目标 [${contact.displayName}]（距离 ${distKm.toFixed(
            1
          )} km）发起火力打击！`,
          position: [...shooter.position],
          unitId: shooter.id,
        });

        triggerPauseIfMatch(
          autoPauseSettings.onMissileDetected,
          `${callout} 侦测到导弹发射: ${wSpec.codeName} -> ${contact.displayName}`,
          targetUnit.side
        );
        break;
      }
    }
  }

  // ==========================================================================
  // STEP 4: 飞行中武器制导步进、数据链断链校验、防空反导与末端 CIWS/OECM 裁决
  // ==========================================================================
  const nextExplosions: TacticalExplosionEffect[] = world.explosions.filter(
    (e) => nextSimTime - e.createdAtSimTime < 8000
  );

  const sortedMissiles = Object.values(weaponsInFlight).sort((a, b) =>
    a.targetType === 'missile' && b.targetType !== 'missile' ? -1 : 1
  );

  for (const msl of sortedMissiles) {
    if (!weaponsInFlight[msl.id] || msl.isIntercepted) {
      delete weaponsInFlight[msl.id];
      continue;
    }

    const stepDistKm = (msl.speedKts * KTS_TO_KMPH * dtSec) / 3600;
    msl.traveledKm += stepDistKm;

    if (msl.traveledKm > msl.maxRangeKm * 1.05) {
      delete weaponsInFlight[msl.id];
      continue;
    }

    if (msl.targetType === 'missile') {
      const targetMsl = weaponsInFlight[msl.targetId];
      if (!targetMsl || targetMsl.isIntercepted) {
        delete weaponsInFlight[msl.id];
        continue;
      }

      const distKm = getDistanceKm(msl.position, targetMsl.position);
      const closingDistKm =
        stepDistKm + (targetMsl.speedKts * KTS_TO_KMPH * dtSec) / 3600;

      if (distKm <= Math.max(1.8, closingDistKm * 1.3)) {
        const isHypersonicTarget = targetMsl.speedKts >= 3800;
        const effectiveInterceptPk = isHypersonicTarget
          ? msl.basePk * 0.35
          : msl.basePk * 0.82;

        if (rng() < effectiveInterceptPk) {
          targetMsl.isIntercepted = true;
          delete weaponsInFlight[targetMsl.id];
          if (msl.side === 'RED') score.redInterceptions += 1;
          else score.blueInterceptions += 1;

          nextExplosions.push({
            id: `exp_int_${nextSimTime}_${msl.id}`,
            position: [...targetMsl.position],
            type: 'intercept',
            side: msl.side,
            label: `INTERCEPTED ${targetMsl.name}`,
            createdAtSimTime: nextSimTime,
            radiusKm: 4.5,
          });

          newLogs.push({
            id: `log_intercept_${nextSimTime}_${msl.id}`,
            simTime: nextSimTime,
            side: msl.side,
            category: 'INTERCEPT',
            severity: 'info',
            title: `成功拦截来袭导弹: ${msl.name} 击毁 ${targetMsl.name}`,
            message: `${msl.shooterName} 发射的 ${msl.name} 在空中成功凌空打爆敌方 ${targetMsl.name}！`,
            position: [...targetMsl.position],
          });
        }
        delete weaponsInFlight[msl.id];
      } else {
        msl.heading = getBearingDeg(msl.position, targetMsl.position);
        const nextPos = turf.destination(msl.position, stepDistKm, msl.heading, {
          units: 'kilometers',
        });
        msl.position = nextPos.geometry.coordinates as [number, number];
        msl.distanceRemainingKm = distKm - stepDistKm;
        msl.trail.push([...msl.position]);
        if (msl.trail.length > 18) msl.trail.shift();
      }
      continue;
    }

    // 目标是作战单元 (targetType === 'unit')
    const targetUnit = units[msl.targetId];
    if (!targetUnit || targetUnit.hp <= 0 || targetUnit.status === 'destroyed') {
      delete weaponsInFlight[msl.id];
      continue;
    }

    // ★ 检查超视距导弹的数据链中继引导支持 (CEC / Mid-course Datalink)
    const contactKey = `${msl.side}_CONTACT_${targetUnit.id}`;
    const currentContact = nextContacts[contactKey];
    const hasFreshDatalinkTrack =
      Boolean(currentContact) &&
      nextSimTime - currentContact.lastDetectedTime <= 5000 &&
      currentContact.uncertaintyRadiusKm <= 12;
    msl.datalinkSupported = hasFreshDatalinkTrack;

    const distToUnitKm = getDistanceKm(msl.position, targetUnit.position);
    if (distToUnitKm <= Math.max(1.2, stepDistKm * 1.2)) {
      const targetSpec = catalog.platforms[targetUnit.platformId];
      const ciwsProb = targetSpec ? targetSpec.ciwsDefenseProb : 0.2;
      const effectiveCiwsProb =
        msl.speedKts >= 3800 ? ciwsProb * 0.22 : ciwsProb * 0.55;

      // ★ 计算末端有效命中率 Pk：
      // 1) 若武器依赖超视距数据链中继且失去己方雷达/预警机跟踪，Pk 衰减 65%
      // 2) 若目标享有强有源电子干扰 (OECM)，非红外/反辐射武器 Pk 衰减，而反辐射导弹 (ARM) 攻击开机雷达则获得 +15% Pk 加成！
      const wSpec = catalog.weapons[msl.weaponId];
      let effectivePk = msl.basePk;

      if (msl.requiresDatalinkBeyondHorizon && !msl.datalinkSupported) {
        effectivePk *= 0.35; // 断链盲射导致末制导雷达开机找不到目标
      }

      const targetEcm = evaluateTargetEcmSuppression(
        targetUnit,
        aliveUnits,
        catalog
      );
      if (wSpec?.guidance === 'anti_radiation') {
        if (targetUnit.doctrine.emconRadar || targetUnit.doctrine.emconJamming) {
          effectivePk = Math.min(0.95, effectivePk + 0.14); // 反辐射导弹顺着开机电磁波精准灌顶
        } else {
          effectivePk *= 0.45; // 目标紧急关机静默规避反辐射导弹
        }
      } else if (wSpec?.guidance !== 'infrared' && targetEcm > 0) {
        effectivePk *= Math.max(0.45, 1 - targetEcm * 0.42);
      }

      if (rng() < effectiveCiwsProb) {
        if (targetUnit.side === 'RED') score.redInterceptions += 1;
        else score.blueInterceptions += 1;

        nextExplosions.push({
          id: `exp_ciws_${nextSimTime}_${msl.id}`,
          position: [...targetUnit.position],
          type: 'intercept',
          side: targetUnit.side,
          label: `CIWS DEFLECTED ${msl.name}`,
          createdAtSimTime: nextSimTime,
          radiusKm: 3.5,
        });

        newLogs.push({
          id: `log_ciws_${nextSimTime}_${msl.id}`,
          simTime: nextSimTime,
          side: targetUnit.side,
          category: 'INTERCEPT',
          severity: 'info',
          title: `${targetUnit.callsign} 末端近防系统成功拦截 ${msl.name}`,
          message: `${targetUnit.name} 通过近防炮/海拉姆与电子诱饵成功挫败 ${msl.name} 末端攻击！`,
          position: [...targetUnit.position],
          unitId: targetUnit.id,
        });
      } else if (rng() < effectivePk) {
        const damage = Math.round(msl.warheadDamage * (0.85 + 0.3 * rng()));
        targetUnit.hp = Math.max(0, targetUnit.hp - damage);

        if (targetUnit.hp <= 0) {
          targetUnit.status = 'destroyed';
          targetUnit.speedKts = 0;

          // 基础击毁分 + 高价值目标(航母/预警机/核潜艇)额外奖励分
          const killPts =
            targetUnit.category === 'carrier'
              ? 400
              : targetUnit.category === 'awacs' || targetUnit.category === 'ssn'
              ? 220
              : 150;

          if (targetUnit.side === 'RED') {
            score.redLosses += 1;
            score.blueScore += killPts;
          } else {
            score.blueLosses += 1;
            score.redScore += killPts;
          }

          nextExplosions.push({
            id: `exp_kill_${nextSimTime}_${msl.id}`,
            position: [...targetUnit.position],
            type: 'destroy',
            side: msl.side,
            label: `KILLED: ${targetUnit.callsign}`,
            createdAtSimTime: nextSimTime,
            radiusKm: 9.0,
          });

          newLogs.push({
            id: `log_kill_${nextSimTime}_${msl.id}`,
            simTime: nextSimTime,
            side: msl.side,
            category: 'DESTROYED',
            severity: 'critical',
            title: `战果确认: ${targetUnit.name} 被彻底击毁！ (+${killPts} PTS)`,
            message: `${msl.shooterName} 发射的 ${msl.name} 直接命中 ${targetUnit.name}，造成 ${damage} 点致命毁伤！`,
            position: [...targetUnit.position],
            unitId: targetUnit.id,
          });

          triggerPauseIfMatch(
            autoPauseSettings.onUnitHitOrDestroyed,
            `重大战果/损失: ${targetUnit.name} 被 ${msl.name} 击毁！`,
            'SYSTEM'
          );
        } else {
          if (msl.side === 'RED') score.redScore += 45;
          else score.blueScore += 45;

          nextExplosions.push({
            id: `exp_hit_${nextSimTime}_${msl.id}`,
            position: [...targetUnit.position],
            type: 'hit',
            side: msl.side,
            label: `HIT -${damage} HP`,
            createdAtSimTime: nextSimTime,
            radiusKm: 6.0,
          });

          newLogs.push({
            id: `log_hit_${nextSimTime}_${msl.id}`,
            simTime: nextSimTime,
            side: msl.side,
            category: 'HIT',
            severity: 'critical',
            title: `武器命中: ${msl.name} 重创 ${targetUnit.callsign} (-${damage} HP)`,
            message: `${targetUnit.name} 被 ${msl.name} 命中，剩余结构完好度 ${targetUnit.hp}/${targetUnit.maxHp}。`,
            position: [...targetUnit.position],
            unitId: targetUnit.id,
          });

          triggerPauseIfMatch(
            autoPauseSettings.onUnitHitOrDestroyed,
            `单位遭受打击: ${targetUnit.name} 命中受损 (-${damage} HP)`,
            'SYSTEM'
          );
        }
      } else {
        nextExplosions.push({
          id: `exp_miss_${nextSimTime}_${msl.id}`,
          position: [...targetUnit.position],
          type: 'miss',
          side: msl.side,
          label:
            msl.requiresDatalinkBeyondHorizon && !msl.datalinkSupported
              ? 'MISSED (LOST DATALINK)'
              : 'MISSED (SPOOFED)',
          createdAtSimTime: nextSimTime,
          radiusKm: 2.5,
        });
      }

      delete weaponsInFlight[msl.id];
    } else {
      msl.heading = getBearingDeg(msl.position, targetUnit.position);
      const nextPos = turf.destination(msl.position, stepDistKm, msl.heading, {
        units: 'kilometers',
      });
      msl.position = nextPos.geometry.coordinates as [number, number];
      msl.distanceRemainingKm = distToUnitKm - stepDistKm;
      msl.trail.push([...msl.position]);
      if (msl.trail.length > 18) msl.trail.shift();
    }
  }

  // ==========================================================================
  // STEP 5: ★ 动态想定事件触发器引擎 (Scenario Event Engine: Trigger -> Action)
  // ==========================================================================
  const elapsedSec = Math.max(0, (nextSimTime - startTime) / 1000);

  for (const ev of nextEvents) {
    if (!ev.repeatable && (ev.hasFired || score.firedEventIds.includes(ev.id))) {
      continue;
    }

    const occurrences = getEventOccurrences(ev, units, nextContacts, elapsedSec);
    for (let occurrence = 0; occurrence < occurrences; occurrence++) {
      ev.hasFired = true;
      ev.fireCount = (ev.fireCount ?? 0) + 1;
      if (!score.firedEventIds.includes(ev.id)) {
        score.firedEventIds.push(ev.id);
      }

      for (const [actionIndex, act] of ev.actions.entries()) {
        if (act.type === 'SPAWN_REINFORCEMENTS') {
          for (const placement of act.units) {
            if (
              placement.appearProbability !== undefined &&
              rng() >= placement.appearProbability
            ) {
              continue;
            }
            let spawnedId = placement.id;
            let suffix = ev.fireCount;
            while (Object.hasOwn(units, spawnedId)) {
              spawnedId = `${placement.id}__${ev.id}_${suffix++}`;
            }
            const spawned = createRuntimeUnitFromPlacement(
              { ...placement, id: spawnedId },
              catalog,
              rng
            );
            units[spawned.id] = spawned;
            newLogs.push({
              id: `log_ev_spawn_${nextSimTime}_${spawned.id}`,
              simTime: nextSimTime,
              side: spawned.side,
              category: 'EVENT',
              severity: 'warning',
              title: `[战役增援抵达] ${spawned.name} 进入战区！`,
              message: `事件 [${ev.name}] 触发：${spawned.name} (${spawned.callsign}) 已在 [${spawned.position[0].toFixed(
                2
              )}°E, ${spawned.position[1].toFixed(2)}°N] 投入战斗序列！`,
              position: [...spawned.position],
              unitId: spawned.id,
            });
          }
        } else if (act.type === 'ACTIVATE_MISSION') {
          for (const m of nextMissions) {
            if (m.id === act.missionId) {
              m.isActive = act.isActive;
            }
          }
        } else if (act.type === 'UPDATE_SIDE_DOCTRINE') {
          for (const u of Object.values(units)) {
            if (u.hp <= 0 || u.side !== act.side) continue;
            if (act.groupId && u.parentGroupId !== act.groupId) continue;
            u.doctrine = { ...u.doctrine, ...act.doctrinePatch };
          }
        } else if (act.type === 'BROADCAST_MESSAGE') {
          newLogs.push({
            id: `log_ev_msg_${nextSimTime}_${ev.id}_${ev.fireCount}_${actionIndex}`,
            simTime: nextSimTime,
            side: act.side,
            category: 'EVENT',
            severity: act.severity,
            title: `[战役事件 // ${ev.name}] ${act.title}`,
            message: act.message,
            position: act.position,
          });
        } else if (act.type === 'AWARD_SCORE') {
          if (act.side === 'RED') score.redScore += act.points;
          else score.blueScore += act.points;
        }
      }
    }
  }

  return {
    nextState: {
      startTime,
      simTime: nextSimTime,
      units,
      contacts: nextContacts,
      weaponsInFlight,
      explosions: nextExplosions,
      missions: deriveMissionAssignments(nextMissions, units),
      events: nextEvents,
      victoryConditions: world.victoryConditions,
      score,
    },
    newLogs,
    shouldAutoPause,
    autoPauseReason,
  };
}
