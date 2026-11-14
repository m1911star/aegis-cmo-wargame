import React, { useMemo, useState } from 'react';
import { Crosshair, Navigation } from 'lucide-react';
import ms from 'milsymbol';
import { resolveUnitConfiguration } from '../db/unitConfiguration';
import { calculateRadarHorizonKm } from '../engine/simulationEngine';
import { getUnitCapabilities } from '../engine/unitCapabilities';
import { useWargameStore } from '../store/useWargameStore';
import { domainLabels, statusLabels } from '../ui/labels';
import { ContactInspectorPanel } from './inspector/ContactInspectorPanel';
import { UnitDoctrineWraPanel } from './inspector/UnitDoctrineWraPanel';
import { UnitKinematicsPanel } from './inspector/UnitKinematicsPanel';
import { UnitWeaponsHangarPanel } from './inspector/UnitWeaponsHangarPanel';

const EMPTY_MISSIONS: never[] = [];

export const RightUnitTelemetryInspector = React.memo(function RightUnitTelemetryInspector() {
  const rawUnit = useWargameStore((state) =>
    state.selectedUnitId ? state.units[state.selectedUnitId] ?? null : null
  );
  const rawContact = useWargameStore((state) =>
    state.selectedContactId ? state.contacts[state.selectedContactId] ?? null : null
  );
  const catalog = useWargameStore((s) => s.catalog);
  const missions = useWargameStore((s) =>
    s.selectedUnitId ? s.missions : EMPTY_MISSIONS
  );
  const interactionMode = useWargameStore((s) => s.interactionMode);
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);
  const startManualEngage = useWargameStore((s) => s.startManualEngage);
  const requestAirRefuel = useWargameStore((s) => s.requestAirRefuel);
  const deployCarriedPlatform = useWargameStore((s) => s.deployCarriedPlatform);
  const cancelUnitReturn = useWargameStore((s) => s.cancelUnitReturn);
  const launchCarrierAircraft = useWargameStore((s) => s.launchCarrierAircraft);
  const [selectedTankerId, setSelectedTankerId] = useState('');

  const units = useWargameStore((s) => s.units);
  const playerSide = useWargameStore((s) => s.playerSide);
  const playMode = useWargameStore((s) => s.playMode);
  const selectedUnit = rawUnit && (rawUnit.side === playerSide || playMode === 'sandbox') ? rawUnit : null;
  const selectedContact = rawContact && (rawContact.observerSide === playerSide || playMode === 'sandbox') ? rawContact : null;

  const platformSpec = selectedUnit ? catalog.platforms[selectedUnit.platformId] : null;
  const platformId = selectedUnit?.platformId;
  const loadoutId = selectedUnit?.activeLoadoutId;
  const configuration = useMemo(
    () => (platformId ? resolveUnitConfiguration(catalog, platformId, loadoutId) : null),
    [catalog, platformId, loadoutId]
  );

  const symbolSvgHtml = useMemo(() => {
    const sidc = selectedContact
      ? selectedContact.sidc
      : selectedUnit?.sidc || 'SUAPMF------';
    try {
      return new ms.Symbol(sidc, { size: 34, frame: true, fill: true, strokeWidth: 4 }).asSVG();
    } catch {
      return '';
    }
  }, [selectedUnit?.sidc, selectedContact?.sidc]);

  const capabilities = useMemo(
    () => (selectedUnit ? getUnitCapabilities(selectedUnit) : null),
    [selectedUnit]
  );

  const radarHorizons = useMemo(() => {
    if (!selectedUnit || !platformSpec) return null;
    return {
      seaSkimmer: calculateRadarHorizonKm(selectedUnit.altitudeM, platformSpec.radarAntennaHeightM, 12),
      highAltitude: calculateRadarHorizonKm(selectedUnit.altitudeM, platformSpec.radarAntennaHeightM, 9000),
    };
  }, [selectedUnit?.altitudeM, platformSpec?.radarAntennaHeightM]);

  const availableTankers = useMemo(
    () => selectedUnit
      ? Object.values(units).filter((unit) =>
          unit.side === selectedUnit.side &&
          unit.category === 'tanker' &&
          unit.hp > 0 &&
          unit.status !== 'destroyed' &&
          unit.status !== 'recovered' &&
          unit.aarFuelRemainingSec > 0
        )
      : [],
    [units, selectedUnit?.side]
  );
  const selectedTanker = availableTankers.find((unit) => unit.id === selectedTankerId) ?? availableTankers[0];

  const groupUnits = useMemo(
    () => selectedUnit
      ? Object.values(units).filter((unit) =>
          unit.parentGroupId === selectedUnit.parentGroupId &&
          unit.hp > 0 &&
          unit.status !== 'destroyed' &&
          unit.status !== 'recovered'
        )
      : [],
    [units, selectedUnit?.parentGroupId]
  );

  const eligibleMissions = useMemo(
    () => (selectedUnit ? missions.filter((mission) => mission.side === selectedUnit.side) : []),
    [missions, selectedUnit?.side]
  );

  if (selectedContact) {
    return <ContactInspectorPanel contact={selectedContact} symbolSvgHtml={symbolSvgHtml} />;
  }

  if (!selectedUnit || !platformSpec || !configuration || !radarHorizons) {
    return (
      <aside className="z-20 w-full h-full tactical-panel border-l border-cyan-500/25 flex items-center justify-center p-6 text-center font-mono text-xs text-slate-500">
        从编制列表或地图中选择单元，查看状态并下达指令。
      </aside>
    );
  }

  const hpPct = Math.max(0, Math.min(100, Math.round((selectedUnit.hp / Math.max(1, selectedUnit.maxHp)) * 100)));
  const fuelPct = selectedUnit.maxFuelSec > 0
    ? Math.max(0, Math.min(100, Math.round((selectedUnit.fuelRemainingSec / selectedUnit.maxFuelSec) * 100)))
    : 100;
  const totalAmmo = selectedUnit.mounts.reduce((sum, mount) => sum + mount.currentAmmo, 0);
  const readyHangarSlot = selectedUnit.hangar.find((slot) => slot.readyAirframes > 0 && slot.cooldownRemainingSec <= 0);
  const isDestroyed = selectedUnit.hp <= 0 || selectedUnit.status === 'destroyed';

  return (
    <aside className="z-20 w-full h-full tactical-panel border-l border-cyan-500/25 flex flex-col overflow-y-auto p-3 space-y-4 inspector-content">
      <div className="sticky top-0 z-10 -mx-1 px-2.5 py-2 rounded bg-slate-950/95 border border-cyan-500/40 shadow-lg space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center shrink-0" dangerouslySetInnerHTML={{ __html: symbolSvgHtml }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                selectedUnit.side === 'RED'
                  ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
                  : 'bg-sky-500/25 text-sky-300 border border-sky-500/40'
              }`}>
                {selectedUnit.callsign}
              </span>
              <span className="text-[10px] text-cyan-300 uppercase">
                {domainLabels[selectedUnit.domain]} · {statusLabels[selectedUnit.status]}
              </span>
            </div>
            <div className="text-xs font-bold text-slate-100 truncate mt-1">{selectedUnit.name}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
          <div>
            <div className="flex justify-between text-slate-300"><span>耐久</span><span>{hpPct}%</span></div>
            <div className="h-1 bg-slate-800 rounded overflow-hidden mt-0.5">
              <div className={`h-full ${hpPct > 50 ? 'bg-emerald-400' : hpPct > 25 ? 'bg-amber-400' : 'bg-rose-500'}`} style={{ width: `${hpPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-slate-300"><span>燃油</span><span>{selectedUnit.domain === 'air' ? `${fuelPct}%` : '常驻'}</span></div>
            <div className="h-1 bg-slate-800 rounded overflow-hidden mt-0.5">
              <div className="h-full bg-cyan-400" style={{ width: `${fuelPct}%` }} />
            </div>
          </div>
          <div className="text-right">
            <div className="text-slate-400">总余弹</div>
            <div className="text-amber-300 font-bold">{totalAmmo} 发</div>
          </div>
        </div>

        {(readyHangarSlot || selectedUnit.status === 'returning') && !isDestroyed && (
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-800/80">
            {readyHangarSlot && (
              <button
                onClick={() => launchCarrierAircraft(selectedUnit.id, readyHangarSlot.slotId, readyHangarSlot.selectedLoadoutId)}
                className="px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[10px] cursor-pointer"
              >
                快捷出动 {readyHangarSlot.squadronName.slice(0, 12)}
              </button>
            )}
            {selectedUnit.status === 'returning' && (
              <button
                disabled={selectedUnit.fuelRemainingSec <= 0}
                onClick={() => cancelUnitReturn(selectedUnit.id)}
                className="px-2 py-1 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-[10px] cursor-pointer"
                title={selectedUnit.fuelRemainingSec <= 0 ? '燃油耗尽不可取消返航' : '中断返航并恢复人工接管'}
              >
                取消返航
              </button>
            )}
          </div>
        )}
        {isDestroyed && (
          <div className="text-[10px] text-rose-300 font-bold">该单位已被摧毁，所有作战与挂载控制已锁定。</div>
        )}
      </div>

      <div className="text-xs p-2 rounded bg-slate-950/80 border border-slate-800 space-y-1">
        <p>能力状态：{capabilities?.state === 'mission_killed' ? '任务失能' : capabilities?.state === 'damaged' ? '受损降级' : '正常'}</p>
        {selectedUnit.domain === 'air' && <p>剩余燃油预算：{Math.floor(selectedUnit.fuelRemainingSec / 60)} 分钟（按巡航基准）</p>}
        <p>导航：{selectedUnit.status === 'returning' ? '资源约束返航' : selectedUnit.navigationMode === 'manual' ? '人工指挥' : '任务自动驾驶'}</p>
      </div>

      {selectedUnit.category === 'tanker' && (
        <div className="p-2 rounded bg-sky-950/30 border border-sky-500/30 text-[11px] text-sky-200">
          可转移燃油：{Math.round(selectedUnit.aarFuelRemainingSec)} 秒 · 等待队列 {selectedUnit.aarQueue.length} 架
        </div>
      )}
      {selectedUnit.domain === 'air' && selectedUnit.category !== 'tanker' && availableTankers.length > 0 && (
        <div className="p-2 rounded bg-sky-950/30 border border-sky-500/30 flex items-center gap-2 text-[11px]">
          <select aria-label="选择加油机" value={selectedTanker?.id ?? ''} onChange={(event) => setSelectedTankerId(event.target.value)}
            className="min-w-0 flex-1 bg-slate-900 rounded p-1 text-sky-200">
            {availableTankers.map((tanker) => <option key={tanker.id} value={tanker.id}>{tanker.callsign} · {Math.round(tanker.aarFuelRemainingSec)}秒</option>)}
          </select>
          <button disabled={!selectedTanker || !!selectedUnit.airRefuelState || selectedUnit.fuelRemainingSec >= selectedUnit.maxFuelSec}
            onClick={() => selectedTanker && requestAirRefuel(selectedUnit.id, selectedTanker.id)}
            className="px-2 py-1 rounded bg-sky-500 text-slate-950 font-bold disabled:opacity-35">
            {selectedUnit.airRefuelState ? selectedUnit.airRefuelState.phase === 'rendezvous' ? '会合中' : '加油中' : '请求加油'}
          </button>
        </div>
      )}
      {Object.entries(selectedUnit.deployableInventory).some(([, count]) => count > 0) && (
        <div className="p-2 rounded bg-violet-950/30 border border-violet-500/30 space-y-1 text-[11px]">
          <div className="text-violet-300 font-bold">携带式无人/诱饵平台</div>
          {Object.entries(selectedUnit.deployableInventory).map(([pid, count]) => (
            <div key={pid} className="flex items-center justify-between gap-2">
              <span>{catalog.platforms[pid]?.name ?? pid} · {count}</span>
              <button disabled={count <= 0} onClick={() => deployCarriedPlatform(selectedUnit.id, pid)}
                className="px-2 py-1 rounded bg-violet-500 text-white disabled:opacity-35">释放</button>
            </div>
          ))}
        </div>
      )}

      <div className="unit-actions grid grid-cols-2 gap-2">
        <button
          onClick={() => setInteractionMode(interactionMode === 'plot_waypoint' ? 'select' : 'plot_waypoint')}
          className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded text-xs font-bold border cursor-pointer transition ${
            interactionMode === 'plot_waypoint'
              ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.5)]'
              : 'bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-200 border-cyan-500/40'
          }`}
        >
          <Navigation className="w-3.5 h-3.5" />
          <span>[F3] 规划航线</span>
        </button>

        <button
          onClick={() =>
            interactionMode === 'manual_engage'
              ? setInteractionMode('select')
              : startManualEngage(undefined, selectedUnit.doctrine.salvoSize)
          }
          className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded text-xs font-bold border cursor-pointer transition ${
            interactionMode === 'manual_engage'
              ? 'bg-rose-500 text-white border-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.6)]'
              : 'bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 border-rose-500/40'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>[F1] 手动齐射</span>
        </button>

        {playMode === 'sandbox' && (
          <button
            onClick={() => setInteractionMode(interactionMode === 'move_unit' ? 'select' : 'move_unit')}
            className={`col-span-2 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded text-xs font-bold border cursor-pointer ${
              interactionMode === 'move_unit' ? 'bg-emerald-500 text-slate-950 border-emerald-300' :
                'bg-emerald-950/60 text-emerald-200 border-emerald-500/40'
            }`}
          >
            沙盒移动单位
          </button>
        )}
      </div>

      <UnitKinematicsPanel
        unit={selectedUnit}
        platformSpec={platformSpec}
        maxSpeedKts={configuration.maxSpeedKts}
        rcsPenaltyM2={configuration.rcsPenaltyM2}
        radarHorizons={radarHorizons}
        groupUnits={groupUnits}
      />

      <UnitDoctrineWraPanel
        unit={selectedUnit}
        platformSpec={platformSpec}
        eligibleMissions={eligibleMissions}
      />

      <UnitWeaponsHangarPanel
        unit={selectedUnit}
        sensorIds={configuration.sensorIds}
        canFire={!!capabilities?.canFire}
      />
    </aside>
  );
});
