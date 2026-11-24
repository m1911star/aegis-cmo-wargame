import { expect, test } from 'bun:test';
import { exportCurrentStateAsScenarioJson, validateAndParseScenarioJson } from '../../src/scenarios/builtinScenarios';
import { INFORMATION_EXERCISE } from '../../src/scenarios/informationExercise';
import { canonicalBattleState, captureBattleRecording, captureBattleSave, computeCanonicalDigest, replayBattleRecording,
  restoreBattleSave, saveBattleToSlot, type BattleSaveState, type BattleSnapshot } from '../../src/store/battleRecording';
import { useWargameStore as store } from '../../src/store/useWargameStore';
import type { MissionDefinition, ScenarioDefinition, ScenarioEventAction } from '../../src/types/wargame';

const state = store.getState;
const unitId = 'placeholder';
const version = 'fixture_overlay';
const catalog = INFORMATION_EXERCISE.customCatalogOverlay!;
const marker = catalog.platforms!.exercise_target;
const scenario: ScenarioDefinition = {
  ...INFORMATION_EXERCISE, id: 'persistence_fixture', title: 'Persistence fixture',
  units: [{ id: unitId, name: 'Placeholder', callsign: 'TEST', side: 'RED', platformId: marker.id,
    parentGroupId: 'exercise_red', position: [0, 0], recoveryPosition: [1, 0], heading: 0, speedKts: 0, doctrine: { roe: 'hold' } }],
  environment: { landPolygons: [], acousticZones: [] },
  objectives: [], missions: [], events: [], referencePoints: [],
};

function begin(definition = scenario) {
  state().loadScenario(definition, false, 184);
  store.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
}

const jsonRoundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test('sandbox terrain starts at its recorded tick and stays live-only across saved checkpoints and reset', () => {
  begin();
  const opening = state().currentScenario;
  expect(state().environment).not.toBe(opening.environment);
  state().setPlayMode('sandbox');
  state().stepSingleTick(0.25);
  state().moveUnitInSandbox(unitId, [1, 0]);
  state().stepSingleTick(0.5);
  state().startPolygonDraw({ targetKind: 'land', name: 'Fixture polygon' });
  for (const vertex of [[-.1, -.1], [.1, -.1], [.1, .1], [-.1, .1]] as [number, number][]) {
    state().appendPolygonDrawVertex(vertex);
  }
  expect(state().commitPolygonDraw()).toBe(true);
  state().stepSingleTick(60);
  const expected = canonicalBattleState();
  const polygon = expected.environment.landPolygons[0];
  expect(polygon?.name).toBe('Fixture polygon');
  expect(state().currentScenario).toBe(opening);
  expect(opening.environment?.landPolygons).toEqual([]);

  const save = jsonRoundTrip(captureBattleSave());
  const recording = jsonRoundTrip(captureBattleRecording());
  const { snapshots: _frames, history: _archive, ...commandsOnly } = recording;
  expect(recording.snapshots).toHaveLength(1);
  expect(save.scenario.environment?.landPolygons).toEqual([]);
  expect(save.snapshot.environment.landPolygons).toEqual([polygon]);
  const exported = validateAndParseScenarioJson(exportCurrentStateAsScenarioJson(opening, state().units, state()));
  expect(exported.scenario?.environment?.landPolygons).toEqual([polygon]);
  expect(exported.scenario?.units[0].position).toEqual([1, 0]);

  state().resetScenario();
  expect(state().environment.landPolygons).toEqual([]);
  expect(state().units[unitId].position).toEqual([0, 0]);
  expect(restoreBattleSave(save)).toEqual(expected);
  expect(replayBattleRecording(commandsOnly, 60, 0).units[unitId].position).toEqual([0, 0]);
  const beforeDraw = replayBattleRecording(commandsOnly, 60, 2);
  expect(beforeDraw.units[unitId].position).toEqual([1, 0]);
  expect(beforeDraw.environment.landPolygons).toEqual([]);
  expect(replayBattleRecording(commandsOnly, 60, 3).environment.landPolygons).toEqual([polygon]);
  expect(replayBattleRecording(commandsOnly, 60)).toEqual(expected);
  expect(replayBattleRecording(recording, 60)).toEqual(expected);

  const reopened = state().currentScenario;
  state().deleteEnvironmentPolygon('land', polygon.id);
  expect(state().currentScenario).toBe(reopened);
  expect(replayBattleRecording(jsonRoundTrip(captureBattleRecording()), 60).environment.landPolygons).toEqual([]);
});

const mission: MissionDefinition = { id: 'fixture_mission', name: 'Fixture mission', side: 'RED', type: 'aew_support',
  isActive: true, areaPolygon: [[1, 1], [2, 1], [1, 2]], prosecuteOutsideAreaKm: 0, description: 'Fixture' };

