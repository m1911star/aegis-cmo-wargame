import React, { useMemo, useState } from 'react';
import {
  CAMPAIGN_RESUPPLY_OPTIONS,
  computeCampaignResupplyDiff,
  computeNextCampaignCarryover,
  type CampaignResupplyChoice,
} from '../../scenarios/campaign';
import { Award, ChartColumn, Compass, RotateCcw } from 'lucide-react';
import { evaluateBattleAssessment } from '../../engine/simulation/battleAssessment';
import { useWargameStore } from '../../store/useWargameStore';
import { Button } from '../ui/button';
import { ModalFooter, ModalHeader, ModalShell } from '../ui/dialog';

const OUTCOME_LABELS = {
  victory: '战役/任务胜利 (VICTORY)',
  costly_victory: '付出战损，达成主要目标 (COSTLY VICTORY)',
  defeat: '任务失利 (DEFEAT)',
  draw: '战术相持 / 平局 (DRAW)',
} as const;

interface Props {
  onDismiss: () => void;
}

export const BattleResultOverlay: React.FC<Props> = ({ onDismiss }) => {
  const battleResult = useWargameStore((s) => s.battleResult);
  const score = useWargameStore((s) => s.score);
  const currentScenario = useWargameStore((s) => s.currentScenario);
  const playerSide = useWargameStore((s) => s.playerSide);
  const objectives = useWargameStore((s) => s.objectives);
  const objectiveProgress = useWargameStore((s) => s.objectiveProgress);
  const units = useWargameStore((s) => s.units);
  const campaignState = useWargameStore((s) => s.campaignState);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const resetScenario = useWargameStore((s) => s.resetScenario);
  const advanceCampaignStage = useWargameStore((s) => s.advanceCampaignStage);
  const [resupplyChoice, setResupplyChoice] = useState<CampaignResupplyChoice>('balanced');

  const campaignPreview = useMemo(() => {
    if (!campaignState || !battleResult) return null;
    const cSide = campaignState.playerSide;
    const stageScore = cSide === 'RED' ? score.redScore : score.blueScore;
    const ownLosses = cSide === 'RED' ? score.redLosses : score.blueLosses;
    const postBattle = computeNextCampaignCarryover(
      campaignState.carryover,
      battleResult,
      cSide,
      stageScore,
      ownLosses,
      units
    );
    const diff = computeCampaignResupplyDiff(postBattle, resupplyChoice);
    return { postBattle, afterResupply: diff.afterCarryover, diff };
  }, [campaignState, battleResult, score, units, resupplyChoice]);

  if (!battleResult) return null;

  const side = playerSide === 'BLUE' ? 'BLUE' : 'RED';
  const outcome = battleResult.outcomes[side];
  const assessment = evaluateBattleAssessment(score, currentScenario.victoryConditions);
  const sideObjectives = objectives.filter((obj) => obj.side === side);
  const failedRequired = sideObjectives.filter((obj) => obj.required && objectiveProgress[obj.id] !== 'achieved');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="战后结算与评估"
      className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <ModalShell className="max-w-2xl border-amber-500/40">
        <ModalHeader
          icon={<Award className="w-4 h-4 text-amber-300" />}
          title="BATTLE ASSESSMENT // 战局终局结算"
          onClose={onDismiss}
          closeLabel="关闭终局结算"
        />

        <div className="p-5 space-y-4 text-xs max-h-[78dvh] overflow-y-auto">
          <div className="p-3.5 rounded-lg bg-amber-500/8 border border-amber-500/25 space-y-1">
            <div className="text-base font-semibold text-amber-300">{OUTCOME_LABELS[outcome]}</div>
            <div className="text-cyan-300">积分评级：{assessment.summary}（红 {score.redScore} : 蓝 {score.blueScore}）</div>
            <div className="text-muted-foreground">
              终止原因：{battleResult.reason === 'critical_objective' ? '关键目标决定终局' : '到达想定预设时间上限'}
              {failedRequired.length > 0 && ` · 未达成主要目标：${failedRequired.map((o) => o.title).join('；')}`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-lg bg-rose-500/8 border border-rose-500/25 space-y-1">
              <div className="text-rose-300 font-semibold">红方统计</div>
              <div>发射：{score.redMissilesFired} · 拦截：{score.redInterceptions}</div>
              <div>损失：{score.redLosses} · 积分：{score.redScore}</div>
            </div>
            <div className="p-3.5 rounded-lg bg-sky-500/8 border border-sky-500/25 space-y-1">
              <div className="text-sky-300 font-semibold">蓝方统计</div>
              <div>发射：{score.blueMissilesFired} · 拦截：{score.blueInterceptions}</div>
              <div>损失：{score.blueLosses} · 积分：{score.blueScore}</div>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-2">
            <div className="text-primary font-semibold">本方任务目标对账 ({side})</div>
            {sideObjectives.length === 0 ? (
              <p className="text-muted-foreground">本想定按综合积分与战损裁决。</p>
            ) : (
              <ul className="space-y-1.5">
                {sideObjectives.map((obj) => {
                  const status = objectiveProgress[obj.id];
                  return (
                    <li key={obj.id} className="flex items-center justify-between gap-2 border-b border-border/70 pb-1.5 last:border-0 last:pb-0">
                      <span className={status === 'achieved' ? 'text-emerald-300' : 'text-rose-300'}>
                        {status === 'achieved' ? '✓ 已达成' : '✗ 未达成'} · {obj.title} ({obj.required ? '主要' : '次要'})
                      </span>
                      <span className="text-muted-foreground font-mono">{obj.points} 分</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {campaignState && campaignPreview && (
            <div className="p-3.5 rounded-lg bg-cyan-500/8 border border-cyan-500/25 space-y-2 text-[11px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-cyan-300 font-semibold">
                  战役连贯态势（第 {campaignState.currentStageIndex + 1}/{campaignState.totalStages} 阶段）
                </span>
                <span className="font-mono text-amber-300">
                  战区补给 {campaignPreview.afterResupply.supplyPoints} SP · 机场完好度{' '}
                  {campaignPreview.afterResupply.airbaseIntegrityPct}%
                </span>
              </div>
              <div className="text-muted-foreground">
                累计战役积分 {campaignPreview.postBattle.cumulativeScore} · 战后战备系数{' '}
                {Math.round(campaignPreview.afterResupply.readinessMultiplier * 100)}%（本战净入账补给{' '}
                {campaignPreview.postBattle.supplyPoints - campaignState.supplyPoints >= 0 ? '+' : ''}
                {campaignPreview.postBattle.supplyPoints - campaignState.supplyPoints} SP）
              </div>
              <div className="pt-1 border-t border-cyan-500/20 space-y-0.5">
                <div className="text-amber-300 font-medium">下阶段战场修正摘要：</div>
                <ul className="list-disc list-inside space-y-0.5 text-foreground/85">
                  {campaignPreview.afterResupply.stageModifiers.map((modifier, idx) => (
                    <li key={idx}>{modifier}</li>
                  ))}
                </ul>
              </div>
              {!campaignState.finished && campaignState.currentStageIndex + 1 < campaignState.totalStages && (
                <div className="pt-1.5 border-t border-cyan-500/20 space-y-1.5">
                  <div className="text-cyan-200 font-medium">
                    战间有限后勤整备取舍（当前可用 {campaignPreview.postBattle.supplyPoints} SP）：
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {CAMPAIGN_RESUPPLY_OPTIONS.map((opt) => {
                      const affordable = campaignPreview.postBattle.supplyPoints >= opt.cost;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setResupplyChoice(opt.id)}
                          className={`text-left px-2.5 py-1.5 rounded border text-[10px] transition ${
                            resupplyChoice === opt.id
                              ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                              : 'border-border/50 bg-background/40 text-muted-foreground hover:border-cyan-500/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 font-semibold">
                            <span>{opt.title}</span>
                            <span className={affordable ? 'font-mono text-amber-300' : 'font-mono text-rose-300'}>
                              -{opt.cost} SP{affordable ? '' : ' (折算)'}
                            </span>
                          </div>
                          <div className="opacity-90">{opt.summary}</div>
                          <div className="opacity-70">{opt.tradeoff}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 pt-1 font-mono text-[10px]">
                    <div className="px-2 py-1 rounded bg-background/60 border border-border/50">
                      战备: {campaignPreview.diff.readinessPct.before}% →{' '}
                      <span className="text-cyan-200 font-semibold">{campaignPreview.diff.readinessPct.after}%</span>
                    </div>
                    <div className="px-2 py-1 rounded bg-background/60 border border-border/50">
                      机场: {campaignPreview.diff.airbaseIntegrityPct.before}% →{' '}
                      <span className="text-emerald-300 font-semibold">{campaignPreview.diff.airbaseIntegrityPct.after}%</span>
                    </div>
                    <div className="px-2 py-1 rounded bg-background/60 border border-border/50">
                      弹药缺口: {campaignPreview.diff.totalScarceAmmoDebt.before} →{' '}
                      <span className="text-amber-300 font-semibold">{campaignPreview.diff.totalScarceAmmoDebt.after}</span>
                    </div>
                  </div>
                </div>
              )}
              <div className="pt-1 flex justify-end">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    onDismiss();
                    setActiveModal('campaign');
                  }}
                  className="text-cyan-300 border-cyan-500/35"
                >
                  <Compass className="w-3 h-3" />
                  <span>打开战区完整后勤态势</span>
                </Button>
              </div>
            </div>
          )}
        </div>

        <ModalFooter>
          <Button
            variant="outline"
            onClick={() => {
              onDismiss();
              setActiveModal('aar');
            }}
            className="text-amber-300"
          >
            <ChartColumn className="w-3.5 h-3.5" /><span>查看完整复盘 (AAR)</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onDismiss();
              resetScenario(true);
            }}
            className="text-cyan-300"
          >
            <RotateCcw className="w-3.5 h-3.5" /><span>随机种子再来一局</span>
          </Button>
          {campaignState && !campaignState.finished && (
            <Button
              onClick={() => {
                onDismiss();
                advanceCampaignStage(resupplyChoice);
              }}
            >
              {campaignState.currentStageIndex + 1 < campaignState.totalStages
                ? `推进至第 ${campaignState.currentStageIndex + 2} 阶段战役`
                : '完成战役结算'}
            </Button>
          )}
        </ModalFooter>
      </ModalShell>
    </div>
  );
};
