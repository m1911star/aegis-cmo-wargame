import React, { useState } from 'react';
import { AlertCircle, Check, Download, FileJson, Upload, X } from 'lucide-react';
import {
  exportCurrentStateAsScenarioJson,
  validateAndParseScenarioJson,
} from '../../scenarios/builtinScenarios';
import {
  BATTLE_RECORDING_VERSION,
  BATTLE_SAVE_VERSION,
  captureBattleRecording,
  captureBattleSave,
  replayBattleRecording,
  restoreBattleSave,
} from '../../store/battleRecording';
import { useWargameStore } from '../../store/useWargameStore';

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
  const units = useWargameStore((s) => s.units);
  const groups = useWargameStore((s) => s.groups);
  const missions = useWargameStore((s) => s.missions);
  const events = useWargameStore((s) => s.events);
  const objectives = useWargameStore((s) => s.objectives);
  const referencePoints = useWargameStore((s) => s.referencePoints);
  const environment = useWargameStore((s) => s.environment);
  const loadScenario = useWargameStore((s) => s.loadScenario);

  const [jsonText, setJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [replayTick, setReplayTick] = useState(0);

  const displayedJson = jsonText || exportCurrentStateAsScenarioJson(currentScenario, units, {
    groups, missions, events, objectives, referencePoints, environment,
  });
  const replayUntilTick = recordingUntilTick(displayedJson);
  const selectedReplayTick = replayUntilTick === undefined ? 0 : Math.min(replayTick, replayUntilTick);

  return (
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
          <button className="toolbar-button" onClick={() => {
            const save = captureBattleSave();
            setJsonText(JSON.stringify(save, null, 2));
            setJsonError(null);
          }}>生成断点存档 JSON</button>
          <button className="toolbar-button" onClick={() => {
            try { restoreBattleSave(JSON.parse(displayedJson)); setActiveModal('none'); }
            catch (error) { setJsonError(error instanceof Error ? error.message : '断点恢复失败'); }
          }}>恢复断点存档</button>
          <span className="text-slate-400">支持 Recording v{BATTLE_RECORDING_VERSION}（含关键帧快照加速）与断点存档 v{BATTLE_SAVE_VERSION}；版本不符或校验失败自动回滚。</span>
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
            <p className="text-slate-500">拖动只改变预览 Tick；点击跳转后优先从最近关键帧快照确定性重放，不追加用户命令。</p>
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
  );
};
