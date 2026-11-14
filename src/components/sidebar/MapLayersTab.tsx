import React from 'react';
import { BASEMAP_PRESETS, type BasemapMode } from '../../map/basemaps';
import { useWargameStore, type MapLayerVisibility } from '../../store/useWargameStore';

const LAYER_ITEMS: {
  key: keyof MapLayerVisibility;
  label: string;
  desc: string;
}[] = [
  { key: 'showRadarRings', label: '主动雷达搜索视距圈', desc: '显示全军开机雷达探测包线' },
  { key: 'showWeaponRings', label: '防空/反舰导弹射程圈', desc: '显示主战武器最大动力射程' },
  { key: 'showSonarRings', label: '水下声呐监听包线', desc: '显示拖曳线列阵与主动声呐圈' },
  { key: 'showWaypoints', label: '机动航路点与航向矢量', desc: '显示F3规划航线及90s预测线' },
  { key: 'showAouPolygons', label: '情报误差范围', desc: '显示ESM/声呐测向误差范围' },
  { key: 'showMissions', label: '自动巡逻任务区多边形', desc: '显示防空、反舰与反潜巡逻区' },
  { key: 'showReferencePoints', label: '战术参考点', desc: '显示海图基准坐标点' },
];

export const MapLayersTab: React.FC = () => {
  const mapLayers = useWargameStore((s) => s.mapLayers);
  const toggleMapLayer = useWargameStore((s) => s.toggleMapLayer);
  const basemapMode = useWargameStore((s) => s.basemapMode);
  const setBasemapMode = useWargameStore((s) => s.setBasemapMode);

  return (
    <div className="space-y-2">
      <label className="block p-2.5 rounded border border-cyan-500/30 bg-slate-950/70 text-xs space-y-2">
        <span className="block text-cyan-300 font-semibold">地理底图</span>
        <select
          aria-label="地理底图"
          value={basemapMode}
          onChange={(e) => setBasemapMode(e.target.value as BasemapMode)}
          className="w-full bg-slate-900 rounded p-2 text-slate-100"
        >
          {Object.entries(BASEMAP_PRESETS).map(([id, preset]) => (
            <option key={id} value={id}>{preset.label}</option>
          ))}
        </select>
        <span className="block text-slate-400 leading-relaxed">{BASEMAP_PRESETS[basemapMode].description}</span>
      </label>
      <div className="text-[10px] text-slate-400 px-1">地图显示设置</div>
      {LAYER_ITEMS.map((item) => {
        const active = mapLayers[item.key];
        return (
          <div
            key={item.key}
            onClick={() => toggleMapLayer(item.key)}
            className={`p-2.5 rounded border flex items-center justify-between gap-2 cursor-pointer transition ${
              active ? 'bg-cyan-950/35 border-cyan-500/45 text-slate-100' : 'bg-slate-950/50 border-slate-800 text-slate-500'
            }`}
          >
            <div>
              <div className="text-xs font-bold">{item.label}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{item.desc}</div>
            </div>
            <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${active ? 'bg-cyan-400 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
              {active ? '开' : '关'}
            </div>
          </div>
        );
      })}
    </div>
  );
};