test('clean restart export blocks dangling event mission references and escorts of omitted units', () => {
  const slot = 'fixture_slot';
  const loadout = 'fixture_loadout';
  const childPlatform = catalog.platforms!.exercise_blue_scout;
  const definition: ScenarioDefinition = {
    ...scenario,
    customCatalogOverlay: {
      ...catalog,
      platforms: { ...catalog.platforms,
        [marker.id]: { ...marker, hangarSlots: [{ slotId: slot, squadronName: 'Fixture', platformId: childPlatform.id,
          defaultLoadoutId: loadout, availableLoadoutIds: [loadout], totalAirframes: 1, readyAirframes: 1, launchCooldownSec: 0 }] },
        [childPlatform.id]: { ...childPlatform, defaultLoadoutId: loadout, availableLoadoutIds: [loadout] },
      },
      loadouts: { [loadout]: { id: loadout, name: 'Fixture', codeName: 'TEST', description: '', role: 'multi_mission',
        compatiblePlatformIds: [childPlatform.id], mounts: [] } },
    },
    missions: [mission],
  };
  const actions: [ScenarioEventAction, string][] = [
    [{ type: 'ACTIVATE_MISSION', missionId: mission.id, isActive: true }, 'unknown mission fixture_mission'],
    [{ type: 'LAUNCH_SORTIE', carrierUnitId: unitId, hangarSlotId: slot, assignedMissionId: mission.id }, 'unknown sortie mission'],
  ];
  for (const [action, message] of actions) {
    begin({ ...definition, events: [{ id: 'fixture_event', name: 'Fixture event', description: 'Fixture',
      trigger: { type: 'TIME_ELAPSED', elapsedSec: 30 }, actions: [action] }] });
    state().setPlayMode('sandbox');
    state().deleteMission(mission.id);
    expect(() => exportCurrentStateAsScenarioJson(state().currentScenario, state().units, state()))
      .toThrow(`event.fixture_event: ${message}`);
  }

  begin({ ...scenario, missions: [{ ...mission, type: 'escort', escortUnitId: unitId }] });
  const omittedUnits = { [unitId]: { ...state().units[unitId], status: 'recovered' as const } };
  expect(() => exportCurrentStateAsScenarioJson(state().currentScenario, omittedUnits, state()))
    .toThrow('mission.fixture_mission: escort missions require a same-side escortUnitId');
});

test('v3 save digest binds the opening, seed, commands and checkpoint before any write', () => {
  begin();
  state().setPlayMode('sandbox');
  const original = jsonRoundTrip(captureBattleSave());
  expect(original.version).toBe(3);
  const changes: ((save: BattleSaveState) => void)[] = [
    (save) => { save.scenario.title += ' edition'; },
    (save) => { save.seed++; },
    (save) => { save.commandHistory[0].args[0] = 'command'; },
    (save) => { save.snapshot.score.redScore++; },
    (save) => { save.catalogVersion += '-different'; },
  ];
  const before = state();
  for (const change of changes) {
    const altered = structuredClone(original);
    change(altered);
    expect(() => restoreBattleSave(altered)).toThrow('digest mismatch');
    expect(state()).toBe(before);
  }
  expect(restoreBattleSave(original)).toEqual(canonicalBattleState(before));
});

test('save and replay decoders reject malformed runtime fields with paths, even for unused frames', () => {
  begin();
  state().stepSingleTick(60);
  const save = jsonRoundTrip(captureBattleSave());
  const recording = jsonRoundTrip(captureBattleRecording());
  const legacy = (snapshot: BattleSnapshot) => ({ ...save, version: 1, snapshot, digest: computeCanonicalDigest(snapshot) });
  const before = state();
  let updates = 0;
  const unsubscribe = store.subscribe(() => { updates++; });
  try {
    const legacyMetadata = { ...save.snapshot, notes: 'accidentally copied into the snapshot' };
    expect(() => restoreBattleSave(legacy(legacyMetadata))).toThrow('save.snapshot.notes: unexpected snapshot field');
    const inconsistentUnit = structuredClone(save.snapshot);
    inconsistentUnit.units[unitId].id = 'not_its_key';
    expect(() => restoreBattleSave(legacy(inconsistentUnit))).toThrow('save.snapshot.units.placeholder.id');

    const invalidFrame = structuredClone(recording);
    Object.assign(invalidFrame.snapshots![0], { objectives: {} });
    expect(() => replayBattleRecording(invalidFrame, 60, 0)).toThrow('recording.snapshots[0].objectives');
    const invalidArchive = structuredClone(recording);
    Object.assign(invalidArchive.history!.tracks[0], { position: [0] });
    expect(() => replayBattleRecording(invalidArchive, 60, 0)).toThrow('recording.history.tracks[0].position');
    expect(state()).toBe(before);
    expect(updates).toBe(0);
  } finally { unsubscribe(); }

  const { pendingSortieOrders: _sorties, pendingTotStrikeOrders: _tot, objectiveHoldProgress: _holds, ...olderSnapshot } = save.snapshot;
  expect(restoreBattleSave(legacy(olderSnapshot as BattleSnapshot))).toMatchObject({
    pendingSortieOrders: [], pendingTotStrikeOrders: [], objectiveHoldProgress: {},
  });
});

