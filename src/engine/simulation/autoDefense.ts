import type {
  AutoPauseSettings,
  CombatLogEntry,
  EquipmentCatalog,
  PendingTotStrikeOrder,
  RuntimeUnit,
  ScenarioEnvironment,
  ScoreLedger,
  TacticalContact,
  TacticalMission,
  WeaponInFlight,
} from '../../types/wargame';
import {
  countActiveGuidanceChannels,
  evaluateFireControl,
  resolveMaxGuidanceChannels,
  weaponLaunchRangeKm,
  weaponUsesGuidanceChannel,
} from '../fireControl';
import { findShootAndScootDestination } from '../environment';
import { getBearingDeg, getDistanceKm, calculateRadarHorizonKm } from '../geometry';
import { launchGuidance } from '../guidance';
import { effectiveDoctrine } from '../operations';
import { observeMissile } from '../sensors';
import { getUnitCapabilities, isActiveUnit } from '../unitCapabilities';
import { recordWeaponLaunch } from '../unitConfiguration';
import type { PauseTrigger } from './types';

export type AutoDefenseContext = {
  units: Record<string, RuntimeUnit>;
  missions: TacticalMission[];
  contacts: Record<string, TacticalContact>;
  weaponsInFlight: Record<string, WeaponInFlight>;
  catalog: EquipmentCatalog;
  environment?: ScenarioEnvironment;
  nextSimTime: number;
  score: ScoreLedger;
  logs: CombatLogEntry[];
  previousDetectedMissileIds?: string[];
  autoPauseSettings: AutoPauseSettings;
  triggerPause: PauseTrigger;
};

const THREAT_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

