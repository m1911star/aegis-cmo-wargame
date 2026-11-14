import * as turf from '@turf/turf';
import type { EquipmentCatalog, RuntimeUnit, ScenarioEnvironment, TacticalContact, WeaponInFlight, WeaponSpec } from '../types/wargame';
import { hasRadarLineOfSight } from './environment';
import { calculateRadarHorizonKm, getBearingDeg, getDistanceKm } from './geometry';
import { guidanceProfile, trackSupport } from './fireControl';
import { isRadioEmitting, isActiveUnit } from './unitCapabilities';

const move = (position: [number, number], km: number, heading: number) =>
  turf.destination(position, km, heading, { units: 'kilometers' }).geometry.coordinates as [number, number];

export function computeMissileEnergyFactor(missile: WeaponInFlight, weapon: WeaponSpec): number {
  if (!Number.isFinite(weapon.maxRangeKm) || weapon.maxRangeKm <= 0) return 1;
  const ratio = Math.max(0, Math.min(1, missile.traveledKm / weapon.maxRangeKm));
  if (ratio <= 0.55) return 1;
  return Math.max(0.55, 1 - ((ratio - 0.55) / 0.45) * 0.45);
}

export function launchGuidance(contact: TacticalContact) {
  return {
    aimPosition: [...contact.estimatedPosition] as [number, number], aimHeading: contact.heading,
    aimSpeedKts: contact.speedKts, aimAltitudeM: contact.altitudeM, targetDomain: contact.domain,
    lastTrackTime: contact.lastDetectedTime, seekerState: 'midcourse_blind' as const, searchElapsedSec: 0,
  };
}

// Truth is permitted inside the sensor test and collision resolver, never as an unconditional steering input.
export function seekerCanObserve(
  missile: WeaponInFlight, weapon: WeaponSpec, target: RuntimeUnit | WeaponInFlight | undefined,
  catalog: EquipmentCatalog, supportAvailable: boolean, environment?: ScenarioEnvironment
): boolean {
  if (!target) return false;
  const isUnit = 'platformId' in target;
  if (isUnit ? !isActiveUnit(target) : target.isIntercepted) return false;
  const profile = guidanceProfile(weapon);
  if (profile.requiresSupport && !supportAvailable) return false;
  const domain = isUnit ? target.domain : 'air';
  if (!weapon.targetDomains.includes(domain)) return false;
  const distance = getDistanceKm(missile.position, target.position);
  const angle = Math.abs(((getBearingDeg(missile.position, target.position) - missile.heading + 540) % 360) - 180);
  if (angle > profile.seekerFovDeg / 2) return false;
  let range = profile.seekerRangeKm;
  if (weapon.guidance === 'acoustic_homing') {
    if (missile.altitudeM >= 0 || target.altitudeM > 0) return false;
  } else {
    range = Math.min(range, calculateRadarHorizonKm(missile.altitudeM, 0, target.altitudeM));
    if (!hasRadarLineOfSight(missile.position, missile.altitudeM, 0, target.position, target.altitudeM, environment)) {
      return false;
    }
  }
  if (weapon.guidance === 'anti_radiation') {
    if (!isUnit || !isRadioEmitting(target, catalog)) return false;
  } else if (['active_radar', 'semi_active_radar', 'hypersonic_glide'].includes(weapon.guidance)) {
    const rcs = isUnit ? catalog.platforms[target.platformId]?.rcsM2 ?? 5 : 0.1;
    range *= Math.min(1, Math.pow(Math.max(0.001, rcs) / 5, 0.25));
  }
  return distance <= range;
}

// Closest approach of two swept paths in a local tangent plane; avoids large-step proximity hits.
export function sweptSeparationKm(
  a0: [number, number], a1: [number, number], b0: [number, number], b1: [number, number]
) {
  const scale = Math.cos((a0[1] + b0[1]) * Math.PI / 360);
  const lon = (x: number) => ((x + 540) % 360) - 180;
  const x = lon(a0[0] - b0[0]) * scale;
  const y = a0[1] - b0[1];
  const dx = (lon(a1[0] - a0[0]) - lon(b1[0] - b0[0])) * scale;
  const dy = (a1[1] - a0[1]) - (b1[1] - b0[1]);
  const d2 = dx * dx + dy * dy;
  const t = d2 === 0 ? 0 : Math.max(0, Math.min(1, -(x * dx + y * dy) / d2));
  return Math.hypot(x + t * dx, y + t * dy) * 111.195;
}

