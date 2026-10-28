import React, { useEffect, useState } from 'react';
import { useWargameStore } from './store/useWargameStore';
import { TopCommandHeader } from './components/TopCommandHeader';
import { LeftOrbatMissionSidebar } from './components/LeftOrbatMissionSidebar';
import { RightUnitTelemetryInspector } from './components/RightUnitTelemetryInspector';
import { BottomCombatLogDock } from './components/BottomCombatLogDock';
import { TacticalModals } from './components/TacticalModals';
import { TacticalMapCanvas } from './map/TacticalMapCanvas';

export default function App() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  useEffect(() => useWargameStore.subscribe(
    (s) => s.selectedContactId ?? s.selectedUnitId,
    (selection) => { if (selection) setRightOpen(true); }
  ), []);

  const timeScale = useWargameStore((s) => s.timeScale);
  const stepSingleTick = useWargameStore((s) => s.stepSingleTick);

  // --------------------------------------------------------------------------
  // 1. 半实时 (RTwP) 主推演时钟循环
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (timeScale === 0) return;

    // 根据倍速档位调节触发频率与单步仿真时间跨度 (保持丝滑帧率与准确物理积分)
    const configMap: Record<number, { intervalMs: number; simStepSec: number }> = {
      1: { intervalMs: 250, simStepSec: 0.25 },
      5: { intervalMs: 200, simStepSec: 1.0 },
      15: { intervalMs: 160, simStepSec: 2.4 },
      60: { intervalMs: 125, simStepSec: 7.5 },
    };

    const { intervalMs, simStepSec } = configMap[timeScale] || {
      intervalMs: 200,
      simStepSec: 1.0,
    };

    const timer = window.setInterval(() => {
      stepSingleTick(simStepSec);
    }, intervalMs);

    return () => window.clearInterval(timer);
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
        if (state.selectedUnitId) {
          const u = state.units[state.selectedUnitId];
          if (u) {
            state.updateUnitDoctrine(u.id, {
              emconRadar: !u.doctrine.emconRadar,
            });
          }
        }
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

  return (
    <div className="app-shell bg-[#050811] text-slate-100 select-none">
      {/* 顶栏：半实时推演时钟、想定切换、视角迷雾与工具入口 */}
      <TopCommandHeader
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen(!leftOpen)}
        onToggleRight={() => setRightOpen(!rightOpen)}
      />

      {/* 中间主体区：左侧 ORBAT/情报/任务树 + 中央 WebGL 海陆空战术态势图 + 右侧单元火控与遥测面板 */}
      <div className="workspace">
        <div id="order-panel" className="workspace-pane order-pane" hidden={!leftOpen}>
          <LeftOrbatMissionSidebar />
        </div>
        <main className="flex-1 h-full relative min-w-0">
          <TacticalMapCanvas />
        </main>
        <div id="inspector-panel" className="workspace-pane inspector-pane" hidden={!rightOpen}>
          <RightUnitTelemetryInspector />
        </div>
      </div>

      {/* 底栏：可折叠 C4ISR 实时战报事件流与战损积分大盘 */}
      <BottomCombatLogDock />

      {/* 模态框：战役简报、装备数据库、实时兵力投放、想定 JSON 序列化 */}
      <TacticalModals />
    </div>
  );
}
