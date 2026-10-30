import type {
  BattleAssessmentGrade,
  ScoreLedger,
  VictoryConditionRule,
} from '../../types/wargame';

/** Evaluate the current score against the scenario victory thresholds. */
export function evaluateBattleAssessment(
  score: ScoreLedger,
  victoryRule?: VictoryConditionRule
): {
  grade: BattleAssessmentGrade;
  netRedAdvantage: number;
  summary: string;
} {
  const netRed = score.redScore - score.blueScore;
  const decisive = victoryRule?.decisiveVictoryThreshold ?? 350;
  const tactical = victoryRule?.tacticalVictoryThreshold ?? 120;

  if (netRed >= decisive) {
    return {
      grade: 'RED_DECISIVE_VICTORY',
      netRedAdvantage: netRed,
      summary: '红方取得决定性全面胜利 (DECISIVE VICTORY)',
    };
  }
  if (netRed >= tactical) {
    return {
      grade: 'RED_TACTICAL_VICTORY',
      netRedAdvantage: netRed,
      summary: '红方取得战术优势胜利 (TACTICAL VICTORY)',
    };
  }
  if (netRed <= -decisive) {
    return {
      grade: 'BLUE_DECISIVE_VICTORY',
      netRedAdvantage: netRed,
      summary: '蓝方取得决定性全面胜利 (DECISIVE VICTORY)',
    };
  }
  if (netRed <= -tactical) {
    return {
      grade: 'BLUE_TACTICAL_VICTORY',
      netRedAdvantage: netRed,
      summary: '蓝方取得战术优势胜利 (TACTICAL VICTORY)',
    };
  }
  return {
    grade: 'STRATEGIC_DRAW',
    netRedAdvantage: netRed,
    summary: '双方均势对峙 / 战术相持 (STRATEGIC DRAW)',
  };
}
