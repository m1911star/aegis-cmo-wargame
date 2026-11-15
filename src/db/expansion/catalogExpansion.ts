import type {
  Domain,
  ForcePackageSpec,
  LoadoutSpec,
  PlatformSpec,
  SensorSpec,
  WeaponSpec,
} from '../../types/wargame';

type WeaponSeed = Pick<
  WeaponSpec,
  | 'id' | 'name' | 'codeName' | 'category' | 'guidance' | 'targetDomains'
  | 'maxRangeKm' | 'minRangeKm' | 'speedKts' | 'cruiseAltitudeM'
  | 'basePk' | 'warheadDamage'
> & Partial<Pick<WeaponSpec, 'canInterceptMissile' | 'salvoDefault' | 'flightProfile' | 'requiresDatalinkBeyondHorizon' | 'interceptAltitudeBandM'>> & {
  launchMedium?: WeaponSpec['launchMedium'];
  airDropRangeKm?: number;
  airDropSpeedKts?: number;
  waterEntrySpeedKts?: number;
  waterEntryAltitudeM?: number;
};

const weaponSeeds: WeaponSeed[] = [
  { id: 'astra_mk1_aam', name: 'Astra Mk 1 中距空空导弹', codeName: 'Astra Mk 1', category: 'aam', guidance: 'active_radar', targetDomains: ['air'], maxRangeKm: 110, minRangeKm: 4, speedKts: 2300, cruiseAltitudeM: 12000, basePk: 0.70, warheadDamage: 38, requiresDatalinkBeyondHorizon: true },
  { id: 'astra_mk2_aam', name: 'Astra Mk 2 中远距空空导弹', codeName: 'Astra Mk 2', category: 'aam', guidance: 'active_radar', targetDomains: ['air'], maxRangeKm: 170, minRangeKm: 5, speedKts: 2550, cruiseAltitudeM: 14000, basePk: 0.73, warheadDamage: 42, requiresDatalinkBeyondHorizon: true },
  { id: 'mica_ng_aam', name: 'MICA NG 多用途空空导弹', codeName: 'MICA NG', category: 'aam', guidance: 'active_radar', targetDomains: ['air'], maxRangeKm: 100, minRangeKm: 2, speedKts: 2250, cruiseAltitudeM: 11000, basePk: 0.70, warheadDamage: 36 },
  { id: 'meteor_mraam', name: 'Meteor 超视距空空导弹', codeName: 'Meteor BVRAAM', category: 'aam', guidance: 'active_radar', targetDomains: ['air'], maxRangeKm: 180, minRangeKm: 5, speedKts: 2600, cruiseAltitudeM: 15000, basePk: 0.76, warheadDamage: 44, requiresDatalinkBeyondHorizon: true },
  { id: 'iris_t_aam', name: 'IRIS-T 近距空空导弹', codeName: 'IRIS-T AAM', category: 'aam', guidance: 'infrared', targetDomains: ['air'], maxRangeKm: 28, minRangeKm: 0.5, speedKts: 2050, cruiseAltitudeM: 8000, basePk: 0.68, warheadDamage: 34 },
  { id: 'asraam_aam', name: 'ASRAAM 近距空空导弹', codeName: 'ASRAAM', category: 'aam', guidance: 'infrared', targetDomains: ['air'], maxRangeKm: 32, minRangeKm: 0.5, speedKts: 2150, cruiseAltitudeM: 8500, basePk: 0.68, warheadDamage: 35 },
  { id: 'gokdogan_aam', name: 'Gökdoğan 中距空空导弹', codeName: 'Gökdoğan BVRAAM', category: 'aam', guidance: 'active_radar', targetDomains: ['air'], maxRangeKm: 115, minRangeKm: 4, speedKts: 2300, cruiseAltitudeM: 12000, basePk: 0.69, warheadDamage: 38, requiresDatalinkBeyondHorizon: true },
  { id: 'bozdogan_aam', name: 'Bozdoğan 近距空空导弹', codeName: 'Bozdoğan WVR AAM', category: 'aam', guidance: 'infrared', targetDomains: ['air'], maxRangeKm: 25, minRangeKm: 0.5, speedKts: 1900, cruiseAltitudeM: 7000, basePk: 0.65, warheadDamage: 32 },
  { id: 'irist_slm_sam', name: 'IRIS-T SLM 中程防空弹', codeName: 'IRIS-T SLM', category: 'sam', guidance: 'active_radar', targetDomains: ['air'], canInterceptMissile: true, maxRangeKm: 40, minRangeKm: 1, speedKts: 1900, cruiseAltitudeM: 12000, basePk: 0.70, warheadDamage: 36, interceptAltitudeBandM: [0, 20000] },
  { id: 'aster15_sam', name: 'Aster 15 区域防空弹', codeName: 'Aster 15', category: 'sam', guidance: 'active_radar', targetDomains: ['air'], canInterceptMissile: true, maxRangeKm: 45, minRangeKm: 1, speedKts: 2300, cruiseAltitudeM: 14000, basePk: 0.73, warheadDamage: 38, interceptAltitudeBandM: [0, 25000] },
  { id: 'aster30_sam', name: 'Aster 30 区域防空反导弹', codeName: 'Aster 30', category: 'sam', guidance: 'active_radar', targetDomains: ['air'], canInterceptMissile: true, maxRangeKm: 110, minRangeKm: 3, speedKts: 2900, cruiseAltitudeM: 18000, basePk: 0.76, warheadDamage: 48, interceptAltitudeBandM: [0, 35000], requiresDatalinkBeyondHorizon: true },
  { id: 'camm_er_sam', name: 'CAMM-ER 中程防空弹', codeName: 'CAMM-ER', category: 'sam', guidance: 'active_radar', targetDomains: ['air'], canInterceptMissile: true, maxRangeKm: 45, minRangeKm: 1, speedKts: 1800, cruiseAltitudeM: 10000, basePk: 0.69, warheadDamage: 34, interceptAltitudeBandM: [0, 18000] },
  { id: 'akash_sam', name: 'Akash 中程防空弹', codeName: 'Akash SAM', category: 'sam', guidance: 'semi_active_radar', targetDomains: ['air'], canInterceptMissile: true, maxRangeKm: 35, minRangeKm: 2, speedKts: 1750, cruiseAltitudeM: 9000, basePk: 0.66, warheadDamage: 35, interceptAltitudeBandM: [0, 18000] },
  { id: 'brahmos_ashm', name: 'BrahMos 海面打击导弹', codeName: 'BrahMos Maritime Strike', category: 'ashm', guidance: 'active_radar', targetDomains: ['surface'], maxRangeKm: 180, minRangeKm: 10, speedKts: 1700, cruiseAltitudeM: 30, basePk: 0.70, warheadDamage: 72, flightProfile: 'sea_skimming' },
  { id: 'exocet_mm40_ashm', name: 'Exocet MM40 反舰导弹', codeName: 'Exocet MM40', category: 'ashm', guidance: 'active_radar', targetDomains: ['surface'], maxRangeKm: 120, minRangeKm: 6, speedKts: 620, cruiseAltitudeM: 15, basePk: 0.67, warheadDamage: 48, flightProfile: 'sea_skimming' },
  { id: 'harpoon_blk2_ashm', name: 'Harpoon Block II 反舰导弹', codeName: 'Harpoon Block II', category: 'ashm', guidance: 'active_radar', targetDomains: ['surface', 'land'], maxRangeKm: 135, minRangeKm: 8, speedKts: 560, cruiseAltitudeM: 20, basePk: 0.66, warheadDamage: 50, flightProfile: 'sea_skimming' },
  { id: 'rbs15_mk4_ashm', name: 'RBS-15 Mk 4 反舰导弹', codeName: 'RBS-15 Mk 4', category: 'ashm', guidance: 'active_radar', targetDomains: ['surface', 'land'], maxRangeKm: 180, minRangeKm: 8, speedKts: 600, cruiseAltitudeM: 20, basePk: 0.68, warheadDamage: 52, flightProfile: 'sea_skimming' },
  { id: 'atmac_ashm', name: 'Atmaca 反舰导弹', codeName: 'Atmaca', category: 'ashm', guidance: 'active_radar', targetDomains: ['surface'], maxRangeKm: 170, minRangeKm: 8, speedKts: 580, cruiseAltitudeM: 18, basePk: 0.68, warheadDamage: 52, flightProfile: 'sea_skimming' },
  { id: 'scalp_eg_lacm', name: 'SCALP-EG 防区外巡航导弹', codeName: 'SCALP-EG', category: 'lacm', guidance: 'infrared', targetDomains: ['land'], maxRangeKm: 220, minRangeKm: 15, speedKts: 560, cruiseAltitudeM: 60, basePk: 0.74, warheadDamage: 62, flightProfile: 'cruise_flat' },
  { id: 'taurus_kepd_lacm', name: 'Taurus KEPD 350 巡航导弹', codeName: 'Taurus KEPD 350', category: 'lacm', guidance: 'infrared', targetDomains: ['land'], maxRangeKm: 250, minRangeKm: 20, speedKts: 570, cruiseAltitudeM: 50, basePk: 0.75, warheadDamage: 66, flightProfile: 'cruise_flat' },
  { id: 'som_j_lacm', name: 'SOM-J 多用途巡航导弹', codeName: 'SOM-J', category: 'lacm', guidance: 'active_radar', targetDomains: ['land', 'surface'], maxRangeKm: 150, minRangeKm: 10, speedKts: 600, cruiseAltitudeM: 40, basePk: 0.69, warheadDamage: 48, flightProfile: 'sea_skimming' },
  { id: 'brahmos_land_attack', name: 'BrahMos 陆攻任务弹', codeName: 'BrahMos Land Attack', category: 'lacm', guidance: 'active_radar', targetDomains: ['land'], maxRangeKm: 180, minRangeKm: 12, speedKts: 1700, cruiseAltitudeM: 3000, basePk: 0.70, warheadDamage: 68, flightProfile: 'cruise_flat' },
  { id: 'arm_game_profile', name: '防空压制反辐射弹', codeName: 'ARM Game Profile', category: 'arm', guidance: 'anti_radiation', targetDomains: ['air', 'surface', 'land'], maxRangeKm: 120, minRangeKm: 8, speedKts: 2100, cruiseAltitudeM: 9000, basePk: 0.68, warheadDamage: 45, requiresDatalinkBeyondHorizon: true },
  { id: 'arm_standoff_profile', name: '远距反辐射弹', codeName: 'Standoff ARM Game Profile', category: 'arm', guidance: 'anti_radiation', targetDomains: ['air', 'surface', 'land'], maxRangeKm: 160, minRangeKm: 12, speedKts: 2350, cruiseAltitudeM: 12000, basePk: 0.69, warheadDamage: 48, requiresDatalinkBeyondHorizon: true },
  { id: 'mu90_lwt', name: 'MU90 轻型反潜鱼雷', codeName: 'MU90 Lightweight Torpedo', category: 'torpedo', guidance: 'acoustic_homing', targetDomains: ['subsurface'], launchMedium: 'air_drop', maxRangeKm: 18, minRangeKm: 0.5, speedKts: 48, cruiseAltitudeM: -45, basePk: 0.68, warheadDamage: 52, airDropRangeKm: 20, airDropSpeedKts: 240, waterEntrySpeedKts: 48, waterEntryAltitudeM: -45 },
  { id: 'f21_black_shark_torpedo', name: 'Black Shark 重型鱼雷', codeName: 'Black Shark', category: 'torpedo', guidance: 'acoustic_homing', targetDomains: ['subsurface', 'surface'], maxRangeKm: 38, minRangeKm: 1, speedKts: 58, cruiseAltitudeM: -120, basePk: 0.80, warheadDamage: 82 },
  { id: 'spearfish_torpedo', name: 'Spearfish 重型鱼雷', codeName: 'Spearfish', category: 'torpedo', guidance: 'acoustic_homing', targetDomains: ['subsurface', 'surface'], maxRangeKm: 45, minRangeKm: 1, speedKts: 64, cruiseAltitudeM: -150, basePk: 0.83, warheadDamage: 88 },
  { id: 'dm2a4_torpedo', name: 'DM2A4 重型鱼雷', codeName: 'DM2A4 Seehecht', category: 'torpedo', guidance: 'acoustic_homing', targetDomains: ['subsurface', 'surface'], maxRangeKm: 42, minRangeKm: 1, speedKts: 60, cruiseAltitudeM: -130, basePk: 0.81, warheadDamage: 84 },
];

