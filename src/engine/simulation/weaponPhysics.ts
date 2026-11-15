import * as turf from '@turf/turf';
import type {
  AutoPauseSettings,
  CombatLogEntry,
  EquipmentCatalog,
  RuntimeUnit,
  ScenarioEnvironment,
  ScoreLedger,
  TacticalContact,
  TacticalExplosionEffect,
  VictoryConditionRule,
  WeaponInFlight,
  WeaponSpec,
} from '../../types/wargame';
import { evaluateWeatherModifiers, resolveMissileTerrainInteraction } from '../environment';
import { advanceGuidance, computeMissileEnergyFactor, seekerCanObserve } from '../guidance';
import { getBearingDeg, getDistanceKm } from '../geometry';
import { creditDamage } from '../objectives';
import { evaluateTargetEcmSuppression, hasDirectReconBdaCoverage, observeMissile } from '../sensors';
import { getUnitCapabilities, isActiveUnit } from '../unitCapabilities';
import type { PauseTrigger } from './types';

export type WeaponPhysicsContext = {
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  previousExplosions: TacticalExplosionEffect[];
  catalog: EquipmentCatalog;
  environment?: ScenarioEnvironment;
  nextSimTime: number;
  dtSec: number;
  score: ScoreLedger;
  creditedDamage: Record<string, number>;
  victoryConditions?: VictoryConditionRule;
  rng: () => number;
  logs: CombatLogEntry[];
  autoPauseSettings: AutoPauseSettings;
  triggerPause: PauseTrigger;
};

export function applySubsystemHitDamage(
  target: RuntimeUnit,
  weapon: WeaponSpec,
  hullDamage: number
): string[] {
  const sub = (target.subsystems ??= {
    sensors: 1,
    propulsion: 1,
    weapons: 1,
    fire: 0,
    flooding: 0,
  });
  const ratio = Math.max(0.05, hullDamage / Math.max(1, target.maxHp));
  const effects: string[] = [];

  if (weapon.guidance === 'anti_radiation') {
    sub.sensors = Math.max(0, Number((sub.sensors - Math.max(0.65, ratio * 1.4)).toFixed(3)));
    sub.weapons = Math.max(0, Number((sub.weapons - ratio * 0.25).toFixed(3)));
    if (sub.sensors <= 0.2) effects.push('雷达阵面被摧毁致盲');
    else effects.push('电子/传感器阵面重创');
  } else if (weapon.category === 'torpedo') {
    sub.propulsion = Math.max(0, Number((sub.propulsion - Math.max(0.52, ratio * 1.3)).toFixed(3)));
    if (target.domain === 'surface' || target.domain === 'subsurface') {
      sub.flooding = Math.min(1, Number((sub.flooding + Math.max(0.42, ratio * 0.9)).toFixed(3)));
      effects.push('水下破口进水、推进轴受损');
    }
  } else if (weapon.category === 'ashm' || weapon.category === 'lacm') {
    sub.weapons = Math.max(0, Number((sub.weapons - ratio * 0.45).toFixed(3)));
    sub.sensors = Math.max(0, Number((sub.sensors - ratio * 0.3).toFixed(3)));
    if (target.domain === 'land') {
      sub.propulsion = Math.max(0, Number((sub.propulsion - ratio * 0.35).toFixed(3)));
    }
    if (target.domain === 'surface' || target.category === 'airbase') {
      sub.fire = Math.min(1, Number((sub.fire + Math.max(0.38, ratio * 0.85)).toFixed(3)));
      if (sub.fire >= 0.35) effects.push('甲板/跑道起火暂停航空起降');
    }
  } else {
    sub.propulsion = Math.max(0, Number((sub.propulsion - ratio * 0.45).toFixed(3)));
    sub.sensors = Math.max(0, Number((sub.sensors - ratio * 0.35).toFixed(3)));
    sub.weapons = Math.max(0, Number((sub.weapons - ratio * 0.35).toFixed(3)));
  }

  return effects;
}

