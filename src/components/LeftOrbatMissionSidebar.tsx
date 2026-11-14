import React, { useMemo, useState } from 'react';
import { Compass, Crosshair, Layers, Radar } from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import { BattleObjectivesPanel } from './BattleObjectivesPanel';
import { ContactsListTab } from './sidebar/ContactsListTab';
import { MapLayersTab } from './sidebar/MapLayersTab';
import { MissionsTab } from './sidebar/MissionsTab';
import { OrbatTreeTab } from './sidebar/OrbatTreeTab';

export const LeftOrbatMissionSidebar = React.memo(function LeftOrbatMissionSidebar() {
  const [activeTab, setActiveTab] = useState<'orbat' | 'contacts' | 'missions' | 'layers'>('orbat');
  const contacts = useWargameStore((s) => s.contacts);
  const activePerspective = useWargameStore((s) => s.activePerspective);

  const visibleContacts = useMemo(
    () => Object.values(contacts).filter(
      (contact) => activePerspective === 'GOD' || contact.observerSide === activePerspective
    ),
    [contacts, activePerspective]
  );

  return (
    <aside className="z-20 w-full h-full tactical-panel border-r border-cyan-500/25 flex flex-col overflow-hidden">
      <div className="grid grid-cols-4 border-b border-cyan-500/25 bg-slate-950/70 text-[11px]">
        <button
          onClick={() => setActiveTab('orbat')}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer transition border-b-2 ${
            activeTab === 'orbat'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30 font-bold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Radar className="w-3.5 h-3.5" />
          <span>编制序列</span>
        </button>
        <button
          onClick={() => setActiveTab('contacts')}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer transition border-b-2 ${
            activeTab === 'contacts'
              ? 'border-amber-400 text-amber-300 bg-amber-950/30 font-bold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>情报({visibleContacts.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('missions')}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer transition border-b-2 ${
            activeTab === 'missions'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/30 font-bold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>巡逻任务</span>
        </button>
        <button
          onClick={() => setActiveTab('layers')}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer transition border-b-2 ${
            activeTab === 'layers'
              ? 'border-sky-400 text-sky-300 bg-sky-950/30 font-bold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>包线图层</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        <BattleObjectivesPanel />
        {activeTab === 'orbat' && <OrbatTreeTab />}
        {activeTab === 'contacts' && <ContactsListTab visibleContacts={visibleContacts} />}
        {activeTab === 'missions' && <MissionsTab />}
        {activeTab === 'layers' && <MapLayersTab />}
      </div>
    </aside>
  );
});
