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

export interface CampaignCarryover {
  completedStages: number;
  cumulativeScore: number;
  readinessMultiplier: number;
  victoryCount: number;
  costlyVictoryCount: number;
  defeatCount: number;
  airframeAttritionDebt: number;
  platformDamageDebt: Record<string, number>;
  scarceAmmoDebt: Record<string, number>;
  lastOutcome?: BattleResult['outcomes']['RED'];
  notes: string[];
}

export interface CampaignState {
  campaignId: string;
  title: string;
  playerSide: 'RED' | 'BLUE';
  currentStageIndex: number;
  totalStages: number;
  finished: boolean;
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

export function createInitialCampaignState(
  campaign: CampaignDefinition = BUILTIN_CAMPAIGN_WESTPAC,
  playerSide: SideId = 'RED'
): CampaignState {
  return {
    campaignId: campaign.id,
    title: campaign.title,
    playerSide: playerSide === 'BLUE' ? 'BLUE' : 'RED',
    currentStageIndex: 0,
    totalStages: campaign.stages.length,
    finished: false,
    carryover: {
      completedStages: 0,
      cumulativeScore: 0,
      readinessMultiplier: 1,
      victoryCount: 0,
      costlyVictoryCount: 0,
      defeatCount: 0,
      airframeAttritionDebt: 0,
      platformDamageDebt: {},
      scarceAmmoDebt: {},
      notes: [],
    },
  };
}

/**
 * Pure deterministic stage scenario builder that carries readiness and tactical
 * momentum from the previous stage while keeping the compiled scenario valid.
 */
export function buildCampaignStageScenario(
  baseScenario: ScenarioDefinition,
  carryover: CampaignCarryover,
  playerSide: 'RED' | 'BLUE',
  stageIndex: number
): ScenarioDefinition {
  const scenario = structuredClone(baseScenario);
  const readinessPct = Math.round(carryover.readinessMultiplier * 100);
  const noteText = carryover.notes.length
    ? `【战役继承】已完成 ${carryover.completedStages} 阶段 · 累计战役积分 ${carryover.cumulativeScore} · 战备系数 ${readinessPct}%（${carryover.notes.slice(-2).join('；')}）。`
    : '【战役首阶段】全军处于 100% 满编战备状态。';

  scenario.id = `${baseScenario.id}__campaign_s${stageIndex + 1}`;
  scenario.title = `[战役第${stageIndex + 1}阶段] ${baseScenario.title}`;
  scenario.briefing = {
    ...scenario.briefing,
    situation: `${noteText}\n\n${scenario.briefing.situation}`,
  };

  if (carryover.readinessMultiplier < 0.95) {
    // Slightly reduce fuel/speed readiness or add early tactical pressure note without breaking catalog constraints.
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

  if (carryover.cumulativeScore > 0 && scenario.events) {
    const moraleBonus = carryover.lastOutcome === 'victory' ? 50 : 0;
    if (moraleBonus > 0) {
      scenario.events = [
        {
          id: `campaign_carryover_bonus_s${stageIndex + 1}`,
          name: '战役连胜战备士气加成',
          description: '延续上一阶段胜利态势，本阶段开局获得战役联指先期支援积分。',
          trigger: { type: 'TIME_ELAPSED', elapsedSec: 1 },
          actions: [
            {
              type: 'AWARD_SCORE',
              side: playerSide,
              points: moraleBonus,
              reason: '上一阶段战役胜利态势加成',
            },
          ],
        },
        ...scenario.events,
      ];
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
  let victoryCount = current.victoryCount;
  let costlyVictoryCount = current.costlyVictoryCount;
  let defeatCount = current.defeatCount;
  let summary = '';

  if (outcome === 'victory') {
    victoryCount += 1;
    readinessDelta = 0.05;
    summary = '大胜保持高战备';
  } else if (outcome === 'costly_victory') {
    costlyVictoryCount += 1;
    readinessDelta = -0.1;
    summary = `代价胜利（损 ${ownLosses}）战备略降`;
  } else if (outcome === 'draw') {
    readinessDelta = -0.05;
    summary = '战局胶着战备微降';
  } else {
    defeatCount += 1;
    readinessDelta = -0.15;
    summary = `阶段失利（损 ${ownLosses}）战备承压`;
  }

  // 1. Decay prior damage debt by 40% via theater dockyard repair, then add fresh capital/HVA battle damage
  const platformDamageDebt: Record<string, number> = {};
  for (const [pid, debt] of Object.entries(current.platformDamageDebt ?? {})) {
    const repaired = Number((debt * 0.6).toFixed(3));
    if (repaired >= 0.03) platformDamageDebt[pid] = repaired;
  }

  let stageAirLosses = 0;
  const stageAmmoSpent: Record<string, number> = {};

  for (const unit of Object.values(stageUnits)) {
    if (unit.side !== playerSide) continue;
    const isLost = unit.hp <= 0 || unit.status === 'destroyed';
    if (unit.domain === 'air' && unit.category !== 'decoy' && isLost) {
      stageAirLosses += 1;
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

  return {
    completedStages: current.completedStages + 1,
    cumulativeScore: current.cumulativeScore + stageScore,
    readinessMultiplier: Math.max(0.75, Math.min(1.1, Number((current.readinessMultiplier + readinessDelta).toFixed(2)))),
    victoryCount,
    costlyVictoryCount,
    defeatCount,
    airframeAttritionDebt,
    platformDamageDebt,
    scarceAmmoDebt,
    lastOutcome: outcome,
    notes: [...current.notes, summary],
  };
}

/**
 * Deterministically apply cross-stage hull damage debt, hangar airframe attrition,
 * and scarce theater munition depletion to instantiated stage units.
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