/** Resolve automatic defensive/offensive launches and missile warning tracks. */
export function runAutoDefense({
  units,
  missions,
  contacts,
  weaponsInFlight,
  catalog,
  environment,
  nextSimTime,
  score,
  logs,
  previousDetectedMissileIds,
  autoPauseSettings,
  triggerPause,
}: AutoDefenseContext): string[] {
  const aliveUnits = Object.values(units).filter(isActiveUnit);

  for (const shooter of aliveUnits) {
    const doctrine = effectiveDoctrine(shooter, missions);
    const fireUnit = { ...shooter, doctrine };
    if (doctrine.roe === 'hold' || !getUnitCapabilities(shooter).canFire) {
      continue;
    }

    const samMounts = shooter.mounts.filter((mount) => {
      const weapon = catalog.weapons[mount.weaponId];
      return (
        weapon &&
        weapon.canInterceptMissile &&
        mount.currentAmmo > 0 &&
        mount.cooldownRemainingSec <= 0
      );
    });

    if (samMounts.length > 0) {
      const incomingEnemyMissiles = Object.values(weaponsInFlight).filter(
        (missile) =>
          missile.side !== shooter.side &&
          missile.targetType !== 'missile' &&
          !missile.isIntercepted &&
          missile.altitudeM >= -5
      );

      for (const incoming of incomingEnemyMissiles.sort((a, b) => a.id.localeCompare(b.id))) {
        const missileContact = observeMissile(
          shooter.side,
          incoming,
          units,
          catalog,
          nextSimTime,
          shooter,
          environment
        );
        if (!missileContact) continue;

        if (!doctrine.automaticTargetDomains.includes(missileContact.domain) ||
            THREAT_RANK[missileContact.threatLevel] < THREAT_RANK[doctrine.minimumAutomaticThreat]) continue;
        const existingInterceptors = Object.values(weaponsInFlight).filter(
          (weapon) => weapon.side === shooter.side && weapon.targetType === 'missile' &&
            weapon.targetId === incoming.id && !weapon.isIntercepted
        );
        const desiredInterceptors = Math.max(1, doctrine.salvoSize);
        const neededInterceptors = Math.max(0, desiredInterceptors - existingInterceptors.length);
        if (neededInterceptors === 0) continue;

        const candidates = samMounts.flatMap((mount) => {
          const weapon = catalog.weapons[mount.weaponId];
          const availableAmmo = mount.currentAmmo - doctrine.minimumWeaponReserve;
          if (!weapon || mount.cooldownRemainingSec > 0 || availableAmmo <= 0) return [];
          const solution = evaluateFireControl(
            fireUnit,
            missileContact,
            mount,
            weapon,
            catalog,
            units,
            nextSimTime,
            'defense',
            weaponsInFlight
          );
          if (solution.status !== 'executable' || solution.distanceKm === undefined ||
              solution.distanceKm > weapon.maxRangeKm * doctrine.automaticFireRangeFraction) return [];
          return [{
            mount,
            weapon,
            solution,
            availableAmmo,
            rangeMarginKm: weapon.maxRangeKm - solution.distanceKm,
            inventoryRatio: mount.currentAmmo / Math.max(1, mount.maxAmmo),
          }];
        }).sort((a, b) =>
          a.rangeMarginKm - b.rangeMarginKm ||
          b.inventoryRatio - a.inventoryRatio ||
          a.weapon.id.localeCompare(b.weapon.id) ||
          a.mount.mountId.localeCompare(b.mount.mountId)
        );
        const selected = candidates[0];
        if (!selected) continue;

        const { mount: samMount, weapon: samSpec, solution } = selected;
        const distanceToIncomingKm = solution.distanceKm!;
        const maxCh = resolveMaxGuidanceChannels(catalog.platforms[shooter.platformId]);
        const usedCh = countActiveGuidanceChannels(shooter.id, weaponsInFlight, catalog);
        const channelCap = weaponUsesGuidanceChannel(samSpec) ? Math.max(0, maxCh - usedCh) : neededInterceptors;
        const interceptCount = Math.min(neededInterceptors, selected.availableAmmo, channelCap);
        if (interceptCount <= 0) continue;
        const hasFriendlyAwacsCec = missileContact.sourceUnitIds?.some((id) => id !== shooter.id);
        const ownHorizonKm = calculateRadarHorizonKm(
          shooter.altitudeM,
          catalog.platforms[shooter.platformId].radarAntennaHeightM,
          incoming.altitudeM
        );
        for (let index = 0; index < interceptCount; index++) {
          const interceptorIndex = existingInterceptors.length + index;
          const interceptorId = `msl_int_${nextSimTime}_${shooter.id}_${incoming.id}_${interceptorIndex}`;
          weaponsInFlight[interceptorId] = {
            id: interceptorId,
            weaponId: samSpec.id,
            name: samSpec.codeName,
            side: shooter.side,
            shooterId: shooter.id,
            shooterName: shooter.callsign,
            targetId: incoming.id,
            targetType: 'missile',
            position: [...shooter.position],
            launchPosition: [...shooter.position],
            trail: [[...shooter.position]],
            altitudeM: samSpec.cruiseAltitudeM,
            heading: getBearingDeg(shooter.position, incoming.position),
            speedKts: samSpec.speedKts,
            distanceRemainingKm: distanceToIncomingKm,
            maxRangeKm: samSpec.maxRangeKm,
            traveledKm: 0,
            basePk: samSpec.basePk,
            warheadDamage: samSpec.warheadDamage,
            requiresDatalinkBeyondHorizon: samSpec.requiresDatalinkBeyondHorizon,
            datalinkSupported: true,
            ...launchGuidance(missileContact),
          };
          samMount.currentAmmo -= 1;
          if (shooter.side === 'RED') score.redMissilesFired += 1;
          else score.blueMissilesFired += 1;
        }
        samMount.cooldownRemainingSec = samMount.reloadTimeSec * getUnitCapabilities(shooter).reloadFactor;
        recordWeaponLaunch(shooter, samMount, interceptCount, nextSimTime);

        logs.push({
          id: `log_int_launch_${nextSimTime}_${shooter.id}_${incoming.id}`,
          simTime: nextSimTime,
          side: shooter.side,
          category: 'LAUNCH',
          severity: 'info',
          title: `${shooter.callsign} 发射防空拦截弹 (${samSpec.codeName} x${interceptCount})`,
          message: `${shooter.name} 从 ${candidates.length} 个可执行防空解中选择最小射程裕度 ${selected.rangeMarginKm.toFixed(1)} km 的 ${samSpec.codeName}，拦截距本舰 ${distanceToIncomingKm.toFixed(1)} km 来袭武器${
            hasFriendlyAwacsCec && distanceToIncomingKm > ownHorizonKm ? '（预警机CEC超视距引导）' : ''
          }。`,
          position: [...shooter.position],
          unitId: shooter.id,
          weaponId: samSpec.id,
          quantity: interceptCount,
        });
      }
    }

    if (shooter.coordinatedAttack && nextSimTime < shooter.coordinatedAttack.releaseAtSimTime) {
      continue;
    }
    if (
      doctrine.roe !== 'free' ||
      !doctrine.engageOpportunityTargets ||
      shooter.status === 'returning'
    ) {
      continue;
    }

    const readyMounts = shooter.mounts.filter(
      (mount) => mount.currentAmmo > 0 && mount.cooldownRemainingSec <= 0
    );
    if (readyMounts.length === 0) continue;

    const coordinatedContactId = shooter.coordinatedAttack?.contactId;
    const sideContacts = Object.values(contacts).filter(
      (contact) => contact.observerSide === shooter.side &&
        (!coordinatedContactId || contact.id === coordinatedContactId) &&
        (!coordinatedContactId || nextSimTime - contact.lastDetectedTime <= 5000)
    );
    if (coordinatedContactId && sideContacts.length === 0) {
      shooter.coordinatedAttack = undefined;
      continue;
    }
    for (const contact of sideContacts) {
      if (!doctrine.automaticTargetDomains.includes(contact.domain) ||
          THREAT_RANK[contact.threatLevel] < THREAT_RANK[doctrine.minimumAutomaticThreat]) continue;
      const targetId = contact.actualUnitId;
      const distanceKm = getDistanceKm(
        shooter.position,
        contact.estimatedPosition
      );
      const matchingMount = readyMounts.find((mount) => {
        const weapon = catalog.weapons[mount.weaponId];
        if (!weapon) return false;
        const solution = evaluateFireControl(
          fireUnit,
          contact,
          mount,
          weapon,
          catalog,
          units,
          nextSimTime,
          'automatic',
          weaponsInFlight
        );
        if (solution.status !== 'executable' ||
            solution.distanceKm! > weaponLaunchRangeKm(weapon) * doctrine.automaticFireRangeFraction ||
            mount.currentAmmo <= doctrine.minimumWeaponReserve) return false;
        return !(weapon.canInterceptMissile && mount.currentAmmo <= mount.maxAmmo * 0.4);
      });
      if (!matchingMount) continue;

      const weapon = catalog.weapons[matchingMount.weaponId]!;
      const inFlightToTarget = Object.values(weaponsInFlight).filter(
        (inFlight) =>
          inFlight.side === shooter.side &&
          inFlight.targetType === 'unit' &&
          inFlight.targetId === targetId &&
          (!coordinatedContactId || inFlight.shooterId === shooter.id)
      );
      if (inFlightToTarget.length >= doctrine.salvoSize) continue;

      const maxCh = resolveMaxGuidanceChannels(catalog.platforms[shooter.platformId]);
      const usedCh = countActiveGuidanceChannels(shooter.id, weaponsInFlight, catalog);
      const offChannelCap = weaponUsesGuidanceChannel(weapon) ? Math.max(0, maxCh - usedCh) : doctrine.salvoSize;
      const salvo = Math.min(
        doctrine.salvoSize,
        matchingMount.currentAmmo - doctrine.minimumWeaponReserve,
        offChannelCap
      );
      if (salvo <= 0) continue;
      for (let index = 0; index < salvo; index++) {
        const missileId = `msl_${nextSimTime}_${shooter.id}_${targetId}_${index}`;
        weaponsInFlight[missileId] = {
          id: missileId,
          weaponId: weapon.id,
          name: weapon.codeName,
          side: shooter.side,
          shooterId: shooter.id,
          shooterName: shooter.callsign,
          targetId,
          targetType: 'unit',
          position: [...shooter.position],
          launchPosition: [...shooter.position],
          trail: [[...shooter.position]],
          altitudeM: weapon.launchMedium === 'air_drop' ? shooter.altitudeM : weapon.cruiseAltitudeM,
          heading: getBearingDeg(
            shooter.position,
            contact.estimatedPosition
          ),
          speedKts: weapon.launchMedium === 'air_drop' ? weapon.airDropSpeedKts! : weapon.speedKts,
          distanceRemainingKm: distanceKm,
          maxRangeKm: weapon.launchMedium === 'air_drop' ? weapon.airDropRangeKm! : weapon.maxRangeKm,
          traveledKm: 0,
          basePk: weapon.basePk,
          warheadDamage: weapon.warheadDamage,
          requiresDatalinkBeyondHorizon:
            weapon.requiresDatalinkBeyondHorizon,
          datalinkSupported: true,
          deliveryPhase: weapon.launchMedium === 'air_drop' ? 'air_drop' : undefined,
          ...launchGuidance(contact),
        };
        matchingMount.currentAmmo -= 1;
        if (shooter.side === 'RED') score.redMissilesFired += 1;
        else score.blueMissilesFired += 1;
      }

      matchingMount.cooldownRemainingSec =
        matchingMount.reloadTimeSec *
        getUnitCapabilities(shooter).reloadFactor;
      recordWeaponLaunch(shooter, matchingMount, salvo, nextSimTime);
      shooter.status = 'engaged';
      shooter.coordinatedAttack = undefined;

      if (
        shooter.domain === 'land' &&
        doctrine.shootAndScoot &&
        shooter.waypoints.length === 0 &&
        shooter.navigationMode !== 'formation'
      ) {
        const maxSpeed = catalog.platforms[shooter.platformId]?.maxSpeedKts ?? 0;
        if (maxSpeed > 0) {
          const scootTarget = findShootAndScootDestination(
            shooter.position,
            environment,
            4.5,
            Math.round(shooter.heading + 90)
          );
          if (scootTarget) {
            shooter.waypoints = [{ position: scootTarget, speedKts: maxSpeed }];
            shooter.targetSpeedKts = maxSpeed;
            logs.push({
              id: `scoot_${nextSimTime}_${shooter.id}`,
              simTime: nextSimTime,
              side: shooter.side,
              category: 'DOCTRINE',
              severity: 'info',
              title: `${shooter.callsign} 执行发射后转移 (Shoot-and-Scoot)`,
              message: '陆基机动火力单元开火后立即向预设隐蔽地域转移，规避敌方反制火力。',
              position: [...shooter.position],
              unitId: shooter.id,
            });
          }
        }
      }

      const callout =
        weapon.category === 'aam'
          ? 'FOX-3!'
          : weapon.category === 'ashm'
            ? 'VAMPIRE! VAMPIRE!'
            : weapon.category === 'torpedo'
              ? 'TORPEDO IN THE WATER!'
              : 'BIRDS AWAY!';
      logs.push({
        id: `log_launch_${nextSimTime}_${shooter.id}_${targetId}`,
        simTime: nextSimTime,
        side: shooter.side,
        category: 'LAUNCH',
        severity: 'warning',
        title: `${callout} ${shooter.callsign} 齐射 ${salvo} 枚 ${weapon.codeName}`,
        message: `${shooter.name} 对目标 [${contact.displayName}]（距离 ${distanceKm.toFixed(
          1
        )} km）发起火力打击！`,
        position: [...shooter.position],
        unitId: shooter.id,
        targetUnitId: targetId,
        weaponId: weapon.id,
        quantity: salvo,
      });
      break;
    }
  }

  const detectedMissileIds: string[] = [];
  for (const missile of Object.values(weaponsInFlight)) {
    for (const side of ['RED', 'BLUE'] as const) {
      if (missile.side === side) continue;
      const observed = observeMissile(
        side,
        missile,
        units,
        catalog,
        nextSimTime
      );
      if (!observed) continue;
      const key = `${side}:${missile.id}`;
      detectedMissileIds.push(key);
      if (!previousDetectedMissileIds?.includes(key)) {
        logs.push({
          id: `missile_contact_${nextSimTime}_${key}`,
          simTime: nextSimTime,
          side,
          category: 'DETECTION',
          severity: 'warning',
          title: '传感器捕获来袭武器',
          message: `观测来源：${observed.detectedBySources.join('、')}`,
          position: observed.estimatedPosition,
        });
        triggerPause(
          autoPauseSettings.onMissileDetected,
          '本方传感器捕获来袭武器',
          side
        );
      }
    }
  }
  return detectedMissileIds;
}