export function advanceGuidance(
  missile: WeaponInFlight, weapon: WeaponSpec, contact: TacticalContact | undefined,
  units: Record<string, RuntimeUnit>, catalog: EquipmentCatalog, simTime: number, dtSec: number,
  target: RuntimeUnit | WeaponInFlight | undefined, environment?: ScenarioEnvironment
): { reached: boolean; expired: boolean } {
  const profile = guidanceProfile(weapon);
  const shooter = units[missile.shooterId];
  const support = !!shooter && isActiveUnit(shooter) &&
    trackSupport(shooter, contact, weapon, units, catalog, simTime).length > 0;
  missile.datalinkSupported = support;
  // Legacy initial missiles can continue along their declared heading, not read hidden target truth.
  missile.aimPosition ??= move(missile.position, missile.distanceRemainingKm, missile.heading);
  missile.seekerState ??= 'midcourse_blind';
  if (profile.receivesUpdates && support && contact) {
    const age = Math.max(0, (simTime - contact.lastDetectedTime) / 1000);
    missile.aimPosition = move(contact.estimatedPosition, contact.speedKts * 1.852 * age / 3600, contact.heading);
    missile.aimHeading = contact.heading;
    missile.aimSpeedKts = contact.speedKts;
    missile.lastTrackTime = contact.lastDetectedTime;
    if (missile.seekerState.startsWith('midcourse')) missile.seekerState = 'midcourse_datalink';
  } else {
    missile.aimPosition = move(missile.aimPosition, (missile.aimSpeedKts ?? 0) * 1.852 * dtSec / 3600, missile.aimHeading ?? 0);
    if (missile.seekerState.startsWith('midcourse')) missile.seekerState = 'midcourse_blind';
  }

  const terminal = missile.seekerState.startsWith('terminal') ||
    getDistanceKm(missile.position, missile.aimPosition) <= profile.activationRangeKm;
  const locked = terminal && seekerCanObserve(missile, weapon, target, catalog, support, environment);
  if (locked && target) {
    missile.seekerState = 'terminal_locked';
    missile.searchElapsedSec = 0;
    missile.aimPosition = [...target.position];
    missile.aimHeading = target.heading;
    missile.aimSpeedKts = target.speedKts;
  } else if (terminal) {
    missile.seekerState = 'terminal_searching';
    missile.searchElapsedSec = (missile.searchElapsedSec ?? 0) + dtSec;
  }

  const energyFactor = computeMissileEnergyFactor(missile, weapon);
  missile.speedKts = Math.round(weapon.speedKts * energyFactor);
  const remaining = Math.max(0, missile.maxRangeKm - missile.traveledKm);
  const step = Math.min(remaining, missile.speedKts * 1.852 * dtSec / 3600);
  const before = [...missile.position] as [number, number];
  const aimDistance = getDistanceKm(before, missile.aimPosition);
  // Once past an unobserved aimpoint, search forward instead of circling a magic coordinate.
  if (locked || aimDistance > step) missile.heading = getBearingDeg(before, missile.aimPosition);
  missile.position = move(before, step, missile.heading);
  missile.traveledKm += step;
  missile.distanceRemainingKm = getDistanceKm(missile.position, missile.aimPosition);
  missile.trail.push([...missile.position]);
  if (missile.trail.length > 18) missile.trail.shift();
  const targetEnd = target && !('platformId' in target)
    ? move(target.position, target.speedKts * 1.852 * dtSec / 3600, target.heading) : target?.position;
  const reached = !!locked && !!target && !!targetEnd &&
    sweptSeparationKm(before, missile.position, target.position, targetEnd) <= (missile.targetType === 'missile' ? 0.15 : 0.3);
  const expired = missile.traveledKm >= missile.maxRangeKm || (missile.searchElapsedSec ?? 0) >= profile.searchDurationSec;
  if (expired && !reached) missile.seekerState = 'lost';
  return { reached, expired: expired && !reached };
}
