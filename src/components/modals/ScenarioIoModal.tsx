import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Download, FileJson, HardDrive, Play, Trash2, Upload } from 'lucide-react';
import {
  exportCurrentStateAsScenarioJson,
  validateAndParseScenarioJson,
} from '../../scenarios/builtinScenarios';
import {
  BATTLE_RECORDING_VERSION,
  BATTLE_SAVE_VERSION,
  EXERCISE_RECORDING_VERSION,
  MAX_BATTLE_SAVE_SLOTS,
  captureBattleRecording,
  captureBattleSave,
  deleteBattleSaveSlot,
  isBattleRecordingVersion,
  listBattleSaveSlots,
  loadBattleFromSlot,
  replayBattleRecording,
  restoreBattleSave,
  saveBattleToSlot,
  type BattleRecording,
  type SavedBattleSlot,
} from '../../store/battleRecording';
import { MAX_RECORDING_BYTES } from '../../store/replayKeyframes';
import { useWargameStore } from '../../store/useWargameStore';
import { Button } from '../ui/button';
import { ModalFooter, ModalHeader, ModalShell } from '../ui/dialog';
import { Input } from '../ui/input';
import { Slider } from '../ui/slider';
import { Textarea } from '../ui/textarea';

const EXIT_REPLAY_HINT = '请先退出回放';

// Header detection for the editor only. Replay validates the whole recording.
function isRecordingCandidate(value: unknown): value is BattleRecording {
  if (!value || typeof value !== 'object') return false;
  const { version, untilTick, commands } = value as Partial<BattleRecording>;
  return isBattleRecordingVersion(version) && typeof untilTick === 'number' && Number.isSafeInteger(untilTick) &&
    untilTick >= 0 && untilTick <= 200_000 && Array.isArray(commands);
}

