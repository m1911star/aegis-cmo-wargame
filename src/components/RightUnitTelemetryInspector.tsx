import React, { useMemo, useState } from 'react';
import { ChevronDown, Crosshair, Navigation } from 'lucide-react';
import ms from 'milsymbol';
import { resolveUnitConfiguration } from '../db/unitConfiguration';
import { findAmphibiousLandingPoint, MAX_AMPHIBIOUS_STANDOFF_KM } from '../engine/environment';
import { calculateRadarHorizonKm } from '../engine/simulationEngine';
import { getUnitCapabilities } from '../engine/unitCapabilities';
import { useWargameStore } from '../store/useWargameStore';
import { domainLabels, statusLabels } from '../ui/labels';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Select } from './ui/select';
import { ContactInspectorPanel } from './inspector/ContactInspectorPanel';
import { UnitDoctrineWraPanel } from './inspector/UnitDoctrineWraPanel';
import { UnitKinematicsPanel } from './inspector/UnitKinematicsPanel';
import { UnitWeaponsHangarPanel } from './inspector/UnitWeaponsHangarPanel';

const EMPTY_MISSIONS: never[] = [];

export const RightUnitTelemetryInspector = React.memo(function RightUnitTelemetryInspector() {
  const rawUnit = useWargameStore((state) =>
    state.selectedUnitId ? state.units[state.selectedUnitId] ?? null : null
  );
  const selectedUnitIds = useWargameStore((s) => s.selectedUnitIds);
  const selectUnit = useWargameStore((s) => s.selectUnit);
  const batchUpdateUnitDoctrine = useWargameStore((s) => s.batchUpdateUnitDoctrine);
  const batchClearUnitWaypoints = useWargameStore((s) => s.batchClearUnitWaypoints);
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
  const environment = useWargameStore((s) => s.environment);
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
      <aside className="z-20 w-full h-full flex items-center justify-center p-6 text-center text-xs text-muted-foreground">
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
    <aside className="z-20 w-full h-full flex flex-col overflow-hidden">
      <div className="flex-none p-3 bg-card border-b border-border space-y-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 flex items-center justify-center rounded-md bg-secondary/50 border border-border/60 shrink-0" dangerouslySetInnerHTML={{ __html: symbolSvgHtml }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <Badge variant={selectedUnit.side === 'RED' ? 'red' : 'blue'}>
                {selectedUnit.callsign}
              </Badge>
              <span className="text-[10px] text-primary font-medium truncate">
                {domainLabels[selectedUnit.domain]} · {statusLabels[selectedUnit.status]}
              </span>
            </div>
            <div className="text-xs font-semibold text-foreground truncate mt-1">{selectedUnit.name}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 text-[10px] font-mono tabular-nums">
          <div className="space-y-1">
            <div className="flex justify-between text-muted-foreground"><span>耐久</span><span className="text-foreground">{hpPct}%</span></div>
            <Progress value={hpPct} indicatorClassName={hpPct > 50 ? 'bg-emerald-400' : hpPct > 25 ? 'bg-amber-400' : 'bg-rose-500'} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-muted-foreground"><span>燃油</span><span className="text-foreground">{selectedUnit.domain === 'air' ? `${fuelPct}%` : '常驻'}</span></div>
            <Progress value={fuelPct} indicatorClassName="bg-cyan-400" />
          </div>
          <div className="text-right">
            <div className="text-muted-foreground">总余弹</div>
            <div className="text-amber-300 font-semibold">{totalAmmo} 发</div>
          </div>
        </div>

        {(readyHangarSlot || selectedUnit.status === 'returning') && !isDestroyed && (
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/80">
            {readyHangarSlot && (
              <Button
                size="xs"
                variant="success"
                onClick={() => launchCarrierAircraft(selectedUnit.id, readyHangarSlot.slotId, readyHangarSlot.selectedLoadoutId)}
              >
                快捷出动 {readyHangarSlot.squadronName.slice(0, 12)}
              </Button>
            )}
            {selectedUnit.status === 'returning' && (
              <Button
                size="xs"
                variant="warning"
                disabled={selectedUnit.fuelRemainingSec <= 0}
                onClick={() => cancelUnitReturn(selectedUnit.id)}
                title={selectedUnit.fuelRemainingSec <= 0 ? '燃油耗尽不可取消返航' : '中断返航并恢复人工接管'}
              >
                取消返航
              </Button>
            )}
          </div>
        )}
        {isDestroyed && (
          <div className="text-[10px] text-rose-300 font-semibold">该单位已被摧毁，所有作战与挂载控制已锁定。</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 inspector-content">
        {selectedUnitIds.length > 1 && (
          <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-400/35 space-y-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-cyan-300 font-semibold">
                编组多选批量指控 ({selectedUnitIds.length} 个单元)
              </span>
              <button
                type="button"
                onClick={() => selectUnit(selectedUnit.id)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer"
              >
                仅留当前
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedUnitIds.map((uid) => {
                const u = units[uid];
                if (!u) return null;
                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => selectUnit(uid)}
                    className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                      uid === selectedUnit.id
                        ? 'bg-cyan-400/20 border-cyan-400 text-cyan-100 font-semibold'
                        : 'bg-secondary/60 border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {u.callsign}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-border/60">
              <Button
                size="xs"
                variant={interactionMode === 'plot_waypoint' ? 'default' : 'tactical'}
                onClick={() => setInteractionMode(interactionMode === 'plot_waypoint' ? 'select' : 'plot_waypoint')}
              >
                [F3] 批量标绘航点
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => batchClearUnitWaypoints(selectedUnitIds)}
              >
                清空编组航线
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1 pt-1">
              <Button
                size="xs"
                variant="destructive"
                onClick={() => batchUpdateUnitDoctrine(selectedUnitIds, { roe: 'free' })}
              >
                全员自由开火
              </Button>
              <Button
                size="xs"
                variant="warning"
                onClick={() => batchUpdateUnitDoctrine(selectedUnitIds, { roe: 'tight' })}
              >
                全员自卫反导
              </Button>
              <Button
                size="xs"
                variant="success"
                onClick={() => batchUpdateUnitDoctrine(selectedUnitIds, { roe: 'hold' })}
              >
                全员停火
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Button
                size="xs"
                variant="outline"
                onClick={() => batchUpdateUnitDoctrine(selectedUnitIds, { emconRadar: true })}
              >
                全员开雷达
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => batchUpdateUnitDoctrine(selectedUnitIds, { emconRadar: false, emconSonar: false, emconJamming: false })}
              >
                全员电磁静默
              </Button>
            </div>
          </div>
        )}

        <div className="text-[11px] bg-card/85 border border-border space-y-1.5 text-foreground leading-relaxed">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">能力状态</span>
            <span className={capabilities?.state === 'mission_killed' ? 'text-rose-300 font-semibold' : capabilities?.state === 'damaged' ? 'text-amber-300 font-semibold' : 'text-emerald-300 font-semibold'}>
              {capabilities?.state === 'mission_killed' ? '任务失能' : capabilities?.state === 'damaged' ? '受损降级' : '正常'}
            </span>
          </div>
          {selectedUnit.domain === 'air' && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">剩余燃油预算</span>
              <span className="font-mono tabular-nums text-cyan-300">{Math.floor(selectedUnit.fuelRemainingSec / 60)} 分钟</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">导航模式</span>
            <span>{selectedUnit.status === 'returning' ? '资源约束返航' : selectedUnit.navigationMode === 'manual' ? '人工指挥' : '任务自动驾驶'}</span>
          </div>
        </div>

        {selectedUnit.category === 'tanker' && (
          <div className="bg-sky-500/10 border border-sky-500/30 text-[11px] text-sky-200">
            可转移燃油：{Math.round(selectedUnit.aarFuelRemainingSec)} 秒 · 等待队列 {selectedUnit.aarQueue.length} 架
          </div>
        )}
        {selectedUnit.domain === 'air' && selectedUnit.category !== 'tanker' && availableTankers.length > 0 && (
          <div className="bg-sky-500/10 border border-sky-500/30 flex items-center gap-2 text-[11px]">
            <Select
              aria-label="选择加油机"
              value={selectedTanker?.id ?? ''}
              onChange={(event) => setSelectedTankerId(event.target.value)}
              wrapperClassName="flex-1"
              className="h-7 text-[11px] text-sky-200"
            >
              {availableTankers.map((tanker) => <option key={tanker.id} value={tanker.id}>{tanker.callsign} · {Math.round(tanker.aarFuelRemainingSec)}秒</option>)}
            </Select>
            <Button
              size="sm"
              variant="default"
              disabled={!selectedTanker || !!selectedUnit.airRefuelState || selectedUnit.fuelRemainingSec >= selectedUnit.maxFuelSec}
              onClick={() => selectedTanker && requestAirRefuel(selectedUnit.id, selectedTanker.id)}
              className="bg-sky-500 hover:bg-sky-400 text-slate-950"
            >
              {selectedUnit.airRefuelState ? selectedUnit.airRefuelState.phase === 'rendezvous' ? '会合中' : '加油中' : '请求加油'}
            </Button>
          </div>
        )}
        {Object.entries(selectedUnit.deployableInventory).some(([, count]) => count > 0) && (() => {
          const entries = Object.entries(selectedUnit.deployableInventory).filter(([, count]) => count > 0);
          const hasGroundEmbark = entries.some(([pid]) => catalog.platforms[pid]?.domain === 'land');
          const landingPoint = hasGroundEmbark
            ? findAmphibiousLandingPoint(selectedUnit.position, selectedUnit.heading, environment, MAX_AMPHIBIOUS_STANDOFF_KM)
            : undefined;
          return (
            <div className="bg-violet-500/10 border border-violet-500/30 p-2 rounded-lg space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-violet-300 font-semibold">
                  {hasGroundEmbark ? '两栖坞舱 / 搭载兵力投送' : '携带式无人/诱饵平台'}
                </span>
                {hasGroundEmbark && (
                  <span className={`text-[10px] ${landingPoint ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {landingPoint ? `已入抵滩范围 (≤${MAX_AMPHIBIOUS_STANDOFF_KM}km)` : `需抵近海岸 ≤${MAX_AMPHIBIOUS_STANDOFF_KM}km`}
                  </span>
                )}
              </div>
              {entries.map(([pid, count]) => {
                const spec = catalog.platforms[pid];
                const isAmphib = spec?.domain === 'land';
                return (
                  <div key={pid} className="flex items-center justify-between gap-2">
                    <span className="truncate">{spec?.name ?? pid} · {count}</span>
                    <Button
                      size="xs"
                      disabled={count <= 0 || (isAmphib && !landingPoint) || !capabilities?.canFire}
                      onClick={() => deployCarriedPlatform(selectedUnit.id, pid)}
                      className="bg-violet-500 hover:bg-violet-400 text-white shrink-0"
                    >
                      {isAmphib ? '抵滩卸载' : '释放'}
                    </Button>
                  </div>
                );
              })}
            </div>
          );
        })()}

        <div className="unit-actions grid grid-cols-2 gap-2">
          <Button
            variant={interactionMode === 'plot_waypoint' ? 'default' : 'tactical'}
            onClick={() => setInteractionMode(interactionMode === 'plot_waypoint' ? 'select' : 'plot_waypoint')}
            className="w-full"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>[F3] 规划航线</span>
          </Button>

          <Button
            variant={interactionMode === 'manual_engage' ? 'destructive' : 'outline'}
            onClick={() =>
              interactionMode === 'manual_engage'
                ? setInteractionMode('select')
                : startManualEngage(undefined, selectedUnit.doctrine.salvoSize)
            }
            className={interactionMode === 'manual_engage' ? 'w-full' : 'w-full border-rose-500/35 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 hover:border-rose-400/60'}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>[F1] 手动齐射</span>
          </Button>

          {playMode === 'sandbox' && (
            <Button
              variant={interactionMode === 'move_unit' ? 'success' : 'outline'}
              onClick={() => setInteractionMode(interactionMode === 'move_unit' ? 'select' : 'move_unit')}
              className={`col-span-2 w-full ${interactionMode === 'move_unit' ? '' : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'}`}
            >
              沙盒移动单位
            </Button>
          )}
        </div>

        <details open className="group bg-card/85 border border-border">
          <summary className="text-[11px] font-semibold text-foreground cursor-pointer list-none flex items-center justify-between py-0.5">
            <span>运动与航路控制</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2.5 pt-2.5 border-t border-border/80">
            <UnitKinematicsPanel
              unit={selectedUnit}
              platformSpec={platformSpec}
              maxSpeedKts={configuration.maxSpeedKts}
              rcsPenaltyM2={configuration.rcsPenaltyM2}
              radarHorizons={radarHorizons}
              groupUnits={groupUnits}
            />
          </div>
        </details>

        <details open className="group bg-card/85 border border-border">
          <summary className="text-[11px] font-semibold text-foreground cursor-pointer list-none flex items-center justify-between py-0.5">
            <span>条令、EMCON 与 WRA</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2.5 pt-2.5 border-t border-border/80">
            <UnitDoctrineWraPanel
              unit={selectedUnit}
              platformSpec={platformSpec}
              eligibleMissions={eligibleMissions}
            />
          </div>
        </details>

        <details open className="group bg-card/85 border border-border">
          <summary className="text-[11px] font-semibold text-foreground cursor-pointer list-none flex items-center justify-between py-0.5">
            <span>传感器、弹药与机库出动</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2.5 pt-2.5 border-t border-border/80 space-y-3">
            <UnitWeaponsHangarPanel
              unit={selectedUnit}
              sensorIds={configuration.sensorIds}
              canFire={!!capabilities?.canFire}
            />
          </div>
        </details>
      </div>
    </aside>
  );
});
