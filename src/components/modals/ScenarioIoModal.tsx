import React, { useRef, useState } from 'react';
import { AlertCircle, Check, Download, FileJson, HardDrive, Play, Trash2, Upload } from 'lucide-react';
import {
  exportCurrentStateAsScenarioJson,
  validateAndParseScenarioJson,
} from '../../scenarios/builtinScenarios';
import {
  BATTLE_RECORDING_VERSION,
  BATTLE_SAVE_VERSION,
  MAX_BATTLE_SAVE_SLOTS,
  captureBattleRecording,
  captureBattleSave,
  deleteBattleSaveSlot,
  listBattleSaveSlots,
  loadBattleFromSlot,
  replayBattleRecording,
  restoreBattleSave,
  saveBattleToSlot,
  type SavedBattleSlot,
} from '../../store/battleRecording';
import { useWargameStore } from '../../store/useWargameStore';
import { Button } from '../ui/button';
import { ModalFooter, ModalHeader, ModalShell } from '../ui/dialog';
import { Input } from '../ui/input';
import { Slider } from '../ui/slider';
import { Textarea } from '../ui/textarea';

function recordingUntilTick(jsonText: string): number | undefined {
  try {
    const value = JSON.parse(jsonText) as { version?: unknown; untilTick?: unknown };
    return value.version === BATTLE_RECORDING_VERSION && Number.isSafeInteger(value.untilTick) && (value.untilTick as number) >= 0
      ? value.untilTick as number : undefined;
  } catch {
    return undefined;
  }
}

