import React, { useEffect, useRef, useState } from 'react';
import {
  Play, Pause, StepForward, RotateCcw, ShieldAlert, Eye, Database, Box, Compass,
  FileJson, PlusCircle, BookOpen, PanelLeft, PanelRight, ChartColumn, PencilRuler, Shuffle, History, Swords, Menu, Maximize, Minimize, Radar,
} from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import type { ActivePerspective, TimeScale } from '../types/wargame';
import { Select } from './ui/select';

const TIME_SCALES: TimeScale[] = [1, 5, 15, 60];
const PERSPECTIVES: { id: ActivePerspective; label: string; activeClass: string }[] = [
  { id: 'RED', label: '红方', activeClass: 'bg-rose-600 text-white' },
  { id: 'BLUE', label: '蓝方', activeClass: 'bg-sky-600 text-white' },
  { id: 'GOD', label: '全局', activeClass: 'bg-amber-500 text-slate-950' },
];

type HeaderProps = {
  leftOpen: boolean;
  rightOpen: boolean;
  compact: boolean;
  onToggleMapOnly: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
};

const SimulationDebugStatus = React.memo(function SimulationDebugStatus() {
  const seed = useWargameStore((state) => state.seed);
  const tick = useWargameStore((state) => state.tick);
  return <p className="mt-2 text-slate-500">种子 {seed} · Tick {tick}</p>;
});

