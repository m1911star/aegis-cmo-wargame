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
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-4 gap-2.5"
    >
      {isUgcMode && (
        <div className="flex items-center gap-1 bg-card/95 border border-border rounded-lg p-1 text-xs shadow-lg">
          <button
            onClick={() => setActiveModal('scenario_io')}
            className={`px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${activeModal === 'scenario_io' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
          >
            想定与回放 I/O
          </button>
          <button
            disabled={playMode !== 'sandbox'}
            onClick={() => setActiveModal('builder')}
            className={`px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors disabled:opacity-35 ${activeModal === 'builder' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
          >
            想定编辑 (沙盒)
          </button>
          <button
            disabled={playMode !== 'sandbox'}
            onClick={() => setActiveModal('unit_spawner')}
            className={`px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors disabled:opacity-35 ${activeModal === 'unit_spawner' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
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
