import React, { useMemo, useState } from 'react';
import { MapPin, Trash2 } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import type { MissionType } from '../../types/wargame';

const MISSION_TYPE_OPTIONS: Array<{ value: MissionType; label: string }> = [
  { value: 'aaw_patrol', label: '防空巡逻' },
  { value: 'asuw_patrol', label: '反舰巡逻' },
  { value: 'asw_patrol', label: '反潜巡逻' },
  { value: 'land_strike', label: '对陆打击' },
  { value: 'aew_support', label: '预警支援' },
  { value: 'escort', label: '护航' },
  { value: 'sead', label: '防空压制' },
  { value: 'tanker_support', label: '加油支援' },
];

export const MissionsTab: React.FC = () => {
  const [missionName, setMissionName] = useState('新建战术任务');
  const [missionType, setMissionType] = useState<MissionType>('aaw_patrol');
  const [missionRangeKm, setMissionRangeKm] = useState(50);
  const [missionStationRadiusKm, setMissionStationRadiusKm] = useState(20);
  const [missionEscortUnitId, setMissionEscortUnitId] = useState('');
  const [selectedReferencePointIds, setSelectedReferencePointIds] = useState<string[]>([]);
  const [editingMissionId, setEditingMissionId] = useState<string | null>(null);

  const units = useWargameStore((s) => s.units);
  const missions = useWargameStore((s) => s.missions);
  const referencePoints = useWargameStore((s) => s.referencePoints);
  const activePerspective = useWargameStore((s) => s.activePerspective);
  const playerSide = useWargameStore((s) => s.playerSide);
  const playMode = useWargameStore((s) => s.playMode);
  const flyToPosition = useWargameStore((s) => s.flyToPosition);
  const toggleMissionActive = useWargameStore((s) => s.toggleMissionActive);
  const createMissionFromReferencePoints = useWargameStore((s) => s.createMissionFromReferencePoints);
  const updateMissionFromReferencePoints = useWargameStore((s) => s.updateMissionFromReferencePoints);
  const deleteMission = useWargameStore((s) => s.deleteMission);
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);
  const removeReferencePoint = useWargameStore((s) => s.removeReferencePoint);

  const visibleMissions = useMemo(
    () => missions.filter((mission) => activePerspective === 'GOD' || mission.side === activePerspective),
    [missions, activePerspective]
  );
  const editableReferencePoints = useMemo(
    () => referencePoints.filter((point) => playMode === 'sandbox' || point.side === playerSide),
    [referencePoints, playMode, playerSide]
  );
  const selectedReferenceSide = editableReferencePoints.find((point) => selectedReferencePointIds.includes(point.id))?.side;

  const resetMissionDraft = () => {
    setEditingMissionId(null);
    setMissionName('新建战术任务');
    setMissionType('aaw_patrol');
    setMissionRangeKm(50);
    setMissionStationRadiusKm(20);
    setMissionEscortUnitId('');
    setSelectedReferencePointIds([]);
  };

  const submitMissionDraft = () => {
    const draft = {
      name: missionName,
      type: missionType,
      referencePointIds: selectedReferencePointIds,
      prosecuteOutsideAreaKm: missionRangeKm,
      stationRadiusKm: missionStationRadiusKm,
      escortUnitId: missionType === 'escort' ? missionEscortUnitId || undefined : undefined,
    };
    const before = useWargameStore.getState().commandSequence;
    if (editingMissionId) updateMissionFromReferencePoints(editingMissionId, draft);
    else createMissionFromReferencePoints(draft);
    if (useWargameStore.getState().commandSequence > before) resetMissionDraft();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="text-[11px] text-cyan-300 font-bold px-1">巡逻与截击任务</div>
        {visibleMissions.map((m) => (
          <div key={m.id} className="p-2.5 rounded bg-slate-950/80 border border-cyan-500/25 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-100">{m.name}</span>
              <button
                onClick={() => toggleMissionActive(m.id)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                  m.isActive ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/50' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {m.isActive ? '运行中' : '已挂起'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">{m.description}</p>
            {(playMode === 'sandbox' || m.side === playerSide) && (
              <div className="flex gap-2 text-[10px]">
                <button
                  onClick={() => {
                    setEditingMissionId(m.id);
                    setMissionName(m.name);
                    setMissionType(m.type);
                    setMissionRangeKm(m.prosecuteOutsideAreaKm);
                    setMissionStationRadiusKm(m.stationRadiusKm ?? 20);
                    setMissionEscortUnitId(m.escortUnitId ?? '');
                    setSelectedReferencePointIds(m.areaPolygon.map(([longitude, latitude]) =>
                      editableReferencePoints.find((point) => point.side === m.side &&
                        point.position[0] === longitude && point.position[1] === latitude)?.id
                    ).filter((id): id is string => !!id));
                  }}
                  className="text-cyan-300 underline hover:text-cyan-100 cursor-pointer"
                >
                  编辑任务
                </button>
                <button
                  aria-label={`删除任务 ${m.name}`}
                  onClick={() => deleteMission(m.id)}
                  className="text-rose-300 underline hover:text-rose-100 cursor-pointer"
                >
                  删除任务
                </button>
              </div>
            )}
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

      <div className="p-2.5 rounded bg-emerald-950/20 border border-emerald-500/30 space-y-2 text-[11px]">
        <div className="font-bold text-emerald-300">{editingMissionId ? '编辑任务区域' : '由参考点创建任务'}</div>
        <input
          aria-label="任务名称"
          value={missionName}
          maxLength={80}
          onChange={(event) => setMissionName(event.target.value)}
          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="任务类型"
            value={missionType}
            onChange={(event) => setMissionType(event.target.value as MissionType)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            {MISSION_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-slate-400">
            区外追击
            <input
              aria-label="区外追击公里"
              type="number"
              min={0}
              max={2000}
              value={missionRangeKm}
              onChange={(event) => setMissionRangeKm(Number(event.target.value))}
              className="min-w-0 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
            />
            km
          </label>
        </div>
        <label className="flex items-center gap-2 text-slate-400">
          执勤半径
          <input
            aria-label="任务执勤半径公里"
            type="number"
            min={1}
            max={500}
            value={missionStationRadiusKm}
            onChange={(event) => setMissionStationRadiusKm(Number(event.target.value))}
            className="min-w-0 flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          />
          km
        </label>
        {missionType === 'escort' && (
          <select
            aria-label="护航对象"
            value={missionEscortUnitId}
            onChange={(event) => setMissionEscortUnitId(event.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            <option value="">选择同阵营护航对象</option>
            {Object.values(units)
              .filter((unit) => unit.side === (selectedReferenceSide ?? playerSide) && unit.hp > 0)
              .map((unit) => <option key={unit.id} value={unit.id}>{unit.callsign} · {unit.name}</option>)}
          </select>
        )}
        <p className="text-slate-400">按勾选顺序连接至少 3 个同阵营参考点；自交或退化多边形会被拒绝。</p>
        <div className="flex gap-2">
          <button
            disabled={!missionName.trim() || selectedReferencePointIds.length < 3 ||
              (missionType === 'escort' && !missionEscortUnitId)}
            onClick={submitMissionDraft}
            className="px-2 py-1 rounded bg-emerald-600 text-slate-950 font-bold disabled:opacity-35 cursor-pointer"
          >
            {editingMissionId ? '保存任务' : '创建任务'}
          </button>
          {editingMissionId && (
            <button onClick={resetMissionDraft} className="px-2 py-1 rounded bg-slate-800 text-slate-300 cursor-pointer">
              取消编辑
            </button>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-800 space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-amber-300 font-bold">战术参考点</span>
          <button
            onClick={() => setInteractionMode('place_ref_point')}
            className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-[10px] text-amber-200 cursor-pointer"
          >
            <MapPin className="w-3 h-3" />
            <span>添加参考点</span>
          </button>
        </div>

        <div className="space-y-1.5">
          {editableReferencePoints.map((rp) => {
            const selected = selectedReferencePointIds.includes(rp.id);
            const wrongSide = !!selectedReferenceSide && selectedReferenceSide !== rp.side;
            return (
              <div key={rp.id} className="px-2.5 py-1.5 rounded bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px]">
                <label className={`flex items-center gap-2 min-w-0 ${wrongSide ? 'opacity-40' : ''}`}>
                  <input
                    aria-label={`选择参考点 ${rp.name}`}
                    type="checkbox"
                    checked={selected}
                    disabled={!selected && wrongSide}
                    onChange={(event) => setSelectedReferencePointIds((current) => event.target.checked
                      ? [...current, rp.id]
                      : current.filter((id) => id !== rp.id))}
                  />
                  <span onClick={() => flyToPosition(rp.position)} className="cursor-pointer hover:text-amber-300 truncate">
                    <span className="text-amber-400 mr-1.5">◆</span>
                    <span>{rp.name} · {rp.side}</span>
                  </span>
                </label>
                <button
                  aria-label={`删除参考点 ${rp.name}`}
                  disabled={rp.locked}
                  onClick={() => {
                    removeReferencePoint(rp.id);
                    setSelectedReferencePointIds((current) => current.filter((id) => id !== rp.id));
                  }}
                  className="text-slate-500 hover:text-rose-400 disabled:opacity-25 cursor-pointer p-0.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
