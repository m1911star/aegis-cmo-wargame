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
  const utc = new Date(simTime).toISOString().slice(11, 19);

  return (
    <section
      aria-label="地图航迹回放播放器"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-[min(92%,560px)] rounded-xl border border-amber-500/40 bg-card/95 backdrop-blur-xl px-3.5 py-2.5 text-xs shadow-2xl space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-amber-300 font-semibold">
          <span>REPLAY // 地图航迹回放</span>
          <span className="text-muted-foreground font-mono font-normal">
            Tick {currentTick}/{currentRecording.untilTick} · {utc}
          </span>
        </div>
        <button
          onClick={exitReplayPlayer}
          className="px-2 py-1 rounded-md bg-secondary hover:bg-accent text-foreground border border-border flex items-center gap-1 cursor-pointer transition-colors"
        >
          <X className="w-3 h-3" />
          <span>退出回放</span>
        </button>
      </div>

      <Slider
        aria-label="回放播放器时间轴"
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

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setReplayPlayerPlaying(!isPlaying)}
            className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? '暂停回放' : '播放回放'}</span>
          </button>
          <button
            onClick={() => seekReplayPlayer(Math.min(currentRecording.untilTick, currentTick + 20))}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
            title="步进 +20 Tick (5秒)"
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
