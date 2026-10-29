import { useEffect, useRef, useState } from 'react';
import { useWargameStore } from '../store/useWargameStore';
import { canCommandUnit } from '../engine/commandPolicy';
import { evaluateFireControl } from '../engine/fireControl';
import { effectiveDoctrine } from '../engine/operations';
import type { TacticalContact } from '../types/wargame';

export function FireControlDiagnostics({ contact }: { contact: TacticalContact }) {
  const units = useWargameStore((s) => s.units);
  const catalog = useWargameStore((s) => s.catalog);
  const missions = useWargameStore((s) => s.missions);
  const simTime = useWargameStore((s) => s.simTime);
  const playerSide = useWargameStore((s) => s.playerSide);
  const playMode = useWargameStore((s) => s.playMode);
  const battleResult = useWargameStore((s) => s.battleResult);
  const selectedUnitId = useWargameStore((s) => s.selectedUnitId);
  const execute = useWargameStore((s) => s.executeManualEngage);
  const [chosenId, setChosenId] = useState(selectedUnitId);
  const choices = Object.values(units).filter((u) => u.side === contact.observerSide && u.mounts.length &&
    canCommandUnit({ playerSide, playMode, battleResult }, u));
  const attacker = choices.find((u) => u.id === chosenId) ?? choices[0];
  return <section className="p-2.5 rounded bg-slate-950/80 border border-slate-700 space-y-3" aria-label="火控诊断">
    <h3 className="text-xs font-bold text-cyan-300">火控诊断 · 基于本方情报</h3>
    <p className="text-xs text-slate-400">最后观测：{Math.max(0, (simTime - contact.lastDetectedTime) / 1000).toFixed(1)} 秒前 · 误差 ±{contact.uncertaintyRadiusKm.toFixed(1)} km</p>
    {!attacker ? <p className="text-xs text-slate-400">当前没有可指挥的武装平台。</p> : <>
      <select aria-label="选择火力平台" className="w-full bg-slate-900 rounded p-2 text-xs" value={attacker.id} onChange={(e) => setChosenId(e.target.value)}>
        {choices.map((u) => <option key={u.id} value={u.id}>{u.callsign}</option>)}
      </select>
      {attacker.mounts.map((mount) => {
        const weapon = catalog.weapons[mount.weaponId];
        const solution = evaluateFireControl({ ...attacker, doctrine: effectiveDoctrine(attacker, missions) }, contact, mount, weapon, catalog, units, simTime);
        const blocked = solution.status === 'blocked';
        const risky = solution.status === 'risky';
        return <article key={mount.mountId} className="border-t border-slate-800 pt-2 space-y-1 text-xs">
          <div className="font-semibold">{weapon.name} · {mount.currentAmmo} 发</div>
          <div className="text-slate-400">估计距离 {solution.distanceKm?.toFixed(1)} km · 中继 / 火控：{solution.supportSourceIds.map((id) => units[id]?.callsign).join('、') || '无有效支援'}</div>
          {solution.hardBlockReasons.map((reason) => <p key={reason} className="text-rose-300">不可执行：{reason}</p>)}
          {solution.riskWarnings.map((reason) => <p key={reason} className="text-amber-300">风险：{reason}</p>)}
          <button disabled={blocked} className={`px-3 py-1.5 rounded disabled:opacity-40 ${risky ? 'bg-amber-500 text-slate-950' : 'bg-cyan-700 text-white'}`}
            onClick={() => execute(attacker.id, contact.id, weapon.id, attacker.doctrine.salvoSize)}>
            {blocked ? '条件不满足' : risky ? '查看风险并授权' : `齐射 ${Math.min(attacker.doctrine.salvoSize, mount.currentAmmo)} 枚`}
          </button>
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
    className="tactical-panel text-slate-100 p-6 rounded-lg border border-amber-500/60 backdrop:bg-black/60"
    style={{ margin: 'auto', width: 'min(92vw, 460px)' }}>
    {pending && <>
      <h2 id="risk-title" className="text-lg font-bold text-amber-300">是否授权这次风险射击？</h2>
      <ul className="my-4 space-y-2 text-sm">{pending.solution.riskWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      <p className="text-sm text-slate-400">只授权本次指令，不修改条令。执行前会重新检查弹药、冷却和情报。</p>
      <div className="mt-5 flex gap-3 justify-end">
        <button autoFocus onClick={dismiss} className="toolbar-button">取消</button>
        <button className="toolbar-button bg-amber-500 text-slate-950" onClick={() =>
          execute(pending.attackerId, pending.contactId, pending.weaponId, pending.salvoCount, true)}>接受风险，授权发射</button>
      </div>
    </>}
  </dialog>;
}
