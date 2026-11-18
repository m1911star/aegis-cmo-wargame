import type { BattleResult, EquipmentCatalog, RuntimeUnit, ScenarioDefinition, SideId } from '../types/wargame';
import { SCENARIO_BASHI_CHANNEL_BLOCKADE } from './bashiChannelBlockade';
import { compileScenario } from './compileScenario';
import {
  SCENARIO_DEEP_SEA_CARRIER_HUNT,
  SCENARIO_EAST_SEA_THUNDER,
} from './builtinScenarios';
import { INFORMATION_EXERCISE } from './informationExercise';
import { SCENARIO_JOINT_AMPHIBIOUS_ASSAULT } from './jointAmphibiousScenario';

export const SCARCE_THEATER_WEAPONS = [
  'yj21_hypersonic',
  'aim174b_ulraam',
  'pl17_ulraam',
  'agm158c_lrasm',
  'agm158b_jassm',
  'akd98_lasm',
  'bgm109_tlahm',
  'yj12_supersonic',
] as const;

const CAPITAL_CARRYOVER_CATEGORIES = new Set([
  'carrier',
  'amphibious',
  'destroyer',
  'frigate',
  'ssn',
  'awacs',
  'ew_aircraft',
]);

export interface CampaignStageDefinition {
  stageIndex: number;
  scenarioId: string;
  title: string;
  summary: string;
}

export interface CampaignDefinition {
  id: string;
  title: string;
  description: string;
  stages: CampaignStageDefinition[];
}

export type CampaignResupplyChoice =
  | 'balanced'
  | 'munitions'
  | 'airframes'
  | 'hull_repair'
  | 'base_repair';

export interface CampaignResupplyOption {
  id: CampaignResupplyChoice;
  title: string;
  cost: number;
  summary: string;
  tradeoff: string;
}

export const INITIAL_CAMPAIGN_SUPPLY_POINTS = 100;
export const MAX_CAMPAIGN_SUPPLY_POINTS = 300;
export const MIN_AIRBASE_INTEGRITY_PCT = 25;

export const CAMPAIGN_RESUPPLY_OPTIONS: readonly CampaignResupplyOption[] = [
  {
    id: 'balanced',
    title: '均衡补给',
    cost: 25,
    summary: '战损、机库、弹药与跑道适度恢复',
    tradeoff: '消耗 25 SP · 各领域均衡恢复，但单项无法深度补满',
  },
  {
    id: 'munitions',
    title: '弹药优先',
    cost: 40,
    summary: '大幅补充垂发与防区外稀缺弹药',
    tradeoff: '消耗 40 SP · 清减 80% 稀缺弹药缺口，不修复舰体与机场',
  },
  {
    id: 'airframes',
    title: '航空兵优先',
    cost: 40,
    summary: '优先补充舰载/岸基战机架数',
    tradeoff: '消耗 40 SP · 清减 75% 机库战损并略微恢复机场与战备',
  },
  {
    id: 'hull_repair',
    title: '抢修优先',
    cost: 45,
    summary: '大幅修复主力舰体战损并提升战备',
    tradeoff: '消耗 45 SP · 修复 70% 主力战损，不补充战机与稀缺弹药',
  },
  {
    id: 'base_repair',
    title: '基地抢修',
    cost: 35,
    summary: '重点抢修前线机场跑道与保障设施',
    tradeoff: '消耗 35 SP · 机场完好度 +25% 并恢复 1 架维护机体',
  },
] as const;

export interface CampaignCarryover {
  completedStages: number;
  cumulativeScore: number;
  readinessMultiplier: number;
  supplyPoints: number;
  airbaseIntegrityPct: number;
  victoryCount: number;
  costlyVictoryCount: number;
  defeatCount: number;
  airframeAttritionDebt: number;
  platformDamageDebt: Record<string, number>;
  scarceAmmoDebt: Record<string, number>;
  lastOutcome?: BattleResult['outcomes']['RED'];
  lastResupplyChoice?: CampaignResupplyChoice;
  stageModifiers: string[];
  notes: string[];
}

export interface CampaignStageStart {
  playerSide: 'RED' | 'BLUE';
  carryover: CampaignCarryover;
}

export interface CampaignState {
  campaignId: string;
  title: string;
  playerSide: 'RED' | 'BLUE';
  currentStageIndex: number;
  totalStages: number;
  finished: boolean;
  supplyPoints: number;
  airbaseIntegrityPct: number;
  stageModifiers: string[];
  carryover: CampaignCarryover;
}

