import React, { useMemo, useState } from 'react';
import { Crosshair, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import type { MissionType } from '../../types/wargame';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

const MISSION_TYPE_OPTIONS: Array<{ value: MissionType; label: string }> = [
  { value: 'aaw_patrol', label: '防空巡逻' },
  { value: 'asuw_patrol', label: '反舰巡逻' },
  { value: 'maritime_strike', label: '防区外对海打击' },
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
  const [missionPackageId, setMissionPackageId] = useState('');
  const [missionTotSecInput, setMissionTotSecInput] = useState('');
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
    setMissionPackageId('');
    setMissionTotSecInput('');
    setSelectedReferencePointIds([]);
  };

  const submitMissionDraft = () => {
    const parsedTotSec = missionTotSecInput.trim() === '' ? undefined : Number(missionTotSecInput);
    const draft = {
      name: missionName,
      type: missionType,
      referencePointIds: selectedReferencePointIds,
      prosecuteOutsideAreaKm: missionRangeKm,
      stationRadiusKm: missionStationRadiusKm,
      escortUnitId: missionType === 'escort' ? missionEscortUnitId || undefined : undefined,
      coordinatedPackageId: missionPackageId.trim() || undefined,
      packageTotSec: parsedTotSec,
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
          <span className="text-[11px] text-foreground font-semibold tracking-tight">巡逻与截击任务</span>
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">{visibleMissions.length} 项</span>
        </div>
        {visibleMissions.length === 0 ? (
          <div className="px-3 py-4 rounded-lg bg-card/60 border border-dashed border-border text-center text-[11px] text-muted-foreground">
            当前视角暂无巡逻或截击任务
          </div>
        ) : (
          visibleMissions.map((m) => {
            const isEditable = playMode === 'sandbox' || m.side === playerSide;
            const isEditingThis = editingMissionId === m.id;
            return (
              <div
                key={m.id}
                className={`p-2.5 rounded-lg bg-card/85 border space-y-2 shadow-xs transition-colors ${
                  isEditingThis ? 'border-emerald-400/70 ring-1 ring-emerald-500/25' : 'border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground leading-snug min-w-0 break-words">{m.name}</span>
                  <button
                    onClick={() => toggleMissionActive(m.id)}
                    className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold border cursor-pointer transition-colors ${
                      m.isActive
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35 hover:bg-emerald-500/25'
                        : 'bg-secondary text-muted-foreground border-border hover:text-foreground'
                    }`}
                  >
                    {m.isActive ? '运行中' : '已挂起'}
                  </button>
                </div>

                {m.description && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{m.description}</p>
                )}

                {(m.coordinatedPackageId || m.packageTotSec !== undefined || m.type === 'maritime_strike' || m.standoffStrike) && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    {(m.type === 'maritime_strike' || m.standoffStrike) && (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 bg-emerald-500/10">
                        防区外发射点保持 + 绕障
                      </Badge>
                    )}
                    {m.coordinatedPackageId && (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10">
                        任务包: {m.coordinatedPackageId}
                      </Badge>
                    )}
                    {m.packageTotSec !== undefined && (
                      <Badge variant="outline" className="border-cyan-500/40 text-cyan-300 bg-cyan-500/10 font-mono tabular-nums">
                        TOT: T+{m.packageTotSec}s
                      </Badge>
                    )}
                  </div>
                )}

                {isEditable && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/80 text-[10px]">
                    <Select
                      aria-label={`${m.name} 任务 ROE`}
                      wrapperClassName="flex-1 min-w-[118px]"
                      className="h-7 text-[10px] px-2 gap-1"
                      value={m.doctrineOverride?.roe ?? ''}
                      onChange={(event) => updateMissionDoctrine(m.id, {
                        roe: (event.target.value || undefined) as 'free' | 'tight' | 'hold' | undefined,
                      })}
                    >
                      <option value="">ROE：沿用单位</option>
                      <option value="free">ROE：自由开火</option>
                      <option value="tight">ROE：自卫反导</option>
                      <option value="hold">ROE：禁止自动</option>
                    </Select>
                    <Button
                      size="xs"
                      variant={m.doctrineOverride?.requireIdentifiedForAutoFire ? 'warning' : 'outline'}
                      onClick={() => updateMissionDoctrine(m.id, {
                        requireIdentifiedForAutoFire: !m.doctrineOverride?.requireIdentifiedForAutoFire,
                      })}
                      className="h-7 px-1.5 shrink-0"
                      title={m.doctrineOverride?.requireIdentifiedForAutoFire ? '仅攻击已识别目标' : '允许攻击已分类目标'}
                    >
                      {m.doctrineOverride?.requireIdentifiedForAutoFire ? '仅攻击已识别' : '允许攻击已分类'}
                    </Button>
                  </div>
                )}

                <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-border/80 text-[10px]">
                  <span className="text-cyan-300/90 font-mono tabular-nums truncate">
                    配属算子: {m.assignedUnitIds.length} 个单位
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      if (m.areaPolygon[0]) flyToPosition(m.areaPolygon[0], 6.8);
                    }}
                    title="跳转至巡逻区"
                    className="h-6 px-1.5 text-cyan-300"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>跳转巡逻区</span>
                  </Button>
                </div>

                {isEditable && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setEditingMissionId(m.id);
                        setMissionName(m.name);
                        setMissionType(m.type);
                        setMissionRangeKm(m.prosecuteOutsideAreaKm);
                        setMissionStationRadiusKm(m.stationRadiusKm ?? 20);
                        setMissionEscortUnitId(m.escortUnitId ?? '');
                        setMissionPackageId(m.coordinatedPackageId ?? '');
                        setMissionTotSecInput(m.packageTotSec !== undefined ? String(m.packageTotSec) : '');
                        setSelectedReferencePointIds(m.areaPolygon.map(([longitude, latitude]) =>
                          editableReferencePoints.find((point) => point.side === m.side &&
                            point.position[0] === longitude && point.position[1] === latitude)?.id
                        ).filter((id): id is string => !!id));
                      }}
                      className="text-cyan-300"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>编辑任务</span>
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      aria-label={`删除任务 ${m.name}`}
                      onClick={() => {
                        if (isEditingThis) resetMissionDraft();
                        deleteMission(m.id);
                      }}
                      className="text-rose-300 hover:border-rose-500/50 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>删除任务</span>
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="p-3 rounded-lg bg-card/90 border border-emerald-500/25 space-y-2.5 text-[11px] shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-emerald-300">{editingMissionId ? '编辑任务区域' : '由参考点创建任务'}</span>
          <Badge variant={selectedReferencePointIds.length >= 3 ? 'success' : 'secondary'} className="font-mono tabular-nums">
            {selectedReferencePointIds.length}/3+ 点
          </Badge>
        </div>

        <label className="block space-y-1">
          <span className="block text-[10px] text-muted-foreground">任务名称</span>
          <Input
            aria-label="任务名称"
            value={missionName}
            maxLength={80}
            onChange={(event) => setMissionName(event.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-[10px] text-muted-foreground">任务类型</span>
          <Select
            aria-label="任务类型"
            value={missionType}
            onChange={(event) => setMissionType(event.target.value as MissionType)}
          >
            {MISSION_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1 min-w-0">
            <span className="block text-[10px] text-muted-foreground whitespace-nowrap">区外追击</span>
            <div className="flex items-center h-8 bg-background/85 border border-input rounded-md px-2 focus-within:ring-2 focus-within:ring-ring">
              <input
                aria-label="区外追击公里"
                type="number"
                min={0}
                max={2000}
                value={missionRangeKm}
                onChange={(event) => setMissionRangeKm(Number(event.target.value))}
                className="min-w-0 w-full bg-transparent text-xs text-foreground font-mono tabular-nums focus:outline-none"
              />
              <span className="text-[10px] text-muted-foreground shrink-0 ml-1">km</span>
            </div>
          </label>
          <label className="block space-y-1 min-w-0">
            <span className="block text-[10px] text-muted-foreground whitespace-nowrap">执勤半径</span>
            <div className="flex items-center h-8 bg-background/85 border border-input rounded-md px-2 focus-within:ring-2 focus-within:ring-ring">
              <input
                aria-label="任务执勤半径公里"
                type="number"
                min={1}
                max={500}
                value={missionStationRadiusKm}
                onChange={(event) => setMissionStationRadiusKm(Number(event.target.value))}
                className="min-w-0 w-full bg-transparent text-xs text-foreground font-mono tabular-nums focus:outline-none"
              />
              <span className="text-[10px] text-muted-foreground shrink-0 ml-1">km</span>
            </div>
          </label>
        </div>

        {missionType === 'escort' && (
          <label className="block space-y-1">
            <span className="block text-[10px] text-muted-foreground">护航对象</span>
            <Select
              aria-label="护航对象"
              value={missionEscortUnitId}
              onChange={(event) => setMissionEscortUnitId(event.target.value)}
            >
              <option value="">选择同阵营护航对象</option>
              {Object.values(units)
                .filter((unit) => unit.side === (selectedReferenceSide ?? playerSide) && unit.hp > 0)
                .map((unit) => <option key={unit.id} value={unit.id}>{unit.callsign} · {unit.name}</option>)}
            </Select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1 min-w-0">
            <span className="block text-[10px] text-muted-foreground whitespace-nowrap">协同任务包 ID</span>
            <Input
              aria-label="协同任务包 ID"
              placeholder="如 PKG-ALPHA"
              value={missionPackageId}
              maxLength={48}
              onChange={(event) => setMissionPackageId(event.target.value)}
            />
          </label>
          <label className="block space-y-1 min-w-0">
            <span className="block text-[10px] text-muted-foreground whitespace-nowrap">TOT 协同时间窗</span>
            <div className="flex items-center h-8 bg-background/85 border border-input rounded-md px-2 focus-within:ring-2 focus-within:ring-ring">
              <input
                aria-label="TOT 协同时间窗秒"
                type="number"
                min={0}
                placeholder="可选"
                value={missionTotSecInput}
                onChange={(event) => setMissionTotSecInput(event.target.value)}
                className="min-w-0 w-full bg-transparent text-xs text-foreground font-mono tabular-nums focus:outline-none"
              />
              <span className="text-[10px] text-muted-foreground shrink-0 ml-1">s</span>
            </div>
          </label>
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          按勾选顺序连接至少 3 个同阵营参考点；自交或退化多边形会被拒绝。
        </p>

        <div className="flex gap-2">
          <Button
            variant="success"
            disabled={!isReadyToSubmit}
            onClick={submitMissionDraft}
            className="flex-1"
          >
            {!editingMissionId && <Plus className="w-3.5 h-3.5" />}
            <span>{editingMissionId ? '保存任务' : '创建任务'}</span>
          </Button>
          {editingMissionId && (
            <Button variant="secondary" onClick={resetMissionDraft}>
              取消编辑
            </Button>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-border space-y-2">
        <div className="flex items-center justify-between gap-1 px-1">
          <span className="text-[11px] text-amber-300 font-semibold whitespace-nowrap">战术参考点</span>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="xs"
              variant="outline"
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
              className="text-emerald-300 border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20"
              title="一键生成 3 个同阵营参考点并勾选"
            >
              一键3点
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => setInteractionMode('place_ref_point')}
              className="text-amber-300 border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20"
            >
              <MapPin className="w-3 h-3" />
              <span>添加参考点</span>
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          {editableReferencePoints.map((rp) => {
            const selected = selectedReferencePointIds.includes(rp.id);
            const wrongSide = !!selectedReferenceSide && selectedReferenceSide !== rp.side;
            return (
              <div
                key={rp.id}
                className={`px-2.5 py-1.5 rounded-md border flex items-center justify-between text-[11px] transition-colors ${
                  selected
                    ? 'bg-amber-500/10 border-amber-400/45 text-foreground'
                    : 'bg-card/75 border-border text-muted-foreground'
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
                  className="text-muted-foreground hover:text-rose-400 disabled:opacity-25 cursor-pointer p-0.5 shrink-0"
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
