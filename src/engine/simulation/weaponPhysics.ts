import type {
  AutoPauseSettings,
  CombatLogEntry,
  EquipmentCatalog,
  RuntimeUnit,
  ScoreLedger,
  TacticalContact,
  TacticalExplosionEffect,
  VictoryConditionRule,
  WeaponInFlight,
} from '../../types/wargame';
import { advanceGuidance, seekerCanObserve } from '../guidance';
import { getDistanceKm } from '../geometry';
import { creditDamage } from '../objectives';
import { evaluateTargetEcmSuppression, observeMissile } from '../sensors';
import { getUnitCapabilities, isActiveUnit } from '../unitCapabilities';
import type { PauseTrigger } from './types';

export type WeaponPhysicsContext = {
  units: Record<string, RuntimeUnit>;
  contacts: Record<string, TacticalContact>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  previousExplosions: TacticalExplosionEffect[];
  catalog: EquipmentCatalog;
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

/** Advance in-flight weapons and resolve interception, terminal hit and damage. */
export function advanceWeaponPhysics({
  units,
  contacts,
  weaponsInFlight,
  previousExplosions,
  catalog,
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
    let target: RuntimeUnit | WeaponInFlight | undefined = missile.targetType === 'missile'
      ? weaponsInFlight[missile.targetId]
      : missile.targetType === 'unit' ? units[missile.targetId] : undefined;
    if (missile.targetType === 'area') {
      target = aliveUnits.filter((candidate) =>
        candidate.side !== missile.side && candidate.side !== 'NEUTRAL' &&
        seekerCanObserve(missile, weapon, candidate, catalog, false)
      ).sort((a, b) => getDistanceKm(missile.position, a.position) - getDistanceKm(missile.position, b.position) ||
        a.id.localeCompare(b.id))[0];
    }
    const contact = missile.targetType === 'missile'
      ? target
        ? observeMissile(
            missile.side,
            target as WeaponInFlight,
            units,
            catalog,
            nextSimTime,
            units[missile.shooterId]
          )
        : undefined
      : missile.targetType === 'unit' ? contacts[`${missile.side}_CONTACT_${missile.targetId}`] : undefined;
    const flight = advanceGuidance(
      missile,
      weapon,
      contact,
      units,
      catalog,
      nextSimTime,
      dtSec,
      target
    );
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
    let effectivePk = missile.basePk;
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
    } else if (weapon.guidance !== 'infrared' && targetEcm > 0) {
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
      });
    } else if (rng() < effectivePk) {
      const damage = Math.round(
        missile.warheadDamage * (0.85 + 0.3 * rng())
      );
      targetUnit.hp = Math.max(0, targetUnit.hp - damage);

      if (targetUnit.hp <= 0) {
        targetUnit.status = 'destroyed';
        targetUnit.speedKts = 0;
        creditDamage(
          score,
          targetUnit,
          creditedDamage,
          1,
          victoryConditions
        );
        if (targetUnit.side === 'RED') score.redLosses += 1;
        else if (targetUnit.side === 'BLUE') score.blueLosses += 1;

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
          message: `${targetUnit.name} 被 ${missile.name} 命中，剩余结构完好度 ${targetUnit.hp}/${targetUnit.maxHp}。`,
          position: [...targetUnit.position],
          unitId: targetUnit.id,
          targetUnitId: targetUnit.id,
          weaponId: weapon.id,
          quantity: 1,
          aarSide: missile.side,
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
