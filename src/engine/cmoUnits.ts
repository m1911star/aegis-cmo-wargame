import type {
  CmoArcMask,
  CmoSectorArc,
  Domain,
  EquipmentCatalog,
  PlatformSpec,
  PropulsionSpeedPoint,
  RcsAspectProfile,
  ThrottleSetting,
  UnitDoctrine,
  WeaponSpec,
} from '../types/wargame';

export const CMO_SECTOR_ARCS: readonly CmoSectorArc[] = [
  'SB',
  'SMF',
  'SMA',
  'SS',
  'PS',
  'PMA',
  'PMF',
  'PB',
] as const;

export const FULL_360_ARCS: CmoArcMask = {
  SB: true,
  SMF: true,
  SMA: true,
  SS: true,
  PS: true,
  PMA: true,
  PMF: true,
  PB: true,
};

/** Convert radar cross section from dBsm (CMO Data*Signatures) to m². */
export function dbsmToM2(dbsm: number): number {
  if (!Number.isFinite(dbsm)) return 1;
  return Math.max(0.0001, Number(Math.pow(10, dbsm / 10).toFixed(6)));
}

/** Convert radar cross section from m² to dBsm. */
export function m2ToDbsm(m2: number): number {
  const safe = Math.max(0.0001, Number.isFinite(m2) ? m2 : 1);
  return Number((10 * Math.log10(safe)).toFixed(2));
}

export function nmToKm(nm: number): number {
  return Number((nm * 1.852).toFixed(3));
}

export function ftToM(ft: number): number {
  return Number((ft * 0.3048).toFixed(2));
}

/**
 * Determine which 45° CMO ship/aircraft relative sector a bearing falls into.
 * 0-45: SB, 45-90: SMF, 90-135: SMA, 135-180: SS,
 * 180-225: PS, 225-270: PMA, 270-315: PMF, 315-360: PB.
 */
export function getRelativeCmoSector(relativeBearingDeg: number): CmoSectorArc {
  const norm = ((relativeBearingDeg % 360) + 360) % 360;
  const idx = Math.min(7, Math.floor(norm / 45));
  return CMO_SECTOR_ARCS[idx];
}

export function isBearingInCmoArcs(
  observerHeadingDeg: number,
  absoluteBearingDeg: number,
  arcs?: CmoArcMask
): boolean {
  if (!arcs) return true;
  const keys = Object.keys(arcs) as CmoSectorArc[];
  if (keys.length === 0) return true;
  const sector = getRelativeCmoSector(absoluteBearingDeg - observerHeadingDeg);
  return Boolean(arcs[sector]);
}

/**
 * Resolve aspect-dependent RCS profile (m²):
 * prefers explicit `rcsProfile`, else derives from CMO `signatures` (`radar_em` / `radar_ad` in dBsm),
 * else falls back to scalar `rcsM2`.
 */
export function resolvePlatformRcsProfile(platform: PlatformSpec): RcsAspectProfile | undefined {
  if (platform.rcsProfile) return platform.rcsProfile;
  if (platform.rcsM2 > 0 && platform.dbid === undefined) return undefined;
  const radarSig =
    platform.signatures?.find((s) => s.type === 'radar_em') ??
    platform.signatures?.find((s) => s.type === 'radar_ad');
  if (!radarSig) return undefined;
  return {
    frontalM2: dbsmToM2(radarSig.front),
    beamM2: dbsmToM2(radarSig.side),
    rearM2: dbsmToM2(radarSig.rear),
  };
}

/**
 * Resolve effective acoustic signature (dB):
 * prefers explicit `acousticSignatureDb` when > 0, else derives max of CMO passive sonar bands.
 */
export function resolvePlatformAcousticDb(platform: PlatformSpec): number {
  if (platform.acousticSignatureDb > 0) return platform.acousticSignatureDb;
  const passiveSigs = (platform.signatures ?? []).filter((s) =>
    s.type.startsWith('passive_sonar_')
  );
  if (passiveSigs.length === 0) return platform.acousticSignatureDb;
  let peak = 0;
  for (const sig of passiveSigs) {
    peak = Math.max(peak, sig.front, sig.side, sig.rear, sig.top ?? 0);
  }
  return peak;
}

/**
 * Resolve weapon warhead damage:
 * prefers explicit `warheadDamage` when > 0, else looks up `warheadId` in `catalog.warheads`.
 */
export function resolveWeaponWarheadDamage(
  weapon: WeaponSpec,
  catalog?: EquipmentCatalog
): number {
  if (weapon.warheadDamage > 0) return weapon.warheadDamage;
  if (weapon.warheadId && catalog?.warheads?.[weapon.warheadId]) {
    const wh = catalog.warheads[weapon.warheadId];
    return wh.damagePoints * Math.max(1, weapon.warheadCount ?? 1);
  }
  return weapon.warheadDamage;
}

/**
 * Resolve per-domain weapon range (km) when CMO `domainRangesKm` is populated.
 */
export function resolveWeaponRangeForDomain(
  weapon: WeaponSpec,
  domain?: Domain
): { minKm: number; maxKm: number } {
  if (domain && weapon.domainRangesKm?.[domain]) {
    return weapon.domainRangesKm[domain]!;
  }
  return { minKm: weapon.minRangeKm, maxKm: weapon.maxRangeKm };
}

