import React, { useEffect } from 'react';
import { FastForward, Pause, Play, StepForward, X } from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';

export const ReplayPlayerBar: React.FC = () => {
  const replayPlayer = useWargameStore((s) => s.replayPlayer);
  const simTime = useWargameStore((s) => s.simTime);
  const setReplayPlayerPlaying = useWargameStore((s) => s.setReplayPlayerPlaying);
  const setReplayPlayerSpeed = useWargameStore((s) => s.setReplayPlayerSpeed);
  const seekReplayPlayer = useWargameStore((s) => s.seekReplayPlayer);
  const exitReplayPlayer = useWargameStore((s) => s.exitReplayPlayer);

  useEffect(() => {
    if (!replayPlayer?.isPlaying) return;
    const timer = window.setInterval(() => {
      const current = useWargameStore.getState().replayPlayer;
      if (!current || !current.isPlaying) return;
      const stepTicks = current.speed * 4;
      const nextTick = Math.min(current.recording.untilTick, current.currentTick + stepTicks);
      useWargameStore.getState().seekReplayPlayer(nextTick);
    }, 250);
    return () => window.clearInterval(timer);
  }, [replayPlayer?.isPlaying, replayPlayer?.speed]);

  if (!replayPlayer) return null;

  const { recording, currentTick, isPlaying, speed } = replayPlayer;
  const utc = new Date(simTime).toISOString().slice(11, 19);

  return (
    <section
      aria-label="地图航迹回放播放器"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-[min(92%,560px)] rounded-lg border border-amber-400/60 bg-slate-950/92 backdrop-blur-md px-3 py-2 text-xs font-mono shadow-[0_0_30px_rgba(245,158,11,0.25)] space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-amber-300 font-bold">
          <span>REPLAY // 地图航迹回放</span>
          <span className="text-slate-300 font-normal">
            Tick {currentTick}/{recording.untilTick} · {utc}
          </span>
        </div>
        <button
          onClick={exitReplayPlayer}
          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
        >
          <X className="w-3 h-3" />
          <span>退出回放</span>
        </button>
      </div>

      <input
        aria-label="回放播放器时间轴"
        type="range"
        min={0}
        max={recording.untilTick}
        value={currentTick}
        onChange={(e) => seekReplayPlayer(Number(e.target.value))}
        className="w-full accent-amber-400 cursor-pointer"
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
            onClick={() => seekReplayPlayer(Math.min(recording.untilTick, currentTick + 20))}
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