/** Advance in-flight weapons and resolve interception, terminal hit and damage. */
export function advanceWeaponPhysics({
  units,
  contacts,
  weaponsInFlight,
  previousExplosions,
  catalog,
  environment,
  nextSimTime,
  dtSec,
  score,
  creditedDamage,
  victoryConditions,
  rng,
  logs,
  autoPauseSettings,
  triggerPause,
}: WeaponPhysicsContext): TacticalExplosionEffect[] {
  const aliveUnits = Object.values(units).filter(isActiveUnit);
  const explosions = previousExplosions.filter(
    (effect) => nextSimTime - effect.createdAtSimTime < 8000
  );
  const sortedMissiles = Object.values(weaponsInFlight).sort(
    (left, right) =>
      Number(right.targetType === 'missile') -
        Number(left.targetType === 'missile') || left.id.localeCompare(right.id)
  );

  for (const missile of sortedMissiles) {
    if (!weaponsInFlight[missile.id] || missile.isIntercepted) {
      delete weaponsInFlight[missile.id];
      continue;
    }

    const weapon = catalog.weapons[missile.weaponId];
    if (!weapon) {
      delete weaponsInFlight[missile.id];
      continue;
    }
    if (missile.deliveryPhase === 'air_drop') {
      missile.aimPosition ??= turf.destination(
        missile.position, missile.distanceRemainingKm, missile.heading, { units: 'kilometers' }
      ).geometry.coordinates as [number, number];
      const distanceToEntryKm = getDistanceKm(missile.position, missile.aimPosition);
      const stepKm = Math.min(
        distanceToEntryKm,
        (weapon.airDropSpeedKts ?? missile.speedKts) * 1.852 * dtSec / 3600
      );
      if (distanceToEntryKm <= stepKm + 1e-9) {
        missile.position = [...missile.aimPosition];
        missile.altitudeM = weapon.waterEntryAltitudeM!;
        missile.speedKts = weapon.waterEntrySpeedKts!;
        missile.maxRangeKm = weapon.maxRangeKm;
        missile.traveledKm = 0;
        missile.distanceRemainingKm = weapon.maxRangeKm;
        missile.deliveryPhase = 'water_search';
        missile.seekerState = 'terminal_searching';
        missile.searchElapsedSec = 0;
        missile.trail.push([...missile.position]);
        logs.push({
          id: `water_entry_${nextSimTime}_${missile.id}`,
          simTime: nextSimTime,
          side: missile.side,
          category: 'EVENT',
          severity: 'info',
          title: `${missile.name} 入水`,
          message: `空投段结束，切换为 ${missile.speedKts}kt 声自导搜索。`,
          position: [...missile.position],
          weaponId: weapon.id,
        });
      } else {
        missile.heading = getBearingDeg(missile.position, missile.aimPosition);
        missile.position = turf.destination(missile.position, stepKm, missile.heading, { units: 'kilometers' })
          .geometry.coordinates as [number, number];
        missile.altitudeM = Math.max(10, missile.altitudeM - 250 * dtSec);
        missile.traveledKm += stepKm;
        missile.distanceRemainingKm = getDistanceKm(missile.position, missile.aimPosition);
        missile.trail.push([...missile.position]);
        if (missile.trail.length > 18) missile.trail.shift();
      }
      continue;
    }

    let target: RuntimeUnit | WeaponInFlight | undefined = missile.targetType === 'missile'
      ? weaponsInFlight[missile.targetId]
      : missile.targetType === 'unit' ? units[missile.targetId] : undefined;
    if (missile.targetType === 'area') {
      target = aliveUnits.filter((candidate) =>
        candidate.side !== missile.side && candidate.side !== 'NEUTRAL' &&
        seekerCanObserve(missile, weapon, candidate, catalog, false, environment)
      ).sort((a, b) => getDistanceKm(missile.position, a.position) - getDistanceKm(missile.position, b.position) ||
        a.id.localeCompare(b.id))[0];
    } else if (
      missile.targetType === 'unit' &&
      weapon.guidance !== 'semi_active_radar' &&
      (missile.seekerState === 'terminal_searching' || !target || !isActiveUnit(target as RuntimeUnit))
    ) {
      const canStayOnPrimary = target && isActiveUnit(target as RuntimeUnit) &&
        seekerCanObserve(missile, weapon, target, catalog, false, environment);
      if (!canStayOnPrimary && missile.seekerState?.startsWith('terminal')) {
        const alternative = aliveUnits.filter((candidate) =>
          candidate.side !== missile.side && candidate.side !== 'NEUTRAL' &&
          candidate.id !== missile.targetId &&
          seekerCanObserve(missile, weapon, candidate, catalog, false, environment)
        ).sort((a, b) =>
          getDistanceKm(missile.position, a.position) - getDistanceKm(missile.position, b.position) ||
          a.id.localeCompare(b.id)
        )[0];
        if (alternative) {
          missile.targetId = alternative.id;
          target = alternative;
          logs.push({
            id: `log_reacquire_${nextSimTime}_${missile.id}_${alternative.id}`,
            simTime: nextSimTime,
            side: missile.side,
            category: 'EVENT',
            severity: 'info',
            title: `${missile.name} 末段导引头切换捕获目标`,
            message: '原目标失去锁定或被摧毁，导引头在搜索视场内重新捕获到有效目标信号。',
            position: [...missile.position],
            unitId: missile.shooterId,
          });
        }
      }
    }
    const contact = missile.targetType === 'missile'
      ? target
        ? observeMissile(
            missile.side,
            target as WeaponInFlight,
            units,
            catalog,
            nextSimTime,
            units[missile.shooterId],
            environment
          )
        : undefined
      : missile.targetType === 'unit' ? contacts[`${missile.side}_CONTACT_${missile.targetId}`] : undefined;
    const beforePos: [number, number] = [...missile.position];
    const flight = advanceGuidance(
      missile,
      weapon,
      contact,
      units,
      catalog,
      nextSimTime,
      dtSec,
      target,
      environment
    );
    const terrainCheck = resolveMissileTerrainInteraction(
      beforePos,
      missile.position,
      missile.launchPosition,
      target ? target.position : missile.aimPosition,
      missile.altitudeM,
      weapon,
      environment
    );
    if (terrainCheck.impacted) {
      explosions.push({
        id: `exp_terrain_${nextSimTime}_${missile.id}`,
        position: [...missile.position],
        type: 'intercept',
        side: missile.side,
        label: `触山坠毁 ${missile.name}`,
        radiusKm: 2,
        createdAtSimTime: nextSimTime,
      });
      logs.push({
        id: `log_terrain_hit_${nextSimTime}_${missile.id}`,
        simTime: nextSimTime,
        side: missile.side,
        category: 'EVENT',
        severity: 'warning',
        title: `${missile.name} 撞击高地山脊坠毁`,
        message: `飞行高度 (${Math.round(missile.altitudeM)}m) 低于 ${terrainCheck.ridgeName ?? '高地山脊'} (${terrainCheck.ridgeElevationM ?? 0}m)，弹体触山损毁。`,
        position: [...missile.position],
        weaponId: weapon.id,
      });
      delete weaponsInFlight[missile.id];
      continue;
    }
    if (terrainCheck.terrainFollowAltitudeM !== undefined) {
      missile.altitudeM = terrainCheck.terrainFollowAltitudeM;
    }
    if (flight.expired) {
      logs.push({
        id: `log_lost_${nextSimTime}_${missile.id}`,
        simTime: nextSimTime,
        side: missile.side,
        category: 'EVENT',
        severity: 'info',
        title: `${missile.name} 搜索结束，未确认命中`,
        message: '导引头未保持捕获，或动力航程耗尽。',
        position: [...missile.position],
      });
      delete weaponsInFlight[missile.id];
      continue;
    }
    if (!flight.reached || !target) continue;

    if (missile.targetType === 'missile') {
      const targetMissile = target as WeaponInFlight;
      if (!targetMissile.isIntercepted) {
        const effectiveInterceptPk =
          targetMissile.speedKts >= 3800
            ? missile.basePk * 0.35
            : missile.basePk * 0.82;
        if (rng() < effectiveInterceptPk) {
          targetMissile.isIntercepted = true;
          delete weaponsInFlight[targetMissile.id];
          if (missile.side === 'RED') score.redInterceptions += 1;
          else score.blueInterceptions += 1;

          explosions.push({
            id: `exp_int_${nextSimTime}_${missile.id}`,
            position: [...targetMissile.position],
            type: 'intercept',
            side: missile.side,
            label: `INTERCEPTED ${targetMissile.name}`,
            createdAtSimTime: nextSimTime,
            radiusKm: 4.5,
          });
          logs.push({
            id: `log_intercept_${nextSimTime}_${missile.id}`,
            simTime: nextSimTime,
            side: missile.side,
            category: 'INTERCEPT',
            severity: 'info',
            title: `成功拦截来袭导弹: ${missile.name} 击毁 ${targetMissile.name}`,
            message: `${missile.shooterName} 发射的 ${missile.name} 在空中成功凌空打爆敌方 ${targetMissile.name}！`,
            position: [...targetMissile.position],
            unitId: missile.shooterId,
            weaponId: weapon.id,
            quantity: 1,
          });
        }
        delete weaponsInFlight[missile.id];
      }
      continue;
    }

    const targetUnit = target as RuntimeUnit;
    if (!isActiveUnit(targetUnit)) continue;

    const targetSpec = catalog.platforms[targetUnit.platformId];
    const ciwsProbability = targetSpec ? targetSpec.ciwsDefenseProb : 0.2;
    const effectiveCiwsProbability =
      missile.speedKts >= 3800
        ? ciwsProbability * 0.22
        : ciwsProbability * 0.55;
    let effectivePk = missile.basePk * (0.75 + 0.25 * computeMissileEnergyFactor(missile, weapon));
    const targetEcm = evaluateTargetEcmSuppression(
      targetUnit,
      aliveUnits,
      catalog
    );
    if (weapon.guidance === 'anti_radiation') {
      if (
        targetUnit.doctrine.emconRadar ||
        targetUnit.doctrine.emconJamming
      ) {
        effectivePk = Math.min(0.95, effectivePk + 0.14);
      } else {
        effectivePk *= 0.45;
      }
    } else if (weapon.guidance === 'infrared') {
      const weatherMods = evaluateWeatherModifiers(
        missile.position,
        missile.altitudeM,
        targetUnit.position,
        targetUnit.altitudeM,
        environment
      );
      if (weatherMods.opticalFactor < 0.85) {
        effectivePk *= 0.78;
      }
    } else if (targetEcm > 0) {
      effectivePk *= Math.max(0.45, 1 - targetEcm * 0.42);
    }

    const countermeasures = targetUnit.countermeasureEffect &&
      targetUnit.countermeasureEffect.expiresAtSimTime > nextSimTime
      ? targetUnit.countermeasureEffect : undefined;
    const softKillProbability = weapon.guidance === 'infrared' && countermeasures?.flares ? 0.4
      : weapon.guidance === 'acoustic_homing' && countermeasures?.acoustic ? 0.35
      : ['active_radar', 'semi_active_radar', 'hypersonic_glide'].includes(weapon.guidance) && countermeasures?.chaff ? 0.28
      : 0;
    if (softKillProbability > 0 && rng() < softKillProbability) {
      if (targetUnit.side === 'RED') score.redInterceptions += 1;
      else score.blueInterceptions += 1;
      explosions.push({
        id: `exp_softkill_${nextSimTime}_${missile.id}`,
        position: [...targetUnit.position],
        type: 'miss',
        side: targetUnit.side,
        label: `DECOYED ${missile.name}`,
        createdAtSimTime: nextSimTime,
        radiusKm: 2.5,
      });
      logs.push({
        id: `log_softkill_${nextSimTime}_${missile.id}`,
        simTime: nextSimTime,
        side: targetUnit.side,
        category: 'INTERCEPT',
        severity: 'info',
        title: `${targetUnit.callsign} 软杀伤诱骗 ${missile.name}`,
        message: '已投放的有限诱饵使来袭武器末段脱锁。',
        position: [...targetUnit.position],
        unitId: targetUnit.id,
        targetUnitId: targetUnit.id,
        weaponId: weapon.id,
        quantity: 1,
        aarShooterId: missile.shooterId,
        aarOutcome: 'softkill',
      });
      delete weaponsInFlight[missile.id];
      continue;
    }

    if (rng() < effectiveCiwsProbability) {
      if (targetUnit.side === 'RED') score.redInterceptions += 1;
      else score.blueInterceptions += 1;
      explosions.push({
        id: `exp_ciws_${nextSimTime}_${missile.id}`,
        position: [...targetUnit.position],
        type: 'intercept',
        side: targetUnit.side,
        label: `CIWS DEFLECTED ${missile.name}`,
        createdAtSimTime: nextSimTime,
        radiusKm: 3.5,
      });
      logs.push({
        id: `log_ciws_${nextSimTime}_${missile.id}`,
        simTime: nextSimTime,
        side: targetUnit.side,
        category: 'INTERCEPT',
        severity: 'info',
        title: `${targetUnit.callsign} 末端近防系统成功拦截 ${missile.name}`,
        message: `${targetUnit.name} 通过近防炮/海拉姆与电子诱饵成功挫败 ${missile.name} 末端攻击！`,
        position: [...targetUnit.position],
        unitId: targetUnit.id,
        targetUnitId: targetUnit.id,
        weaponId: weapon.id,
        quantity: 1,
        aarShooterId: missile.shooterId,
        aarOutcome: 'intercept',
      });
    } else if (rng() < effectivePk) {
      const damage = Math.round(
        missile.warheadDamage * (0.85 + 0.3 * rng())
      );
      targetUnit.hp = Math.max(0, targetUnit.hp - damage);
      const subsystemNotes = targetUnit.hp > 0 ? applySubsystemHitDamage(targetUnit, weapon, damage) : [];

      if (targetUnit.hp <= 0) {
        targetUnit.status = 'destroyed';
        targetUnit.speedKts = 0;
        if (!['decoy', 'sonobuoy'].includes(targetUnit.category)) {
          creditDamage(
            score,
            targetUnit,
            creditedDamage,
            1,
            victoryConditions
          );
          if (targetUnit.side === 'RED') score.redLosses += 1;
          else if (targetUnit.side === 'BLUE') score.blueLosses += 1;
        }

        const shooterContactKey = `${missile.side}_CONTACT_${targetUnit.id}`;
        const shooterContact = contacts[shooterContactKey];
        if (shooterContact) {
          const directBda = hasDirectReconBdaCoverage(
            missile.side,
            targetUnit.position,
            targetUnit.altitudeM,
            units,
            catalog,
            environment
          );
          if (directBda) {
            delete contacts[shooterContactKey];
            logs.push({
              id: `log_bda_visual_${nextSimTime}_${missile.id}`,
              simTime: nextSimTime,
              side: missile.side,
              category: 'DETECTION',
              severity: 'info',
              title: `[BDA目视/近距确认] ${shooterContact.displayName} 已被摧毁`,
              message: '本方近距传感器实时捕获目标解体/沉没，确认歼灭并核销接触。',
              position: [...targetUnit.position],
            });
          } else {
            shooterContact.bdaStatus = 'kill_unconfirmed';
          }
        }

        explosions.push({
          id: `exp_kill_${nextSimTime}_${missile.id}`,
          position: [...targetUnit.position],
          type: 'destroy',
          side: targetUnit.side,
          label: `KILLED: ${targetUnit.callsign}`,
          createdAtSimTime: nextSimTime,
          radiusKm: 9,
        });
        logs.push({
          id: `log_kill_${nextSimTime}_${missile.id}`,
          simTime: nextSimTime,
          side: targetUnit.side,
          category: 'DESTROYED',
          severity: 'critical',
          title: `本方损失: ${targetUnit.name} 被击毁`,
          message: `${targetUnit.name} 遭受致命毁伤，失去战斗力。`,
          position: [...targetUnit.position],
          unitId: targetUnit.id,
          targetUnitId: targetUnit.id,
          weaponId: weapon.id,
          quantity: 1,
          aarShooterId: missile.shooterId,
          aarOutcome: 'destroy',
        });
        triggerPause(
          autoPauseSettings.onUnitHitOrDestroyed,
          `重大战果/损失: ${targetUnit.name} 被 ${missile.name} 击毁！`,
          targetUnit.side
        );
      } else {
        creditDamage(
          score,
          targetUnit,
          creditedDamage,
          getUnitCapabilities(targetUnit).state === 'mission_killed'
            ? 0.7
            : Math.min(0.5, 1 - targetUnit.hp / targetUnit.maxHp),
          victoryConditions
        );
        explosions.push({
          id: `exp_hit_${nextSimTime}_${missile.id}`,
          position: [...targetUnit.position],
          type: 'hit',
          side: targetUnit.side,
          label: `HIT -${damage} HP`,
          createdAtSimTime: nextSimTime,
          radiusKm: 6,
        });
        logs.push({
          id: `log_hit_${nextSimTime}_${missile.id}`,
          simTime: nextSimTime,
          side: targetUnit.side,
          category: 'HIT',
          severity: 'critical',
          title: `武器命中: ${missile.name} 重创 ${targetUnit.callsign} (-${damage} HP)`,
          message: `${targetUnit.name} 被 ${missile.name} 命中，剩余结构完好度 ${targetUnit.hp}/${targetUnit.maxHp}${
            subsystemNotes.length > 0 ? `（子系统受损：${subsystemNotes.join('、')}）` : ''
          }。`,
          position: [...targetUnit.position],
          unitId: targetUnit.id,
          targetUnitId: targetUnit.id,
          weaponId: weapon.id,
          quantity: 1,
          aarSide: missile.side,
          aarShooterId: missile.shooterId,
          aarOutcome: 'hit',
        });
        triggerPause(
          autoPauseSettings.onUnitHitOrDestroyed,
          `单位遭受打击: ${targetUnit.name} 命中受损 (-${damage} HP)`,
          targetUnit.side
        );
      }
    } else {
      explosions.push({
        id: `exp_miss_${nextSimTime}_${missile.id}`,
        position: [...targetUnit.position],
        type: 'miss',
        side: missile.side,
        label: 'MISSED (TERMINAL)',
        createdAtSimTime: nextSimTime,
        radiusKm: 2.5,
      });
      logs.push({
        id: `log_miss_${nextSimTime}_${missile.id}`,
        simTime: nextSimTime,
        side: missile.side,
        category: 'EVENT',
        severity: 'info',
        title: `${missile.name} 末段脱靶`,
        message: `${missile.shooterName} 发射的 ${missile.name} 末段未能命中目标。`,
        position: [...targetUnit.position],
        unitId: missile.shooterId,
        targetUnitId: targetUnit.id,
        weaponId: weapon.id,
        quantity: 1,
        aarType: 'miss',
        aarSide: missile.side,
        aarShooterId: missile.shooterId,
        aarOutcome: 'miss',
      });
    }

    logs.push({
      id: `terminal_report_${nextSimTime}_${missile.id}`,
      simTime: nextSimTime,
      side: missile.side,
      category: 'EVENT',
      severity: 'info',
      title: `${missile.name} 末段攻击结束`,
      message: '最终效果需结合后续观测与任务结算判断，不提供敌方结构真值。',
      unitId: missile.shooterId,
    });
    delete weaponsInFlight[missile.id];
  }

  return explosions;
}