test('catalog opening edits rebuild derived state, validate future definitions, and persist the same restart', () => {
  begin();
  const before = state();
  state().setActivePerspective('GOD');
  state().toggleAutoPause('onNewContact');
  state().selectUnit(unitId);
  expect(state().importCatalogJson({ version, platforms: { [marker.id]: { ...marker, maxHp: marker.maxHp + 1 } } }).ok).toBe(true);
  const rebuilt = state();
  expect(rebuilt.catalog).not.toBe(before.catalog);
  expect(rebuilt.units[unitId].hp).toBe(marker.maxHp + 1);
  const { seed, tick, timeScale, commandSequence, activePerspective, selectedUnitId, autoPause } = rebuilt;
  expect({ seed, tick, timeScale, commandSequence, activePerspective, selectedUnitId, autoPause }).toMatchObject({ seed: before.seed, tick: 0, timeScale: 0, commandSequence: 0,
    activePerspective: 'GOD', selectedUnitId: unitId, autoPause: { onNewContact: true } });
  const expected = canonicalBattleState();
  const save = jsonRoundTrip(captureBattleSave());
  expect(replayBattleRecording(captureBattleRecording())).toEqual(expected);
  expect(restoreBattleSave(save)).toEqual(expected);
  state().resetScenario();
  expect(canonicalBattleState()).toEqual(expected);

  // Removing an overlay used by a future placement is invalid even when no current unit needs it.
  begin({ ...scenario, units: [], events: [{ id: 'future_fixture', name: 'Fixture', description: 'Fixture',
    trigger: { type: 'TIME_ELAPSED', elapsedSec: 100 }, actions: [{ type: 'SPAWN_REINFORCEMENTS', units: scenario.units }] }] });
  const future = state();
  expect(state().resetCatalogToDefault()).toMatchObject({ ok: false, error: expect.stringContaining('unit.placeholder') });
  expect(state().importCatalogJson({ version }, 'replace')).toMatchObject({ ok: false, error: expect.stringContaining('unit.placeholder') });
  expect(state()).toBe(future);
});

test('catalog import and reset reject running, partially advanced, commanded, resumed and replay sessions', () => {
  const blockBoth = () => {
    const before = state();
    for (const result of [state().importCatalogJson({ version }), state().resetCatalogToDefault()]) {
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('暂停开局') });
    }
    expect(state()).toBe(before);
  };
  const cases = [
    () => state().setTimeScale(1),
    () => state().stepSingleTick(0.125),
    () => state().stepSingleTick(0.25),
    () => state().setPlayMode('sandbox'),
    () => restoreBattleSave(captureBattleSave()),
    () => state().startReplayPlayer(captureBattleRecording()),
  ];
  for (const transition of cases) {
    begin();
    transition();
    blockBoth();
  }
  state().exitReplayPlayer();
});

test('rejects replacing the opening or overwriting saves during map replay without losing the live checkpoint', () => {
  begin();
  state().stepSingleTick(5);
  const save = captureBattleSave();
  const recording = captureBattleRecording();
  const storage = new Map<string, string>();
  const memStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  };
  const liveSlot = saveBattleToSlot('Live slot', undefined, memStorage);
  const rawBefore = storage.get('aegis_cmo_save_slots_v1');

  state().startReplayPlayer(recording, 0);
  const playback = state();
  expect(playback.replayPlayer?.currentTick).toBe(0);
  expect(() => playback.resetScenario()).toThrow('请先退出地图回放');
  expect(() => playback.loadScenario(scenario)).toThrow('请先退出地图回放');
  expect(() => restoreBattleSave(save)).toThrow('请先退出地图回放');
  expect(() => captureBattleSave()).toThrow('请先退出地图回放');
  expect(() => saveBattleToSlot('Replay frame', liveSlot.slotId, memStorage)).toThrow('请先退出地图回放');
  expect(storage.get('aegis_cmo_save_slots_v1')).toBe(rawBefore);
  expect(state()).toBe(playback);
  playback.exitReplayPlayer();
  expect(canonicalBattleState()).toEqual(save.snapshot);
});
