import React, { useMemo, useState } from 'react';
import { Crosshair, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
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
  const updateMissionDoctrine = useWargameStore((s) => s.updateMissionDoctrine);
  const deleteMission = useWargameStore((s) => s.deleteMission);
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);
  const addReferencePoint = useWargameStore((s) => s.addReferencePoint);
  const removeReferencePoint = useWargameStore((s) => s.removeReferencePoint);
  const currentScenario = useWargameStore((s) => s.currentScenario);

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

  const isReadyToSubmit = Boolean(
    missionName.trim() &&
    selectedReferencePointIds.length >= 3 &&
    (missionType !== 'escort' || missionEscortUnitId)
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-cyan-300 font-bold tracking-wide">巡逻与截击任务</span>
          <span className="text-[10px] text-slate-500 font-mono tabular-nums">{visibleMissions.length} 项</span>
        </div>
        {visibleMissions.length === 0 ? (
          <div className="px-3 py-4 rounded-md bg-slate-950/50 border border-slate-800/80 text-center text-[11px] text-slate-500">
            当前视角暂无巡逻或截击任务
          </div>
        ) : (
          visibleMissions.map((m) => {
            const isEditable = playMode === 'sandbox' || m.side === playerSide;
            const isEditingThis = editingMissionId === m.id;
            return (
              <div
                key={m.id}
                className={`p-2.5 rounded-md bg-slate-950/80 border space-y-2 transition ${
                  isEditingThis ? 'border-emerald-400/60 ring-1 ring-emerald-500/25' : 'border-cyan-500/25'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-bold text-slate-100 leading-snug min-w-0 break-words">{m.name}</span>
                  <button
                    onClick={() => toggleMissionActive(m.id)}
                    className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                      m.isActive
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/45 hover:bg-emerald-500/30'
                        : 'bg-slate-800/90 text-slate-400 border border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {m.isActive ? '运行中' : '已挂起'}
                  </button>
                </div>

                {m.description && (
                  <p className="text-[11px] text-slate-400 leading-relaxed">{m.description}</p>
                )}

                {isEditable && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-800/80 text-[10px]">
                    <select
                      aria-label={`${m.name} 任务 ROE`}
                      value={m.doctrineOverride?.roe ?? ''}
                      onChange={(event) => updateMissionDoctrine(m.id, {
                        roe: (event.target.value || undefined) as 'free' | 'tight' | 'hold' | undefined,
                      })}
                      className="flex-1 min-w-[104px] h-7 bg-slate-900/90 border border-slate-700/80 rounded px-1.5 text-slate-200 focus:outline-none focus:border-cyan-400/60 cursor-pointer"
                    >
                      <option value="">ROE：沿用单位</option>
                      <option value="free">ROE：自由开火</option>
                      <option value="tight">ROE：自卫反导</option>
                      <option value="hold">ROE：禁止自动</option>
                    </select>
                    <button
                      onClick={() => updateMissionDoctrine(m.id, {
                        requireIdentifiedForAutoFire: !m.doctrineOverride?.requireIdentifiedForAutoFire,
                      })}
                      className={`shrink-0 h-7 px-2 rounded border cursor-pointer whitespace-nowrap transition ${
                        m.doctrineOverride?.requireIdentifiedForAutoFire
                          ? 'bg-amber-500/20 border-amber-400/70 text-amber-200'
                          : 'bg-slate-900/90 border-slate-700/80 text-slate-300 hover:border-slate-600'
                      }`}
                      title={m.doctrineOverride?.requireIdentifiedForAutoFire ? '仅攻击已识别目标' : '允许攻击已分类目标'}
                    >
                      {m.doctrineOverride?.requireIdentifiedForAutoFire ? '仅攻击已识别' : '允许攻击已分类'}
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-800/80 text-[10px]">
                  <span className="text-cyan-400/90 font-mono tabular-nums truncate">
                    配属算子: {m.assignedUnitIds.length} 个单位
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        if (m.areaPolygon[0]) flyToPosition(m.areaPolygon[0], 6.8);
                      }}
                      title="跳转至巡逻区"
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/90 border border-slate-700/80 text-cyan-300 hover:border-cyan-400/60 hover:text-cyan-100 cursor-pointer transition"
                    >
                      <Crosshair className="w-3 h-3" />
                      <span>跳转巡逻区</span>
                    </button>
                  </div>
                </div>

                {isEditable && (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
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
                      className="inline-flex items-center justify-center gap-1 h-6 rounded bg-slate-900/90 border border-slate-700/80 text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-950/30 cursor-pointer transition"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>编辑任务</span>
                    </button>
                    <button
                      aria-label={`删除任务 ${m.name}`}
                      onClick={() => {
                        if (isEditingThis) resetMissionDraft();
                        deleteMission(m.id);
                      }}
                      className="inline-flex items-center justify-center gap-1 h-6 rounded bg-slate-900/90 border border-slate-700/80 text-rose-300 hover:border-rose-400/60 hover:bg-rose-950/30 cursor-pointer transition"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>删除任务</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="p-2.5 rounded-md bg-emerald-950/20 border border-emerald-500/30 space-y-2.5 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-emerald-300">{editingMissionId ? '编辑任务区域' : '由参考点创建任务'}</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums border ${
              selectedReferencePointIds.length >= 3
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-900/90 text-slate-400 border-slate-700/80'
            }`}
          >
            {selectedReferencePointIds.length}/3+ 点
          </span>
        </div>

        <label className="block space-y-1">
          <span className="block text-[10px] text-slate-400">任务名称</span>
          <input
            aria-label="任务名称"
            value={missionName}
            maxLength={80}
            onChange={(event) => setMissionName(event.target.value)}
            className="w-full h-8 bg-slate-950/90 border border-slate-700/80 rounded px-2.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-400/70"
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-[10px] text-slate-400">任务类型</span>
          <select
            aria-label="任务类型"
            value={missionType}
            onChange={(event) => setMissionType(event.target.value as MissionType)}
            className="w-full h-8 bg-slate-950/90 border border-slate-700/80 rounded px-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-400/70 cursor-pointer"
          >
            {MISSION_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1 min-w-0">
            <span className="block text-[10px] text-slate-400 whitespace-nowrap">区外追击</span>
            <div className="flex items-center h-8 bg-slate-950/90 border border-slate-700/80 rounded px-2 focus-within:border-emerald-400/70">
              <input
                aria-label="区外追击公里"
                type="number"
                min={0}
                max={2000}
                value={missionRangeKm}
                onChange={(event) => setMissionRangeKm(Number(event.target.value))}
                className="min-w-0 w-full bg-transparent text-xs text-slate-100 font-mono tabular-nums focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 shrink-0 ml-1">km</span>
            </div>
          </label>
          <label className="block space-y-1 min-w-0">
            <span className="block text-[10px] text-slate-400 whitespace-nowrap">执勤半径</span>
            <div className="flex items-center h-8 bg-slate-950/90 border border-slate-700/80 rounded px-2 focus-within:border-emerald-400/70">
              <input
                aria-label="任务执勤半径公里"
                type="number"
                min={1}
                max={500}
                value={missionStationRadiusKm}
                onChange={(event) => setMissionStationRadiusKm(Number(event.target.value))}
                className="min-w-0 w-full bg-transparent text-xs text-slate-100 font-mono tabular-nums focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 shrink-0 ml-1">km</span>
            </div>
          </label>
        </div>

        {missionType === 'escort' && (
          <label className="block space-y-1">
            <span className="block text-[10px] text-slate-400">护航对象</span>
            <select
              aria-label="护航对象"
              value={missionEscortUnitId}
              onChange={(event) => setMissionEscortUnitId(event.target.value)}
              className="w-full h-8 bg-slate-950/90 border border-slate-700/80 rounded px-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-400/70 cursor-pointer"
            >
              <option value="">选择同阵营护航对象</option>
              {Object.values(units)
                .filter((unit) => unit.side === (selectedReferenceSide ?? playerSide) && unit.hp > 0)
                .map((unit) => <option key={unit.id} value={unit.id}>{unit.callsign} · {unit.name}</option>)}
            </select>
          </label>
        )}

        <p className="text-[10px] text-slate-400/90 leading-relaxed">
          按勾选顺序连接至少 3 个同阵营参考点；自交或退化多边形会被拒绝。
        </p>

        <div className="flex gap-2">
          <button
            disabled={!isReadyToSubmit}
            onClick={submitMissionDraft}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition cursor-pointer disabled:bg-slate-800/80 disabled:text-slate-500 disabled:border disabled:border-slate-700/70 disabled:cursor-not-allowed"
          >
            {!editingMissionId && <Plus className="w-3.5 h-3.5" />}
            <span>{editingMissionId ? '保存任务' : '创建任务'}</span>
          </button>
          {editingMissionId && (
            <button
              onClick={resetMissionDraft}
              className="h-8 px-2.5 rounded bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs cursor-pointer transition whitespace-nowrap"
            >
              取消编辑
            </button>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-800 space-y-2">
        <div className="flex items-center justify-between gap-1 px-1">
          <span className="text-[11px] text-amber-300 font-bold whitespace-nowrap">战术参考点</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                const [cx, cy] = currentScenario.initialCamera.center;
                const offsets: [number, number][] = [
                  [cx - 0.35, cy + 0.25],
                  [cx + 0.35, cy + 0.25],
                  [cx, cy - 0.35],
                ];
                const beforeIds = new Set(useWargameStore.getState().referencePoints.map((r) => r.id));
                for (const coord of offsets) addReferencePoint(coord, playerSide);
                const addedIds = useWargameStore
                  .getState()
                  .referencePoints.filter((r) => !beforeIds.has(r.id) && r.side === playerSide)
                  .map((r) => r.id);
                setSelectedReferencePointIds(addedIds);
              }}
              className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-[10px] text-emerald-200 cursor-pointer whitespace-nowrap transition"
              title="一键生成 3 个同阵营参考点并勾选"
            >
              一键3点
            </button>
            <button
              onClick={() => setInteractionMode('place_ref_point')}
              className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-[10px] text-amber-200 cursor-pointer whitespace-nowrap transition"
            >
              <MapPin className="w-3 h-3" />
              <span>添加参考点</span>
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          {editableReferencePoints.map((rp) => {
            const selected = selectedReferencePointIds.includes(rp.id);
            const wrongSide = !!selectedReferenceSide && selectedReferenceSide !== rp.side;
            return (
              <div
                key={rp.id}
                className={`px-2.5 py-1.5 rounded-md border flex items-center justify-between text-[11px] transition ${
                  selected
                    ? 'bg-amber-950/25 border-amber-400/45 text-slate-100'
                    : 'bg-slate-950/70 border-slate-800/90 text-slate-300'
                }`}
              >
                <label className={`flex items-center gap-2 min-w-0 ${wrongSide ? 'opacity-40' : ''}`}>
                  <input
                    aria-label={`选择参考点 ${rp.name}`}
                    type="checkbox"
                    checked={selected}
                    disabled={!selected && wrongSide}
                    onChange={(event) => setSelectedReferencePointIds((current) => event.target.checked
                      ? [...current, rp.id]
                      : current.filter((id) => id !== rp.id))}
                    className="accent-emerald-400 shrink-0 cursor-pointer"
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
                  className="text-slate-500 hover:text-rose-400 disabled:opacity-25 cursor-pointer p-0.5 shrink-0"
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
