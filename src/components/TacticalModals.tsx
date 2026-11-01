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
import { summarizeAar } from '../engine/aar';
import { useWargameStore } from '../store/useWargameStore';
import {
  exportCurrentStateAsScenarioJson,
  validateAndParseScenarioJson,
} from '../scenarios/builtinScenarios';
import type { SideId } from '../types/wargame';
import { BATTLE_RECORDING_VERSION, captureBattleRecording, replayBattleRecording } from '../store/battleRecording';

function recordingUntilTick(jsonText: string): number | undefined {
  try {
    const value = JSON.parse(jsonText) as { version?: unknown; untilTick?: unknown };
    return value.version === BATTLE_RECORDING_VERSION && Number.isSafeInteger(value.untilTick) && (value.untilTick as number) >= 0
      ? value.untilTick as number : undefined;
  } catch {
    return undefined;
  }
}

export const TacticalModals: React.FC = () => {
  const activeModal = useWargameStore((s) => s.activeModal);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const currentScenario = useWargameStore((s) => s.currentScenario);
  const units = useWargameStore((s) => s.units);
  const groups = useWargameStore((s) => s.groups);
  const missions = useWargameStore((s) => s.missions);
  const events = useWargameStore((s) => s.events);
  const objectives = useWargameStore((s) => s.objectives);
  const referencePoints = useWargameStore((s) => s.referencePoints);
  const environment = useWargameStore((s) => s.environment);
  const catalog = useWargameStore((s) => s.catalog);
  const aar = useWargameStore((s) => s.aar);
  const battleResult = useWargameStore((s) => s.battleResult);
  const playMode = useWargameStore((s) => s.playMode);
  const loadScenario = useWargameStore((s) => s.loadScenario);
  const startSpawnUnitOnMap = useWargameStore((s) => s.startSpawnUnitOnMap);
  const selectUnit = useWargameStore((s) => s.selectUnit);
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);
  const updateScenarioGroup = useWargameStore((s) => s.updateScenarioGroup);
  const assignUnitGroup = useWargameStore((s) => s.assignUnitGroup);
  const upsertObjective = useWargameStore((s) => s.upsertObjective);
  const deleteObjective = useWargameStore((s) => s.deleteObjective);
  const createAreaEventFromReferencePoints = useWargameStore((s) => s.createAreaEventFromReferencePoints);
  const deleteScenarioEvent = useWargameStore((s) => s.deleteScenarioEvent);

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
  const [replayTick, setReplayTick] = useState(0);
  const [builderGroupId, setBuilderGroupId] = useState('');
  const [builderUnitId, setBuilderUnitId] = useState('');
  const [objectiveTitle, setObjectiveTitle] = useState('新建目标');
  const [objectiveSide, setObjectiveSide] = useState<'RED' | 'BLUE'>('RED');
  const [objectiveType, setObjectiveType] = useState<'destroy' | 'disable' | 'preserve' | 'observe' | 'withdraw'>('destroy');
  const [objectiveUnitId, setObjectiveUnitId] = useState('');
  const [areaEventName, setAreaEventName] = useState('区域进入警报');
  const [areaEventMessage, setAreaEventMessage] = useState('侦测到单位进入指定区域。');
  const [areaEventSide, setAreaEventSide] = useState<SideId>('RED');
  const [areaEventReferenceIds, setAreaEventReferenceIds] = useState<string[]>([]);

  if (activeModal === 'none') return null;

  // 打开 JSON 弹窗时默认填充当前导出的 JSON
  const displayedJson = jsonText || exportCurrentStateAsScenarioJson(currentScenario, units, {
    groups, missions, events, objectives, referencePoints, environment,
  });
  const replayUntilTick = recordingUntilTick(displayedJson);
  const aarSummary = summarizeAar(aar);
  const selectedBuilderGroup = groups.find((group) => group.id === builderGroupId) ?? groups[0];
  const selectedBuilderUnit = units[builderUnitId] ?? Object.values(units)[0];
  const selectedReplayTick = replayUntilTick === undefined ? 0 : Math.min(replayTick, replayUntilTick);

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
                        setSpawnCallsign(`${side}-${Object.keys(units).length + 100}`);
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

      {activeModal === 'builder' && (
        <div className="w-full max-w-5xl max-h-[92dvh] tactical-panel rounded-lg border border-emerald-400/50 overflow-y-auto">
          <div className="px-4 py-3 bg-emerald-950/40 border-b border-emerald-500/30 flex items-center justify-between">
            <div className="text-emerald-300 font-bold text-sm">SCENARIO BUILDER // 可视化想定编辑</div>
            <button onClick={() => setActiveModal('none')} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-4 grid md:grid-cols-2 gap-4 text-xs">
            <section className="p-3 rounded bg-slate-950/80 border border-slate-700 space-y-3">
              <h3 className="text-cyan-300 font-bold">单位与编组</h3>
              <select aria-label="Builder 单位" value={selectedBuilderUnit?.id ?? ''} onChange={(event) => setBuilderUnitId(event.target.value)}
                className="w-full bg-slate-900 rounded p-2">
                {Object.values(units).map((unit) => <option key={unit.id} value={unit.id}>{unit.callsign} · {unit.name}</option>)}
              </select>
              {selectedBuilderUnit && <>
                <select aria-label="Builder 编组" value={selectedBuilderUnit.parentGroupId}
                  onChange={(event) => assignUnitGroup(selectedBuilderUnit.id, event.target.value)} className="w-full bg-slate-900 rounded p-2">
                  {groups.filter((group) => group.side === selectedBuilderUnit.side).map((group) =>
                    <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                <button onClick={() => { selectUnit(selectedBuilderUnit.id); setInteractionMode('move_unit'); setActiveModal('none'); }}
                  className="toolbar-button bg-emerald-700 text-white">关闭面板并在地图移动单位</button>
              </>}
              <select aria-label="Builder 选择编组" value={selectedBuilderGroup?.id ?? ''} onChange={(event) => setBuilderGroupId(event.target.value)}
                className="w-full bg-slate-900 rounded p-2">
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              {selectedBuilderGroup && (
                <form key={selectedBuilderGroup.id} className="space-y-2" onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  updateScenarioGroup(selectedBuilderGroup.id, {
                    name: String(data.get('name') ?? ''), commandTitle: String(data.get('commandTitle') ?? ''),
                    description: String(data.get('description') ?? ''),
                  });
                }}>
                  <input name="name" aria-label="编组名称" defaultValue={selectedBuilderGroup.name} className="w-full bg-slate-900 rounded p-2" />
                  <input name="commandTitle" aria-label="编组指挥代号" defaultValue={selectedBuilderGroup.commandTitle} className="w-full bg-slate-900 rounded p-2" />
                  <textarea name="description" aria-label="编组说明" defaultValue={selectedBuilderGroup.description} className="w-full bg-slate-900 rounded p-2" />
                  <button className="toolbar-button" type="submit">保存编组</button>
                </form>
              )}
              <p className="text-slate-500">任务区继续使用左侧“由参考点创建任务”，两者共享同一可重放命令模型。</p>
            </section>

            <section className="p-3 rounded bg-slate-950/80 border border-slate-700 space-y-3">
              <h3 className="text-cyan-300 font-bold">胜负目标</h3>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {objectives.map((objective) => <div key={objective.id} className="flex justify-between gap-2 p-1 bg-slate-900 rounded">
                  <span>{objective.side} · {objective.title}</span>
                  <button aria-label={`删除目标 ${objective.title}`} onClick={() => deleteObjective(objective.id)} className="text-rose-300">删除</button>
                </div>)}
              </div>
              <input aria-label="目标标题" value={objectiveTitle} onChange={(event) => setObjectiveTitle(event.target.value)} className="w-full bg-slate-900 rounded p-2" />
              <div className="grid grid-cols-2 gap-2">
                <select aria-label="目标阵营" value={objectiveSide} onChange={(event) => setObjectiveSide(event.target.value as 'RED' | 'BLUE')} className="bg-slate-900 rounded p-2">
                  <option value="RED">RED</option><option value="BLUE">BLUE</option>
                </select>
                <select aria-label="目标类型" value={objectiveType} onChange={(event) => setObjectiveType(event.target.value as typeof objectiveType)} className="bg-slate-900 rounded p-2">
                  <option value="destroy">摧毁</option><option value="disable">失能</option><option value="preserve">保全</option><option value="observe">发现</option><option value="withdraw">撤出</option>
                </select>
              </div>
              <select aria-label="目标单位" value={objectiveUnitId} onChange={(event) => setObjectiveUnitId(event.target.value)} className="w-full bg-slate-900 rounded p-2">
                <option value="">选择目标单位</option>
                {Object.values(units).map((unit) => <option key={unit.id} value={unit.id}>{unit.side} · {unit.callsign}</option>)}
              </select>
              <button disabled={!objectiveUnitId || !objectiveTitle.trim()} onClick={() => upsertObjective({
                title: objectiveTitle, side: objectiveSide, type: objectiveType, unitIds: [objectiveUnitId],
                required: true, points: 100, preserveCapability: objectiveType === 'preserve',
              })} className="toolbar-button disabled:opacity-35">添加主要目标</button>
            </section>

            <section className="md:col-span-2 p-3 rounded bg-slate-950/80 border border-slate-700 space-y-3">
              <h3 className="text-cyan-300 font-bold">区域触发事件</h3>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <input aria-label="区域事件名称" value={areaEventName} onChange={(event) => setAreaEventName(event.target.value)} className="w-full bg-slate-900 rounded p-2" />
                  <textarea aria-label="区域事件消息" value={areaEventMessage} onChange={(event) => setAreaEventMessage(event.target.value)} className="w-full bg-slate-900 rounded p-2" />
                  <select aria-label="区域事件阵营" value={areaEventSide} onChange={(event) => { setAreaEventSide(event.target.value as SideId); setAreaEventReferenceIds([]); }} className="w-full bg-slate-900 rounded p-2">
                    <option value="RED">RED</option><option value="BLUE">BLUE</option>
                  </select>
                  <div className="grid grid-cols-2 gap-1">
                    {referencePoints.filter((point) => point.side === areaEventSide).map((point) => <label key={point.id} className="flex gap-1">
                      <input type="checkbox" aria-label={`事件参考点 ${point.name}`} checked={areaEventReferenceIds.includes(point.id)}
                        onChange={(event) => setAreaEventReferenceIds((current) => event.target.checked ? [...current, point.id] : current.filter((id) => id !== point.id))} />
                      {point.name}
                    </label>)}
                  </div>
                  <button disabled={areaEventReferenceIds.length < 3} onClick={() => createAreaEventFromReferencePoints({
                    name: areaEventName, side: areaEventSide, referencePointIds: areaEventReferenceIds, message: areaEventMessage,
                  })} className="toolbar-button disabled:opacity-35">创建区域事件</button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {events.map((event) => <div key={event.id} className="flex justify-between gap-2 p-2 bg-slate-900 rounded">
                    <span>{event.name} · {event.trigger.type}</span>
                    <button aria-label={`删除事件 ${event.name}`} onClick={() => deleteScenarioEvent(event.id)} className="text-rose-300">删除</button>
                  </div>)}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {activeModal === 'aar' && (
        <div className="w-full max-w-4xl max-h-[90dvh] tactical-panel rounded-lg border border-amber-400/50 overflow-y-auto">
          <div className="px-4 py-3 bg-amber-950/40 border-b border-amber-500/30 flex items-center justify-between">
            <div className="text-amber-300 font-bold text-sm">AFTER ACTION REVIEW // 战斗复盘</div>
            <button onClick={() => setActiveModal('none')} className="text-slate-400 hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          {!battleResult && playMode !== 'sandbox' ? (
            <div className="p-6 text-sm text-amber-200">完整真值 AAR 仅在战后或显式沙盒模式开放。</div>
          ) : (
            <div className="p-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                {(['RED', 'BLUE'] as const).map((side) => {
                  const stats = aarSummary[side];
                  return (
                    <section key={side} className="p-3 rounded bg-slate-950/80 border border-slate-700 space-y-2">
                      <h3 className={side === 'RED' ? 'text-rose-300 font-bold' : 'text-sky-300 font-bold'}>{side} FORCE</h3>
                      <div className="grid grid-cols-3 gap-2 text-slate-300">
                        <span>发射 {stats.launches}</span><span>命中 {stats.hits}</span><span>命中率 {(stats.hitRate * 100).toFixed(1)}%</span>
                        <span>拦截 {stats.interceptions}</span><span>损失 {stats.losses}</span><span>出动/回收 {stats.sorties}/{stats.recoveries}</span>
                      </div>
                    </section>
                  );
                })}
              </div>
              <section className="p-3 rounded bg-slate-950/80 border border-slate-700">
                <h3 className="text-cyan-300 font-bold mb-2">弹药消耗</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-slate-300">
                  {aarSummary.weaponUsage.length === 0 ? <span className="text-slate-500">尚无发射记录</span> :
                    aarSummary.weaponUsage.map(([weaponId, count]) => (
                      <span key={weaponId}>{catalog.weapons[weaponId]?.codeName ?? weaponId}: {count}</span>
                    ))}
                </div>
              </section>
              <section className="p-3 rounded bg-slate-950/80 border border-slate-700">
                <h3 className="text-cyan-300 font-bold mb-2">完整航迹账本</h3>
                <p className="text-slate-400 mb-2">{aarSummary.trackedUnits} 个单位 · {aarSummary.trackSamples} 个固定采样点（战斗中不向指挥视角揭示敌方真值）</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-slate-300">
                  {[...new Set(aar.tracks.map((sample) => sample.unitId))].map((unitId) => (
                    <span key={unitId}>{units[unitId]?.callsign ?? unitId}: {aar.tracks.filter((sample) => sample.unitId === unitId).length} 点</span>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          4. 想定 JSON 导入导出与自定义扩展编辑器 (Scenario JSON I/O)
         ==================================================================== */}
      {activeModal === 'scenario_io' && (
        <div className="w-full max-w-3xl max-h-[90dvh] tactical-panel rounded-lg border border-cyan-400/50 overflow-y-auto">
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
              aria-label="想定或重放 JSON"
              value={displayedJson}
              onChange={(e) => {
                setJsonText(e.target.value);
                const untilTick = recordingUntilTick(e.target.value);
                if (untilTick !== undefined) setReplayTick(untilTick);
                setJsonError(null);
              }}
              rows={16}
              className="w-full bg-slate-950 border border-slate-800 rounded p-3 font-mono text-[11px] text-cyan-200 focus:outline-none focus:border-cyan-400"
            />

            <div className="flex flex-wrap gap-2 items-center">
              <button className="toolbar-button" onClick={() => {
                const recording = captureBattleRecording();
                setJsonText(JSON.stringify(recording, null, 2));
                setReplayTick(recording.untilTick);
                setJsonError(null);
              }}>生成指令重放 JSON</button>
              <button className="toolbar-button" onClick={() => {
                try { replayBattleRecording(JSON.parse(displayedJson), 60); setActiveModal('none'); }
                catch (error) { setJsonError(error instanceof Error ? error.message : '重放失败'); }
              }}>加载重放到记录末尾</button>
              <span className="text-slate-400">仅支持 Recording v{BATTLE_RECORDING_VERSION}；规则、装备与场景 Schema 必须一致，旧 v1 会明确拒绝。失败时恢复原战场。</span>
            </div>

            {replayUntilTick !== undefined && (
              <div className="p-2.5 rounded bg-slate-950 border border-cyan-500/30 space-y-2">
                <div className="flex items-center justify-between text-cyan-300">
                  <span>REPLAY TIMELINE</span>
                  <span>Tick {selectedReplayTick} / {replayUntilTick}</span>
                </div>
                <input
                  aria-label="回放时间轴"
                  type="range"
                  min={0}
                  max={replayUntilTick}
                  value={selectedReplayTick}
                  onChange={(event) => setReplayTick(Number(event.target.value))}
                  className="w-full accent-cyan-400"
                />
                <button className="toolbar-button" onClick={() => {
                  try { replayBattleRecording(JSON.parse(displayedJson), 60, selectedReplayTick); setActiveModal('none'); }
                  catch (error) { setJsonError(error instanceof Error ? error.message : '重放失败'); }
                }}>
                  跳转至 Tick {selectedReplayTick}
                </button>
                <p className="text-slate-500">拖动只改变预览 Tick；点击跳转后从开局确定性重放，不追加用户命令。</p>
              </div>
            )}

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
                    <span>复制 JSON</span>
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
