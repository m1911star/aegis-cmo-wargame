import type {
  ScenarioDefinition,
  RuntimeUnit,
  EquipmentCatalog,
  OrbatGroup,
  ReferencePoint,
  RuntimeScenarioEvent,
  ScenarioEnvironment,
  ScenarioEventAction,
  ScenarioObjective,
  TacticalMission,
} from '../types/wargame';
import { resolveEquipmentCatalog } from '../catalog/equipmentCatalog';
import { createRuntimeUnitFromPlacement } from '../engine/simulationEngine';
import { compileScenario } from './compileScenario';
import { INFORMATION_EXERCISE } from './informationExercise';
import { SCENARIO_BASHI_CHANNEL_BLOCKADE } from './bashiChannelBlockade';
export { SCENARIO_BASHI_CHANNEL_BLOCKADE } from './bashiChannelBlockade';
import { SCENARIO_INTERACTIVE_TUTORIAL } from './tutorialScenario';
import { SCENARIO_JOINT_AMPHIBIOUS_ASSAULT } from './jointAmphibiousScenario';
import { SCENARIO_INLAND_AIR_LAND } from './inlandAirLandScenario';

// ============================================================================
// AEGIS-CMO // 内置战役想定剧本库 v2.0
// 支持：4层Loadout挂载切换、航母母舰机库(Hangar)、随机出生点散布(spawnJitterKm)、
// 以及 Trigger -> Condition -> Action 动态战役事件引擎
// ============================================================================