export const EXPANSION_WEAPONS: Record<string, WeaponSpec> = Object.fromEntries(
  weaponSeeds.map((seed) => [seed.id, {
    ...seed,
    canInterceptMissile: seed.canInterceptMissile ?? false,
    salvoDefault: seed.salvoDefault ?? 1,
    description: '游戏平衡用代表参数；射程、速度和命中率不代表现实作战性能。',
  }])
);

interface SensorSeed {
  id: string;
  name: string;
  codeName: string;
  type: SensorSpec['type'];
  maxRangeKm: number;
  detectDomains: Domain[];
  frequencyBand: string;
  isActiveEmitter?: boolean;
  description: string;
}

const sensorSeeds: SensorSeed[] = [
  { id: 'india_uttam_aesa', name: 'Uttam 机载有源相控阵雷达', codeName: 'Uttam AESA', type: 'radar_air_surface', maxRangeKm: 210, detectDomains: ['air', 'surface'], frequencyBand: 'X-Band AESA', description: '空中平台多用途搜索传感器的游戏化代表配置。' },
  { id: 'france_rbe2_aesa', name: 'RBE2-AA 机载有源相控阵雷达', codeName: 'RBE2-AA', type: 'radar_air_surface', maxRangeKm: 235, detectDomains: ['air', 'surface', 'land'], frequencyBand: 'X-Band AESA', description: '用于多用途战斗机模板的机载搜索传感器。' },
  { id: 'uk_captor_e_aesa', name: 'Captor-E 机载有源相控阵雷达', codeName: 'Captor-E AESA', type: 'radar_air_surface', maxRangeKm: 225, detectDomains: ['air', 'surface', 'land'], frequencyBand: 'X-Band AESA', description: '具备宽视场空中搜索的游戏化机载传感器。' },
  { id: 'germany_captor_m_aesa', name: 'Captor-M 机载多用途雷达', codeName: 'Captor-M', type: 'radar_air_surface', maxRangeKm: 215, detectDomains: ['air', 'surface', 'land'], frequencyBand: 'X-Band Mechanically Scanned', description: '为多用途飞行平台提供通用探测数据。' },
  { id: 'turkey_kaan_aesa', name: '战斗机有源相控阵雷达', codeName: 'Kaan AESA Profile', type: 'radar_air_surface', maxRangeKm: 220, detectDomains: ['air', 'surface', 'land'], frequencyBand: 'X-Band AESA', description: '原型航空平台的抽象化搜索雷达参数。' },
  { id: 'brazil_gripen_aesa', name: '战斗机有源相控阵雷达', codeName: 'Gripen AESA Profile', type: 'radar_air_surface', maxRangeKm: 190, detectDomains: ['air', 'surface', 'land'], frequencyBand: 'X-Band AESA', description: '轻型战斗机模板的抽象化搜索雷达参数。' },
  { id: 'india_netra_mrr', name: 'Netra 预警机任务雷达', codeName: 'Netra MRR Profile', type: 'radar_air_surface', maxRangeKm: 350, detectDomains: ['air', 'surface'], frequencyBand: 'Active Array', description: '空中监视节点的游戏化代表传感器。' },
  { id: 'france_atl2_search_radar', name: '海上巡逻搜索雷达', codeName: 'ATL2 Maritime Radar Profile', type: 'radar_air_surface', maxRangeKm: 310, detectDomains: ['air', 'surface'], frequencyBand: 'X-Band Maritime', description: '为海上巡逻平台提供水面搜索能力。' },
  { id: 'india_el2248_radar', name: '舰载多功能相控阵雷达', codeName: 'EL/M-2248 Profile', type: 'radar_air_surface', maxRangeKm: 350, detectDomains: ['air', 'surface'], frequencyBand: 'S-Band AESA', description: '舰载区域监视雷达的游戏代表参数。' },
  { id: 'france_herakles_radar', name: '舰载多功能搜索雷达', codeName: 'Herakles Profile', type: 'radar_air_surface', maxRangeKm: 330, detectDomains: ['air', 'surface'], frequencyBand: 'S-Band PESA', description: '舰艇多任务监视用抽象化传感器。' },
  { id: 'uk_sampson_radar', name: '舰载多功能有源阵列雷达', codeName: 'SAMPSON Profile', type: 'radar_air_surface', maxRangeKm: 420, detectDomains: ['air', 'surface'], frequencyBand: 'S-Band AESA', description: '用于舰艇防空编组的游戏化搜索雷达。' },
  { id: 'germany_apar_radar', name: '舰载多功能有源阵列雷达', codeName: 'APAR Profile', type: 'radar_air_surface', maxRangeKm: 340, detectDomains: ['air', 'surface'], frequencyBand: 'X-Band AESA', description: '舰载多目标搜索传感器的代表参数。' },
  { id: 'turkey_cenk_radar', name: '舰载多功能相控阵雷达', codeName: 'CENK Profile', type: 'radar_air_surface', maxRangeKm: 345, detectDomains: ['air', 'surface'], frequencyBand: 'S-Band AESA', description: '新型水面平台用多任务搜索雷达模板。' },
  { id: 'india_hull_sonar', name: '舰壳主被动声呐阵列', codeName: 'Indian Hull Sonar Profile', type: 'sonar_active', maxRangeKm: 34, detectDomains: ['subsurface', 'surface'], frequencyBand: 'LF Active/Passive', description: '用于近中程水下搜索的模拟声呐。' },
  { id: 'france_towed_sonar', name: '拖曳阵列声呐', codeName: 'French Towed Array Profile', type: 'sonar_passive', maxRangeKm: 58, detectDomains: ['subsurface', 'surface'], frequencyBand: 'VLF Passive', description: '舰艇远程被动搜索传感器的代表参数。' },
  { id: 'uk_2076_sonar', name: '综合被动声呐阵列', codeName: 'Sonar 2076 Profile', type: 'sonar_passive', maxRangeKm: 66, detectDomains: ['subsurface', 'surface'], frequencyBand: 'Broadband Passive', description: '潜艇被动探测能力的游戏化配置。' },
  { id: 'india_mrw_radar', name: '地面中程预警雷达', codeName: 'MRW Radar Profile', type: 'radar_air_surface', maxRangeKm: 285, detectDomains: ['air'], frequencyBand: 'S-Band 3D Radar', description: '地面防空编组的通用搜索传感器。' },
  { id: 'france_giraffe_radar', name: '机动三坐标预警雷达', codeName: 'Giraffe Radar Profile', type: 'radar_air_surface', maxRangeKm: 255, detectDomains: ['air'], frequencyBand: 'C-Band 3D Radar', description: '为地面机动防空单元提供空情预警。' },
  { id: 'uk_giraffe_radar', name: '地面低空搜索雷达', codeName: 'Low-Altitude Radar Profile', type: 'radar_air_surface', maxRangeKm: 270, detectDomains: ['air'], frequencyBand: 'S-Band 3D Radar', description: '地面防空节点用低空搜索传感器。' },
  { id: 'germany_trml_radar', name: '地面战术多任务雷达', codeName: 'TRML Radar Profile', type: 'radar_air_surface', maxRangeKm: 250, detectDomains: ['air'], frequencyBand: 'X-Band 3D Radar', description: '地面编组用通用雷达模板。' },
];

