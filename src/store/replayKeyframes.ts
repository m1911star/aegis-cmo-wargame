import type { BattleAarLedger } from '../types/wargame';
import type { BattleSnapshot } from './battleRecording';

interface ArchiveWindow { offset: number; count: number }
export type CompactKeyframe = Omit<BattleSnapshot, 'aar'> & {
  history: { events: ArchiveWindow; tracks: ArchiveWindow };
};
export const MAX_RECORDING_BYTES = 32 * 1024 * 1024;
export const MAX_KEYFRAMES = 120;
const KEYFRAME_BYTES = 18 * 1024 * 1024;
const utf8 = new TextEncoder();

function archiveWriter<T>(key: (row: T) => string) {
  const data: T[] = [];
  const indices = new Map<string, number>();
  return {
    data,
    add(rows: readonly T[]): ArchiveWindow {
      if (!rows.length) return { offset: 0, count: 0 };
      let offset = indices.get(key(rows[0])) ?? data.length;
      for (let i = 0; i < rows.length && offset + i < data.length; i++) {
        if (key(rows[i]) !== key(data[offset + i])) {
          offset = data.length;
          break;
        }
      }
      for (let i = data.length - offset; i < rows.length; i++) {
        indices.set(key(rows[i]), data.length);
        data.push(rows[i]);
      }
      return { offset, count: rows.length };
    },
  };
}

export function appendReplayKeyframe(snapshots: readonly BattleSnapshot[], next: BattleSnapshot): BattleSnapshot[] {
  const frames = [...snapshots, next];
  if (frames.length <= MAX_KEYFRAMES) return frames;
  let nearest = 1;
  for (let i = 2; i < frames.length - 1; i++) {
    if (frames[i + 1].tick - frames[i - 1].tick < frames[nearest + 1].tick - frames[nearest - 1].tick) nearest = i;
  }
  frames.splice(nearest, 1);
  return frames;
}

export function compactReplayKeyframes(snapshots: readonly BattleSnapshot[]) {
  const events = archiveWriter<BattleAarLedger['events'][number]>((row) => row.id);
  const tracks = archiveWriter<BattleAarLedger['tracks'][number]>((row) => `${row.tick}:${row.unitId}`);
  let frames: CompactKeyframe[] = snapshots.map(({ aar, ...snapshot }) => ({
    ...snapshot,
    history: { events: events.add(aar.events), tracks: tracks.add(aar.tracks) },
  }));
  const sizes = new Map(frames.map((frame) => [frame, utf8.encode(JSON.stringify(frame)).byteLength]));
  let bytes = frames.reduce((sum, frame) => sum + sizes.get(frame)!, 0);
  while (bytes > KEYFRAME_BYTES && frames.length > 1) {
    const kept = frames.filter((_, i) => i % 2 === (frames.length - 1) % 2);
    frames = kept;
    bytes = frames.reduce((sum, frame) => sum + sizes.get(frame)!, 0);
  }
  return { snapshots: frames, history: { events: events.data, tracks: tracks.data } };
}

export function inflateReplayKeyframe(frame: BattleSnapshot | CompactKeyframe, history?: BattleAarLedger): BattleSnapshot {
  if ('aar' in frame) return structuredClone(frame);
  const { history: window, ...state } = frame;
  if (!history || !Array.isArray(history.events) || !Array.isArray(history.tracks)) throw new Error('Missing recording history');
  const read = <T>(range: ArchiveWindow, rows: T[]) => {
    if (!range || !Number.isSafeInteger(range.offset) || !Number.isSafeInteger(range.count) ||
        range.offset < 0 || range.count < 0 || range.offset + range.count > rows.length) {
      throw new Error('Invalid recording history range');
    }
    return rows.slice(range.offset, range.offset + range.count);
  };
  return structuredClone({ ...state, aar: { events: read(window?.events, history.events), tracks: read(window?.tracks, history.tracks) } });
}
