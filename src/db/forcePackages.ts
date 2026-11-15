import * as turf from '../engine/turfGeo';
import { isRouteAllowed } from '../engine/environment';
import type { Domain, EquipmentCatalog, ForcePackageSpec } from '../types/wargame';
import type { InitialUnitPlacement, ScenarioEnvironment, SideId } from '../types/wargame';

export const FORCE_PACKAGES: Record<string, ForcePackageSpec> = {
  red_surface_group: {
    id: 'red_surface_group',
    name: '红方水面护航分队',
    origin: 'RED',
    domain: 'surface',
    role: 'surface_group',
    members: [
      { platformId: 'type055_destroyer', quantity: 1 },
      { platformId: 'type052d_destroyer', quantity: 2 },
      { platformId: 'type054b_frigate', quantity: 1 },
    ],
    description: '可复用的红方水面编队基线，包含区域防空核心与护航舰。',
  },
  blue_carrier_group: {
    id: 'blue_carrier_group',
    name: '蓝方航母护航编队',
    origin: 'BLUE',
    domain: 'surface',
    role: 'surface_group',
    members: [
      { platformId: 'cvn_carrier', quantity: 1 },
      { platformId: 'arleigh_burke_flt3', quantity: 2 },
      { platformId: 'constellation_ffg', quantity: 1 },
    ],
    description: '可复用的蓝方航母与水面护航舰组合，航母机库保留平台自带航空联队。',
  },
  red_layered_air_defense: {
    id: 'red_layered_air_defense',
    name: '红方远中程分层防空组',
    origin: 'RED',
    domain: 'land',
    role: 'ground_force',
    members: [
      { platformId: 'hq9b_sam_site', quantity: 1 },
      { platformId: 'red_hq16b_battery', quantity: 2 },
      { platformId: 'red_radar_station', quantity: 1 },
    ],
    description: '用不同射程层和预警节点构成的抽象化地面防空配置。',
  },
  blue_mobile_air_defense: {
    id: 'blue_mobile_air_defense',
    name: '蓝方机动分层防空组',
    origin: 'BLUE',
    domain: 'land',
    role: 'ground_force',
    members: [
      { platformId: 'patriot_pac3_site', quantity: 1 },
      { platformId: 'blue_nasams_battery', quantity: 2 },
      { platformId: 'blue_radar_station', quantity: 1 },
    ],
    description: '将区域防空、机动中程拦截和预警站组合为可复用配置。',
  },
  japan_maritime_task_group: {
    id: 'japan_maritime_task_group',
    name: '日本海上护航任务编组',
    origin: 'JAPAN',
    domain: 'surface',
    role: 'joint_task_force',
    members: [
      { platformId: 'japan_maya_destroyer', quantity: 2 },
      { platformId: 'japan_f2a', quantity: 2, loadoutId: 'loadout_japan_f2a_cap' },
    ],
    description: '以水面防空护航舰和岸基战斗机为核心的游戏场景模板。',
  },
  australia_joint_surveillance: {
    id: 'australia_joint_surveillance',
    name: '澳大利亚联合监视编组',
    origin: 'AUSTRALIA',
    domain: 'air',
    role: 'joint_task_force',
    members: [
      { platformId: 'australia_e7a', quantity: 1 },
      { platformId: 'australia_hobart_destroyer', quantity: 1 },
    ],
    description: '空中预警节点与水面护航舰组合的态势感知模板。',
  },
  korea_joint_defense: {
    id: 'korea_joint_defense',
    name: '韩国联合防空编组',
    origin: 'SOUTH_KOREA',
    domain: 'air',
    role: 'joint_task_force',
    members: [
      { platformId: 'korea_kf21', quantity: 4, loadoutId: 'loadout_korea_kf21_cap' },
      { platformId: 'korea_sejong_destroyer', quantity: 1 },
    ],
    description: '战斗机巡逻分队与区域防空驱逐舰组成的联合防空模板。',
  },
  japan_ground_maneuver: {
    id: 'japan_ground_maneuver',
    name: '日本机动地面分队',
    origin: 'JAPAN',
    domain: 'land',
    role: 'ground_force',
    members: [{ platformId: 'japan_type10_battalion', quantity: 1 }],
    description: '抽象化地面机动单位配置，用于场景编排而非现实部队编制复刻。',
  },
  korea_ground_maneuver: {
    id: 'korea_ground_maneuver',
    name: '韩国机动地面分队',
    origin: 'SOUTH_KOREA',
    domain: 'land',
    role: 'ground_force',
    members: [{ platformId: 'korea_k2_battalion', quantity: 1 }],
    description: '抽象化地面机动单位配置，用于场景编排而非现实部队编制复刻。',
  },
};

