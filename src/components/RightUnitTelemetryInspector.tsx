import React, { useMemo } from 'react';
import ms from 'milsymbol';
import {
  Navigation,
  Crosshair,
  Radio,
  Shield,
  Gauge,
  Trash2,
  Flame,
  Target,
} from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import {
  calculateRadarHorizonKm,
  getDistanceKm,
} from '../engine/simulationEngine';
import { classificationLabels, domainLabels, statusLabels, threatLabels } from '../ui/labels';
import type { ROEStatus } from '../types/wargame';
import { resolveUnitConfiguration } from '../db/unitConfiguration';

export const RightUnitTelemetryInspector: React.FC = () => {
  const selectedUnitId = useWargameStore((s) => s.selectedUnitId);
  const selectedContactId = useWargameStore((s) => s.selectedContactId);
  const units = useWargameStore((s) => s.units);
  const contacts = useWargameStore((s) => s.contacts);
  const catalog = useWargameStore((s) => s.catalog);
  const missions = useWargameStore((s) => s.missions);

  const interactionMode = useWargameStore((s) => s.interactionMode);
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);
  const startManualEngage = useWargameStore((s) => s.startManualEngage);
  const clearUnitWaypoints = useWargameStore((s) => s.clearUnitWaypoints);
  const updateUnitDoctrine = useWargameStore((s) => s.updateUnitDoctrine);
  const updateUnitKinematics = useWargameStore((s) => s.updateUnitKinematics);
  const switchUnitLoadout = useWargameStore((s) => s.switchUnitLoadout);
  const launchCarrierAircraft = useWargameStore((s) => s.launchCarrierAircraft);
  const assignUnitMission = useWargameStore((s) => s.assignUnitMission);
  const executeManualEngage = useWargameStore((s) => s.executeManualEngage);

  const selectedUnit = selectedUnitId ? units[selectedUnitId] : null;
  const selectedContact = selectedContactId ? contacts[selectedContactId] : null;

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

  // 情形 A: 当前选中了敌方情报接触 (Contact)
  if (selectedContact) {
    // 筛选己方有哪些算子在射程内可以立即对该 Contact 发动打击
    const capableFriendlyUnits = Object.values(units).filter((u) => {
      if (u.hp <= 0 || u.side !== selectedContact.observerSide) return false;
      const distKm = getDistanceKm(u.position, selectedContact.estimatedPosition);
      return u.mounts.some((m) => {
        if (m.currentAmmo <= 0 || m.cooldownRemainingSec > 0) return false;
        const w = catalog.weapons[m.weaponId];
        return (
          w &&
          w.targetDomains.includes(selectedContact.domain) &&
          distKm <= w.maxRangeKm &&
          distKm >= w.minRangeKm
        );
      });
    });

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
            <span className="text-slate-400">定位误差半径:</span>
            <span className="text-amber-400 font-bold">
              ± {selectedContact.uncertaintyRadiusKm} km
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

        {/* 快速联合火力打击分配 */}
        <div className="p-2.5 rounded bg-rose-950/25 border border-rose-500/35 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
            <Target className="w-4 h-4" />
            <span>联合火力分配</span>
          </div>
          {capableFriendlyUnits.length === 0 ? (
            <div className="text-[11px] text-slate-400">
              当前暂无己方平台处于有效打击射程内，请指挥战机或舰艇机动接敌。
            </div>
          ) : (
            <div className="space-y-1.5">
              {capableFriendlyUnits.map((attacker) => {
                const distKm = getDistanceKm(
                  attacker.position,
                  selectedContact.estimatedPosition
                );
                return (
                  <div
                    key={attacker.id}
                    className="p-2 rounded bg-slate-950/90 border border-rose-500/30 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-100 truncate">
                        {attacker.name}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        距离目标: {distKm.toFixed(1)} km
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        executeManualEngage(
                          attacker.id,
                          selectedContact.id,
                          undefined,
                          2
                        )
                      }
                      className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold cursor-pointer shrink-0"
                    >
                      齐射 2 枚
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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

  const seaSkimmerHorizonKm = calculateRadarHorizonKm(
    selectedUnit.altitudeM,
    platformSpec.radarAntennaHeightM,
    12
  );
  const highAltHorizonKm = calculateRadarHorizonKm(
    selectedUnit.altitudeM,
    platformSpec.radarAntennaHeightM,
    9000
  );

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
              {seaSkimmerHorizonKm.toFixed(1)} km
            </div>
          </div>
          <div className="p-1.5 rounded bg-slate-900/80">
            <div className="text-slate-400 text-[10px]">对9000m高空视距</div>
            <div className="text-emerald-300 font-semibold">
              {highAltHorizonKm.toFixed(0)} km
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
              { id: 'hold', label: '严禁开火', color: 'bg-emerald-600 text-white' },
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
            {missions
              .filter((m) => m.side === selectedUnit.side)
              .map((m) => (
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
                      {(wSpec.speedKts / 661).toFixed(1)}马赫 · 命中率:{' '}
                      {Math.round(wSpec.basePk * 100)}%
                      {wSpec.requiresDatalinkBeyondHorizon ? ' · CEC中继' : ''}
                    </span>
                    <button
                      disabled={m.currentAmmo <= 0}
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
            {selectedUnit.hangar.map((slot) => (
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
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-400 truncate">
                    挂载:{' '}
                    {catalog.loadouts[slot.selectedLoadoutId]?.name ||
                      slot.selectedLoadoutId}
                  </span>
                  <button
                    disabled={
                      slot.readyAirframes <= 0 || slot.cooldownRemainingSec > 0
                    }
                    onClick={() =>
                      launchCarrierAircraft(
                        selectedUnit.id,
                        slot.slotId,
                        slot.selectedLoadoutId
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
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};
