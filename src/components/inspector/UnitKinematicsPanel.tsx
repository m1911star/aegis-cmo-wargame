import React from 'react';
import { Gauge, Trash2 } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import type { PlatformSpec, RuntimeUnit } from '../../types/wargame';

interface Props {
  unit: RuntimeUnit;
  platformSpec: PlatformSpec;
  maxSpeedKts: number;
  rcsPenaltyM2: number;
  radarHorizons: { seaSkimmer: number; highAltitude: number };
  groupUnits: RuntimeUnit[];
}

export const UnitKinematicsPanel: React.FC<Props> = ({
  unit,
  platformSpec,
  maxSpeedKts,
  rcsPenaltyM2,
  radarHorizons,
  groupUnits,
}) => {
  const units = useWargameStore((s) => s.units);
  const clearUnitWaypoints = useWargameStore((s) => s.clearUnitWaypoints);
  const updateUnitWaypoint = useWargameStore((s) => s.updateUnitWaypoint);
  const removeUnitWaypoint = useWargameStore((s) => s.removeUnitWaypoint);
  const setGroupFormation = useWargameStore((s) => s.setGroupFormation);
  const updateUnitKinematics = useWargameStore((s) => s.updateUnitKinematics);

  return (
    <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-2">
      <div className="stat-line telemetry-heading flex items-center justify-between text-[11px] text-cyan-400 font-bold">
        <span className="flex items-center gap-1">
          <Gauge className="w-3.5 h-3.5" /> 运动与物理特征
        </span>
        {unit.waypoints.length > 0 && (
          <button
            onClick={() => clearUnitWaypoints(unit.id)}
            className="flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-300 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" /> 清空航点({unit.waypoints.length})
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="p-1.5 rounded bg-slate-900/80">
          <div className="text-slate-400 text-[10px]">经纬度坐标</div>
          <div className="text-slate-100 font-semibold">
            {unit.position[1].toFixed(2)}°N, {unit.position[0].toFixed(2)}°E
          </div>
        </div>
        <div className="p-1.5 rounded bg-slate-900/80">
          <div className="text-slate-400 text-[10px]">多向RCS (前/侧/尾)</div>
          <div className="text-cyan-300 font-semibold">
            {platformSpec.rcsProfile
              ? `${(platformSpec.rcsProfile.frontalM2 + rcsPenaltyM2).toFixed(3)}/${(platformSpec.rcsProfile.beamM2 + rcsPenaltyM2).toFixed(3)}/${(platformSpec.rcsProfile.rearM2 + rcsPenaltyM2).toFixed(3)} m²`
              : `${platformSpec.rcsM2 + rcsPenaltyM2} m²`}
          </div>
        </div>
        <div className="p-1.5 rounded bg-slate-900/80">
          <div className="text-slate-400 text-[10px]">对12m掠海视距</div>
          <div className="text-amber-300 font-semibold">{radarHorizons.seaSkimmer.toFixed(1)} km</div>
        </div>
        <div className="p-1.5 rounded bg-slate-900/80">
          <div className="text-slate-400 text-[10px]">对9000m高空视距</div>
          <div className="text-emerald-300 font-semibold">{radarHorizons.highAltitude.toFixed(0)} km</div>
        </div>
      </div>

      {maxSpeedKts > 0 && (
        <div className="space-y-1 pt-1">
          <div className="stat-line flex justify-between text-[11px]">
            <span className="text-slate-400">航速</span>
            <span className="text-cyan-300 font-bold">
              {Math.round(unit.targetSpeedKts)} kts (最大 {maxSpeedKts} kts)
            </span>
          </div>
          <input
            aria-label="设定航速"
            type="range"
            min={0}
            max={maxSpeedKts}
            step={5}
            value={unit.targetSpeedKts}
            onChange={(e) => updateUnitKinematics(unit.id, Number(e.target.value), undefined)}
            className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded"
          />
        </div>
      )}

      {(unit.domain === 'air' || unit.domain === 'subsurface') && (
        <div className="space-y-1 pt-1">
          <div className="stat-line flex justify-between text-[11px]">
            <span className="text-slate-400">{unit.domain === 'air' ? '作战高度' : '潜航深度'}</span>
            <span className="text-cyan-300 font-bold">
              {Math.round(unit.targetAltitudeM)} m
              {unit.domain === 'subsurface' && unit.targetAltitudeM < -140 && ' (温跃层下隐蔽)'}
            </span>
          </div>
          <input
            aria-label={unit.domain === 'air' ? '作战高度' : '潜航深度'}
            type="range"
            min={platformSpec.minAltitudeM}
            max={platformSpec.maxAltitudeM}
            step={unit.domain === 'air' ? 200 : 10}
            value={unit.targetAltitudeM}
            onChange={(e) => updateUnitKinematics(unit.id, undefined, Number(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded"
          />
        </div>
      )}

      {groupUnits.length > 1 && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-900 text-[10px]">
          <span className="text-slate-400">
            编队:{' '}
            {unit.navigationMode === 'formation'
              ? `跟随 ${units[unit.formationLeaderId ?? '']?.callsign ?? '领队'}`
              : `${groupUnits.length} 个可用单位`}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setGroupFormation(unit.parentGroupId, unit.id, 10)}
              className="px-2 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 cursor-pointer"
            >
              设为编队领队
            </button>
            <button
              onClick={() => setGroupFormation(unit.parentGroupId)}
              className="px-2 py-1 rounded bg-slate-800 text-slate-300 cursor-pointer"
            >
              解散编队
            </button>
          </div>
        </div>
      )}

      {unit.waypoints.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-slate-900">
          <div className="text-[10px] text-cyan-300 font-bold">分段航路参数</div>
          {unit.waypoints.map((waypoint, index) => (
            <div key={`${waypoint.position.join(',')}-${index}`} className="grid grid-cols-[auto_1fr_1fr_auto] gap-1 items-center text-[10px]">
              <span className="text-slate-400">WP-{index + 1}</span>
              <input
                aria-label={`WP-${index + 1} 速度`}
                type="number"
                min={0}
                max={maxSpeedKts}
                placeholder="继承速度"
                value={waypoint.speedKts ?? ''}
                onChange={(event) => updateUnitWaypoint(unit.id, index, { speedKts: Number(event.target.value) })}
                className="min-w-0 bg-slate-900 border border-slate-700 rounded px-1 py-1 text-slate-200"
              />
              <input
                aria-label={`WP-${index + 1} 高度或潜深`}
                type="number"
                min={platformSpec.minAltitudeM}
                max={platformSpec.maxAltitudeM}
                placeholder="继承高度"
                value={waypoint.altitudeM ?? ''}
                onChange={(event) => updateUnitWaypoint(unit.id, index, { altitudeM: Number(event.target.value) })}
                className="min-w-0 bg-slate-900 border border-slate-700 rounded px-1 py-1 text-slate-200"
              />
              <button
                aria-label={`删除 WP-${index + 1}`}
                onClick={() => removeUnitWaypoint(unit.id, index)}
                className="text-rose-400 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