export interface ForcePackagePlacementOptions {
  idPrefix: string;
  side: SideId;
  parentGroupId: string;
  position: [number, number];
  heading: number;
  environment?: ScenarioEnvironment;
}

function findPositionForDomain(
  domain: Domain,
  position: [number, number],
  environment?: ScenarioEnvironment
): [number, number] {
  if (isRouteAllowed(domain, position, position, environment)) return position;
  for (let radiusKm = 0.5; radiusKm <= 50; radiusKm += 0.5) {
    for (let bearing = 0; bearing < 360; bearing += 45) {
      const candidate = turf.destination(position, radiusKm, bearing, { units: 'kilometers' })
        .geometry.coordinates as [number, number];
      if (isRouteAllowed(domain, candidate, candidate, environment)) return candidate;
    }
  }
  throw new Error(`No valid ${domain} deployment position within 50 km`);
}

export function createForcePackagePlacements(
  forcePackageId: string,
  options: ForcePackagePlacementOptions,
  catalog: EquipmentCatalog,
  packages: Record<string, ForcePackageSpec> = FORCE_PACKAGES
): InitialUnitPlacement[] {
  const forcePackage = packages[forcePackageId];
  if (!forcePackage) throw new Error(`Unknown force package ${forcePackageId}`);
  const integrity = validateForcePackageIntegrity({ [forcePackageId]: forcePackage }, catalog);
  if (!integrity.valid) throw new Error(integrity.errors.join('; '));
  const [longitude, latitude] = options.position;
  if (!/^[A-Za-z0-9._-]+$/.test(options.idPrefix) || !options.parentGroupId ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(options.heading)) {
    throw new Error('Invalid force package placement options');
  }

  const memberCount = forcePackage.members.reduce((total, member) => total + member.quantity, 0);
  const placements: InitialUnitPlacement[] = [];
  let unitIndex = 0;
  for (const member of forcePackage.members) {
    const platform = catalog.platforms[member.platformId];
    for (let memberIndex = 0; memberIndex < member.quantity; memberIndex += 1) {
      const placementIndex = unitIndex++;
      const radiusKm = placementIndex === 0 ? 0
        : platform.domain === 'air' ? 8
          : platform.domain === 'surface' ? 2
            : platform.domain === 'subsurface' ? 4 : 0.3;
      const bearing = (options.heading + (360 * placementIndex) / memberCount) % 360;
      const position = radiusKm === 0
        ? [...options.position] as [number, number]
        : turf.destination(options.position, radiusKm, bearing, { units: 'kilometers' }).geometry.coordinates as [number, number];
      const callsign = `${options.idPrefix.slice(-8).toUpperCase()}-${String(placementIndex + 1).padStart(2, '0')}`;
      placements.push({
        id: `${options.idPrefix}_${placementIndex + 1}`,
        name: platform.name,
        callsign,
        side: options.side,
        platformId: platform.id,
        loadoutId: member.loadoutId ?? platform.defaultLoadoutId,
        parentGroupId: options.parentGroupId,
        position: findPositionForDomain(platform.domain, position, options.environment),
        heading: options.heading,
      });
    }
  }
  return placements;
}

export function validateForcePackageIntegrity(
  packages: Record<string, ForcePackageSpec>,
  catalog: EquipmentCatalog
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [key, forcePackage] of Object.entries(packages)) {
    if (key !== forcePackage.id) errors.push(`forcePackages.${key}: key must match id ${forcePackage.id}`);
    if (forcePackage.members.length === 0) errors.push(`forcePackages.${key}: must include at least one member`);

    forcePackage.members.forEach((member, index) => {
      const path = `forcePackages.${key}.members[${index}]`;
      if (!Number.isSafeInteger(member.quantity) || member.quantity < 1) {
        errors.push(`${path}: quantity must be a positive integer`);
      }
      const platform = catalog.platforms[member.platformId];
      if (!platform) {
        errors.push(`${path}: unknown platform ${member.platformId}`);
        return;
      }
      if (member.loadoutId) {
        const loadout = catalog.loadouts[member.loadoutId];
        if (!loadout) errors.push(`${path}: unknown loadout ${member.loadoutId}`);
        else if (!loadout.compatiblePlatformIds.includes(member.platformId)) {
          errors.push(`${path}: loadout ${member.loadoutId} is incompatible with ${member.platformId}`);
        }
      }
    });
  }

  return { valid: errors.length === 0, errors };
}
