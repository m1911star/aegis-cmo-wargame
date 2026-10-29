import type { ScenarioDefinition } from '../types/wargame';
import { MASTER_EQUIPMENT_CATALOG } from '../catalog/equipmentCatalog';

const catalog = MASTER_EQUIPMENT_CATALOG;

export const INFORMATION_EXERCISE: ScenarioDefinition = {
  id: 'limited_information_exercise', title: '有限信息演练 // 15 分钟指挥练习',
  subtitle: 'TRAINING / OBSERVE, DECIDE, WITHDRAW', theater: '虚构演习海域', difficulty: 'STANDARD',
  startTimeIso: '2027-01-01T00:00:00Z', initialCamera: { center: [124, 25], zoom: 7 },
  briefing: {
    situation: '这是使用简化能力与有限弹药的虚构教学想定，不代表真实装备效能。开局时间静止，可先选择席位、查看主要目标和规划航线。双方各三个单元。',
    redObjective: '在 15 分钟内使蓝方演练目标丧失作战能力。保全本方支援机为次要目标，不因它的损失立即判负。',
    blueObjective: '保护演练目标保持作战能力至结束。取得红方接触信息为次要目标。',
    tacticalTips: ['选中接触查看同一套火控诊断：不可执行与有风险可以执行是两种不同结果。',
      '停止自动开火不禁止单次人工授权；风险射击会消耗真实库存，不能绕过冷却。',
      '情报中断后，导弹不会追随未观测到的机动。任务弹药或返航储备不足时飞机会撤离。',
      '速度只改变等待时间。可用相同种子重新开局，比较不同决定；结束后查看目标与事件复盘。'],
  },
  groups: [
    { id: 'exercise_red', name: '红方演练队', side: 'RED', commandTitle: 'RED', description: '三单元有限资源演练。' },
    { id: 'exercise_blue', name: '蓝方演练队', side: 'BLUE', commandTitle: 'BLUE', description: '三单元目标保护演练。' },
  ],
  customCatalogOverlay: { platforms: {
    exercise_target: { ...catalog.platforms.arleigh_burke_flt3, id: 'exercise_target', name: '演练目标平台',
      className: '训练目标', maxHp: 120, sensorIds: ['shipborne_esm'], mounts: [], defaultLoadoutId: undefined, availableLoadoutIds: [],
      description: '仅供任务目标与失能判定演练。' },
    exercise_red_scout: { ...catalog.platforms.kj500_awacs, id: 'exercise_red_scout', name: '红方演练观察机', maxFuelSec: 1100 },
    exercise_blue_scout: { ...catalog.platforms.e2d_hawkeye, id: 'exercise_blue_scout', name: '蓝方演练观察机', maxFuelSec: 1100 },
  } },
  units: [
    { id: 'exercise_red_ship', name: '红方演练舰', callsign: 'RED-ONE', side: 'RED', platformId: 'type052d_destroyer', parentGroupId: 'exercise_red',
      position: [123.45, 25], heading: 90, speedKts: 10, doctrine: { roe: 'hold', emconRadar: false } },
    { id: 'exercise_red_scout', name: '红方观察机', callsign: 'RED-EYE', side: 'RED', platformId: 'exercise_red_scout', parentGroupId: 'exercise_red',
      position: [123.4, 25.2], recoveryPosition: [122.9, 25.2], heading: 90, speedKts: 260,
      doctrine: { roe: 'hold', emconRadar: false }, assignedMissionId: 'exercise_red_observe' },
    { id: 'exercise_red_reserve', name: '红方预备舰', callsign: 'RED-TWO', side: 'RED', platformId: 'type052d_destroyer', parentGroupId: 'exercise_red',
      position: [123.35, 24.9], heading: 90, speedKts: 10, doctrine: { roe: 'tight', emconRadar: false } },
    { id: 'exercise_blue_target', name: '蓝方演练目标', callsign: 'BLUE-TARGET', side: 'BLUE', platformId: 'exercise_target', parentGroupId: 'exercise_blue',
      position: [124.65, 25], heading: 0, speedKts: 15, waypoints: [[124.65, 25.3]], doctrine: { roe: 'hold', emconRadar: false } },
    { id: 'exercise_blue_guard', name: '蓝方保护舰', callsign: 'BLUE-GUARD', side: 'BLUE', platformId: 'arleigh_burke_flt3', parentGroupId: 'exercise_blue',
      position: [124.5, 25.05], heading: 0, speedKts: 15, waypoints: [[124.5, 25.3]], doctrine: { roe: 'tight', emconRadar: true } },
    { id: 'exercise_blue_scout', name: '蓝方观察机', callsign: 'BLUE-EYE', side: 'BLUE', platformId: 'exercise_blue_scout', parentGroupId: 'exercise_blue',
      position: [124.7, 25.25], recoveryPosition: [125.2, 25.25], heading: 270, speedKts: 260,
      doctrine: { roe: 'hold', emconRadar: true }, assignedMissionId: 'exercise_blue_observe' },
  ],
  missions: [
    { id: 'exercise_red_observe', name: '红方观察区', side: 'RED', type: 'aew_support', isActive: true,
      areaPolygon: [[123.6, 25.1], [123.9, 25.1], [123.9, 25.4], [123.6, 25.4]], prosecuteOutsideAreaKm: 0, description: '仅巡逻与观察，不自动追击。' },
    { id: 'exercise_blue_observe', name: '蓝方观察区', side: 'BLUE', type: 'aew_support', isActive: true,
      areaPolygon: [[124.5, 25.1], [124.8, 25.1], [124.8, 25.4], [124.5, 25.4]], prosecuteOutsideAreaKm: 0, description: '仅巡逻与观察，不自动追击。' },
  ],
  referencePoints: [], events: [],
  victoryConditions: { durationSec: 900, tacticalVictoryThreshold: 100, decisiveVictoryThreshold: 300 },
  objectives: [
    { id: 'red_primary', side: 'RED', title: '使演练目标失能或被摧毁', type: 'disable', unitIds: ['exercise_blue_target'], required: true, points: 100 },
    { id: 'red_preserve', side: 'RED', title: '保全观察机', type: 'preserve', unitIds: ['exercise_red_scout'], required: false, points: 40 },
    { id: 'blue_primary', side: 'BLUE', title: '保护演练目标能力至结束', type: 'preserve', preserveCapability: true, unitIds: ['exercise_blue_target'], required: true, points: 100 },
    { id: 'blue_observe', side: 'BLUE', title: '取得红方演练舰接触', type: 'observe', unitIds: ['exercise_red_ship'], required: false, points: 20 },
  ],
};
