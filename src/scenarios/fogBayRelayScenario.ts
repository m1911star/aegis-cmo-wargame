import type { ScenarioDefinition } from '../types/wargame';

const handoffArea: [number, number][] = [
  [-143.966, 7.945], [-143.77, 7.945], [-143.77, 8.055], [-143.966, 8.055],
];
const handoffPoint: [number, number] = [-143.875, 8];
const landingApproach: [number, number] = [-144.12, 8];
const westAirfield: [number, number] = [-144.67, 8.13];
const islandAirfield: [number, number] = [-143.61, 8.15];

export const SCENARIO_FOG_BAY_RELAY: ScenarioDefinition = {
  id: 'op_fog_bay_relay',
  title: '《雾湾接力》 · 海陆空联合短局',
  subtitle: 'FOG BAY RELAY // LAND-AIR-SEA',
  theater: '虚构演习海域 · 雾湾群岛',
  difficulty: 'STANDARD',
  startTimeIso: '2027-10-01T06:00:00Z',
  initialCamera: { center: [-144.17, 8.02], zoom: 8.4 },
  briefing: {
    situation: '虚构岛湾联演，限时 35 分钟。双方争夺岛上的交接区：红方可用海上运输把地面分队送上岸，蓝方有先期驻守力量和一支岛内预备队。',
    redObjective: '掩护运输舰抵滩，投送地面分队，在推演结束时控制陆上交接区。压制岛上机场是次要目标。',
    blueObjective: '在推演结束时守住陆上交接区。可以在海上阻止投送，也可调动岛内预备队支援；保全机场是次要目标。',
    tacticalTips: [
      '运输舰沿默认航线进入近岸投送区时会尝试自动卸载。也可以在单位详情中查看状态，进入抵滩范围后手动卸载。',
      '舰艇和飞机可以支援，但不计入交接区控制。手动卸载后可引导地面分队驶向陆上交接点，进区后降速留驻；短暂进驻不会锁定胜利。',
      '蓝方可用东岛机场的反舰挂载支援湾口警戒舰，并将岛内预备队调往交接区。若要让守备队留守，注意自动规避和发射后转移可能让它离开目标区。',
      '时间到时，交接区无有效控制方则双方都无法达成主要目标。',
    ],
  },
  environment: {
    landPolygons: [
      {
        id: 'fog_bay_west_island', name: '雾湾西岛',
        areaPolygon: [[-144.86, 7.83], [-144.57, 7.84], [-144.52, 8.14], [-144.65, 8.25], [-144.88, 8.19]],
      },
      {
        id: 'fog_bay_east_island', name: '雾湾东岛',
        areaPolygon: [[-144, 7.84], [-143.65, 7.82], [-143.47, 7.99], [-143.54, 8.24], [-143.82, 8.25], [-144, 8.14]],
      },
    ],
    acousticZones: [],
    weather: { condition: 'overcast', seaState: 3, cloudFloorM: 1500, cloudCeilingM: 4800 },
  },
  groups: [
    { id: 'fog_red_sea', name: '红方 · 海上运输组', side: 'RED', commandTitle: 'RED SEA', description: '携带两批地面分队的运输舰及其护航舰。' },
    { id: 'fog_red_air', name: '红方 · 西岛航空组', side: 'RED', commandTitle: 'RED AIR', description: '掩护渡湾并支援陆上交接。' },
    { id: 'fog_blue_land', name: '蓝方 · 东岛守备组', side: 'BLUE', commandTitle: 'BLUE LAND', description: '交接区守备队和岛内机动预备队。' },
    { id: 'fog_blue_air', name: '蓝方 · 东岛航空组', side: 'BLUE', commandTitle: 'BLUE AIR', description: '东岛机场和湾区巡逻机。' },
    { id: 'fog_blue_sea', name: '蓝方 · 湾口警戒组', side: 'BLUE', commandTitle: 'BLUE SEA', description: '监视近岸通道的警戒舰。' },
  ],
  units: [
    {
      id: 'fog_red_transport', name: '红方两栖运输舰', callsign: 'RELAY', side: 'RED', platformId: 'type075_lhd',
      parentGroupId: 'fog_red_sea', position: [-144.22, 8], heading: 90, speedKts: 20,
      waypoints: [{ position: landingApproach, speedKts: 20 }],
      doctrine: { roe: 'tight', emconRadar: true },
    },
    {
      id: 'fog_red_escort', name: '红方运输护航舰', callsign: 'SCREEN', side: 'RED', platformId: 'type054b_frigate',
      parentGroupId: 'fog_red_sea', position: [-144.2, 8.075], heading: 90, speedKts: 20,
      waypoints: [{ position: [-144.075, 8.075], speedKts: 20 }],
      doctrine: { roe: 'free', emconRadar: true },
    },
    {
      id: 'fog_red_cover', name: '红方空中掩护分队', callsign: 'COVER', side: 'RED', platformId: 'j20_mighty_dragon',
      loadoutId: 'loadout_j20_land_strike', parentGroupId: 'fog_red_air', position: [-144.47, 8.09],
      recoveryPosition: westAirfield, altitudeM: 8500, heading: 90, speedKts: 440,
      assignedMissionId: 'fog_red_air_cover', doctrine: { roe: 'free', emconRadar: true },
    },
    {
      id: 'fog_red_eye', name: '红方湾区观察机', callsign: 'WEST-EYE', side: 'RED', platformId: 'kj500_awacs',
      parentGroupId: 'fog_red_air', position: [-144.49, 8.24], recoveryPosition: westAirfield,
      altitudeM: 8500, heading: 90, speedKts: 240, assignedMissionId: 'fog_red_aew',
      doctrine: { roe: 'hold', emconRadar: true },
    },
    {
      id: 'fog_red_airfield', name: '西岛机场', callsign: 'WEST-FIELD', side: 'RED', platformId: 'red_airbase',
      parentGroupId: 'fog_red_air', position: westAirfield, heading: 90, speedKts: 0,
      doctrine: { roe: 'tight', emconRadar: true },
    },
    {
      id: 'fog_blue_guard', name: '蓝方交接区守备队', callsign: 'CHECKPOINT', side: 'BLUE', platformId: 'blue_armor_brigade',
      parentGroupId: 'fog_blue_land', position: [-143.91, 8.02], heading: 270, speedKts: 0,
      doctrine: { roe: 'free', automaticTargetDomains: ['land', 'air'] },
    },
    {
      id: 'fog_blue_reserve', name: '蓝方岛内预备队', callsign: 'RESERVE', side: 'BLUE', platformId: 'blue_armor_brigade',
      parentGroupId: 'fog_blue_land', position: [-143.69, 7.935], heading: 270, speedKts: 0,
      doctrine: { roe: 'tight' },
    },
    {
      id: 'fog_blue_picket', name: '蓝方湾口警戒舰', callsign: 'PICKET', side: 'BLUE', platformId: 'constellation_ffg',
      parentGroupId: 'fog_blue_sea', position: [-144.08, 7.78], heading: 285, speedKts: 12,
      waypoints: [{ position: [-144.2, 7.815], speedKts: 12 }],
      doctrine: { roe: 'free', emconRadar: true, salvoSize: 3, automaticTargetDomains: ['air', 'surface'] },
    },
    {
      id: 'fog_blue_airfield', name: '东岛机场', callsign: 'EAST-FIELD', side: 'BLUE', platformId: 'blue_airbase',
      parentGroupId: 'fog_blue_air', position: islandAirfield, heading: 270, speedKts: 0,
      doctrine: { roe: 'tight', emconRadar: true },
    },
    {
      id: 'fog_blue_air_patrol', name: '蓝方湾区巡逻分队', callsign: 'BAY-PATROL', side: 'BLUE', platformId: 'f35c_lightning',
      loadoutId: 'loadout_f35c_stealth_cap', parentGroupId: 'fog_blue_air', position: [-143.91, 8.18],
      recoveryPosition: islandAirfield, altitudeM: 8200, heading: 265, speedKts: 420,
      assignedMissionId: 'fog_blue_air_cover', doctrine: { roe: 'free', emconRadar: true },
    },
  ],
  missions: [
    {
      id: 'fog_red_air_cover', name: '交接区空中支援', side: 'RED', type: 'land_strike', isActive: true,
      areaPolygon: handoffArea, prosecuteOutsideAreaKm: 0,
      description: '支援交接区内的地面分队。',
      doctrineOverride: { automaticTargetDomains: ['land', 'air'] },
    },
    {
      id: 'fog_red_aew', name: '西湾预警巡逻', side: 'RED', type: 'aew_support', isActive: true,
      areaPolygon: [[-144.5, 8.17], [-144.32, 8.17], [-144.32, 8.31], [-144.5, 8.31]],
      prosecuteOutsideAreaKm: 0, description: '用本方传感器维持接触。',
    },
    {
      id: 'fog_blue_air_cover', name: '东湾空中巡逻', side: 'BLUE', type: 'aaw_patrol', isActive: true,
      areaPolygon: [[-144.2, 7.91], [-143.75, 7.91], [-143.75, 8.23], [-144.2, 8.23]],
      prosecuteOutsideAreaKm: 20, description: '关注湾区上空的已观测接触。',
    },
  ],
  referencePoints: [
    { id: 'fog_red_rp_approach', name: '红方近岸接近点', side: 'RED', position: landingApproach, locked: true },
    { id: 'fog_red_rp_handoff', name: '陆上交接点', side: 'RED', position: handoffPoint, locked: true },
    { id: 'fog_blue_rp_handoff', name: '陆上交接点', side: 'BLUE', position: handoffPoint, locked: true },
  ],
  events: [
    {
      id: 'fog_red_landing', name: '运输舰进入近岸投送区', description: '运输舰抵近后尝试卸载剩余地面分队。',
      trigger: { type: 'UNIT_ENTERS_AREA', side: 'RED', unitCategory: 'carrier',
        areaPolygon: [[-144.15, 7.965], [-144.055, 7.965], [-144.055, 8.035], [-144.15, 8.035]] },
      actions: [{ type: 'DEPLOY_CARRIED', launcherUnitId: 'fog_red_transport', platformId: 'red_armor_brigade',
        count: 2, targetWaypoint: handoffPoint }],
    },
  ],
  victoryConditions: { durationSec: 35 * 60, tacticalVictoryThreshold: 100, decisiveVictoryThreshold: 250 },
  objectives: [
    { id: 'fog_red_handoff', side: 'RED', title: '终局控制陆上交接区', type: 'control_area',
      unitIds: [], areaPolygon: handoffArea, controlDomains: ['land'], required: true, points: 200 },
    { id: 'fog_blue_handoff', side: 'BLUE', title: '终局守住陆上交接区', type: 'control_area',
      unitIds: [], areaPolygon: handoffArea, controlDomains: ['land'], required: true, points: 200 },
    { id: 'fog_red_airfield_offline', side: 'RED', title: '使东岛机场失能（次要）', type: 'disable',
      unitIds: ['fog_blue_airfield'], required: false, points: 60 },
    { id: 'fog_blue_airfield_online', side: 'BLUE', title: '保全东岛机场作战能力（次要）', type: 'preserve', preserveCapability: true,
      unitIds: ['fog_blue_airfield'], required: false, points: 60 },
  ],
};