function recordingUntilTick(jsonText: string): number | undefined {
  try {
    const value: unknown = JSON.parse(jsonText);
    return isRecordingCandidate(value) ? value.untilTick : undefined;
  } catch { return undefined; }
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
  const replayOpen = useWargameStore((s) => s.replayPlayer !== null);
  const liveOnly = { disabled: replayOpen, title: replayOpen ? EXIT_REPLAY_HINT : undefined };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [jsonText, setJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [replayTick, setReplayTick] = useState(0);
  const [fileRecording, setFileRecording] = useState<{ value: BattleRecording; label: string } | null>(null);
  const [customSeedInput, setCustomSeedInput] = useState(String(seed));
  const [randomizeSpawns, setRandomizeSpawns] = useState(false);
  const [saveSlots, setSaveSlots] = useState<SavedBattleSlot[]>(() => listBattleSaveSlots());
  const [slotNameInput, setSlotNameInput] = useState('');

  const showScenarioPreview = !jsonText && !fileRecording;
  const preview = useMemo(() => {
    if (!showScenarioPreview) return null;
    try {
      return { json: exportCurrentStateAsScenarioJson(currentScenario, units, {
        groups, missions, events, objectives, referencePoints, environment,
      }) };
    } catch (error) {
      return { error: `无法导出可重新开局的想定：${error instanceof Error ? error.message : '想定校验失败'}` };
    }
  }, [showScenarioPreview, currentScenario, units, groups, missions, events, objectives, referencePoints, environment]);
  const displayedJson = fileRecording ? '' : jsonText || preview?.json || '';
  const replayUntilTick = fileRecording?.value.untilTick ?? (jsonText ? recordingUntilTick(jsonText) : undefined);
  const readRecording = () => fileRecording?.value ?? JSON.parse(displayedJson);
  const selectedReplayTick = replayUntilTick === undefined ? 0 : Math.min(replayTick, replayUntilTick);

  const transferJson = (): { json: string; suffix: string } => {
    if (fileRecording) return { json: JSON.stringify(fileRecording.value), suffix: '.recording.json' };
    if (preview?.json) return { json: preview.json, suffix: '_export.json' };
    if (!displayedJson.trim()) throw new Error(preview?.error ?? '没有可导出的 JSON');
    const parsed = JSON.parse(displayedJson);
    if (parsed?.kind === 'aegis_battle_save') return { json: displayedJson, suffix: '.save.json' };
    if (isRecordingCandidate(parsed)) return { json: displayedJson, suffix: '.recording.json' };
    const result = validateAndParseScenarioJson(displayedJson);
    if (!result.valid) throw new Error(result.error ?? '想定校验失败');
    return { json: displayedJson, suffix: '_export.json' };
  };

  const downloadJsonFile = () => {
    if (typeof document === 'undefined') return;
    try {
      const { json, suffix } = transferJson();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${currentScenario.id}${suffix}`;
      link.click();
      URL.revokeObjectURL(url);
      setJsonError(null);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : '无法下载 JSON');
    }
  };

  const copyJson = async () => {
    try {
      const { json } = transferJson();
      if (!navigator.clipboard) throw new Error('无法访问剪贴板，请改用文件下载');
      await navigator.clipboard.writeText(json);
      setJsonError(null);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      setCopySuccess(false);
      setJsonError(error instanceof Error ? error.message : '无法复制 JSON');
    }
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

  const downloadRecording = async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    const recording = captureBattleRecording();
    const url = URL.createObjectURL(new Blob([JSON.stringify(recording)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${recording.scenario.id}.recording.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_RECORDING_BYTES) {
        setJsonError('文件超过 32 MiB；请使用当前版本重新导出紧凑录像。');
        return;
      }
      const content = await file.text();
      const parsed = JSON.parse(content);
      if (isRecordingCandidate(parsed)) {
        setFileRecording({ value: parsed, label: file.name });
        setReplayTick(parsed.untilTick);
      } else {
        setFileRecording(null);
        setJsonText(content);
      }
      setJsonError(null);
    } catch {
      setJsonError('读取本地 JSON 文件失败');
    }
  };

  const applyCustomSeedRestart = () => {
    if (useWargameStore.getState().replayPlayer) return;
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
        title="想定管理"
        subtitle="保存进度、载入想定或播放录像"
        onClose={() => setActiveModal('none')}
      />

      <div className="p-4 space-y-3 text-xs overflow-y-auto flex-1">
        <div className="p-3 rounded-lg bg-muted/40 border border-border space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-primary flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" />
              <span>本地存档</span>
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{saveSlots.length} / {MAX_BATTLE_SAVE_SLOTS}</span>
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
                      {...liveOnly}
                      onClick={() => {
                        if (useWargameStore.getState().replayPlayer) return;
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

        <div className="flex flex-wrap items-baseline justify-between gap-1 border-t border-border pt-3">
          <label htmlFor="scenario-json" className="font-semibold text-foreground">想定、存档与录像 JSON</label>
          <span className="text-[11px] text-muted-foreground">可直接编辑，也可从文件导入</span>
        </div>

        <Textarea
          id="scenario-json"
          aria-label="想定或重放 JSON"
          value={displayedJson}
          onChange={(e) => {
            setFileRecording(null);
            setJsonText(e.target.value);
            const untilTick = recordingUntilTick(e.target.value);
            if (untilTick !== undefined) setReplayTick(untilTick);
            setJsonError(null);
          }}
          rows={9}
          className="min-h-28 resize-y font-mono text-[11px] text-cyan-100"
        />

        <div className="flex flex-wrap gap-2 items-center">
          <Button size="sm" variant="outline" onClick={() => {
            const recording = captureBattleRecording();
            const json = JSON.stringify(recording);
            if (json.length > 256_000) setFileRecording({ value: recording, label: '当前战局的指令录像' });
            else { setFileRecording(null); setJsonText(json); }
            setReplayTick(recording.untilTick);
            setJsonError(null);
          }}>生成指令重放 JSON</Button>
          <Button size="sm" variant="outline" onClick={() => { void downloadRecording(); }}>下载指令录像</Button>
          <Button size="sm" variant="outline" {...liveOnly} onClick={() => {
            if (useWargameStore.getState().replayPlayer) return;
            try { replayBattleRecording(readRecording(), 60); setActiveModal('none'); }
            catch (error) { setJsonError(error instanceof Error ? error.message : '重放失败'); }
          }}>加载重放到记录末尾</Button>
          <Button size="sm" variant="outline" onClick={() => {
            const save = captureBattleSave();
            setFileRecording(null);
            setJsonText(JSON.stringify(save, null, 2));
            setJsonError(null);
          }}>生成断点存档 JSON</Button>
          <Button size="sm" variant="outline" {...liveOnly} onClick={() => {
            if (useWargameStore.getState().replayPlayer) return;
            try { restoreBattleSave(JSON.parse(displayedJson)); setActiveModal('none'); }
            catch (error) { setJsonError(error instanceof Error ? error.message : '断点恢复失败'); }
          }}>恢复断点存档</Button>
          <span className="text-[11px] text-muted-foreground">支持 Recording v{BATTLE_RECORDING_VERSION}/v{EXERCISE_RECORDING_VERSION}（含关键帧快照加速）与断点存档 v1–v{BATTLE_SAVE_VERSION}；版本不符或校验失败不会替换当前战局。</span>
        </div>

        {replayUntilTick !== undefined && (
          <div className="p-3 rounded-lg bg-muted/35 border border-cyan-500/30 space-y-2">
            <div className="flex items-center justify-between text-primary font-semibold">
              <span>REPLAY TIMELINE</span>
              <span className="font-mono">Tick {selectedReplayTick} / {replayUntilTick}</span>
            </div>
            {fileRecording && <p className="text-[11px] text-muted-foreground">{fileRecording.label} 已加载，可回放或跳转，不在编辑框展开。</p>}
            <Slider
              aria-label="回放时间轴"
              min={0}
              max={replayUntilTick}
              value={selectedReplayTick}
              onChange={(event) => setReplayTick(Number(event.target.value))}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" {...liveOnly} onClick={() => {
                if (useWargameStore.getState().replayPlayer) return;
                try { replayBattleRecording(readRecording(), 60, selectedReplayTick); setActiveModal('none'); }
                catch (error) { setJsonError(error instanceof Error ? error.message : '重放失败'); }
              }}>
                跳转至 Tick {selectedReplayTick}
              </Button>
              <Button
                size="sm"
                variant="warning"
                onClick={() => {
                  try {
                    startReplayPlayer(readRecording(), selectedReplayTick);
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
          <Button size="sm" variant="tactical" {...liveOnly} onClick={applyCustomSeedRestart}>
            按此种子重新开局
          </Button>
        </div>

        {(jsonError || preview?.error) && (
          <div role="alert" className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/50 text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{jsonError || preview?.error}</span>
          </div>
        )}
      </div>

      <ModalFooter className="justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!displayedJson && !fileRecording}
            onClick={() => { void copyJson(); }}
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
          <Button size="sm" variant="outline" disabled={!displayedJson && !fileRecording} onClick={downloadJsonFile} className="text-cyan-300">
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
            {...liveOnly}
            onClick={() => {
              if (useWargameStore.getState().replayPlayer) return;
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