export const BUILTIN_CAMPAIGN_WESTPAC: CampaignDefinition = {
  id: 'westpac_joint_campaign',
  title: '西太联合行动战役（五阶段连贯）',
  description: '从前沿有限信息侦察、东海海空夺控、巴士海峡封锁、海陆空联合登岛到深海双航母决战的五阶段连贯战役；主力舰战损、机库架次损耗与稀缺防区外弹药消耗将跨阶段继承。',
  stages: [
    {
      stageIndex: 0,
      scenarioId: INFORMATION_EXERCISE.id,
      title: '第一阶段：前沿侦察与有限信息演练',
      summary: '在严苛电磁静默与有限资源下夺取情报并保全侦察力量。',
    },
    {
      stageIndex: 1,
      scenarioId: SCENARIO_EAST_SEA_THUNDER.id,
      title: '第二阶段：东海惊雷（海空夺控）',
      summary: '依托电子战与反舰导弹压制第一岛链节点与宙斯盾防空网。',
    },
    {
      stageIndex: 2,
      scenarioId: SCENARIO_BASHI_CHANNEL_BLOCKADE.id,
      title: '第三阶段：巴士海峡封锁（两栖护航与反潜）',
      summary: '掩护两栖核心穿越浅深海交界水道并猎杀敌潜艇伏击幕。',
    },
    {
      stageIndex: 3,
      scenarioId: SCENARIO_JOINT_AMPHIBIOUS_ASSAULT.id,
      title: '第四阶段：联合登岛（海陆空立体夺控）',
      summary: '压制岛屿前线机场跑道并护送两栖编队抵滩卸载抢占滩头。',
    },
    {
      stageIndex: 4,
      scenarioId: SCENARIO_DEEP_SEA_CARRIER_HUNT.id,
      title: '第五阶段：深海猎杀（航母特混决战）',
      summary: '围绕双航母打击群与水下狼群展开最终远洋决胜。',
    },
  ],
};

export function deriveCampaignStageModifiers(carryover: CampaignCarryover): string[] {
  if (carryover.completedStages <= 0) {
    return ['首阶段满编出击：全军 100% 初始战备，前沿机场完好，后勤补给充沛'];
  }

  const modifiers: string[] = [];
  const supplyPoints = carryover.supplyPoints ?? INITIAL_CAMPAIGN_SUPPLY_POINTS;
  const airbaseIntegrityPct = carryover.airbaseIntegrityPct ?? 100;

  if (carryover.lastOutcome === 'victory') {
    modifiers.push('连胜态势加成：获前沿卫星 ISR 侦察通道与联指先期支援积分 (+50)');
  } else if (carryover.lastOutcome === 'costly_victory') {
    modifiers.push('高战损警示：上阶段付出较大战损，前线舰机整备与防空警戒承压');
  } else if (carryover.lastOutcome === 'draw') {
    modifiers.push('战局胶着警戒：敌方提升主动雷达巡逻与态势警戒级别');
  } else if (carryover.lastOutcome === 'defeat') {
    modifiers.push('失利高压态势：敌方全面进入最高自由交战警戒 (ROE FREE)');
  }

  if (airbaseIntegrityPct < 65) {
    modifiers.push(`前线机场重创 (${airbaseIntegrityPct}%)：跑道与机库出动周转大幅延缓`);
  } else if (airbaseIntegrityPct < 85) {
    modifiers.push(`前线机场受损 (${airbaseIntegrityPct}%)：航母/机场机体整备冷却延长`);
  } else if (airbaseIntegrityPct >= 95 && carryover.lastOutcome === 'victory') {
    modifiers.push(`航空基地完好 (${airbaseIntegrityPct}%)：前线波次整备效率提升 10%`);
  }

  if (supplyPoints >= 150) {
    modifiers.push(`战区补给充裕 (${supplyPoints} SP)：可支撑连续高强度防区外精确打击`);
  } else if (supplyPoints < 40) {
    modifiers.push(`战区补给紧张 (${supplyPoints} SP)：后续战间整备将受配额约束`);
  }

  if (carryover.readinessMultiplier < 0.95) {
    modifiers.push(
      `编队战备折损 (${Math.round(carryover.readinessMultiplier * 100)}%)：前出机动巡航节奏受限`
    );
  }

  return modifiers.length > 0 ? modifiers : ['战区态势平稳：按标准战备展开本阶段行动'];
}

