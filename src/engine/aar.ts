import type {
  AarEventKind,
  BattleAarLedger,
  CombatLogEntry,
  RuntimeUnit,
  SideId,
} from '../types/wargame';

export const createAarLedger = (): BattleAarLedger => ({ events: [], tracks: [] });

const knownEventCache = new WeakMap<BattleAarLedger, Set<string>>();

function getKnownEventIds(ledger: BattleAarLedger): Set<string> {
  let known = knownEventCache.get(ledger);
  if (!known) {
    known = new Set(ledger.events.map((event) => event.id));
    knownEventCache.set(ledger, known);
  }
  return known;
}

function eventKind(log: CombatLogEntry): AarEventKind | undefined {
  if (log.aarType) return log.aarType;
  if (log.category === 'LAUNCH') return 'launch';
  if (log.category === 'HIT') return 'hit';
  if (log.category === 'INTERCEPT') return 'intercept';
  if (log.category === 'DESTROYED') return 'loss';
  return undefined;
}

export function recordAarTick(
  ledger: BattleAarLedger,
  tick: number,
  simTime: number,
  units: Record<string, RuntimeUnit>,
  logs: CombatLogEntry[],
  forceTrack = false,
  recordTracks = true
): void {
  if (logs.some(eventKind)) {
    const knownEventIds = getKnownEventIds(ledger);
    for (const log of logs) {
      const kind = eventKind(log);
      if (!kind || knownEventIds.has(log.id)) continue;
      knownEventIds.add(log.id);
      ledger.events.push({
        id: log.id,
        tick,
        simTime: log.simTime,
        side: log.aarSide ?? log.side,
        kind,
        title: log.title,
        unitId: log.unitId,
        targetUnitId: log.targetUnitId,
        weaponId: log.weaponId,
        quantity: log.quantity ?? 1,
        shooterId: log.aarShooterId,
        outcome: log.aarOutcome,
      });
    }
    if (ledger.events.length > 50_000) {
      const removed = ledger.events.splice(0, ledger.events.length - 50_000);
      for (const entry of removed) knownEventIds.delete(entry.id);
    }
  }

  if (recordTracks && (forceTrack || tick % 20 === 0)) {
    for (const unit of Object.values(units).sort((a, b) => a.id.localeCompare(b.id))) {
      ledger.tracks.push({
        tick,
        simTime,
        unitId: unit.id,
        side: unit.side,
        position: [...unit.position],
        altitudeM: unit.altitudeM,
        status: unit.status,
      });
    }
    if (ledger.tracks.length > 100_000) ledger.tracks.splice(0, ledger.tracks.length - 100_000);
  }
}

export function summarizeAar(ledger: BattleAarLedger) {
  const summarizeSide = (side: SideId) => {
    const events = ledger.events.filter((event) => event.side === side);
    const launches = events.filter((event) => event.kind === 'launch')
      .reduce((sum, event) => sum + event.quantity, 0);
    const hits = events.filter((event) => event.kind === 'hit').length;
    return {
      launches,
      hits,
      interceptions: events.filter((event) => event.kind === 'intercept').length,
      losses: events.filter((event) => event.kind === 'loss').length,
      sorties: events.filter((event) => event.kind === 'sortie').length,
      recoveries: events.filter((event) => event.kind === 'recovery').length,
      hitRate: launches > 0 ? hits / launches : 0,
    };
  };
  const weaponUsage = new Map<string, number>();
  for (const event of ledger.events) {
    if (event.kind !== 'launch' || !event.weaponId) continue;
    weaponUsage.set(event.weaponId, (weaponUsage.get(event.weaponId) ?? 0) + event.quantity);
  }
  return {
    RED: summarizeSide('RED'),
    BLUE: summarizeSide('BLUE'),
    weaponUsage: [...weaponUsage.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    trackedUnits: new Set(ledger.tracks.map((sample) => sample.unitId)).size,
    trackSamples: ledger.tracks.length,
  };
}
