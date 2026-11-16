import type {
  CmoArcMask,
  CmoSectorArc,
  Domain,
  EquipmentCatalog,
  PlatformSpec,
  RcsAspectProfile,
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
