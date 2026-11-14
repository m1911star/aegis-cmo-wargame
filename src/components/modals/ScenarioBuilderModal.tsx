import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import type { SideId } from '../../types/wargame';

export const ScenarioBuilderModal: React.FC = () => {
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const units = useWargameStore((s) => s.units);
  const groups = useWargameStore((s) => s.groups);
  const events = useWargameStore((s) => s.events);
  const objectives = useWargameStore((s) => s.objectives);
  const referencePoints = useWargameStore((s) => s.referencePoints);
  const selectUnit = useWargameStore((s) => s.selectUnit);
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);
  const updateScenarioGroup = useWargameStore((s) => s.updateScenarioGroup);
  const assignUnitGroup = useWargameStore((s) => s.assignUnitGroup);
  const upsertObjective = useWargameStore((s) => s.upsertObjective);
  const deleteObjective = useWargameStore((s) => s.deleteObjective);
  const createAreaEventFromReferencePoints = useWargameStore((s) => s.createAreaEventFromReferencePoints);
  const deleteScenarioEvent = useWargameStore((s) => s.deleteScenarioEvent);

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

  const selectedBuilderGroup = groups.find((group) => group.id === builderGroupId) ?? groups[0];
  const selectedBuilderUnit = units[builderUnitId] ?? Object.values(units)[0];

  return (
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
  );
};
