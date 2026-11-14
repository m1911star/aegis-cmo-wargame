import React, { useState } from 'react';
import { PlusCircle, X } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import type { SideId } from '../../types/wargame';

export const UnitSpawnerModal: React.FC = () => {
  const catalog = useWargameStore((s) => s.catalog);
  const units = useWargameStore((s) => s.units);
  const startSpawnUnitOnMap = useWargameStore((s) => s.startSpawnUnitOnMap);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);

  const [spawnSide, setSpawnSide] = useState<SideId>('RED');
  const [spawnPlatformId, setSpawnPlatformId] = useState<string>('j20_mighty_dragon');
  const [spawnName, setSpawnName] = useState<string>('歼-20A 增援中队');
  const [spawnCallsign, setSpawnCallsign] = useState<string>('DRAGON-09');

  return (
    <div className="w-full max-w-lg tactical-panel rounded-lg border border-emerald-400/50 overflow-hidden">
      <div className="px-4 py-3 bg-emerald-950/50 border-b border-emerald-500/30 flex items-center justify-between">
        <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
          <PlusCircle className="w-4 h-4" />
          <span>DYNAMIC FORCE SPAWNER // 战场实时增援算子投放</span>
        </div>
        <button
          onClick={() => setActiveModal('none')}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3 text-xs">
        <div>
          <label className="block text-slate-400 mb-1">所属阵营 (Side):</label>
          <div className="grid grid-cols-2 gap-2">
            {(['RED', 'BLUE'] as SideId[]).map((side) => (
              <button
                key={side}
                onClick={() => {
                  setSpawnSide(side);
                  const firstMatch = Object.values(catalog.platforms).find(
                    (p) => p.origin === side
                  );
                  if (firstMatch) {
                    setSpawnPlatformId(firstMatch.id);
                    setSpawnName(firstMatch.name);
                    setSpawnCallsign(`${side}-${Object.keys(units).length + 100}`);
                  }
                }}
                className={`py-2 rounded font-bold border cursor-pointer ${
                  spawnSide === side
                    ? side === 'RED'
                      ? 'bg-rose-600 text-white border-rose-400'
                      : 'bg-sky-600 text-white border-sky-400'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                {side === 'RED' ? '红方联指 (RED FORCE)' : '蓝方联指 (BLUE FORCE)'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-slate-400 mb-1">
            选择装备平台模板 (Platform Template):
          </label>
          <select
            value={spawnPlatformId}
            onChange={(e) => {
              const pid = e.target.value;
              setSpawnPlatformId(pid);
              const sp = catalog.platforms[pid];
              if (sp) setSpawnName(sp.name);
            }}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-slate-100"
          >
            {Object.values(catalog.platforms).map((p) => (
              <option key={p.id} value={p.id}>
                [{p.domain.toUpperCase()}] {p.name} ({p.className})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-slate-400 mb-1">部队番/舷号名称:</label>
            <input
              type="text"
              value={spawnName}
              onChange={(e) => setSpawnName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">战术呼号 (Callsign):</label>
            <input
              type="text"
              value={spawnCallsign}
              onChange={(e) => setSpawnCallsign(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
          </div>
        </div>

        <div className="pt-2 flex justify-end gap-2">
          <button
            onClick={() => setActiveModal('none')}
            className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={() =>
              startSpawnUnitOnMap({
                platformId: spawnPlatformId,
                side: spawnSide,
                name: spawnName,
                callsign: spawnCallsign,
              })
            }
            className="px-4 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold cursor-pointer"
          >
            点击海图坐标投放算子
          </button>
        </div>
      </div>
    </div>
  );
};
