import React, { useState } from 'react';
import { Flame, Shield } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import type { RuntimeUnit } from '../../types/wargame';

interface Props {
  unit: RuntimeUnit;
  sensorIds: string[];
  canFire: boolean;
}

export const UnitWeaponsHangarPanel: React.FC<Props> = ({ unit, sensorIds, canFire }) => {
  const catalog = useWargameStore((s) => s.catalog);
  const startManualEngage = useWargameStore((s) => s.startManualEngage);
  const launchCarrierAircraft = useWargameStore((s) => s.launchCarrierAircraft);
  const [hangarLoadoutSelections, setHangarLoadoutSelections] = useState<Record<string, string>>({});

  return (
    <>
      <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-1.5">
        <div className="flex items-center gap-1 text-[11px] text-cyan-400 font-bold">
          <Shield className="w-3.5 h-3.5" />
          <span>传感器</span>
        </div>
        <div className="space-y-1">
          {sensorIds.map((sId) => {
            const sensor = catalog.sensors[sId];
            if (!sensor) return null;
            const isOnline =
              !sensor.isActiveEmitter ||
              (sensor.type === 'sonar_active'
                ? unit.doctrine.emconSonar
                : sensor.type === 'ecm_jammer'
                  ? unit.doctrine.emconJamming
                  : unit.doctrine.emconRadar);

            return (
              <div
                key={sId}
                className="px-2 py-1.5 rounded bg-slate-900/75 border border-slate-800/80 stat-line flex items-center justify-between text-[11px]"
              >
                <div className="min-w-0">
                  <div className="text-slate-200 font-medium truncate">{sensor.name}</div>
                  <div className="text-[10px] text-slate-400">
                    {sensor.frequencyBand} · 最大距离 {sensor.maxRangeKm} km
                  </div>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                    isOnline ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {isOnline ? '在线' : '静默'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-2">
        <div className="flex items-center gap-1 text-[11px] text-rose-400 font-bold">
          <Flame className="w-3.5 h-3.5" />
          <span>武器与弹药</span>
        </div>

        {unit.mounts.length === 0 ? (
          <div className="text-[11px] text-slate-500 py-2">该平台为纯支援/侦察节点，无进攻性武器挂架</div>
        ) : (
          <div className="space-y-2">
            {unit.mounts.map((m) => {
              const wSpec = catalog.weapons[m.weaponId];
              if (!wSpec) return null;
              return (
                <div key={m.mountId} className="p-2 rounded bg-slate-900/90 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-100 truncate">{wSpec.name}</span>
                    <span className="text-xs font-bold text-cyan-300 shrink-0">{m.currentAmmo} / {m.maxAmmo} 发</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                    <span>
                      射程: {wSpec.maxRangeKm}km · 速度: {(wSpec.speedKts / 661).toFixed(1)}马赫 · 基准 Pk: {Math.round(wSpec.basePk * 100)}%
                      {wSpec.requiresDatalinkBeyondHorizon ? ' · CEC中继' : ''}
                    </span>
                    <button
                      disabled={m.currentAmmo <= 0 || m.cooldownRemainingSec > 0 || !canFire}
                      onClick={() => startManualEngage(m.weaponId, unit.doctrine.salvoSize)}
                      className="px-2 py-0.5 rounded bg-rose-600/80 hover:bg-rose-500 disabled:opacity-30 text-white font-bold cursor-pointer"
                    >
                      点选目标发射
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {unit.hangar && unit.hangar.length > 0 && (
        <div className="p-2.5 rounded bg-emerald-950/25 border border-emerald-500/40 space-y-2">
          <div className="text-[11px] text-emerald-300 font-bold">母舰机库与甲板弹射</div>
          <div className="space-y-2">
            {unit.hangar.map((slot) => {
              const selectionKey = `${unit.id}:${slot.slotId}`;
              const pendingSelection = hangarLoadoutSelections[selectionKey];
              const selectedLoadoutId = pendingSelection && slot.availableLoadoutIds.includes(pendingSelection)
                ? pendingSelection
                : slot.selectedLoadoutId;
              return (
                <div key={slot.slotId} className="p-2 rounded bg-slate-950/90 border border-emerald-500/30 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-100">{slot.squadronName}</span>
                    <span className="text-[11px] font-bold text-emerald-400">待命: {slot.readyAirframes}/{slot.totalAirframes} 批</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    回收整备: {slot.turnaroundQueue.length} 批 · 可用补给: {slot.turnaroundSupplies} 批
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <select
                      aria-label={`${slot.squadronName} 起飞挂载`}
                      value={selectedLoadoutId}
                      onChange={(event) => setHangarLoadoutSelections((current) => ({
                        ...current,
                        [selectionKey]: event.target.value,
                      }))}
                      className="min-w-0 flex-1 bg-slate-900 border border-emerald-500/35 rounded px-2 py-1 text-[10px] text-emerald-100 cursor-pointer"
                    >
                      {slot.availableLoadoutIds.map((loadoutId) => (
                        <option key={loadoutId} value={loadoutId}>
                          {catalog.loadouts[loadoutId]?.name || loadoutId}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={slot.readyAirframes <= 0 || slot.cooldownRemainingSec > 0}
                      onClick={() => launchCarrierAircraft(unit.id, slot.slotId, selectedLoadoutId)}
                      className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-35 text-slate-950 font-bold text-[11px] cursor-pointer shrink-0"
                    >
                      {slot.cooldownRemainingSec > 0 ? `甲板整备 (${slot.cooldownRemainingSec}s)` : '弹射升空'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};
