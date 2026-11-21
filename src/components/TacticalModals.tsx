import React, { useEffect, useRef } from 'react';
import { useWargameStore } from '../store/useWargameStore';
import { AarDebriefModal } from './modals/AarDebriefModal';
import { BriefingModal } from './modals/BriefingModal';
import { CatalogViewerModal } from './modals/CatalogViewerModal';
import { ScenarioBuilderModal } from './modals/ScenarioBuilderModal';
import { ScenarioIoModal } from './modals/ScenarioIoModal';
import { UnitSpawnerModal } from './modals/UnitSpawnerModal';
import { SkirmishModal } from './modals/SkirmishModal';
import { CampaignTheaterModal } from './modals/CampaignTheaterModal';

const dialogLabels = {
  briefing: '想定简报', catalog_viewer: '装备库', unit_spawner: '兵力投放', builder: '想定编辑',
  aar: '战后复盘', scenario_io: '想定管理', skirmish: '遭遇战', campaign: '战区态势',
};
const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])';

export const TacticalModals: React.FC = () => {
  const activeModal = useWargameStore((s) => s.activeModal);
  const playMode = useWargameStore((s) => s.playMode);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isOpen = activeModal !== 'none';

  useEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (trigger?.getClientRects().length) trigger.focus();
      else trigger?.closest('.command-tools')?.querySelector('summary')?.focus();
    };
  }, [isOpen]);

  if (activeModal === 'none') return null;

  const isUgcMode = activeModal === 'builder' || activeModal === 'unit_spawner' || activeModal === 'scenario_io';

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabels[activeModal]}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        // Nested controls (such as Select popups) handle and consume their own Escape first.
        if (event.key === 'Escape') {
          event.preventDefault();
          setActiveModal('none');
          return;
        }
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(focusable))
          .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const current = controls.indexOf(document.activeElement as HTMLElement);
        if (current === -1 || (event.shiftKey ? current === 0 : current === controls.length - 1)) {
          event.preventDefault();
          (controls[event.shiftKey ? controls.length - 1 : 0] ?? event.currentTarget).focus();
        }
      }}
      className="tactical-modal-backdrop"
    >
      {isUgcMode && (
        <div className="tactical-modal-nav" role="group" aria-label="想定工具">
          <button
            onClick={() => setActiveModal('scenario_io')}
            aria-pressed={activeModal === 'scenario_io'}
            className={`px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${activeModal === 'scenario_io' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
          >
            想定与回放 I/O
          </button>
          <button
            disabled={playMode !== 'sandbox'}
            onClick={() => setActiveModal('builder')}
            aria-pressed={activeModal === 'builder'}
            className={`px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors disabled:opacity-35 ${activeModal === 'builder' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
          >
            想定编辑 (沙盒)
          </button>
          <button
            disabled={playMode !== 'sandbox'}
            onClick={() => setActiveModal('unit_spawner')}
            aria-pressed={activeModal === 'unit_spawner'}
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
      {activeModal === 'skirmish' && <SkirmishModal />}
      {activeModal === 'campaign' && <CampaignTheaterModal />}
    </div>
  );
};
