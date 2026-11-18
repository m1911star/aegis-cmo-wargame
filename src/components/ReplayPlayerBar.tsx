import React, { useEffect, useRef } from 'react';
import { FIXED_DT_SEC } from '../engine/determinism';
import { FastForward, Pause, Play, StepForward, X } from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import { Slider } from './ui/slider';

export const ReplayPlayerBar: React.FC = () => {
  const replayPlayer = useWargameStore((s) => s.replayPlayer);
  const simTime = useWargameStore((s) => s.simTime);
  const setReplayPlayerPlaying = useWargameStore((s) => s.setReplayPlayerPlaying);
  const setReplayPlayerSpeed = useWargameStore((s) => s.setReplayPlayerSpeed);
  const seekReplayPlayer = useWargameStore((s) => s.seekReplayPlayer);
  const exitReplayPlayer = useWargameStore((s) => s.exitReplayPlayer);
  const recording = replayPlayer?.recording;
  const budgetMs = useRef(0);
  const seekFrame = useRef<number | null>(null);

  useEffect(() => {
    budgetMs.current = 0;
    return () => { if (seekFrame.current !== null) cancelAnimationFrame(seekFrame.current); };
  }, [recording]);

  useEffect(() => {
    if (!recording || !replayPlayer?.isPlaying) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const store = useWargameStore.getState();
      const current = store.replayPlayer;
      if (!current?.isPlaying || current.recording !== recording) return;
      const now = performance.now();
      budgetMs.current += (now - last) * current.speed;
      last = now;
      const tickMs = FIXED_DT_SEC * 1000;
      const stepTicks = Math.min(60, Math.floor(budgetMs.current / tickMs));
      if (stepTicks === 0) return;
      budgetMs.current -= stepTicks * tickMs;
      store.seekReplayPlayer(Math.min(recording.untilTick, current.currentTick + stepTicks));
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording, replayPlayer?.isPlaying, replayPlayer?.speed]);

  if (!replayPlayer) return null;

  const { recording: currentRecording, currentTick, isPlaying, speed } = replayPlayer;
  const atEnd = currentTick >= currentRecording.untilTick;
  const utc = new Date(simTime).toISOString().slice(11, 19);
  const restart = () => {
    budgetMs.current = 0;
    seekReplayPlayer(0);
    if (useWargameStore.getState().replayPlayer?.currentTick === 0) setReplayPlayerPlaying(true);
  };

  return (
    <section
      aria-label="地图航迹回放播放器"
      className="replay-strip"
    >
      <div className="replay-heading">
        <div className="min-w-0">
          <p className="replay-title">航迹回放 <span className="replay-state">{isPlaying ? '播放中' : atEnd ? '已到末尾' : '已暂停'}</span></p>
          <p className="replay-time">{utc} UTC <span>·</span> Tick {currentTick}/{currentRecording.untilTick}</p>
        </div>
        <button
          type="button"
          onClick={exitReplayPlayer}
          title="退出回放，返回暂停的原局"
          className="toolbar-button replay-exit"
        >
          <X className="w-3 h-3" />
          <span>退出回放</span>
        </button>
      </div>

      <Slider
        aria-label="回放播放器时间轴"
        aria-valuetext={`第 ${currentTick} 步，共 ${currentRecording.untilTick} 步`}
        min={0}
        max={currentRecording.untilTick}
        value={currentTick}
        onChange={(e) => {
          const target = Number(e.target.value);
          budgetMs.current = 0;
          setReplayPlayerPlaying(false);
          if (seekFrame.current !== null) cancelAnimationFrame(seekFrame.current);
          seekFrame.current = requestAnimationFrame(() => {
            seekFrame.current = null;
            seekReplayPlayer(target);
          });
        }}
        rangeClassName="bg-amber-400"
      />

      <div className="replay-transport">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={currentRecording.untilTick === 0}
            onClick={atEnd ? restart : () => setReplayPlayerPlaying(!isPlaying)}
            className="toolbar-button replay-action"
          >
            {isPlaying ? <Pause /> : <Play />}
            <span>{isPlaying ? '暂停回放' : atEnd ? '重新播放' : '播放回放'}</span>
          </button>
          <button
            type="button"
            onClick={() => seekReplayPlayer(Math.min(currentRecording.untilTick, currentTick + 20))}
            disabled={atEnd}
            className="toolbar-button"
            title="向前跳过 5 秒"
          >
            <StepForward className="w-3.5 h-3.5" />
            <span>+5s</span>
          </button>
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="回放倍速">
          <FastForward className="w-3.5 h-3.5 text-slate-400 mr-1" />
          {([1, 5, 15] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setReplayPlayerSpeed(s)}
              aria-pressed={speed === s}
              className={`px-2 py-0.5 rounded cursor-pointer ${
                speed === s ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-slate-900 text-slate-400'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