export function createInitialCampaignState(
  campaign: CampaignDefinition = BUILTIN_CAMPAIGN_WESTPAC,
  playerSide: SideId = 'RED'
): CampaignState {
  const initialCarryover: CampaignCarryover = {
    completedStages: 0,
    cumulativeScore: 0,
    readinessMultiplier: 1,
    supplyPoints: INITIAL_CAMPAIGN_SUPPLY_POINTS,
    airbaseIntegrityPct: 100,
    victoryCount: 0,
    costlyVictoryCount: 0,
    defeatCount: 0,
    airframeAttritionDebt: 0,
    platformDamageDebt: {},
    scarceAmmoDebt: {},
    stageModifiers: [],
    notes: [],
  };
  initialCarryover.stageModifiers = deriveCampaignStageModifiers(initialCarryover);

  return {
    campaignId: campaign.id,
    title: campaign.title,
    playerSide: playerSide === 'BLUE' ? 'BLUE' : 'RED',
    currentStageIndex: 0,
    totalStages: campaign.stages.length,
    finished: false,
    supplyPoints: initialCarryover.supplyPoints,
    airbaseIntegrityPct: initialCarryover.airbaseIntegrityPct,
    stageModifiers: [...initialCarryover.stageModifiers],
    carryover: initialCarryover,
  };
}

/**
 * Pure deterministic stage scenario builder that carries readiness, supply/airbase status,
 * and outcome-driven tactical modifiers from the previous stage while keeping the compiled scenario valid.
 */
