import React, { Suspense, useMemo, useState } from 'react';
import { Box, ChartColumn, Check, Download, Play } from 'lucide-react';
import { buildAarBoxSlice } from '../../tacview3d/boxSlice';
import {
  buildAarTimelineBuckets,
  summarizeAar,
  summarizeAarBreakdowns,
  summarizeWeaponEffectivenessMatrix,
} from '../../engine/aar';
import { FIXED_DT_SEC } from '../../engine/determinism';
import { captureBattleRecording, captureShareableAarPackage } from '../../store/battleRecording';
import { useWargameStore } from '../../store/useWargameStore';
import type { AarEventKind, SideId } from '../../types/wargame';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ModalHeader, ModalShell } from '../ui/dialog';
import { Select } from '../ui/select';

const LazyLocalAirSeaBox3D = React.lazy(() => import('../tacview/LocalAirSeaBox3D'));

const OUTCOME_BADGES = {
  hit: '命中受损',
  destroy: '击毁摧毁',
  intercept: '末端拦截',
  softkill: '软杀伤诱骗',
  miss: '末段脱靶',
} as const;

export const AarDebriefModal: React.FC = () => {
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const startReplayPlayer = useWargameStore((s) => s.startReplayPlayer);
  const catalog = useWargameStore((s) => s.catalog);
  const units = useWargameStore((s) => s.units);
  const aar = useWargameStore((s) => s.aar);
  const battleResult = useWargameStore((s) => s.battleResult);
  const playMode = useWargameStore((s) => s.playMode);
  const tick = useWargameStore((s) => s.tick);
  const commandHistory = useWargameStore((s) => s.commandHistory);
  const currentScenario = useWargameStore((s) => s.currentScenario);
  const replayPlayer = useWargameStore((s) => s.replayPlayer);
  const [exported, setExported] = useState(false);
  const environment = useWargameStore((s) => s.environment);
  const [show3dAar, setShow3dAar] = useState(false);
  const [aarFocusCenter, setAarFocusCenter] = useState<[number, number] | undefined>(undefined);
  const [aarFocusLabel, setAarFocusLabel] = useState('交战空域复盘');
  const maxAarTick = useMemo(() => {
    let maxT = tick;
    for (const tr of aar.tracks) if (tr.tick > maxT) maxT = tr.tick;
    for (const ev of aar.events) if (ev.tick > maxT) maxT = ev.tick;
    return Math.max(0, maxT);
  }, [aar.tracks, aar.events, tick]);
  const [aarReplayTick, setAarReplayTick] = useState<number>(maxAarTick);
  const [eventSideFilter, setEventSideFilter] = useState<'ALL' | SideId>('ALL');
  const [eventKindFilter, setEventKindFilter] = useState<'ALL' | AarEventKind>('ALL');
  const [eventWeaponFilter, setEventWeaponFilter] = useState<string>('ALL');
  const effectiveReplayTick = Math.min(aarReplayTick, maxAarTick);
  const aarSlice = useMemo(() => {
    if (!show3dAar) return null;
    return buildAarBoxSlice({
      aar,
      units,
      upToTick: effectiveReplayTick,
      anchorCenter: aarFocusCenter,
      anchorLabel: aarFocusLabel,
      radiusKm: 130,
      environment,
    });
  }, [show3dAar, aar, units, effectiveReplayTick, aarFocusCenter, aarFocusLabel, environment]);
  const aarSummary = useMemo(() => summarizeAar(aar), [aar]);
  const breakdowns = useMemo(() => summarizeAarBreakdowns(aar, units), [aar, units]);
  const timelineBuckets = useMemo(() => buildAarTimelineBuckets(aar, maxAarTick, 24), [aar, maxAarTick]);
  const maxBucketIntensity = useMemo(
    () => Math.max(1, ...timelineBuckets.map((b) => b.totalIntensity)),
    [timelineBuckets]
  );
  const weaponMatrix = useMemo(() => summarizeWeaponEffectivenessMatrix(aar), [aar]);
  const filteredEvents = useMemo(
    () =>
      aar.events.filter(
        (ev) =>
          (eventSideFilter === 'ALL' || ev.side === eventSideFilter) &&
          (eventKindFilter === 'ALL' || ev.kind === eventKindFilter) &&
          (eventWeaponFilter === 'ALL' || ev.weaponId === eventWeaponFilter)
      ),
    [aar.events, eventSideFilter, eventKindFilter, eventWeaponFilter]
  );

  const canJumpToReplay = Boolean(
    currentScenario && (commandHistory.length > 0 || tick > 0 || replayPlayer || Object.keys(units).length > 0)
  );

  const handleJumpToReplay = (targetTick: number) => {
    const recording =
      replayPlayer && replayPlayer.recording.untilTick >= targetTick
        ? replayPlayer.recording
        : captureBattleRecording();
    startReplayPlayer(recording, targetTick);
    setActiveModal('none');
  };

  const maxWeaponTotal = breakdowns.ammunition.topWeapons[0]?.totalCount ?? 1;
  const redAmmoPct =
    breakdowns.ammunition.total > 0
      ? (breakdowns.ammunition.redTotal / breakdowns.ammunition.total) * 100
      : 0;
  const blueAmmoPct =
    breakdowns.ammunition.total > 0
      ? (breakdowns.ammunition.blueTotal / breakdowns.ammunition.total) * 100
      : 0;

  const exportShareableReport = () => {
    const pkg = captureShareableAarPackage();
    const json = JSON.stringify(pkg, null, 2);
    if (typeof document !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${pkg.scenarioId}_aar_tick${pkg.tick}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  return (
    <ModalShell className="max-w-4xl max-h-[90dvh] flex flex-col">
      <ModalHeader
        icon={<ChartColumn className="w-4 h-4 text-amber-300" />}
        title="AFTER ACTION REVIEW // 战斗复盘与单发战果拆解"
        onClose={() => setActiveModal('none')}
        actions={(battleResult || playMode === 'sandbox') && (
          <Button size="sm" variant="outline" onClick={exportShareableReport} className="text-cyan-300">
            {exported ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Download className="w-3.5 h-3.5" />}
            <span>{exported ? '已导出战报包' : '导出可分享战报包'}</span>
          </Button>
        )}
      />
      {!battleResult && playMode !== 'sandbox' ? (
        <div className="p-6 text-sm text-amber-200">完整真值 AAR 仅在战后或显式沙盒模式开放。</div>
      ) : (
        <div className="p-4 space-y-4 text-xs overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            {(['RED', 'BLUE'] as const).map((side) => {
              const stats = aarSummary[side];
              return (
                <section key={side} className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-2">
                  <h3 className={side === 'RED' ? 'text-rose-300 font-semibold' : 'text-sky-300 font-semibold'}>{side} FORCE</h3>
                  <div className="grid grid-cols-3 gap-2 text-foreground/90 font-mono tabular-nums">
                    <span>发射 {stats.launches}</span><span>命中 {stats.hits}</span><span>命中率 {(stats.hitRate * 100).toFixed(1)}%</span>
                    <span>拦截 {stats.interceptions}</span><span>损失 {stats.losses}</span><span>出动/回收 {stats.sorties}/{stats.recoveries}</span>
                  </div>
                </section>
              );
            })}
          </div>

          <section className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-3" aria-label="兵力生存与战损对比">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-primary font-semibold">兵力生存与战损对比 (存活 / 战损)</h3>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2 rounded-xs bg-rose-500" />
                  <span>红方存活</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2 rounded-xs bg-sky-500" />
                  <span>蓝方存活</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2 rounded-xs bg-zinc-700/90 border border-white/10" />
                  <span>战损销毁</span>
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(['RED', 'BLUE'] as const).map((side) => {
                const survival = breakdowns.forceSurvival[side];
                const survivalPct = Math.round(survival.survivalRate * 100);
                const attritionPct = Math.max(0, 100 - survivalPct);
                const activeBarClass = side === 'RED' ? 'bg-rose-500' : 'bg-sky-500';
                const labelClass = side === 'RED' ? 'text-rose-300' : 'text-sky-300';
                return (
                  <div key={side} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className={`${labelClass} font-semibold`}>
                        {side === 'RED' ? '红方 RED' : '蓝方 BLUE'}
                      </span>
                      <span className="text-foreground/90">
                        存活 {survival.active} · 战损 {survival.destroyed} / 共 {survival.total} ({survivalPct}%)
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${side} 兵力存活率`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={survivalPct}
                      className="h-3 w-full rounded-full overflow-hidden bg-zinc-800/90 border border-border/70 flex"
                    >
                      {survival.total > 0 && (
                        <>
                          <div
                            className={`${activeBarClass} h-full transition-all duration-300`}
                            style={{ width: `${(survival.active / survival.total) * 100}%` }}
                            title={`存活 ${survival.active} 单位`}
                          />
                          <div
                            className="bg-zinc-700/90 h-full transition-all duration-300"
                            style={{ width: `${(survival.destroyed / survival.total) * 100}%` }}
                            title={`战损 ${survival.destroyed} 单位 (${attritionPct}%)`}
                          />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-3" aria-label="红蓝弹药消耗对比">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-primary font-semibold">弹药消耗</h3>
              {breakdowns.ammunition.total > 0 && (
                <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                  红方 {breakdowns.ammunition.redTotal} 发 ({redAmmoPct.toFixed(0)}%) · 蓝方 {breakdowns.ammunition.blueTotal} 发 ({blueAmmoPct.toFixed(0)}%)
                </span>
              )}
            </div>
            {breakdowns.ammunition.total === 0 ? (
              <p className="text-muted-foreground font-mono">尚无发射记录</p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                    <span className="text-rose-300">RED {breakdowns.ammunition.redTotal} 发</span>
                    <span className="text-muted-foreground">总消耗 {breakdowns.ammunition.total} 发</span>
                    <span className="text-sky-300">BLUE {breakdowns.ammunition.blueTotal} 发</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="红蓝双方弹药消耗占比"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(redAmmoPct)}
                    className="h-3 w-full rounded-full overflow-hidden bg-zinc-800/90 border border-border/70 flex"
                  >
                    <div
                      className="bg-rose-500 h-full transition-all duration-300"
                      style={{ width: `${redAmmoPct}%` }}
                      title={`红方消耗 ${breakdowns.ammunition.redTotal} 发`}
                    />
                    <div
                      className="bg-sky-500 h-full transition-all duration-300"
                      style={{ width: `${blueAmmoPct}%` }}
                      title={`蓝方消耗 ${breakdowns.ammunition.blueTotal} 发`}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] text-muted-foreground font-medium">主要弹种消耗分布 (Top 武器型号)</div>
                  <div className="space-y-2">
                    {breakdowns.ammunition.topWeapons.slice(0, 6).map((item) => {
                      const label = catalog.weapons[item.weaponId]?.codeName ?? item.weaponId;
                      const barScalePct = maxWeaponTotal > 0 ? (item.totalCount / maxWeaponTotal) * 100 : 0;
                      const redShare = item.totalCount > 0 ? (item.redCount / item.totalCount) * 100 : 0;
                      const blueShare = item.totalCount > 0 ? (item.blueCount / item.totalCount) * 100 : 0;
                      return (
                        <div key={item.weaponId} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                            <span className="text-foreground/95 truncate">{label}</span>
                            <span className="text-muted-foreground shrink-0">
                              <span className="text-rose-300">红 {item.redCount}</span>
                              {' / '}
                              <span className="text-sky-300">蓝 {item.blueCount}</span>
                              {' · '}
                              <span className="text-foreground font-semibold">{item.totalCount} 发</span>
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-zinc-800/80 overflow-hidden">
                            <div
                              className="h-full flex rounded-full overflow-hidden transition-all duration-300"
                              style={{ width: `${barScalePct}%` }}
                            >
                              {item.redCount > 0 && (
                                <div
                                  className="bg-rose-500 h-full"
                                  style={{ width: `${redShare}%` }}
                                />
                              )}
                              {item.blueCount > 0 && (
                                <div
                                  className="bg-sky-500 h-full"
                                  style={{ width: `${blueShare}%` }}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-2.5" aria-label="交战密度时间轴">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-primary font-semibold">交战密度时间轴 (点击柱条定位复盘时刻)</h3>
              <span className="text-[10px] text-muted-foreground font-mono">
                总时长 {Math.round(maxAarTick * FIXED_DT_SEC)}s · 共 {timelineBuckets.length} 个时间窗
              </span>
            </div>
            <div className="h-20 flex items-end gap-1 pt-2 px-2 rounded-md bg-background/60 border border-border/60">
              {timelineBuckets.map((bucket) => {
                const heightPct = bucket.totalIntensity > 0
                  ? Math.max(12, Math.round((bucket.totalIntensity / maxBucketIntensity) * 100))
                  : 4;
                const redShare = bucket.redLaunches + bucket.blueLaunches > 0
                  ? (bucket.redLaunches / (bucket.redLaunches + bucket.blueLaunches)) * 100
                  : 50;
                const startSec = Math.round(bucket.startTick * FIXED_DT_SEC);
                return (
                  <button
                    key={bucket.index}
                    type="button"
                    onClick={() => {
                      setAarReplayTick(bucket.endTick);
                      setShow3dAar(true);
                    }}
                    title={`T+${startSec}s (Tick ${bucket.startTick}~${bucket.endTick}) · 红发射 ${bucket.redLaunches} / 蓝发射 ${bucket.blueLaunches} · 命中 ${bucket.hits} · 拦截 ${bucket.interceptions} · 战损 ${bucket.losses}`}
                    className="flex-1 h-full flex flex-col justify-end group cursor-pointer"
                  >
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-t-xs overflow-hidden flex flex-col transition-opacity group-hover:opacity-100 ${
                        bucket.losses > 0
                          ? 'ring-1 ring-amber-400/80 opacity-95'
                          : bucket.totalIntensity > 0
                            ? 'opacity-85'
                            : 'bg-zinc-800/60 opacity-45'
                      }`}
                    >
                      {bucket.totalIntensity > 0 && (
                        <>
                          <div style={{ height: `${redShare}%` }} className="w-full bg-rose-500" />
                          <div style={{ height: `${100 - redShare}%` }} className="w-full bg-sky-500" />
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
              <span>T+0s</span>
              <span>琥珀描边 = 发生平台战损 · 红/蓝高度 = 火力投射密度</span>
              <span>T+{Math.round(maxAarTick * FIXED_DT_SEC)}s</span>
            </div>
          </section>

          {weaponMatrix.length > 0 && (
            <section className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-2" aria-label="单弹种效能与拦截率矩阵">
              <h3 className="text-primary font-semibold">单弹种效能与拦截率矩阵</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-mono text-[11px] tabular-nums">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-1.5 pr-2">武器型号</th>
                      <th className="py-1.5 px-2">发射(红/蓝)</th>
                      <th className="py-1.5 px-2">命中/拦弹</th>
                      <th className="py-1.5 px-2">击毁</th>
                      <th className="py-1.5 px-2">被拦(硬/软)</th>
                      <th className="py-1.5 px-2">脱靶</th>
                      <th className="py-1.5 px-2">有效率</th>
                      <th className="py-1.5 pl-2">被拦截率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weaponMatrix.map((row) => {
                      const wSpec = catalog.weapons[row.weaponId];
                      return (
                        <tr key={row.weaponId} className="border-b border-border/40 last:border-0">
                          <td className="py-1.5 pr-2 font-sans font-medium text-foreground">
                            {wSpec?.codeName ?? row.weaponId}
                          </td>
                          <td className="py-1.5 px-2">
                            {row.launched} (<span className="text-rose-300">{row.redLaunched}</span>/<span className="text-sky-300">{row.blueLaunched}</span>)
                          </td>
                          <td className="py-1.5 px-2 text-emerald-300">
                            {row.hits}{row.samKills > 0 ? `+${row.samKills}拦` : ''}
                          </td>
                          <td className="py-1.5 px-2 text-amber-300">{row.kills}</td>
                          <td className="py-1.5 px-2 text-cyan-300">
                            {row.hardIntercepted + row.softKilled} ({row.hardIntercepted}/{row.softKilled})
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground">{row.missed}</td>
                          <td className="py-1.5 px-2 font-semibold text-emerald-300">
                            {(row.effectivenessRate * 100).toFixed(0)}%
                          </td>
                          <td className="py-1.5 pl-2 text-cyan-300">
                            {(row.interceptedRate * 100).toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-2.5" aria-label="3D 交战轨迹复盘">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-cyan-300 font-semibold flex items-center gap-1.5">
                <Box className="w-4 h-4" />
                <span>3D 交战轨迹复盘</span>
              </h3>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setAarReplayTick(maxAarTick);
                  setShow3dAar((prev) => !prev);
                }}
                className="text-cyan-300 border-cyan-500/35 hover:bg-cyan-500/15"
              >
                <span>{show3dAar ? '收起 3D 复盘' : '展开 3D 交战轨迹'}</span>
              </Button>
            </div>
            {show3dAar && aarSlice && (
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-[11px] font-mono">
                  <span className="text-muted-foreground shrink-0">复盘时刻: T+{effectiveReplayTick}</span>
                  <input
                    type="range"
                    aria-label="3D 复盘时间轴"
                    min={0}
                    max={Math.max(1, maxAarTick)}
                    value={effectiveReplayTick}
                    onChange={(e) => setAarReplayTick(Number(e.target.value))}
                    className="flex-1 accent-cyan-400"
                  />
                </div>
                <Suspense
                  fallback={
                    <div className="h-[300px] rounded-md border border-cyan-500/35 bg-[#040813] flex items-center justify-center text-xs text-cyan-300 font-mono">
                      正在按需加载 3D 复盘视窗...
                    </div>
                  }
                >
                  <LazyLocalAirSeaBox3D slice={aarSlice} heightClassName="h-[300px]" />
                </Suspense>
              </div>
            )}
          </section>
          <section className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-primary font-semibold">
                单发战果与战役事件时间线 ({filteredEvents.length} / {aar.events.length})
              </h3>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Select
                  aria-label="AAR阵营筛选"
                  value={eventSideFilter}
                  onChange={(e) => setEventSideFilter(e.target.value as 'ALL' | SideId)}
                  className="h-7 w-auto min-w-[96px] text-[11px]"
                >
                  <option value="ALL">全部阵营</option>
                  <option value="RED">红方 RED</option>
                  <option value="BLUE">蓝方 BLUE</option>
                  <option value="SYSTEM">系统事件</option>
                </Select>
                <Select
                  aria-label="AAR事件类别筛选"
                  value={eventKindFilter}
                  onChange={(e) => setEventKindFilter(e.target.value as 'ALL' | AarEventKind)}
                  className="h-7 w-auto min-w-[110px] text-[11px]"
                >
                  <option value="ALL">全部类别</option>
                  <option value="launch">武器发射</option>
                  <option value="hit">目标命中</option>
                  <option value="intercept">防空拦截</option>
                  <option value="loss">平台战损</option>
                  <option value="miss">末段脱靶</option>
                  <option value="sortie">舰机出动</option>
                  <option value="recovery">安全回收</option>
                </Select>
                <Select
                  aria-label="AAR弹种筛选"
                  value={eventWeaponFilter}
                  onChange={(e) => setEventWeaponFilter(e.target.value)}
                  className="h-7 w-auto min-w-[120px] text-[11px]"
                >
                  <option value="ALL">全部弹种</option>
                  {weaponMatrix.map((w) => (
                    <option key={w.weaponId} value={w.weaponId}>
                      {catalog.weapons[w.weaponId]?.codeName ?? w.weaponId}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {filteredEvents.length === 0 ? (
              <p className="text-muted-foreground">当前筛选条件下暂无交战事件记录</p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1">
                {filteredEvents.slice(-80).reverse().map((event) => (
                  <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-background/60 border border-border/50 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground font-mono">T+{event.tick}</span>
                      <span className={event.side === 'RED' ? 'text-rose-300 font-semibold' : 'text-sky-300 font-semibold'}>{event.side}</span>
                      <span className="text-foreground truncate">{event.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      {event.shooterId && (
                        <span className="text-cyan-300">射手: {units[event.shooterId]?.callsign ?? event.shooterId}</span>
                      )}
                      {event.targetUnitId && (
                        <span className="text-amber-300">目标: {units[event.targetUnitId]?.callsign ?? event.targetUnitId}</span>
                      )}
                      {event.outcome && (
                        <Badge variant="warning">
                          {OUTCOME_BADGES[event.outcome]}
                        </Badge>
                      )}
                      {event.position && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            setAarFocusCenter(event.position);
                            setAarFocusLabel(event.title);
                            setAarReplayTick(event.tick);
                            setShow3dAar(true);
                          }}
                          className="text-cyan-300 border-cyan-500/35 hover:bg-cyan-500/15"
                          title="在 3D 剖面盒中定位此交战事件"
                        >
                          <Box className="w-2.5 h-2.5" />
                          <span>3D 定位</span>
                        </Button>
                      )}
                      {canJumpToReplay && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => handleJumpToReplay(event.tick)}
                          className="text-amber-300 border-amber-500/35 hover:bg-amber-500/15"
                          title={`跳转到 Tick ${event.tick} 进行地图回放`}
                          aria-label={`跳转回放 T+${event.tick} ${event.title}`}
                        >
                          <Play className="w-2.5 h-2.5" />
                          <span>跳转回放</span>
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="p-3.5 rounded-lg bg-muted/35 border border-border">
            <h3 className="text-primary font-semibold mb-2">完整航迹账本</h3>
            <p className="text-muted-foreground mb-2">{aarSummary.trackedUnits} 个单位 · {aarSummary.trackSamples} 个固定采样点（战斗中不向指挥视角揭示敌方真值）</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 text-foreground/90 font-mono tabular-nums">
              {[...new Set(aar.tracks.map((sample) => sample.unitId))].map((unitId) => (
                <span key={unitId}>{units[unitId]?.callsign ?? unitId}: {aar.tracks.filter((sample) => sample.unitId === unitId).length} 点</span>
              ))}
            </div>
          </section>
        </div>
      )}
    </ModalShell>
  );
};
