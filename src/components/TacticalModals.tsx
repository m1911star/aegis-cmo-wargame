import React from 'react';
import { useWargameStore } from '../store/useWargameStore';
import { AarDebriefModal } from './modals/AarDebriefModal';
import { BriefingModal } from './modals/BriefingModal';
import { CatalogViewerModal } from './modals/CatalogViewerModal';
import { ScenarioBuilderModal } from './modals/ScenarioBuilderModal';
import { ScenarioIoModal } from './modals/ScenarioIoModal';
import { UnitSpawnerModal } from './modals/UnitSpawnerModal';

export const TacticalModals: React.FC = () => {
  const activeModal = useWargameStore((s) => s.activeModal);
  const playMode = useWargameStore((s) => s.playMode);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  if (activeModal === 'none') return null;

  const isUgcMode = activeModal === 'builder' || activeModal === 'unit_spawner' || activeModal === 'scenario_io';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-4 font-mono gap-2"
    >
      {isUgcMode && (
        <div className="flex items-center gap-1.5 bg-slate-950/90 border border-cyan-500/30 rounded-md p-1 text-xs">
          <button
            onClick={() => setActiveModal('scenario_io')}
            className={`px-3 py-1 rounded cursor-pointer ${activeModal === 'scenario_io' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'}`}
          >
            想定与回放 I/O
          </button>
          <button
            disabled={playMode !== 'sandbox'}
            onClick={() => setActiveModal('builder')}
            className={`px-3 py-1 rounded cursor-pointer disabled:opacity-35 ${activeModal === 'builder' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'}`}
          >
            想定编辑 (沙盒)
          </button>
          <button
            disabled={playMode !== 'sandbox'}
            onClick={() => setActiveModal('unit_spawner')}
            className={`px-3 py-1 rounded cursor-pointer disabled:opacity-35 ${activeModal === 'unit_spawner' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'}`}
          >
            兵力投放 (沙盒)
          </button>
        </div>
      )}
      {activeModal === 'briefing' && <BriefingModal />}
      {activeModal === 'catalog_viewer' && <CatalogViewerModal />}
      {activeModal === 'unit_spawner' && <UnitSpawnerModal />}
      {activeModal === 'builder' && <ScenarioBuilderModal />}
      {activeModal === 'aar' && <AarDebriefModal />}
      {activeModal === 'scenario_io' && <ScenarioIoModal />}
    </div>
  );
};
