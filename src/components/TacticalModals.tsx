import React, { useState } from 'react';
import {
  X,
  Database,
  FileJson,
  PlusCircle,
  BookOpen,
  Check,
  AlertCircle,
  Download,
  Upload,
} from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import {
  exportCurrentStateAsScenarioJson,
  validateAndParseScenarioJson,
} from '../scenarios/builtinScenarios';
import type { SideId } from '../types/wargame';

export const TacticalModals: React.FC = () => {
  const activeModal = useWargameStore((s) => s.activeModal);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const currentScenario = useWargameStore((s) => s.currentScenario);
  const units = useWargameStore((s) => s.units);
  const catalog = useWargameStore((s) => s.catalog);
  const loadScenario = useWargameStore((s) => s.loadScenario);
  const startSpawnUnitOnMap = useWargameStore((s) => s.startSpawnUnitOnMap);

  // 状态：装备库检视器
  const [catalogTab, setCatalogTab] = useState<
    'platforms' | 'loadouts' | 'weapons' | 'sensors'
  >('platforms');

  // 状态：实时算子投放器
  const [spawnSide, setSpawnSide] = useState<SideId>('RED');
  const [spawnPlatformId, setSpawnPlatformId] = useState<string>('j20_mighty_dragon');
  const [spawnName, setSpawnName] = useState<string>('歼-20A 增援中队');
  const [spawnCallsign, setSpawnCallsign] = useState<string>('DRAGON-09');

  // 状态：想定 JSON 导入导出
  const [jsonText, setJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  if (activeModal === 'none') return null;

  // 打开 JSON 弹窗时默认填充当前导出的 JSON
  const displayedJson =
    jsonText || exportCurrentStateAsScenarioJson(currentScenario, units);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 font-mono">
      {/* ====================================================================
          1. 战役简报与战术指南弹窗 (Scenario Briefing)
         ==================================================================== */}
      {activeModal === 'briefing' && (
        <div className="w-full max-w-2xl tactical-panel rounded-lg border border-cyan-400/50 overflow-hidden shadow-[0_0_50px_rgba(34,211,238,0.25)]">
          <div className="px-4 py-3 bg-cyan-950/50 border-b border-cyan-500/30 flex items-center justify-between">
            <div className="flex items-center gap-2 text-cyan-300 font-bold text-sm">
              <BookOpen className="w-4 h-4" />
              <span>OPERATIONAL BRIEFING // 战役想定简报</span>
            </div>
            <button
              onClick={() => setActiveModal('none')}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4 text-xs leading-relaxed max-h-[75vh] overflow-y-auto">
            <div>
              <div className="text-base font-bold text-cyan-300">
                {currentScenario.title}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {currentScenario.subtitle} · 战区: {currentScenario.theater}
              </div>
            </div>

            <div className="p-3 rounded bg-slate-950/90 border border-slate-800 space-y-1">
              <div className="text-amber-300 font-bold">【战场态势背景】</div>
              <p className="text-slate-300">
                {currentScenario.briefing.situation}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded bg-rose-950/25 border border-rose-500/35">
                <div className="text-rose-300 font-bold mb-1">
                  【红方联指作战企图】
                </div>
                <p className="text-slate-300">
                  {currentScenario.briefing.redObjective}
                </p>
              </div>
              <div className="p-3 rounded bg-sky-950/25 border border-sky-500/35">
                <div className="text-sky-300 font-bold mb-1">
                  【蓝方联指作战企图】
                </div>
                <p className="text-slate-300">
                  {currentScenario.briefing.blueObjective}
                </p>
              </div>
            </div>

            <div className="p-3 rounded bg-cyan-950/25 border border-cyan-500/30 space-y-1.5">
              <div className="text-cyan-300 font-bold">
                【CMO 核心机制与参谋操作要领】
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                {currentScenario.briefing.tacticalTips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="px-4 py-3 bg-slate-950/90 border-t border-slate-800 flex justify-end">
            <button
              onClick={() => setActiveModal('none')}
              className="px-4 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
            >
              进入指挥席位
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          2. 装备参数数据库检视器 (Equipment Catalog Viewer)
         ==================================================================== */}
      {activeModal === 'catalog_viewer' && (
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
      )}

      {/* ====================================================================
          3. 实时战场兵力投放器 (Dynamic Unit Spawner)
         ==================================================================== */}
      {activeModal === 'unit_spawner' && (
        <div className="w-full max-w-lg tactical-panel rounded-lg border border-emerald-400/50 overflow-hidden">
          <div className="px-4 py-3 bg-emerald-950/50 border-b border-emerald-500/30 flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
              <PlusCircle className="w-4 h-4" />
              <span>DYNAMIC FORCE SPAWNER // 战场实时增援算子投放</span>
            </div>
            <button
              onClick={() => setActiveModal('none')}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">所属阵营 (Side):</label>
              <div className="grid grid-cols-2 gap-2">
                {(['RED', 'BLUE'] as SideId[]).map((side) => (
                  <button
                    key={side}
                    onClick={() => {
                      setSpawnSide(side);
                      const firstMatch = Object.values(catalog.platforms).find(
                        (p) => p.origin === side
                      );
                      if (firstMatch) {
                        setSpawnPlatformId(firstMatch.id);
                        setSpawnName(firstMatch.name);
                        setSpawnCallsign(
                          `${side}-${Math.floor(Math.random() * 899 + 100)}`
                        );
                      }
                    }}
                    className={`py-2 rounded font-bold border cursor-pointer ${
                      spawnSide === side
                        ? side === 'RED'
                          ? 'bg-rose-600 text-white border-rose-400'
                          : 'bg-sky-600 text-white border-sky-400'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    {side === 'RED' ? '红方联指 (RED FORCE)' : '蓝方联指 (BLUE FORCE)'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">
                选择装备平台模板 (Platform Template):
              </label>
              <select
                value={spawnPlatformId}
                onChange={(e) => {
                  const pid = e.target.value;
                  setSpawnPlatformId(pid);
                  const sp = catalog.platforms[pid];
                  if (sp) setSpawnName(sp.name);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-slate-100"
              >
                {Object.values(catalog.platforms).map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.domain.toUpperCase()}] {p.name} ({p.className})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">部队番/舷号名称:</label>
                <input
                  type="text"
                  value={spawnName}
                  onChange={(e) => setSpawnName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">战术呼号 (Callsign):</label>
                <input
                  type="text"
                  value={spawnCallsign}
                  onChange={(e) => setSpawnCallsign(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setActiveModal('none')}
                className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={() =>
                  startSpawnUnitOnMap({
                    platformId: spawnPlatformId,
                    side: spawnSide,
                    name: spawnName,
                    callsign: spawnCallsign,
                  })
                }
                className="px-4 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold cursor-pointer"
              >
                点击海图坐标投放算子
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          4. 想定 JSON 导入导出与自定义扩展编辑器 (Scenario JSON I/O)
         ==================================================================== */}
      {activeModal === 'scenario_io' && (
        <div className="w-full max-w-3xl tactical-panel rounded-lg border border-cyan-400/50 overflow-hidden">
          <div className="px-4 py-3 bg-cyan-950/50 border-b border-cyan-500/30 flex items-center justify-between">
            <div className="flex items-center gap-2 text-cyan-300 font-bold text-sm">
              <FileJson className="w-4 h-4" />
              <span>
                SCENARIO SCHEMA SERIALIZER // 想定 JSON 导出、编辑与热加载
              </span>
            </div>
            <button
              onClick={() => setActiveModal('none')}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-3 text-xs">
            <p className="text-slate-400">
              当前战场实时态势已序列化为标准 <code>ScenarioDefinition</code> JSON。你可以直接修改算子坐标、添加自定义{' '}
              <code>customCatalogOverlay</code> 武器参数，或保存为外部剧本文件。
            </p>

            <textarea
              value={displayedJson}
              onChange={(e) => {
                setJsonText(e.target.value);
                setJsonError(null);
              }}
              rows={16}
              className="w-full bg-slate-950 border border-slate-800 rounded p-3 font-mono text-[11px] text-cyan-200 focus:outline-none focus:border-cyan-400"
            />

            {jsonError && (
              <div className="p-2.5 rounded bg-rose-950/60 border border-rose-500 text-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{jsonError}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(displayedJson);
                  setCopySuccess(true);
                  setTimeout(() => setCopySuccess(false), 2000);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-cyan-500/30 text-cyan-300 cursor-pointer"
              >
                {copySuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>已复制到剪贴板</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>复制想定 JSON</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveModal('none')}
                  className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 cursor-pointer"
                >
                  关闭
                </button>
                <button
                  onClick={() => {
                    const res = validateAndParseScenarioJson(displayedJson);
                    if (!res.valid || !res.scenario) {
                      setJsonError(res.error || '想定格式校验失败');
                      return;
                    }
                    try {
                      loadScenario(res.scenario);
                      setActiveModal('none');
                    } catch (error) {
                      setJsonError(error instanceof Error ? error.message : 'Invalid scenario');
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>校验并热加载此想定</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