export const TopCommandHeader = React.memo(function TopCommandHeader({
  leftOpen, rightOpen, compact, onToggleLeft, onToggleRight, onToggleMapOnly,
}: HeaderProps) {
  const currentScenario = useWargameStore((s) => s.currentScenario);
  const availableScenarios = useWargameStore((s) => s.availableScenarios);
  const loadScenario = useWargameStore((s) => s.loadScenario);
  const resetScenario = useWargameStore((s) => s.resetScenario);
  const simTimeSecond = useWargameStore((s) => Math.floor(s.simTime / 1000));
  const timeScale = useWargameStore((s) => s.timeScale);
  const setTimeScale = useWargameStore((s) => s.setTimeScale);
  const stepSingleTick = useWargameStore((s) => s.stepSingleTick);
  const activePerspective = useWargameStore((s) => s.activePerspective);
  const setActivePerspective = useWargameStore((s) => s.setActivePerspective);
  const autoPause = useWargameStore((s) => s.autoPause);
  const toggleAutoPause = useWargameStore((s) => s.toggleAutoPause);
  const lastAutoPauseBanner = useWargameStore((s) => s.lastAutoPauseBanner);
  const clearAutoPauseBanner = useWargameStore((s) => s.clearAutoPauseBanner);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const playerSide = useWargameStore((s) => s.playerSide);
  const playMode = useWargameStore((s) => s.playMode);
  const weather = useWargameStore((s) => s.environment.weather);
  const battleResult = useWargameStore((s) => s.battleResult);
  const campaignState = useWargameStore((s) => s.campaignState);
  const startCampaign = useWargameStore((s) => s.startCampaign);
  const exitCampaign = useWargameStore((s) => s.exitCampaign);
  const hasAutosave = useWargameStore((s) => s.hasAutosave);
  const restoreAutosaveCheckpoint = useWargameStore((s) => s.restoreAutosaveCheckpoint);
  const exitReplayPlayer = useWargameStore((s) => s.exitReplayPlayer);
  const replayOpen = useWargameStore((s) => s.replayPlayer !== null);
  const hasStarted = useWargameStore((s) => s.tick > 0);
  const setPlayerSide = useWargameStore((s) => s.setPlayerSide);
  const setPlayMode = useWargameStore((s) => s.setPlayMode);
  const tacview3dOpen = useWargameStore((s) => s.tacview3dOpen);
  const toggleTacview3d = useWargameStore((s) => s.toggleTacview3d);
  const [randomizeSpawns, setRandomizeSpawns] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<
    | { type: 'reset'; randomize: boolean }
    | { type: 'switch'; scenarioId: string }
    | null
  >(null);
  const utc = new Date(simTimeSecond * 1000).toISOString();

  const toolsRef = useRef<HTMLDetailsElement>(null);
  const mapOnly = !leftOpen && !rightOpen;

  useEffect(() => {
    if (!compact) return;
    const dismissOutside = (event: PointerEvent) => {
      const menu = toolsRef.current;
      if (menu?.open && event.target instanceof Element &&
          !menu.contains(event.target) && !event.target.closest('[role="listbox"]')) menu.open = false;
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [compact]);

  const handleScenarioChange = (scenarioId: string) => {
    const found = availableScenarios.find((s) => s.id === scenarioId);
    if (!found) return;
    if (hasStarted && !battleResult) {
      setPendingConfirm({ type: 'switch', scenarioId });
      return;
    }
    exitReplayPlayer();
    loadScenario(found, randomizeSpawns);
  };

  const handleResetClick = (randomize = randomizeSpawns) => {
    if (hasStarted && !battleResult) {
      setPendingConfirm({ type: 'reset', randomize });
      return;
    }
    exitReplayPlayer();
    resetScenario(randomize);
  };

  const briefAndSeat = (
    <>
      <button
        type="button"
        onClick={() => setActiveModal('briefing')}
        className="toolbar-button toolbar-button-subtle"
        title="查看想定简报"
      >
        <BookOpen /><span>简报</span>
      </button>
      <Select
        aria-label="控制席位"
        title={campaignState ? '控制席位由战役开局选择固定' : '开局选择控制席位；观察视角不会改变控制权'}
        disabled={replayOpen || Boolean(campaignState) || hasStarted || timeScale !== 0}
        value={playerSide}
        onChange={(e) => setPlayerSide(e.target.value as 'RED' | 'BLUE')}
        className="w-auto min-w-[90px] h-7 text-[11px]"
      >
        <option value="RED">指挥红方</option>
        <option value="BLUE">指挥蓝方</option>
      </Select>
    </>
  );

  const modeControls = (
    <div className="mode-controls" role="group" aria-label="推演模式">
      <button
        type="button"
        onClick={() => (campaignState ? exitCampaign() : startCampaign())}
        className={`toolbar-button ${campaignState ? 'text-amber-200 border-amber-500/45 bg-amber-500/15' : 'text-cyan-200/90 border-cyan-500/25 bg-cyan-500/[0.06] hover:bg-cyan-500/15'}`}
        title={campaignState ? '退出战役连贯模式' : '开启五阶段西太联合战役（继承战损与稀缺弹药）'}
      >
        <span>
          {campaignState
            ? `战役 ${campaignState.currentStageIndex + 1}/${campaignState.totalStages}`
            : '战役模式'}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setActiveModal('campaign')}
        className="toolbar-button text-amber-200/90 border-amber-500/30 bg-amber-500/[0.08] hover:bg-amber-500/15"
        title="打开五阶段战役战区态势、稀缺弹药账本与战间补给差值预览"
      >
        <Compass /><span>战区态势</span>
      </button>
      <button
        type="button"
        onClick={() => setActiveModal('skirmish')}
        className="toolbar-button text-cyan-200/90 border-cyan-500/25 bg-cyan-500/[0.06] hover:bg-cyan-500/15"
        title="选择战区模板、双方军队配置与气象一键生成自由遭遇战"
      >
        <Swords /><span>遭遇战</span>
      </button>
      <button
        type="button"
        className={`toolbar-button ${playMode === 'sandbox' ? 'text-emerald-200 border-emerald-500/45 bg-emerald-500/15' : 'toolbar-button-subtle'}`}
        aria-pressed={playMode === 'sandbox'}
        title="沙盒模式可编辑双方；与观察视角独立"
        onClick={() => setPlayMode(playMode === 'command' ? 'sandbox' : 'command')}
      >
        {playMode === 'sandbox' ? '沙盒模式' : '指挥模式'}
      </button>
      <button
        type="button"
        disabled={playMode !== 'sandbox'}
        onClick={() => setActiveModal('builder')}
        title={playMode === 'sandbox' ? '打开可视化想定编辑器' : '切换至沙盒模式后可编辑想定'}
        className={`toolbar-button ${playMode === 'sandbox' ? 'text-emerald-200 border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20' : 'toolbar-button-subtle opacity-40 cursor-not-allowed'}`}
      >
        <PencilRuler /><span>想定编辑</span>
      </button>
    </div>
  );

  const utilityControls = (
    <div className="utility-controls" role="group" aria-label="辅助工具">
      {hasAutosave && !hasStarted && (
        <button
          type="button"
          onClick={() => { void restoreAutosaveCheckpoint(); }}
          className="toolbar-button toolbar-button-subtle text-emerald-300 border-emerald-500/30 hover:border-emerald-400/50 hover:bg-emerald-500/10"
          title="恢复浏览器本地自动保存的上一局断点"
        >
          <History /><span>恢复自动存档</span>
        </button>
      )}
      {playMode === 'sandbox' && (
        <button
          type="button"
          onClick={() => setActiveModal('unit_spawner')}
          className="toolbar-button toolbar-button-subtle text-emerald-300 border-emerald-500/30 hover:border-emerald-400/50 hover:bg-emerald-500/10"
          title="向当前战场实时投放新兵力"
        >
          <PlusCircle /><span>兵力投放</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => setActiveModal('catalog_viewer')}
        className="toolbar-button toolbar-button-subtle"
        title="查阅红蓝双方平台、传感器与武器数据库"
      >
        <Database /><span>装备库</span>
      </button>
      <button
        type="button"
        onClick={() => setActiveModal('scenario_io')}
        className="toolbar-button toolbar-button-subtle"
        title="导入导出想定 JSON、管理存档与指令重放"
      >
        <FileJson /><span>想定管理</span>
      </button>
      <button
        type="button"
        disabled={!battleResult && playMode !== 'sandbox'}
        onClick={() => setActiveModal('aar')}
        className={`toolbar-button toolbar-button-subtle ${battleResult || playMode === 'sandbox' ? 'text-amber-300 border-amber-500/30 hover:border-amber-400/50 hover:bg-amber-500/10' : 'opacity-40 cursor-not-allowed'}`}
        title="战后或沙盒模式可查看完整真值复盘"
      >
        <ChartColumn /><span>战后复盘</span>
      </button>
    </div>
  );

  const restartControls = (
    <div className="restart-controls">
      <button
        type="button"
        onClick={() => handleResetClick(randomizeSpawns)}
        aria-label="重置当前想定"
        title="使用当前种子或随机散布重新开局"
        className="toolbar-button toolbar-button-subtle icon-button"
      >
        <RotateCcw />{compact && <span>重置想定</span>}
      </button>
      <button
        type="button"
        onClick={() => setRandomizeSpawns((prev) => !prev)}
        aria-label="随机开局"
        aria-pressed={randomizeSpawns}
        title="开局随机散布与随机种子开关"
        className={`toolbar-button toolbar-button-subtle icon-button ${randomizeSpawns ? 'text-amber-300 border-amber-400/50 bg-amber-500/10' : ''}`}
      >
        <Shuffle />{compact && <span>随机开局</span>}
      </button>
    </div>
  );

  const pauseSettings = (
    <details className="pause-settings">
      <summary
        className={`toolbar-button toolbar-button-subtle ${autoPause.onNewContact || autoPause.onMissileDetected || autoPause.onUnitHitOrDestroyed ? 'text-amber-300 border-amber-500/35 bg-amber-500/10' : ''}`}
        title="默认全部关闭，由你手动控制暂停"
      >
        <ShieldAlert />
        <span>
          自动暂停
          {autoPause.onNewContact || autoPause.onMissileDetected || autoPause.onUnitHitOrDestroyed
            ? ` (${Number(autoPause.onNewContact) + Number(autoPause.onMissileDetected) + Number(autoPause.onUnitHitOrDestroyed)})`
            : ' (关)'}
        </span>
      </summary>
      <div className="pause-popover tactical-panel">
        <div className="mb-2 flex items-center justify-between gap-2 text-slate-400">
          <span>自动暂停触发器</span>
          {(autoPause.onNewContact || autoPause.onMissileDetected || autoPause.onUnitHitOrDestroyed) && (
            <button
              type="button"
              onClick={() => {
                if (autoPause.onNewContact) toggleAutoPause('onNewContact');
                if (autoPause.onMissileDetected) toggleAutoPause('onMissileDetected');
                if (autoPause.onUnitHitOrDestroyed) toggleAutoPause('onUnitHitOrDestroyed');
              }}
              className="text-[10px] text-cyan-300 underline cursor-pointer"
            >
              全部关闭
            </button>
          )}
        </div>
        <label><input type="checkbox" checked={autoPause.onNewContact} onChange={() => toggleAutoPause('onNewContact')} />发现新目标</label>
        <label><input type="checkbox" checked={autoPause.onMissileDetected} onChange={() => toggleAutoPause('onMissileDetected')} />收到导弹告警</label>
        <label><input type="checkbox" checked={autoPause.onUnitHitOrDestroyed} onChange={() => toggleAutoPause('onUnitHitOrDestroyed')} />本方受损或损失</label>
        <SimulationDebugStatus />
      </div>
    </details>
  );

  const clock = (
    <div className="mission-clock" title={`推演时间 ${utc.slice(0, 10)}（协调世界时）`}>
      <span>{compact ? '战场 UTC' : `${utc.slice(0, 10)} · UTC`}</span>
      <time dateTime={utc}>{utc.slice(11, 19)}</time>
    </div>
  );

  const weatherBadge = (
    weather && (
      <span
        className="weather-badge"
        title={`云底 ${weather.cloudFloorM}m ~ 云顶 ${weather.cloudCeilingM}m（穿云衰减光电/红外探测）`}
      >
        {weather.condition === 'clear'
          ? '晴空'
          : weather.condition === 'overcast'
            ? '阴云层'
            : weather.condition === 'rain_storm'
              ? '雷暴锋面'
              : '台风外围'}{' '}
        · {weather.seaState}级海况
      </span>
    )
  );

  const perspectives = (
    <div className="perspective-controls" role="group" aria-label="战场视角">
      <Eye className="text-slate-500" />
      {PERSPECTIVES.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={activePerspective === item.id}
          onClick={() => setActivePerspective(item.id)}
          className={activePerspective === item.id ? item.activeClass : 'text-slate-400 hover:text-slate-200'}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  const playback = (
    <div className="playback-controls">
      <div className="speed-controls" role="group" aria-label="推演倍速">
        {TIME_SCALES.map((scale) => (
          <button
            key={scale}
            type="button"
            aria-pressed={timeScale === scale}
            disabled={!!battleResult}
            onClick={() => setTimeScale(scale)}
            className={timeScale === scale ? 'is-active' : ''}
          >
            {scale}×
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => stepSingleTick(5)}
        disabled={!!battleResult}
        aria-label="+5秒"
        title="单步推进 5 秒"
        className="toolbar-button toolbar-button-subtle"
      >
        <StepForward />{!compact && <span>+5秒</span>}
      </button>
      <button
        type="button"
        onClick={() => setTimeScale(timeScale === 0 ? 5 : 0)}
        disabled={!!battleResult}
        title="空格键：暂停或继续推演"
        className={`toolbar-button playback-toggle ${timeScale === 0 ? 'is-paused' : 'is-running'}`}
      >
        {timeScale === 0 ? <Play /> : <Pause />}
        <span>{battleResult ? '推演结束' : timeScale === 0 ? '开始推演' : '暂停推演'}</span>
      </button>
    </div>
  );

  const panelControls = (
    <div className="panel-controls" role="group" aria-label="工作区面板">
      <button
        type="button"
        onClick={onToggleLeft}
        aria-expanded={leftOpen}
        aria-controls="order-panel"
        className={`toolbar-button toolbar-button-subtle ${leftOpen ? 'panel-active' : ''}`}
      >
        <PanelLeft /><span>编制</span>
      </button>
      <button
        type="button"
        onClick={onToggleRight}
        aria-expanded={rightOpen}
        aria-controls="inspector-panel"
        className={`toolbar-button toolbar-button-subtle ${rightOpen ? 'panel-active' : ''}`}
      >
        <PanelRight /><span>详情</span>
      </button>
      <button
        type="button"
        onClick={() => toggleTacview3d()}
        aria-expanded={tacview3dOpen}
        aria-controls="tacview-3d-floating-window"
        title="快捷键 [F4]：打开/关闭可拖拽独立 3D 空海剖面视窗"
        className={`toolbar-button toolbar-button-subtle ${tacview3dOpen ? 'panel-active text-cyan-300' : ''}`}
      >
        <Box /><span>3D视窗</span>
      </button>
      <button
        type="button"
        onClick={onToggleMapOnly}
        aria-pressed={mapOnly}
        aria-keyshortcuts="Alt+M"
        title="Alt+M：切换纯地图视图"
        className={`toolbar-button toolbar-button-subtle ${mapOnly ? 'panel-active' : ''}`}
      >
        {mapOnly ? <Minimize /> : <Maximize />}<span>纯地图</span>
      </button>
    </div>
  );

  return (
    <header className="command-header">
      <div className="command-row command-primary">
        <div className="scenario-controls">
          <div className="brand-mark" title="AEGIS-CMO 指挥台"><Radar aria-hidden="true" /><span>AEGIS-CMO</span></div>
          <Select
            aria-label="选择战役想定"
            title={currentScenario.title}
            value={currentScenario.id}
            onChange={(e) => handleScenarioChange(e.target.value)}
            wrapperClassName="scenario-select"
            className="h-8 text-xs"
          >
            {availableScenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>{sc.title.replace(' // ', ' · ')}</option>
            ))}
          </Select>
          {!compact && <>{briefAndSeat}<div className="header-divider" aria-hidden="true" />{modeControls}</>}
        </div>
        {compact ? (
          <details ref={toolsRef} className="command-tools" onKeyDown={(e) => {
            if (e.key === 'Escape' && toolsRef.current?.open) {
              e.preventDefault();
              toolsRef.current.open = false;
              toolsRef.current.querySelector('summary')?.focus();
            }
          }}>
            <summary className="toolbar-button"><Menu /><span>更多工具</span></summary>
            <div className="command-tools-popover" onClick={(e) => {
              const button = e.target instanceof Element && e.target.closest('button');
              if (button && !button.closest('.restart-controls, .pause-settings') &&
                  !button.hasAttribute('aria-haspopup') && toolsRef.current) {
                toolsRef.current.open = false;
                toolsRef.current.querySelector('summary')?.focus();
              }
            }}>
              <div className="command-tools-section"><span>想定与席位</span><div>{briefAndSeat}{restartControls}{weatherBadge}</div></div>
              <div className="command-tools-section"><span>推演模式</span>{modeControls}</div>
              <div className="command-tools-section"><span>管理与显示</span>{utilityControls}{pauseSettings}</div>
            </div>
          </details>
        ) : utilityControls}
      </div>
      <div className="command-row command-secondary">
        <div className="simulation-context">{clock}{!compact && <>{weatherBadge}{restartControls}</>}</div>
        <div className="view-controls">
          {replayOpen ? <span className="replay-mode-indicator">正在回放</span> : playback}
          {compact ? (
            <Select aria-label="战场视角" value={activePerspective}
              onChange={(e) => setActivePerspective(e.target.value as ActivePerspective)}
              wrapperClassName="compact-perspective" className="h-8 text-xs">
              {PERSPECTIVES.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </Select>
          ) : <>{perspectives}{pauseSettings}<div className="header-divider" aria-hidden="true" /></>}
          {panelControls}
        </div>
      </div>
      {pendingConfirm && (
        <div className="auto-pause-banner" role="alertdialog" aria-label="确认重置或切换想定">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            {pendingConfirm.type === 'reset'
              ? '当前推演正在进行中，确认重置本局战场并回到 Tick 0 吗？'
              : '当前推演正在进行中，确认放弃当前进度并切换至新想定吗？'}
          </span>
          <button
            type="button"
            onClick={() => {
              if (pendingConfirm.type === 'reset') {
                exitReplayPlayer();
                resetScenario(pendingConfirm.randomize);
              } else {
                const found = availableScenarios.find((s) => s.id === pendingConfirm.scenarioId);
                if (found) {
                  exitReplayPlayer();
                  loadScenario(found, randomizeSpawns);
                }
              }
              setPendingConfirm(null);
            }}
            className="toolbar-button bg-rose-700 text-white"
          >
            确认执行
          </button>
          <button type="button" onClick={() => setPendingConfirm(null)} className="toolbar-button">取消</button>
        </div>
      )}
      {lastAutoPauseBanner && (
        <div className="auto-pause-banner" role="status">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>已自动暂停 · {lastAutoPauseBanner}</span>
          <button type="button" onClick={clearAutoPauseBanner} className="toolbar-button">知道了</button>
        </div>
      )}
    </header>
  );
});
