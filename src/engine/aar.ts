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

export interface SideSurvivalSummary {
  active: number;
  destroyed: number;
  total: number;
  survivalRate: number;
  attritionRate: number;
}

export interface WeaponExpenditureItem {
  weaponId: string;
  redCount: number;
  blueCount: number;
  totalCount: number;
}

export interface AarBreakdowns {
  forceSurvival: Record<'RED' | 'BLUE', SideSurvivalSummary>;
  ammunition: {
    redTotal: number;
    blueTotal: number;
    total: number;
    redWeapons: [string, number][];
    blueWeapons: [string, number][];
    topWeapons: WeaponExpenditureItem[];
  };
}

export function summarizeAarBreakdowns(
  ledger: BattleAarLedger,
  units: Record<string, RuntimeUnit>
): AarBreakdowns {
  const summarizeForce = (side: 'RED' | 'BLUE'): SideSurvivalSummary => {
    const sideUnits = Object.values(units).filter((unit) => unit.side === side);
    const destroyed = sideUnits.filter((unit) => unit.status === 'destroyed' || unit.hp <= 0).length;
    const total = sideUnits.length;
    const active = total - destroyed;
    return {
      active,
      destroyed,
      total,
      survivalRate: total > 0 ? active / total : 0,
      attritionRate: total > 0 ? destroyed / total : 0,
    };
  };

  let redTotal = 0;
  let blueTotal = 0;
  const redMap = new Map<string, number>();
  const blueMap = new Map<string, number>();
  const combinedMap = new Map<string, { redCount: number; blueCount: number }>();

  for (const event of ledger.events) {
    if (event.kind !== 'launch') continue;
    const qty = event.quantity ?? 1;
    if (event.side === 'RED') redTotal += qty;
    else if (event.side === 'BLUE') blueTotal += qty;

    if (!event.weaponId || (event.side !== 'RED' && event.side !== 'BLUE')) continue;
    const sideMap = event.side === 'RED' ? redMap : blueMap;
    sideMap.set(event.weaponId, (sideMap.get(event.weaponId) ?? 0) + qty);

    const entry = combinedMap.get(event.weaponId) ?? { redCount: 0, blueCount: 0 };
    if (event.side === 'RED') entry.redCount += qty;
    else entry.blueCount += qty;
    combinedMap.set(event.weaponId, entry);
  }

  const sortMap = (map: Map<string, number>): [string, number][] =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const topWeapons: WeaponExpenditureItem[] = [...combinedMap.entries()]
    .map(([weaponId, counts]) => ({
      weaponId,
      redCount: counts.redCount,
      blueCount: counts.blueCount,
      totalCount: counts.redCount + counts.blueCount,
    }))
    .sort((a, b) => b.totalCount - a.totalCount || a.weaponId.localeCompare(b.weaponId));

  return {
    forceSurvival: {
      RED: summarizeForce('RED'),
      BLUE: summarizeForce('BLUE'),
    },
    ammunition: {
      redTotal,
      blueTotal,
      total: redTotal + blueTotal,
      redWeapons: sortMap(redMap),
      blueWeapons: sortMap(blueMap),
      topWeapons,
    },
  };
}
