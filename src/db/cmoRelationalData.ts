import type {
  CommSpec,
  LoadoutSpec,
  MagazineSpec,
  MountSpec,
  PlatformSensorMount,
  PlatformSpec,
  PropulsionSpec,
  SensorSpec,
  SignatureProfile,
  WarheadSpec,
  WeaponSpec,
  WeaponWraRule,
} from '../types/wargame';
import { FULL_360_ARCS, m2ToDbsm } from '../engine/cmoUnits';

export interface CmoRelationalBundle {
  warheads: Record<string, WarheadSpec>;
  mounts: Record<string, MountSpec>;
  magazines: Record<string, MagazineSpec>;
  propulsions: Record<string, PropulsionSpec>;
  comms: Record<string, CommSpec>;
  weapons: Record<string, WeaponSpec>;
  platforms: Record<string, PlatformSpec>;
}

const DOMAIN_TABLE_MAP: Record<PlatformSpec['domain'], PlatformSpec['cmoTable']> = {
  air: 'DataAircraft',
  surface: 'DataShip',
  subsurface: 'DataSubmarine',
  land: 'DataFacility',
};

function buildDefaultWra(weapon: WeaponSpec): WeaponWraRule[] {
  return weapon.targetDomains.map((domain) => ({
    targetType:
      domain === 'air'
        ? 'Aircraft / Guided Weapon'
        : domain === 'surface'
          ? 'Surface Combatant'
          : domain === 'subsurface'
            ? 'Submarine'
            : 'Land Structure',
    weaponQty: weapon.salvoDefault,
    shooterQty: 1,
    autoFireRangePct: 85,
    selfDefenseRangeKm: weapon.canInterceptMissile ? weapon.maxRangeKm : 0,
  }));
}

function buildPlatformSignatures(platform: PlatformSpec): SignatureProfile[] {
  if (platform.signatures && platform.signatures.length > 0) {
    return platform.signatures;
  }
  const frontM2 = platform.rcsProfile?.frontalM2 ?? platform.rcsM2;
  const sideM2 = platform.rcsProfile?.beamM2 ?? platform.rcsM2;
  const rearM2 = platform.rcsProfile?.rearM2 ?? platform.rcsM2;
  const signatures: SignatureProfile[] = [
    {
      type: 'radar_em',
      front: m2ToDbsm(frontM2),
      side: m2ToDbsm(sideM2),
      rear: m2ToDbsm(rearM2),
      top: m2ToDbsm(sideM2),
    },
  ];
  if (platform.acousticSignatureDb > 0) {
    signatures.push({
      type: 'passive_sonar_lf',
      front: platform.acousticSignatureDb,
      side: platform.acousticSignatureDb + 4,
      rear: platform.acousticSignatureDb + 8,
    });
  }
  return signatures;
}

function buildDefaultOoda(platform: PlatformSpec) {
  if (platform.ooda) return platform.ooda;
  if (platform.domain === 'air') {
    return { detectionSec: 8, targetingSec: 12, evasionSec: 5 };
  }
  if (platform.domain === 'subsurface') {
    return { detectionSec: 18, targetingSec: 25, evasionSec: 15 };
  }
  return { detectionSec: 12, targetingSec: 16, evasionSec: 12 };
}

function buildSensorMounts(
  platform: PlatformSpec,
  sensors: Record<string, SensorSpec>
): PlatformSensorMount[] {
  if (platform.sensorMounts && platform.sensorMounts.length > 0) {
    return platform.sensorMounts;
  }
  return platform.sensorIds.map((sensorId, idx) => {
    const s = sensors[sensorId];
    const hasExactDegArc = s?.coverageArcDeg !== undefined || s?.blindArcRearDeg !== undefined;
    return {
      sensorId,
      componentNumber: idx + 1,
      mastHeightM: platform.radarAntennaHeightM > 0 ? platform.radarAntennaHeightM : undefined,
      arcs: hasExactDegArc ? undefined : { ...FULL_360_ARCS },
      isFireControl: s?.type === 'radar_air_surface',
    };
  });
}

/**
 * Derive normalized CMO relational tables (Warhead, Mount, Magazine, Propulsion, Comm)
 * from the built-in simulated 4-layer catalog without altering any numeric gameplay values.
 */
