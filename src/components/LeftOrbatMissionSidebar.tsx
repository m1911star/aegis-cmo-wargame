import React, { useMemo, useState } from 'react';
import { Compass, Crosshair, Layers, Radar } from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import { cn } from '../lib/utils';
import { BattleObjectivesPanel } from './BattleObjectivesPanel';
import { ExerciseTaskPanel } from './ExerciseTaskPanel';
import { ContactsListTab } from './sidebar/ContactsListTab';
import { MapLayersTab } from './sidebar/MapLayersTab';
import { MissionsTab } from './sidebar/MissionsTab';
import { OrbatTreeTab } from './sidebar/OrbatTreeTab';

type SidebarProps = { open: boolean; onUnitDetails: () => void };
type SidebarTab = 'orbat' | 'contacts' | 'missions' | 'layers';

export const LeftOrbatMissionSidebar = React.memo(function LeftOrbatMissionSidebar({ open, onUnitDetails }: SidebarProps) {
  // Keep the lightweight preferences, but unmount the subscribed drawer contents when hidden.
  const [activeTab, setActiveTab] = useState<SidebarTab>('orbat');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [objectivesExpanded, setObjectivesExpanded] = useState(false);

  return open ? <SidebarContents
    activeTab={activeTab}
    setActiveTab={setActiveTab}
    collapsedGroups={collapsedGroups}
    setCollapsedGroups={setCollapsedGroups}
    objectivesExpanded={objectivesExpanded}
    setObjectivesExpanded={setObjectivesExpanded}
    onUnitDetails={onUnitDetails}
  /> : null;
});

function SidebarContents({ activeTab, setActiveTab, collapsedGroups, setCollapsedGroups,
  objectivesExpanded, setObjectivesExpanded, onUnitDetails }: {
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
  collapsedGroups: Record<string, boolean>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  objectivesExpanded: boolean;
  setObjectivesExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  onUnitDetails: () => void;
}) {
  const contacts = useWargameStore((s) => s.contacts);
  const activePerspective = useWargameStore((s) => s.activePerspective);

  const visibleContacts = useMemo(
    () => Object.values(contacts).filter(
      (contact) => activePerspective === 'GOD' || contact.observerSide === activePerspective
    ),
    [contacts, activePerspective]
  );

  const tabs = [
    { id: 'orbat' as const, label: '编制序列', icon: Radar, activeClass: 'bg-zinc-800 text-zinc-50 shadow-xs border-white/10' },
    { id: 'contacts' as const, label: `情报(${visibleContacts.length})`, icon: Crosshair, activeClass: 'bg-zinc-800 text-amber-300 shadow-xs border-white/10' },
    { id: 'missions' as const, label: '巡逻任务', icon: Compass, activeClass: 'bg-zinc-800 text-emerald-300 shadow-xs border-white/10' },
    { id: 'layers' as const, label: '包线图层', icon: Layers, activeClass: 'bg-zinc-800 text-sky-300 shadow-xs border-white/10' },
  ];

  return (
    <aside className="z-20 w-full h-full flex flex-col overflow-hidden">
      <div className="p-1.5 border-b border-border bg-muted/40">
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-background/70 p-1 border border-border/60">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={active}
                className={cn(
                  'py-1.5 px-1 rounded-md flex flex-col items-center gap-1 text-[10px] font-medium cursor-pointer transition-all border border-transparent',
                  active
                    ? cn('font-semibold', tab.activeClass)
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="truncate max-w-full">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        <BattleObjectivesPanel expanded={objectivesExpanded} setExpanded={setObjectivesExpanded} />
        <ExerciseTaskPanel onUnitDetails={onUnitDetails} />
        {activeTab === 'orbat' && <OrbatTreeTab collapsedGroups={collapsedGroups} setCollapsedGroups={setCollapsedGroups} />}
        {activeTab === 'contacts' && <ContactsListTab visibleContacts={visibleContacts} />}
        {activeTab === 'missions' && <MissionsTab />}
        {activeTab === 'layers' && <MapLayersTab />}
      </div>
    </aside>
  );
}