export const SCENARIO_EAST_SEA_THUNDER: ScenarioDefinition = {
  id: 'op_east_sea_thunder_2027',
  title: '作战想定 01 // 《东海惊雷：海空一体夺控与防空反导》',
  subtitle: 'OPERATION EAST SEA THUNDER // MULTI-DOMAIN A2/AD & CEC STRIKE',
  theater: '西太平洋 · 东海至宫古海峡海空域 (24°N-28°N, 121°E-127°E)',
  difficulty: 'STANDARD',
  startTimeIso: '2027-06-15T06:00:00Z',
  initialCamera: {
    center: [124.2, 26.2],
    zoom: 6.4,
    pitch: 0,
    bearing: 0,
  },
  briefing: {
    situation:
      '06:00 UTC，红蓝双方海空特遣群在东海防空识别区与宫古水道交汇处展开高强度多域对峙。本想定包含【多向RCS剖面】、【歼-16D/EA-18G伴随电子压制】、【超视距数据链CEC中继依赖】以及【动态战役阶段事件触发器】。',
    redObjective:
      '依托空警-500H高空数据链、歼-16D伴随电子压制与歼-20A（可切换霹雳-17猎杀预警机挂载）夺取制电磁权，掩护055型南昌舰、093B核潜艇及岸基鹰击-12B发射营重创蓝方宙斯盾驱逐舰编队与石垣岛防空阵地。',
    blueObjective:
      '发挥F-35C隐身突击群、EA-18G咆哮者电子攻击机、阿利·伯克Flight III宙斯盾舰及爱国者-3阵地的CEC协同防空网优势，拦截红方反舰导弹齐射并前出夺取海空控制权。',
    tacticalTips: [
      '【多向RCS与Loadout切换】歼-20A与F-35C机头正前方RCS仅0.004m²，侧身机动时RCS会放大30倍！可在右侧面板实时切换战机的战术挂载方案（如歼-20切换霹雳-17超远程反预警机挂载）。',
      '【电子战伴随掩护(OECM)】歼-16D与EA-18G开启有源电子干扰后，可使周围75km内友军被敌方雷达烧穿探测的距离缩水50%以上，但也会被敌方ESM被动截获方位。',
      '【动态战役事件】开战60秒或摧毁关键节点将触发参谋部动态事件与第二波次增援兵力投入战场！',
    ],
  },
  victoryConditions: {
    durationSec: 3600,
    decisiveVictoryThreshold: 350,
    tacticalVictoryThreshold: 120,
  },
  objectives: [
    {
      id: 'east_red_disable_ishigaki', side: 'RED', title: '压制石垣岛防空节点',
      type: 'disable', unitIds: ['blue_pac3_ishigaki'], required: true, points: 180,
    },
    {
      id: 'east_red_locate_aegis', side: 'RED', title: '确认蓝方宙斯盾防空舰位置',
      type: 'observe', unitIds: ['blue_ddg125_lucas'], required: false, points: 40,
    },
    {
      id: 'east_red_preserve_kj500', side: 'RED', title: '保全空警-500H预警指挥能力',
      type: 'preserve', preserveCapability: true, unitIds: ['red_kj500_eye'], required: false, points: 60,
    },
    {
      id: 'east_blue_hold_ishigaki', side: 'BLUE', title: '守住石垣岛防空节点至推演结束',
      type: 'preserve', preserveCapability: true, unitIds: ['blue_pac3_ishigaki'], required: true,
      criticalFailure: true, points: 180,
    },
    {
      id: 'east_blue_disable_h6n', side: 'BLUE', title: '使红方远程轰炸机群失能',
      type: 'disable', unitIds: ['red_h6n_strike'], required: false, points: 80,
    },
    {
      id: 'east_blue_preserve_e2d', side: 'BLUE', title: '保全E-2D预警指挥能力',
      type: 'preserve', preserveCapability: true, unitIds: ['blue_e2d_tigertail'], required: false, points: 60,
    },
    { id: 'east_red_disable_taigei', side: 'RED', title: '清除蓝方浅海AIP伏击艇', type: 'disable',
      unitIds: ['blue_taigei_ambush'], required: false, points: 80 },
    { id: 'east_blue_disable_039c', side: 'BLUE', title: '清除红方039C浅海伏击艇', type: 'disable',
      unitIds: ['red_039c_ambush'], required: false, points: 80 },
    { id: 'east_red_preserve_y9g', side: 'RED', title: '保全运-9G电子支援能力', type: 'preserve',
      preserveCapability: true, unitIds: ['red_y9g_support'], required: false, points: 50 },
    { id: 'east_blue_preserve_mq4c', side: 'BLUE', title: '保全MQ-4C海上监视链', type: 'preserve',
      preserveCapability: true, unitIds: ['blue_mq4c_isr'], required: false, points: 50 },
  ],
  environment: {
    landPolygons: [
      { id: 'east_mainland', name: '东海西侧大陆简化禁区', elevationM: 450, areaPolygon: [[119, 23], [121.5, 23], [121.5, 29], [119, 29]] },
      { id: 'ishigaki_land', name: '石垣岛简化陆地区', elevationM: 350, areaPolygon: [[124.08, 24.30], [124.25, 24.30], [124.25, 24.47], [124.08, 24.47]] },
    ],
    acousticZones: [
      { id: 'east_shallow_shelf', name: '东海大陆架浅海', kind: 'shallow', sonarRangeFactor: 0.72,
        areaPolygon: [[120, 24], [127, 24], [127, 28.5], [120, 28.5]] },
    ],
  },
  groups: [
    {
      id: 'red_air_cmd',
      name: '红方 · 东部海空联合航空兵集群',
      side: 'RED',
      commandTitle: 'CTF-East Air Wing',
      description: '歼-20A隐身制空编队、歼-16D电子战机、空警-500H预警指挥机与轰-6N远程反舰突击群。',
    },
    {
      id: 'red_surface_tg',
      name: '红方 · 101万吨大驱远海打击群',
      side: 'RED',
      commandTitle: 'TG-101 Surface Action Group',
      description: '055型南昌舰、052DL型淄博舰与水下093B型核潜艇前出编队。',
    },
    {
      id: 'red_coastal_def',
      name: '红方 · 浙闽沿海防空与岸导旅',
      side: 'RED',
      commandTitle: 'Coastal A2/AD Command',
      description: '红旗-9B远程防空反导营与鹰击-12B机动岸导突击营。',
    },
    {
      id: 'blue_csg_air',
      name: '蓝方 · 第5舰载航空联队 (CVW-5)',
      side: 'BLUE',
      commandTitle: 'CVW-5 Carrier Air Wing',
      description: 'F-35C隐身战机分队、EA-18G咆哮者电子战机、E-2D先进鹰眼预警机与P-8A海上巡逻机。',
    },
    {
      id: 'blue_desron15',
      name: '蓝方 · 第15驱逐舰中队与水下狼群',
      side: 'BLUE',
      commandTitle: 'DESRON-15 & SSN Element',
      description: '阿利·伯克级Flight III宙斯盾驱逐舰双舰编队与弗吉尼亚级核潜艇。',
    },
    {
      id: 'blue_island_chain',
      name: '蓝方 · 第一岛链西南防空反导阵地',
      side: 'BLUE',
      commandTitle: 'Ryukyu IADS Battery',
      description: '部署于先岛群岛的爱国者-3 MSE / 堤丰联合防空反导阵地。',
    },
  ],
  units: [
    // --- RED UNITS ---
    {
      id: 'red_j20_alpha',
      name: '歼-20A “龙影-01”隐身制空编队',
      callsign: 'DRAGON-01',
      side: 'RED',
      platformId: 'j20_mighty_dragon',
      loadoutId: 'loadout_j20_stealth_cap',
      parentGroupId: 'red_air_cmd',
      position: [122.75, 26.85],
      altitudeM: 12000,
      heading: 105,
      speedKts: 680,
      waypoints: [
        [123.85, 26.65],
        [124.75, 26.45],
      ],
      doctrine: {
        roe: 'free',
        emconRadar: false,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
      assignedMissionId: 'mission_red_aaw_cap',
    },
    {
      id: 'red_j16d_ew',
      name: '歼-16D “雷电-02”伴随电子战分队',
      callsign: 'ROARWOLF-02',
      side: 'RED',
      platformId: 'j16d_roaring_wolf',
      loadoutId: 'loadout_j16d_sead_escort',
      parentGroupId: 'red_air_cmd',
      position: [122.35, 26.55],
      altitudeM: 9800,
      heading: 100,
      speedKts: 560,
      waypoints: [
        [123.55, 26.35],
        [124.25, 26.2],
      ],
      doctrine: {
        roe: 'free',
        emconRadar: false,
        emconSonar: false,
        emconJamming: true, // 开启 KG-800 强电磁压制走廊
        salvoSize: 2,
      },
    },
    {
      id: 'red_kj500_eye',
      name: '空警-500H “天眼-01”预警指挥机',
      callsign: 'SKYEYE-01',
      side: 'RED',
      platformId: 'kj500_awacs',
      parentGroupId: 'red_air_cmd',
      position: [121.65, 26.95],
      altitudeM: 9200,
      heading: 90,
      speedKts: 260,
      waypoints: [
        [122.15, 27.1],
        [121.85, 26.5],
      ],
      doctrine: {
        roe: 'hold',
        emconRadar: true,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 1,
      },
    },
    {
      id: 'red_y20u_tanker',
      name: '运油-20U “长虹-01”空中加油机',
      callsign: 'RAINBOW-01',
      side: 'RED',
      platformId: 'y20u_tanker',
      parentGroupId: 'red_air_cmd',
      position: [121.9, 26.3],
      altitudeM: 8000,
      heading: 90,
      speedKts: 430,
      waypoints: [[122.4, 26.5], [122.4, 26.1]],
      assignedMissionId: 'mission_red_tanker_support',
      doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: false, salvoSize: 1 },
    },
    {
      id: 'red_y9g_support', name: '运-9G “远望-03”电子支援机', callsign: 'FAR-EYE-03',
      side: 'RED', platformId: 'y9g_jammer', loadoutId: 'loadout_y9g_esm_support', parentGroupId: 'red_air_cmd',
      position: [121.8, 27.3], altitudeM: 7600, heading: 100, speedKts: 285,
      waypoints: [[122.4, 27.2], [122.2, 26.7]], assignedMissionId: 'mission_red_ew_support',
      doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: true, salvoSize: 1 },
    },
    {
      id: 'red_j10c_reinforce', name: '歼-10C “东海-11”多用途编队', callsign: 'EASTSEA-11',
      side: 'RED', platformId: 'j10c_multirole', loadoutId: 'loadout_j10c_sead', parentGroupId: 'red_air_cmd',
      position: [122.35, 27.15], altitudeM: 10200, heading: 105, speedKts: 590,
      waypoints: [[123.4, 26.8]], assignedMissionId: 'mission_red_sead',
      doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: false, salvoSize: 2 },
    },
    {
      id: 'red_h6n_strike',
      name: '轰-6N “雷神-08”导弹轰炸机群',
      callsign: 'THUNDER-08',
      side: 'RED',
      platformId: 'h6n_bomber',
      loadoutId: 'loadout_h6n_hypersonic_salvo',
      parentGroupId: 'red_air_cmd',
      position: [121.45, 26.15],
      altitudeM: 8200,
      heading: 95,
      speedKts: 440,
      waypoints: [
        [122.65, 26.05],
        [123.35, 25.95],
      ],
      doctrine: {
        roe: 'free',
        emconRadar: false,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
    },
    {
      id: 'red_054b_screen', name: '054B型“东海-护卫”反潜外屏', callsign: 'PLANS-FFG01',
      side: 'RED', platformId: 'type054b_frigate', parentGroupId: 'red_surface_tg',
      position: [122.75, 25.55], altitudeM: 0, heading: 95, speedKts: 19,
      waypoints: [[123.45, 25.6], [124.0, 25.7]], assignedMissionId: 'mission_red_shallow_asw',
      doctrine: { roe: 'free', emconRadar: true, emconSonar: true, emconJamming: false, salvoSize: 2 },
    },
    {
      id: 'red_039c_ambush', name: '039C型AIP“浅海-01”伏击艇', callsign: 'SSK-039C-1',
      side: 'RED', platformId: 'type039c_ssk', parentGroupId: 'red_surface_tg',
      position: [123.55, 25.35], spawnJitterKm: 10, altitudeM: -65, heading: 85, speedKts: 5,
      waypoints: [[124.2, 25.5]], assignedMissionId: 'mission_red_shallow_asuw',
      doctrine: { roe: 'free', emconRadar: false, emconSonar: false, emconJamming: false, salvoSize: 2 },
    },
    {
      id: 'red_055_nanchang',
      name: '101 “南昌舰” (055型万吨驱逐舰)',
      callsign: 'PLANS-101',
      side: 'RED',
      platformId: 'type055_destroyer',
      parentGroupId: 'red_surface_tg',
      position: [123.15, 26.15],
      altitudeM: 0,
      heading: 98,
      speedKts: 24,
      waypoints: [
        [123.95, 26.05],
        [124.45, 25.95],
      ],
      doctrine: {
        roe: 'free',
        emconRadar: true,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
    },
    {
      id: 'red_052d_lhasa',
      name: '156 “淄博舰” (052DL型防空驱逐舰)',
      callsign: 'PLANS-156',
      side: 'RED',
      platformId: 'type052d_destroyer',
      parentGroupId: 'red_surface_tg',
      position: [122.95, 25.82],
      altitudeM: 0,
      heading: 92,
      speedKts: 24,
      waypoints: [
        [123.75, 25.78],
        [124.25, 25.72],
      ],
      doctrine: {
        roe: 'free',
        emconRadar: true,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
    },
    {
      id: 'red_093b_shark',
      name: '长征18号 (093B型攻击核潜艇)',
      callsign: 'SSN-418',
      side: 'RED',
      platformId: 'type093b_ssn',
      parentGroupId: 'red_surface_tg',
      position: [124.15, 25.65],
      spawnJitterKm: 12, // 开局在12km半径内随机潜伏
      altitudeM: -180,
      heading: 85,
      speedKts: 12,
      waypoints: [[124.85, 25.68]],
      doctrine: {
        roe: 'free',
        emconRadar: false,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
    },
    {
      id: 'red_hq9b_coastal',
      name: '温州沿海红旗-9B防空反导阵地',
      callsign: 'SAM-HQ9B-1',
      side: 'RED',
      platformId: 'hq9b_sam_site',
      parentGroupId: 'red_coastal_def',
      position: [121.15, 27.45],
      altitudeM: 120,
      heading: 120,
      speedKts: 0,
      doctrine: {
        roe: 'free',
        emconRadar: true,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
    },
    {
      id: 'red_yj12b_coastal',
      name: '闽东机动岸舰导弹突击1营',
      callsign: 'ASM-YJ12B-1',
      side: 'RED',
      platformId: 'yj12b_coastal_asm',
      parentGroupId: 'red_coastal_def',
      position: [120.75, 26.35],
      altitudeM: 85,
      heading: 105,
      speedKts: 0,
      doctrine: {
        roe: 'free',
        emconRadar: false,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
    },

    // --- BLUE UNITS ---
    {
      id: 'blue_f35c_viper',
      name: 'F-35C “VFA-147 Argonauts”隐身突击分队',
      callsign: 'ARGONAUT-1',
      side: 'BLUE',
      platformId: 'f35c_lightning',
      loadoutId: 'loadout_f35c_lrasm_strike',
      parentGroupId: 'blue_csg_air',
      position: [125.65, 26.55],
      altitudeM: 10800,
      heading: 275,
      speedKts: 610,
      waypoints: [
        [124.55, 26.62],
        [123.85, 26.45],
      ],
      doctrine: {
        roe: 'free',
        emconRadar: false,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
      assignedMissionId: 'mission_blue_aaw_barrier',
    },
    {
      id: 'blue_ea18g_growler1',
      name: 'EA-18G “VAQ-141 Shadowhawks”电子攻击分队',
      callsign: 'SHADOW-141',
      side: 'BLUE',
      platformId: 'ea18g_growler',
      loadoutId: 'loadout_ea18g_growler_sead',
      parentGroupId: 'blue_csg_air',
      position: [125.95, 26.32],
      altitudeM: 9600,
      heading: 275,
      speedKts: 540,
      waypoints: [[124.85, 26.35]],
      doctrine: {
        roe: 'free',
        emconRadar: false,
        emconSonar: false,
        emconJamming: true,
        salvoSize: 2,
      },
    },
    {
      id: 'blue_e2d_tigertail',
      name: 'E-2D “VAW-125 Tigertails”舰载预警机',
      callsign: 'TIGERTAIL-601',
      side: 'BLUE',
      platformId: 'e2d_hawkeye',
      parentGroupId: 'blue_csg_air',
      position: [126.45, 26.45],
      altitudeM: 8800,
      heading: 270,
      speedKts: 260,
      waypoints: [
        [126.05, 26.75],
        [126.25, 26.15],
      ],
      doctrine: {
        roe: 'hold',
        emconRadar: true,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 1,
      },
    },
    {
      id: 'blue_kc135_tanker',
      name: 'KC-135R “Shell-51”空中加油机',
      callsign: 'SHELL-51',
      side: 'BLUE',
      platformId: 'kc135_tanker',
      parentGroupId: 'blue_csg_air',
      position: [126.1, 25.9],
      altitudeM: 7800,
      heading: 270,
      speedKts: 420,
      waypoints: [[125.7, 26.1], [125.7, 25.7]],
      assignedMissionId: 'mission_blue_tanker_support',
      doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: false, salvoSize: 1 },
    },
    {
      id: 'blue_mq4c_isr', name: 'MQ-4C “TRITON-07”海上监视无人机', callsign: 'TRITON-07',
      side: 'BLUE', platformId: 'mq4c_triton', loadoutId: 'loadout_mq4c_maritime_isr', parentGroupId: 'blue_csg_air',
      position: [126.6, 27.0], altitudeM: 15000, heading: 260, speedKts: 310,
      waypoints: [[125.6, 26.7], [125.4, 25.9]], assignedMissionId: 'mission_blue_isr',
      doctrine: { roe: 'hold', emconRadar: true, emconSonar: false, emconJamming: false, salvoSize: 1 },
    },
    {
      id: 'blue_p8a_trident',
      name: 'P-8A “VP-16 War Eagles”反潜巡逻机',
      callsign: 'TRIDENT-04',
      side: 'BLUE',
      platformId: 'p8a_poseidon',
      parentGroupId: 'blue_csg_air',
      position: [125.35, 25.45],
      altitudeM: 1800,
      heading: 280,
      speedKts: 340,
      waypoints: [
        [124.45, 25.55],
        [123.95, 25.42],
      ],
      doctrine: {
        roe: 'free',
        emconRadar: true,
        emconSonar: true,
        emconJamming: false,
        salvoSize: 2,
      },
    },
    {
      id: 'blue_constellation_screen', name: 'USS Constellation 反潜防空外屏', callsign: 'USS-FFG62',
      side: 'BLUE', platformId: 'constellation_ffg', parentGroupId: 'blue_desron15',
      position: [125.15, 25.45], altitudeM: 0, heading: 275, speedKts: 19,
      waypoints: [[124.55, 25.5], [124.0, 25.6]], assignedMissionId: 'mission_blue_shallow_asw',
      doctrine: { roe: 'free', emconRadar: true, emconSonar: true, emconJamming: false, salvoSize: 2 },
    },
    {
      id: 'blue_taigei_ambush', name: '大鲸级“SEIRYU”浅海伏击艇', callsign: 'JMSDF-SSK01',
      side: 'BLUE', platformId: 'taigei_ssk', parentGroupId: 'blue_desron15',
      position: [124.75, 25.4], spawnJitterKm: 10, altitudeM: -75, heading: 270, speedKts: 5,
      waypoints: [[124.0, 25.55]], assignedMissionId: 'mission_blue_shallow_asuw',
      doctrine: { roe: 'free', emconRadar: false, emconSonar: false, emconJamming: false, salvoSize: 2 },
    },
    {
      id: 'blue_ddg125_lucas',
      name: 'USS Jack H. Lucas (DDG-125 Flight III)',
      callsign: 'USS-DDG125',
      side: 'BLUE',
      platformId: 'arleigh_burke_flt3',
      parentGroupId: 'blue_desron15',
      position: [125.45, 26.05],
      altitudeM: 0,
      heading: 275,
      speedKts: 22,
      waypoints: [
        [124.75, 26.08],
        [124.25, 26.12],
      ],
      doctrine: {
        roe: 'free',
        emconRadar: true,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
    },
    {
      id: 'blue_ddg118_inouye',
      name: 'USS Daniel Inouye (DDG-118 AEGIS)',
      callsign: 'USS-DDG118',
      side: 'BLUE',
      platformId: 'arleigh_burke_flt3',
      parentGroupId: 'blue_desron15',
      position: [125.75, 25.68],
      altitudeM: 0,
      heading: 282,
      speedKts: 22,
      waypoints: [[124.95, 25.78]],
      doctrine: {
        roe: 'free',
        emconRadar: true,
        emconSonar: true,
        emconJamming: false,
        salvoSize: 2,
      },
    },
    {
      id: 'blue_ssn792_vermont',
      name: 'USS Vermont (SSN-792 弗吉尼亚级核潜艇)',
      callsign: 'USS-SSN792',
      side: 'BLUE',
      platformId: 'virginia_ssn',
      parentGroupId: 'blue_desron15',
      position: [124.65, 25.82],
      spawnJitterKm: 15,
      altitudeM: -200,
      heading: 270,
      speedKts: 14,
      waypoints: [[123.85, 25.92]],
      doctrine: {
        roe: 'free',
        emconRadar: false,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
    },
    {
      id: 'blue_pac3_ishigaki',
      name: '石垣岛 PAC-3 MSE / 堤丰联合防空反导阵地',
      callsign: 'PAC3-ISHIGAKI',
      side: 'BLUE',
      platformId: 'patriot_pac3_site',
      parentGroupId: 'blue_island_chain',
      position: [124.16, 24.38],
      altitudeM: 180,
      heading: 330,
      speedKts: 0,
      doctrine: {
        roe: 'free',
        emconRadar: true,
        emconSonar: false,
        emconJamming: false,
        salvoSize: 2,
      },
    },
  ],
  missions: [
    {
      id: 'mission_red_aaw_cap',
      name: '东海前出制空截击巡逻区 (AAW CAP)',
      side: 'RED',
      type: 'aaw_patrol',
      isActive: true,
      areaPolygon: [
        [123.3, 27.1],
        [124.9, 27.1],
        [124.9, 26.1],
        [123.3, 26.1],
      ],
      prosecuteOutsideAreaKm: 180,
      description: '歼-20A在巡逻盒内实施电磁静默超音速巡航，自动截击进入东海核心空域的蓝方飞机。',
    },
    {
      id: 'mission_red_tanker_support',
      name: '东海西侧空中加油等待航线',
      side: 'RED',
      type: 'tanker_support',
      isActive: true,
      areaPolygon: [[122.2, 26.6], [122.6, 26.3], [122.2, 26.0]],
      prosecuteOutsideAreaKm: 0,
      stationRadiusKm: 20,
      description: '运油-20U沿固定三角航线等待同阵营受油请求。',
    },
    {
      id: 'mission_blue_tanker_support',
      name: '宫古东侧空中加油等待航线',
      side: 'BLUE',
      type: 'tanker_support',
      isActive: true,
      areaPolygon: [[125.5, 26.2], [125.9, 25.9], [125.5, 25.6]],
      prosecuteOutsideAreaKm: 0,
      stationRadiusKm: 20,
      description: 'KC-135R沿固定三角航线等待同阵营受油请求。',
    },
    {
      id: 'mission_blue_aaw_barrier',
      name: '宫古海峡防空屏障巡逻区 (BARCAP)',
      side: 'BLUE',
      type: 'aaw_patrol',
      isActive: true,
      areaPolygon: [
        [124.3, 26.95],
        [125.8, 26.95],
        [125.8, 25.9],
        [124.3, 25.9],
      ],
      prosecuteOutsideAreaKm: 160,
      description: 'F-35C双机编队前出建立防空屏障，保卫后方E-2D预警机与驱逐舰编队。',
    },
    { id: 'mission_red_ew_support', name: '红方防区外电子支援航线', side: 'RED', type: 'aew_support', isActive: true,
      areaPolygon: [[122.0, 27.4], [122.6, 27.1], [122.0, 26.7]], prosecuteOutsideAreaKm: 0,
      description: '运-9G沿西侧安全航线提供ESM交叉定位与OECM掩护。' },
    { id: 'mission_red_sead', name: '红方岛链防空压制区', side: 'RED', type: 'sead', isActive: false,
      areaPolygon: [[123.7, 24.1], [124.7, 24.1], [124.7, 24.8], [123.7, 24.8]], prosecuteOutsideAreaKm: 80,
      description: '确认岛链陆基辐射目标后，歼-10C/歼-16D实施SEAD。' },
    { id: 'mission_red_shallow_asw', name: '红方东海浅海反潜幕', side: 'RED', type: 'asw_patrol', isActive: true,
      areaPolygon: [[122.8, 25.1], [124.4, 25.1], [124.4, 26.0], [122.8, 26.0]], prosecuteOutsideAreaKm: 35,
      description: '054B与直-20F搜索浅海常规潜艇。' },
    { id: 'mission_red_shallow_asuw', name: '红方AIP浅海伏击区', side: 'RED', type: 'asuw_patrol', isActive: true,
      areaPolygon: [[123.2, 25.0], [124.5, 25.0], [124.5, 25.8], [123.2, 25.8]], prosecuteOutsideAreaKm: 50,
      description: '039C低速静音等待蓝方水面编队。' },
    { id: 'mission_blue_isr', name: '蓝方东海海上ISR航线', side: 'BLUE', type: 'aew_support', isActive: true,
      areaPolygon: [[126.0, 27.1], [125.2, 26.5], [125.3, 25.7]], prosecuteOutsideAreaKm: 0,
      description: 'MQ-4C确认红方水面高价值目标并支援B-1B。' },
    { id: 'mission_blue_shallow_asw', name: '蓝方东海浅海反潜幕', side: 'BLUE', type: 'asw_patrol', isActive: true,
      areaPolygon: [[123.8, 25.0], [125.4, 25.0], [125.4, 26.0], [123.8, 26.0]], prosecuteOutsideAreaKm: 35,
      description: '星座级、P-8A与MH-60R搜索039C。' },
    { id: 'mission_blue_shallow_asuw', name: '蓝方AIP守峡伏击区', side: 'BLUE', type: 'asuw_patrol', isActive: true,
      areaPolygon: [[123.8, 25.1], [125.0, 25.1], [125.0, 25.8], [123.8, 25.8]], prosecuteOutsideAreaKm: 50,
      description: '大鲸级低速伏击红方水面外屏。' },
  ],
  referencePoints: [
    { id: 'rp_adiz_north', name: 'RP-1 东海ADIZ北界点', side: 'RED', position: [123.5, 27.2], locked: true },
    { id: 'rp_adiz_east', name: 'RP-2 钓鱼岛北基准点', side: 'RED', position: [124.8, 26.4], locked: false },
    { id: 'rp_miyako_gate', name: 'RP-3 宫古水道西口', side: 'BLUE', position: [125.9, 25.8], locked: true },
    { id: 'rp_strike_axis', name: 'RP-4 反舰突击轴线点', side: 'RED', position: [124.1, 25.6], locked: false },
  ],
  events: [
    {
      id: 'ev_kadena_scramble_60s',
      name: '冲绳嘉手纳基地二波次紧急升空',
      description: '开战60秒后，蓝方从冲绳方向紧急起飞第二批次F-35C隐身截击分队投入东海战场。',
      trigger: {
        type: 'TIME_ELAPSED',
        elapsedSec: 60,
      },
      actions: [
        {
          type: 'BROADCAST_MESSAGE',
          side: 'SYSTEM',
          severity: 'warning',
          title: '参谋部天基红外预警通报：冲绳方向敌机紧急升空！',
          message: '侦测到蓝方嘉手纳方向起飞1批F-35C隐身战机分队(KADENA-02)正高速驰援宫古水道！',
          position: [126.8, 26.3],
        },
        {
          type: 'SPAWN_REINFORCEMENTS',
          units: [
            {
              id: 'blue_f35c_kadena_reinforce',
              name: 'F-35C “Kadena Scramble”增援分队',
              callsign: 'KADENA-02',
              side: 'BLUE',
              platformId: 'f35c_lightning',
              loadoutId: 'loadout_f35c_stealth_cap',
              parentGroupId: 'blue_csg_air',
              position: [126.85, 26.35],
              spawnJitterKm: 8,
              altitudeM: 11800,
              heading: 275,
              speedKts: 680,
              waypoints: [[124.8, 26.3]],
              doctrine: { roe: 'free', emconRadar: false, salvoSize: 2 },
              assignedMissionId: 'mission_blue_aaw_barrier',
            },
          ],
        },
      ],
    },
    {
      id: 'ev_east_asw_helo_launch_30s',
      name: '红蓝护卫舰反潜直升机起飞',
      description: '开战30秒后双方护卫舰放飞有限轻型鱼雷反潜直升机，建立浅海航空反潜幕。',
      trigger: { type: 'TIME_ELAPSED', elapsedSec: 30 },
      actions: [
        { type: 'LAUNCH_SORTIE', carrierUnitId: 'red_054b_screen', hangarSlotId: 'hangar_z20f_ffg',
          loadoutId: 'loadout_z20f_asw_prosecute', assignedMissionId: 'mission_red_shallow_asw' },
        { type: 'LAUNCH_SORTIE', carrierUnitId: 'blue_constellation_screen', hangarSlotId: 'hangar_mh60r_ffg',
          loadoutId: 'loadout_mh60r_asw_prosecute', assignedMissionId: 'mission_blue_shallow_asw' },
      ],
    },
    {
      id: 'ev_blue_mald_screen_90s',
      name: '蓝方MALD诱饵前导波次',
      description: '开战90秒后蓝方释放有限诱饵批次，先行消耗红方中近程防空库存。',
      trigger: { type: 'TIME_ELAPSED', elapsedSec: 90 },
      actions: [{ type: 'SPAWN_REINFORCEMENTS', units: [{
        id: 'blue_mald_east_wave', name: 'ADM-160 MALD 东海前导诱饵批次', callsign: 'DECOY-EAST-1',
        side: 'BLUE', platformId: 'adm160_mald', parentGroupId: 'blue_csg_air', position: [126.3, 26.0],
        altitudeM: 9000, heading: 270, speedKts: 480, waypoints: [[124.7, 26.0], [123.8, 26.0]],
        doctrine: { roe: 'hold', emconRadar: false, salvoSize: 1 },
      }] }],
    },
    {
      id: 'ev_red_sead_on_classified_land_contact',
      name: '红方确认岛链辐射目标后启动SEAD',
      description: '红方获得classified级陆地Contact后，激活SEAD任务并改派歼-10C/歼-16D。',
      trigger: { type: 'UNIT_DETECTED', observerSide: 'RED', targetDomain: 'land', minimumClassification: 'classified' },
      actions: [
        { type: 'ACTIVATE_MISSION', missionId: 'mission_red_sead', isActive: true },
        { type: 'ASSIGN_MISSION', side: 'RED', unitId: 'red_j10c_reinforce', missionId: 'mission_red_sead' },
        { type: 'ASSIGN_MISSION', side: 'RED', unitId: 'red_j16d_ew', missionId: 'mission_red_sead' },
        { type: 'BROADCAST_MESSAGE', side: 'RED', severity: 'warning', title: 'SEAD窗口已开启',
          message: '运-9G/空警数据链已提供陆地方位解，歼-10C与歼-16D转入防空压制。' },
      ],
    },
    {
      id: 'ev_b1b_maritime_salvo_180s',
      name: '蓝方远程轰炸机海上突击波次',
      description: '开战180秒后，B-1B携有限大批量LRASM从东侧进入，以加油机和ISR支援实施一次性饱和攻击。',
      trigger: { type: 'TIME_ELAPSED', elapsedSec: 180 },
      actions: [
        {
          type: 'BROADCAST_MESSAGE', side: 'SYSTEM', severity: 'critical',
          title: '远程预警：蓝方B-1B海上突击波次进入战区',
          message: '该波次携带有限LRASM库存；拦截轰炸机或破坏其目标确认链可削弱饱和攻击。',
          position: [127.4, 25.9],
        },
        {
          type: 'SPAWN_REINFORCEMENTS',
          units: [{
            id: 'blue_b1b_maritime_wave', name: 'B-1B “BONE-31”远程海上突击编队', callsign: 'BONE-31',
            side: 'BLUE', platformId: 'b1b_lancer', loadoutId: 'loadout_b1b_mass_lrasm',
            parentGroupId: 'blue_csg_air', position: [127.4, 25.9], altitudeM: 9000,
            heading: 270, speedKts: 520, waypoints: [[125.4, 26.0], [124.2, 26.0]],
            recoveryPosition: [128.2, 26.0], doctrine: { roe: 'free', emconRadar: true, salvoSize: 4 },
          }],
        },
      ],
    },
    {
      id: 'ev_ishigaki_sam_neutralized',
      name: '石垣岛防空节点被拔除奖励',
      description: '当蓝方石垣岛爱国者-3阵地被摧毁时，红方获得+200战略突破积分，且红方歼-20猎杀中队投入战斗。',
      trigger: {
        type: 'UNIT_DESTROYED',
        unitId: 'blue_pac3_ishigaki',
      },
      actions: [
        {
          type: 'AWARD_SCORE',
          side: 'RED',
          points: 200,
          reason: '成功摧毁石垣岛第一岛链防空反导阵地',
        },
        {
          type: 'BROADCAST_MESSAGE',
          side: 'RED',
          severity: 'critical',
          title: '第一岛链西南防空缺口已打开 (+200 PTS)',
          message: '石垣岛PAC-3阵地已被彻底摧毁！宫古-八重山南翼防空网瓦解。',
          position: [124.16, 24.38],
        },
      ],
    },
  ],
};

export const SCENARIO_DEEP_SEA_CARRIER_HUNT: ScenarioDefinition = {
  id: 'op_deep_sea_carrier_hunt_2028',
  title: '作战想定 02 // 《深海猎杀：福建舰与美核航母打击群大洋决战》',
  subtitle: 'OPERATION DEEP SEA SHARK // DUAL CARRIER STRIKE GROUP & ASW WARFARE',
  theater: '西太平洋 · 菲律宾海至巴士海峡东口深水区 (19°N-24°N, 121°E-128°E)',
  difficulty: 'HARD',
  startTimeIso: '2028-09-10T10:00:00Z',
  initialCamera: {
    center: [124.8, 21.6],
    zoom: 6.2,
    pitch: 0,
    bearing: 0,
  },
  briefing: {
    situation:
      '红方003型“福建舰”电磁弹射航母编队（配属105大连舰、106延安舰两艘055万吨大驱及水下093B核潜艇狼群）与蓝方CVN-73华盛顿号核动力航母打击群在菲律宾海深水区展开航母对决！双方航母均可从甲板机库(Hangar)实时配置挂载方案并弹射歼-35、歼-16D、F-35C与EA-18G机群升空作战。',
    redObjective:
      '从福建舰甲板弹射歼-35隐身舰载机与歼-16D电子战机，配合093B核潜艇狼群、055大驱鹰击-21高超音速导弹与轰-6N轰炸机群，饱和击穿蓝方标准-6防空网，重创或击沉蓝方CVN核动力航母。',
    blueObjective:
      '从CVN-73核航母放飞F-35C与EA-18G咆哮者机群，指挥P-8A反潜机与弗吉尼亚级核潜艇清剿水下093B潜艇威胁，并寻找红方福建舰实施远程LRASM隐身反舰齐射。',
    tacticalTips: [
      '【母舰甲板放飞(Hangar Operations)】点击红方“福建舰”或蓝方“CVN-73华盛顿号”，在右侧检视器底部的【母舰航空机库】中可选择制空或反舰挂载方案，一键弹射新舰载机编队升空！',
      '【超视距断链机制】鹰击-21射程1000km，但如果在导弹飞行途中己方空警-500H被击落且无前出潜艇保持接触跟踪，导弹末端命中率将大幅下降！',
    ],
  },
  victoryConditions: {
    durationSec: 5400,
    decisiveVictoryThreshold: 400,
    tacticalVictoryThreshold: 150,
  },
  objectives: [
    {
      id: 'deep_red_disable_cvn', side: 'RED', title: '使蓝方核动力航母失去作战能力',
      type: 'disable', unitIds: ['blue_cvn78_carrier'], required: true, points: 260,
    },
    {
      id: 'deep_red_preserve_fujian', side: 'RED', title: '保全福建舰作战能力',
      type: 'preserve', preserveCapability: true, unitIds: ['red_cv18_fujian'], required: false,
      criticalFailure: true, points: 120,
    },
    {
      id: 'deep_red_locate_cvn', side: 'RED', title: '取得蓝方航母可靠接触',
      type: 'observe', unitIds: ['blue_cvn78_carrier'], required: false, points: 50,
    },
    {
      id: 'deep_blue_disable_fujian', side: 'BLUE', title: '使福建舰失去作战能力',
      type: 'disable', unitIds: ['red_cv18_fujian'], required: true, points: 260,
    },
    {
      id: 'deep_blue_preserve_cvn', side: 'BLUE', title: '保全核动力航母作战能力',
      type: 'preserve', preserveCapability: true, unitIds: ['blue_cvn78_carrier'], required: false,
      criticalFailure: true, points: 120,
    },
    {
      id: 'deep_blue_disable_wolfpack', side: 'BLUE', title: '使红方核潜艇伏击群失能',
      type: 'disable', unitIds: ['red_093b_wolf1', 'red_093b_wolf2'], required: false, points: 100,
    },
  ],
  environment: {
    landPolygons: [],
    acousticZones: [
      { id: 'philippine_deep_water', name: '菲律宾海深水声学区', kind: 'deep', sonarRangeFactor: 1.12,
        areaPolygon: [[121, 19], [128.5, 19], [128.5, 24], [121, 24]] },
    ],
  },
  groups: [
    {
      id: 'red_strike_group_055',
      name: '红方 · 003福建舰与双055大驱特混编队',
      side: 'RED',
      commandTitle: 'CV-18 Fujian Carrier Strike Group',
      description: '003型福建舰电磁弹射航母旗舰与2艘055型万吨驱逐舰组成的核心打击群。',
    },
    {
      id: 'red_sub_wolfpack',
      name: '红方 · 巴士海峡深海核潜艇狼群',
      side: 'RED',
      commandTitle: 'Submarine Flotilla 2',
      description: '2艘093B型巡航导弹核潜艇设伏于巴士海峡东口深海海沟。',
    },
    {
      id: 'red_long_range_air',
      name: '红方 · 远海战略侦察与轰炸航空兵团',
      side: 'RED',
      commandTitle: 'Southern Theater Strike Wing',
      description: '空警-500H、歼-20A远航护航编队与轰-6N重型反舰导弹突击群。',
    },
    {
      id: 'blue_csg_flagship',
      name: '蓝方 · 第70特遣部队核航母打击群 (TF-70 CSG)',
      side: 'BLUE',
      commandTitle: 'Carrier Strike Group 5',
      description: 'CVN核动力航母旗舰与2艘阿利·伯克Flight III防空护卫舰。',
    },
    {
      id: 'blue_asw_screen',
      name: '蓝方 · 外围反潜与空中警戒网',
      side: 'BLUE',
      commandTitle: 'ASW & AEW Screen',
      description: 'E-2D舰载预警机、P-8A海神反潜机、F-35C舰载机与弗吉尼亚级核潜艇。',
    },
  ],
  units: [
    // --- RED ---
    {
      id: 'red_cv18_fujian',
      name: '018 “福建舰” (003型电磁弹射航母旗舰)',
      callsign: 'PLANS-CV18',
      side: 'RED',
      platformId: 'cv18_fujian_carrier',
      parentGroupId: 'red_strike_group_055',
      position: [122.05, 21.55],
      altitudeM: 0,
      heading: 95,
      speedKts: 26,
      waypoints: [[123.1, 21.5]],
      doctrine: { roe: 'free', emconRadar: true, emconSonar: false, emconJamming: true, salvoSize: 2 },
    },
    {
      id: 'red_055_dalian',
      name: '105 “大连舰” (055型万吨驱逐舰)',
      callsign: 'PLANS-105',
      side: 'RED',
      platformId: 'type055_destroyer',
      parentGroupId: 'red_strike_group_055',
      position: [122.55, 21.82],
      altitudeM: 0,
      heading: 100,
      speedKts: 26,
      waypoints: [[123.6, 21.6]],
      doctrine: { roe: 'free', emconRadar: true, emconSonar: false, salvoSize: 2 },
    },
    {
      id: 'red_055_yanan',
      name: '106 “延安舰” (055型万吨驱逐舰)',
      callsign: 'PLANS-106',
      side: 'RED',
      platformId: 'type055_destroyer',
      parentGroupId: 'red_strike_group_055',
      position: [122.45, 21.28],
      altitudeM: 0,
      heading: 95,
      speedKts: 26,
      waypoints: [[123.5, 21.25]],
      doctrine: { roe: 'free', emconRadar: false, emconSonar: false, salvoSize: 2 },
    },
    {
      id: 'red_093b_wolf1',
      name: '长征19号 (093B型核潜艇 · 北伏击位)',
      callsign: 'SSN-419',
      side: 'RED',
      platformId: 'type093b_ssn',
      parentGroupId: 'red_sub_wolfpack',
      position: [124.75, 22.05],
      spawnJitterKm: 18,
      altitudeM: -220,
      heading: 110,
      speedKts: 12,
      waypoints: [[125.6, 21.75]],
      assignedMissionId: 'mission_red_asuw_hunt',
      doctrine: { roe: 'tight', requireIdentifiedForAutoFire: true, emconRadar: false, emconSonar: false, salvoSize: 2 },
    },
    {
      id: 'red_093b_wolf2',
      name: '长征20号 (093B型核潜艇 · 南伏击位)',
      callsign: 'SSN-420',
      side: 'RED',
      platformId: 'type093b_ssn',
      parentGroupId: 'red_sub_wolfpack',
      position: [124.95, 20.95],
      spawnJitterKm: 18,
      altitudeM: -240,
      heading: 75,
      speedKts: 12,
      waypoints: [[125.8, 21.25]],
      assignedMissionId: 'mission_red_asuw_hunt',
      doctrine: { roe: 'tight', requireIdentifiedForAutoFire: true, emconRadar: false, emconSonar: false, salvoSize: 2 },
    },
    {
      id: 'red_kj500_south',
      name: '空警-500H “南海之眼”预警指挥机',
      callsign: 'SOUTH-EYE-1',
      side: 'RED',
      platformId: 'kj500_awacs',
      parentGroupId: 'red_long_range_air',
      position: [121.6, 22.3],
      altitudeM: 9400,
      heading: 115,
      speedKts: 260,
      waypoints: [[122.5, 22.0]],
      doctrine: { roe: 'hold', emconRadar: true, emconSonar: false, salvoSize: 1 },
    },
    {
      id: 'red_y20u_deep', name: '运油-20U “远海-01”前出加油机', callsign: 'OCEAN-TANKER-1',
      side: 'RED', platformId: 'y20u_tanker', parentGroupId: 'red_long_range_air',
      position: [122.0, 22.7], altitudeM: 8200, heading: 105, speedKts: 430,
      waypoints: [[123.0, 22.5], [123.0, 21.8]], assignedMissionId: 'mission_red_deep_tanker',
      doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: false, salvoSize: 1 },
    },
    {
      id: 'red_y9g_deep', name: '运-9G “远海电侦-02”支援机', callsign: 'OCEAN-ESM-2',
      side: 'RED', platformId: 'y9g_jammer', loadoutId: 'loadout_y9g_esm_support', parentGroupId: 'red_long_range_air',
      position: [121.8, 22.0], altitudeM: 7800, heading: 100, speedKts: 285,
      waypoints: [[122.8, 22.2], [122.8, 21.5]], assignedMissionId: 'mission_red_deep_ew',
      doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: true, salvoSize: 1 },
    },
    {
      id: 'red_j20_escort',
      name: '歼-20A “南天门-01”超远程猎杀预警机编队',
      callsign: 'NANTIAN-01',
      side: 'RED',
      platformId: 'j20_mighty_dragon',
      loadoutId: 'loadout_j20_awacs_hunter', // 挂载400km霹雳-17超远程空空导弹！
      parentGroupId: 'red_long_range_air',
      position: [123.1, 22.45],
      altitudeM: 12500,
      heading: 105,
      speedKts: 700,
      waypoints: [[124.8, 22.15]],
      doctrine: { roe: 'free', emconRadar: false, emconSonar: false, salvoSize: 2 },
    },
    {
      id: 'red_h6n_salvo',
      name: '轰-6N “战神-12”超音速反舰轰炸机团',
      callsign: 'MARS-12',
      side: 'RED',
      platformId: 'h6n_bomber',
      parentGroupId: 'red_long_range_air',
      position: [121.8, 21.1],
      altitudeM: 8600,
      heading: 90,
      speedKts: 450,
      waypoints: [[123.4, 21.2]],
      doctrine: { roe: 'tight', requireIdentifiedForAutoFire: true, emconRadar: false, emconSonar: false, salvoSize: 4 },
    },

    // --- BLUE ---
    {
      id: 'blue_cvn78_carrier',
      name: 'USS George Washington (CVN-73 核动力航母旗舰)',
      callsign: 'USS-CVN73',
      side: 'BLUE',
      platformId: 'cvn_carrier',
      parentGroupId: 'blue_csg_flagship',
      position: [126.45, 21.55],
      spawnJitterKm: 15,
      altitudeM: 0,
      heading: 280,
      speedKts: 26,
      waypoints: [[125.5, 21.65]],
      doctrine: { roe: 'free', emconRadar: true, emconSonar: false, emconJamming: true, salvoSize: 2 },
    },
    {
      id: 'blue_ddg_aegis_north',
      name: 'USS Chafee (DDG-90 贴身防空卫舰)',
      callsign: 'USS-DDG90',
      side: 'BLUE',
      platformId: 'arleigh_burke_flt3',
      parentGroupId: 'blue_csg_flagship',
      position: [125.95, 21.88],
      altitudeM: 0,
      heading: 280,
      speedKts: 26,
      waypoints: [[125.0, 21.92]],
      doctrine: { roe: 'free', emconRadar: true, emconSonar: true, salvoSize: 2 },
    },
    {
      id: 'blue_ddg_aegis_south',
      name: 'USS Milius (DDG-69 贴身反潜卫舰)',
      callsign: 'USS-DDG69',
      side: 'BLUE',
      platformId: 'arleigh_burke_flt3',
      parentGroupId: 'blue_csg_flagship',
      position: [125.92, 21.22],
      altitudeM: 0,
      heading: 280,
      speedKts: 26,
      waypoints: [[124.95, 21.28]],
      doctrine: { roe: 'free', emconRadar: true, emconSonar: true, salvoSize: 2 },
    },
    {
      id: 'blue_e2d_csg_eye',
      name: 'E-2D “Liberty-602”航母预警指挥机',
      callsign: 'LIBERTY-602',
      side: 'BLUE',
      platformId: 'e2d_hawkeye',
      parentGroupId: 'blue_asw_screen',
      position: [126.15, 21.65],
      altitudeM: 9000,
      heading: 275,
      speedKts: 260,
      waypoints: [[125.6, 21.8]],
      doctrine: { roe: 'hold', emconRadar: true, emconSonar: false, salvoSize: 1 },
    },
    {
      id: 'blue_kc135_deep', name: 'KC-135R “SHELL-61”前出加油机', callsign: 'SHELL-61',
      side: 'BLUE', platformId: 'kc135_tanker', parentGroupId: 'blue_asw_screen',
      position: [126.7, 22.4], altitudeM: 8000, heading: 265, speedKts: 420,
      waypoints: [[125.7, 22.4], [125.7, 21.7]], assignedMissionId: 'mission_blue_deep_tanker',
      doctrine: { roe: 'hold', emconRadar: false, emconSonar: false, emconJamming: false, salvoSize: 1 },
    },
    {
      id: 'blue_mq4c_deep', name: 'MQ-4C “TRITON-62”航母搜索无人机', callsign: 'TRITON-62',
      side: 'BLUE', platformId: 'mq4c_triton', loadoutId: 'loadout_mq4c_maritime_isr', parentGroupId: 'blue_asw_screen',
      position: [126.9, 21.9], altitudeM: 15000, heading: 260, speedKts: 310,
      waypoints: [[125.8, 22.2], [125.5, 21.3]], assignedMissionId: 'mission_blue_deep_isr',
      doctrine: { roe: 'hold', emconRadar: true, emconSonar: false, emconJamming: false, salvoSize: 1 },
    },
    {
      id: 'blue_f35c_cap',
      name: 'F-35C “Lightning-21”舰载截击编队',
      callsign: 'LIGHTNING-21',
      side: 'BLUE',
      platformId: 'f35c_lightning',
      loadoutId: 'loadout_f35c_stealth_cap',
      parentGroupId: 'blue_asw_screen',
      position: [125.4, 22.1],
      altitudeM: 11200,
      heading: 280,
      speedKts: 620,
      waypoints: [[124.2, 22.0]],
      doctrine: { roe: 'free', emconRadar: false, emconSonar: false, salvoSize: 2 },
    },
    {
      id: 'blue_p8a_asw_hunter',
      name: 'P-8A “Pelican-09”反潜猎杀巡逻机',
      callsign: 'PELICAN-09',
      side: 'BLUE',
      platformId: 'p8a_poseidon',
      parentGroupId: 'blue_asw_screen',
      position: [125.25, 21.45],
      altitudeM: 1200,
      heading: 270,
      speedKts: 330,
      waypoints: [[124.4, 21.55]],
      doctrine: { roe: 'free', emconRadar: true, emconSonar: true, salvoSize: 2 },
    },
    {
      id: 'blue_ssn_seawolf',
      name: 'USS Hawaii (SSN-776 护航核潜艇)',
      callsign: 'USS-SSN776',
      side: 'BLUE',
      platformId: 'virginia_ssn',
      parentGroupId: 'blue_asw_screen',
      position: [125.3, 21.75],
      spawnJitterKm: 15,
      altitudeM: -210,
      heading: 275,
      speedKts: 15,
      waypoints: [[124.3, 21.75]],
      doctrine: { roe: 'tight', requireIdentifiedForAutoFire: true, emconRadar: false, emconSonar: false, salvoSize: 2 },
    },
  ],
  missions: [
    {
      id: 'mission_red_asuw_hunt',
      name: '菲律宾海远程反舰猎杀区 (ASuW Hunt)',
      side: 'RED',
      type: 'asuw_patrol',
      isActive: true,
      areaPolygon: [
        [124.4, 22.3],
        [126.8, 22.3],
        [126.8, 20.8],
        [124.4, 20.8],
      ],
      prosecuteOutsideAreaKm: 200,
      description: '093B核潜艇狼群与确认后的舰载反舰波次共同猎杀蓝方航母。',
    },
    { id: 'mission_red_deep_cap', name: '福建舰前出舰队防空区', side: 'RED', type: 'aaw_patrol', isActive: true,
      areaPolygon: [[123.0, 22.7], [124.6, 22.7], [124.6, 21.3], [123.0, 21.3]], prosecuteOutsideAreaKm: 120,
      description: '歼-35隐身制空与歼-15T重载CAP分层保护福建舰。' },
    { id: 'mission_blue_deep_cap', name: 'CVN前出舰队防空区', side: 'BLUE', type: 'aaw_patrol', isActive: true,
      areaPolygon: [[124.4, 22.7], [126.2, 22.7], [126.2, 21.2], [124.4, 21.2]], prosecuteOutsideAreaKm: 120,
      description: 'F-35C隐身制空与F/A-18E/F重载CAP分层保护CVN。' },
    { id: 'mission_blue_deep_strike', name: '蓝方菲律宾海反舰猎杀区', side: 'BLUE', type: 'asuw_patrol', isActive: false,
      areaPolygon: [[121.8, 22.5], [124.5, 22.5], [124.5, 20.8], [121.8, 20.8]], prosecuteOutsideAreaKm: 180,
      description: '确认福建舰后由F/A-18E/F与F-35C实施LRASM波次。' },
    { id: 'mission_red_deep_tanker', name: '红方远海加油等待航线', side: 'RED', type: 'tanker_support', isActive: false,
      areaPolygon: [[122.4, 22.7], [123.2, 22.3], [122.6, 21.7]], prosecuteOutsideAreaKm: 0, stationRadiusKm: 20,
      description: '运油-20U为舰载/岸基波次提供有限燃油。' },
    { id: 'mission_blue_deep_tanker', name: '蓝方远海加油等待航线', side: 'BLUE', type: 'tanker_support', isActive: false,
      areaPolygon: [[126.2, 22.6], [125.4, 22.2], [126.0, 21.6]], prosecuteOutsideAreaKm: 0, stationRadiusKm: 20,
      description: 'KC-135为舰载打击波次提供有限燃油。' },
    { id: 'mission_red_deep_ew', name: '红方远海电子支援航线', side: 'RED', type: 'aew_support', isActive: true,
      areaPolygon: [[122.1, 22.5], [123.0, 22.1], [122.2, 21.5]], prosecuteOutsideAreaKm: 0,
      description: '运-9G提供ESM方位走廊和OECM掩护。' },
    { id: 'mission_blue_deep_isr', name: '蓝方航母搜索ISR航线', side: 'BLUE', type: 'aew_support', isActive: true,
      areaPolygon: [[126.3, 22.6], [125.2, 22.2], [125.4, 21.2]], prosecuteOutsideAreaKm: 0,
      description: 'MQ-4C在发起满挂载波次前确认红方航母Contact。' },
  ],
  referencePoints: [
    { id: 'rp_bashi_east', name: 'RP-1 巴士海峡东出口', side: 'RED', position: [123.2, 21.5], locked: true },
    { id: 'rp_bashi_north', name: 'RP-2 巴士北翼伏击点', side: 'RED', position: [124.5, 22.2], locked: false },
    { id: 'rp_bashi_south', name: 'RP-3 巴士南翼伏击点', side: 'RED', position: [124.5, 20.9], locked: false },
    { id: 'rp_csg_pim', name: 'RP-4 航母预想机动中心 (PIM)', side: 'BLUE', position: [125.8, 21.6], locked: false },
    { id: 'rp_csg_north', name: 'RP-5 航母北翼防空点', side: 'BLUE', position: [125.3, 22.1], locked: false },
    { id: 'rp_csg_south', name: 'RP-6 航母南翼反潜点', side: 'BLUE', position: [125.3, 21.1], locked: false },
  ],
  events: [
    {
      id: 'ev_red_classified_blue_cvn',
      name: '红方获得蓝方航母classified级接触',
      description: '仅在航母Contact达到classified后激活加油机前出，尚不发起满挂载波次。',
      trigger: { type: 'UNIT_DETECTED', observerSide: 'RED', targetUnitId: 'blue_cvn78_carrier',
        targetDomain: 'surface', minimumClassification: 'classified' },
      actions: [
        { type: 'ACTIVATE_MISSION', missionId: 'mission_red_deep_tanker', isActive: true },
        { type: 'ASSIGN_MISSION', side: 'RED', unitId: 'red_y20u_deep', missionId: 'mission_red_deep_tanker' },
        { type: 'BROADCAST_MESSAGE', side: 'RED', severity: 'warning', title: '疑似航母接触：加油机前出',
          message: '维持ISR/ESM确认，暂不消耗满挂载舰载打击波次。' },
      ],
    },
    {
      id: 'ev_blue_classified_red_cv18',
      name: '蓝方获得福建舰classified级接触',
      description: '仅在福建舰Contact达到classified后激活加油机前出。',
      trigger: { type: 'UNIT_DETECTED', observerSide: 'BLUE', targetUnitId: 'red_cv18_fujian',
        targetDomain: 'surface', minimumClassification: 'classified' },
      actions: [
        { type: 'ACTIVATE_MISSION', missionId: 'mission_blue_deep_tanker', isActive: true },
        { type: 'ASSIGN_MISSION', side: 'BLUE', unitId: 'blue_kc135_deep', missionId: 'mission_blue_deep_tanker' },
        { type: 'BROADCAST_MESSAGE', side: 'BLUE', severity: 'warning', title: '疑似航母接触：加油机前出',
          message: 'MQ-4C/E-2D继续确认，打击波次保持甲板待命。' },
      ],
    },
    {
      id: 'ev_carrier_detected_salvo_order',
      name: '发现蓝方CVN核航母触发全军总攻指令',
      description: '蓝方CVN Contact达到identified后，红方创建隐身、重载和电子伴随分波次出动订单。',
      trigger: {
        type: 'UNIT_DETECTED',
        observerSide: 'RED',
        targetUnitId: 'blue_cvn78_carrier',
        targetDomain: 'surface',
        minimumClassification: 'identified',
      },
      actions: [
        {
          type: 'AWARD_SCORE',
          side: 'RED',
          points: 100,
          reason: '率先侦知并锁定敌方高价值核航母旗舰(HVU)',
        },
        {
          type: 'BROADCAST_MESSAGE',
          side: 'RED',
          severity: 'critical',
          title: '高价值目标锁定：发现美军CVN-73核动力航母旗舰！ (+100 PTS)',
          message: '全军综合数据链已分发蓝方核航母坐标，请立即组织055大驱鹰击-21与福建舰歼-35机群实施饱和打击！',
          position: [126.45, 21.55],
        },
        {
          type: 'LAUNCH_SORTIE',
          carrierUnitId: 'red_cv18_fujian',
          hangarSlotId: 'hangar_j35_vf1',
          loadoutId: 'loadout_j35_maritime_strike',
          assignedMissionId: 'mission_red_asuw_hunt',
        },
        {
          type: 'LAUNCH_SORTIE', carrierUnitId: 'red_cv18_fujian', hangarSlotId: 'hangar_j15t_multirole',
          loadoutId: 'loadout_j15t_maritime_strike', assignedMissionId: 'mission_red_asuw_hunt', launchDelaySec: 10,
        },
        {
          type: 'LAUNCH_SORTIE', carrierUnitId: 'red_cv18_fujian', hangarSlotId: 'hangar_j15d_ew',
          loadoutId: 'loadout_j16d_sead_escort', assignedMissionId: 'mission_red_asuw_hunt', launchDelaySec: 20,
        },
        {
          type: 'ASSIGN_MISSION',
          side: 'RED',
          unitId: 'red_h6n_salvo',
          missionId: 'mission_red_asuw_hunt',
        },
        {
          type: 'COORDINATE_ATTACK',
          side: 'RED',
          groupId: 'red_strike_group_055',
          targetDomain: 'surface',
          delaySec: 10,
        },
      ],
    },
    {
      id: 'ev_blue_identified_red_cv18',
      name: '蓝方确认福建舰并发起满挂载波次',
      description: '福建舰Contact达到identified后，激活反舰任务并创建F-35C、F/A-18E/F、EA-18G分波次订单。',
      trigger: { type: 'UNIT_DETECTED', observerSide: 'BLUE', targetUnitId: 'red_cv18_fujian',
        targetDomain: 'surface', minimumClassification: 'identified' },
      actions: [
        { type: 'ACTIVATE_MISSION', missionId: 'mission_blue_deep_strike', isActive: true },
        { type: 'LAUNCH_SORTIE', carrierUnitId: 'blue_cvn78_carrier', hangarSlotId: 'hangar_vfa_f35c',
          loadoutId: 'loadout_f35c_lrasm_strike', assignedMissionId: 'mission_blue_deep_strike' },
        { type: 'LAUNCH_SORTIE', carrierUnitId: 'blue_cvn78_carrier', hangarSlotId: 'hangar_vfa_fa18ef',
          loadoutId: 'loadout_fa18ef_lrasm_strike', assignedMissionId: 'mission_blue_deep_strike', launchDelaySec: 10 },
        { type: 'LAUNCH_SORTIE', carrierUnitId: 'blue_cvn78_carrier', hangarSlotId: 'hangar_vaq_growler',
          loadoutId: 'loadout_ea18g_growler_sead', assignedMissionId: 'mission_blue_deep_strike', launchDelaySec: 20 },
        { type: 'COORDINATE_ATTACK', side: 'BLUE', groupId: 'blue_csg_flagship', targetDomain: 'surface', delaySec: 25 },
        { type: 'BROADCAST_MESSAGE', side: 'BLUE', severity: 'critical', title: '福建舰确认：满挂载波次出动',
          message: '隐身制空、多用途重锤和电子伴随按10秒间隔进入待执行队列。' },
      ],
    },
    {
      id: 'ev_red_csg_blink_emcon',
      name: '红方航母编队间歇雷达开机',
      description: '开战30秒后每30秒切换一次航母打击群雷达状态，形成确定性的Blink EMCON节奏。',
      repeatable: true,
      repeatIntervalSec: 30,
      trigger: { type: 'TIME_ELAPSED', elapsedSec: 30 },
      actions: [
        {
          type: 'TOGGLE_SIDE_EMCON',
          side: 'RED',
          groupId: 'red_strike_group_055',
          sensor: 'radar',
        },
      ],
    },
  ],
};

export const BUILTIN_SCENARIOS: ScenarioDefinition[] = [
  SCENARIO_EAST_SEA_THUNDER,
  SCENARIO_DEEP_SEA_CARRIER_HUNT,
  SCENARIO_BASHI_CHANNEL_BLOCKADE,
  SCENARIO_JOINT_AMPHIBIOUS_ASSAULT,
  SCENARIO_INLAND_AIR_LAND,
  INFORMATION_EXERCISE,
  SCENARIO_INTERACTIVE_TUTORIAL,
];

/**
 * 将静态 ScenarioDefinition + EquipmentCatalog 实例化为运行时字典
 * @param rng 可选随机数生成器（默认 0.5 中点采样；随机开局必须显式传入序列化 PRNG）
 */
export function instantiateScenarioUnits(
  scenario: ScenarioDefinition,
  catalog: EquipmentCatalog = resolveEquipmentCatalog(scenario.customCatalogOverlay),
  rng: () => number = () => 0.5
): Record<string, RuntimeUnit> {
  const compiled = compileScenario(scenario, catalog);
  const runtimeUnits: Record<string, RuntimeUnit> = {};

  for (const placement of compiled.scenario.units) {
    if (
      placement.appearProbability !== undefined &&
      rng() >= placement.appearProbability
    ) {
      continue;
    }
    runtimeUnits[placement.id] = createRuntimeUnitFromPlacement(
      placement,
      catalog,
      rng
    );
  }

  return runtimeUnits;
}

/**
 * 校验并反序列化外部导入的想定 JSON
 */
export function validateAndParseScenarioJson(jsonText: string): {
  valid: boolean;
  scenario?: ScenarioDefinition;
  error?: string;
} {
  try {
    return { valid: true, scenario: compileScenario(JSON.parse(jsonText)).scenario };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'JSON 解析失败',
    };
  }
}

/**
 * 将当前运行时的战场状态导出为可复用的 ScenarioDefinition JSON 字符串
 */
export function exportCurrentStateAsScenarioJson(
  baseScenario: ScenarioDefinition,
  currentUnits: Record<string, RuntimeUnit>,
  runtime?: {
    groups?: OrbatGroup[];
    missions?: TacticalMission[];
    events?: RuntimeScenarioEvent[];
    objectives?: ScenarioObjective[];
    referencePoints?: ReferencePoint[];
    environment?: ScenarioEnvironment;
  }
): string {
  const exported: ScenarioDefinition = {
    ...structuredClone(baseScenario),
    groups: structuredClone(runtime?.groups ?? baseScenario.groups),
    missions: structuredClone(runtime?.missions ?? baseScenario.missions),
    events: structuredClone(runtime?.events ?? baseScenario.events),
    objectives: structuredClone(runtime?.objectives ?? baseScenario.objectives),
    referencePoints: structuredClone(runtime?.referencePoints ?? baseScenario.referencePoints),
    environment: structuredClone(runtime?.environment ?? baseScenario.environment),
    id: `${baseScenario.id}_custom_${Date.now().toString(36)}`,
    units: Object.values(currentUnits)
      .filter((u) => u.hp > 0 && u.status !== 'destroyed' && u.status !== 'recovered')
      .map((u) => ({
        id: u.id,
        name: u.name,
        callsign: u.callsign,
        side: u.side,
        platformId: u.platformId,
        loadoutId: u.activeLoadoutId,
        parentGroupId: u.parentGroupId,
        position: [...u.position],
        altitudeM: u.altitudeM,
        heading: Math.round(u.heading),
        speedKts: u.speedKts,
        waypoints: u.waypoints.map((waypoint) => ({
          ...waypoint,
          position: [...waypoint.position] as [number, number],
        })),
        doctrine: { ...u.doctrine },
        assignedMissionId: u.assignedMissionId,
        recoveryPosition: u.recoveryPosition,
      })),
  };
  exported.missions = exported.missions.map(({ assignedUnitIds: _legacy, ...mission }) => mission);
  exported.events = exported.events?.map((event) => {
    const { hasFired: _hasFired, fireCount: _fireCount, matchedUnitIds: _matched, ...definition } = event as RuntimeScenarioEvent;
    return definition;
  });
  const knownIds = new Set([
    ...exported.units.map((unit) => unit.id),
    ...(exported.events ?? []).flatMap((event) => event.actions.flatMap((action) =>
      action.type === 'SPAWN_REINFORCEMENTS' ? action.units.map((unit) => unit.id) : []
    )),
  ]);
  for (const event of exported.events ?? []) {
    event.actions = event.actions.flatMap<ScenarioEventAction>((action) => {
      if (action.type !== 'SPAWN_REINFORCEMENTS') return [action];
      const units = action.units.flatMap((placement) => {
        if (!Object.hasOwn(currentUnits, placement.id)) return [placement];
        if (!event.repeatable) return [];
        let id = `${placement.id}__future`;
        while (knownIds.has(id)) id += '_next';
        knownIds.add(id);
        return [{ ...placement, id }];
      });
      return units.length ? [{ ...action, units }] : [];
    });
  }
  const retainedIds = new Set([
    ...exported.units.map((unit) => unit.id),
    ...(exported.events ?? []).flatMap((event) => event.actions.flatMap((action) =>
      action.type === 'SPAWN_REINFORCEMENTS' ? action.units.map((unit) => unit.id) : []
    )),
  ]);
  exported.events = exported.events?.filter((event) => {
    const trigger = event.trigger;
    const targetId = trigger.type === 'UNIT_DESTROYED' ? trigger.unitId
      : trigger.type === 'UNIT_DETECTED' ? trigger.targetUnitId : undefined;
    return event.actions.length > 0 && (!targetId || retainedIds.has(targetId));
  });
  exported.objectives = exported.objectives?.filter((objective) => objective.unitIds.every((id) => retainedIds.has(id)));
  if (exported.victoryConditions?.keyTargetBonuses) {
    exported.victoryConditions.keyTargetBonuses = exported.victoryConditions.keyTargetBonuses.filter(
      (bonus) => !bonus.unitId || retainedIds.has(bonus.unitId)
    );
  }
  return JSON.stringify(exported, null, 2);
}
