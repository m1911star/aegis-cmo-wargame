import { visibleLogs } from '../engine/commandPolicy';
import { isActiveUnit } from '../engine/unitCapabilities';
import React, { useState } from 'react';
import { Terminal, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import { logCategoryLabels } from '../ui/labels';
import type { CombatLogCategory } from '../types/wargame';

const FILTERS: { id: CombatLogCategory | 'ALL'; label: string }[] = [
  { id: 'ALL', label: '全部' },
  { id: 'DETECTION', label: '发现目标' },
  { id: 'LAUNCH', label: '武器发射' },
  { id: 'INTERCEPT', label: '拦截' },
  { id: 'HIT', label: '命中' },
  { id: 'DESTROYED', label: '战损' },
];

export const BottomCombatLogDock: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filterCat, setFilterCat] = useState<CombatLogCategory | 'ALL'>('ALL');
  const allLogs = useWargameStore((s) => s.logs);
  const playerSide = useWargameStore((s) => s.playerSide);
  const playMode = useWargameStore((s) => s.playMode);
  const battleResult = useWargameStore((s) => s.battleResult);
  const selectLogEntry = useWargameStore((s) => s.selectLogEntry);
  const reveal = playMode === 'sandbox' || !!battleResult;
  const logs = visibleLogs(allLogs, playerSide, reveal);
  const score = useWargameStore((s) => s.score);
  const units = useWargameStore((s) => s.units);
  const contacts = useWargameStore((s) => s.contacts);
  const weaponsInFlight = useWargameStore((s) => s.weaponsInFlight);
  const filteredLogs = filterCat === 'ALL' ? logs : logs.filter((l) => l.category === filterCat);
  const redAlive = Object.values(units).filter((u) => u.side === 'RED' && isActiveUnit(u)).length;
  const blueAlive = Object.values(units).filter((u) => u.side === 'BLUE' && isActiveUnit(u)).length;
  const latestLog = logs[0];

  return (
    <section className={`combat-dock tactical-panel ${isExpanded ? 'is-expanded' : ''}`} aria-label="实时战报">
      <div className="combat-dock-header">
        <button onClick={() => setIsExpanded(!isExpanded)} aria-expanded={isExpanded} aria-controls="combat-log-content" className="combat-dock-toggle">
          <Terminal className="w-4 h-4" /><span>实时战报</span>
          <span className="text-slate-500 font-normal">{logs.length}</span>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
        {isExpanded ? (
          <div className="log-filters" role="group" aria-label="战报分类">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilterCat(f.id)} aria-pressed={filterCat === f.id} className={filterCat === f.id ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}>{f.label}</button>
            ))}
          </div>
        ) : (
        <span className="latest-event" title={latestLog?.title}>{latestLog?.title ?? '等待战场事件'}</span>
        )}
        <div className="dock-summary">
          <span className="text-rose-400">红方损失 {reveal || playerSide === 'RED' ? score.redLosses : '未知'}</span>
          <span className="text-sky-400">蓝方损失 {reveal || playerSide === 'BLUE' ? score.blueLosses : '未知'}</span>
          <span className="text-amber-300">本方在途 {Object.values(weaponsInFlight).filter((w) => reveal || w.side === playerSide).length}</span>
        </div>
      </div>
      {isExpanded && (
        <div id="combat-log-content" className="min-h-0 flex flex-col flex-1">
          <div className="log-content">
            <div className="log-list">
              {filteredLogs.length === 0 && <p className="p-4 text-xs text-slate-500">暂无此类战报</p>}
              {filteredLogs.map((entry) => {
                const content = <>
                  <time>{new Date(entry.simTime).toISOString().slice(11, 19)}</time>
                  <span className="log-badge">{logCategoryLabels[entry.category] ?? '事件'}</span>
                  <span className="log-copy"><strong className="font-medium text-slate-200">{entry.title}</strong><span className="log-description">{entry.message}</span></span>
                  {entry.position && <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                </>;
                return entry.position || entry.unitId || entry.contactId ? (
                  <button key={entry.id} className="log-entry" onClick={() => selectLogEntry(entry.id)}>{content}</button>
                ) : <div key={entry.id} className="log-entry">{content}</div>;
              })}
            </div>
            <div className="scorecards">
              {[
                { id: 'RED', label: '红方联指', color: 'text-rose-300', alive: redAlive, losses: score.redLosses, fired: score.redMissilesFired, interceptions: score.redInterceptions, points: score.redScore },
                { id: 'BLUE', label: '蓝方联指', color: 'text-sky-300', alive: blueAlive, losses: score.blueLosses, fired: score.blueMissilesFired, interceptions: score.blueInterceptions, points: score.blueScore },
              ].filter((side) => reveal || side.id === playerSide).map((side) => (
                <article key={side.label}>
                  <h3 className={`font-semibold ${side.color}`}>{side.label}</h3>
                  <dl><dt>存活</dt><dd>{side.alive}</dd><dt>战损</dt><dd>{side.losses}</dd><dt>发射</dt><dd>{side.fired}</dd><dt>拦截</dt><dd>{side.interceptions}</dd></dl>
                  <div className={`${side.color} border-t border-slate-800 pt-2`}>战果 {reveal ? `${side.points} 分` : '结束后结算'}</div>
                </article>
              ))}
              <div className="col-span-2 text-slate-400">跟踪目标 <b className="text-amber-300">{Object.values(contacts).filter((c) => reveal || c.observerSide === playerSide).length}</b> 批</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
