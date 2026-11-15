import { useEffect, useRef, useState } from 'react';
import { useWargameStore } from '../store/useWargameStore';
import { canCommandUnit } from '../engine/commandPolicy';
import { evaluateFireControl } from '../engine/fireControl';
import { effectiveDoctrine } from '../engine/operations';
import type { TacticalContact } from '../types/wargame';

import { Select } from './ui/select';
import { Button } from './ui/button';

export function FireControlDiagnostics({ contact }: { contact: TacticalContact }) {
  const units = useWargameStore((s) => s.units);
  const weaponsInFlight = useWargameStore((s) => s.weaponsInFlight);
  const catalog = useWargameStore((s) => s.catalog);
  const missions = useWargameStore((s) => s.missions);
  const simTime = useWargameStore((s) => s.simTime);
  const playerSide = useWargameStore((s) => s.playerSide);
  const playMode = useWargameStore((s) => s.playMode);
  const battleResult = useWargameStore((s) => s.battleResult);
  const selectedUnitId = useWargameStore((s) => s.selectedUnitId);
  const selectedUnitIds = useWargameStore((s) => s.selectedUnitIds);
  const execute = useWargameStore((s) => s.executeManualEngage);
  const scheduleTotStrike = useWargameStore((s) => s.scheduleTotStrike);
  const [chosenId, setChosenId] = useState(selectedUnitId);
  const choices = Object.values(units).filter((u) => u.side === contact.observerSide && u.mounts.length &&
    canCommandUnit({ playerSide, playMode, battleResult }, u));
  const attacker = choices.find((u) => u.id === chosenId) ?? choices[0];
  return <section className="bg-card/85 border border-border space-y-3" aria-label="火控诊断">
    <h3 className="text-xs font-semibold text-primary">火控诊断 · 基于本方情报</h3>
    <p className="text-xs text-muted-foreground">最后观测：{Math.max(0, (simTime - contact.lastDetectedTime) / 1000).toFixed(1)} 秒前 · 误差 ±{contact.uncertaintyRadiusKm.toFixed(1)} km</p>
    {!attacker ? <p className="text-xs text-muted-foreground">当前没有可指挥的武装平台。</p> : <>
      <Select aria-label="选择火力平台" value={attacker.id} onChange={(e) => setChosenId(e.target.value)}>
        {choices.map((u) => <option key={u.id} value={u.id}>{u.callsign}</option>)}
      </Select>
      {selectedUnitIds.length > 1 && (
        <div className="p-2 rounded-md bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-2 text-[11px]">
          <span className="text-rose-200">已多选 {selectedUnitIds.length} 单元 · 异速导弹错峰同秒饱和突防</span>
          <Button
            size="xs"
            variant="destructive"
            onClick={() => scheduleTotStrike(selectedUnitIds, contact.id)}
          >
            TOT 同步齐射
          </Button>
        </div>
      )}
      {attacker.mounts.map((mount) => {
        const weapon = catalog.weapons[mount.weaponId];
        const solution = evaluateFireControl({ ...attacker, doctrine: effectiveDoctrine(attacker, missions) }, contact, mount, weapon, catalog, units, simTime, 'manual', weaponsInFlight);
        const blocked = solution.status === 'blocked';
        const risky = solution.status === 'risky';
        return <article key={mount.mountId} className="border-t border-border pt-2.5 space-y-1.5 text-xs">
          <div className="font-semibold text-foreground">{weapon.name} · {mount.currentAmmo} 发</div>
          <div className="text-[11px] text-muted-foreground">
            估计距离 {solution.distanceKm?.toFixed(1)} km · NEZ {solution.nezRangeKm?.toFixed(0)} km (
            <span className={solution.withinNez ? 'text-emerald-300 font-medium' : 'text-amber-300'}>
              {solution.withinNez ? 'NEZ高杀伤区内' : '末端能量衰减区'}
            </span>
            ) · 预计 TOF {solution.estimatedTofSec ?? 0}s
          </div>
          <div className="text-[11px] text-muted-foreground">
            中继 / 火控：{solution.supportSourceIds.map((id) => units[id]?.callsign).join('、') || '无有效支援'}
          </div>
          {solution.hardBlockReasons.map((reason) => <p key={reason} className="text-[11px] text-rose-300">不可执行：{reason}</p>)}
          {solution.riskWarnings.map((reason) => <p key={reason} className="text-[11px] text-amber-300">风险：{reason}</p>)}
          <Button
            size="sm"
            variant={risky ? 'warning' : 'default'}
            disabled={blocked}
            onClick={() => execute(attacker.id, contact.id, weapon.id, attacker.doctrine.salvoSize)}
          >
            {blocked ? '条件不满足' : risky ? '查看风险并授权' : `齐射 ${Math.min(attacker.doctrine.salvoSize, mount.currentAmmo)} 枚`}
          </Button>
        </article>;
      })}
    </>}
  </section>;
}

export function RiskEngagementDialog() {
  const pending = useWargameStore((s) => s.pendingRiskEngagement);
  const dismiss = useWargameStore((s) => s.dismissRiskEngagement);
  const execute = useWargameStore((s) => s.executeManualEngage);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (pending && !dialog.current?.open) dialog.current?.showModal();
    if (!pending) dialog.current?.close();
  }, [pending]);
  return <dialog ref={dialog} onCancel={dismiss} aria-labelledby="risk-title"
    className="rounded-xl border border-amber-500/45 bg-card text-card-foreground p-6 shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-xs"
    style={{ margin: 'auto', width: 'min(92vw, 460px)' }}>
    {pending && <>
      <h2 id="risk-title" className="text-base font-semibold text-amber-300">是否授权这次风险射击？</h2>
      <ul className="my-4 space-y-2 text-xs text-foreground list-disc list-inside">{pending.solution.riskWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      <p className="text-xs text-muted-foreground">只授权本次指令，不修改条令。执行前会重新检查弹药、冷却和情报。</p>
      <div className="mt-5 flex gap-2 justify-end">
        <Button variant="outline" autoFocus onClick={dismiss}>取消</Button>
        <Button variant="warning" onClick={() =>
          execute(pending.attackerId, pending.contactId, pending.weaponId, pending.salvoCount, true, pending.doglegWaypoints)}>接受风险，授权发射</Button>
      </div>
    </>}
  </dialog>;
}
