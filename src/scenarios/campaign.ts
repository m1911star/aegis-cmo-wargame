import type { BattleResult, ScenarioDefinition, SideId } from '../types/wargame';
import { compileScenario } from './compileScenario';
import {
  SCENARIO_DEEP_SEA_CARRIER_HUNT,
  SCENARIO_EAST_SEA_THUNDER,
} from './builtinScenarios';
import { INFORMATION_EXERCISE } from './informationExercise';

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
  title: '西太联合行动战役（三阶段连贯）',
  description: '从前沿有限信息侦察、东海海空夺控到深海双航母决战的三阶段连贯战役；上一阶段的战损与战果将影响下一阶段的战备度与战役积分。',
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
      scenarioId: SCENARIO_DEEP_SEA_CARRIER_HUNT.id,
      title: '第三阶段：深海猎杀（航母特混决战）',
      summary: '围绕航母打击群与水下狼群展开最终海空决胜。',
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
  ownLosses: number
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

  return {
    completedStages: current.completedStages + 1,
    cumulativeScore: current.cumulativeScore + stageScore,
    readinessMultiplier: Math.max(0.75, Math.min(1.1, Number((current.readinessMultiplier + readinessDelta).toFixed(2)))),
    victoryCount,
    costlyVictoryCount,
    defeatCount,
    lastOutcome: outcome,
    notes: [...current.notes, summary],
  };
}
