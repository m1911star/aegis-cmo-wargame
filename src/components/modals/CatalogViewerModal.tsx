import React, { useMemo, useRef, useState } from 'react';
import { Database, RotateCcw, Search, Upload } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ModalHeader, ModalShell } from '../ui/dialog';
import { Select } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { FORCE_PACKAGES } from '../../db';
import { m2ToDbsm } from '../../engine/cmoUnits';

type CatalogTab =
  | 'platforms'
  | 'loadouts'
  | 'weapons'
  | 'sensors'
  | 'forcePackages'
  | 'mounts'
  | 'warheads'
  | 'propulsions'
  | 'comms';

export const CatalogViewerModal: React.FC = () => {
  const catalog = useWargameStore((s) => s.catalog);
  const customOverlay = useWargameStore((s) => s.currentScenario.customCatalogOverlay);
  const importCatalogJson = useWargameStore((s) => s.importCatalogJson);
  const resetCatalogToDefault = useWargameStore((s) => s.resetCatalogToDefault);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('platforms');
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('ALL');
  const [showHotloadPanel, setShowHotloadPanel] = useState(false);
  const [hotloadJsonText, setHotloadJsonText] = useState('');
  const [hotloadMessage, setHotloadMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFileModeRef = useRef<'merge' | 'replace'>('merge');
  const normalizedQuery = query.trim().toLowerCase();

  const handleCatalogFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = importCatalogJson(text, pendingFileModeRef.current);
      setHotloadMessage({
        ok: res.ok,
        text: res.ok
          ? `${pendingFileModeRef.current === 'merge' ? '合并导入成功' : '覆盖导入成功'}：${res.importedSummary}`
          : `导入失败：${res.error}`,
      });
    } catch {
      setHotloadMessage({ ok: false, text: '读取本地 JSON 文件失败' });
    }
  };

  const matchesText = (text: string) => !normalizedQuery || text.toLowerCase().includes(normalizedQuery);
  const platforms = useMemo(
    () => Object.values(catalog.platforms).filter((p) =>
      (domainFilter === 'ALL' || p.domain === domainFilter) &&
      matchesText(`${p.id} ${p.dbid ?? ''} ${p.name} ${p.className} ${p.origin} ${p.operatorCountry ?? ''} ${p.description}`)
    ),
    [catalog.platforms, domainFilter, normalizedQuery]
  );
  const loadouts = useMemo(
    () => Object.values(catalog.loadouts).filter((l) =>
      matchesText(`${l.id} ${l.dbid ?? ''} ${l.name} ${l.codeName} ${l.role} ${l.description}`)
    ),
    [catalog.loadouts, normalizedQuery]
  );
  const weapons = useMemo(
    () => Object.values(catalog.weapons).filter((w) =>
      (domainFilter === 'ALL' || w.targetDomains.includes(domainFilter as never)) &&
      matchesText(`${w.id} ${w.dbid ?? ''} ${w.name} ${w.codeName} ${w.category} ${w.warheadId ?? ''} ${w.description}`)
    ),
    [catalog.weapons, domainFilter, normalizedQuery]
  );
  const sensors = useMemo(
    () => Object.values(catalog.sensors).filter((s) =>
      (domainFilter === 'ALL' || s.detectDomains.includes(domainFilter as never)) &&
      matchesText(`${s.id} ${s.dbid ?? ''} ${s.name} ${s.codeName} ${s.frequencyBand} ${s.role ?? ''} ${s.generation ?? ''} ${s.description}`)
    ),
    [catalog.sensors, domainFilter, normalizedQuery]
  );
  const forcePackages = useMemo(
    () => Object.values(FORCE_PACKAGES).filter((forcePackage) =>
      (domainFilter === 'ALL' || forcePackage.domain === domainFilter) &&
      matchesText(`${forcePackage.id} ${forcePackage.name} ${forcePackage.origin} ${forcePackage.role} ${forcePackage.description} ${
        forcePackage.members.map((member) => `${member.platformId} ${catalog.platforms[member.platformId]?.name ?? ''}`).join(' ')
      }`)
    ),
    [catalog.platforms, domainFilter, normalizedQuery]
  );
  const mounts = useMemo(
    () => Object.values(catalog.mounts ?? {}).filter((m) =>
      matchesText(`${m.id} ${m.dbid ?? ''} ${m.name} ${m.weaponIds.join(' ')} ${m.sensorIds?.join(' ') ?? ''} ${m.description ?? ''}`)
    ),
    [catalog.mounts, normalizedQuery]
  );
  const warheads = useMemo(
    () => Object.values(catalog.warheads ?? {}).filter((wh) =>
      matchesText(`${wh.id} ${wh.dbid ?? ''} ${wh.name} ${wh.type} ${wh.explosivesType ?? ''} ${wh.description ?? ''}`)
    ),
    [catalog.warheads, normalizedQuery]
  );
  const propulsions = useMemo(
    () => Object.values(catalog.propulsions ?? {}).filter((pr) =>
      matchesText(`${pr.id} ${pr.dbid ?? ''} ${pr.name} ${pr.type} ${pr.combinedType ?? ''} ${pr.description ?? ''}`)
    ),
    [catalog.propulsions, normalizedQuery]
  );
  const comms = useMemo(
    () => Object.values(catalog.comms ?? {}).filter((c) =>
      matchesText(`${c.id} ${c.dbid ?? ''} ${c.name} ${c.type} ${c.description ?? ''}`)
    ),
    [catalog.comms, normalizedQuery]
  );

  const activeItemCount =
    catalogTab === 'platforms' ? platforms.length
    : catalogTab === 'loadouts' ? loadouts.length
    : catalogTab === 'weapons' ? weapons.length
    : catalogTab === 'sensors' ? sensors.length
    : catalogTab === 'forcePackages' ? forcePackages.length
    : catalogTab === 'mounts' ? mounts.length
    : catalogTab === 'warheads' ? warheads.length
    : catalogTab === 'propulsions' ? propulsions.length
    : comms.length;

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
            {
              id: 'forcePackages',
              label: `军队配置 (${Object.keys(FORCE_PACKAGES).length})`,
            },
            {
              id: 'mounts',
              label: `发射架 (${Object.keys(catalog.mounts ?? {}).length})`,
            },
            {
              id: 'warheads',
              label: `战斗部 (${Object.keys(catalog.warheads ?? {}).length})`,
            },
            {
              id: 'propulsions',
              label: `推进系统 (${Object.keys(catalog.propulsions ?? {}).length})`,
            },
            {
              id: 'comms',
              label: `通信/数据链 (${Object.keys(catalog.comms ?? {}).length})`,
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
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          aria-label="上传 CMO Catalog JSON"
          onChange={handleCatalogFileUpload}
          className="hidden"
        />
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            pendingFileModeRef.current = 'merge';
            fileInputRef.current?.click();
          }}
          className="text-emerald-300 border-emerald-500/35 hover:bg-emerald-500/15"
          title="读取 importCmoDb.ts 导出的 JSON 并合并进当前装备库"
        >
          <Upload className="w-3 h-3" />
          <span>合并导入 JSON</span>
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => setShowHotloadPanel((prev) => !prev)}
          className="text-cyan-300 border-cyan-500/35 hover:bg-cyan-500/15"
        >
          <span>{showHotloadPanel ? '收起热加载' : 'JSON 热加载管理'}</span>
        </Button>
        {customOverlay && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              const res = resetCatalogToDefault();
              setHotloadMessage({
                ok: res.ok,
                text: res.ok ? '已恢复内置装备目录' : `重置失败：${res.error}`,
              });
            }}
            className="text-amber-300 border-amber-500/35 hover:bg-amber-500/15"
            title="清除自定义装备目录热加载覆盖层"
          >
            <RotateCcw className="w-3 h-3" />
            <span>重置目录</span>
          </Button>
        )}
      </div>

      {hotloadMessage && (
        <div role="status" className={`px-4 py-2 text-[11px] font-medium ${hotloadMessage.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
          {hotloadMessage.text}
        </div>
      )}
      {showHotloadPanel && (
        <div className="px-4 py-3 bg-emerald-950/20 border-b border-emerald-500/25 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-emerald-300">
              CMO JSON 目录热加载（兼容 <code>scripts/importCmoDb.ts</code> 输出格式）
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  pendingFileModeRef.current = 'replace';
                  fileInputRef.current?.click();
                }}
              >
                上传并替换覆盖层
              </Button>
              <Button
                size="xs"
                variant="success"
                disabled={!hotloadJsonText.trim()}
                onClick={() => {
                  const res = importCatalogJson(hotloadJsonText, 'merge');
                  setHotloadMessage({
                    ok: res.ok,
                    text: res.ok ? `合并热加载成功：${res.importedSummary}` : `导入失败：${res.error}`,
                  });
                }}
              >
                粘贴合并热加载
              </Button>
              <Button
                size="xs"
                variant="secondary"
                disabled={!hotloadJsonText.trim()}
                onClick={() => {
                  const res = importCatalogJson(hotloadJsonText, 'replace');
                  setHotloadMessage({
                    ok: res.ok,
                    text: res.ok ? `覆盖热加载成功：${res.importedSummary}` : `导入失败：${res.error}`,
                  });
                }}
              >
                粘贴替换覆盖层
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">仅可在未推进、未下达指令的暂停开局导入或重置目录；修改后会按同一种子重建开局。</p>
          <Textarea
            aria-label="粘贴 CMO Catalog JSON"
            rows={3}
            placeholder='粘贴包含 "platforms" / "weapons" / "sensors" / "mounts" / "magazines" / "propulsions" 的 JSON...'
            value={hotloadJsonText}
            onChange={(e) => setHotloadJsonText(e.target.value)}
            className="font-mono text-[11px]"
          />
        </div>
      )}

      <div className="p-4 max-h-[62vh] overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {catalogTab === 'platforms' &&
          platforms.map((p) => {
            const radarSig = p.signatures?.find((sig) => sig.type === 'radar_em' || sig.type === 'radar_ad');
            const dbsmFront = radarSig ? radarSig.front : m2ToDbsm(p.rcsM2);
            const countryLabel = [p.operatorCountry, p.yearCommissioned].filter(Boolean).join(' · ');

            return (
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
                <div className="flex flex-wrap gap-1">
                  {p.dbid !== undefined && (
                    <Badge variant="outline" className="font-mono">DBID {p.dbid}</Badge>
                  )}
                  {countryLabel && (
                    <Badge variant="outline">{countryLabel}</Badge>
                  )}
                  {p.ooda && (
                    <Badge variant="default" className="font-mono">
                      OODA {p.ooda.detectionSec}/{p.ooda.targetingSec}/{p.ooda.evasionSec}s
                    </Badge>
                  )}
                  <Badge variant="secondary" className="font-mono">
                    {dbsmFront.toFixed(1)} dBsm
                  </Badge>
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
            );
          })}

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
              {(w.dbid !== undefined || w.warheadId || w.cepM !== undefined) && (
                <div className="flex flex-wrap gap-1">
                  {w.dbid !== undefined && (
                    <Badge variant="outline" className="font-mono">DBID {w.dbid}</Badge>
                  )}
                  {w.warheadId && (
                    <Badge variant="secondary" className="font-mono">WH: {w.warheadId}</Badge>
                  )}
                  {w.cepM !== undefined && (
                    <Badge variant="warning" className="font-mono">CEP {w.cepM}m</Badge>
                  )}
                </div>
              )}
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
              {(s.dbid !== undefined || s.role || s.generation) && (
                <div className="flex flex-wrap gap-1">
                  {s.dbid !== undefined && (
                    <Badge variant="outline" className="font-mono">DBID {s.dbid}</Badge>
                  )}
                  {s.role && (
                    <Badge variant="secondary">{s.role}</Badge>
                  )}
                  {s.generation && (
                    <Badge variant="outline">{s.generation}</Badge>
                  )}
                </div>
              )}
              <div className="text-[10px] text-primary">
                体制: {s.frequencyBand} ·{' '}
                {s.isActiveEmitter ? '主动辐射源 (受EMCON控制)' : '纯被动静默探测'}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{s.description}</p>
            </div>
          ))}

        {catalogTab === 'forcePackages' &&
          forcePackages.map((forcePackage) => (
            <div
              key={forcePackage.id}
              className="p-3 rounded-lg bg-muted/35 border border-border space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sky-300 truncate">{forcePackage.name}</span>
                <Badge variant="secondary">{forcePackage.origin} · {forcePackage.role}</Badge>
              </div>
              <div className="text-[10px] text-primary">
                ID: <code>{forcePackage.id}</code> · {forcePackage.domain} · {forcePackage.members.length} 类单位
              </div>
              <ul className="space-y-1 text-[11px] text-muted-foreground">
                {forcePackage.members.map((member, index) => (
                  <li key={`${member.platformId}-${index}`}>
                    {member.quantity} × {catalog.platforms[member.platformId]?.name ?? member.platformId}
                    {member.loadoutId && ` · ${catalog.loadouts[member.loadoutId]?.name ?? member.loadoutId}`}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{forcePackage.description}</p>
            </div>
          ))}

        {catalogTab === 'mounts' &&
          mounts.map((m) => (
            <div
              key={m.id}
              className="p-3 rounded-lg bg-muted/35 border border-border space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-cyan-300 truncate">{m.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {m.dbid !== undefined && (
                    <Badge variant="outline" className="font-mono">DBID {m.dbid}</Badge>
                  )}
                  <Badge variant={m.autonomous ? 'success' : 'secondary'}>
                    {m.autonomous ? '自主' : m.trainable ? '可回转' : '固定'}
                  </Badge>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                ID: <code>{m.id}</code>{m.localControl ? ' · 本地火控' : ''}
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[10px] bg-background/60 border border-border/60 p-2 rounded-md font-mono tabular-nums">
                <div>射速: {m.rofPerMin}/min</div>
                <div>备弹容量: {m.capacity}</div>
                <div>弹库容量: {m.magazineCapacity}</div>
                <div>弹库射速: {m.magazineRofPerMin}/min</div>
                <div>结构HP: {m.damagePoints}</div>
                <div>装甲: {m.armorGeneral ?? 0}</div>
              </div>
              {m.weaponIds.length > 0 && (
                <div className="text-[10px] text-primary">
                  配属武器 ({m.weaponIds.length}): {m.weaponIds.map((id) => catalog.weapons[id]?.name ?? id).join(', ')}
                </div>
              )}
              {m.sensorIds && m.sensorIds.length > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  配属传感器: {m.sensorIds.map((id) => catalog.sensors[id]?.name ?? id).join(', ')}
                </div>
              )}
              {m.description && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">{m.description}</p>
              )}
            </div>
          ))}

        {catalogTab === 'warheads' &&
          warheads.map((wh) => (
            <div
              key={wh.id}
              className="p-3 rounded-lg bg-muted/35 border border-border space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-orange-300 truncate">{wh.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {wh.dbid !== undefined && (
                    <Badge variant="outline" className="font-mono">DBID {wh.dbid}</Badge>
                  )}
                  <Badge variant="destructive" className="uppercase">{wh.type}</Badge>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                ID: <code>{wh.id}</code>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[10px] bg-background/60 border border-border/60 p-2 rounded-md font-mono tabular-nums">
                <div>毁伤值: {wh.damagePoints}</div>
                <div>装药类型: {wh.explosivesType ?? '—'}</div>
                <div>装药量: {wh.explosivesWeightKg !== undefined ? `${wh.explosivesWeightKg}kg` : '—'}</div>
                <div>子弹头数: {wh.numberOfWarheads ?? 1}</div>
              </div>
              {wh.description && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">{wh.description}</p>
              )}
            </div>
          ))}

        {catalogTab === 'propulsions' &&
          propulsions.map((pr) => {
            const maxSpeedKts = pr.speedProfile.length > 0
              ? Math.max(...pr.speedProfile.map((pt) => pt.speedKts))
              : undefined;

            return (
              <div
                key={pr.id}
                className="p-3 rounded-lg bg-muted/35 border border-border space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-indigo-300 truncate">{pr.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {pr.dbid !== undefined && (
                      <Badge variant="outline" className="font-mono">DBID {pr.dbid}</Badge>
                    )}
                    <Badge variant="secondary" className="uppercase">{pr.type}</Badge>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  ID: <code>{pr.id}</code>{pr.combinedType ? ` · ${pr.combinedType}` : ''}
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[10px] bg-background/60 border border-border/60 p-2 rounded-md font-mono tabular-nums">
                  <div>发动机数: {pr.numberOfEngines ?? '—'}</div>
                  <div>推进轴数: {pr.numberOfShafts ?? '—'}</div>
                  <div>速度包线点: {pr.speedProfile.length}</div>
                  <div>极速采样: {maxSpeedKts !== undefined ? `${maxSpeedKts}kt` : '—'}</div>
                  <div>军用推力: {pr.thrustMilitaryKn !== undefined ? `${pr.thrustMilitaryKn}kN` : '—'}</div>
                  <div>加力推力: {pr.thrustAfterburnerKn !== undefined ? `${pr.thrustAfterburnerKn}kN` : '—'}</div>
                </div>
                {pr.description && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{pr.description}</p>
                )}
              </div>
            );
          })}

        {catalogTab === 'comms' &&
          comms.map((c) => (
            <div
              key={c.id}
              className="p-3 rounded-lg bg-muted/35 border border-border space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-teal-300 truncate">{c.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {c.dbid !== undefined && (
                    <Badge variant="outline" className="font-mono">DBID {c.dbid}</Badge>
                  )}
                  <Badge variant="secondary" className="uppercase">{c.type}</Badge>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                ID: <code>{c.id}</code>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] bg-background/60 border border-border/60 p-2 rounded-md font-mono tabular-nums">
                <div>数据链: {c.supportsDatalink ? '支持' : '无'}</div>
                <div>CEC协同: {c.supportsCec ? '支持' : '无'}</div>
                <div>通信距离: {c.rangeKm !== undefined ? `${c.rangeKm}km` : '—'}</div>
                <div>最大通道: {c.maxChannels ?? '—'}</div>
              </div>
              {c.description && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">{c.description}</p>
              )}
            </div>
          ))}

        {activeItemCount === 0 && (
          <div className="col-span-full py-8 text-center text-muted-foreground">
            未找到符合条件的装备条目
          </div>
        )}
      </div>
    </ModalShell>
  );
};
