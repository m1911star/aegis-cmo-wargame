import React from 'react';
import { Radio } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import { domainLabels } from '../../ui/labels';
import type { Domain, PlatformSpec, ROEStatus, RuntimeUnit, TacticalMission, ThreatLevel } from '../../types/wargame';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

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
    <div className="space-y-2.5">
      <div className="stat-line telemetry-heading flex items-center justify-between text-[11px] text-cyan-400 font-bold">
        <span className="flex items-center gap-1">
          <Radio className="w-3.5 h-3.5" /> 电磁管控与交战条令
        </span>
        <span className="text-[10px] text-slate-500 font-mono">[F9]</span>
      </div>

      <div className="grid grid-cols-3 gap-1 text-[10px]">
        {(
          [
            { id: 'free', label: '自由开火', color: 'bg-rose-600 text-white border-rose-500' },
            { id: 'tight', label: '自卫反导', color: 'bg-amber-500 text-slate-950 border-amber-400' },
            { id: 'hold', label: '停止自动开火', color: 'bg-emerald-600 text-white border-emerald-500' },
          ] as { id: ROEStatus; label: string; color: string }[]
        ).map((r) => (
          <button
            key={r.id}
            onClick={() => updateUnitDoctrine(unit.id, { roe: r.id })}
            className={`h-7 px-1 rounded border font-bold cursor-pointer transition whitespace-nowrap ${
              unit.doctrine.roe === r.id
                ? r.color
                : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 border-slate-800'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => updateUnitDoctrine(unit.id, { emconRadar: !unit.doctrine.emconRadar })}
          className={`px-2 py-1.5 rounded border text-left cursor-pointer transition ${
            unit.doctrine.emconRadar
              ? 'bg-cyan-500/20 border-cyan-400/80 text-cyan-200'
              : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:border-slate-700'
          }`}
        >
          <div className="text-[10px] text-slate-400 leading-tight">主动雷达</div>
          <div className="flex items-center gap-1 text-[11px] font-bold mt-1 whitespace-nowrap">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${unit.doctrine.emconRadar ? 'bg-cyan-300 shadow-[0_0_6px_#67e8f9]' : 'bg-slate-600'}`} />
            <span>{unit.doctrine.emconRadar ? '雷达开启' : '电磁静默'}</span>
          </div>
        </button>

        <button
          onClick={() => updateUnitDoctrine(unit.id, { emconJamming: !unit.doctrine.emconJamming })}
          className={`px-2 py-1.5 rounded border text-left cursor-pointer transition ${
            unit.doctrine.emconJamming
              ? 'bg-purple-500/25 border-purple-400/80 text-purple-200'
              : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:border-slate-700'
          }`}
        >
          <div className="text-[10px] text-slate-400 leading-tight">有源干扰</div>
          <div className="flex items-center gap-1 text-[11px] font-bold mt-1 whitespace-nowrap">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${unit.doctrine.emconJamming ? 'bg-purple-300 shadow-[0_0_6px_#d8b4fe]' : 'bg-slate-600'}`} />
            <span>{unit.doctrine.emconJamming ? '压制开启' : '干扰静默'}</span>
          </div>
        </button>

        <button
          onClick={() => updateUnitDoctrine(unit.id, { emconSonar: !unit.doctrine.emconSonar })}
          className={`px-2 py-1.5 rounded border text-left cursor-pointer transition ${
            unit.doctrine.emconSonar
              ? 'bg-emerald-500/20 border-emerald-400/80 text-emerald-200'
              : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:border-slate-700'
          }`}
        >
          <div className="text-[10px] text-slate-400 leading-tight">主动声呐</div>
          <div className="flex items-center gap-1 text-[11px] font-bold mt-1 whitespace-nowrap">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${unit.doctrine.emconSonar ? 'bg-emerald-300 shadow-[0_0_6px_#6ee7b7]' : 'bg-slate-600'}`} />
            <span>{unit.doctrine.emconSonar ? '主动探测' : '被动监听'}</span>
          </div>
        </button>
      </div>

      <div className="space-y-1 pt-1.5 border-t border-slate-800/80 text-[10px]">
        <div className="text-slate-400">软杀伤手动投放</div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            disabled={unitDead || unit.countermeasures.chaff <= 0}
            onClick={() => deployCountermeasure(unit.id, 'chaff')}
            className="h-6 px-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 disabled:opacity-35 cursor-pointer font-mono tabular-nums whitespace-nowrap transition"
          >
            箔条({unit.countermeasures.chaff})
          </button>
          <button
            disabled={unitDead || unit.countermeasures.flares <= 0}
            onClick={() => deployCountermeasure(unit.id, 'flares')}
            className="h-6 px-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 disabled:opacity-35 cursor-pointer font-mono tabular-nums whitespace-nowrap transition"
          >
            红外({unit.countermeasures.flares})
          </button>
          <button
            disabled={unitDead || unit.countermeasures.acousticDecoys <= 0}
            onClick={() => deployCountermeasure(unit.id, 'acousticDecoys')}
            className="h-6 px-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 disabled:opacity-35 cursor-pointer font-mono tabular-nums whitespace-nowrap transition"
          >
            声诱饵({unit.countermeasures.acousticDecoys})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <button
          disabled={unitDead}
          aria-pressed={unit.doctrine.autoEvade}
          onClick={() => updateUnitDoctrine(unit.id, { autoEvade: !unit.doctrine.autoEvade })}
          className={`h-7 px-2 rounded border flex items-center justify-between cursor-pointer disabled:opacity-35 transition whitespace-nowrap ${
            unit.doctrine.autoEvade ? 'bg-cyan-500/20 border-cyan-400/80 text-cyan-200' : 'bg-slate-900/90 border-slate-800 text-slate-400'
          }`}
        >
          <span>自动规避</span>
          <span className="font-bold">{unit.doctrine.autoEvade ? '开启' : '关闭'}</span>
        </button>
        <button
          disabled={unitDead}
          aria-pressed={!!unit.doctrine.requireIdentifiedForAutoFire}
          onClick={() => updateUnitDoctrine(unit.id, { requireIdentifiedForAutoFire: !unit.doctrine.requireIdentifiedForAutoFire })}
          className={`h-7 px-2 rounded border flex items-center justify-between cursor-pointer disabled:opacity-35 transition whitespace-nowrap ${
            unit.doctrine.requireIdentifiedForAutoFire ? 'bg-amber-500/20 border-amber-400/80 text-amber-200' : 'bg-slate-900/90 border-slate-800 text-slate-400'
          }`}
        >
          <span>识别后开火</span>
          <span className="font-bold">{unit.doctrine.requireIdentifiedForAutoFire ? '开启' : '关闭'}</span>
        </button>
        {unit.domain === 'land' && platformSpec.maxSpeedKts > 0 && (
          <button
            disabled={unitDead}
            aria-pressed={!!unit.doctrine.shootAndScoot}
            onClick={() => updateUnitDoctrine(unit.id, { shootAndScoot: !unit.doctrine.shootAndScoot })}
            className={`col-span-2 h-7 px-2 rounded border flex items-center justify-between cursor-pointer disabled:opacity-35 transition ${
              unit.doctrine.shootAndScoot ? 'bg-emerald-500/20 border-emerald-400/80 text-emerald-200' : 'bg-slate-900/90 border-slate-800 text-slate-400'
            }`}
          >
            <span>发射后机动规避 (Shoot-and-Scoot)</span>
            <span className="font-bold">{unit.doctrine.shootAndScoot ? '开启' : '关闭'}</span>
          </button>
        )}
      </div>

      {platformSpec.availableLoadoutIds && platformSpec.availableLoadoutIds.length > 0 && (
        <div className="pt-1.5 border-t border-slate-800/80 space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-amber-300 font-bold">战术挂载方案切换</span>
            {loadoutLocked && <span className="text-slate-400">推演中锁定（沙盒可改）</span>}
          </div>
          <select
            aria-label="战术挂载方案切换"
            disabled={loadoutLocked || unitDead}
            value={unit.activeLoadoutId || ''}
            onChange={(e) => switchUnitLoadout(unit.id, e.target.value)}
            className="w-full h-7 bg-background/90 border border-amber-500/40 rounded-md px-2 text-[11px] text-amber-200 cursor-pointer disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {platformSpec.availableLoadoutIds.map((lid) => {
              const lSpec = catalog.loadouts[lid];
              return <option key={lid} value={lid}>{lSpec ? lSpec.name : lid}</option>;
            })}
          </select>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-border/80">
        <span className="text-muted-foreground">单次齐射</span>
        <div className="inline-flex p-0.5 rounded-md bg-background/85 border border-border gap-0.5">
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

      <div className="grid grid-cols-2 gap-2 text-[10px] pt-1.5 border-t border-border/80">
        <label className="space-y-1 text-muted-foreground">
          <span className="block">自动开火距离</span>
          <Select
            aria-label="自动开火最大射程比例"
            value={unit.doctrine.automaticFireRangeFraction}
            onChange={(event) => updateUnitDoctrine(unit.id, { automaticFireRangeFraction: Number(event.target.value) })}
            className="h-7 text-[11px] pl-2 pr-6"
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
            wrapperClassName="min-w-[88px]"
            className="h-7 text-[11px] pl-2 pr-6"
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
                    enabled ? 'bg-cyan-500/15 text-cyan-200 border-cyan-400/50 font-medium' : 'bg-secondary/50 text-muted-foreground border-border hover:text-foreground'
                  }`}
                >
                  {domainLabels[domain]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <label className="block space-y-1 pt-1.5 border-t border-border/80 text-[10px]">
        <span className="block text-muted-foreground">配属任务</span>
        <Select
          aria-label="配属任务"
          value={unit.assignedMissionId || ''}
          onChange={(e) => assignUnitMission(unit.id, e.target.value ? e.target.value : undefined)}
          className="h-7 text-[11px] pl-2 pr-6"
        >
          <option value="">-- 人工直接指挥 --</option>
          {eligibleMissions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </label>
    </div>
  );
};
