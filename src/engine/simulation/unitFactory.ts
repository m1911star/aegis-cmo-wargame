import * as turf from '@turf/turf';
import { resolveUnitConfiguration } from '../../db/unitConfiguration';
import type {
  EquipmentCatalog,
  InitialUnitPlacement,
  RuntimeUnit,
} from '../../types/wargame';
import { createRuntimeWeaponMounts } from '../unitConfiguration';

/** Instantiate one scenario placement without mutating its input. */
export function createRuntimeUnitFromPlacement(
  placement: InitialUnitPlacement,
  catalog: EquipmentCatalog,
  rng: () => number = Math.random
): RuntimeUnit {
  const configuration = resolveUnitConfiguration(
    catalog,
    placement.platformId,
    placement.loadoutId
  );
  const spec = configuration.platform;
  const activeLoadoutId = configuration.loadoutId;

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
  const speedKts = Math.max(
    0,
    Math.min(
      configuration.maxSpeedKts,
      placement.speedKts ?? defaultCruiseKts
    )
  );
  const altitudeM = Math.max(
    spec.minAltitudeM,
    Math.min(
      spec.maxAltitudeM,
      placement.altitudeM ?? spec.defaultAltitudeM
    )
  );

  const defaultDoctrine = {
    roe: 'free' as const,
    emconRadar:
      spec.category === 'awacs' ||
      spec.category === 'sam_battery' ||
      spec.category === 'destroyer',
    emconSonar: false,
    emconJamming: spec.category === 'ew_aircraft',
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
      ? placement.waypoints.map((waypoint) => [...waypoint])
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
      cooldownRemainingSec:
        slot.readyAirframes === 0 && slot.totalAirframes > 0
          ? slot.launchCooldownSec
          : 0,
    })),
    assignedMissionId: placement.assignedMissionId,
  };
}
