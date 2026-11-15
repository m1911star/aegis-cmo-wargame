import React, { useState } from 'react';
import { PencilRuler } from 'lucide-react';
import { FORCE_PACKAGES } from '../../db';
import { useWargameStore } from '../../store/useWargameStore';
import type { SideId } from '../../types/wargame';
import { Button } from '../ui/button';
import { ModalHeader, ModalShell } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Textarea } from '../ui/textarea';

export const ScenarioBuilderModal: React.FC = () => {
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const units = useWargameStore((s) => s.units);
  const catalog = useWargameStore((s) => s.catalog);
  const groups = useWargameStore((s) => s.groups);
  const events = useWargameStore((s) => s.events);
  const objectives = useWargameStore((s) => s.objectives);
  const referencePoints = useWargameStore((s) => s.referencePoints);
  const selectUnit = useWargameStore((s) => s.selectUnit);
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);
  const startForcePackageSpawnOnMap = useWargameStore((s) => s.startForcePackageSpawnOnMap);
  const updateScenarioGroup = useWargameStore((s) => s.updateScenarioGroup);
  const assignUnitGroup = useWargameStore((s) => s.assignUnitGroup);
  const upsertObjective = useWargameStore((s) => s.upsertObjective);
  const deleteObjective = useWargameStore((s) => s.deleteObjective);
  const createAreaEventFromReferencePoints = useWargameStore((s) => s.createAreaEventFromReferencePoints);
  const deleteScenarioEvent = useWargameStore((s) => s.deleteScenarioEvent);

  const [builderGroupId, setBuilderGroupId] = useState('');
  const [builderUnitId, setBuilderUnitId] = useState('');
  const [forcePackageId, setForcePackageId] = useState(Object.keys(FORCE_PACKAGES)[0] ?? '');
  const [forcePackageSide, setForcePackageSide] = useState<SideId>('RED');
  const [objectiveTitle, setObjectiveTitle] = useState('新建目标');
  const [objectiveSide, setObjectiveSide] = useState<'RED' | 'BLUE'>('RED');
  const [objectiveType, setObjectiveType] = useState<'destroy' | 'disable' | 'preserve' | 'observe' | 'withdraw' | 'control_area'>('destroy');
  const [objectiveUnitId, setObjectiveUnitId] = useState('');
  const [objectiveReferenceIds, setObjectiveReferenceIds] = useState<string[]>([]);
  const [areaEventName, setAreaEventName] = useState('区域进入警报');
  const [areaEventMessage, setAreaEventMessage] = useState('侦测到单位进入指定区域。');
  const [areaEventSide, setAreaEventSide] = useState<SideId>('RED');
  const [areaEventReferenceIds, setAreaEventReferenceIds] = useState<string[]>([]);

  const selectedBuilderGroup = groups.find((group) => group.id === builderGroupId) ?? groups[0];
  const selectedBuilderUnit = units[builderUnitId] ?? Object.values(units)[0];
  const selectedForcePackage = FORCE_PACKAGES[forcePackageId];
  const forcePackageGroup = groups.find((group) => group.side === forcePackageSide);

  return (
    <ModalShell className="max-w-5xl max-h-[92dvh] flex flex-col">
      <ModalHeader
        icon={<PencilRuler className="w-4 h-4 text-emerald-400" />}
        title="SCENARIO BUILDER // 可视化想定编辑"
        onClose={() => setActiveModal('none')}
      />
      <div className="p-4 grid md:grid-cols-2 gap-4 text-xs overflow-y-auto flex-1">
        <section className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-3">
          <h3 className="text-primary font-semibold">单位与编组</h3>
          <div className="space-y-2 rounded-md border border-border/70 bg-background/40 p-2.5">
            <h4 className="font-medium">部署可复用军队配置</h4>
            <Select aria-label="部署军队配置" value={forcePackageId} onChange={(event) => setForcePackageId(event.target.value)}>
              {Object.values(FORCE_PACKAGES).map((forcePackage) =>
                <option key={forcePackage.id} value={forcePackage.id}>{forcePackage.name}</option>)}
            </Select>
            <Select aria-label="军队配置部署阵营" value={forcePackageSide}
              onChange={(event) => setForcePackageSide(event.target.value as SideId)}>
              <option value="RED">RED</option><option value="BLUE">BLUE</option>
            </Select>
            {selectedForcePackage && <div className="text-[11px] text-muted-foreground">
              {selectedForcePackage.description}
              <p className="mt-1">{selectedForcePackage.members.map((member) => {
                const platform = catalog.platforms[member.platformId];
                return `${platform?.name ?? member.platformId} ×${member.quantity}`;
              }).join(' · ')}</p>
              <p className="mt-1">混合陆海编组建议在海岸附近部署，系统会为成员自动寻找可用域内位置。</p>
            </div>}
            <Button size="sm" variant="success" disabled={!selectedForcePackage || !forcePackageGroup}
              onClick={() => {
                if (!selectedForcePackage || !forcePackageGroup) return;
                startForcePackageSpawnOnMap({
                  forcePackageId: selectedForcePackage.id,
                  side: forcePackageSide,
                  parentGroupId: forcePackageGroup.id,
                });
              }}>
              选择后点击地图部署
            </Button>
          </div>
          <Select aria-label="Builder 单位" value={selectedBuilderUnit?.id ?? ''} onChange={(event) => setBuilderUnitId(event.target.value)}>
            {Object.values(units).map((unit) => <option key={unit.id} value={unit.id}>{unit.callsign} · {unit.name}</option>)}
          </Select>
          {selectedBuilderUnit && <>
            <Select aria-label="Builder 编组" value={selectedBuilderUnit.parentGroupId}
              onChange={(event) => assignUnitGroup(selectedBuilderUnit.id, event.target.value)}>
              {groups.filter((group) => group.side === selectedBuilderUnit.side).map((group) =>
                <option key={group.id} value={group.id}>{group.name}</option>)}
            </Select>
            <Button variant="success" size="sm" onClick={() => { selectUnit(selectedBuilderUnit.id); setInteractionMode('move_unit'); setActiveModal('none'); }}>
              关闭面板并在地图移动单位
            </Button>
          </>}
          <Select aria-label="Builder 选择编组" value={selectedBuilderGroup?.id ?? ''} onChange={(event) => setBuilderGroupId(event.target.value)}>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </Select>
          {selectedBuilderGroup && (
            <form key={selectedBuilderGroup.id} className="space-y-2" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              updateScenarioGroup(selectedBuilderGroup.id, {
                name: String(data.get('name') ?? ''), commandTitle: String(data.get('commandTitle') ?? ''),
                description: String(data.get('description') ?? ''),
              });
            }}>
              <Input name="name" aria-label="编组名称" defaultValue={selectedBuilderGroup.name} />
              <Input name="commandTitle" aria-label="编组指挥代号" defaultValue={selectedBuilderGroup.commandTitle} />
              <Textarea name="description" aria-label="编组说明" defaultValue={selectedBuilderGroup.description} />
              <Button size="sm" variant="outline" type="submit">保存编组</Button>
            </form>
          )}
          <p className="text-[11px] text-muted-foreground">任务区继续使用左侧“由参考点创建任务”，两者共享同一可重放命令模型。</p>
        </section>

        <section className="p-3.5 rounded-lg bg-muted/35 border border-border space-y-3">
          <h3 className="text-primary font-semibold">胜负目标</h3>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {objectives.map((objective) => <div key={objective.id} className="flex justify-between items-center gap-2 px-2.5 py-1.5 bg-background/60 border border-border/60 rounded-md">
              <span>{objective.side} · {objective.title}</span>
              <button aria-label={`删除目标 ${objective.title}`} onClick={() => deleteObjective(objective.id)} className="text-rose-300 hover:text-rose-200 cursor-pointer">删除</button>
            </div>)}
          </div>
          <Input aria-label="目标标题" value={objectiveTitle} onChange={(event) => setObjectiveTitle(event.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Select aria-label="目标阵营" value={objectiveSide} onChange={(event) => { setObjectiveSide(event.target.value as 'RED' | 'BLUE'); setObjectiveReferenceIds([]); }}>
              <option value="RED">RED</option><option value="BLUE">BLUE</option>
            </Select>
            <Select aria-label="目标类型" value={objectiveType} onChange={(event) => setObjectiveType(event.target.value as typeof objectiveType)}>
              <option value="destroy">摧毁</option><option value="disable">失能</option><option value="preserve">保全</option><option value="observe">发现</option><option value="withdraw">撤出</option><option value="control_area">区域夺控</option>
            </Select>
          </div>
          {objectiveType === 'control_area' ? (
            <div className="grid grid-cols-2 gap-1 max-h-24 overflow-y-auto">
              {referencePoints.filter((point) => point.side === objectiveSide).map((point) => (
                <label key={point.id} className="flex gap-1.5 items-center">
                  <input
                    type="checkbox"
                    checked={objectiveReferenceIds.includes(point.id)}
                    onChange={(event) => setObjectiveReferenceIds((current) => event.target.checked
                      ? [...current, point.id]
                      : current.filter((id) => id !== point.id))}
                    className="accent-emerald-400"
                  />
                  <span>{point.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <Select aria-label="目标单位" value={objectiveUnitId} onChange={(event) => setObjectiveUnitId(event.target.value)}>
              <option value="">选择目标单位</option>
              {Object.values(units).map((unit) => <option key={unit.id} value={unit.id}>{unit.side} · {unit.callsign}</option>)}
            </Select>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!objectiveTitle.trim() || (objectiveType === 'control_area' ? objectiveReferenceIds.length < 3 : !objectiveUnitId)}
            onClick={() => {
              if (objectiveType === 'control_area') {
                const polygon = objectiveReferenceIds
                  .map((id) => referencePoints.find((point) => point.id === id)?.position)
                  .filter((pos): pos is [number, number] => !!pos);
                upsertObjective({
                  title: objectiveTitle, side: objectiveSide, type: 'control_area', unitIds: [],
                  areaPolygon: polygon, controlDomains: ['land', 'surface'], required: true, points: 200,
                });
              } else {
                upsertObjective({
                  title: objectiveTitle, side: objectiveSide, type: objectiveType, unitIds: [objectiveUnitId],
                  required: true, points: 100, preserveCapability: objectiveType === 'preserve',
                });
              }
            }}
          >添加主要目标</Button>
        </section>

        <section className="md:col-span-2 p-3.5 rounded-lg bg-muted/35 border border-border space-y-3">
          <h3 className="text-primary font-semibold">区域触发事件</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Input aria-label="区域事件名称" value={areaEventName} onChange={(event) => setAreaEventName(event.target.value)} />
              <Textarea aria-label="区域事件消息" value={areaEventMessage} onChange={(event) => setAreaEventMessage(event.target.value)} />
              <Select aria-label="区域事件阵营" value={areaEventSide} onChange={(event) => { setAreaEventSide(event.target.value as SideId); setAreaEventReferenceIds([]); }}>
                <option value="RED">RED</option><option value="BLUE">BLUE</option>
              </Select>
              <div className="grid grid-cols-2 gap-1.5">
                {referencePoints.filter((point) => point.side === areaEventSide).map((point) => <label key={point.id} className="flex gap-1.5 items-center">
                  <input type="checkbox" aria-label={`事件参考点 ${point.name}`} checked={areaEventReferenceIds.includes(point.id)}
                    onChange={(event) => setAreaEventReferenceIds((current) => event.target.checked ? [...current, point.id] : current.filter((id) => id !== point.id))}
                    className="accent-emerald-400" />
                  <span>{point.name}</span>
                </label>)}
              </div>
              <Button size="sm" variant="outline" disabled={areaEventReferenceIds.length < 3} onClick={() => createAreaEventFromReferencePoints({
                name: areaEventName, side: areaEventSide, referencePointIds: areaEventReferenceIds, message: areaEventMessage,
              })}>创建区域事件</Button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1.5">
              {events.map((event) => <div key={event.id} className="flex justify-between items-center gap-2 p-2 bg-background/60 border border-border/60 rounded-md">
                <span>{event.name} · {event.trigger.type}</span>
                <button aria-label={`删除事件 ${event.name}`} onClick={() => deleteScenarioEvent(event.id)} className="text-rose-300 hover:text-rose-200 cursor-pointer">删除</button>
              </div>)}
            </div>
          </div>
        </section>
      </div>
    </ModalShell>
  );
};