export function buildCampaignStageScenario(
  baseScenario: ScenarioDefinition,
  carryover: CampaignCarryover,
  playerSide: 'RED' | 'BLUE',
  stageIndex: number
): ScenarioDefinition {
  const scenario = structuredClone(baseScenario);
  const readinessPct = Math.round(carryover.readinessMultiplier * 100);
  const supplyPoints = carryover.supplyPoints ?? INITIAL_CAMPAIGN_SUPPLY_POINTS;
  const airbaseIntegrityPct = carryover.airbaseIntegrityPct ?? 100;
  const stageModifiers = deriveCampaignStageModifiers(carryover);

  const noteText = carryover.completedStages > 0
    ? `【战役继承】已完成 ${carryover.completedStages} 阶段 · 累计战役积分 ${carryover.cumulativeScore} · 战备 ${readinessPct}% · 补给 ${supplyPoints} SP · 机场完好度 ${airbaseIntegrityPct}%（${carryover.notes.slice(-2).join('；')}）。\n【本阶段态势修正】${stageModifiers.join('；')}。`
    : '【战役首阶段】全军处于 100% 满编战备状态 · 战区补给 100 SP · 机场完好度 100%。';

  scenario.id = `${baseScenario.id}__campaign_s${stageIndex + 1}`;
  scenario.title = `[战役第${stageIndex + 1}阶段] ${baseScenario.title}`;
  scenario.briefing = {
    ...scenario.briefing,
    situation: `${noteText}\n\n${scenario.briefing.situation}`,
  };

  if (carryover.readinessMultiplier < 0.95) {
    // Slightly reduce starting cruise speed readiness without breaking catalog maxSpeedKts constraints.
    scenario.units = scenario.units.map((placement) => {
      if (placement.side !== playerSide) return placement;
      if (placement.speedKts && placement.speedKts > 20) {
        return {
          ...placement,
          speedKts: Math.max(10, Math.round(placement.speedKts * carryover.readinessMultiplier)),
        };
      }
      return placement;
    });
  }

  if (carryover.completedStages > 0) {
    const existingEvents = [...(scenario.events ?? [])];
    const injectedEvents: NonNullable<ScenarioDefinition['events']> = [];
    const opforSide: 'RED' | 'BLUE' = playerSide === 'RED' ? 'BLUE' : 'RED';

    if (carryover.lastOutcome === 'victory') {
      // Grant forward ISR satellite pass over the theater + early command score & briefing notice
      const [cLon, cLat] = scenario.initialCamera.center;
      const swathPolygon: [number, number][] = [
        [Number((cLon - 1.5).toFixed(3)), Number((cLat - 1.2).toFixed(3))],
        [Number((cLon + 1.5).toFixed(3)), Number((cLat - 1.2).toFixed(3))],
        [Number((cLon + 1.5).toFixed(3)), Number((cLat + 1.2).toFixed(3))],
        [Number((cLon - 1.5).toFixed(3)), Number((cLat + 1.2).toFixed(3))],
      ];
      const baseEnv = scenario.environment ?? { landPolygons: [], acousticZones: [] };
      const existingPasses = baseEnv.satellitePasses ?? [];
      scenario.environment = {
        ...baseEnv,
        satellitePasses: [
          ...existingPasses,
          {
            id: `campaign_forward_isr_s${stageIndex + 1}`,
            name: '战役连胜前沿 SAR 侦察卫星过境',
            side: playerSide,
            sensorKind: 'sar_radar',
            firstPassSec: 10,
            intervalSec: 120,
            swathPolygon,
          },
        ],
      };

      injectedEvents.push({
        id: `campaign_carryover_bonus_s${stageIndex + 1}`,
        name: '战役连胜战备士气与ISR加成',
        description: '延续上一阶段胜利态势，本阶段开局获得战役联指先期支援积分与前沿卫星侦察支援。',
        trigger: { type: 'TIME_ELAPSED', elapsedSec: 1 },
        actions: [
          {
            type: 'AWARD_SCORE',
            side: playerSide,
            points: 50,
            reason: '上一阶段战役胜利态势加成',
          },
          {
            type: 'BROADCAST_MESSAGE',
            side: playerSide,
            severity: 'info',
            title: '战役连胜先期支援就绪',
            message: '联指已调拨前沿 SAR 卫星侦察过境窗口，并授予 50 分先期作战态势加成。',
          },
        ],
      });
    } else if (carryover.lastOutcome === 'defeat' || carryover.lastOutcome === 'draw') {
      const isDefeat = carryover.lastOutcome === 'defeat';
      injectedEvents.push({
        id: `campaign_opfor_alert_s${stageIndex + 1}`,
        name: isDefeat ? '敌方失利乘胜最高警戒' : '敌方相持警戒升级',
        description: isDefeat
          ? '受上阶段战局失利影响，敌方战区已转入最高自由交战警戒并强化雷达搜索。'
          : '上阶段战局胶着，敌方显著提高了前沿防空与对海警戒等级。',
        trigger: { type: 'TIME_ELAPSED', elapsedSec: 1 },
        actions: [
          {
            type: 'UPDATE_SIDE_DOCTRINE',
            side: opforSide,
            doctrinePatch: isDefeat
              ? { roe: 'free', emconRadar: true, engageOpportunityTargets: true, salvoSize: 3 }
              : { emconRadar: true, engageOpportunityTargets: true },
          },
          {
            type: 'BROADCAST_MESSAGE',
            side: playerSide,
            severity: isDefeat ? 'warning' : 'info',
            title: isDefeat ? '警告：敌方进入最高自由交战警戒' : '通报：敌方加强对空/对海警戒巡逻',
            message: isDefeat
              ? '因上阶段失利，敌方已放开交战规则 (ROE FREE) 并全频段开机搜索；我方前线整备亦受压力。'
              : '因上阶段相持，敌方已开启前线主动搜索雷达并加强机会目标拦截。',
          },
        ],
      });
    } else if (carryover.lastOutcome === 'costly_victory' && airbaseIntegrityPct < 85) {
      injectedEvents.push({
        id: `campaign_airbase_strain_s${stageIndex + 1}`,
        name: '前线机场跑道整备承压通报',
        description: '前线机场完好度受损，机库架次周转节奏相应延长。',
        trigger: { type: 'TIME_ELAPSED', elapsedSec: 1 },
        actions: [
          {
            type: 'BROADCAST_MESSAGE',
            side: playerSide,
            severity: 'warning',
            title: `前线航空保障承压 (${airbaseIntegrityPct}%)`,
            message: '部分跑道与整备掩体仍在抢修中，航母与岸基机库波次周转冷却已相应延长。',
          },
        ],
      });
    }

    if (injectedEvents.length > 0) {
      scenario.events = [...injectedEvents, ...existingEvents];
    }
  }

  return compileScenario(scenario).scenario;
}

