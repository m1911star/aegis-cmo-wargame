import { useCallback, useEffect, useRef, useState } from 'react';
import { extractSimulationWorldState, useWargameStore } from './store/useWargameStore';
import { simulationWorkerClient } from './engine/workerClient';
import { TopCommandHeader } from './components/TopCommandHeader';
import { LeftOrbatMissionSidebar } from './components/LeftOrbatMissionSidebar';
import { RightUnitTelemetryInspector } from './components/RightUnitTelemetryInspector';
import { BottomCombatLogDock } from './components/BottomCombatLogDock';
import { TacticalModals } from './components/TacticalModals';
import { TacticalMapCanvas } from './map/TacticalMapCanvas';
import { RiskEngagementDialog } from './components/FireControlDiagnostics';
import { TutorialChecklistOverlay } from './components/TutorialChecklistOverlay';
import { ActionFeedbackToast } from './components/ActionFeedbackToast';
import { ReplayPlayerBar } from './components/ReplayPlayerBar';
import { BattleResultOverlay } from './components/modals/BattleResultOverlay';
import { DraggableTacviewViewport } from './components/tacview/DraggableTacviewViewport';

export default function App() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  const leftOpenRef = useRef(leftOpen);
  const rightOpenRef = useRef(rightOpen);
  leftOpenRef.current = leftOpen;
  rightOpenRef.current = rightOpen;
  const [debriefDismissed, setDebriefDismissed] = useState(false);

  const battleResult = useWargameStore((s) => s.battleResult);
  const replayPlayer = useWargameStore((s) => s.replayPlayer);

  useEffect(() => {
    if (!battleResult) setDebriefDismissed(false);
  }, [battleResult]);

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 900px)');
    const collapse = () => { if (narrow.matches) setRightOpen(false); };
    narrow.addEventListener('change', collapse);
    return () => narrow.removeEventListener('change', collapse);
  }, []);

  useEffect(() => useWargameStore.subscribe(
    (s) => s.selectedContactId ?? s.selectedUnitId,
    (selection) => {
      if (selection) {
        setRightOpen(true);
        if (window.matchMedia('(max-width: 900px)').matches) setLeftOpen(false);
      }
    }
  ), []);

  useEffect(() => useWargameStore.subscribe(
    (s) => s.currentScenario,
    () => {
      setLeftOpen(true);
      setRightOpen(!window.matchMedia('(max-width: 900px)').matches);
    }
  ), []);

  const timeScale = useWargameStore((s) => s.timeScale);
  const stepSingleTick = useWargameStore((s) => s.stepSingleTick);

  // --------------------------------------------------------------------------
  // 1. 半实时 (RTwP) 主推演时钟循环
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (timeScale === 0) return;

    let last = performance.now();
    let backlog = 0;
    let workerBusy = false;
    let cancelled = false;
    // Speed changes the time budget, never the engine's atomic step. Keep lag rather than skip ticks.
    const timer = window.setInterval(() => {
      const now = performance.now();
      backlog += (now - last) * timeScale / 1000;
      last = now;
      const s = useWargameStore.getState();
      if (s.timeScale !== timeScale || s.battleResult) return;
      if (timeScale >= 15 && typeof Worker !== 'undefined') {
        if (workerBusy) return;
        const budget = Math.min(15, backlog);
        if (budget + s.pendingSimSeconds + 1e-9 < 0.25) return;
        workerBusy = true;
        const expectedTick = s.tick;
        const expectedSeq = s.commandSequence;
        const expectedScenarioId = s.currentScenario.id;
        void simulationWorkerClient
          .runBatch(
            extractSimulationWorldState(s),
            s.catalog,
            budget + s.pendingSimSeconds,
            s.autoPause,
            s.playerSide,
            expectedSeq
          )
          .then((result) => {
            if (cancelled) return;
            const applied = useWargameStore
              .getState()
              .applySimulationResult(result, expectedTick, expectedSeq, expectedScenarioId);
            if (applied) {
              backlog = Math.max(0, backlog - budget);
            } else if (useWargameStore.getState().currentScenario.id !== expectedScenarioId) {
              backlog = 0;
            }
          })
          .catch(() => {
            if (!cancelled) {
              backlog = Math.max(0, backlog - budget);
              stepSingleTick(budget);
            }
          })
          .finally(() => {
            workerBusy = false;
          });
        return;
      }
      const budget = Math.min(15, backlog);
      backlog -= budget;
      stepSingleTick(budget);
    }, 100);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [timeScale, stepSingleTick]);

  // --------------------------------------------------------------------------
  // 2. CMO 风格全局战术快捷键监听 (Space / F1 / F3 / F9 / Escape)
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      const state = useWargameStore.getState();

      if (e.code === 'Space') {
        // Let focused UI controls keep their native keyboard activation.
        if (target?.closest('button, summary')) return;
        e.preventDefault();
        state.setTimeScale(state.timeScale === 0 ? 5 : 0);
      } else if (e.key === 'F3') {
        e.preventDefault();
        if (state.selectedUnitId) {
          state.setInteractionMode(
            state.interactionMode === 'plot_waypoint'
              ? 'select'
              : 'plot_waypoint'
          );
        }
      } else if (e.key === 'F1') {
        e.preventDefault();
        if (state.selectedUnitId) {
          state.startManualEngage(undefined, 2);
        }
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (state.selectedUnitIds.length > 1) {
          const primary = state.units[state.selectedUnitId ?? state.selectedUnitIds[0]];
          if (primary) {
            state.batchUpdateUnitDoctrine(state.selectedUnitIds, {
              emconRadar: !primary.doctrine.emconRadar,
            });
          }
        } else if (state.selectedUnitId) {
          const u = state.units[state.selectedUnitId];
          if (u) {
            state.updateUnitDoctrine(u.id, {
              emconRadar: !u.doctrine.emconRadar,
            });
          }
        }
      } else if (e.key === 'F4') {
        e.preventDefault();
        state.toggleTacview3d();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const next = !(leftOpenRef.current || rightOpenRef.current);
        setLeftOpen(next);
        setRightOpen(next);
      } else if (e.key === 'Escape') {
        if (state.activeModal !== 'none') {
          state.setActiveModal('none');
        } else if (state.interactionMode !== 'select') {
          state.setInteractionMode('select');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleLeft = useCallback(() => {
    const next = !leftOpen;
    setLeftOpen(next);
    if (next && window.matchMedia('(max-width: 900px)').matches) {
      setRightOpen(false);
    }
  }, [leftOpen]);

  const toggleRight = useCallback(() => {
    const next = !rightOpen;
    setRightOpen(next);
    if (next && window.matchMedia('(max-width: 900px)').matches) {
      setLeftOpen(false);
    }
  }, [rightOpen]);

  return (
    <div className="app-shell bg-[#050811] text-slate-100 select-none">
      {/* 顶栏：半实时推演时钟、想定切换、视角迷雾与工具入口 */}
      <TopCommandHeader
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
      />

      {/* 中间主体区：100%全屏 WebGL 态势地图为底，左右侧栏以半透明悬浮抽屉展开 */}
      <div className="workspace">
        <div id="order-panel" className="workspace-pane order-pane" hidden={!leftOpen}>
          <LeftOrbatMissionSidebar />
        </div>
        <main className="workspace-map-stage" data-left-open={leftOpen} data-right-open={rightOpen}>
          <TacticalMapCanvas leftOpen={leftOpen} rightOpen={rightOpen} />
          <ReplayPlayerBar />
          <TutorialChecklistOverlay leftOpen={leftOpen} />
        </main>
        <div id="inspector-panel" className="workspace-pane inspector-pane" hidden={!rightOpen}>
          <RightUnitTelemetryInspector />
        </div>
      </div>
      <DraggableTacviewViewport />

      {/* 底栏：可折叠 C4ISR 实时战报事件流与战损积分大盘 */}
      <BottomCombatLogDock />

      {/* 模态框：战役简报、装备数据库、实时兵力投放、想定 JSON 序列化 */}
      <TacticalModals />
      {battleResult && !replayPlayer && !debriefDismissed && (
        <BattleResultOverlay onDismiss={() => setDebriefDismissed(true)} />
      )}
      <ActionFeedbackToast />
      <RiskEngagementDialog />
    </div>
  );
}
