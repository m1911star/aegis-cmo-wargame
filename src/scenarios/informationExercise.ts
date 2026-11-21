import { FIXED_DT_SEC } from '../engine/determinism';
import { isPointInCompiledPolygon } from '../engine/environment';
import type { ExerciseTaskCriterion } from '../engine/exerciseTask';
import type { ScenarioDefinition, SideId } from '../types/wargame';
import { MASTER_EQUIPMENT_CATALOG } from '../catalog/equipmentCatalog';

const catalog = MASTER_EQUIPMENT_CATALOG;
const redHandoff: [number, number] = [123.31, 25.32];
const blueHandoff: [number, number] = [124.70, 25];
const exerciseMinutes = 15;
const observeObjectiveId = 'red_primary';
const observe = { kind: 'observe_marker', side: 'RED', markerUnitId: 'exercise_blue_target' } as const satisfies ExerciseTaskCriterion;
const handoff = { kind: 'friendly_handoff', side: 'BLUE', objectiveId: 'blue_primary', unitId: observe.markerUnitId,
  referencePointId: 'exercise_blue_handoff' } as const satisfies ExerciseTaskCriterion;
function handoffArea([lon, lat]: [number, number], margin: number): [number, number][] {
  return [[lon - margin, lat - margin], [lon + margin, lat - margin],
    [lon + margin, lat + margin], [lon - margin, lat + margin]];
}

export const INFORMATION_EXERCISE: ScenarioDefinition = {
  id: 'limited_information_exercise', title: `有限信息演练 // ${exerciseMinutes} 分钟指挥练习`,
  subtitle: 'TRAINING / OBSERVE, DECIDE, WITHDRAW', theater: '虚构演习海域', difficulty: 'STANDARD',
  startTimeIso: '2027-01-01T00:00:00Z', initialCamera: { center: [124, 25], zoom: 7 },
  briefing: {
    situation: '虚构海上演练。红方要记录标志船的接触，蓝方要把标志船送到交接点。两个席位各按自己的任务结算，不要求交火。开局时钟暂停，可以先看目标和地图。',
    redObjective: '取得蓝方演习标志船的接触即可完成主要目标。观察机继续留场可以保持观察，前往红方交接点则退出演练并获得次要目标分。',
    blueObjective: '把蓝方演习标志船交接给终点工作人员。保持默认航线不会到达交接点。保全蓝方观察机可获得次要目标分。',
    tacticalTips: ['红方可在编制中选择 RED-EYE，调整观察机的雷达开关，推进后再比较本方接触列表。已记录的主要目标不会因观察机离场而撤销。',
      '交接点是本方地图上的参考点。先选中要交接的单位，在详情中清空原有航点，再用航路规划把新航点放到标记处。',
      '可随时暂停。完成交接后可加速等到限时结算，再用同一开局比较不同选择。'],
  },
  groups: [
    { id: 'exercise_red', name: '红方演练队', side: 'RED', commandTitle: 'RED', description: '三单元有限资源演练。' },
    { id: 'exercise_blue', name: '蓝方演练队', side: 'BLUE', commandTitle: 'BLUE', description: '标志船交接与观察机保全。' },
  ],
  customCatalogOverlay: { platforms: {
    exercise_target: { ...catalog.platforms.arleigh_burke_flt3, id: 'exercise_target', name: '演习标志船',
      className: '演习标志船', maxHp: 120, sensorIds: ['shipborne_esm'], mounts: [], defaultLoadoutId: undefined, availableLoadoutIds: [],
      description: '虚构的演练标志船，用于接触登记与终点交接。' },
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
    { id: handoff.unitId, name: '蓝方演习标志船', callsign: 'BLUE-TARGET', side: 'BLUE', platformId: 'exercise_target', parentGroupId: 'exercise_blue',
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
  referencePoints: [
    { id: 'exercise_red_handoff', side: 'RED', name: '观察机交接点', position: redHandoff, locked: true },
    { id: handoff.referencePointId, side: 'BLUE', name: '标志船交接点', position: blueHandoff, locked: true },
  ],
  events: [{ id: 'exercise_midpoint', name: '演练过半', description: '半程时提醒玩家核对目标，不揭示对方状态。',
    trigger: { type: 'TIME_ELAPSED', elapsedSec: exerciseMinutes * 30 },
    actions: [{ type: 'BROADCAST_MESSAGE', side: 'SYSTEM', severity: 'info', title: '查看本方任务进度',
      message: '时限已过一半。可暂停核对已登记的目标，决定是否调整余下航程。' }],
  }],
  victoryConditions: { durationSec: exerciseMinutes * 60, tacticalVictoryThreshold: 100, decisiveVictoryThreshold: 300 },
  objectives: [
    { id: observeObjectiveId, side: 'RED', title: '取得演习标志船的接触', type: 'observe', unitIds: [observe.markerUnitId], required: true, points: 100 },
    { id: 'red_return', side: 'RED', title: '让观察机抵达交接点', type: 'withdraw', unitIds: ['exercise_red_scout'], required: false, points: 40,
      withdrawAreaPolygon: handoffArea(redHandoff, 0.015), withdrawUnitDomains: ['air'] },
    { id: handoff.objectiveId, side: 'BLUE', title: '让标志船抵达交接点', type: 'withdraw', unitIds: [handoff.unitId], required: true, points: 100,
      withdrawAreaPolygon: handoffArea(blueHandoff, 0.009), withdrawUnitDomains: ['surface'] },
    { id: 'blue_preserve', side: 'BLUE', title: '保全观察机', type: 'preserve', unitIds: ['exercise_blue_scout'], required: false, points: 40 },
  ],
};

export function exerciseTaskOffer(scenario: ScenarioDefinition, side: SideId, objectives = scenario.objectives) {
  if (scenario.id !== INFORMATION_EXERCISE.id || !scenario.victoryConditions) return;
  const deadlineTick = Math.min(200000, Math.ceil(scenario.victoryConditions.durationSec / FIXED_DT_SEC));
  if (side === 'RED' && objectives?.some((o) => o.id === observeObjectiveId && o.side === side &&
      o.type === 'observe' && o.unitIds.length === 1 && o.unitIds[0] === observe.markerUnitId)) {
    return { criterion: observe, deadlineTick };
  }
  if (side === 'BLUE') {
    const area = objectives?.find((o) => o.id === handoff.objectiveId && o.side === side && o.type === 'withdraw' &&
      (!o.withdrawUnitDomains || o.withdrawUnitDomains.includes('surface')) && o.unitIds.length === 1 &&
      o.unitIds[0] === handoff.unitId)?.withdrawAreaPolygon;
    const point = scenario.referencePoints.find((rp) => rp.id === handoff.referencePointId && rp.side === side && rp.locked);
    if (area && point && isPointInCompiledPolygon(point.position, area)) return { criterion: handoff, deadlineTick };
  }
}
