import React from 'react';
import { Radio } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import { domainLabels } from '../../ui/labels';
import type { Domain, PlatformSpec, ROEStatus, RuntimeUnit, TacticalMission, ThreatLevel } from '../../types/wargame';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';

interface Props {
  unit: RuntimeUnit;
  platformSpec: PlatformSpec;
  eligibleMissions: TacticalMission[];
}

export const UnitDoctrineWraPanel: React.FC<Props> = ({ unit, platformSpec, eligibleMissions }) => {
  const catalog = useWargameStore((s) => s.catalog);
  const tick = useWargameStore((s) => s.tick);
  const playMode = useWargameStore((s) => s.playMode);
  const updateUnitDoctrine = useWargameStore((s) => s.updateUnitDoctrine);
  const switchUnitLoadout = useWargameStore((s) => s.switchUnitLoadout);
  const assignUnitMission = useWargameStore((s) => s.assignUnitMission);
  const deployCountermeasure = useWargameStore((s) => s.deployCountermeasure);
  const loadoutLocked = tick > 0 && playMode !== 'sandbox';
  const unitDead = unit.hp <= 0 || unit.status === 'destroyed';

  return (
    <div className="space-y-3">
      <div className="stat-line telemetry-heading flex items-center justify-between text-[11px] text-foreground font-semibold">
        <span className="flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-muted-foreground" /> 电磁管控与交战条令
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">[F9]</span>
      </div>

      <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted/70 border border-border text-[10px]">
        {(
          [
            { id: 'free', label: '自由开火', color: 'bg-rose-600 text-white shadow-xs' },
            { id: 'tight', label: '自卫反导', color: 'bg-amber-500 text-zinc-950 shadow-xs' },
            { id: 'hold', label: '停止自动开火', color: 'bg-emerald-600 text-white shadow-xs' },
          ] as { id: ROEStatus; label: string; color: string }[]
        ).map((r) => (
          <button
            key={r.id}
            onClick={() => updateUnitDoctrine(unit.id, { roe: r.id })}
            className={`h-7 px-1 rounded-md font-semibold cursor-pointer transition-colors whitespace-nowrap ${
              unit.doctrine.roe === r.id
                ? r.color
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => updateUnitDoctrine(unit.id, { emconRadar: !unit.doctrine.emconRadar })}
          className={`px-2 py-1.5 rounded-lg border text-left cursor-pointer transition-colors ${
            unit.doctrine.emconRadar
              ? 'bg-sky-500/15 border-sky-400/50 text-sky-200'
              : 'bg-secondary/60 border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          }`}
        >
          <div className="text-[10px] text-muted-foreground leading-tight">主动雷达</div>
          <div className="flex items-center gap-1 text-[11px] font-semibold mt-1 whitespace-nowrap">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${unit.doctrine.emconRadar ? 'bg-sky-400' : 'bg-zinc-600'}`} />
            <span>{unit.doctrine.emconRadar ? '雷达开启' : '电磁静默'}</span>
          </div>
        </button>

        <button
          onClick={() => updateUnitDoctrine(unit.id, { emconJamming: !unit.doctrine.emconJamming })}
          className={`px-2 py-1.5 rounded-lg border text-left cursor-pointer transition-colors ${
            unit.doctrine.emconJamming
              ? 'bg-purple-500/20 border-purple-400/50 text-purple-200'
              : 'bg-secondary/60 border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          }`}
        >
          <div className="text-[10px] text-muted-foreground leading-tight">有源干扰</div>
          <div className="flex items-center gap-1 text-[11px] font-semibold mt-1 whitespace-nowrap">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${unit.doctrine.emconJamming ? 'bg-purple-400' : 'bg-zinc-600'}`} />
            <span>{unit.doctrine.emconJamming ? '压制开启' : '干扰静默'}</span>
          </div>
        </button>

        <button
          onClick={() => updateUnitDoctrine(unit.id, { emconSonar: !unit.doctrine.emconSonar })}
          className={`px-2 py-1.5 rounded-lg border text-left cursor-pointer transition-colors ${
            unit.doctrine.emconSonar
              ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
              : 'bg-secondary/60 border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          }`}
        >
          <div className="text-[10px] text-muted-foreground leading-tight">主动声呐</div>
          <div className="flex items-center gap-1 text-[11px] font-semibold mt-1 whitespace-nowrap">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${unit.doctrine.emconSonar ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            <span>{unit.doctrine.emconSonar ? '主动探测' : '被动监听'}</span>
          </div>
        </button>
      </div>

      <Separator />

      <div className="space-y-1.5 text-[10px]">
        <div className="text-muted-foreground">软杀伤手动投放</div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            disabled={unitDead || unit.countermeasures.chaff <= 0}
            onClick={() => deployCountermeasure(unit.id, 'chaff')}
            className="h-7 px-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-200 disabled:opacity-35 cursor-pointer font-mono tabular-nums whitespace-nowrap transition-colors"
          >
            箔条({unit.countermeasures.chaff})
          </button>
          <button
            disabled={unitDead || unit.countermeasures.flares <= 0}
            onClick={() => deployCountermeasure(unit.id, 'flares')}
            className="h-7 px-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-200 disabled:opacity-35 cursor-pointer font-mono tabular-nums whitespace-nowrap transition-colors"
          >
            红外({unit.countermeasures.flares})
          </button>
          <button
            disabled={unitDead || unit.countermeasures.acousticDecoys <= 0}
            onClick={() => deployCountermeasure(unit.id, 'acousticDecoys')}
            className="h-7 px-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-200 disabled:opacity-35 cursor-pointer font-mono tabular-nums whitespace-nowrap transition-colors"
          >
            声诱饵({unit.countermeasures.acousticDecoys})
          </button>
        </div>
      </div>

      <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-2 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground">自动规避威胁</span>
          <Switch
            aria-label="自动规避"
            disabled={unitDead}
            checked={unit.doctrine.autoEvade}
            onCheckedChange={(checked) => updateUnitDoctrine(unit.id, { autoEvade: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground">仅攻击已识别目标</span>
          <Switch
            aria-label="识别后开火"
            disabled={unitDead}
            checked={!!unit.doctrine.requireIdentifiedForAutoFire}
            onCheckedChange={(checked) => updateUnitDoctrine(unit.id, { requireIdentifiedForAutoFire: checked })}
          />
        </div>
        {unit.domain === 'land' && platformSpec.maxSpeedKts > 0 && (
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
            <span className="text-foreground">发射后机动规避</span>
            <Switch
              aria-label="发射后机动规避"
              disabled={unitDead}
              checked={!!unit.doctrine.shootAndScoot}
              onCheckedChange={(checked) => updateUnitDoctrine(unit.id, { shootAndScoot: checked })}
            />
          </div>
        )}
        {unit.domain === 'air' && !['awacs', 'tanker', 'decoy'].includes(unit.category) && (
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
            <span className="text-foreground">BVR 偏置/脱离 (Crank/Pump)</span>
            <Switch
              aria-label="BVR偏置脱离战术"
              disabled={unitDead}
              checked={unit.doctrine.bvrTactics === 'crank_pump'}
              onCheckedChange={(checked) =>
                updateUnitDoctrine(unit.id, { bvrTactics: checked ? 'crank_pump' : 'standard' })
              }
            />
          </div>
        )}
      </div>

      {platformSpec.availableLoadoutIds && platformSpec.availableLoadoutIds.length > 0 && (
        <div className="pt-2 border-t border-border space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-amber-300 font-semibold">战术挂载方案切换</span>
            {loadoutLocked && <span className="text-muted-foreground">推演中锁定（沙盒可改）</span>}
          </div>
          <Select
            aria-label="战术挂载方案切换"
            disabled={loadoutLocked || unitDead}
            value={unit.activeLoadoutId || ''}
            onChange={(e) => switchUnitLoadout(unit.id, e.target.value)}
            className="h-7 text-[11px] border-amber-500/35 text-amber-200"
          >
            {platformSpec.availableLoadoutIds.map((lid) => {
              const lSpec = catalog.loadouts[lid];
              return <option key={lid} value={lid}>{lSpec ? lSpec.name : lid}</option>;
            })}
          </Select>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] pt-2 border-t border-border">
        <span className="text-muted-foreground">单次齐射</span>
        <div className="inline-flex p-0.5 rounded-md bg-muted border border-border gap-0.5">
          {[1, 2, 4].map((num) => (
            <button
              key={num}
              onClick={() => updateUnitDoctrine(unit.id, { salvoSize: num })}
              className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors ${
                unit.doctrine.salvoSize === num ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {num}枚
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] pt-2 border-t border-border">
        <label className="space-y-1 text-muted-foreground">
          <span className="block">自动开火距离</span>
          <Select
            aria-label="自动开火最大射程比例"
            value={unit.doctrine.automaticFireRangeFraction}
            onChange={(event) => updateUnitDoctrine(unit.id, { automaticFireRangeFraction: Number(event.target.value) })}
            className="h-7 text-[11px]"
          >
            <option value={0.5}>最大射程 50%</option>
            <option value={0.75}>最大射程 75%</option>
            <option value={1}>最大射程 100%</option>
          </Select>
        </label>
        <label className="space-y-1 text-muted-foreground">
          <span className="block">最低弹药保留</span>
          <Input
            aria-label="自动开火最低弹药保留"
            type="number"
            min={0}
            max={999}
            value={unit.doctrine.minimumWeaponReserve}
            onChange={(event) => updateUnitDoctrine(unit.id, { minimumWeaponReserve: Number(event.target.value) })}
            className="h-7 text-[11px] font-mono tabular-nums"
          />
        </label>
        <label className="col-span-2 flex items-center justify-between gap-2 text-muted-foreground">
          <span>最低目标威胁</span>
          <Select
            aria-label="自动开火最低威胁等级"
            value={unit.doctrine.minimumAutomaticThreat}
            onChange={(event) => updateUnitDoctrine(unit.id, { minimumAutomaticThreat: event.target.value as ThreatLevel })}
            className="w-auto min-w-[96px] h-7 text-[11px]"
          >
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="critical">危急</option>
          </Select>
        </label>
        <div className="col-span-2 space-y-1 text-muted-foreground">
          <span className="block">允许自动交战目标域</span>
          <div className="grid grid-cols-4 gap-1">
            {(['air', 'surface', 'subsurface', 'land'] as Domain[]).map((domain) => {
              const enabled = unit.doctrine.automaticTargetDomains.includes(domain);
              return (
                <button
                  key={domain}
                  aria-pressed={enabled}
                  onClick={() => updateUnitDoctrine(unit.id, {
                    automaticTargetDomains: enabled
                      ? unit.doctrine.automaticTargetDomains.filter((candidate) => candidate !== domain)
                      : [...unit.doctrine.automaticTargetDomains, domain],
                  })}
                  className={`h-7 px-1 rounded-md border cursor-pointer transition-colors ${
                    enabled ? 'bg-primary text-primary-foreground border-primary font-semibold' : 'bg-secondary/50 text-muted-foreground border-border hover:text-foreground'
                  }`}
                >
                  {domainLabels[domain]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <label className="block space-y-1 pt-2 border-t border-border text-[10px]">
        <span className="block text-muted-foreground">配属任务</span>
        <Select
          aria-label="配属任务"
          value={unit.assignedMissionId || ''}
          onChange={(e) => assignUnitMission(unit.id, e.target.value ? e.target.value : undefined)}
          className="h-7 text-[11px]"
        >
          <option value="">-- 人工直接指挥 --</option>
          {eligibleMissions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </label>
    </div>
  );
};