export function processPendingTotStrikeOrders(
  orders: PendingTotStrikeOrder[],
  units: Record<string, RuntimeUnit>,
  contacts: Record<string, TacticalContact>,
  missions: TacticalMission[],
  weaponsInFlight: Record<string, WeaponInFlight>,
  catalog: EquipmentCatalog,
  nextSimTime: number,
  score: ScoreLedger,
  logs: CombatLogEntry[]
): PendingTotStrikeOrder[] {
  if (!orders.length) return [];
  const remaining: PendingTotStrikeOrder[] = [];
  const sorted = [...orders].sort(
    (a, b) => a.launchAtSimTime - b.launchAtSimTime || a.orderId.localeCompare(b.orderId)
  );

  for (const order of sorted) {
    if (order.launchAtSimTime > nextSimTime + 1e-6) {
      remaining.push(order);
      continue;
    }
    const shooter = units[order.shooterId];
    const contact = contacts[order.contactId];
    const weapon = catalog.weapons[order.weaponId];
    if (!shooter || !isActiveUnit(shooter) || !getUnitCapabilities(shooter).canFire || !contact || !weapon) {
      continue;
    }
    const mount = shooter.mounts.find((m) => m.weaponId === order.weaponId && m.currentAmmo > 0);
    if (!mount) continue;
    if (mount.cooldownRemainingSec > 0) {
      if (nextSimTime - order.launchAtSimTime <= 15_000) {
        remaining.push(order);
      }
      continue;
    }
    const fireUnit = { ...shooter, doctrine: effectiveDoctrine(shooter, missions) };
    const solution = evaluateFireControl(
      fireUnit,
      contact,
      mount,
      weapon,
      catalog,
      units,
      nextSimTime,
      'manual',
      weaponsInFlight,
      order.doglegWaypoints
    );
    if (solution.status === 'blocked' || !solution.distanceKm) {
      continue;
    }
    const salvo = Math.min(order.salvoCount, mount.currentAmmo);
    if (salvo <= 0) continue;
    const areaAttack = weapon.guidance === 'anti_radiation' && contact.lastEmitterDetectedTime !== undefined;
    const firstLegTarget = order.doglegWaypoints?.[0] ?? contact.estimatedPosition;

    for (let i = 0; i < salvo; i++) {
      const missileId = `tot_${order.orderId}_${i}`;
      weaponsInFlight[missileId] = {
        id: missileId,
        weaponId: weapon.id,
        name: weapon.codeName,
        side: shooter.side,
        shooterId: shooter.id,
        shooterName: shooter.callsign,
        targetId: areaAttack ? contact.id : contact.actualUnitId,
        targetType: areaAttack ? 'area' : 'unit',
        position: [...shooter.position],
        launchPosition: [...shooter.position],
        trail: [[...shooter.position]],
        altitudeM: weapon.launchMedium === 'air_drop' ? shooter.altitudeM : weapon.cruiseAltitudeM,
        heading: getBearingDeg(shooter.position, firstLegTarget),
        speedKts: weapon.launchMedium === 'air_drop' ? weapon.airDropSpeedKts! : weapon.speedKts,
        distanceRemainingKm: solution.distanceKm,
        maxRangeKm: weapon.launchMedium === 'air_drop' ? weapon.airDropRangeKm! : weapon.maxRangeKm,
        traveledKm: 0,
        basePk: weapon.basePk,
        warheadDamage: weapon.warheadDamage,
        requiresDatalinkBeyondHorizon: weapon.requiresDatalinkBeyondHorizon,
        datalinkSupported: solution.supportSourceIds.length > 0,
        deliveryPhase: weapon.launchMedium === 'air_drop' ? 'air_drop' : undefined,
        waypoints: order.doglegWaypoints?.map((wp) => [...wp] as [number, number]),
        ...launchGuidance(contact),
      };
      mount.currentAmmo -= 1;
      if (shooter.side === 'RED') score.redMissilesFired += 1;
      else score.blueMissilesFired += 1;
    }
    mount.cooldownRemainingSec = mount.reloadTimeSec * getUnitCapabilities(shooter).reloadFactor;
    recordWeaponLaunch(shooter, mount, salvo, nextSimTime);
    shooter.status = 'engaged';
    logs.push({
      id: `tot_launch_${nextSimTime}_${order.orderId}`,
      simTime: nextSimTime,
      side: shooter.side,
      category: 'LAUNCH',
      severity: 'warning',
      title: `[TOT同时弹着升空] ${shooter.callsign} 按计划释放 ${salvo} 枚 ${weapon.codeName}`,
      message: `预定弹着窗口 T+${Math.round((order.plannedImpactSimTime - nextSimTime) / 1000)}s，与友邻波次同步突防。`,
      position: [...shooter.position],
      unitId: shooter.id,
      weaponId: weapon.id,
      targetUnitId: areaAttack ? undefined : contact.actualUnitId,
      quantity: salvo,
    });
  }
  return remaining;
}
