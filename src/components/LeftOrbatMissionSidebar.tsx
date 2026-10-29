import { BattleObjectivesPanel } from './BattleObjectivesPanel';
import { BASEMAP_PRESETS, type BasemapMode } from '../map/basemaps';
import React, { useState } from 'react';
import {
  Radar,
  Crosshair,
  Compass,
  Layers,
  MapPin,
  ChevronDown,
  ChevronRight,
  Plane,
  Ship,
  Anchor,
  Shield,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { useWargameStore, type MapLayerVisibility } from '../store/useWargameStore';
import { classificationLabels, perspectiveLabels } from '../ui/labels';
import type { Domain } from '../types/wargame';

function DomainIcon({ domain }: { domain: Domain }) {
  switch (domain) {
    case 'air':
      return <Plane className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
    case 'surface':
      return <Ship className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    case 'subsurface':
      return <Anchor className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'land':
      return <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  }
}

export const LeftOrbatMissionSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'orbat' | 'contacts' | 'missions' | 'layers'
  >('orbat');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const currentScenario = useWargameStore((s) => s.currentScenario);
  const units = useWargameStore((s) => s.units);
  const contacts = useWargameStore((s) => s.contacts);
  const missions = useWargameStore((s) => s.missions);
  const referencePoints = useWargameStore((s) => s.referencePoints);
  const activePerspective = useWargameStore((s) => s.activePerspective);

  const selectedUnitId = useWargameStore((s) => s.selectedUnitId);
  const selectedContactId = useWargameStore((s) => s.selectedContactId);
  const selectUnit = useWargameStore((s) => s.selectUnit);
  const selectContact = useWargameStore((s) => s.selectContact);
  const flyToPosition = useWargameStore((s) => s.flyToPosition);

  const toggleMissionActive = useWargameStore((s) => s.toggleMissionActive);
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);
  const removeReferencePoint = useWargameStore((s) => s.removeReferencePoint);

  const mapLayers = useWargameStore((s) => s.mapLayers);
  const toggleMapLayer = useWargameStore((s) => s.toggleMapLayer);
  const basemapMode = useWargameStore((s) => s.basemapMode);
  const setBasemapMode = useWargameStore((s) => s.setBasemapMode);

  const visibleGroups = currentScenario.groups.filter(
    (g) => activePerspective === 'GOD' || g.side === activePerspective
  );

  const visibleContacts = Object.values(contacts).filter(
    (c) =>
      activePerspective === 'GOD' || c.observerSide === activePerspective
  );

  const visibleMissions = missions.filter(
    (m) => activePerspective === 'GOD' || m.side === activePerspective
  );

  const layerItems: { key: keyof MapLayerVisibility; label: string; desc: string }[] = [
    { key: 'showRadarRings', label: '主动雷达搜索视距圈', desc: '显示全军开机雷达探测包线' },
    { key: 'showWeaponRings', label: '防空/反舰导弹射程圈', desc: '显示主战武器最大动力射程' },
    { key: 'showSonarRings', label: '水下声呐监听包线', desc: '显示拖曳线列阵与主动声呐圈' },
    { key: 'showWaypoints', label: '机动航路点与航向矢量', desc: '显示F3规划航线及90s预测线' },
    { key: 'showAouPolygons', label: '情报误差范围', desc: '显示ESM/声呐测向误差范围' },
    { key: 'showMissions', label: '自动巡逻任务区多边形', desc: '显示防空、反舰与反潜巡逻区' },
    { key: 'showReferencePoints', label: '战术参考点', desc: '显示海图基准坐标点' },
  ];

  return (
    <aside className="z-20 w-full h-full tactical-panel border-r border-cyan-500/25 flex flex-col overflow-hidden">
      {/* 顶部 Tab 切换栏 */}
      <div className="grid grid-cols-4 border-b border-cyan-500/25 bg-slate-950/70 text-[11px] ">
        <button
          onClick={() => setActiveTab('orbat')}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer transition border-b-2 ${
            activeTab === 'orbat'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30 font-bold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Radar className="w-3.5 h-3.5" />
          <span>编制序列</span>
        </button>
        <button
          onClick={() => setActiveTab('contacts')}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer transition border-b-2 ${
            activeTab === 'contacts'
              ? 'border-amber-400 text-amber-300 bg-amber-950/30 font-bold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>情报({visibleContacts.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('missions')}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer transition border-b-2 ${
            activeTab === 'missions'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/30 font-bold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>巡逻任务</span>
        </button>
        <button
          onClick={() => setActiveTab('layers')}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer transition border-b-2 ${
            activeTab === 'layers'
              ? 'border-sky-400 text-sky-300 bg-sky-950/30 font-bold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>包线图层</span>
        </button>
      </div>

      {/* 内容滚动区 */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        <BattleObjectivesPanel />
        {/* TAB 1: ORBAT 战斗序列树 */}
        {activeTab === 'orbat' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1 text-[10px]  text-slate-400">
              <span>点击单元定位到地图</span>
              <span className="text-cyan-400">
                {perspectiveLabels[activePerspective]}视角
              </span>
            </div>

            {visibleGroups.map((group) => {
              const groupUnits = Object.values(units).filter(
                (u) => u.parentGroupId === group.id
              );
              const isCollapsed = collapsedGroups[group.id] ?? false;
              const isRed = group.side === 'RED';

              return (
                <div
                  key={group.id}
                  className="rounded border border-slate-800/90 bg-slate-950/65 overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setCollapsedGroups((prev) => ({
                        ...prev,
                        [group.id]: !isCollapsed,
                      }))
                    }
                    className={`w-full px-2.5 py-2 flex items-center justify-between text-left cursor-pointer ${
                      isRed
                        ? 'bg-rose-950/35 border-b border-rose-500/20 text-rose-200'
                        : 'bg-sky-950/35 border-b border-sky-500/20 text-sky-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span className="text-xs font-bold truncate">
                        {group.name}
                      </span>
                    </div>
                    <span className="text-[10px]  px-1.5 py-0.5 rounded bg-slate-900/90">
                      {groupUnits.filter((u) => u.hp > 0).length}/
                      {groupUnits.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="divide-y divide-slate-900">
                      {groupUnits.map((unit) => {
                        const isSelected = unit.id === selectedUnitId;
                        const isDead =
                          unit.hp <= 0 || unit.status === 'destroyed';
                        const totalAmmo = unit.mounts.reduce(
                          (acc, m) => acc + m.currentAmmo,
                          0
                        );

                        return (
                          <button
                            key={unit.id}
                            onClick={() => {
                              selectUnit(unit.id);
                              flyToPosition(unit.position);
                            }}
                            aria-pressed={isSelected}
                            title={unit.name}
                            className={`unit-roster-row ${isSelected ? 'is-selected' : ''} ${isDead ? 'opacity-40 line-through' : ''}`}
                          >
                            <DomainIcon domain={unit.domain} />
                            <div className="min-w-0">
                              <div className="unit-roster-name">{unit.name}</div>
                              <div className="unit-roster-meta">
                                <span>{unit.callsign}</span>
                                <span>{Math.round(unit.speedKts)} 节 · {unit.doctrine.emconRadar ? '雷达开启' : '静默'}</span>
                              </div>
                              <div className="unit-roster-meta">
                                <span className={isDead ? 'text-rose-400' : 'text-emerald-400/80'}>耐久 {Math.round(unit.hp)}/{unit.maxHp}</span>
                                <span>弹药 {totalAmmo}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 2: 战争迷雾情报接触列表 (Contacts & AOU) */}
        {activeTab === 'contacts' && (
          <div className="space-y-2">
            <div className="p-2 rounded bg-amber-950/25 border border-amber-500/30 text-[11px] text-amber-200/90  leading-relaxed">
              <div className="font-bold flex items-center gap-1.5 text-amber-300 mb-0.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>目标情报</span>
              </div>
              被动ESM电子截获或远距声呐会产生较大的 AOU 误差圆；开启预警机或主动雷达逼近后可收敛至精确火控级。
            </div>

            {visibleContacts.length === 0 ? (
              <div className="py-10 text-center text-xs  text-slate-500">
                当前传感器未捕获敌方目标接触
              </div>
            ) : (
              visibleContacts.map((c) => {
                const isSelected = c.id === selectedContactId;
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      selectContact(c.id);
                      flyToPosition(c.estimatedPosition);
                    }}
                    className={`p-2.5 rounded border cursor-pointer transition  ${
                      isSelected
                        ? 'bg-amber-500/20 border-amber-400'
                        : 'bg-slate-950/75 border-slate-800 hover:border-amber-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-amber-300 truncate">
                        {c.displayName}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
                          c.classification === 'identified'
                            ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
                            : c.classification === 'classified'
                            ? 'bg-amber-500/25 text-amber-300'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {classificationLabels[c.classification]}
                      </span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] text-slate-300">
                      <div>航速: {c.speedKts}kt</div>
                      <div>航向: {c.heading}°</div>
                      <div className="text-amber-400">
                        AOU: ±{c.uncertaintyRadiusKm}km
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-cyan-400/90 truncate">
                      探测源: {c.detectedBySources.join(' + ')}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 3: 巡逻任务与参考点管理 */}
        {activeTab === 'missions' && (
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-[11px]  text-cyan-300 font-bold px-1">
                巡逻与截击任务
              </div>
              {visibleMissions.map((m) => (
                <div
                  key={m.id}
                  className="p-2.5 rounded bg-slate-950/80 border border-cyan-500/25 space-y-2 "
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-100">
                      {m.name}
                    </span>
                    <button
                      onClick={() => toggleMissionActive(m.id)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                        m.isActive
                          ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/50'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {m.isActive ? '运行中' : '已挂起'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {m.description}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-cyan-400 pt-1 border-t border-slate-900">
                    <span>配属算子: {m.assignedUnitIds.length} 个单位</span>
                    <button
                      onClick={() => {
                        if (m.areaPolygon[0]) flyToPosition(m.areaPolygon[0], 6.8);
                      }}
                      className="underline hover:text-cyan-200 cursor-pointer"
                    >
                      跳转巡逻区
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* 参考点 Reference Points */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px]  text-amber-300 font-bold">
                  战术参考点
                </span>
                <button
                  onClick={() => setInteractionMode('place_ref_point')}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-[10px]  text-amber-200 cursor-pointer"
                >
                  <MapPin className="w-3 h-3" />
                  <span>添加参考点</span>
                </button>
              </div>

              <div className="space-y-1.5">
                {referencePoints.map((rp) => (
                  <div
                    key={rp.id}
                    className="px-2.5 py-1.5 rounded bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px] "
                  >
                    <div
                      onClick={() => flyToPosition(rp.position)}
                      className="cursor-pointer hover:text-amber-300 truncate"
                    >
                      <span className="text-amber-400 mr-1.5">◆</span>
                      <span>{rp.name}</span>
                    </div>
                    <button
                      aria-label={`删除参考点 ${rp.name}`}
                      onClick={() => removeReferencePoint(rp.id)}
                      className="text-slate-500 hover:text-rose-400 cursor-pointer p-0.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: 地图包线与图层控制开关 */}
        {activeTab === 'layers' && (
          <div className="space-y-2 ">
            <label className="block p-2.5 rounded border border-cyan-500/30 bg-slate-950/70 text-xs space-y-2">
              <span className="block text-cyan-300 font-semibold">地理底图</span>
              <select aria-label="地理底图" value={basemapMode} onChange={(e) => setBasemapMode(e.target.value as BasemapMode)}
                className="w-full bg-slate-900 rounded p-2 text-slate-100">
                {Object.entries(BASEMAP_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
              </select>
              <span className="block text-slate-400 leading-relaxed">{BASEMAP_PRESETS[basemapMode].description}</span>
            </label>
            <div className="text-[10px] text-slate-400 px-1">
              地图显示设置
            </div>
            {layerItems.map((item) => {
              const active = mapLayers[item.key];
              return (
                <div
                  key={item.key}
                  onClick={() => toggleMapLayer(item.key)}
                  className={`p-2.5 rounded border flex items-center justify-between gap-2 cursor-pointer transition ${
                    active
                      ? 'bg-cyan-950/35 border-cyan-500/45 text-slate-100'
                      : 'bg-slate-950/50 border-slate-800 text-slate-500'
                  }`}
                >
                  <div>
                    <div className="text-xs font-bold">{item.label}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {item.desc}
                    </div>
                  </div>
                  <div
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      active
                        ? 'bg-cyan-400 text-slate-950'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {active ? '开' : '关'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
