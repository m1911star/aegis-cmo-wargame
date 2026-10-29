import { createRandomStream, DEFAULT_SEED, FIXED_DT_SEC } from './determinism';
import { evaluateFireControl } from './fireControl';
import { advanceGuidance, launchGuidance } from './guidance';
import { updateUnitOperations, effectiveDoctrine } from './operations';
import { evaluateObjectives, creditDamage } from './objectives';
import type { ScenarioObjective, ObjectiveProgress, BattleResult } from '../types/wargame';
import { calculateRadarHorizonKm, getDistanceKm, getBearingDeg } from './geometry';
import { computeContactsOnly, evaluateTargetEcmSuppression, observeMissile } from './sensors';
import { getUnitCapabilities, isActiveUnit } from './unitCapabilities';
import * as turf from '@turf/turf';
import type {
  ActivePerspective,
  AutoPauseSettings,
  BattleAssessmentGrade,
  CombatLogEntry,
  EquipmentCatalog,
  InitialUnitPlacement,
  RuntimeUnit,
  RuntimeScenarioEvent,
  MissionDefinition,
  ScoreLedger,
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
export { calculateRadarHorizonKm, getDistanceKm, getBearingDeg } from './geometry';
export { calculateAspectEffectiveRcsM2, calculateEffectiveRadarRangeKm, calculateSonarDetectionRangeKm, evaluateTargetEcmSuppression, buildAouPolygon, getContactSidc } from './sensors';

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
    recoveryPosition: [...(placement.recoveryPosition ?? finalPos)],
    navigationMode: placement.assignedMissionId ? 'mission' : 'manual',
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
  tick?: number;
  rngState?: number;
  objectives?: ScenarioObjective[];
  objectiveProgress?: ObjectiveProgress;
  battleResult?: BattleResult;
  creditedDamage?: Record<string, number>;
  detectedMissileIds?: string[];
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
  randomOverride?: () => number
): SimulationStepResult {
  if (world.battleResult) return { nextState: { ...world, missions: deriveMissionAssignments(world.missions, world.units) }, newLogs: [], shouldAutoPause: true };
  if (!Number.isFinite(dtSec) || dtSec <= 0) throw new Error('Simulation step must be positive');
  const random = createRandomStream(world.rngState ?? DEFAULT_SEED);
  const rng = randomOverride ?? random.next;
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

  const creditedDamage = { ...world.creditedDamage };
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
    updateUnitOperations(unit, units, world.contacts, nextMissions, catalog, nextSimTime, dtSec, score, newLogs);
    if (!isActiveUnit(unit)) continue;
    const speedLimit = configuration.maxSpeedKts * getUnitCapabilities(unit).speedFactor;
    unit.targetSpeedKts = Math.max(0, Math.min(speedLimit, unit.targetSpeedKts));
    unit.speedKts = Math.max(0, Math.min(speedLimit, unit.speedKts));



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

    if (unit.waypoints.length === 0 && unit.assignedMissionId && unit.navigationMode !== 'manual' && unit.status !== 'returning') {
      const mission = nextMissions.find(
        (m) => m.id === unit.assignedMissionId && m.isActive
      );
      if (mission && mission.areaPolygon.length >= 3) {
        unit.waypoints.push(turf.pointOnFeature(turf.polygon([[...mission.areaPolygon, mission.areaPolygon[0]]])).geometry.coordinates as [number, number]);
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
  for (const log of newLogs) {
    if (log.category === 'DESTROYED') triggerPauseIfMatch(autoPauseSettings.onUnitHitOrDestroyed, log.title, log.side);
  }
  const sensed = computeContactsOnly(units, catalog, world.contacts, nextSimTime, dtSec);
  const nextContacts = sensed.contacts;
  const aliveUnits = Object.values(units).filter(isActiveUnit);
  newLogs.push(...sensed.logs);
  for (const log of sensed.logs) {
    triggerPauseIfMatch(autoPauseSettings.onNewContact, log.title, log.side);
  }

  // ==========================================================================
  // STEP 3: 防空反导拦截 AI & 条令自动火力分配
  // ==========================================================================
  for (const shooter of aliveUnits) {
    const doctrine = effectiveDoctrine(shooter, nextMissions);
    const fireUnit = { ...shooter, doctrine };
    if (doctrine.roe === 'hold' || !getUnitCapabilities(shooter).canFire) continue;

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

        const missileContact = observeMissile(shooter.side, vampire, units, catalog, nextSimTime, shooter);
        if (!missileContact) continue;
        const solution = evaluateFireControl(fireUnit, missileContact, samMount, samSpec, catalog, units, nextSimTime, 'defense');
        const distToVampireKm = solution.distanceKm!;
        const hasFriendlyAwacsCec = missileContact.sourceUnitIds?.some((id) => id !== shooter.id);
        const ownHorizonKm = calculateRadarHorizonKm(shooter.altitudeM, catalog.platforms[shooter.platformId].radarAntennaHeightM, vampire.altitudeM);
        if (solution.status === 'executable') {
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
                ...launchGuidance(missileContact),
              };
              samMount.currentAmmo -= 1;
              if (shooter.side === 'RED') score.redMissilesFired += 1;
              else score.blueMissilesFired += 1;
            }
            samMount.cooldownRemainingSec = samMount.reloadTimeSec * getUnitCapabilities(shooter).reloadFactor;
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
      doctrine.roe === 'free' &&
      doctrine.engageOpportunityTargets && shooter.status !== 'returning'
    ) {
      const readyMounts = shooter.mounts.filter(
        (m) => m.currentAmmo > 0 && m.cooldownRemainingSec <= 0
      );
      if (readyMounts.length === 0) continue;

      const sideContacts = Object.values(nextContacts).filter(
        (c) =>
          c.observerSide === shooter.side
      );

      for (const contact of sideContacts) {
        const targetId = contact.actualUnitId;

        const distKm = getDistanceKm(
          shooter.position,
          contact.estimatedPosition
        );

        const matchingMount = readyMounts.find((m) => {
          const wSpec = catalog.weapons[m.weaponId];
          if (!wSpec) return false;
          if (evaluateFireControl(fireUnit, contact, m, wSpec, catalog, units, nextSimTime, 'automatic').status !== 'executable') return false;
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
            w.targetId === targetId
        );
        if (inFlightToTarget.length >= doctrine.salvoSize) continue;

        const salvo = Math.min(
          doctrine.salvoSize,
          matchingMount.currentAmmo
        );

        for (let i = 0; i < salvo; i++) {
          const mslId = `msl_${nextSimTime}_${shooter.id}_${targetId}_${i}`;
          weaponsInFlight[mslId] = {
            id: mslId,
            weaponId: wSpec.id,
            name: wSpec.codeName,
            side: shooter.side,
            shooterId: shooter.id,
            shooterName: shooter.callsign,
            targetId: targetId,
            targetType: 'unit',
            position: [...shooter.position],
            launchPosition: [...shooter.position],
            trail: [[...shooter.position]],
            altitudeM: wSpec.cruiseAltitudeM,
            heading: getBearingDeg(shooter.position, contact.estimatedPosition),
            speedKts: wSpec.speedKts,
            distanceRemainingKm: distKm,
            maxRangeKm: wSpec.maxRangeKm,
            traveledKm: 0,
            basePk: wSpec.basePk,
            warheadDamage: wSpec.warheadDamage,
            requiresDatalinkBeyondHorizon: wSpec.requiresDatalinkBeyondHorizon,
            datalinkSupported: true,
            ...launchGuidance(contact),
          };
          matchingMount.currentAmmo -= 1;
          if (shooter.side === 'RED') score.redMissilesFired += 1;
          else score.blueMissilesFired += 1;
        }

        matchingMount.cooldownRemainingSec = matchingMount.reloadTimeSec * getUnitCapabilities(shooter).reloadFactor;
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
          id: `log_launch_${nextSimTime}_${shooter.id}_${targetId}`,
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

        break;
      }
    }
  }

  const detectedMissileIds: string[] = [];
  for (const missile of Object.values(weaponsInFlight)) {
    for (const side of ['RED', 'BLUE'] as const) {
      if (missile.side === side) continue;
      const observed = observeMissile(side, missile, units, catalog, nextSimTime);
      if (!observed) continue;
      const key = `${side}:${missile.id}`;
      detectedMissileIds.push(key);
      if (!world.detectedMissileIds?.includes(key)) {
        newLogs.push({ id: `missile_contact_${nextSimTime}_${key}`, simTime: nextSimTime, side,
          category: 'DETECTION', severity: 'warning', title: '传感器捕获来袭武器',
          message: `观测来源：${observed.detectedBySources.join('、')}`, position: observed.estimatedPosition });
        triggerPauseIfMatch(autoPauseSettings.onMissileDetected, '本方传感器捕获来袭武器', side);
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
    Number(b.targetType === 'missile') - Number(a.targetType === 'missile') || a.id.localeCompare(b.id)
  );

  for (const msl of sortedMissiles) {
    if (!weaponsInFlight[msl.id] || msl.isIntercepted) {
      delete weaponsInFlight[msl.id];
      continue;
    }

    const wSpec = catalog.weapons[msl.weaponId];
    if (!wSpec) { delete weaponsInFlight[msl.id]; continue; }
    const target = msl.targetType === 'missile' ? weaponsInFlight[msl.targetId] : units[msl.targetId];
    const contact = msl.targetType === 'missile'
      ? (target ? observeMissile(msl.side, target as WeaponInFlight, units, catalog, nextSimTime, units[msl.shooterId]) : undefined)
      : nextContacts[`${msl.side}_CONTACT_${msl.targetId}`];
    const flight = advanceGuidance(msl, wSpec, contact, units, catalog, nextSimTime, dtSec, target);
    if (flight.expired) {
      newLogs.push({ id: `log_lost_${nextSimTime}_${msl.id}`, simTime: nextSimTime, side: msl.side,
        category: 'EVENT', severity: 'info', title: `${msl.name} 搜索结束，未确认命中`,
        message: '导引头未保持捕获，或动力航程耗尽。', position: [...msl.position] });
      delete weaponsInFlight[msl.id];
      continue;
    }
    if (!flight.reached || !target) continue;
    if (msl.targetType === 'missile') {
      const targetMsl = target as WeaponInFlight;
      if (!targetMsl.isIntercepted) {
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
      }
      continue;
    }

    const targetUnit = target as RuntimeUnit;
    if (isActiveUnit(targetUnit)) {
      const targetSpec = catalog.platforms[targetUnit.platformId];
      const ciwsProb = targetSpec ? targetSpec.ciwsDefenseProb : 0.2;
      const effectiveCiwsProb = msl.speedKts >= 3800 ? ciwsProb * 0.22 : ciwsProb * 0.55;
      let effectivePk = msl.basePk;
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

          creditDamage(score, targetUnit, creditedDamage, 1, world.victoryConditions);
          if (targetUnit.side === 'RED') score.redLosses += 1;
          else if (targetUnit.side === 'BLUE') score.blueLosses += 1;

          nextExplosions.push({
            id: `exp_kill_${nextSimTime}_${msl.id}`,
            position: [...targetUnit.position],
            type: 'destroy',
            side: targetUnit.side,
            label: `KILLED: ${targetUnit.callsign}`,
            createdAtSimTime: nextSimTime,
            radiusKm: 9.0,
          });

          newLogs.push({
            id: `log_kill_${nextSimTime}_${msl.id}`,
            simTime: nextSimTime,
            side: targetUnit.side,
            category: 'DESTROYED',
            severity: 'critical',
            title: `本方损失: ${targetUnit.name} 被击毁`,
            message: `${targetUnit.name} 遭受致命毁伤，失去战斗力。`,
            position: [...targetUnit.position],
            unitId: targetUnit.id,
          });

          triggerPauseIfMatch(
            autoPauseSettings.onUnitHitOrDestroyed,
            `重大战果/损失: ${targetUnit.name} 被 ${msl.name} 击毁！`,
            targetUnit.side
          );
        } else {
          creditDamage(score, targetUnit, creditedDamage,
            getUnitCapabilities(targetUnit).state === 'mission_killed' ? 0.7 : Math.min(0.5, 1 - targetUnit.hp / targetUnit.maxHp), world.victoryConditions);

          nextExplosions.push({
            id: `exp_hit_${nextSimTime}_${msl.id}`,
            position: [...targetUnit.position],
            type: 'hit',
            side: targetUnit.side,
            label: `HIT -${damage} HP`,
            createdAtSimTime: nextSimTime,
            radiusKm: 6.0,
          });

          newLogs.push({
            id: `log_hit_${nextSimTime}_${msl.id}`,
            simTime: nextSimTime,
            side: targetUnit.side,
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
            targetUnit.side
          );
        }
      } else {
        nextExplosions.push({
          id: `exp_miss_${nextSimTime}_${msl.id}`,
          position: [...targetUnit.position],
          type: 'miss',
          side: msl.side,
          label: 'MISSED (TERMINAL)',
          createdAtSimTime: nextSimTime,
          radiusKm: 2.5,
        });
      }

      newLogs.push({ id: `terminal_report_${nextSimTime}_${msl.id}`, simTime: nextSimTime, side: msl.side,
        category: 'EVENT', severity: 'info', title: `${msl.name} 末段攻击结束`,
        message: '最终效果需结合后续观测与任务结算判断，不提供敌方结构真值。', unitId: msl.shooterId });
      delete weaponsInFlight[msl.id];
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

  const objectiveEvaluation = evaluateObjectives(world.objectives ?? [], world.objectiveProgress ?? {},
    units, nextContacts, score, nextSimTime, startTime, world.victoryConditions);
  if (objectiveEvaluation.battleResult) {
    shouldAutoPause = true;
    autoPauseReason = '想定已结束：请查看任务结算与战报';
  }
  newLogs.push(...objectiveEvaluation.logs);

  return {
    nextState: {
      startTime,
      tick: (world.tick ?? 0) + 1,
      rngState: random.state(),
      objectives: world.objectives,
      objectiveProgress: objectiveEvaluation.progress,
      battleResult: objectiveEvaluation.battleResult,
      creditedDamage,
      detectedMissileIds,
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

export function initializeWorldContacts(world: SimulationWorldState, catalog: EquipmentCatalog): SimulationStepResult {
  const sensed = computeContactsOnly(world.units, catalog, world.contacts, world.simTime);
  return { nextState: { ...world, contacts: sensed.contacts, missions: deriveMissionAssignments(world.missions, world.units) },
    newLogs: sensed.logs, shouldAutoPause: false };
}

export function advanceSimulation(
  world: SimulationWorldState, catalog: EquipmentCatalog, seconds: number,
  autoPause: AutoPauseSettings, playerSide: ActivePerspective
): SimulationStepResult & { remainingSec: number } {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid simulation duration');
  let result: SimulationStepResult = { nextState: { ...world, missions: deriveMissionAssignments(world.missions, world.units) }, newLogs: [], shouldAutoPause: false };
  const logs: CombatLogEntry[] = [];
  let remainingSec = seconds;
  while (remainingSec + 1e-9 >= FIXED_DT_SEC && !result.nextState.battleResult) {
    result = stepSimulationWorld(result.nextState, catalog, FIXED_DT_SEC, autoPause, playerSide);
    logs.push(...result.newLogs);
    remainingSec = Math.max(0, remainingSec - FIXED_DT_SEC);
    if (result.shouldAutoPause) { remainingSec = 0; break; }
  }
  return { ...result, newLogs: logs, remainingSec };
}
