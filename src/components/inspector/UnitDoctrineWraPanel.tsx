import React from 'react';
import { Radio } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import { domainLabels } from '../../ui/labels';
import type { Domain, PlatformSpec, ROEStatus, RuntimeUnit, TacticalMission, ThreatLevel } from '../../types/wargame';

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
    <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-2.5">
      <div className="stat-line telemetry-heading flex items-center justify-between text-[11px] text-cyan-400 font-bold">
        <span className="flex items-center gap-1">
          <Radio className="w-3.5 h-3.5" /> 电磁管控与交战条令
        </span>
        <span className="text-[10px] text-slate-500">[F9]</span>
      </div>

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
            onClick={() => updateUnitDoctrine(unit.id, { roe: r.id })}
            className={`py-1.5 px-1 rounded font-bold cursor-pointer transition ${
              unit.doctrine.roe === r.id
                ? r.color
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => updateUnitDoctrine(unit.id, { emconRadar: !unit.doctrine.emconRadar })}
          className={`p-2 rounded border text-left cursor-pointer transition ${
            unit.doctrine.emconRadar
              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
              : 'bg-slate-900/90 border-slate-800 text-slate-400'
          }`}
        >
          <div className="text-[10px] text-slate-400">主动雷达</div>
          <div className="text-xs font-bold mt-0.5">{unit.doctrine.emconRadar ? '● 雷达开启' : '○ 电磁静默'}</div>
        </button>

        <button
          onClick={() => updateUnitDoctrine(unit.id, { emconJamming: !unit.doctrine.emconJamming })}
          className={`p-2 rounded border text-left cursor-pointer transition ${
            unit.doctrine.emconJamming
              ? 'bg-purple-500/25 border-purple-400 text-purple-200'
              : 'bg-slate-900/90 border-slate-800 text-slate-400'
          }`}
        >
          <div className="text-[10px] text-slate-400">有源干扰</div>
          <div className="text-xs font-bold mt-0.5">{unit.doctrine.emconJamming ? '● 压制开启' : '○ 干扰静默'}</div>
        </button>

        <button
          onClick={() => updateUnitDoctrine(unit.id, { emconSonar: !unit.doctrine.emconSonar })}
          className={`p-2 rounded border text-left cursor-pointer transition ${
            unit.doctrine.emconSonar
              ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
              : 'bg-slate-900/90 border-slate-800 text-slate-400'
          }`}
        >
          <div className="text-[10px] text-slate-400">主动声呐</div>
          <div className="text-xs font-bold mt-0.5">{unit.doctrine.emconSonar ? '● 主动探测' : '○ 被动监听'}</div>
        </button>
      </div>

      <div className="stat-line flex items-center justify-between text-[10px] text-slate-300">
        <span>软杀伤手动投放</span>
        <div className="flex gap-1">
          <button
            disabled={unitDead || unit.countermeasures.chaff <= 0}
            onClick={() => deployCountermeasure(unit.id, 'chaff')}
            className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-amber-200 disabled:opacity-35 cursor-pointer"
          >
            箔条({unit.countermeasures.chaff})
          </button>
          <button
            disabled={unitDead || unit.countermeasures.flares <= 0}
            onClick={() => deployCountermeasure(unit.id, 'flares')}
            className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-amber-200 disabled:opacity-35 cursor-pointer"
          >
            红外({unit.countermeasures.flares})
          </button>
          <button
            disabled={unitDead || unit.countermeasures.acousticDecoys <= 0}
            onClick={() => deployCountermeasure(unit.id, 'acousticDecoys')}
            className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-amber-200 disabled:opacity-35 cursor-pointer"
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
          className={`px-2 py-1 rounded border text-left cursor-pointer disabled:opacity-35 ${
            unit.doctrine.autoEvade ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200' : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          自动规避：{unit.doctrine.autoEvade ? '开启' : '关闭'}
        </button>
        <button
          disabled={unitDead}
          aria-pressed={!!unit.doctrine.requireIdentifiedForAutoFire}
          onClick={() => updateUnitDoctrine(unit.id, { requireIdentifiedForAutoFire: !unit.doctrine.requireIdentifiedForAutoFire })}
          className={`px-2 py-1 rounded border text-left cursor-pointer disabled:opacity-35 ${
            unit.doctrine.requireIdentifiedForAutoFire ? 'bg-amber-500/20 border-amber-400 text-amber-200' : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          识别后开火：{unit.doctrine.requireIdentifiedForAutoFire ? '开启' : '关闭'}
        </button>
      </div>

      {platformSpec.availableLoadoutIds && platformSpec.availableLoadoutIds.length > 0 && (
        <div className="pt-1 border-t border-slate-900 space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-amber-300 font-bold">战术挂载方案切换</span>
            {loadoutLocked && <span className="text-slate-400">推演中锁定（沙盒可改）</span>}
          </div>
          <select
            aria-label="战术挂载方案切换"
            disabled={loadoutLocked || unitDead}
            value={unit.activeLoadoutId || ''}
            onChange={(e) => switchUnitLoadout(unit.id, e.target.value)}
            className="w-full bg-slate-900 border border-amber-500/40 rounded px-2 py-1 text-[11px] text-amber-200 cursor-pointer disabled:opacity-45"
          >
            {platformSpec.availableLoadoutIds.map((lid) => {
              const lSpec = catalog.loadouts[lid];
              return <option key={lid} value={lid}>{lSpec ? lSpec.name : lid}</option>;
            })}
          </select>
        </div>
      )}

      <div className="stat-line flex items-center justify-between text-[11px] pt-1 border-t border-slate-900">
        <span className="text-slate-400">单次齐射</span>
        <div className="flex gap-1">
          {[1, 2, 4].map((num) => (
            <button
              key={num}
              onClick={() => updateUnitDoctrine(unit.id, { salvoSize: num })}
              className={`px-2 py-0.5 rounded cursor-pointer ${
                unit.doctrine.salvoSize === num ? 'bg-cyan-400 text-slate-950 font-bold' : 'bg-slate-900 text-slate-400'
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
            value={unit.doctrine.automaticFireRangeFraction}
            onChange={(event) => updateUnitDoctrine(unit.id, { automaticFireRangeFraction: Number(event.target.value) })}
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
            value={unit.doctrine.minimumWeaponReserve}
            onChange={(event) => updateUnitDoctrine(unit.id, { minimumWeaponReserve: Number(event.target.value) })}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
          />
        </label>
        <label className="col-span-2 flex items-center justify-between gap-2 text-slate-400">
          最低目标威胁
          <select
            aria-label="自动开火最低威胁等级"
            value={unit.doctrine.minimumAutomaticThreat}
            onChange={(event) => updateUnitDoctrine(unit.id, { minimumAutomaticThreat: event.target.value as ThreatLevel })}
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
                  className={`px-1 py-1 rounded cursor-pointer ${
                    enabled ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40' : 'bg-slate-900 text-slate-500 border border-slate-800'
                  }`}
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
          value={unit.assignedMissionId || ''}
          onChange={(e) => assignUnitMission(unit.id, e.target.value ? e.target.value : undefined)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-200"
        >
          <option value="">-- 人工直接指挥 --</option>
          {eligibleMissions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
    </div>
  );
};