export function computeNextCampaignCarryover(
  current: CampaignCarryover,
  result: BattleResult,
  playerSide: 'RED' | 'BLUE',
  stageScore: number,
  ownLosses: number,
  stageUnits: Record<string, RuntimeUnit> = {}
): CampaignCarryover {
  const outcome = result.outcomes[playerSide];
  let readinessDelta = 0;
  let supplyGain = 0;
  let airbaseIntegrityDelta = 0;
  let victoryCount = current.victoryCount;
  let costlyVictoryCount = current.costlyVictoryCount;
  let defeatCount = current.defeatCount;
  let summary = '';

  if (outcome === 'victory') {
    victoryCount += 1;
    readinessDelta = 0.05;
    supplyGain = 60 + Math.min(60, Math.floor(Math.max(0, stageScore) / 20));
    airbaseIntegrityDelta = 5 - Math.min(10, Math.floor(ownLosses / 2));
    summary = `大胜保持高战备 (+${supplyGain} SP)`;
  } else if (outcome === 'costly_victory') {
    costlyVictoryCount += 1;
    readinessDelta = -0.1;
    supplyGain = 35 + Math.min(40, Math.floor(Math.max(0, stageScore) / 25));
    airbaseIntegrityDelta = -8 - Math.min(12, ownLosses * 2);
    summary = `代价胜利（损 ${ownLosses}）战备略降 (+${supplyGain} SP)`;
  } else if (outcome === 'draw') {
    readinessDelta = -0.05;
    supplyGain = 20 + Math.min(25, Math.floor(Math.max(0, stageScore) / 30));
    airbaseIntegrityDelta = -10 - Math.min(10, ownLosses * 2);
    summary = `战局胶着战备微降 (+${supplyGain} SP)`;
  } else {
    defeatCount += 1;
    readinessDelta = -0.15;
    supplyGain = 10 + Math.min(15, Math.floor(Math.max(0, stageScore) / 40));
    airbaseIntegrityDelta = -20 - Math.min(15, ownLosses * 3);
    summary = `阶段失利（损 ${ownLosses}）战备承压 (+${supplyGain} SP)`;
  }

  // 1. Decay prior damage debt by 40% via theater dockyard repair, then add fresh capital/HVA battle damage
  const platformDamageDebt: Record<string, number> = {};
  for (const [pid, debt] of Object.entries(current.platformDamageDebt ?? {})) {
    const repaired = Number((debt * 0.6).toFixed(3));
    if (repaired >= 0.03) platformDamageDebt[pid] = repaired;
  }

  let stageAirLosses = 0;
  let airbaseBattleDamagePenalty = 0;
  const stageAmmoSpent: Record<string, number> = {};

  for (const unit of Object.values(stageUnits)) {
    if (unit.side !== playerSide) continue;
    const isLost = unit.hp <= 0 || unit.status === 'destroyed';
    if (unit.domain === 'air' && unit.category !== 'decoy' && isLost) {
      stageAirLosses += 1;
    }
    if (unit.category === 'airbase') {
      const missingRatio = isLost ? 1 : Math.max(0, (unit.maxHp - unit.hp) / Math.max(1, unit.maxHp));
      airbaseBattleDamagePenalty += Math.round(missingRatio * 25);
    }
    if (CAPITAL_CARRYOVER_CATEGORIES.has(unit.category)) {
      const missingFraction = isLost ? 0.35 : Math.max(0, (unit.maxHp - unit.hp) / Math.max(1, unit.maxHp)) * 0.5;
      if (missingFraction >= 0.03) {
        platformDamageDebt[unit.platformId] = Math.min(
          0.45,
          Number(((platformDamageDebt[unit.platformId] ?? 0) + missingFraction).toFixed(3))
        );
      }
    }
    for (const weaponId of SCARCE_THEATER_WEAPONS) {
      const spent = unit.weaponUsage[weaponId]?.expended ?? 0;
      if (spent > 0) {
        stageAmmoSpent[weaponId] = (stageAmmoSpent[weaponId] ?? 0) + spent;
      }
    }
  }

  // Theater aviation logistics replenishes 1 lost airframe between stages
  const airframeAttritionDebt = Math.max(
    0,
    Math.min(8, (current.airframeAttritionDebt ?? 0) + stageAirLosses - 1)
  );

  // Theater munition depot replenishes 50% of scarce standoff expenditure between stages
  const scarceAmmoDebt: Record<string, number> = {};
  const allTrackedWeapons = new Set([
    ...Object.keys(current.scarceAmmoDebt ?? {}),
    ...Object.keys(stageAmmoSpent),
  ]);
  for (const weaponId of allTrackedWeapons) {
    const carried = Math.floor(((current.scarceAmmoDebt?.[weaponId] ?? 0) + (stageAmmoSpent[weaponId] ?? 0)) * 0.5);
    if (carried > 0) scarceAmmoDebt[weaponId] = carried;
  }

  const nextSupplyPoints = Math.max(
    0,
    Math.min(MAX_CAMPAIGN_SUPPLY_POINTS, (current.supplyPoints ?? INITIAL_CAMPAIGN_SUPPLY_POINTS) + supplyGain)
  );
  const nextAirbaseIntegrityPct = Math.max(
    MIN_AIRBASE_INTEGRITY_PCT,
    Math.min(100, (current.airbaseIntegrityPct ?? 100) + airbaseIntegrityDelta - airbaseBattleDamagePenalty)
  );

  const nextCarryover: CampaignCarryover = {
    completedStages: current.completedStages + 1,
    cumulativeScore: current.cumulativeScore + stageScore,
    readinessMultiplier: Math.max(0.75, Math.min(1.1, Number((current.readinessMultiplier + readinessDelta).toFixed(2)))),
    supplyPoints: nextSupplyPoints,
    airbaseIntegrityPct: nextAirbaseIntegrityPct,
    victoryCount,
    costlyVictoryCount,
    defeatCount,
    airframeAttritionDebt,
    platformDamageDebt,
    scarceAmmoDebt,
    lastOutcome: outcome,
    stageModifiers: [],
    notes: [...current.notes, summary],
  };
  nextCarryover.stageModifiers = deriveCampaignStageModifiers(nextCarryover);
  return nextCarryover;
}