export const EXPANSION_SENSORS: Record<string, SensorSpec> = Object.fromEntries(
  sensorSeeds.map((seed) => [seed.id, {
    ...seed,
    isActiveEmitter: seed.isActiveEmitter ?? seed.type.startsWith('radar_'),
    lookDownCapable: seed.type !== 'radar_oth',
  }])
);

interface LoadoutSeed {
  id: string;
  name: string;
  platformId: string;
  role: LoadoutSpec['role'];
  mounts: LoadoutSpec['mounts'];
}

const loadoutSeeds: LoadoutSeed[] = [
  { id: 'loadout_w2_india_su30', name: 'Su-30MKI 空中巡逻挂载', platformId: 'india_su30mki', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'astra_mk2_aam', maxAmmo: 4, reloadTimeSec: 8 }, { mountId: 'wvr', weaponId: 'pl10_wvr', maxAmmo: 2, reloadTimeSec: 4 }] },
  { id: 'loadout_w2_india_tejas', name: 'Tejas 多用途制空挂载', platformId: 'india_tejas', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'astra_mk1_aam', maxAmmo: 4, reloadTimeSec: 8 }, { mountId: 'wvr', weaponId: 'aim9x_wvr', maxAmmo: 2, reloadTimeSec: 4 }] },
  { id: 'loadout_w2_india_p8i', name: 'P-8I 海上巡逻挂载', platformId: 'india_p8i', role: 'asw_patrol', mounts: [{ mountId: 'torpedo', weaponId: 'mk54_lwt', maxAmmo: 4, reloadTimeSec: 15 }, { mountId: 'asm', weaponId: 'brahmos_ashm', maxAmmo: 2, reloadTimeSec: 15 }] },
  { id: 'loadout_w2_india_netra', name: 'Netra 空中监视构型', platformId: 'india_netra', role: 'multi_mission', mounts: [] },
  { id: 'loadout_w2_france_rafale', name: 'Rafale 多用途空战挂载', platformId: 'france_rafale', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'meteor_mraam', maxAmmo: 2, reloadTimeSec: 9 }, { mountId: 'multirole', weaponId: 'mica_ng_aam', maxAmmo: 4, reloadTimeSec: 7 }] },
  { id: 'loadout_w2_france_atl2', name: 'Atlantique 2 海上巡逻挂载', platformId: 'france_atl2', role: 'asw_patrol', mounts: [{ mountId: 'torpedo', weaponId: 'mu90_lwt', maxAmmo: 4, reloadTimeSec: 16 }] },
  { id: 'loadout_w2_uk_typhoon', name: 'Typhoon 空中巡逻挂载', platformId: 'uk_typhoon', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'meteor_mraam', maxAmmo: 4, reloadTimeSec: 9 }, { mountId: 'wvr', weaponId: 'asraam_aam', maxAmmo: 2, reloadTimeSec: 5 }] },
  { id: 'loadout_w2_uk_p8', name: 'P-8A 海上巡逻挂载', platformId: 'uk_p8a', role: 'asw_patrol', mounts: [{ mountId: 'torpedo', weaponId: 'mk54_lwt', maxAmmo: 4, reloadTimeSec: 15 }, { mountId: 'asm', weaponId: 'harpoon_blk2_ashm', maxAmmo: 2, reloadTimeSec: 15 }] },
  { id: 'loadout_w2_germany_eurofighter', name: 'Eurofighter 空中巡逻挂载', platformId: 'germany_eurofighter', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'meteor_mraam', maxAmmo: 4, reloadTimeSec: 9 }, { mountId: 'wvr', weaponId: 'iris_t_aam', maxAmmo: 2, reloadTimeSec: 5 }] },
  { id: 'loadout_w2_germany_p3', name: 'P-3C 海上巡逻挂载', platformId: 'germany_p3', role: 'asw_patrol', mounts: [{ mountId: 'torpedo', weaponId: 'mk54_lwt', maxAmmo: 4, reloadTimeSec: 15 }] },
  { id: 'loadout_w2_italy_f35a', name: 'F-35A 内置多用途挂载', platformId: 'italy_f35a', role: 'multi_mission', mounts: [{ mountId: 'internal_aam', weaponId: 'aim120d_aam', maxAmmo: 4, reloadTimeSec: 8 }, { mountId: 'internal_lacm', weaponId: 'taurus_kepd_lacm', maxAmmo: 2, reloadTimeSec: 14 }] },
  { id: 'loadout_w2_italy_typhoon', name: 'Eurofighter 空中巡逻挂载', platformId: 'italy_typhoon', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'meteor_mraam', maxAmmo: 4, reloadTimeSec: 9 }, { mountId: 'wvr', weaponId: 'asraam_aam', maxAmmo: 2, reloadTimeSec: 5 }] },
  { id: 'loadout_w2_turkey_kaan', name: 'Kaan 空中巡逻挂载', platformId: 'turkey_kaan', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'gokdogan_aam', maxAmmo: 4, reloadTimeSec: 8 }, { mountId: 'wvr', weaponId: 'bozdogan_aam', maxAmmo: 2, reloadTimeSec: 5 }] },
  { id: 'loadout_w2_turkey_anka', name: 'Anka 无人侦察构型', platformId: 'turkey_anka', role: 'multi_mission', mounts: [] },
  { id: 'loadout_w2_brazil_gripen', name: 'Gripen E 空中巡逻挂载', platformId: 'brazil_gripen', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'meteor_mraam', maxAmmo: 4, reloadTimeSec: 9 }, { mountId: 'wvr', weaponId: 'asraam_aam', maxAmmo: 2, reloadTimeSec: 5 }] },
  { id: 'loadout_w2_poland_fa50', name: 'FA-50 多用途防空挂载', platformId: 'poland_fa50', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'aim120d_aam', maxAmmo: 4, reloadTimeSec: 8 }, { mountId: 'wvr', weaponId: 'aim9x_wvr', maxAmmo: 2, reloadTimeSec: 4 }] },
  { id: 'loadout_w2_india_mig29k', name: 'MiG-29K 舰载防空挂载', platformId: 'india_mig29k', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'astra_mk1_aam', maxAmmo: 4, reloadTimeSec: 8 }, { mountId: 'wvr', weaponId: 'aim9x_wvr', maxAmmo: 2, reloadTimeSec: 4 }] },
  { id: 'loadout_w2_france_rafale_m', name: 'Rafale M 舰载防空挂载', platformId: 'france_rafale_m', role: 'aaw_cap', mounts: [{ mountId: 'bvr', weaponId: 'meteor_mraam', maxAmmo: 2, reloadTimeSec: 9 }, { mountId: 'multirole', weaponId: 'mica_ng_aam', maxAmmo: 4, reloadTimeSec: 7 }] },
  { id: 'loadout_w2_india_vikrant', name: 'Vikrant 舰队防空挂载', platformId: 'india_vikrant', role: 'aaw_cap', mounts: [{ mountId: 'self_defense', weaponId: 'aster15_sam', maxAmmo: 20, reloadTimeSec: 4 }] },
  { id: 'loadout_w2_india_kolkata', name: 'Kolkata 多用途舰载挂载', platformId: 'india_kolkata', role: 'multi_mission', mounts: [{ mountId: 'sam', weaponId: 'aster30_sam', maxAmmo: 24, reloadTimeSec: 5 }, { mountId: 'ashm', weaponId: 'brahmos_ashm', maxAmmo: 8, reloadTimeSec: 10 }, { mountId: 'torpedo', weaponId: 'mu90_lwt', maxAmmo: 2, reloadTimeSec: 18 }] },
  { id: 'loadout_w2_france_fremm', name: 'FREMM 多用途护航挂载', platformId: 'france_fremm', role: 'multi_mission', mounts: [{ mountId: 'sam', weaponId: 'aster30_sam', maxAmmo: 24, reloadTimeSec: 5 }, { mountId: 'ashm', weaponId: 'exocet_mm40_ashm', maxAmmo: 8, reloadTimeSec: 10 }, { mountId: 'torpedo', weaponId: 'mu90_lwt', maxAmmo: 2, reloadTimeSec: 18 }] },
  { id: 'loadout_w2_france_cdg', name: 'Charles de Gaulle 舰队防空挂载', platformId: 'france_cdg', role: 'aaw_cap', mounts: [{ mountId: 'self_defense', weaponId: 'aster15_sam', maxAmmo: 24, reloadTimeSec: 4 }] },
  { id: 'loadout_w2_uk_type45', name: 'Type 45 区域防空挂载', platformId: 'uk_type45', role: 'aaw_cap', mounts: [{ mountId: 'sam', weaponId: 'aster30_sam', maxAmmo: 32, reloadTimeSec: 5 }, { mountId: 'local_sam', weaponId: 'camm_er_sam', maxAmmo: 16, reloadTimeSec: 3 }] },
  { id: 'loadout_w2_germany_sachsen', name: 'Sachsen 防空护航挂载', platformId: 'germany_sachsen', role: 'aaw_cap', mounts: [{ mountId: 'sam', weaponId: 'irist_slm_sam', maxAmmo: 24, reloadTimeSec: 4 }, { mountId: 'torpedo', weaponId: 'dm2a4_torpedo', maxAmmo: 2, reloadTimeSec: 18 }] },
  { id: 'loadout_w2_italy_fremm', name: 'FREMM 防空反潜挂载', platformId: 'italy_fremm', role: 'multi_mission', mounts: [{ mountId: 'sam', weaponId: 'aster30_sam', maxAmmo: 24, reloadTimeSec: 5 }, { mountId: 'ashm', weaponId: 'exocet_mm40_ashm', maxAmmo: 8, reloadTimeSec: 10 }, { mountId: 'torpedo', weaponId: 'mu90_lwt', maxAmmo: 2, reloadTimeSec: 18 }] },
  { id: 'loadout_w2_turkey_istanbul', name: 'Istanbul 多用途护航挂载', platformId: 'turkey_istanbul', role: 'multi_mission', mounts: [{ mountId: 'sam', weaponId: 'camm_er_sam', maxAmmo: 24, reloadTimeSec: 4 }, { mountId: 'ashm', weaponId: 'atmac_ashm', maxAmmo: 8, reloadTimeSec: 10 }, { mountId: 'torpedo', weaponId: 'dm2a4_torpedo', maxAmmo: 2, reloadTimeSec: 18 }] },
  { id: 'loadout_w2_spain_f100', name: 'F-100 区域护航挂载', platformId: 'spain_f100', role: 'multi_mission', mounts: [{ mountId: 'sam', weaponId: 'sm6_eram', maxAmmo: 24, reloadTimeSec: 5 }, { mountId: 'ashm', weaponId: 'harpoon_blk2_ashm', maxAmmo: 8, reloadTimeSec: 10 }, { mountId: 'torpedo', weaponId: 'mk48_adcap', maxAmmo: 2, reloadTimeSec: 18 }] },
  { id: 'loadout_w2_norway_frigate', name: 'Fridtjof Nansen 护航挂载', platformId: 'norway_frigate', role: 'multi_mission', mounts: [{ mountId: 'sam', weaponId: 'essm_blk2', maxAmmo: 24, reloadTimeSec: 4 }, { mountId: 'ashm', weaponId: 'nsm_ashm', maxAmmo: 8, reloadTimeSec: 10 }, { mountId: 'torpedo', weaponId: 'mk48_adcap', maxAmmo: 2, reloadTimeSec: 18 }] },
  { id: 'loadout_w2_india_akash', name: 'Akash 中程防空阵地挂载', platformId: 'india_akash', role: 'aaw_cap', mounts: [{ mountId: 'launcher', weaponId: 'akash_sam', maxAmmo: 24, reloadTimeSec: 5 }] },
  { id: 'loadout_w2_india_arihant', name: 'Arihant 水下巡逻挂载', platformId: 'india_arihant', role: 'multi_mission', mounts: [{ mountId: 'torpedo', weaponId: 'dm2a4_torpedo', maxAmmo: 8, reloadTimeSec: 18 }, { mountId: 'land_attack', weaponId: 'brahmos_land_attack', maxAmmo: 4, reloadTimeSec: 15 }] },
  { id: 'loadout_w2_france_suffren', name: 'Suffren 水下巡逻挂载', platformId: 'france_suffren', role: 'multi_mission', mounts: [{ mountId: 'torpedo', weaponId: 'f21_black_shark_torpedo', maxAmmo: 8, reloadTimeSec: 18 }, { mountId: 'land_attack', weaponId: 'scalp_eg_lacm', maxAmmo: 4, reloadTimeSec: 15 }] },
  { id: 'loadout_w2_uk_astute', name: 'Astute 水下巡逻挂载', platformId: 'uk_astute', role: 'multi_mission', mounts: [{ mountId: 'torpedo', weaponId: 'spearfish_torpedo', maxAmmo: 8, reloadTimeSec: 18 }, { mountId: 'land_attack', weaponId: 'bgm109_tlahm', maxAmmo: 4, reloadTimeSec: 15 }] },
  { id: 'loadout_w2_germany_212', name: 'Type 212A 水下巡逻挂载', platformId: 'germany_212a', role: 'asw_patrol', mounts: [{ mountId: 'torpedo', weaponId: 'dm2a4_torpedo', maxAmmo: 8, reloadTimeSec: 18 }] },
  { id: 'loadout_w2_sweden_a26', name: 'A26 水下巡逻挂载', platformId: 'sweden_a26', role: 'multi_mission', mounts: [{ mountId: 'torpedo', weaponId: 'f21_black_shark_torpedo', maxAmmo: 8, reloadTimeSec: 18 }, { mountId: 'ashm', weaponId: 'rbs15_mk4_ashm', maxAmmo: 4, reloadTimeSec: 15 }] },
  { id: 'loadout_w2_japan_soryu', name: '苍龙级水下巡逻挂载', platformId: 'japan_soryu', role: 'asw_patrol', mounts: [{ mountId: 'torpedo', weaponId: 'mk48_adcap', maxAmmo: 8, reloadTimeSec: 18 }] },
];

