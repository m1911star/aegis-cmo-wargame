import React, { useMemo, useState } from 'react';
import { Database, Search } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import { Badge } from '../ui/badge';
import { ModalHeader, ModalShell } from '../ui/dialog';
import { Select } from '../ui/select';

export const CatalogViewerModal: React.FC = () => {
  const catalog = useWargameStore((s) => s.catalog);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const [catalogTab, setCatalogTab] = useState<
    'platforms' | 'loadouts' | 'weapons' | 'sensors'
  >('platforms');
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('ALL');
  const normalizedQuery = query.trim().toLowerCase();

  const matchesText = (text: string) => !normalizedQuery || text.toLowerCase().includes(normalizedQuery);
  const platforms = useMemo(
    () => Object.values(catalog.platforms).filter((p) =>
      (domainFilter === 'ALL' || p.domain === domainFilter) &&
      matchesText(`${p.id} ${p.name} ${p.className} ${p.origin} ${p.description}`)
    ),
    [catalog.platforms, domainFilter, normalizedQuery]
  );
  const loadouts = useMemo(
    () => Object.values(catalog.loadouts).filter((l) =>
      matchesText(`${l.id} ${l.name} ${l.codeName} ${l.role} ${l.description}`)
    ),
    [catalog.loadouts, normalizedQuery]
  );
  const weapons = useMemo(
    () => Object.values(catalog.weapons).filter((w) =>
      (domainFilter === 'ALL' || w.targetDomains.includes(domainFilter as never)) &&
      matchesText(`${w.id} ${w.name} ${w.codeName} ${w.category} ${w.description}`)
    ),
    [catalog.weapons, domainFilter, normalizedQuery]
  );
  const sensors = useMemo(
    () => Object.values(catalog.sensors).filter((s) =>
      (domainFilter === 'ALL' || s.detectDomains.includes(domainFilter as never)) &&
      matchesText(`${s.id} ${s.name} ${s.codeName} ${s.frequencyBand} ${s.description}`)
    ),
    [catalog.sensors, domainFilter, normalizedQuery]
  );

  return (
    <ModalShell className="max-w-4xl">
      <ModalHeader
        icon={<Database className="w-4 h-4" />}
        title={`EQUIPMENT CATALOG // 现代海陆空潜电装备参数库 (${catalog.version})`}
        onClose={() => setActiveModal('none')}
        closeLabel="关闭装备库"
      />

      <div className="px-4 py-2 bg-muted/30 border-b border-border flex flex-wrap gap-1.5 text-xs">
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
            className={`px-3 py-1.5 rounded-md cursor-pointer font-medium transition-colors border ${
              catalogTab === t.id
                ? 'bg-secondary border-border text-primary font-semibold shadow-xs'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-2.5 bg-background/50 border-b border-border flex flex-wrap gap-2 items-center text-xs">
        <div className="flex items-center gap-2 flex-1 min-w-48 h-8 bg-background/90 border border-input rounded-md px-2.5 focus-within:ring-2 focus-within:ring-ring">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            aria-label="检索装备库"
            placeholder="输入型号、名称、频段或关键词检索..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <Select
          aria-label="按作战域筛选装备"
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="w-auto min-w-[132px]"
        >
          <option value="ALL">全部作战域</option>
          <option value="air">空中域 (AIR)</option>
          <option value="surface">水面域 (SURFACE)</option>
          <option value="subsurface">水下域 (SUBSURFACE)</option>
          <option value="land">陆基域 (LAND)</option>
        </Select>
      </div>

      <div className="p-4 max-h-[62vh] overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {catalogTab === 'platforms' &&
          platforms.map((p) => (
            <div
              key={p.id}
              className="p-3 rounded-lg bg-muted/35 border border-border space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground truncate">{p.name}</span>
                <Badge variant="secondary" className="uppercase">{p.domain} · {p.origin}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {p.className} (ID: <code>{p.id}</code>)
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[10px] bg-background/60 border border-border/60 p-2 rounded-md font-mono tabular-nums">
                <div>最大航速: {p.maxSpeedKts}kt</div>
                <div>正面RCS: {p.rcsM2}m²</div>
                <div>结构HP: {p.maxHp}</div>
                <div>近防拦截: {Math.round(p.ciwsDefenseProb * 100)}%</div>
                <div>雷达高: {p.radarAntennaHeightM}m</div>
                <div>数据链: {p.hasDatalink ? 'CEC支持' : '无'}</div>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{p.description}</p>
            </div>
          ))}

        {catalogTab === 'loadouts' &&
          loadouts.map((l) => (
            <div
              key={l.id}
              className="p-3 rounded-lg bg-muted/35 border border-border space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-amber-300 truncate">{l.name}</span>
                <Badge variant="warning" className="uppercase">{l.role}</Badge>
              </div>
              <div className="text-[10px] text-primary">
                适配平台: {l.compatiblePlatformIds.join(', ')} · RCS惩罚: +
                {l.rcsPenaltyM2 || 0}m²
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{l.description}</p>
            </div>
          ))}

        {catalogTab === 'weapons' &&
          weapons.map((w) => (
            <div
              key={w.id}
              className="p-3 rounded-lg bg-muted/35 border border-border space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-rose-300 truncate">{w.name}</span>
                <Badge variant="destructive" className="uppercase">{w.category}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[10px] bg-background/60 border border-border/60 p-2 rounded-md font-mono tabular-nums">
                <div>最大射程: {w.maxRangeKm}km</div>
                <div>飞行速度: {(w.speedKts / 661).toFixed(1)}马赫</div>
                <div>巡航高度: {w.cruiseAltitudeM}m</div>
                <div>基准Pk: {Math.round(w.basePk * 100)}%</div>
                <div>战斗部伤害: {w.warheadDamage}</div>
                <div>反导能力: {w.canInterceptMissile ? '具备' : '无'}</div>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{w.description}</p>
            </div>
          ))}

        {catalogTab === 'sensors' &&
          sensors.map((s) => (
            <div
              key={s.id}
              className="p-3 rounded-lg bg-muted/35 border border-border space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-emerald-300 truncate">{s.name}</span>
                <Badge variant="success">{s.maxRangeKm} km</Badge>
              </div>
              <div className="text-[10px] text-primary">
                体制: {s.frequencyBand} ·{' '}
                {s.isActiveEmitter ? '主动辐射源 (受EMCON控制)' : '纯被动静默探测'}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{s.description}</p>
            </div>
          ))}
      </div>
    </ModalShell>
  );
};
