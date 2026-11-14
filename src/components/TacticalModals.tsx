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
  if (activeModal === 'none') return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 font-mono">
      {activeModal === 'briefing' && <BriefingModal />}
      {activeModal === 'catalog_viewer' && <CatalogViewerModal />}
      {activeModal === 'unit_spawner' && <UnitSpawnerModal />}
      {activeModal === 'builder' && <ScenarioBuilderModal />}
      {activeModal === 'aar' && <AarDebriefModal />}
      {activeModal === 'scenario_io' && <ScenarioIoModal />}
    </div>
  );
};