export const EXPANSION_LOADOUTS: Record<string, LoadoutSpec> = Object.fromEntries(
  loadoutSeeds.map((seed) => [seed.id, {
    ...seed,
    codeName: seed.id.replaceAll('_', ' ').toUpperCase(),
    compatiblePlatformIds: [seed.platformId],
    description: '场景编辑用任务挂载模板，弹药数量为游戏平衡值。',
  }])
);

interface PlatformSeed {
  id: string;
  name: string;
  className: string;
  origin: string;
  domain: Domain;
  category: PlatformSpec['category'];
  maxSpeedKts: number;
  cruiseSpeedKts: number;
  maxFuelSec: number;
  maxHp: number;
  rcsM2: number;
  sensorIds: string[];
  loadoutId?: string;
  mounts?: PlatformSpec['mounts'];
  radarAntennaHeightM?: number;
  acousticSignatureDb?: number;
  hangarSlots?: PlatformSpec['hangarSlots'];
}

const platformSeeds: PlatformSeed[] = [
  { id: 'india_su30mki', name: 'Su-30MKI 多用途战斗机', className: 'Su-30MKI Multirole Fighter', origin: 'INDIA', domain: 'air', category: 'fighter', maxSpeedKts: 1250, cruiseSpeedKts: 620, maxFuelSec: 9200, maxHp: 52, rcsM2: 8, sensorIds: ['india_uttam_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_india_su30' },
  { id: 'india_tejas', name: 'Tejas Mk1A 轻型战斗机', className: 'Tejas Mk1A Fighter', origin: 'INDIA', domain: 'air', category: 'fighter', maxSpeedKts: 1050, cruiseSpeedKts: 520, maxFuelSec: 6500, maxHp: 36, rcsM2: 2.8, sensorIds: ['india_uttam_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_india_tejas' },
  { id: 'india_p8i', name: 'P-8I 海上巡逻机', className: 'P-8I Maritime Patrol Aircraft', origin: 'INDIA', domain: 'air', category: 'mpa_uav', maxSpeedKts: 490, cruiseSpeedKts: 360, maxFuelSec: 18000, maxHp: 50, rcsM2: 30, sensorIds: ['apy10_maritime_radar', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_india_p8i' },
  { id: 'india_netra', name: 'Netra 空中预警机', className: 'Netra AEW&C', origin: 'INDIA', domain: 'air', category: 'awacs', maxSpeedKts: 360, cruiseSpeedKts: 290, maxFuelSec: 16000, maxHp: 46, rcsM2: 32, sensorIds: ['india_netra_mrr', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_india_netra' },
  { id: 'france_rafale', name: 'Rafale 多用途战斗机', className: 'Rafale Multirole Fighter', origin: 'FRANCE', domain: 'air', category: 'fighter', maxSpeedKts: 1190, cruiseSpeedKts: 600, maxFuelSec: 7600, maxHp: 44, rcsM2: 2.2, sensorIds: ['france_rbe2_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_france_rafale' },
  { id: 'france_atl2', name: 'Atlantique 2 海上巡逻机', className: 'Atlantique 2 Maritime Patrol Aircraft', origin: 'FRANCE', domain: 'air', category: 'mpa_uav', maxSpeedKts: 380, cruiseSpeedKts: 280, maxFuelSec: 18000, maxHp: 48, rcsM2: 28, sensorIds: ['france_atl2_search_radar', 'airborne_esm_rwr', 'towed_array_sonar'], loadoutId: 'loadout_w2_france_atl2' },
  { id: 'uk_typhoon', name: 'Typhoon 多用途战斗机', className: 'Eurofighter Typhoon', origin: 'UNITED_KINGDOM', domain: 'air', category: 'fighter', maxSpeedKts: 1250, cruiseSpeedKts: 630, maxFuelSec: 7400, maxHp: 45, rcsM2: 2.5, sensorIds: ['uk_captor_e_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_uk_typhoon' },
  { id: 'uk_p8a', name: 'P-8A 海上巡逻机', className: 'P-8A Maritime Patrol Aircraft', origin: 'UNITED_KINGDOM', domain: 'air', category: 'mpa_uav', maxSpeedKts: 490, cruiseSpeedKts: 360, maxFuelSec: 18000, maxHp: 50, rcsM2: 30, sensorIds: ['apy10_maritime_radar', 'airborne_esm_rwr', 'towed_array_sonar'], loadoutId: 'loadout_w2_uk_p8' },
  { id: 'germany_eurofighter', name: 'Eurofighter 多用途战斗机', className: 'Eurofighter Typhoon', origin: 'GERMANY', domain: 'air', category: 'fighter', maxSpeedKts: 1240, cruiseSpeedKts: 620, maxFuelSec: 7400, maxHp: 44, rcsM2: 2.6, sensorIds: ['germany_captor_m_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_germany_eurofighter' },
  { id: 'germany_p3', name: 'P-3C 海上巡逻机', className: 'P-3C Maritime Patrol Aircraft', origin: 'GERMANY', domain: 'air', category: 'mpa_uav', maxSpeedKts: 410, cruiseSpeedKts: 300, maxFuelSec: 16000, maxHp: 46, rcsM2: 27, sensorIds: ['apy10_maritime_radar', 'airborne_esm_rwr', 'towed_array_sonar'], loadoutId: 'loadout_w2_germany_p3' },
  { id: 'italy_f35a', name: 'F-35A 多用途隐身战斗机', className: 'F-35A Lightning II', origin: 'ITALY', domain: 'air', category: 'stealth_fighter', maxSpeedKts: 1060, cruiseSpeedKts: 560, maxFuelSec: 7200, maxHp: 40, rcsM2: 0.01, sensorIds: ['apg81_aesa', 'airborne_esm_rwr', 'eots_irst'], loadoutId: 'loadout_w2_italy_f35a' },
  { id: 'italy_typhoon', name: 'Eurofighter 多用途战斗机', className: 'Eurofighter Typhoon', origin: 'ITALY', domain: 'air', category: 'fighter', maxSpeedKts: 1240, cruiseSpeedKts: 620, maxFuelSec: 7400, maxHp: 44, rcsM2: 2.6, sensorIds: ['germany_captor_m_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_italy_typhoon' },
  { id: 'turkey_kaan', name: 'KAAN 多用途战斗机原型', className: 'KAAN Fighter Prototype', origin: 'TURKEY', domain: 'air', category: 'stealth_fighter', maxSpeedKts: 1200, cruiseSpeedKts: 620, maxFuelSec: 7800, maxHp: 46, rcsM2: 0.08, sensorIds: ['turkey_kaan_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_turkey_kaan' },
  { id: 'turkey_anka', name: 'Anka 无人侦察机', className: 'Anka ISR UAV', origin: 'TURKEY', domain: 'air', category: 'mpa_uav', maxSpeedKts: 180, cruiseSpeedKts: 130, maxFuelSec: 24000, maxHp: 18, rcsM2: 1.2, sensorIds: ['apy10_maritime_radar', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_turkey_anka' },
  { id: 'brazil_gripen', name: 'Gripen E 多用途战斗机', className: 'Gripen E Fighter', origin: 'BRAZIL', domain: 'air', category: 'fighter', maxSpeedKts: 1160, cruiseSpeedKts: 570, maxFuelSec: 7200, maxHp: 40, rcsM2: 2.4, sensorIds: ['brazil_gripen_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_brazil_gripen' },
  { id: 'poland_fa50', name: 'FA-50 轻型战斗机', className: 'FA-50 Light Combat Aircraft', origin: 'POLAND', domain: 'air', category: 'fighter', maxSpeedKts: 1000, cruiseSpeedKts: 520, maxFuelSec: 6200, maxHp: 34, rcsM2: 3.2, sensorIds: ['j_apg2_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_poland_fa50' },
  { id: 'india_mig29k', name: 'MiG-29K 舰载战斗机', className: 'MiG-29K Carrier Fighter', origin: 'INDIA', domain: 'air', category: 'fighter', maxSpeedKts: 1180, cruiseSpeedKts: 570, maxFuelSec: 6800, maxHp: 39, rcsM2: 4.5, sensorIds: ['india_uttam_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_india_mig29k' },
  { id: 'france_rafale_m', name: 'Rafale M 舰载战斗机', className: 'Rafale M Carrier Fighter', origin: 'FRANCE', domain: 'air', category: 'fighter', maxSpeedKts: 1180, cruiseSpeedKts: 590, maxFuelSec: 7400, maxHp: 43, rcsM2: 2.4, sensorIds: ['france_rbe2_aesa', 'airborne_esm_rwr'], loadoutId: 'loadout_w2_france_rafale_m' },
  { id: 'india_vikrant', name: 'Vikrant 航空母舰', className: 'Vikrant-class Carrier', origin: 'INDIA', domain: 'surface', category: 'carrier', maxSpeedKts: 28, cruiseSpeedKts: 20, maxFuelSec: 86400, maxHp: 285, rcsM2: 8400, radarAntennaHeightM: 38, sensorIds: ['india_el2248_radar', 'shipborne_esm', 'towed_array_sonar'], loadoutId: 'loadout_w2_india_vikrant', hangarSlots: [{ slotId: 'hangar_vikrant_mig29k', squadronName: 'MiG-29K 舰载机分队', platformId: 'india_mig29k', defaultLoadoutId: 'loadout_w2_india_mig29k', availableLoadoutIds: ['loadout_w2_india_mig29k'], totalAirframes: 4, readyAirframes: 2, launchCooldownSec: 18, turnaroundSec: 75, turnaroundSupplyBatches: 3 }] },
  { id: 'india_kolkata', name: 'Kolkata 多用途驱逐舰', className: 'Kolkata-class Destroyer', origin: 'INDIA', domain: 'surface', category: 'destroyer', maxSpeedKts: 30, cruiseSpeedKts: 21, maxFuelSec: 86400, maxHp: 150, rcsM2: 1380, sensorIds: ['india_el2248_radar', 'shipborne_esm', 'india_hull_sonar'], loadoutId: 'loadout_w2_india_kolkata' },
  { id: 'france_fremm', name: 'FREMM 多用途护卫舰', className: 'FREMM Frigate', origin: 'FRANCE', domain: 'surface', category: 'frigate', maxSpeedKts: 28, cruiseSpeedKts: 19, maxFuelSec: 86400, maxHp: 125, rcsM2: 800, sensorIds: ['france_herakles_radar', 'shipborne_esm', 'france_towed_sonar'], loadoutId: 'loadout_w2_france_fremm' },
  { id: 'france_cdg', name: 'Charles de Gaulle 航空母舰', className: 'Charles de Gaulle Carrier', origin: 'FRANCE', domain: 'surface', category: 'carrier', maxSpeedKts: 28, cruiseSpeedKts: 20, maxFuelSec: 86400, maxHp: 300, rcsM2: 9200, radarAntennaHeightM: 40, sensorIds: ['france_herakles_radar', 'shipborne_esm', 'france_towed_sonar'], loadoutId: 'loadout_w2_france_cdg', hangarSlots: [{ slotId: 'hangar_cdg_rafale_m', squadronName: 'Rafale M 舰载航空分队', platformId: 'france_rafale_m', defaultLoadoutId: 'loadout_w2_france_rafale_m', availableLoadoutIds: ['loadout_w2_france_rafale_m'], totalAirframes: 4, readyAirframes: 2, launchCooldownSec: 18, turnaroundSec: 75, turnaroundSupplyBatches: 3 }] },
  { id: 'uk_type45', name: 'Type 45 防空驱逐舰', className: 'Type 45 Air Defence Destroyer', origin: 'UNITED_KINGDOM', domain: 'surface', category: 'destroyer', maxSpeedKts: 29, cruiseSpeedKts: 20, maxFuelSec: 86400, maxHp: 155, rcsM2: 1450, sensorIds: ['uk_sampson_radar', 'shipborne_esm', 'uk_2076_sonar'], loadoutId: 'loadout_w2_uk_type45' },
  { id: 'germany_sachsen', name: 'Sachsen 防空护卫舰', className: 'Sachsen-class Frigate', origin: 'GERMANY', domain: 'surface', category: 'frigate', maxSpeedKts: 28, cruiseSpeedKts: 19, maxFuelSec: 86400, maxHp: 130, rcsM2: 790, sensorIds: ['germany_apar_radar', 'shipborne_esm', 'towed_array_sonar'], loadoutId: 'loadout_w2_germany_sachsen' },
  { id: 'italy_fremm', name: 'FREMM 多用途护卫舰', className: 'Italian FREMM Frigate', origin: 'ITALY', domain: 'surface', category: 'frigate', maxSpeedKts: 28, cruiseSpeedKts: 19, maxFuelSec: 86400, maxHp: 125, rcsM2: 780, sensorIds: ['ops28_mfr', 'shipborne_esm', 'towed_array_sonar'], loadoutId: 'loadout_w2_italy_fremm' },
  { id: 'turkey_istanbul', name: 'Istanbul 多用途护卫舰', className: 'Istanbul-class Frigate', origin: 'TURKEY', domain: 'surface', category: 'frigate', maxSpeedKts: 29, cruiseSpeedKts: 20, maxFuelSec: 86400, maxHp: 122, rcsM2: 740, sensorIds: ['turkey_cenk_radar', 'shipborne_esm', 'india_hull_sonar'], loadoutId: 'loadout_w2_turkey_istanbul' },
  { id: 'spain_f100', name: 'F-100 区域防空护卫舰', className: 'Álvaro de Bazán-class Frigate', origin: 'SPAIN', domain: 'surface', category: 'frigate', maxSpeedKts: 28, cruiseSpeedKts: 19, maxFuelSec: 86400, maxHp: 125, rcsM2: 800, sensorIds: ['uk_sampson_radar', 'shipborne_esm', 'towed_array_sonar'], loadoutId: 'loadout_w2_spain_f100' },
  { id: 'norway_frigate', name: 'Fridtjof Nansen 护卫舰', className: 'Fridtjof Nansen-class Frigate', origin: 'NORWAY', domain: 'surface', category: 'frigate', maxSpeedKts: 28, cruiseSpeedKts: 19, maxFuelSec: 86400, maxHp: 120, rcsM2: 750, sensorIds: ['ops28_mfr', 'shipborne_esm', 'uk_2076_sonar'], loadoutId: 'loadout_w2_norway_frigate' },
  { id: 'india_arihant', name: 'Arihant 水下巡逻平台', className: 'Arihant-class Subsurface Unit', origin: 'INDIA', domain: 'subsurface', category: 'ssn', maxSpeedKts: 26, cruiseSpeedKts: 12, maxFuelSec: 86400, maxHp: 100, rcsM2: 0.01, sensorIds: ['india_hull_sonar', 'towed_array_sonar'], loadoutId: 'loadout_w2_india_arihant' },
  { id: 'france_suffren', name: 'Suffren 水下巡逻平台', className: 'Suffren-class Subsurface Unit', origin: 'FRANCE', domain: 'subsurface', category: 'ssn', maxSpeedKts: 30, cruiseSpeedKts: 14, maxFuelSec: 86400, maxHp: 108, rcsM2: 0.01, sensorIds: ['france_towed_sonar', 'hull_active_sonar'], loadoutId: 'loadout_w2_france_suffren' },
  { id: 'uk_astute', name: 'Astute 水下巡逻平台', className: 'Astute-class Subsurface Unit', origin: 'UNITED_KINGDOM', domain: 'subsurface', category: 'ssn', maxSpeedKts: 31, cruiseSpeedKts: 14, maxFuelSec: 86400, maxHp: 108, rcsM2: 0.01, sensorIds: ['uk_2076_sonar', 'towed_array_sonar'], loadoutId: 'loadout_w2_uk_astute' },
  { id: 'germany_212a', name: 'Type 212A 常规潜艇', className: 'Type 212A Subsurface Unit', origin: 'GERMANY', domain: 'subsurface', category: 'ssn', maxSpeedKts: 22, cruiseSpeedKts: 8, maxFuelSec: 86400, maxHp: 88, rcsM2: 0.002, sensorIds: ['france_towed_sonar', 'towed_array_sonar'], loadoutId: 'loadout_w2_germany_212' },
  { id: 'sweden_a26', name: 'A26 常规潜艇', className: 'A26 Subsurface Unit', origin: 'SWEDEN', domain: 'subsurface', category: 'ssn', maxSpeedKts: 22, cruiseSpeedKts: 8, maxFuelSec: 86400, maxHp: 90, rcsM2: 0.002, sensorIds: ['france_towed_sonar', 'hull_active_sonar'], loadoutId: 'loadout_w2_sweden_a26' },
  { id: 'japan_soryu', name: '苍龙级常规潜艇', className: 'Soryu-class Subsurface Unit', origin: 'JAPAN', domain: 'subsurface', category: 'ssn', maxSpeedKts: 23, cruiseSpeedKts: 8, maxFuelSec: 86400, maxHp: 92, rcsM2: 0.002, sensorIds: ['blue_aip_flank_array', 'hull_active_sonar'], loadoutId: 'loadout_w2_japan_soryu' },
  { id: 'india_akash', name: 'Akash 中程地面防空阵地', className: 'Akash Medium-Range SAM Battery', origin: 'INDIA', domain: 'land', category: 'sam_battery', maxSpeedKts: 0, cruiseSpeedKts: 0, maxFuelSec: 86400, maxHp: 105, rcsM2: 150, sensorIds: ['india_mrw_radar', 'shipborne_esm'], loadoutId: 'loadout_w2_india_akash' },
  { id: 'india_arjun', name: 'Arjun 装甲机动分队', className: 'Arjun Maneuver Unit', origin: 'INDIA', domain: 'land', category: 'ground_force', maxSpeedKts: 36, cruiseSpeedKts: 24, maxFuelSec: 86400, maxHp: 118, rcsM2: 58, sensorIds: ['eots_irst'], mounts: [{ mountId: 'atgm', weaponId: 'hj10_atgm', maxAmmo: 12, reloadTimeSec: 8 }] },
  { id: 'france_sampt', name: 'SAMP/T 地面防空阵地', className: 'SAMP/T Air Defence Battery', origin: 'FRANCE', domain: 'land', category: 'sam_battery', maxSpeedKts: 10, cruiseSpeedKts: 6, maxFuelSec: 86400, maxHp: 110, rcsM2: 145, sensorIds: ['france_giraffe_radar', 'shipborne_esm'], mounts: [{ mountId: 'launcher', weaponId: 'aster30_sam', maxAmmo: 24, reloadTimeSec: 5 }] },
  { id: 'france_leclerc', name: 'Leclerc 装甲机动分队', className: 'Leclerc Maneuver Unit', origin: 'FRANCE', domain: 'land', category: 'ground_force', maxSpeedKts: 38, cruiseSpeedKts: 25, maxFuelSec: 86400, maxHp: 120, rcsM2: 56, sensorIds: ['eots_irst'], mounts: [{ mountId: 'atgm', weaponId: 'hj10_atgm', maxAmmo: 12, reloadTimeSec: 8 }] },
  { id: 'uk_sky_sabre', name: 'Sky Sabre 机动防空阵地', className: 'Sky Sabre Mobile SAM Battery', origin: 'UNITED_KINGDOM', domain: 'land', category: 'sam_battery', maxSpeedKts: 12, cruiseSpeedKts: 8, maxFuelSec: 86400, maxHp: 100, rcsM2: 135, sensorIds: ['uk_giraffe_radar', 'shipborne_esm'], mounts: [{ mountId: 'launcher', weaponId: 'camm_er_sam', maxAmmo: 20, reloadTimeSec: 4 }] },
  { id: 'uk_challenger', name: 'Challenger 装甲机动分队', className: 'Challenger Maneuver Unit', origin: 'UNITED_KINGDOM', domain: 'land', category: 'ground_force', maxSpeedKts: 35, cruiseSpeedKts: 23, maxFuelSec: 86400, maxHp: 122, rcsM2: 60, sensorIds: ['eots_irst'], mounts: [{ mountId: 'atgm', weaponId: 'hj10_atgm', maxAmmo: 12, reloadTimeSec: 8 }] },
  { id: 'norway_nasams', name: 'NASAMS 机动防空阵地', className: 'NASAMS Mobile Air Defence Battery', origin: 'NORWAY', domain: 'land', category: 'sam_battery', maxSpeedKts: 16, cruiseSpeedKts: 10, maxFuelSec: 86400, maxHp: 95, rcsM2: 120, sensorIds: ['uk_giraffe_radar', 'airborne_esm_rwr'], mounts: [{ mountId: 'launcher', weaponId: 'aim120d_aam', maxAmmo: 18, reloadTimeSec: 4 }] },
  { id: 'germany_leopard2', name: 'Leopard 2 装甲机动分队', className: 'Leopard 2 Maneuver Unit', origin: 'GERMANY', domain: 'land', category: 'ground_force', maxSpeedKts: 36, cruiseSpeedKts: 24, maxFuelSec: 86400, maxHp: 122, rcsM2: 60, sensorIds: ['eots_irst'], mounts: [{ mountId: 'atgm', weaponId: 'hj10_atgm', maxAmmo: 12, reloadTimeSec: 8 }] },
  { id: 'poland_krab', name: 'Krab 机动火力支援分队', className: 'Krab Mobile Fire Support Unit', origin: 'POLAND', domain: 'land', category: 'asm_battery', maxSpeedKts: 28, cruiseSpeedKts: 18, maxFuelSec: 86400, maxHp: 96, rcsM2: 100, sensorIds: ['germany_trml_radar', 'shipborne_esm'], mounts: [{ mountId: 'fire_support', weaponId: 'himars_atacms', maxAmmo: 12, reloadTimeSec: 12 }] },
  { id: 'brazil_astros', name: 'ASTROS 机动远程火力分队', className: 'ASTROS Mobile Fires Unit', origin: 'BRAZIL', domain: 'land', category: 'asm_battery', maxSpeedKts: 26, cruiseSpeedKts: 16, maxFuelSec: 86400, maxHp: 92, rcsM2: 95, sensorIds: ['brazil_gripen_aesa', 'shipborne_esm'], mounts: [{ mountId: 'fire_support', weaponId: 'himars_atacms', maxAmmo: 10, reloadTimeSec: 14 }] },
];

export const EXPANSION_PLATFORMS: Record<string, PlatformSpec> = Object.fromEntries(
  platformSeeds.map((seed) => {
    const domainSymbols: Record<Domain, [string, string]> = {
      air: ['SHAPMF------', 'SFAPMF------'],
      surface: ['SHSPCLDD----', 'SFSPCLDD----'],
      subsurface: ['SHUPSN------', 'SFUPSN------'],
      land: ['SHGPUCA---', 'SFGPUCA---'],
    };
    const [defaultSidcRed, defaultSidcBlue] = domainSymbols[seed.domain];
    const loadout = seed.loadoutId ? EXPANSION_LOADOUTS[seed.loadoutId] : undefined;
    return [seed.id, {
      id: seed.id,
      name: seed.name,
      className: seed.className,
      origin: seed.origin,
      domain: seed.domain,
      category: seed.category,
      defaultSidcRed,
      defaultSidcBlue,
      maxSpeedKts: seed.maxSpeedKts,
      cruiseSpeedKts: seed.cruiseSpeedKts,
      defaultAltitudeM: seed.domain === 'air' ? (seed.category === 'awacs' ? 9000 : 9500)
        : seed.domain === 'subsurface' ? -100 : seed.domain === 'land' ? 100 : 0,
      minAltitudeM: seed.domain === 'air' ? 100 : seed.domain === 'subsurface' ? -400 : seed.domain === 'land' ? 0 : 0,
      maxAltitudeM: seed.domain === 'air' ? 18000 : seed.domain === 'subsurface' ? -15 : seed.domain === 'land' ? 3000 : 0,
      radarAntennaHeightM: seed.radarAntennaHeightM ?? (seed.domain === 'surface' ? 28 : seed.domain === 'land' ? 12 : 0),
      maxFuelSec: seed.maxFuelSec,
      maxHp: seed.maxHp,
      rcsM2: seed.rcsM2,
      acousticSignatureDb: seed.acousticSignatureDb ?? (seed.domain === 'surface' ? 110 : seed.domain === 'subsurface' ? 82 : 0),
      hasDatalink: true,
      ciwsDefenseProb: seed.domain === 'surface' ? 0.4 : seed.domain === 'land' ? 0.18 : 0.25,
      sensorIds: seed.sensorIds,
      defaultLoadoutId: seed.loadoutId,
      availableLoadoutIds: seed.loadoutId ? [seed.loadoutId] : undefined,
      mounts: loadout?.mounts ?? seed.mounts ?? [],
      hangarSlots: seed.hangarSlots,
      description: '游戏平衡用平台模板；性能数值和编组信息不对应现实部署方案。',
    }];
  })
);

interface ForcePackageSeed extends Omit<ForcePackageSpec, 'id' | 'name' | 'origin' | 'domain' | 'role' | 'members' | 'description'> {
  id: string;
  name: string;
  origin: string;
  domain: Domain;
  role: ForcePackageSpec['role'];
  members: ForcePackageSpec['members'];
  description: string;
}

const forcePackageSeeds: ForcePackageSeed[] = [
  { id: 'india_air_patrol', name: '印度空中巡逻编组', origin: 'INDIA', domain: 'air', role: 'air_wing', members: [{ platformId: 'india_su30mki', quantity: 4, loadoutId: 'loadout_w2_india_su30' }, { platformId: 'india_netra', quantity: 1, loadoutId: 'loadout_w2_india_netra' }], description: '由战斗机和预警节点组成的场景模板。' },
  { id: 'india_carrier_group', name: '印度航母海空编组', origin: 'INDIA', domain: 'surface', role: 'joint_task_force', members: [{ platformId: 'india_vikrant', quantity: 1 }, { platformId: 'india_kolkata', quantity: 2 }], description: '包含航母和护航舰，舰载机从母舰机库生成。' },
  { id: 'india_subsurface_patrol', name: '印度水下巡逻编组', origin: 'INDIA', domain: 'subsurface', role: 'subsurface_group', members: [{ platformId: 'india_arihant', quantity: 1, loadoutId: 'loadout_w2_india_arihant' }, { platformId: 'india_p8i', quantity: 1, loadoutId: 'loadout_w2_india_p8i' }], description: '水下平台与海上巡逻机协同的场景模板。' },
  { id: 'india_ground_defense', name: '印度地面防空与机动组', origin: 'INDIA', domain: 'land', role: 'ground_force', members: [{ platformId: 'india_akash', quantity: 2 }, { platformId: 'india_arjun', quantity: 1 }], description: '地面防空节点与机动单位组合。' },
  { id: 'france_air_expeditionary', name: '法国空中任务编组', origin: 'FRANCE', domain: 'air', role: 'air_wing', members: [{ platformId: 'france_rafale', quantity: 4, loadoutId: 'loadout_w2_france_rafale' }, { platformId: 'france_atl2', quantity: 1, loadoutId: 'loadout_w2_france_atl2' }], description: '多用途战斗机与海上巡逻机组合。' },
  { id: 'france_carrier_group', name: '法国航母编队', origin: 'FRANCE', domain: 'surface', role: 'joint_task_force', members: [{ platformId: 'france_cdg', quantity: 1 }, { platformId: 'france_fremm', quantity: 2 }], description: '航母与水面护航舰组合，舰载机由母舰机库提供。' },
  { id: 'france_ground_group', name: '法国地面防空机动组', origin: 'FRANCE', domain: 'land', role: 'ground_force', members: [{ platformId: 'france_sampt', quantity: 1 }, { platformId: 'france_leclerc', quantity: 1 }], description: '机动防空和地面机动单位组合。' },
  { id: 'france_subsurface_group', name: '法国水下巡逻编组', origin: 'FRANCE', domain: 'subsurface', role: 'subsurface_group', members: [{ platformId: 'france_suffren', quantity: 1, loadoutId: 'loadout_w2_france_suffren' }, { platformId: 'france_atl2', quantity: 1, loadoutId: 'loadout_w2_france_atl2' }], description: '潜艇和海上巡逻机组合。' },
  { id: 'uk_air_patrol', name: '英国空中巡逻编组', origin: 'UNITED_KINGDOM', domain: 'air', role: 'air_wing', members: [{ platformId: 'uk_typhoon', quantity: 4, loadoutId: 'loadout_w2_uk_typhoon' }, { platformId: 'uk_p8a', quantity: 1, loadoutId: 'loadout_w2_uk_p8' }], description: '空中巡逻与海上监视场景模板。' },
  { id: 'uk_naval_group', name: '英国水面护航编组', origin: 'UNITED_KINGDOM', domain: 'surface', role: 'surface_group', members: [{ platformId: 'uk_type45', quantity: 2, loadoutId: 'loadout_w2_uk_type45' }], description: '以区域防空舰为核心的水面编组。' },
  { id: 'uk_subsurface_group', name: '英国水下巡逻编组', origin: 'UNITED_KINGDOM', domain: 'subsurface', role: 'subsurface_group', members: [{ platformId: 'uk_astute', quantity: 1, loadoutId: 'loadout_w2_uk_astute' }], description: '单艇水下巡逻任务模板。' },
  { id: 'germany_air_patrol', name: '德国空中巡逻编组', origin: 'GERMANY', domain: 'air', role: 'air_wing', members: [{ platformId: 'germany_eurofighter', quantity: 4, loadoutId: 'loadout_w2_germany_eurofighter' }, { platformId: 'germany_p3', quantity: 1, loadoutId: 'loadout_w2_germany_p3' }], description: '战斗机与海上巡逻机协同模板。' },
  { id: 'germany_surface_group', name: '德国水面护航编组', origin: 'GERMANY', domain: 'surface', role: 'surface_group', members: [{ platformId: 'germany_sachsen', quantity: 2, loadoutId: 'loadout_w2_germany_sachsen' }], description: '多用途护卫舰组合。' },
  { id: 'germany_subsurface_group', name: '德国水下巡逻编组', origin: 'GERMANY', domain: 'subsurface', role: 'subsurface_group', members: [{ platformId: 'germany_212a', quantity: 2, loadoutId: 'loadout_w2_germany_212' }], description: '常规潜艇巡逻任务模板。' },
  { id: 'germany_ground_group', name: '德国地面机动编组', origin: 'GERMANY', domain: 'land', role: 'ground_force', members: [{ platformId: 'germany_leopard2', quantity: 3 }], description: '抽象化地面机动单位场景模板。' },
  { id: 'italy_joint_patrol', name: '意大利联合巡逻编组', origin: 'ITALY', domain: 'air', role: 'joint_task_force', members: [{ platformId: 'italy_f35a', quantity: 2, loadoutId: 'loadout_w2_italy_f35a' }, { platformId: 'italy_typhoon', quantity: 2, loadoutId: 'loadout_w2_italy_typhoon' }], description: '两类航空平台组成的场景巡逻模板。' },
  { id: 'turkey_joint_patrol', name: '土耳其联合巡逻编组', origin: 'TURKEY', domain: 'air', role: 'joint_task_force', members: [{ platformId: 'turkey_kaan', quantity: 2, loadoutId: 'loadout_w2_turkey_kaan' }, { platformId: 'turkey_anka', quantity: 1, loadoutId: 'loadout_w2_turkey_anka' }], description: '战斗机和无人侦察平台组合。' },
  { id: 'turkey_naval_group', name: '土耳其水面护航编组', origin: 'TURKEY', domain: 'surface', role: 'surface_group', members: [{ platformId: 'turkey_istanbul', quantity: 2, loadoutId: 'loadout_w2_turkey_istanbul' }], description: '多用途水面护航舰组合。' },
  { id: 'brazil_ground_group', name: '巴西地面机动与火力组', origin: 'BRAZIL', domain: 'land', role: 'ground_force', members: [{ platformId: 'brazil_astros', quantity: 1 }, { platformId: 'brazil_gripen', quantity: 2, loadoutId: 'loadout_w2_brazil_gripen' }], description: '地面火力节点与空中巡逻单位组合。' },
  { id: 'poland_air_group', name: '波兰空中防御编组', origin: 'POLAND', domain: 'air', role: 'air_wing', members: [{ platformId: 'poland_fa50', quantity: 4, loadoutId: 'loadout_w2_poland_fa50' }, { platformId: 'norway_nasams', quantity: 1 }], description: '空中巡逻机与地面防空节点组合。' },
  { id: 'regional_north_sea_group', name: '北海联合巡逻编组', origin: 'MULTINATIONAL', domain: 'surface', role: 'joint_task_force', members: [{ platformId: 'norway_frigate', quantity: 1, loadoutId: 'loadout_w2_norway_frigate' }, { platformId: 'uk_type45', quantity: 1, loadoutId: 'loadout_w2_uk_type45' }, { platformId: 'sweden_a26', quantity: 1, loadoutId: 'loadout_w2_sweden_a26' }], description: '跨国水面与水下平台组合，用于多人场景编排。' },
];

export const EXPANSION_FORCE_PACKAGES: Record<string, ForcePackageSpec> = Object.fromEntries(
  forcePackageSeeds.map((seed) => [seed.id, {
    ...seed,
    description: `${seed.description} 编组为场景模板，不代表现实部队的标准编制。`,
  }])
);