/**
 * Deterministically apply cross-stage hull damage debt, hangar airframe attrition,
 * airbase integrity effects, and scarce theater munition depletion to instantiated stage units.
 */
export function applyCampaignRuntimeCarryover(
  units: Record<string, RuntimeUnit>,
  carryover: CampaignCarryover,
  playerSide: 'RED' | 'BLUE',
  _catalog?: EquipmentCatalog
): Record<string, RuntimeUnit> {
  if (carryover.completedStages <= 0) return units;

  const nextUnits: Record<string, RuntimeUnit> = {};
  let remainingAirAttrition = carryover.airframeAttritionDebt ?? 0;
  const remainingAmmoDebt: Record<string, number> = { ...(carryover.scarceAmmoDebt ?? {}) };
  const airbaseIntegrityPct = carryover.airbaseIntegrityPct ?? 100;

  const sortedIds = Object.keys(units).sort((a, b) => a.localeCompare(b));
  for (const id of sortedIds) {
    const original = units[id];
    if (original.side !== playerSide) {
      nextUnits[id] = original;
      continue;
    }
    const unit: RuntimeUnit = {
      ...original,
      mounts: original.mounts.map((m) => ({ ...m })),
      hangar: original.hangar.map((s) => ({
        ...s,
        turnaroundQueue: [...s.turnaroundQueue],
        activeSortieIds: [...s.activeSortieIds],
      })),
    };

    // 1. Capital / HVA structural battle-damage debt (always keeps >= 55% HP so critical preserve doesn't fail on Tick 0)
    const dmgDebt = carryover.platformDamageDebt?.[unit.platformId] ?? 0;
    if (dmgDebt > 0 && CAPITAL_CARRYOVER_CATEGORIES.has(unit.category)) {
      const minSafeHp = Math.ceil(unit.maxHp * 0.55);
      unit.hp = Math.max(minSafeHp, Math.round(unit.maxHp * (1 - dmgDebt)));
    }

    // 1b. Theater airbase integrity affects land airbase structural HP and sortie turnaround across hangars
    if (unit.category === 'airbase' && airbaseIntegrityPct < 100) {
      const minSafeHp = Math.ceil(unit.maxHp * 0.55);
      const integrityHp = Math.max(minSafeHp, Math.round(unit.maxHp * (airbaseIntegrityPct / 100)));
      unit.hp = Math.min(unit.hp, integrityHp);
    }

    if (unit.hangar.length > 0) {
      if (airbaseIntegrityPct < 90) {
        const turnaroundPenaltyFactor = 1 + (100 - airbaseIntegrityPct) / 100;
        for (const slot of unit.hangar) {
          slot.turnaroundSec = Math.round(slot.turnaroundSec * turnaroundPenaltyFactor);
          if (airbaseIntegrityPct < 75) {
            slot.launchCooldownSec = Math.round(slot.launchCooldownSec * 1.25);
          }
        }
      } else if (airbaseIntegrityPct >= 95 && carryover.lastOutcome === 'victory') {
        for (const slot of unit.hangar) {
          slot.turnaroundSec = Math.max(10, Math.round(slot.turnaroundSec * 0.9));
        }
      }
    }

    // 2. Hangar airframe attrition across carriers / airbases (keeps >= 1 ready airframe per slot)
    if (remainingAirAttrition > 0 && unit.hangar.length > 0) {
      for (const slot of unit.hangar) {
        if (remainingAirAttrition <= 0) break;
        const removableReserve = Math.min(remainingAirAttrition, slot.reserveAirframes);
        if (removableReserve > 0) {
          slot.reserveAirframes -= removableReserve;
          slot.totalAirframes = Math.max(1, slot.totalAirframes - removableReserve);
          slot.turnaroundSupplies = Math.max(1, slot.turnaroundSupplies - removableReserve);
          remainingAirAttrition -= removableReserve;
        }
        if (remainingAirAttrition > 0 && slot.readyAirframes > 1) {
          const removableReady = Math.min(remainingAirAttrition, slot.readyAirframes - 1);
          slot.readyAirframes -= removableReady;
          slot.totalAirframes = Math.max(1, slot.totalAirframes - removableReady);
          remainingAirAttrition -= removableReady;
        }
      }
    }

    // 3. Scarce theater standoff munition debt (keeps >= 2 rounds or >= 50% on very small mounts)
    for (const mount of unit.mounts) {
      const debt = remainingAmmoDebt[mount.weaponId] ?? 0;
      if (debt <= 0) continue;
      const minRetained = Math.min(mount.maxAmmo, Math.max(1, Math.ceil(mount.maxAmmo * 0.4)));
      const deduct = Math.min(debt, Math.max(0, mount.currentAmmo - minRetained));
      if (deduct > 0) {
        mount.currentAmmo -= deduct;
        remainingAmmoDebt[mount.weaponId] = debt - deduct;
      }
    }

    nextUnits[id] = unit;
  }

  return nextUnits;
}