/**
 * Resolve per-domain weapon Pk (0..1) when CMO `domainPk` is populated.
 */
export function resolveWeaponPkForDomain(weapon: WeaponSpec, domain?: Domain): number {
  if (domain && weapon.domainPk?.[domain] !== undefined) {
    return weapon.domainPk[domain]!;
  }
  return weapon.basePk;
}

/**
 * Enforce OODA reaction delays automatically for imported CMO platforms (`dbid !== undefined`)
 * or when `doctrine.enforceOoda` is explicitly enabled, keeping built-in smoke baselines exact.
 */
export function shouldEnforceOoda(
  platform: PlatformSpec | undefined,
  doctrine?: Partial<UnitDoctrine>
): boolean {
  return Boolean(
    platform?.ooda && (platform.dbid !== undefined || doctrine?.enforceOoda === true)
  );
}

export interface ResolvedPropulsionAtAltitude {
  altitudeBand: number;
  targetSpeedKts: number;
  bandMaxSpeedKts: number;
  bandCruiseSpeedKts: number;
  fuelBurnMultiplier: number;
}

export function resolvePropulsionAtAltitude(
  platform: PlatformSpec,
  catalog: EquipmentCatalog,
  altitudeM: number,
  throttle: ThrottleSetting,
  fallbackMaxSpeedKts: number,
  fallbackCruiseSpeedKts: number,
  loadoutSpeedPenaltyKts = 0
): ResolvedPropulsionAtAltitude {
  const allPoints: PropulsionSpeedPoint[] = [];
  for (const propId of platform.propulsionIds ?? []) {
    const spec = catalog.propulsions?.[propId];
    if (spec?.speedProfile?.length) {
      allPoints.push(...spec.speedProfile);
    }
  }

  let bandPoints: PropulsionSpeedPoint[] = [];
  let chosenBand = 1;
  if (allPoints.length > 0) {
    const inRange = allPoints.filter(
      (pt) => altitudeM >= pt.altitudeMinM - 1e-6 && altitudeM <= pt.altitudeMaxM + 1e-6
    );
    if (inRange.length > 0) {
      chosenBand = inRange[0].altitudeBand;
      bandPoints = inRange.filter((pt) => pt.altitudeBand === chosenBand);
    } else {
      let bestDist = Infinity;
      for (const pt of allPoints) {
        const clamped = Math.max(pt.altitudeMinM, Math.min(pt.altitudeMaxM, altitudeM));
        const dist = Math.abs(altitudeM - clamped);
        if (dist < bestDist) {
          bestDist = dist;
          chosenBand = pt.altitudeBand;
        }
      }
      bandPoints = allPoints.filter((pt) => pt.altitudeBand === chosenBand);
    }
  }

  const byThrottle = (t: ThrottleSetting) => bandPoints.find((pt) => pt.throttle === t);
  const pt1 = byThrottle(1);
  const pt2 = byThrottle(2);
  const pt3 = byThrottle(3);
  const pt4 = byThrottle(4);

  const rawMax = pt4?.speedKts ?? pt3?.speedKts ?? pt2?.speedKts ?? 0;
  const bandMaxSpeedKts =
    rawMax > 0 ? Math.max(0, rawMax - loadoutSpeedPenaltyKts) : fallbackMaxSpeedKts;
  const bandCruiseSpeedKts = pt2
    ? Math.max(0, Math.min(bandMaxSpeedKts, pt2.speedKts - loadoutSpeedPenaltyKts * 0.5))
    : Math.min(bandMaxSpeedKts, fallbackCruiseSpeedKts);
  const bandLoiterSpeedKts = pt1
    ? Math.max(0, Math.min(bandMaxSpeedKts, pt1.speedKts - loadoutSpeedPenaltyKts * 0.25))
    : Math.round(bandCruiseSpeedKts * 0.72);
  const bandFullSpeedKts = pt3
    ? Math.max(0, Math.min(bandMaxSpeedKts, pt3.speedKts - loadoutSpeedPenaltyKts * 0.75))
    : Math.round((bandCruiseSpeedKts + bandMaxSpeedKts) * 0.5);

  const targetSpeedKts =
    throttle === 1
      ? bandLoiterSpeedKts
      : throttle === 2
        ? bandCruiseSpeedKts
        : throttle === 3
          ? bandFullSpeedKts
          : bandMaxSpeedKts;

  const baseCruiseConsumption =
    pt2 && pt2.consumptionPerHour > 0
      ? pt2.consumptionPerHour
      : platform.maxFuelSec > 0
        ? 3600 / platform.maxFuelSec
        : 0;
  const selectedPt = throttle === 1 ? pt1 : throttle === 2 ? pt2 : throttle === 3 ? pt3 : pt4;
  const defaultThrottleMult =
    throttle === 1 ? 0.65 : throttle === 2 ? 1.0 : throttle === 3 ? 1.45 : 2.2;
  const fuelBurnMultiplier =
    selectedPt && selectedPt.consumptionPerHour > 0 && baseCruiseConsumption > 0
      ? Math.max(0.35, Number((selectedPt.consumptionPerHour / baseCruiseConsumption).toFixed(4)))
      : defaultThrottleMult;

  return {
    altitudeBand: chosenBand,
    targetSpeedKts,
    bandMaxSpeedKts,
    bandCruiseSpeedKts,
    fuelBurnMultiplier,
  };
}
