import React, { useState } from 'react';
import { Database, X } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';

export const CatalogViewerModal: React.FC = () => {
  const catalog = useWargameStore((s) => s.catalog);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const [catalogTab, setCatalogTab] = useState<
    'platforms' | 'loadouts' | 'weapons' | 'sensors'
  >('platforms');

  return (
    <div className="w-full max-w-4xl tactical-panel rounded-lg border border-cyan-400/50 overflow-hidden">
      <div className="px-4 py-3 bg-cyan-950/50 border-b border-cyan-500/30 flex items-center justify-between">
        <div className="flex items-center gap-2 text-cyan-300 font-bold text-sm">
          <Database className="w-4 h-4" />
          <span>
            EQUIPMENT CATALOG // 现代海陆空潜电装备参数库 ({catalog.version})
          </span>
        </div>
        <button
          onClick={() => setActiveModal('none')}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 pt-3 bg-slate-950/80 border-b border-slate-800 flex gap-2 text-xs">
        {(
          [
            {
              id: 'platforms',
              label: `作战平台 (${Object.keys(catalog.platforms).length})`,
            },
            {
              id: 'loadouts',
              label: `战术挂载方案 (${Object.keys(catalog.loadouts).length})`,
            },
            {
              id: 'weapons',
              label: `导弹与鱼雷武器库 (${Object.keys(catalog.weapons).length})`,
            },
            {
              id: 'sensors',
              label: `雷达/声呐/电子战传感器 (${Object.keys(catalog.sensors).length})`,
            },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setCatalogTab(t.id)}
            className={`px-3 py-2 border-b-2 cursor-pointer font-bold ${
              catalogTab === t.id
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 max-h-[68vh] overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {catalogTab === 'platforms' &&
          Object.values(catalog.platforms).map((p) => (
            <div
              key={p.id}
              className="p-3 rounded bg-slate-950/85 border border-slate-800 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-cyan-300">{p.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 uppercase">
                  {p.domain} · {p.origin}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                {p.className} (ID: <code>{p.id}</code>)
              </div>
              <div className="grid grid-cols-3 gap-1 text-[10px] bg-slate-900/80 p-1.5 rounded">
                <div>最大航速: {p.maxSpeedKts}kt</div>
                <div>正面RCS: {p.rcsM2}m²</div>
                <div>结构HP: {p.maxHp}</div>
                <div>近防拦截: {Math.round(p.ciwsDefenseProb * 100)}%</div>
                <div>雷达高: {p.radarAntennaHeightM}m</div>
                <div>数据链: {p.hasDatalink ? 'CEC支持' : '无'}</div>
              </div>
              <p className="text-[11px] text-slate-300">{p.description}</p>
            </div>
          ))}

        {catalogTab === 'loadouts' &&
          Object.values(catalog.loadouts).map((l) => (
            <div
              key={l.id}
              className="p-3 rounded bg-slate-950/85 border border-slate-800 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-300">{l.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-300 uppercase">
                  {l.role}
                </span>
              </div>
              <div className="text-[10px] text-cyan-400">
                适配平台: {l.compatiblePlatformIds.join(', ')} · RCS惩罚: +
                {l.rcsPenaltyM2 || 0}m²
              </div>
              <p className="text-[11px] text-slate-300">{l.description}</p>
            </div>
          ))}

        {catalogTab === 'weapons' &&
          Object.values(catalog.weapons).map((w) => (
            <div
              key={w.id}
              className="p-3 rounded bg-slate-950/85 border border-slate-800 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-rose-300">{w.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/50 text-rose-300 uppercase">
                  {w.category}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[10px] bg-slate-900/80 p-1.5 rounded">
                <div>最大射程: {w.maxRangeKm}km</div>
                <div>飞行速度: {(w.speedKts / 661).toFixed(1)}马赫</div>
                <div>巡航高度: {w.cruiseAltitudeM}m</div>
                <div>基准Pk: {Math.round(w.basePk * 100)}%</div>
                <div>战斗部伤害: {w.warheadDamage}</div>
                <div>反导能力: {w.canInterceptMissile ? '具备' : '无'}</div>
              </div>
              <p className="text-[11px] text-slate-300">{w.description}</p>
            </div>
          ))}

        {catalogTab === 'sensors' &&
          Object.values(catalog.sensors).map((s) => (
            <div
              key={s.id}
              className="p-3 rounded bg-slate-950/85 border border-slate-800 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-300">{s.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/50 text-emerald-300">
                  {s.maxRangeKm} km
                </span>
              </div>
              <div className="text-[10px] text-cyan-400">
                体制: {s.frequencyBand} ·{' '}
                {s.isActiveEmitter ? '主动辐射源 (受EMCON控制)' : '纯被动静默探测'}
              </div>
              <p className="text-[11px] text-slate-300">{s.description}</p>
            </div>
          ))}
      </div>
    </div>
  );
};