export function applyCampaignResupplyChoice(
  carryover: CampaignCarryover,
  choice: CampaignResupplyChoice
): CampaignCarryover {
  const currentSupply = carryover.supplyPoints ?? INITIAL_CAMPAIGN_SUPPLY_POINTS;
  const currentAirbase = carryover.airbaseIntegrityPct ?? 100;
  const option = CAMPAIGN_RESUPPLY_OPTIONS.find((item) => item.id === choice) ?? CAMPAIGN_RESUPPLY_OPTIONS[0];
  const spent = Math.min(currentSupply, option.cost);
  const ratio = option.cost > 0 ? Math.min(1, spent / option.cost) : 1;
  const isRationed = spent < option.cost;

  const next: CampaignCarryover = {
    ...carryover,
    supplyPoints: Math.max(0, currentSupply - spent),
    airbaseIntegrityPct: currentAirbase,
    platformDamageDebt: { ...carryover.platformDamageDebt },
    scarceAmmoDebt: { ...carryover.scarceAmmoDebt },
    lastResupplyChoice: choice,
    stageModifiers: [...(carryover.stageModifiers ?? [])],
    notes: [...carryover.notes],
  };

  const applyReadinessBoost = (delta: number) => {
    const scaled = Number((delta * ratio).toFixed(2));
    if (next.readinessMultiplier < 1) {
      next.readinessMultiplier = Math.min(1, Number((next.readinessMultiplier + scaled).toFixed(2)));
    }
  };

  if (choice === 'hull_repair') {
    const retainFactor = Number((1 - 0.7 * ratio).toFixed(4));
    for (const [k, v] of Object.entries(next.platformDamageDebt)) {
      next.platformDamageDebt[k] = Number(Math.max(0, v * retainFactor).toFixed(3));
    }
    next.airbaseIntegrityPct = Math.min(100, currentAirbase + Math.round(6 * ratio));
    applyReadinessBoost(0.08);
    next.notes.push(
      `战间整备：船厂抢修优先（消耗 ${spent} SP${isRationed ? '·配额不足折算' : ''}，大幅恢复舰体并稳固基地）`
    );
  } else if (choice === 'airframes') {
    const retainFactor = Number((1 - 0.75 * ratio).toFixed(4));
    next.airframeAttritionDebt = Math.max(0, Math.floor(Number((next.airframeAttritionDebt * retainFactor).toFixed(4))));
    next.airbaseIntegrityPct = Math.min(100, currentAirbase + Math.round(4 * ratio));
    applyReadinessBoost(0.05);
    next.notes.push(
      `战间整备：航空兵补充优先（消耗 ${spent} SP${isRationed ? '·配额不足折算' : ''}，优先补充战机架数）`
    );
  } else if (choice === 'munitions') {
    const retainFactor = Number((1 - 0.8 * ratio).toFixed(4));
    for (const [k, v] of Object.entries(next.scarceAmmoDebt)) {
      next.scarceAmmoDebt[k] = Math.max(0, Math.floor(Number((v * retainFactor).toFixed(4))));
    }
    applyReadinessBoost(0.01);
    next.notes.push(
      `战间整备：稀缺弹药优先（消耗 ${spent} SP${isRationed ? '·配额不足折算' : ''}，大幅补充垂发与防区外弹药）`
    );
  } else if (choice === 'base_repair') {
    next.airbaseIntegrityPct = Math.min(100, currentAirbase + Math.round(25 * ratio));
    if (ratio >= 0.5 && next.airframeAttritionDebt > 0) {
      next.airframeAttritionDebt = Math.max(0, next.airframeAttritionDebt - 1);
    }
    applyReadinessBoost(0.06);
    next.notes.push(
      `战间整备：基地抢修优先（消耗 ${spent} SP${isRationed ? '·配额不足折算' : ''}，前线跑道与保障设施大幅修复）`
    );
  } else {
    const effRatio = Math.max(0.25, ratio);
    const hullRetain = Number((1 - 0.3 * effRatio).toFixed(4));
    const assetRetain = Number((1 - 0.35 * effRatio).toFixed(4));
    for (const [k, v] of Object.entries(next.platformDamageDebt)) {
      next.platformDamageDebt[k] = Number(Math.max(0, v * hullRetain).toFixed(3));
    }
    next.airframeAttritionDebt = Math.max(0, Math.floor(Number((next.airframeAttritionDebt * assetRetain).toFixed(4))));
    for (const [k, v] of Object.entries(next.scarceAmmoDebt)) {
      next.scarceAmmoDebt[k] = Math.max(0, Math.floor(Number((v * assetRetain).toFixed(4))));
    }
    next.airbaseIntegrityPct = Math.min(100, currentAirbase + Math.round(8 * effRatio));
    applyReadinessBoost(0.03);
    next.notes.push(
      `战间整备：均衡后勤补给（消耗 ${spent} SP${isRationed ? '·应急配额' : ''}，战损/机库/弹药/机场适度恢复）`
    );
  }

  next.stageModifiers = deriveCampaignStageModifiers(next);
  return next;
}

