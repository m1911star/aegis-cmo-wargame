import React, { useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import type { SideId } from '../../types/wargame';
import { Button } from '../ui/button';
import { ModalFooter, ModalHeader, ModalShell } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

export const UnitSpawnerModal: React.FC = () => {
  const catalog = useWargameStore((s) => s.catalog);
  const units = useWargameStore((s) => s.units);
  const startSpawnUnitOnMap = useWargameStore((s) => s.startSpawnUnitOnMap);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);

  const initialRed = Object.values(catalog.platforms).find((p) => p.origin === 'RED') ?? Object.values(catalog.platforms)[0];
  const [spawnSide, setSpawnSide] = useState<SideId>(initialRed?.origin === 'BLUE' ? 'BLUE' : 'RED');
  const [spawnPlatformId, setSpawnPlatformId] = useState<string>(initialRed?.id ?? '');
  const [spawnName, setSpawnName] = useState<string>(initialRed ? `${initialRed.name} 增援编队` : '增援编队');
  const [spawnCallsign, setSpawnCallsign] = useState<string>('REINF-01');
  const effectivePlatformId = catalog.platforms[spawnPlatformId] ? spawnPlatformId : (initialRed?.id ?? '');

  return (
    <ModalShell className="max-w-lg">
      <ModalHeader
        icon={<PlusCircle className="w-4 h-4 text-emerald-400" />}
        title="DYNAMIC FORCE SPAWNER // 战场实时增援算子投放"
        onClose={() => setActiveModal('none')}
      />

      <div className="p-4 space-y-3.5 text-xs">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1.5">所属阵营 (Side)</label>
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
                className={`h-8 rounded-md font-semibold border cursor-pointer transition-colors ${
                  spawnSide === side
                    ? side === 'RED'
                      ? 'bg-rose-600 text-white border-rose-500'
                      : 'bg-sky-600 text-white border-sky-500'
                    : 'bg-secondary/60 text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {side === 'RED' ? '红方联指 (RED FORCE)' : '蓝方联指 (BLUE FORCE)'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-muted-foreground mb-1.5">
            选择装备平台模板 (Platform Template)
          </label>
          <Select
            value={effectivePlatformId}
            onChange={(e) => {
              const pid = e.target.value;
              setSpawnPlatformId(pid);
              const sp = catalog.platforms[pid];
              if (sp) setSpawnName(sp.name);
            }}
          >
            {Object.values(catalog.platforms).map((p) => (
              <option key={p.id} value={p.id}>
                [{p.domain.toUpperCase()}] {p.name} ({p.className})
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1.5">部队番/舷号名称</label>
            <Input
              type="text"
              value={spawnName}
              onChange={(e) => setSpawnName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1.5">战术呼号 (Callsign)</label>
            <Input
              type="text"
              value={spawnCallsign}
              onChange={(e) => setSpawnCallsign(e.target.value)}
            />
          </div>
        </div>
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={() => setActiveModal('none')}>
          取消
        </Button>
        <Button
          variant="success"
          disabled={!effectivePlatformId}
          onClick={() =>
            startSpawnUnitOnMap({
              platformId: effectivePlatformId,
              side: spawnSide,
              name: spawnName,
              callsign: spawnCallsign,
            })
          }
        >
          点击海图坐标投放算子
        </Button>
      </ModalFooter>
    </ModalShell>
  );
};
