import React from 'react';
import { Award, ChartColumn, RotateCcw, X } from 'lucide-react';
import { evaluateBattleAssessment } from '../../engine/simulation/battleAssessment';
import { useWargameStore } from '../../store/useWargameStore';

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
  const campaignState = useWargameStore((s) => s.campaignState);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const resetScenario = useWargameStore((s) => s.resetScenario);
  const advanceCampaignStage = useWargameStore((s) => s.advanceCampaignStage);

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
      className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 font-mono"
    >
      <div className="w-full max-w-2xl tactical-panel rounded-lg border border-amber-400/60 overflow-hidden shadow-[0_0_50px_rgba(245,158,11,0.25)]">
        <div className="px-4 py-3 bg-amber-950/50 border-b border-amber-500/35 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
            <Award className="w-4 h-4" />
            <span>BATTLE ASSESSMENT // 战局终局结算</span>
          </div>
          <button
            aria-label="关闭终局结算"
            onClick={onDismiss}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs max-h-[80dvh] overflow-y-auto">
          <div className="p-3 rounded bg-slate-950/90 border border-amber-500/30 space-y-1">
            <div className="text-base font-bold text-amber-300">{OUTCOME_LABELS[outcome]}</div>
            <div className="text-cyan-300">积分评级：{assessment.summary}（红 {score.redScore} : 蓝 {score.blueScore}）</div>
            <div className="text-slate-400">
              终止原因：{battleResult.reason === 'critical_objective' ? '关键目标决定终局' : '到达想定预设时间上限'}
              {failedRequired.length > 0 && ` · 未达成主要目标：${failedRequired.map((o) => o.title).join('；')}`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded bg-rose-950/25 border border-rose-500/30 space-y-1">
              <div className="text-rose-300 font-bold">红方统计</div>
              <div>发射：{score.redMissilesFired} · 拦截：{score.redInterceptions}</div>
              <div>损失：{score.redLosses} · 积分：{score.redScore}</div>
            </div>
            <div className="p-3 rounded bg-sky-950/25 border border-sky-500/30 space-y-1">
              <div className="text-sky-300 font-bold">蓝方统计</div>
              <div>发射：{score.blueMissilesFired} · 拦截：{score.blueInterceptions}</div>
              <div>损失：{score.blueLosses} · 积分：{score.blueScore}</div>
            </div>
          </div>

          <div className="p-3 rounded bg-slate-950/85 border border-slate-800 space-y-2">
            <div className="text-cyan-300 font-bold">本方任务目标对账 ({side})</div>
            {sideObjectives.length === 0 ? (
              <p className="text-slate-400">本想定按综合积分与战损裁决。</p>
            ) : (
              <ul className="space-y-1">
                {sideObjectives.map((obj) => {
                  const status = objectiveProgress[obj.id];
                  return (
                    <li key={obj.id} className="flex items-center justify-between gap-2 border-b border-slate-900 pb-1">
                      <span className={status === 'achieved' ? 'text-emerald-300' : 'text-rose-300'}>
                        {status === 'achieved' ? '✓ 已达成' : '✗ 未达成'} · {obj.title} ({obj.required ? '主要' : '次要'})
                      </span>
                      <span className="text-slate-400">{obj.points} 分</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="px-4 py-3 bg-slate-950/90 border-t border-slate-800 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => {
              onDismiss();
              setActiveModal('aar');
            }}
            className="toolbar-button text-amber-300"
          >
            <ChartColumn /><span>查看完整复盘 (AAR)</span>
          </button>
          <button
            onClick={() => {
              onDismiss();
              resetScenario(true);
            }}
            className="toolbar-button text-cyan-300"
          >
            <RotateCcw /><span>随机种子再来一局</span>
          </button>
          {campaignState && !campaignState.finished && (
            <button
              onClick={() => {
                onDismiss();
                advanceCampaignStage();
              }}
              className="px-3 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
            >
              {campaignState.currentStageIndex + 1 < campaignState.totalStages
                ? `推进至第 ${campaignState.currentStageIndex + 2} 阶段战役`
                : '完成战役结算'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
