import type { LoadoutSpec } from '../../types/wargame';

// ============================================================================
// LEVEL 2: 战术挂载方案库 (Tactical Loadouts & Magazine Profiles)
// 同一平台（如 J-20 / J-16 / F-35C / 055大驱）可通过切换 Loadout 扮演截然不同的战术角色
// ============================================================================

export const MODULAR_LOADOUTS: Record<string, LoadoutSpec> = {
  // --- 红方战机挂载方案 ---
  loadout_j20_stealth_cap: {
    id: 'loadout_j20_stealth_cap',
    name: '歼-20A 纯内置隐身制空挂载 (PL-15×6)',
    codeName: 'Internal Stealth CAP',
    role: 'aaw_cap',
    compatiblePlatformIds: ['j20_mighty_dragon'],
    rcsPenaltyM2: 0,
    speedPenaltyKts: 0,
    mounts: [
      { mountId: 'bay_pl15', weaponId: 'pl15_aam', maxAmmo: 8, reloadTimeSec: 6 },
    ],
    description: '全内置弹舱携行霹雳-15，保持0.004m²极限正面隐身特性，适合前出猎杀敌方隐身机与护航编队。',
  },
  loadout_j20_awacs_hunter: {
    id: 'loadout_j20_awacs_hunter',
    name: '歼-20A 超远程猎杀预警机挂载 (PL-17×4 + PL-15×4)',
    codeName: 'Beast Mode AWACS Hunter',
    role: 'aaw_cap',
    compatiblePlatformIds: ['j20_mighty_dragon'],
    rcsPenaltyM2: 0.12, // 翼下挂载超大型霹雳-17导致正面RCS轻微上升
    speedPenaltyKts: 40,
    mounts: [
      { mountId: 'pylon_pl17', weaponId: 'pl17_ulraam', maxAmmo: 4, reloadTimeSec: 10 },
      { mountId: 'bay_pl15', weaponId: 'pl15_aam', maxAmmo: 4, reloadTimeSec: 6 },
    ],
    description: '挂载400km射程霹雳-17超远程空空弹，专门从防区外一击必杀敌方E-2D预警机空中节点。',
  },
  loadout_j35_carrier_cap: {
    id: 'loadout_j35_carrier_cap',
    name: '歼-35 舰载隐身防空截击挂载 (PL-15折叠翼×6)',
    codeName: 'Carrier Stealth CAP',
    role: 'aaw_cap',
    compatiblePlatformIds: ['j35_naval_stealth'],
    rcsPenaltyM2: 0,
    mounts: [
      { mountId: 'bay_pl15', weaponId: 'pl15_aam', maxAmmo: 6, reloadTimeSec: 6 },
    ],
    description: '福建舰弹射起飞的隐身舰载机标准制空构型。',
  },
  loadout_j35_maritime_strike: {
    id: 'loadout_j35_maritime_strike',
    name: '歼-35 舰载对海/防空压制突击挂载 (YJ-12×2 + LD-10×2 + PL-15×2)',
    codeName: 'Carrier Maritime Strike',
    role: 'asuw_strike',
    compatiblePlatformIds: ['j35_naval_stealth'],
    rcsPenaltyM2: 0.25,
    speedPenaltyKts: 55,
    mounts: [
      { mountId: 'pylon_yj12', weaponId: 'yj12_supersonic', maxAmmo: 2, reloadTimeSec: 10 },
      { mountId: 'bay_ld10', weaponId: 'ld10_arm', maxAmmo: 2, reloadTimeSec: 8 },
      { mountId: 'bay_pl15', weaponId: 'pl15_aam', maxAmmo: 2, reloadTimeSec: 6 },
    ],
    description: '反舰与反辐射复合打击挂载，专门撕裂宙斯盾防空网。',
  },
  loadout_j16d_sead_escort: {
    id: 'loadout_j16d_sead_escort',
    name: '歼-16D 伴随电子压制与反辐射猎杀挂载 (KG-800吊舱 + LD-10×6 + PL-15×2)',
    codeName: 'SEAD / Escort Jamming',
    role: 'sead_ew',
    compatiblePlatformIds: ['j16d_roaring_wolf'],
    additionalSensorIds: ['kg800_escort_jammer'],
    mounts: [
      { mountId: 'pylon_ld10', weaponId: 'ld10_arm', maxAmmo: 6, reloadTimeSec: 8 },
      { mountId: 'wing_pl15', weaponId: 'pl15_aam', maxAmmo: 2, reloadTimeSec: 8 },
    ],
    description: '全功率开启RKZ-930/KG-800电子压制走廊，同时用LD-10反辐射导弹猎杀开机的防空阵地与驱逐舰雷达。',
  },
  loadout_h6n_hypersonic_salvo: {
    id: 'loadout_h6n_hypersonic_salvo',
    name: '轰-6N 鹰击-12超音速反舰饱和齐射挂载 (YJ-12×8)',
    codeName: 'Maritime Saturation Strike',
    role: 'asuw_strike',
    compatiblePlatformIds: ['h6n_bomber'],
    mounts: [
      { mountId: 'wing_yj12', weaponId: 'yj12_supersonic', maxAmmo: 8, reloadTimeSec: 10 },
    ],
    description: '双机编队一次齐射8枚3.5马赫鹰击-12重型反舰导弹。',
  },
  loadout_j20_land_strike: {
    id: 'loadout_j20_land_strike',
    name: '歼-20A 对陆精确防区外打击挂载 (AKD-98×2 + PL-15×4)',
    codeName: 'Stealth Land Strike',
    role: 'multi_mission',
    compatiblePlatformIds: ['j20_mighty_dragon'],
    rcsPenaltyM2: 0.04,
    speedPenaltyKts: 25,
    mounts: [
      { mountId: 'bay_akd98', weaponId: 'akd98_lasm', maxAmmo: 2, reloadTimeSec: 10 },
      { mountId: 'bay_pl15', weaponId: 'pl15_aam', maxAmmo: 4, reloadTimeSec: 6 },
    ],
    description: '兼顾制空自卫与防区外隐身对陆精确突击，用于拔除敌方跑道与防空雷达枢纽。',
  },
  loadout_h6n_land_cruise: {
    id: 'loadout_h6n_land_cruise',
    name: '轰-6N 远程防区外对陆巡航导弹挂载 (AKD-98×6)',
    codeName: 'Long-Range Land Cruise',
    role: 'multi_mission',
    compatiblePlatformIds: ['h6n_bomber'],
    mounts: [
      { mountId: 'wing_akd98', weaponId: 'akd98_lasm', maxAmmo: 6, reloadTimeSec: 10 },
    ],
    description: '内陆与联合战区战略对陆精确突击挂载，一次齐射多枚防区外空地导弹。',
  },

  // --- 蓝方战机挂载方案 ---
  loadout_f35c_stealth_cap: {
    id: 'loadout_f35c_stealth_cap',
    name: 'F-35C 纯内置隐身防空截击挂载 (AIM-260×4 + AIM-120D×4)',
    codeName: 'Stealth Fleet Defense CAP',
    role: 'aaw_cap',
    compatiblePlatformIds: ['f35c_lightning'],
    rcsPenaltyM2: 0,
    mounts: [
      { mountId: 'bay_aim260', weaponId: 'aim260_jakt', maxAmmo: 4, reloadTimeSec: 7 },
      { mountId: 'bay_amraam', weaponId: 'aim120d_aam', maxAmmo: 4, reloadTimeSec: 7 },
    ],
    description: '保持0.005m²全隐身状态实施航母外围防空截击。',
  },
  loadout_f35c_land_strike: {
    id: 'loadout_f35c_land_strike',
    name: 'F-35C 隐身防区外对陆突击挂载 (JASSM-ER×2 + AIM-120D×4)',
    codeName: 'Stealth JASSM Land Strike',
    role: 'multi_mission',
    compatiblePlatformIds: ['f35c_lightning'],
    rcsPenaltyM2: 0.05,
    speedPenaltyKts: 25,
    mounts: [
      { mountId: 'pylon_jassm', weaponId: 'agm158b_jassm', maxAmmo: 2, reloadTimeSec: 10 },
      { mountId: 'bay_amraam', weaponId: 'aim120d_aam', maxAmmo: 4, reloadTimeSec: 8 },
    ],
    description: '携带AGM-158B防区外隐身巡航导弹，专用于打击敌方机场与纵深防空阵地。',
  },
  loadout_f35c_lrasm_strike: {
    id: 'loadout_f35c_lrasm_strike',
    name: 'F-35C 隐身反舰与中距自卫挂载 (LRASM×4 + AIM-120D×4)',
    codeName: 'Maritime Strike (LRASM)',
    role: 'asuw_strike',
    compatiblePlatformIds: ['f35c_lightning'],
    rcsPenaltyM2: 0.08,
    speedPenaltyKts: 35,
    mounts: [
      { mountId: 'pylon_lrasm', weaponId: 'agm158c_lrasm', maxAmmo: 4, reloadTimeSec: 12 },
      { mountId: 'bay_amraam', weaponId: 'aim120d_aam', maxAmmo: 4, reloadTimeSec: 8 },
    ],
    description: '携带4枚AGM-158C LRASM远程隐身反舰巡航导弹，可脱离数据链自主红外寻的打击水面舰艇。',
  },
  loadout_ea18g_growler_sead: {
    id: 'loadout_ea18g_growler_sead',
    name: 'EA-18G 咆哮者电子攻击与防空压制挂载 (ALQ-249吊舱 + AARGM-ER×4 + AIM-120D×2)',
    codeName: 'Growler OECM & SEAD',
    role: 'sead_ew',
    compatiblePlatformIds: ['ea18g_growler'],
    additionalSensorIds: ['alq249_ngj_jammer'],
    mounts: [
      { mountId: 'pylon_aargm', weaponId: 'agm88g_aargm', maxAmmo: 4, reloadTimeSec: 9 },
      { mountId: 'tip_amraam', weaponId: 'aim120d_aam', maxAmmo: 2, reloadTimeSec: 8 },
    ],
    description: '美航母联队电子战核心，开启NGJ有源干扰走廊并发射AGM-88G增程反辐射导弹。',
  },
};
