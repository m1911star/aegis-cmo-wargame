import type {
  AutoPauseSettings,
  CombatLogEntry,
  EquipmentCatalog,
  RuntimeUnit,
  ScoreLedger,
  TacticalContact,
  TacticalMission,
  WeaponInFlight,
} from '../../types/wargame';
import { evaluateFireControl, weaponLaunchRangeKm } from '../fireControl';
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
          shooter
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
            'defense'
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
        const interceptCount = Math.min(neededInterceptors, selected.availableAmmo);
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
          'automatic'
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

      const salvo = Math.min(
        doctrine.salvoSize,
        matchingMount.currentAmmo - doctrine.minimumWeaponReserve
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
