import React, { useMemo, useState } from 'react';
import { Compass, Flag, Play, ShieldAlert, Wrench } from 'lucide-react';
import {
  BUILTIN_CAMPAIGN_WESTPAC,
  CAMPAIGN_RESUPPLY_OPTIONS,
  SCARCE_THEATER_WEAPONS,
  computeCampaignResupplyDiff,
  computeNextCampaignCarryover,
  type CampaignResupplyChoice,
} from '../../scenarios/campaign';
import { useWargameStore } from '../../store/useWargameStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ModalFooter, ModalHeader, ModalShell } from '../ui/dialog';

function formatSignedDelta(delta: number, suffix = '', invertGood = false): { text: string; className: string } {
  if (delta === 0) return { text: `0${suffix}`, className: 'text-muted-foreground' };
  const sign = delta > 0 ? '+' : '';
  const good = invertGood ? delta < 0 : delta > 0;
  return {
    text: `${sign}${delta}${suffix}`,
    className: good ? 'text-emerald-300 font-semibold' : 'text-rose-300 font-semibold',
  };
}

export const CampaignTheaterModal: React.FC = () => {
  const campaignState = useWargameStore((s) => s.campaignState);
  const battleResult = useWargameStore((s) => s.battleResult);
  const score = useWargameStore((s) => s.score);
  const units = useWargameStore((s) => s.units);
  const catalog = useWargameStore((s) => s.catalog);
  const startCampaign = useWargameStore((s) => s.startCampaign);
  const advanceCampaignStage = useWargameStore((s) => s.advanceCampaignStage);
  const exitCampaign = useWargameStore((s) => s.exitCampaign);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);

  const [selectedChoice, setSelectedChoice] = useState<CampaignResupplyChoice>('balanced');

  const baseCarryoverForPreview = useMemo(() => {
    if (!campaignState) return null;
    if (battleResult && !campaignState.finished) {
      const cSide = campaignState.playerSide;
      const stageScore = cSide === 'RED' ? score.redScore : score.blueScore;
      const ownLosses = cSide === 'RED' ? score.redLosses : score.blueLosses;
      return computeNextCampaignCarryover(
        campaignState.carryover,
        battleResult,
        cSide,
        stageScore,
        ownLosses,
        units
      );
    }
    return campaignState.carryover;
  }, [campaignState, battleResult, score, units]);

  const resupplyDiff = useMemo(() => {
    if (!baseCarryoverForPreview) return null;
    return computeCampaignResupplyDiff(baseCarryoverForPreview, selectedChoice);
  }, [baseCarryoverForPreview, selectedChoice]);

  const canAdvanceNow = Boolean(
    campaignState &&
      battleResult &&
      !campaignState.finished &&
      campaignState.currentStageIndex + 1 < campaignState.totalStages
  );

  return (
    <ModalShell className="max-w-4xl max-h-[90dvh] flex flex-col">
      <ModalHeader
        icon={<Compass className="w-4 h-4 text-amber-300" />}
        title="CAMPAIGN THEATER // 西太五阶段联合战役态势与后勤整备"
        onClose={() => setActiveModal('none')}
        closeLabel="关闭战区态势"
      />

      <div className="p-4 space-y-4 text-xs overflow-y-auto flex-1">
        {/* 1. 战役路线图与开局控制 */}
        <section className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-primary font-semibold text-sm">{BUILTIN_CAMPAIGN_WESTPAC.title}</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {BUILTIN_CAMPAIGN_WESTPAC.description}
              </p>
            </div>
            {!campaignState ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    startCampaign('RED');
                    setActiveModal('none');
                  }}
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>以红方开启战役</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    startCampaign('BLUE');
                    setActiveModal('none');
                  }}
                  className="text-sky-300 border-sky-500/40"
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>以蓝方开启战役</span>
                </Button>
              </div>
            ) : (
              <Badge variant="warning" className="font-mono">
                当前席位: {campaignState.playerSide} · 第 {campaignState.currentStageIndex + 1}/{campaignState.totalStages} 阶段
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {BUILTIN_CAMPAIGN_WESTPAC.stages.map((st) => {
              const isCurrent = campaignState?.currentStageIndex === st.stageIndex && !campaignState.finished;
              const isDone = campaignState
                ? campaignState.finished || st.stageIndex < campaignState.currentStageIndex
                : false;
              return (
                <div
                  key={st.scenarioId}
                  className={`p-2.5 rounded-md border space-y-1 ${
                    isCurrent
                      ? 'border-amber-400/70 bg-amber-500/12'
                      : isDone
                        ? 'border-emerald-500/40 bg-emerald-500/8'
                        : 'border-border/60 bg-background/40 opacity-80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                    <span className="font-semibold text-foreground">STAGE {st.stageIndex + 1}</span>
                    <span
                      className={
                        isCurrent
                          ? 'text-amber-300 font-semibold'
                          : isDone
                            ? 'text-emerald-300'
                            : 'text-muted-foreground'
                      }
                    >
                      {isCurrent ? '进行中' : isDone ? '已完成' : '待解锁'}
                    </span>
                  </div>
                  <div className="font-semibold text-[11px] text-foreground leading-snug">
                    {st.title.replace(/^第.阶段：/, '')}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">{st.summary}</p>
                </div>
              );
            })}
          </div>
        </section>

        {campaignState && baseCarryoverForPreview && resupplyDiff && (
          <>
            {/* 2. 战区实时后勤与继承账本 */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-2">
                <h4 className="font-semibold text-cyan-300 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>战区战备与继承态势</span>
                </h4>
                <div className="grid grid-cols-3 gap-2 font-mono text-[11px] bg-background/60 p-2 rounded border border-border/60">
                  <div>补给: <span className="text-amber-300 font-semibold">{campaignState.supplyPoints} SP</span></div>
                  <div>机场完好: <span className="text-emerald-300 font-semibold">{campaignState.airbaseIntegrityPct}%</span></div>
                  <div>战备率: <span className="text-cyan-300 font-semibold">{Math.round(campaignState.carryover.readinessMultiplier * 100)}%</span></div>
                  <div>累计积分: {campaignState.carryover.cumulativeScore}</div>
                  <div>胜/惨胜/负: {campaignState.carryover.victoryCount}/{campaignState.carryover.costlyVictoryCount}/{campaignState.carryover.defeatCount}</div>
                  <div>战机缺口: {campaignState.carryover.airframeAttritionDebt} 架</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] text-amber-300 font-medium">当前阶段战场修正：</div>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-foreground/85">
                    {campaignState.stageModifiers.map((mod, idx) => (
                      <li key={idx}>{mod}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-2">
                <h4 className="font-semibold text-amber-300">稀缺防区外弹药与主力舰战损账本</h4>
                <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                  {SCARCE_THEATER_WEAPONS.map((wId) => {
                    const debt = baseCarryoverForPreview.scarceAmmoDebt[wId] ?? 0;
                    const wName = catalog.weapons[wId]?.codeName ?? wId;
                    return (
                      <div
                        key={wId}
                        className="flex items-center justify-between px-2 py-1 rounded bg-background/60 border border-border/60"
                      >
                        <span className="truncate text-foreground/90">{wName}</span>
                        <span className={debt > 0 ? 'text-rose-300 font-semibold' : 'text-emerald-300'}>
                          {debt > 0 ? `缺口 -${debt}` : '满编'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {Object.keys(baseCarryoverForPreview.platformDamageDebt).length > 0 && (
                  <div className="pt-1 border-t border-border/60 text-[10px] font-mono space-y-0.5">
                    <div className="text-muted-foreground font-sans">主力舰体跨阶段战损债务：</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(baseCarryoverForPreview.platformDamageDebt).map(([pid, debt]) => (
                        <span key={pid} className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-200">
                          {catalog.platforms[pid]?.className ?? pid}: -{Math.round(debt * 100)}% HP
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* 3. 战间补给前后差值预览 */}
            <section className="p-3.5 rounded-lg bg-cyan-500/8 border border-cyan-500/25 space-y-3" aria-label="战间补给前后差值预览">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-semibold text-cyan-200 flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5 text-cyan-300" />
                  <span>
                    战间后勤整备方案模拟与前后差值预览
                    {battleResult ? '（本战已结算，可立即执行推进）' : '（基于当前战区账本推演预览）'}
                  </span>
                </h4>
                <span className="font-mono text-[11px] text-amber-300">
                  可用补给池: {baseCarryoverForPreview.supplyPoints} SP
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-1.5">
                {CAMPAIGN_RESUPPLY_OPTIONS.map((opt) => {
                  const affordable = baseCarryoverForPreview.supplyPoints >= opt.cost;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelectedChoice(opt.id)}
                      className={`text-left p-2 rounded border text-[10px] cursor-pointer transition-colors ${
                        selectedChoice === opt.id
                          ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                          : 'border-border/60 bg-background/50 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span>{opt.title}</span>
                        <span className={affordable ? 'font-mono text-amber-300' : 'font-mono text-rose-300'}>
                          -{opt.cost}SP
                        </span>
                      </div>
                      <div className="mt-0.5 leading-snug opacity-85">{opt.summary}</div>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                {[
                  {
                    label: '战区补给点数 (SP)',
                    ...resupplyDiff.supplyPoints,
                    suffix: ' SP',
                    invertGood: false,
                  },
                  {
                    label: '编队战备率',
                    ...resupplyDiff.readinessPct,
                    suffix: '%',
                    invertGood: false,
                  },
                  {
                    label: '前线机场完好度',
                    ...resupplyDiff.airbaseIntegrityPct,
                    suffix: '%',
                    invertGood: false,
                  },
                  {
                    label: '航空兵机体缺口',
                    ...resupplyDiff.airframeDebt,
                    suffix: ' 架',
                    invertGood: true,
                  },
                  {
                    label: '主力舰平均战损债务',
                    ...resupplyDiff.avgHullDamagePct,
                    suffix: '%',
                    invertGood: true,
                  },
                  {
                    label: '稀缺防区外弹药缺口',
                    ...resupplyDiff.totalScarceAmmoDebt,
                    suffix: ' 发',
                    invertGood: true,
                  },
                ].map((row) => {
                  const fmt = formatSignedDelta(row.delta, row.suffix, row.invertGood);
                  return (
                    <div
                      key={row.label}
                      className="p-2 rounded bg-background/65 border border-border/60 space-y-0.5"
                    >
                      <div className="font-sans text-[10px] text-muted-foreground">{row.label}</div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-foreground">
                          {row.before}
                          {row.suffix} → <strong className="text-cyan-200">{row.after}{row.suffix}</strong>
                        </span>
                        <span className={fmt.className}>({fmt.text})</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>

      <ModalFooter>
        {campaignState && (
          <Button
            variant="outline"
            onClick={() => {
              exitCampaign();
              setActiveModal('none');
            }}
            className="text-rose-300 border-rose-500/35"
          >
            退出战役模式
          </Button>
        )}
        {canAdvanceNow && (
          <Button
            variant="success"
            onClick={() => {
              advanceCampaignStage(selectedChoice);
              setActiveModal('none');
            }}
          >
            <Play className="w-3.5 h-3.5" />
            <span>执行整备并进入第 {(campaignState?.currentStageIndex ?? 0) + 2} 阶段</span>
          </Button>
        )}
        <Button variant="secondary" onClick={() => setActiveModal('none')}>
          关闭
        </Button>
      </ModalFooter>
    </ModalShell>
  );
};