export function buildCmoRelationalBundle(input: {
  sensors: Record<string, SensorSpec>;
  weapons: Record<string, WeaponSpec>;
  loadouts: Record<string, LoadoutSpec>;
  platforms: Record<string, PlatformSpec>;
}): CmoRelationalBundle {
  const warheads: Record<string, WarheadSpec> = {};
  const mounts: Record<string, MountSpec> = {};
  const magazines: Record<string, MagazineSpec> = {};
  const propulsions: Record<string, PropulsionSpec> = {};
  const comms: Record<string, CommSpec> = {
    comm_tactical_datalink_cec: {
      id: 'comm_tactical_datalink_cec',
      name: 'Tactical Data Link (Link-16 / DTS / CEC)',
      type: 'JTIDS / Tactical Datalink',
      supportsDatalink: true,
      supportsCec: true,
      rangeKm: 550,
      maxChannels: 64,
      description: '标准双向战术数据链与协同交战网络。',
    },
    comm_uhf_los_radio: {
      id: 'comm_uhf_los_radio',
      name: 'UHF/VHF Line-of-Sight Voice & Telemetry',
      type: 'LOS Radio',
      supportsDatalink: false,
      supportsCec: false,
      rangeKm: 250,
      description: '常规视距无线电通信，不具备跨平台火控中继能力。',
    },
  };

  const weapons: Record<string, WeaponSpec> = {};
  for (const [wId, w] of Object.entries(input.weapons)) {
    const whId = `wh_${wId}`;
    warheads[whId] = {
      id: whId,
      name: `${w.codeName} Warhead`,
      type: w.category === 'torpedo' ? 'Torpedo HE' : w.guidance === 'anti_radiation' ? 'Fragmentation ARM' : 'HE / Blast-Frag',
      damagePoints: w.warheadDamage,
      numberOfWarheads: 1,
      description: `Derived CMO warhead record for ${w.name}.`,
    };
    const domainRangesKm: WeaponSpec['domainRangesKm'] = {};
    const domainPk: WeaponSpec['domainPk'] = {};
    for (const d of w.targetDomains) {
      domainRangesKm[d] = { minKm: w.minRangeKm, maxKm: w.maxRangeKm };
      domainPk[d] = w.basePk;
    }
    weapons[wId] = {
      ...w,
      warheadId: w.warheadId ?? whId,
      warheadCount: w.warheadCount ?? 1,
      domainRangesKm: w.domainRangesKm ?? domainRangesKm,
      domainPk: w.domainPk ?? domainPk,
      wraRules: w.wraRules ?? buildDefaultWra(w),
    };
  }

  const platforms: Record<string, PlatformSpec> = {};
  for (const [pId, p] of Object.entries(input.platforms)) {
    const propId = `prop_${pId}`;
    propulsions[propId] = {
      id: propId,
      name: `${p.className} Propulsion`,
      type:
        p.domain === 'air'
          ? 'Turbofan / Jet'
          : p.domain === 'subsurface'
            ? 'Nuclear / AIP'
            : p.domain === 'surface'
              ? 'COGAG / Marine Turbine'
              : 'Static / Mobile Ground',
      speedProfile: [
        {
          altitudeBand: 1,
          throttle: 2,
          speedKts: p.cruiseSpeedKts,
          altitudeMinM: p.minAltitudeM,
          altitudeMaxM: p.maxAltitudeM,
          consumptionPerHour: p.maxFuelSec > 0 ? Number((3600 / p.maxFuelSec).toFixed(4)) : 0,
        },
        {
          altitudeBand: 1,
          throttle: 4,
          speedKts: p.maxSpeedKts,
          altitudeMinM: p.minAltitudeM,
          altitudeMaxM: p.maxAltitudeM,
          consumptionPerHour: p.maxFuelSec > 0 ? Number((7200 / p.maxFuelSec).toFixed(4)) : 0,
        },
      ],
    };

    const enrichedMounts = p.mounts.map((m) => {
      const mountSpecId = m.mountSpecId ?? `mount_${pId}_${m.mountId}`;
      if (!mounts[mountSpecId]) {
        const wSpec = input.weapons[m.weaponId];
        const isPointDefenseAutonomous = Boolean(
          wSpec?.canInterceptMissile && wSpec.maxRangeKm <= 25
        );
        mounts[mountSpecId] = {
          id: mountSpecId,
          name: `${p.className} ${m.mountId}`,
          rofPerMin: m.reloadTimeSec > 0 ? Math.max(1, Math.round(60 / m.reloadTimeSec)) : 60,
          capacity: m.maxAmmo,
          magazineRofPerMin: 0,
          magazineCapacity: m.maxAmmo,
          damagePoints: Math.max(5, Math.round(p.maxHp * 0.15)),
          trainable: p.domain === 'surface' || p.domain === 'land',
          autonomous: isPointDefenseAutonomous,
          weaponIds: [m.weaponId],
        };
      }
      return {
        ...m,
        mountSpecId,
        arcs: m.arcs ?? { ...FULL_360_ARCS },
      };
    });

    const magId = `mag_${pId}`;
    const magWeapons = [...new Set(p.mounts.map((m) => m.weaponId))];
    if (magWeapons.length > 0) {
      magazines[magId] = {
        id: magId,
        name: `${p.className} Main Magazine`,
        rofPerMin: 6,
        capacity: p.mounts.reduce((sum, m) => sum + m.maxAmmo, 0),
        aviationMagazine: (p.hangarSlots?.length ?? 0) > 0,
        isMirrorOnly: true,
        weaponIds: magWeapons,
      };
    }

    platforms[pId] = {
      ...p,
      cmoTable: p.cmoTable ?? DOMAIN_TABLE_MAP[p.domain],
      operatorCountry: p.operatorCountry ?? p.origin,
      ooda: buildDefaultOoda(p),
      propulsionIds: p.propulsionIds ?? [propId],
      magazineIds: p.magazineIds ?? (magWeapons.length > 0 ? [magId] : []),
      commIds: p.commIds ?? [p.hasDatalink ? 'comm_tactical_datalink_cec' : 'comm_uhf_los_radio'],
      mounts: enrichedMounts,
      sensorMounts: buildSensorMounts(p, input.sensors),
      signatures: buildPlatformSignatures(p),
    };
  }

  return {
    warheads,
    mounts,
    magazines,
    propulsions,
    comms,
    weapons,
    platforms,
  };
}