export interface CampaignMetricDelta {
  before: number;
  after: number;
  delta: number;
}

export interface CampaignResupplyDiffPreview {
  choice: CampaignResupplyChoice;
  afterCarryover: CampaignCarryover;
  supplyPoints: CampaignMetricDelta;
  readinessPct: CampaignMetricDelta;
  airbaseIntegrityPct: CampaignMetricDelta;
  airframeDebt: CampaignMetricDelta;
  avgHullDamagePct: CampaignMetricDelta & { count: number };
  totalScarceAmmoDebt: CampaignMetricDelta;
}

export function computeCampaignResupplyDiff(
  before: CampaignCarryover,
  choice: CampaignResupplyChoice
): CampaignResupplyDiffPreview {
  const after = applyCampaignResupplyChoice(before, choice);

  const sumAmmo = (debt: Record<string, number>) =>
    Object.values(debt ?? {}).reduce((sum, v) => sum + v, 0);
  const hullStats = (debt: Record<string, number>) => {
    const vals = Object.values(debt ?? {}).filter((v) => v > 0);
    if (vals.length === 0) return { avgPct: 0, count: 0 };
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    return { avgPct: Math.round(avg * 100), count: vals.length };
  };

  const beforeSupply = before.supplyPoints ?? INITIAL_CAMPAIGN_SUPPLY_POINTS;
  const afterSupply = after.supplyPoints ?? INITIAL_CAMPAIGN_SUPPLY_POINTS;
  const beforeReadiness = Math.round(before.readinessMultiplier * 100);
  const afterReadiness = Math.round(after.readinessMultiplier * 100);
  const beforeAirbase = before.airbaseIntegrityPct ?? 100;
  const afterAirbase = after.airbaseIntegrityPct ?? 100;
  const beforeAirframe = before.airframeAttritionDebt ?? 0;
  const afterAirframe = after.airframeAttritionDebt ?? 0;
  const beforeHull = hullStats(before.platformDamageDebt);
  const afterHull = hullStats(after.platformDamageDebt);
  const beforeAmmo = sumAmmo(before.scarceAmmoDebt);
  const afterAmmo = sumAmmo(after.scarceAmmoDebt);

  return {
    choice,
    afterCarryover: after,
    supplyPoints: { before: beforeSupply, after: afterSupply, delta: afterSupply - beforeSupply },
    readinessPct: { before: beforeReadiness, after: afterReadiness, delta: afterReadiness - beforeReadiness },
    airbaseIntegrityPct: { before: beforeAirbase, after: afterAirbase, delta: afterAirbase - beforeAirbase },
    airframeDebt: { before: beforeAirframe, after: afterAirframe, delta: afterAirframe - beforeAirframe },
    avgHullDamagePct: {
      before: beforeHull.avgPct,
      after: afterHull.avgPct,
      delta: afterHull.avgPct - beforeHull.avgPct,
      count: Math.max(beforeHull.count, afterHull.count),
    },
    totalScarceAmmoDebt: { before: beforeAmmo, after: afterAmmo, delta: afterAmmo - beforeAmmo },
  };
}
