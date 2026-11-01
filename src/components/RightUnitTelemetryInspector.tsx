import { FireControlDiagnostics } from './FireControlDiagnostics';
import { getUnitCapabilities } from '../engine/unitCapabilities';
import React, { useMemo, useState } from 'react';
import ms from 'milsymbol';
import {
  Navigation,
  Crosshair,
  Radio,
  Shield,
  Gauge,
  Trash2,
  Flame,
} from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import {
  calculateRadarHorizonKm,
} from '../engine/simulationEngine';
import { classificationLabels, domainLabels, statusLabels, threatLabels } from '../ui/labels';
import type { Domain, ROEStatus, ThreatLevel } from '../types/wargame';
import { resolveUnitConfiguration } from '../db/unitConfiguration';

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
  const clearUnitWaypoints = useWargameStore((s) => s.clearUnitWaypoints);
  const updateUnitWaypoint = useWargameStore((s) => s.updateUnitWaypoint);
  const removeUnitWaypoint = useWargameStore((s) => s.removeUnitWaypoint);
  const setGroupFormation = useWargameStore((s) => s.setGroupFormation);
  const requestAirRefuel = useWargameStore((s) => s.requestAirRefuel);
  const deployCarriedPlatform = useWargameStore((s) => s.deployCarriedPlatform);
  const updateUnitDoctrine = useWargameStore((s) => s.updateUnitDoctrine);
  const updateUnitKinematics = useWargameStore((s) => s.updateUnitKinematics);
  const switchUnitLoadout = useWargameStore((s) => s.switchUnitLoadout);
  const launchCarrierAircraft = useWargameStore((s) => s.launchCarrierAircraft);
  const assignUnitMission = useWargameStore((s) => s.assignUnitMission);
  const [hangarLoadoutSelections, setHangarLoadoutSelections] = useState<Record<string, string>>({});
  const [selectedTankerId, setSelectedTankerId] = useState('');

  const units = useWargameStore((s) => s.units);
  const playerSide = useWargameStore((s) => s.playerSide);
  const playMode = useWargameStore((s) => s.playMode);
  const selectedUnit = rawUnit && (rawUnit.side === playerSide || playMode === 'sandbox') ? rawUnit : null;
  const selectedContact = rawContact && (rawContact.observerSide === playerSide || playMode === 'sandbox') ? rawContact : null;

  const platformSpec = selectedUnit
    ? catalog.platforms[selectedUnit.platformId]
    : null;
  const platformId = selectedUnit?.platformId;
  const loadoutId = selectedUnit?.activeLoadoutId;
  const configuration = useMemo(() => platformId
    ? resolveUnitConfiguration(catalog, platformId, loadoutId) : null,
  [catalog, platformId, loadoutId]);

  const symbolSvgHtml = useMemo(() => {
    const sidc = selectedContact
      ? selectedContact.sidc
      : selectedUnit?.sidc || 'SUAPMF------';
    try {
      const sym = new ms.Symbol(sidc, {
        size: 34,
        frame: true,
        fill: true,
        strokeWidth: 4,
      });
      return sym.asSVG();
    } catch {
      return '';
    }
  }, [selectedUnit?.sidc, selectedContact?.sidc]);
  const capabilities = useMemo(
    () => selectedUnit ? getUnitCapabilities(selectedUnit) : null,
    [selectedUnit]
  );
  const radarHorizons = useMemo(() => {
    if (!selectedUnit || !platformSpec) return null;
    return {
      seaSkimmer: calculateRadarHorizonKm(
        selectedUnit.altitudeM,
        platformSpec.radarAntennaHeightM,
        12
      ),
      highAltitude: calculateRadarHorizonKm(
        selectedUnit.altitudeM,
        platformSpec.radarAntennaHeightM,
        9000
      ),
    };
  }, [selectedUnit?.altitudeM, platformSpec?.radarAntennaHeightM]);
  const availableTankers = useMemo(
    () => selectedUnit ? Object.values(units).filter((unit) => unit.side === selectedUnit.side &&
      unit.category === 'tanker' && unit.hp > 0 && unit.status !== 'destroyed' && unit.status !== 'recovered' &&
      unit.aarFuelRemainingSec > 0) : [],
    [units, selectedUnit?.side]
  );
  const selectedTanker = availableTankers.find((unit) => unit.id === selectedTankerId) ?? availableTankers[0];
  const groupUnits = useMemo(
    () => selectedUnit ? Object.values(units).filter((unit) => unit.parentGroupId === selectedUnit.parentGroupId &&
      unit.hp > 0 && unit.status !== 'destroyed' && unit.status !== 'recovered') : [],
    [units, selectedUnit?.parentGroupId]
  );
  const eligibleMissions = useMemo(
    () => selectedUnit
      ? missions.filter((mission) => mission.side === selectedUnit.side)
      : [],
    [missions, selectedUnit?.side]
  );

  // 情形 A: 当前选中了敌方情报接触 (Contact)
  if (selectedContact) {
    return (
      <aside className="z-20 w-full h-full tactical-panel border-l border-cyan-500/25 flex flex-col overflow-y-auto p-3 space-y-4 inspector-content">
        <div className="flex items-center gap-3 p-2.5 rounded bg-amber-950/30 border border-amber-500/40">
          <div
            className="w-12 h-12 flex items-center justify-center shrink-0"
            dangerouslySetInnerHTML={{ __html: symbolSvgHtml }}
          />
          <div className="min-w-0">
            <div className="text-[10px] text-amber-400 uppercase font-bold">
              情报目标
            </div>
            <div className="text-sm font-bold text-slate-100 truncate">
              {selectedContact.displayName}
            </div>
            <div className="text-[11px] text-amber-300">
              分类等级: {classificationLabels[selectedContact.classification]} · 威胁:{' '}
              {threatLabels[selectedContact.threatLevel]}
            </div>
          </div>
        </div>

        <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-1.5 text-xs">
          <div className="text-cyan-400 font-bold text-[11px] mb-1">
            目标状态与定位误差
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">观测坐标:</span>
            <span>
              {selectedContact.estimatedPosition[1].toFixed(3)}°N,{' '}
              {selectedContact.estimatedPosition[0].toFixed(3)}°E
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">定位几何:</span>
            <span className="text-amber-400 font-bold">
              {selectedContact.uncertaintyKind === 'bearing_corridor' ? '方位走廊' :
                selectedContact.uncertaintyKind === 'ellipse' ? '交叉定位椭圆' : '误差圆'} · {selectedContact.uncertaintyRadiusKm} km
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">解算航速 / 航向:</span>
            <span>
              {selectedContact.speedKts} kts / {selectedContact.heading}°
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">高度 / 深度:</span>
            <span>{selectedContact.altitudeM} m</span>
          </div>
          <div className="pt-1 border-t border-slate-900 text-[11px] text-cyan-300">
            探测传感器: {selectedContact.detectedBySources.join(' , ')}
          </div>
        </div>

        <FireControlDiagnostics key={selectedContact.id} contact={selectedContact} />
      </aside>
    );
  }

  // 情形 B: 未选中任何算子
  if (!selectedUnit || !platformSpec || !configuration) {
    return (
      <aside className="z-20 w-full h-full tactical-panel border-l border-cyan-500/25 flex items-center justify-center p-6 text-center font-mono text-xs text-slate-500">
        从编制列表或地图中选择单元，查看状态并下达指令。
      </aside>
    );
  }

  return (
    <aside className="z-20 w-full h-full tactical-panel border-l border-cyan-500/25 flex flex-col overflow-y-auto p-3 space-y-4 inspector-content">
      {/* 1. 算子头部信息与北约军标 */}
      <div className="flex items-center gap-3 p-2.5 rounded bg-slate-950/85 border border-cyan-500/35">
        <div
          className="w-12 h-12 flex items-center justify-center shrink-0"
          dangerouslySetInnerHTML={{ __html: symbolSvgHtml }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                selectedUnit.side === 'RED'
                  ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
                  : 'bg-sky-500/25 text-sky-300 border border-sky-500/40'
              }`}
            >
              {selectedUnit.callsign}
            </span>
            <span className="text-[10px] text-cyan-400 uppercase">
              {domainLabels[selectedUnit.domain]} · {statusLabels[selectedUnit.status]}
            </span>
          </div>
          <div className="text-sm font-bold text-slate-100 leading-relaxed mt-2">
            {selectedUnit.name}
          </div>
        </div>
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
          {Object.entries(selectedUnit.deployableInventory).map(([platformId, count]) => (
            <div key={platformId} className="flex items-center justify-between gap-2">
              <span>{catalog.platforms[platformId]?.name ?? platformId} · {count}</span>
              <button disabled={count <= 0} onClick={() => deployCarriedPlatform(selectedUnit.id, platformId)}
                className="px-2 py-1 rounded bg-violet-500 text-white disabled:opacity-35">释放</button>
            </div>
          ))}
        </div>
      )}
      {/* 2. 快捷战术动作按钮组 (F3 航路点 / F1 手动交战) */}
      <div className="unit-actions grid grid-cols-2 gap-2">
        <button
          onClick={() =>
            setInteractionMode(
              interactionMode === 'plot_waypoint' ? 'select' : 'plot_waypoint'
            )
          }
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
                'bg-emerald-950/60 text-emerald-200 border-emerald-500/40'}`}
          >
            沙盒移动单位
          </button>
        )}
      </div>

      {/* 3. 运动学遥测与速度/高度控制 (F2 Kinematics) */}
      <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-2">
        <div className="stat-line telemetry-heading flex items-center justify-between text-[11px] text-cyan-400 font-bold">
          <span className="flex items-center gap-1">
            <Gauge className="w-3.5 h-3.5" /> 运动与物理特征
          </span>
          {selectedUnit.waypoints.length > 0 && (
            <button
              onClick={() => clearUnitWaypoints(selectedUnit.id)}
              className="flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-300 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" /> 清空航点({selectedUnit.waypoints.length})
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="p-1.5 rounded bg-slate-900/80">
            <div className="text-slate-400 text-[10px]">经纬度坐标</div>
            <div className="text-slate-100 font-semibold">
              {selectedUnit.position[1].toFixed(2)}°N,{' '}
              {selectedUnit.position[0].toFixed(2)}°E
            </div>
          </div>
          <div className="p-1.5 rounded bg-slate-900/80">
            <div className="text-slate-400 text-[10px]">多向RCS (前/侧/尾)</div>
            <div className="text-cyan-300 font-semibold">
              {platformSpec.rcsProfile
                ? `${(platformSpec.rcsProfile.frontalM2 + configuration.rcsPenaltyM2).toFixed(3)}/${(platformSpec.rcsProfile.beamM2 + configuration.rcsPenaltyM2).toFixed(3)}/${(platformSpec.rcsProfile.rearM2 + configuration.rcsPenaltyM2).toFixed(3)} m²`
                : `${platformSpec.rcsM2 + configuration.rcsPenaltyM2} m²`}
            </div>
          </div>
          <div className="p-1.5 rounded bg-slate-900/80">
            <div className="text-slate-400 text-[10px]">对12m掠海视距</div>
            <div className="text-amber-300 font-semibold">
              {radarHorizons!.seaSkimmer.toFixed(1)} km
            </div>
          </div>
          <div className="p-1.5 rounded bg-slate-900/80">
            <div className="text-slate-400 text-[10px]">对9000m高空视距</div>
            <div className="text-emerald-300 font-semibold">
              {radarHorizons!.highAltitude.toFixed(0)} km
            </div>
          </div>
        </div>

        {/* 航速调节滑块 */}
        {configuration.maxSpeedKts > 0 && (
          <div className="space-y-1 pt-1">
            <div className="stat-line flex justify-between text-[11px]">
              <span className="text-slate-400">航速</span>
              <span className="text-cyan-300 font-bold">
                {Math.round(selectedUnit.targetSpeedKts)} kts (最大{' '}
                {configuration.maxSpeedKts} kts)
              </span>
            </div>
            <input
              aria-label="设定航速"
              type="range"
              min={0}
              max={configuration.maxSpeedKts}
              step={5}
              value={selectedUnit.targetSpeedKts}
              onChange={(e) =>
                updateUnitKinematics(
                  selectedUnit.id,
                  Number(e.target.value),
                  undefined
                )
              }
              className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded"
            />
          </div>
        )}

        {/* 高度层 / 潜深调节滑块 */}
        {(selectedUnit.domain === 'air' ||
          selectedUnit.domain === 'subsurface') && (
          <div className="space-y-1 pt-1">
            <div className="stat-line flex justify-between text-[11px]">
              <span className="text-slate-400">
                {selectedUnit.domain === 'air'
                  ? '作战高度'
                  : '潜航深度'}
              </span>
              <span className="text-cyan-300 font-bold">
                {Math.round(selectedUnit.targetAltitudeM)} m
                {selectedUnit.domain === 'subsurface' &&
                  selectedUnit.targetAltitudeM < -140 &&
                  ' (温跃层下隐蔽)'}
              </span>
            </div>
            <input
              aria-label={selectedUnit.domain === 'air' ? '作战高度' : '潜航深度'}
              type="range"
              min={platformSpec.minAltitudeM}
              max={platformSpec.maxAltitudeM}
              step={selectedUnit.domain === 'air' ? 200 : 10}
              value={selectedUnit.targetAltitudeM}
              onChange={(e) =>
                updateUnitKinematics(
                  selectedUnit.id,
                  undefined,
                  Number(e.target.value)
                )
              }
              className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded"
            />
          </div>
        )}

        {groupUnits.length > 1 && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-900 text-[10px]">
            <span className="text-slate-400">
              编队: {selectedUnit.navigationMode === 'formation'
                ? `跟随 ${units[selectedUnit.formationLeaderId ?? '']?.callsign ?? '领队'}`
                : `${groupUnits.length} 个可用单位`}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setGroupFormation(selectedUnit.parentGroupId, selectedUnit.id, 10)}
                className="px-2 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 cursor-pointer"
              >
                设为编队领队
              </button>
              <button
                onClick={() => setGroupFormation(selectedUnit.parentGroupId)}
                className="px-2 py-1 rounded bg-slate-800 text-slate-300 cursor-pointer"
              >
                解散编队
              </button>
            </div>
          </div>
        )}

        {selectedUnit.waypoints.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-slate-900">
            <div className="text-[10px] text-cyan-300 font-bold">分段航路参数</div>
            {selectedUnit.waypoints.map((waypoint, index) => (
              <div key={`${waypoint.position.join(',')}-${index}`} className="grid grid-cols-[auto_1fr_1fr_auto] gap-1 items-center text-[10px]">
                <span className="text-slate-400">WP-{index + 1}</span>
                <input
                  aria-label={`WP-${index + 1} 速度`}
                  type="number"
                  min={0}
                  max={configuration.maxSpeedKts}
                  placeholder="继承速度"
                  value={waypoint.speedKts ?? ''}
                  onChange={(event) => updateUnitWaypoint(selectedUnit.id, index, { speedKts: Number(event.target.value) })}
                  className="min-w-0 bg-slate-900 border border-slate-700 rounded px-1 py-1 text-slate-200"
                />
                <input
                  aria-label={`WP-${index + 1} 高度或潜深`}
                  type="number"
                  min={platformSpec.minAltitudeM}
                  max={platformSpec.maxAltitudeM}
                  placeholder="继承高度"
                  value={waypoint.altitudeM ?? ''}
                  onChange={(event) => updateUnitWaypoint(selectedUnit.id, index, { altitudeM: Number(event.target.value) })}
                  className="min-w-0 bg-slate-900 border border-slate-700 rounded px-1 py-1 text-slate-200"
                />
                <button
                  aria-label={`删除 WP-${index + 1}`}
                  onClick={() => removeUnitWaypoint(selectedUnit.id, index)}
                  className="text-rose-400 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. 交战条令 (ROE) 与电磁管控 (EMCON) 面板 */}
      <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-2.5">
        <div className="stat-line telemetry-heading flex items-center justify-between text-[11px] text-cyan-400 font-bold">
          <span className="flex items-center gap-1">
            <Radio className="w-3.5 h-3.5" /> 电磁管控与交战条令
          </span>
          <span className="text-[10px] text-slate-500">[F9]</span>
        </div>

        {/* ROE 三档切换 */}
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          {(
            [
              { id: 'free', label: '自由开火', color: 'bg-rose-600 text-white' },
              { id: 'tight', label: '自卫反导', color: 'bg-amber-500 text-slate-950' },
              { id: 'hold', label: '停止自动开火', color: 'bg-emerald-600 text-white' },
            ] as { id: ROEStatus; label: string; color: string }[]
          ).map((r) => (
            <button
              key={r.id}
              onClick={() => updateUnitDoctrine(selectedUnit.id, { roe: r.id })}
              className={`py-1.5 px-1 rounded font-bold cursor-pointer transition ${
                selectedUnit.doctrine.roe === r.id
                  ? r.color
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* 主动雷达、有源电子干扰(OECM)与主动声呐 EMCON 开关 */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() =>
              updateUnitDoctrine(selectedUnit.id, {
                emconRadar: !selectedUnit.doctrine.emconRadar,
              })
            }
            className={`p-2 rounded border text-left cursor-pointer transition ${
              selectedUnit.doctrine.emconRadar
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                : 'bg-slate-900/90 border-slate-800 text-slate-400'
            }`}
          >
            <div className="text-[10px] text-slate-400">主动雷达</div>
            <div className="text-xs font-bold mt-0.5">
              {selectedUnit.doctrine.emconRadar ? '● 雷达开启' : '○ 电磁静默'}
            </div>
          </button>

          <button
            onClick={() =>
              updateUnitDoctrine(selectedUnit.id, {
                emconJamming: !selectedUnit.doctrine.emconJamming,
              })
            }
            className={`p-2 rounded border text-left cursor-pointer transition ${
              selectedUnit.doctrine.emconJamming
                ? 'bg-purple-500/25 border-purple-400 text-purple-200'
                : 'bg-slate-900/90 border-slate-800 text-slate-400'
            }`}
          >
            <div className="text-[10px] text-slate-400">有源干扰</div>
            <div className="text-xs font-bold mt-0.5">
              {selectedUnit.doctrine.emconJamming ? '● 压制开启' : '○ 干扰静默'}
            </div>
          </button>

          <button
            onClick={() =>
              updateUnitDoctrine(selectedUnit.id, {
                emconSonar: !selectedUnit.doctrine.emconSonar,
              })
            }
            className={`p-2 rounded border text-left cursor-pointer transition ${
              selectedUnit.doctrine.emconSonar
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                : 'bg-slate-900/90 border-slate-800 text-slate-400'
            }`}
          >
            <div className="text-[10px] text-slate-400">主动声呐</div>
            <div className="text-xs font-bold mt-0.5">
              {selectedUnit.doctrine.emconSonar ? '● 主动探测' : '○ 被动监听'}
            </div>
          </button>
        </div>

        <div className="stat-line flex items-center justify-between text-[10px] text-slate-400">
          <span>软杀伤库存</span>
          <span className="text-amber-200">
            箔条 {selectedUnit.countermeasures.chaff} · 红外 {selectedUnit.countermeasures.flares} · 水声 {selectedUnit.countermeasures.acousticDecoys}
          </span>
        </div>

        {/* 战术挂载方案 (Loadout Profile) 实时切换 */}
        {platformSpec.availableLoadoutIds &&
          platformSpec.availableLoadoutIds.length > 0 && (
            <div className="pt-1 border-t border-slate-900 space-y-1">
              <div className="text-[10px] text-amber-300 font-bold">
                战术挂载方案切换
              </div>
              <select
                aria-label="战术挂载方案切换"
                value={selectedUnit.activeLoadoutId || ''}
                onChange={(e) =>
                  switchUnitLoadout(selectedUnit.id, e.target.value)
                }
                className="w-full bg-slate-900 border border-amber-500/40 rounded px-2 py-1 text-[11px] text-amber-200 cursor-pointer"
              >
                {platformSpec.availableLoadoutIds.map((lid) => {
                  const lSpec = catalog.loadouts[lid];
                  return (
                    <option key={lid} value={lid}>
                      {lSpec ? `${lSpec.name}` : lid}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

        {/* 齐射发数 (WRA Salvo Size) 与任务绑定 */}
        <div className="stat-line flex items-center justify-between text-[11px] pt-1 border-t border-slate-900">
          <span className="text-slate-400">单次齐射</span>
          <div className="flex gap-1">
            {[1, 2, 4].map((num) => (
              <button
                key={num}
                onClick={() =>
                  updateUnitDoctrine(selectedUnit.id, { salvoSize: num })
                }
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  selectedUnit.doctrine.salvoSize === num
                    ? 'bg-cyan-400 text-slate-950 font-bold'
                    : 'bg-slate-900 text-slate-400'
                }`}
              >
                {num}枚
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px] pt-1 border-t border-slate-900">
          <label className="space-y-1 text-slate-400">
            <span className="block">自动开火距离</span>
            <select
              aria-label="自动开火最大射程比例"
              value={selectedUnit.doctrine.automaticFireRangeFraction}
              onChange={(event) => updateUnitDoctrine(selectedUnit.id, {
                automaticFireRangeFraction: Number(event.target.value),
              })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
            >
              <option value={0.5}>最大射程 50%</option>
              <option value={0.75}>最大射程 75%</option>
              <option value={1}>最大射程 100%</option>
            </select>
          </label>
          <label className="space-y-1 text-slate-400">
            <span className="block">最低弹药保留</span>
            <input
              aria-label="自动开火最低弹药保留"
              type="number"
              min={0}
              max={999}
              value={selectedUnit.doctrine.minimumWeaponReserve}
              onChange={(event) => updateUnitDoctrine(selectedUnit.id, {
                minimumWeaponReserve: Number(event.target.value),
              })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
            />
          </label>
          <label className="col-span-2 flex items-center justify-between gap-2 text-slate-400">
            最低目标威胁
            <select
              aria-label="自动开火最低威胁等级"
              value={selectedUnit.doctrine.minimumAutomaticThreat}
              onChange={(event) => updateUnitDoctrine(selectedUnit.id, {
                minimumAutomaticThreat: event.target.value as ThreatLevel,
              })}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
            >
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="critical">危急</option>
            </select>
          </label>
          <div className="col-span-2 space-y-1 text-slate-400">
            <span className="block">允许自动交战目标域</span>
            <div className="grid grid-cols-4 gap-1">
              {(['air', 'surface', 'subsurface', 'land'] as Domain[]).map((domain) => {
                const enabled = selectedUnit.doctrine.automaticTargetDomains.includes(domain);
                return (
                  <button
                    key={domain}
                    aria-pressed={enabled}
                    onClick={() => updateUnitDoctrine(selectedUnit.id, {
                      automaticTargetDomains: enabled
                        ? selectedUnit.doctrine.automaticTargetDomains.filter((candidate) => candidate !== domain)
                        : [...selectedUnit.doctrine.automaticTargetDomains, domain],
                    })}
                    className={`px-1 py-1 rounded cursor-pointer ${enabled
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40'
                      : 'bg-slate-900 text-slate-500 border border-slate-800'}`}
                  >
                    {domainLabels[domain]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="stat-line flex items-center justify-between text-[11px]">
          <span className="text-slate-400">配属任务</span>
          <select
            aria-label="配属任务"
            value={selectedUnit.assignedMissionId || ''}
            onChange={(e) =>
              assignUnitMission(
                selectedUnit.id,
                e.target.value ? e.target.value : undefined
              )
            }
            className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-200"
          >
            <option value="">-- 人工直接指挥 --</option>
            {eligibleMissions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* 5. 传感器套件列表 */}
      <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-1.5">
        <div className="flex items-center gap-1 text-[11px] text-cyan-400 font-bold">
          <Shield className="w-3.5 h-3.5" />
          <span>传感器</span>
        </div>
        <div className="space-y-1">
          {configuration.sensorIds.map((sId) => {
            const sensor = catalog.sensors[sId];
            if (!sensor) return null;
            const isOnline =
              !sensor.isActiveEmitter ||
              (sensor.type === 'sonar_active'
                ? selectedUnit.doctrine.emconSonar
                : sensor.type === 'ecm_jammer'
                ? selectedUnit.doctrine.emconJamming
                : selectedUnit.doctrine.emconRadar);

            return (
              <div
                key={sId}
                className="px-2 py-1.5 rounded bg-slate-900/75 border border-slate-800/80 stat-line flex items-center justify-between text-[11px]"
              >
                <div className="min-w-0">
                  <div className="text-slate-200 font-medium truncate">
                    {sensor.name}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {sensor.frequencyBand} · 最大距离 {sensor.maxRangeKm} km
                  </div>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                    isOnline
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {isOnline ? '在线' : '静默'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 6. 武器弹药库与垂发单元 (VLS / WEAPON MOUNTS) */}
      <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-2">
        <div className="flex items-center gap-1 text-[11px] text-rose-400 font-bold">
          <Flame className="w-3.5 h-3.5" />
          <span>武器与弹药</span>
        </div>

        {selectedUnit.mounts.length === 0 ? (
          <div className="text-[11px] text-slate-500 py-2">
            该平台为纯支援/侦察节点，无进攻性武器挂架
          </div>
        ) : (
          <div className="space-y-2">
            {selectedUnit.mounts.map((m) => {
              const wSpec = catalog.weapons[m.weaponId];
              if (!wSpec) return null;
              return (
                <div
                  key={m.mountId}
                  className="p-2 rounded bg-slate-900/90 border border-slate-800 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-100 truncate">
                      {wSpec.name}
                    </span>
                    <span className="text-xs font-bold text-cyan-300 shrink-0">
                      {m.currentAmmo} / {m.maxAmmo} 发
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                    <span>
                      射程: {wSpec.maxRangeKm}km · 速度:{' '}
                      {(wSpec.speedKts / 661).toFixed(1)}马赫 · 基准 Pk:{' '}
                      {Math.round(wSpec.basePk * 100)}%
                      {wSpec.requiresDatalinkBeyondHorizon ? ' · CEC中继' : ''}
                    </span>
                    <button
                      disabled={m.currentAmmo <= 0 || m.cooldownRemainingSec > 0 || !capabilities?.canFire}
                      onClick={() =>
                        startManualEngage(
                          m.weaponId,
                          selectedUnit.doctrine.salvoSize
                        )
                      }
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

      {/* 7. 母舰航空机库与舰载机弹射放飞控制 (CARRIER HANGAR DECK) */}
      {selectedUnit.hangar && selectedUnit.hangar.length > 0 && (
        <div className="p-2.5 rounded bg-emerald-950/25 border border-emerald-500/40 space-y-2">
          <div className="text-[11px] text-emerald-300 font-bold">
            母舰机库与甲板弹射
          </div>
          <div className="space-y-2">
            {selectedUnit.hangar.map((slot) => {
              const selectionKey = `${selectedUnit.id}:${slot.slotId}`;
              const pendingSelection = hangarLoadoutSelections[selectionKey];
              const selectedLoadoutId = pendingSelection && slot.availableLoadoutIds.includes(pendingSelection)
                ? pendingSelection
                : slot.selectedLoadoutId;
              return (
                <div
                  key={slot.slotId}
                  className="p-2 rounded bg-slate-950/90 border border-emerald-500/30 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-100">
                      {slot.squadronName}
                    </span>
                    <span className="text-[11px] font-bold text-emerald-400">
                      待命: {slot.readyAirframes}/{slot.totalAirframes} 批
                    </span>
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
                      disabled={
                        slot.readyAirframes <= 0 || slot.cooldownRemainingSec > 0
                      }
                      onClick={() =>
                        launchCarrierAircraft(
                          selectedUnit.id,
                          slot.slotId,
                          selectedLoadoutId
                        )
                      }
                      className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-35 text-slate-950 font-bold text-[11px] cursor-pointer shrink-0"
                    >
                      {slot.cooldownRemainingSec > 0
                        ? `甲板整备 (${slot.cooldownRemainingSec}s)`
                        : '弹射升空'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
});
