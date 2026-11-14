import React from 'react';
import { Gauge, Trash2 } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import type { PlatformSpec, RuntimeUnit } from '../../types/wargame';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Slider } from '../ui/slider';

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
    <div className="space-y-3">
      <div className="stat-line telemetry-heading flex items-center justify-between text-[11px] text-foreground font-semibold">
        <span className="flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-muted-foreground" /> 运动与物理特征
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

      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <div className="p-2 rounded-lg bg-muted/45 border border-border">
          <div className="text-muted-foreground text-[10px]">经纬度坐标</div>
          <div className="text-foreground font-semibold font-mono tabular-nums mt-0.5">
            {unit.position[1].toFixed(2)}°N, {unit.position[0].toFixed(2)}°E
          </div>
        </div>
        <div className="p-2 rounded-lg bg-muted/45 border border-border min-w-0">
          <div className="text-muted-foreground text-[10px] truncate">多向RCS (m²)</div>
          <div className="text-sky-300 text-[10px] font-semibold font-mono tabular-nums tracking-tight mt-0.5 break-words">
            {platformSpec.rcsProfile
              ? `${(platformSpec.rcsProfile.frontalM2 + rcsPenaltyM2).toFixed(3)} / ${(platformSpec.rcsProfile.beamM2 + rcsPenaltyM2).toFixed(3)} / ${(platformSpec.rcsProfile.rearM2 + rcsPenaltyM2).toFixed(3)}`
              : `${platformSpec.rcsM2 + rcsPenaltyM2}`}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-muted/45 border border-border">
          <div className="text-muted-foreground text-[10px]">对12m掠海视距</div>
          <div className="text-amber-300 font-semibold font-mono tabular-nums mt-0.5">{radarHorizons.seaSkimmer.toFixed(1)} km</div>
        </div>
        <div className="p-2 rounded-lg bg-muted/45 border border-border">
          <div className="text-muted-foreground text-[10px]">对9000m高空视距</div>
          <div className="text-emerald-300 font-semibold font-mono tabular-nums mt-0.5">{radarHorizons.highAltitude.toFixed(0)} km</div>
        </div>
      </div>

      {maxSpeedKts > 0 && (
        <div className="space-y-1 pt-1">
          <div className="stat-line flex justify-between text-[11px]">
            <span className="text-muted-foreground">航速</span>
            <span className="text-foreground font-semibold font-mono tabular-nums">
              {Math.round(unit.targetSpeedKts)} kts (最大 {maxSpeedKts} kts)
            </span>
          </div>
          <Slider
            aria-label="设定航速"
            min={0}
            max={maxSpeedKts}
            step={5}
            value={unit.targetSpeedKts}
            onChange={(e) => updateUnitKinematics(unit.id, Number(e.target.value), undefined)}
          />
        </div>
      )}

      {(unit.domain === 'air' || unit.domain === 'subsurface') && (
        <div className="space-y-1 pt-1">
          <div className="stat-line flex justify-between text-[11px]">
            <span className="text-muted-foreground">{unit.domain === 'air' ? '作战高度' : '潜航深度'}</span>
            <span className="text-foreground font-semibold font-mono tabular-nums">
              {Math.round(unit.targetAltitudeM)} m
              {unit.domain === 'subsurface' && unit.targetAltitudeM < -140 && ' (温跃层下隐蔽)'}
            </span>
          </div>
          <Slider
            aria-label={unit.domain === 'air' ? '作战高度' : '潜航深度'}
            min={platformSpec.minAltitudeM}
            max={platformSpec.maxAltitudeM}
            step={unit.domain === 'air' ? 200 : 10}
            value={unit.targetAltitudeM}
            onChange={(e) => updateUnitKinematics(unit.id, undefined, Number(e.target.value))}
          />
        </div>
      )}

      {groupUnits.length > 1 && (
        <div className="pt-2 border-t border-border space-y-1.5 text-[10px]">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>编队协同</span>
            <span className="text-foreground">
              {unit.navigationMode === 'formation'
                ? `跟随 ${units[unit.formationLeaderId ?? '']?.callsign ?? '领队'}`
                : `${groupUnits.length} 个可用单位`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="xs"
              variant="outline"
              onClick={() => setGroupFormation(unit.parentGroupId, unit.id, 10)}
            >
              设为编队领队
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setGroupFormation(unit.parentGroupId)}
            >
              解散编队
            </Button>
          </div>
        </div>
      )}

      {unit.waypoints.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <div className="text-[10px] text-foreground font-semibold">分段航路参数</div>
          {unit.waypoints.map((waypoint, index) => (
            <div key={`${waypoint.position.join(',')}-${index}`} className="grid grid-cols-[auto_1fr_1fr_auto] gap-1 items-center text-[10px]">
              <span className="text-muted-foreground font-mono">WP-{index + 1}</span>
              <Input
                aria-label={`WP-${index + 1} 速度`}
                type="number"
                min={0}
                max={maxSpeedKts}
                placeholder="继承速度"
                value={waypoint.speedKts ?? ''}
                onChange={(event) => updateUnitWaypoint(unit.id, index, { speedKts: Number(event.target.value) })}
                className="h-7 px-1.5 text-[10px] font-mono tabular-nums"
              />
              <Input
                aria-label={`WP-${index + 1} 高度或潜深`}
                type="number"
                min={platformSpec.minAltitudeM}
                max={platformSpec.maxAltitudeM}
                placeholder="继承高度"
                value={waypoint.altitudeM ?? ''}
                onChange={(event) => updateUnitWaypoint(unit.id, index, { altitudeM: Number(event.target.value) })}
                className="h-7 px-1.5 text-[10px] font-mono tabular-nums"
              />
              <button
                aria-label={`删除 WP-${index + 1}`}
                onClick={() => removeUnitWaypoint(unit.id, index)}
                className="text-rose-400 hover:text-rose-300 cursor-pointer p-1"
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
