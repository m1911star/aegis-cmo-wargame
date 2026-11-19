import { useCallback, useEffect, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { extractSimulationWorldState, useWargameStore, type WargameStoreState } from './store/useWargameStore';
import { INFORMATION_EXERCISE } from './scenarios/informationExercise';
import type { ScenarioDefinition } from './types/wargame';
import { simulationWorkerClient } from './engine/workerClient';
import { TopCommandHeader } from './components/TopCommandHeader';
import { LeftOrbatMissionSidebar } from './components/LeftOrbatMissionSidebar';
import { RightUnitTelemetryInspector } from './components/RightUnitTelemetryInspector';
import { BottomCombatLogDock } from './components/BottomCombatLogDock';
import { TacticalModals } from './components/TacticalModals';
import { TacticalMapCanvas } from './map/TacticalMapCanvas';
import { RiskEngagementDialog } from './components/FireControlDiagnostics';
import { TutorialChecklistOverlay } from './components/TutorialChecklistOverlay';
import { FirstExerciseCard } from './components/FirstExerciseCard';
import { ActionFeedbackToast } from './components/ActionFeedbackToast';
import { ReplayPlayerBar } from './components/ReplayPlayerBar';
import { BattleResultOverlay } from './components/modals/BattleResultOverlay';
import { DraggableTacviewViewport } from './components/tacview/DraggableTacviewViewport';

const NARROW_WORKSPACE = '(max-width: 900px)';
const isNarrowWorkspace = () => window.matchMedia(NARROW_WORKSPACE).matches;

type WorkspacePanels = { order: boolean; inspector: boolean };
const initialPanels = (): WorkspacePanels => {
  const wide = !isNarrowWorkspace();
  return { order: wide, inspector: wide };
};

const selectOpeningScenario = (s: WargameStoreState) => (
  s.currentScenario.id === INFORMATION_EXERCISE.id && s.playMode === 'command' && !s.campaignState &&
  s.tick === 0 && s.timeScale === 0 && s.pendingSimSeconds === 0 && !s.replayPlayer && !s.battleResult
) ? s.currentScenario : null;

export default function App() {
  const [panels, setPanels] = useState(initialPanels);
  const [compact, setCompact] = useState(isNarrowWorkspace);
  const [debriefDismissed, setDebriefDismissed] = useState(false);
  const [dismissedOpening, setDismissedOpening] = useState<ScenarioDefinition | null>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const focusInspector = useRef(false);

  const battleResult = useWargameStore((s) => s.battleResult);
  const modalOpen = useWargameStore((s) => s.activeModal !== 'none');
  const replayPlayer = useWargameStore((s) => s.replayPlayer);
  const openingScenario = useWargameStore(selectOpeningScenario);
  const showOpening = openingScenario !== null && openingScenario !== dismissedOpening;

  useEffect(() => { void useWargameStore.getState().refreshAutosaveAvailability(); }, []);

  useEffect(() => {
    if (!battleResult) setDebriefDismissed(false);
  }, [battleResult]);

  useEffect(() => {
    const narrow = window.matchMedia(NARROW_WORKSPACE);
    const onResize = () => {
      setCompact(narrow.matches);
      if (narrow.matches) setPanels((current) => current.inspector ? { order: false, inspector: true } : current);
    };
    narrow.addEventListener('change', onResize);
    return () => narrow.removeEventListener('change', onResize);
  }, []);

  const openInspector = useCallback(() => {
    setPanels((current) => ({ order: !isNarrowWorkspace() && current.order, inspector: true }));
  }, []);

  useEffect(() => useWargameStore.subscribe(
    (s) => [s.selectedContactId ?? s.selectedUnitId, s.playerSide] as const,
    ([selection, side], [, previousSide]) => {
      if (side !== previousSide && isNarrowWorkspace()) {
        const opening = selectOpeningScenario(useWargameStore.getState());
        if (opening && opening !== dismissedOpening) {
          setPanels(initialPanels());
          return;
        }
      }
      if (selection) openInspector();
    },
    { equalityFn: shallow },
  ), [openInspector, dismissedOpening]);

  useEffect(() => {
    if (panels.inspector && focusInspector.current) {
      focusInspector.current = false;
      inspectorRef.current?.focus({ preventScroll: true });
    }
  }, [panels]);

  useEffect(() => useWargameStore.subscribe(
    (s) => s.currentScenario,
    () => setPanels(initialPanels())
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

  const toggleMapOnly = useCallback(() => {
    setPanels((current) => {
      const show = !current.order && !current.inspector;
      return { order: show, inspector: show && !isNarrowWorkspace() };
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      const state = useWargameStore.getState();
      if (state.activeModal !== 'none' || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyM') {
        e.preventDefault();
        if (!e.repeat) toggleMapOnly();
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey || e.key === 'Tab') return;

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
      } else if (e.key === 'Escape') {
        if (state.interactionMode === 'draw_polygon') {
          state.cancelPolygonDraw();
        } else if (state.interactionMode !== 'select') {
          state.setInteractionMode('select');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleMapOnly]);

  const toggleLeft = useCallback(() => {
    setPanels(({ order, inspector }) => ({ order: !order, inspector: (order || !isNarrowWorkspace()) && inspector }));
  }, []);

  const toggleRight = useCallback(() => {
    setPanels(({ order, inspector }) => ({ order: (inspector || !isNarrowWorkspace()) && order, inspector: !inspector }));
  }, []);

  return (
    <div className="app-shell bg-[#050811] text-slate-100 select-none">
      {/* 顶栏：半实时推演时钟、想定切换、视角迷雾与工具入口 */}
      <TopCommandHeader
        leftOpen={panels.order}
        rightOpen={panels.inspector}
        compact={compact}
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
        onToggleMapOnly={toggleMapOnly}
      />
      <ReplayPlayerBar />

      {/* 中间主体区：100%全屏 WebGL 态势地图为底，左右侧栏以半透明悬浮抽屉展开 */}
      <div className="workspace">
        <div id="order-panel" className="workspace-pane order-pane" hidden={!panels.order}>
          <LeftOrbatMissionSidebar />
        </div>
        <main className="workspace-map-stage" data-left-open={panels.order} data-right-open={panels.inspector}>
          <TacticalMapCanvas leftOpen={panels.order} rightOpen={panels.inspector} />
          <TutorialChecklistOverlay leftOpen={panels.order} />
          {showOpening && !(compact && (panels.order || panels.inspector)) && (
            <FirstExerciseCard
              onDismiss={() => setDismissedOpening(openingScenario)}
              onContactOpened={() => {
                focusInspector.current = true;
                openInspector();
              }}
            />
          )}
        </main>
        <div
          ref={inspectorRef}
          id="inspector-panel"
          role="region"
          aria-label="详情"
          tabIndex={-1}
          className="workspace-pane inspector-pane"
          hidden={!panels.inspector}
        >
          <RightUnitTelemetryInspector />
        </div>
      </div>
      <DraggableTacviewViewport />

      {/* 底栏：可折叠 C4ISR 实时战报事件流与战损积分大盘 */}
      <BottomCombatLogDock />

      {/* 模态框：战役简报、装备数据库、实时兵力投放、想定 JSON 序列化 */}
      <TacticalModals />
      {battleResult && !replayPlayer && !modalOpen && !debriefDismissed && (
        <BattleResultOverlay onDismiss={() => setDebriefDismissed(true)} />
      )}
      <ActionFeedbackToast />
      <RiskEngagementDialog />
    </div>
  );
}
