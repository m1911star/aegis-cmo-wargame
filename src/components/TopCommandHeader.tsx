import React from 'react';
import {
  Play, Pause, StepForward, RotateCcw, ShieldAlert, Eye, Database,
  FileJson, PlusCircle, BookOpen, PanelLeft, PanelRight,
} from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import type { ActivePerspective, TimeScale } from '../types/wargame';

const TIME_SCALES: TimeScale[] = [1, 5, 15, 60];
const PERSPECTIVES: { id: ActivePerspective; label: string; activeClass: string }[] = [
  { id: 'RED', label: '红方', activeClass: 'bg-rose-600 text-white' },
  { id: 'BLUE', label: '蓝方', activeClass: 'bg-sky-600 text-white' },
  { id: 'GOD', label: '全局', activeClass: 'bg-amber-500 text-slate-950' },
];

type HeaderProps = {
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
};

const SimulationDebugStatus = React.memo(function SimulationDebugStatus() {
  const seed = useWargameStore((state) => state.seed);
  const tick = useWargameStore((state) => state.tick);
  return <p className="mt-2 text-slate-500">种子 {seed} · Tick {tick}</p>;
});

export const TopCommandHeader = React.memo(function TopCommandHeader({
  leftOpen, rightOpen, onToggleLeft, onToggleRight,
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
  const hasStarted = useWargameStore((s) => s.tick > 0);
  const setPlayerSide = useWargameStore((s) => s.setPlayerSide);
  const setPlayMode = useWargameStore((s) => s.setPlayMode);
  const utc = new Date(simTimeSecond * 1000).toISOString();

  return (
    <header className="command-header tactical-panel">
      <div className="command-row command-primary">
        <div className="scenario-controls">
          <div className="brand-mark"><i /> <span>AEGIS-CMO</span></div>
          <select
            aria-label="选择战役想定"
            title={currentScenario.title}
            value={currentScenario.id}
            onChange={(e) => {
              const found = availableScenarios.find((s) => s.id === e.target.value);
              if (found) loadScenario(found);
            }}
            className="scenario-select"
          >
            {availableScenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>{sc.title.replace(' // ', ' · ')}</option>
            ))}
          </select>
          <button onClick={() => setActiveModal('briefing')} className="toolbar-button" title="查看想定简报">
            <BookOpen /><span>简报</span>
          </button>
        </div>
        <div className="utility-controls">
          <select aria-label="控制席位" title="开局选择控制席位；观察视角不会改变控制权" disabled={hasStarted || timeScale !== 0}
            value={playerSide} onChange={(e) => setPlayerSide(e.target.value as 'RED' | 'BLUE')} className="bg-slate-900 rounded p-1 text-xs">
            <option value="RED">指挥红方</option><option value="BLUE">指挥蓝方</option>
          </select>
          <button className="toolbar-button" aria-pressed={playMode === 'sandbox'} title="沙盒模式可编辑双方；与观察视角独立"
            onClick={() => setPlayMode(playMode === 'command' ? 'sandbox' : 'command')}>{playMode === 'sandbox' ? '沙盒编辑中' : '指挥模式'}</button>
          <button disabled={playMode !== 'sandbox'} onClick={() => setActiveModal('unit_spawner')} className="toolbar-button text-emerald-300 disabled:opacity-40">
            <PlusCircle /><span>兵力投放</span>
          </button>
          <button onClick={() => setActiveModal('catalog_viewer')} className="toolbar-button">
            <Database /><span>装备库</span>
          </button>
          <button onClick={() => setActiveModal('scenario_io')} className="toolbar-button">
            <FileJson /><span>想定管理</span>
          </button>
          <details className="pause-settings">
            <summary className="toolbar-button"><ShieldAlert /><span>自动暂停</span></summary>
            <div className="pause-popover tactical-panel">
              <div className="mb-3 text-slate-400">遇到以下情况时暂停推演</div>
              <label><input type="checkbox" checked={autoPause.onNewContact} onChange={() => toggleAutoPause('onNewContact')} />发现新目标</label>
              <label><input type="checkbox" checked={autoPause.onMissileDetected} onChange={() => toggleAutoPause('onMissileDetected')} />收到导弹告警</label>
              <label><input type="checkbox" checked={autoPause.onUnitHitOrDestroyed} onChange={() => toggleAutoPause('onUnitHitOrDestroyed')} />本方受损或损失</label>
              <SimulationDebugStatus />
            </div>
          </details>
        </div>
      </div>

      <div className="command-row command-secondary">
        <div className="simulation-controls">
          <div className="mission-clock" title={`推演时间 ${utc.slice(0, 10)}（协调世界时）`}>
            <span>{utc.slice(0, 10)} · UTC</span>
            <time dateTime={utc}>{utc.slice(11, 19)}</time>
          </div>
          <div className="playback-controls">
            <button
              onClick={() => setTimeScale(timeScale === 0 ? 5 : 0)}
              title="空格键：暂停或继续推演"
              className={`toolbar-button playback-toggle ${timeScale === 0 ? 'is-paused' : 'is-running'}`}
            >
              {timeScale === 0 ? <Play /> : <Pause />}
              <span>{timeScale === 0 ? '开始推演' : '暂停推演'}</span>
            </button>
            <div className="speed-controls" role="group" aria-label="推演倍速">
              {TIME_SCALES.map((scale) => (
                <button key={scale} aria-pressed={timeScale === scale} onClick={() => setTimeScale(scale)} className={timeScale === scale ? 'is-active' : ''}>
                  {scale}×
                </button>
              ))}
            </div>
            <button onClick={() => stepSingleTick(5)} title="单步推进 5 秒" className="toolbar-button">
              <StepForward /><span>+5秒</span>
            </button>
            <button onClick={() => resetScenario()} aria-label="重置当前想定" title="使用相同种子重新开局" className="toolbar-button icon-button">
              <RotateCcw />
            </button>
          </div>
        </div>
        <div className="view-controls">
          <div className="perspective-controls" role="group" aria-label="战场视角">
            <Eye className="text-slate-500" />
            {PERSPECTIVES.map((item) => (
              <button key={item.id} aria-pressed={activePerspective === item.id} onClick={() => setActivePerspective(item.id)} className={activePerspective === item.id ? item.activeClass : 'text-slate-400'}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="panel-controls">
            <button onClick={onToggleLeft} aria-expanded={leftOpen} aria-controls="order-panel" className={`toolbar-button ${leftOpen ? 'panel-active' : ''}`}>
              <PanelLeft /><span>编制</span>
            </button>
            <button onClick={onToggleRight} aria-expanded={rightOpen} aria-controls="inspector-panel" className={`toolbar-button ${rightOpen ? 'panel-active' : ''}`}>
              <PanelRight /><span>详情</span>
            </button>
          </div>
        </div>
      </div>
      {lastAutoPauseBanner && (
        <div className="auto-pause-banner" role="status">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>已自动暂停 · {lastAutoPauseBanner}</span>
          <button onClick={clearAutoPauseBanner} className="toolbar-button">知道了</button>
        </div>
      )}
    </header>
  );
});
