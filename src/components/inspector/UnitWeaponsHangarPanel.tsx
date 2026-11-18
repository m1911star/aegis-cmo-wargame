import React, { useState } from 'react';
import { Flame, Package, Shield } from 'lucide-react';
import { CMO_SECTOR_ARCS } from '../../engine/cmoUnits';
import { isUnitRadarEmittingAtTime } from '../../engine/unitCapabilities';
import { useWargameStore } from '../../store/useWargameStore';
import type { RuntimeUnit } from '../../types/wargame';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Select } from '../ui/select';

interface Props {
  unit: RuntimeUnit;
  sensorIds: string[];
  canFire: boolean;
}

export const UnitWeaponsHangarPanel: React.FC<Props> = ({ unit, sensorIds, canFire }) => {
  const catalog = useWargameStore((s) => s.catalog);
  const simTime = useWargameStore((s) => s.simTime);
  const weaponsInFlight = useWargameStore((s) => s.weaponsInFlight);
  const startManualEngage = useWargameStore((s) => s.startManualEngage);
  const launchCarrierAircraft = useWargameStore((s) => s.launchCarrierAircraft);
  const [hangarLoadoutSelections, setHangarLoadoutSelections] = useState<Record<string, string>>({});
  const radarOnlineNow = isUnitRadarEmittingAtTime(unit, simTime, weaponsInFlight, catalog);
  const magazineEntries = unit.magazineStores
    ? Object.entries(unit.magazineStores).filter(([, qty]) => qty > 0)
    : [];

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-foreground font-semibold">
          <Shield className="w-3.5 h-3.5 text-muted-foreground" />
          <span>传感器</span>
        </div>
        <div className="space-y-1.5">
          {sensorIds.map((sId) => {
            const sensor = catalog.sensors[sId];
            if (!sensor) return null;
            const isOnline =
              !sensor.isActiveEmitter ||
              (sensor.type === 'sonar_active'
                ? unit.doctrine.emconSonar
                : sensor.type === 'ecm_jammer'
                  ? unit.doctrine.emconJamming
                  : radarOnlineNow);

            return (
              <div
                key={sId}
                className="px-2.5 py-2 rounded-lg bg-muted/40 border border-border stat-line flex items-center justify-between text-[11px]"
              >
                <div className="min-w-0">
                  <div className="text-foreground font-medium truncate">{sensor.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {sensor.frequencyBand} · 最大距离 {sensor.maxRangeKm} km
                  </div>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold shrink-0 border ${
                    isOnline ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-secondary text-muted-foreground border-border'
                  }`}
                >
                  {isOnline ? '在线' : '静默'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pt-2.5 border-t border-border space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] text-foreground font-semibold">
          <Flame className="w-3.5 h-3.5 text-rose-400" />
          <span>武器与弹药</span>
        </div>

        {unit.mounts.length === 0 ? (
          <div className="text-[11px] text-muted-foreground py-1">该平台为纯支援/侦察节点，无进攻性武器挂架</div>
        ) : (
          <div className="space-y-2">
            {unit.mounts.map((m) => {
              const wSpec = catalog.weapons[m.weaponId];
              if (!wSpec) return null;
              const magReserve = unit.magazineStores?.[m.weaponId] ?? 0;
              const enabledArcs = m.arcs
                ? CMO_SECTOR_ARCS.filter((sector) => Boolean(m.arcs?.[sector]))
                : CMO_SECTOR_ARCS;
              const isSectorRestricted = enabledArcs.length > 0 && enabledArcs.length < 8;
              return (
                <div key={m.mountId} className="p-2.5 rounded-lg bg-muted/40 border border-border space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground truncate">{wSpec.name}</span>
                    <span className="text-xs font-semibold text-foreground font-mono tabular-nums shrink-0">
                      {m.currentAmmo} / {m.maxAmmo} 发
                      {magReserve > 0 && <span className="text-cyan-300 ml-1">(弹库 +{magReserve})</span>}
                    </span>
                  </div>
                  {(m.autonomous || isSectorRestricted || m.magazineReloadRemainingSec !== undefined) && (
                    <div className="flex flex-wrap items-center gap-1 text-[10px]">
                      {m.autonomous && (
                        <Badge variant="success" className="text-[9px] px-1.5 py-0">
                          自主近防免占通道
                        </Badge>
                      )}
                      {isSectorRestricted && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-mono">
                          射界 {enabledArcs.join('/')}
                        </Badge>
                      )}
                      {m.magazineReloadRemainingSec !== undefined && (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 font-mono text-cyan-300">
                          弹库补弹中 ({m.magazineReloadRemainingSec.toFixed(1)}s)
                        </Badge>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>
                      射程: {wSpec.maxRangeKm}km · 速度: {(wSpec.speedKts / 661).toFixed(1)}马赫 · 基准 Pk: {Math.round(wSpec.basePk * 100)}%
                      {wSpec.requiresDatalinkBeyondHorizon ? ' · CEC中继' : ''}
                    </span>
                    <Button
                      size="xs"
                      variant="destructive"
                      disabled={m.currentAmmo <= 0 || m.cooldownRemainingSec > 0 || !canFire}
                      onClick={() => startManualEngage(m.weaponId, unit.doctrine.salvoSize)}
                    >
                      点选目标发射
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {magazineEntries.length > 0 && (
          <div className="p-2 rounded-lg bg-cyan-500/8 border border-cyan-500/25 space-y-1 text-[10px]">
            <div className="flex items-center gap-1 text-cyan-300 font-semibold">
              <Package className="w-3 h-3" />
              <span>独立弹药库备弹库存 (Magazine Stores)</span>
            </div>
            <div className="flex flex-wrap gap-1.5 font-mono">
              {magazineEntries.map(([wId, qty]) => (
                <span key={wId} className="px-1.5 py-0.5 rounded bg-background/60 border border-border/70 text-foreground">
                  {catalog.weapons[wId]?.codeName ?? wId}: {qty} 发
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {unit.hangar && unit.hangar.length > 0 && (
        <div className="pt-2.5 border-t border-border space-y-2">
          <div className="text-[11px] text-emerald-300 font-semibold">母舰机库与甲板弹射</div>
          <div className="space-y-2">
            {unit.hangar.map((slot) => {
              const selectionKey = `${unit.id}:${slot.slotId}`;
              const pendingSelection = hangarLoadoutSelections[selectionKey];
              const selectedLoadoutId = pendingSelection && slot.availableLoadoutIds.includes(pendingSelection)
                ? pendingSelection
                : slot.selectedLoadoutId;
              return (
                <div key={slot.slotId} className="p-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/25 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground truncate">{slot.squadronName}</span>
                    <span className="text-[11px] font-semibold text-emerald-300 font-mono tabular-nums shrink-0">待命: {slot.readyAirframes}/{slot.totalAirframes} 批</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    回收整备: {slot.turnaroundQueue.length} 批 · 可用补给: {slot.turnaroundSupplies} 批
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Select
                      aria-label={`${slot.squadronName} 起飞挂载`}
                      value={selectedLoadoutId}
                      onChange={(event) => setHangarLoadoutSelections((current) => ({
                        ...current,
                        [selectionKey]: event.target.value,
                      }))}
                      wrapperClassName="flex-1"
                      className="h-7 text-[10px] border-emerald-500/35"
                    >
                      {slot.availableLoadoutIds.map((loadoutId) => (
                        <option key={loadoutId} value={loadoutId}>
                          {catalog.loadouts[loadoutId]?.name || loadoutId}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="success"
                      disabled={slot.readyAirframes <= 0 || slot.cooldownRemainingSec > 0}
                      onClick={() => launchCarrierAircraft(unit.id, slot.slotId, selectedLoadoutId)}
                      className="shrink-0"
                    >
                      {slot.cooldownRemainingSec > 0 ? `甲板整备 (${slot.cooldownRemainingSec}s)` : '弹射升空'}
                    </Button>
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