export const ScenarioIoModal: React.FC = () => {
  const setActiveModal = useWargameStore((s) => s.setActiveModal);
  const currentScenario = useWargameStore((s) => s.currentScenario);
  const seed = useWargameStore((s) => s.seed);
  const units = useWargameStore((s) => s.units);
  const groups = useWargameStore((s) => s.groups);
  const missions = useWargameStore((s) => s.missions);
  const events = useWargameStore((s) => s.events);
  const objectives = useWargameStore((s) => s.objectives);
  const referencePoints = useWargameStore((s) => s.referencePoints);
  const environment = useWargameStore((s) => s.environment);
  const loadScenario = useWargameStore((s) => s.loadScenario);
  const startReplayPlayer = useWargameStore((s) => s.startReplayPlayer);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [jsonText, setJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [replayTick, setReplayTick] = useState(0);
  const [customSeedInput, setCustomSeedInput] = useState(String(seed));
  const [randomizeSpawns, setRandomizeSpawns] = useState(false);
  const [saveSlots, setSaveSlots] = useState<SavedBattleSlot[]>(() => listBattleSaveSlots());
  const [slotNameInput, setSlotNameInput] = useState('');

  const displayedJson = jsonText || exportCurrentStateAsScenarioJson(currentScenario, units, {
    groups, missions, events, objectives, referencePoints, environment,
  });
  const replayUntilTick = recordingUntilTick(displayedJson);
  const selectedReplayTick = replayUntilTick === undefined ? 0 : Math.min(replayTick, replayUntilTick);

  const downloadJsonFile = () => {
    if (typeof document === 'undefined') return;
    const blob = new Blob([displayedJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const isBattleSave = displayedJson.includes('"aegis_battle_save"');
    link.download = isBattleSave ? `${currentScenario.id}.save.json` : `${currentScenario.id}_export.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadSaveSlotFile = (slot: SavedBattleSlot) => {
    if (typeof document === 'undefined') return;
    const blob = new Blob([JSON.stringify(slot.save, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slot.scenarioId}_${slot.slotId}.save.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setJsonText(content);
      const untilTick = recordingUntilTick(content);
      if (untilTick !== undefined) setReplayTick(untilTick);
      setJsonError(null);
    } catch {
      setJsonError('读取本地 JSON 文件失败');
    }
  };

  const applyCustomSeedRestart = () => {
    const parsedSeed = Number(customSeedInput);
    if (!Number.isSafeInteger(parsedSeed) || parsedSeed < 0 || parsedSeed > 0xffffffff) {
      setJsonError('种子必须为 0 ~ 4294967295 之间的整数');
      return;
    }
    loadScenario(currentScenario, randomizeSpawns, parsedSeed);
    setActiveModal('none');
  };

  return (
    <ModalShell className="max-w-3xl max-h-[90dvh] flex flex-col">
      <ModalHeader
        icon={<FileJson className="w-4 h-4" />}
        title="SCENARIO SCHEMA SERIALIZER // 想定 JSON 导出、编辑与热加载"
        onClose={() => setActiveModal('none')}
      />

      <div className="p-4 space-y-3 text-xs overflow-y-auto flex-1">
        <div className="p-3 rounded-lg bg-muted/40 border border-border space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-primary flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" />
              <span>本地多槽位断点存档库 ({saveSlots.length}/{MAX_BATTLE_SAVE_SLOTS})</span>
            </span>
            <span className="text-[11px] text-muted-foreground">摘要防篡改校验 · 精确恢复实时交战状态</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="存档槽备注名称"
              placeholder="输入存档名称（留空自动生成想定+推进时长）"
              value={slotNameInput}
              onChange={(e) => setSlotNameInput(e.target.value)}
              className="flex-1 min-w-[200px] h-7 text-[11px]"
            />
            <Button
              size="sm"
              variant="success"
              onClick={() => {
                try {
                  saveBattleToSlot(slotNameInput);
                  setSaveSlots(listBattleSaveSlots());
                  setSlotNameInput('');
                  setJsonError(null);
                } catch (error) {
                  setJsonError(error instanceof Error ? error.message : '保存存档槽失败');
                }
              }}
            >
              新建断点存档槽
            </Button>
          </div>
          {saveSlots.length === 0 ? (
            <div className="text-[11px] text-muted-foreground py-1">
              暂无手动存档槽位。点击「新建断点存档槽」可随时保存当前推演进度。
            </div>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {saveSlots.map((slot) => (
                <div
                  key={slot.slotId}
                  className="p-2 rounded-md bg-card/85 border border-border flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground truncate">{slot.label}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      席位:{slot.playerSide} · Tick {slot.tick} ({Math.floor(slot.elapsedSec / 60)}m{slot.elapsedSec % 60}s) ·{' '}
                      {slot.savedAtIso.slice(0, 19).replace('T', ' ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() => {
                        try {
                          loadBattleFromSlot(slot.slotId);
                          setActiveModal('none');
                        } catch (error) {
                          setJsonError(error instanceof Error ? error.message : '读档失败');
                        }
                      }}
                    >
                      读档
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        try {
                          saveBattleToSlot(slot.label, slot.slotId);
                          setSaveSlots(listBattleSaveSlots());
                          setJsonError(null);
                        } catch (error) {
                          setJsonError(error instanceof Error ? error.message : '覆盖存档失败');
                        }
                      }}
                    >
                      覆盖
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => downloadSaveSlotFile(slot)}
                      title="导出独立 .save.json 文件"
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-rose-300 hover:text-rose-200"
                      onClick={() => {
                        setSaveSlots(deleteBattleSaveSlot(slot.slotId));
                      }}
                      title="删除该存档槽"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-muted-foreground">
          当前战场实时态势已序列化为标准 <code>ScenarioDefinition</code> JSON。你可以直接修改算子坐标、添加自定义{' '}
          <code>customCatalogOverlay</code> 武器参数，或保存为外部剧本文件。
        </p>

        <Textarea
          aria-label="想定或重放 JSON"
          value={displayedJson}
          onChange={(e) => {
            setJsonText(e.target.value);
            const untilTick = recordingUntilTick(e.target.value);
            if (untilTick !== undefined) setReplayTick(untilTick);
            setJsonError(null);
          }}
          rows={15}
          className="font-mono text-[11px] text-cyan-200"
        />

        <div className="flex flex-wrap gap-2 items-center">
          <Button size="sm" variant="outline" onClick={() => {
            const recording = captureBattleRecording();
            setJsonText(JSON.stringify(recording, null, 2));
            setReplayTick(recording.untilTick);
            setJsonError(null);
          }}>生成指令重放 JSON</Button>
          <Button size="sm" variant="outline" onClick={() => {
            try { replayBattleRecording(JSON.parse(displayedJson), 60); setActiveModal('none'); }
            catch (error) { setJsonError(error instanceof Error ? error.message : '重放失败'); }
          }}>加载重放到记录末尾</Button>
          <Button size="sm" variant="outline" onClick={() => {
            const save = captureBattleSave();
            setJsonText(JSON.stringify(save, null, 2));
            setJsonError(null);
          }}>生成断点存档 JSON</Button>
          <Button size="sm" variant="outline" onClick={() => {
            try { restoreBattleSave(JSON.parse(displayedJson)); setActiveModal('none'); }
            catch (error) { setJsonError(error instanceof Error ? error.message : '断点恢复失败'); }
          }}>恢复断点存档</Button>
          <span className="text-[11px] text-muted-foreground">支持 Recording v{BATTLE_RECORDING_VERSION}（含关键帧快照加速）与断点存档 v{BATTLE_SAVE_VERSION}；版本不符或校验失败自动回滚。</span>
        </div>

        {replayUntilTick !== undefined && (
          <div className="p-3 rounded-lg bg-muted/35 border border-cyan-500/30 space-y-2">
            <div className="flex items-center justify-between text-primary font-semibold">
              <span>REPLAY TIMELINE</span>
              <span className="font-mono">Tick {selectedReplayTick} / {replayUntilTick}</span>
            </div>
            <Slider
              aria-label="回放时间轴"
              min={0}
              max={replayUntilTick}
              value={selectedReplayTick}
              onChange={(event) => setReplayTick(Number(event.target.value))}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => {
                try { replayBattleRecording(JSON.parse(displayedJson), 60, selectedReplayTick); setActiveModal('none'); }
                catch (error) { setJsonError(error instanceof Error ? error.message : '重放失败'); }
              }}>
                跳转至 Tick {selectedReplayTick}
              </Button>
              <Button
                size="sm"
                variant="warning"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(displayedJson);
                    startReplayPlayer(parsed, selectedReplayTick);
                  } catch (error) {
                    setJsonError(error instanceof Error ? error.message : '启动地图回放失败');
                  }
                }}
              >
                <Play className="w-3.5 h-3.5" />
                <span>启动地图航迹回放播放器</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">拖动只改变预览 Tick；支持直接跳转到指定 Tick，或启动顶部地图播放器按倍速连续回放。</p>
          </div>
        )}

        <div className="p-3 rounded-lg bg-muted/35 border border-border flex flex-wrap items-center gap-2.5">
          <span className="text-primary font-semibold">开局种子与随机散布:</span>
          <Input
            aria-label="自定义随机种子"
            type="number"
            min={0}
            max={4294967295}
            value={customSeedInput}
            onChange={(e) => setCustomSeedInput(e.target.value)}
            className="w-32 h-7 font-mono"
          />
          <label className="flex items-center gap-1.5 text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={randomizeSpawns}
              onChange={(e) => setRandomizeSpawns(e.target.checked)}
              className="accent-cyan-400"
            />
            <span>启用开局位置随机散布</span>
          </label>
          <Button size="sm" variant="tactical" onClick={applyCustomSeedRestart}>
            按此种子重新开局
          </Button>
        </div>

        {jsonError && (
          <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/50 text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{jsonError}</span>
          </div>
        )}
      </div>

      <ModalFooter className="justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard?.writeText(displayedJson);
              setCopySuccess(true);
              setTimeout(() => setCopySuccess(false), 2000);
            }}
            className="text-cyan-300"
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
          </Button>
          <Button size="sm" variant="outline" onClick={downloadJsonFile} className="text-cyan-300">
            <Download className="w-3.5 h-3.5" />
            <span>下载文件</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" />
            <span>从文件导入</span>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setActiveModal('none')}>
            关闭
          </Button>
          <Button
            size="sm"
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
          >
            <Upload className="w-3.5 h-3.5" />
            <span>校验并热加载此想定</span>
          </Button>
        </div>
      </ModalFooter>
    </ModalShell>
  );
};
