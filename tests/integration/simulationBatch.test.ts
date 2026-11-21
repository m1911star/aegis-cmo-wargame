import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SimulationWorkerClient, type WorkerLike } from '../../src/engine/workerClient';
import { handleSimulationWorkerRequest, type SimulationWorkerResponse, type WorkerAdvanceBatchRequest } from '../../src/engine/workerProtocol';
import { clearActionFeedback, subscribeActionFeedback, type ActionFeedbackMessage } from '../../src/store/actionFeedbackBus';
import { canonicalBattleState, captureBattleRecording, replayBattleRecording } from '../../src/store/battleRecording';
import { runSimulationBatch, selectSimulationSession } from '../../src/store/simulationBatch';
import { useWargameStore as store, type WargameStoreState } from '../../src/store/useWargameStore';
import type { EquipmentCatalog, RouteLeg, RuntimeUnit, ScenarioDefinition } from '../../src/types/wargame';

const groupId = 'test_group';
const platformId = 'fixture_trainer';
const scenario: ScenarioDefinition = {
  id: 'batch_fixture', title: 'Clock fixture', subtitle: '', theater: 'Fixture', difficulty: 'STANDARD',
  startTimeIso: '2026-01-01T00:00:00.000Z', initialCamera: { center: [0, 0], zoom: 4 },
  briefing: { situation: '', redObjective: '', blueObjective: '', tacticalTips: [] },
  groups: [{ id: groupId, name: 'Group', side: 'RED', commandTitle: 'Test', description: '' }],
  units: ['lead', 'member'].map((id, index) => ({
    id, name: id, callsign: id, side: 'RED', platformId, parentGroupId: groupId,
    position: [index * 0.01, 0], heading: 0,
  })),
  missions: [], referencePoints: [],
  customCatalogOverlay: {
    platforms: {
      [platformId]: {
        id: platformId, name: 'Fixture trainer', description: 'Unarmed test fixture',
        className: 'Fixture', origin: 'Fixture', domain: 'air', category: 'mpa_uav',
        defaultSidcRed: 'SHAPMF------', defaultSidcBlue: 'SFAPMF------',
        maxSpeedKts: 10, cruiseSpeedKts: 5, minAltitudeM: 0, defaultAltitudeM: 10, maxAltitudeM: 100,
        maxFuelSec: 100, maxHp: 1, radarAntennaHeightM: 0, rcsM2: 0, acousticSignatureDb: 0,
        hasDatalink: false, ciwsDefenseProb: 0, sensorIds: [], mounts: [],
      },
    },
  },
};

function loadFixture() {
  store.getState().loadScenario(scenario, false, 2701);
  store.setState({ autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false } });
  store.getState().setTimeScale(15);
}

let original: WargameStoreState;
beforeEach(() => {
  original = store.getState();
  loadFixture();
});
afterEach(() => {
  store.setState(original, true);
  clearActionFeedback();
});

function controlledWorker() {
  const requests: WorkerAdvanceBatchRequest[] = [];
  const cache = new Map<string, EquipmentCatalog>();
  const worker: WorkerLike = {
    onmessage: null, onerror: null, terminate: () => {},
    postMessage: (message) => requests.push(message as WorkerAdvanceBatchRequest),
  };
  const client = new SimulationWorkerClient(() => worker);
  const emit = (data: SimulationWorkerResponse) => worker.onmessage!({ data } as MessageEvent<SimulationWorkerResponse>);
  return {
    requests,
    run: (seconds = 1) => runSimulationBatch(store.getState(), seconds, undefined, client),
    complete: (index: number) => {
      const response = handleSimulationWorkerRequest(requests[index], cache);
      expect(response.type).toBe('ADVANCE_BATCH_RESULT');
      emit(response);
    },
    emit,
  };
}

describe('simulation batch admission', () => {
  test('new batches apply off-thread after a same-ID reload resets the command sequence', async () => {
    const worker = controlledWorker();
    for (let i = 0; i < 24; i++) store.getState().addReferencePoint([0, 0]);
    const opening = store.getState();
    expect(opening.commandSequence).toBe(24);
    const openingSession = selectSimulationSession(opening);
    const first = worker.run();
    worker.complete(0);
    expect(await first).toBe(true);
    expect(store.getState().tick).toBe(4);
    expect(selectSimulationSession(store.getState())).toBe(openingSession);

    const old = worker.run();
    loadFixture();
    const reloaded = store.getState();
    expect(reloaded.currentScenario.id).toBe(opening.currentScenario.id);
    expect(reloaded.commandSequence).toBe(0);
    expect(selectSimulationSession(reloaded)).not.toBe(openingSession);
    const fresh = worker.run();
    expect(worker.requests[2].epoch).toBeGreaterThan(worker.requests[1].epoch);
    worker.complete(1);
    expect(await old).toBe(false);
    expect(store.getState()).toBe(reloaded);
    worker.complete(2);
    expect(await fresh).toBe(true);
    expect(store.getState().tick).toBe(4);
    expect(store.getState().commandSequence).toBe(0);
  });

  const changes: [string, () => void][] = [
    ['auto-pause', () => store.getState().toggleAutoPause('onNewContact')],
    ['same-ID reload with identical counters', loadFixture],
    ['scenario object swap with identical counters', () => store.setState((s) => ({ currentScenario: { ...s.currentScenario } }))],
    ['player side', () => store.setState({ playerSide: 'BLUE' })],
    ['speed', () => store.getState().setTimeScale(5)],
    ['pause and resume before completion', () => { store.getState().setTimeScale(0); store.getState().setTimeScale(15); }],
    ['replay opened', () => store.setState({ replayPlayer: { recording: captureBattleRecording(), currentTick: 0, isPlaying: false, speed: 5 } })],
    ['recorded command', () => store.getState().addReferencePoint([0, 0])],
    ['intervening tick', () => store.getState().stepSingleTick(0.25)],
    ['partial time advance without a new tick', () => store.getState().stepSingleTick(0.125)],
    ['immutable world replacement without a new tick or command', () => store.setState((s) => ({ units: { ...s.units } }))],
  ];

  test.each(changes)('does not write back a valid response after %s', async (_, change) => {
    const worker = controlledWorker();
    const pending = worker.run();
    change();
    const changedState = store.getState();
    worker.complete(0);
    expect(await pending).toBe(false);
    expect(store.getState()).toBe(changedState);
  });

  test('a new catalog at the same version invalidates the old result and is sent on the next request', async () => {
    const worker = controlledWorker();
    const session = selectSimulationSession(store.getState());
    const pending = worker.run();
    const { catalog } = store.getState();
    store.setState({ catalog: structuredClone(catalog) });
    expect(store.getState().catalog.version).toBe(catalog.version);
    expect(selectSimulationSession(store.getState())).toBe(session);
    worker.complete(0);
    expect(await pending).toBe(false);
    expect(store.getState().tick).toBe(0);

    const fresh = worker.run();
    expect(worker.requests[1].catalog).toBe(store.getState().catalog);
    expect(worker.requests[1].catalogKey).not.toBe(worker.requests[0].catalogKey);
    worker.complete(1);
    expect(await fresh).toBe(true);
    expect(store.getState().tick).toBe(4);
  });

  test('a rejected catalog hotload does not invalidate the running batch', async () => {
    const worker = controlledWorker();
    const before = store.getState();
    const pending = worker.run();
    expect(before.importCatalogJson({ version: 'fixture_overlay' }).ok).toBe(false);
    expect(store.getState()).toBe(before);
    worker.complete(0);
    expect(await pending).toBe(true);
    expect(store.getState().tick).toBe(4);
  });

  test('UI-only changes do not invalidate a batch or get overwritten', async () => {
    const worker = controlledWorker();
    const pending = worker.run(0.375);
    store.getState().selectUnit('member');
    worker.complete(0);
    expect(await pending).toBe(true);
    expect(store.getState().tick).toBe(1);
    expect(store.getState().pendingSimSeconds).toBe(0.125);
    expect(store.getState().selectedUnitId).toBe('member');
  });

  test('a stale epoch never retries; an actual failure retries only with live inputs', async () => {
    const worker = controlledWorker();
    const errorResponse = ({ requestId, epoch }: WorkerAdvanceBatchRequest): SimulationWorkerResponse =>
      ({ type: 'ERROR', requestId, epoch, error: 'Test worker failure' });
    const stale = worker.run();
    worker.emit({ ...errorResponse(worker.requests[0]), epoch: worker.requests[0].epoch + 1 });
    expect(await stale).toBe(false);
    expect(store.getState().tick).toBe(0);

    // Invalidate between the receipt of an ordinary error and the async catch/fallback.
    const rejected = worker.run();
    worker.emit(errorResponse(worker.requests[1]));
    store.getState().toggleAutoPause('onNewContact');
    expect(await rejected).toBe(false);
    expect(store.getState().tick).toBe(0);

    const failed = worker.run();
    worker.emit(errorResponse(worker.requests[2]));
    expect(await failed).toBe(true);
    expect(store.getState().tick).toBe(4);
  });
});

describe('group navigation guards', () => {
  const parkedRoute: RouteLeg[] = [{ position: [0.1, 0] }];
  const temporaryNavigation: [string, (s: WargameStoreState) => Partial<RuntimeUnit>][] = [
    ['refueling', () => ({ airRefuelState: { tankerId: 'script', phase: 'rendezvous', resumeWaypoints: parkedRoute } })],
    ['evasion', (s) => ({ evasionState: { threatContactId: 'script', untilSimTime: s.simTime + 1000,
      resumeStatus: 'operational', resumeWaypoints: parkedRoute } })],
    ['baffle-clearing', (s) => ({ baffleClearState: { savedHeading: 0, savedWaypoints: parkedRoute,
      untilSimTime: s.simTime + 1000, nextAtSimTime: s.simTime + 2000 } })],
  ];

  test.each(temporaryNavigation)('leaves routes and history untouched when changing/clearing a formation during %s', (_, patch) => {
    store.getState().setGroupFormation(groupId, 'lead');
    expect(store.getState().units.member.formationLeaderId).toBe('lead');
    store.setState((s) => ({ units: { ...s.units, member: {
      ...s.units.member, ...patch(s), waypoints: [{ position: [0.02, 0] }],
    } } }));
    const before = store.getState();
    const feedback: ActionFeedbackMessage[] = [];
    const unsubscribe = subscribeActionFeedback((message) => { if (message) feedback.push(message); });
    feedback.length = 0;
    try {
      before.setGroupFormation(groupId, 'lead', 12);
      expect(store.getState()).toBe(before);
      before.setGroupFormation(groupId);
      expect(store.getState()).toBe(before);
      expect(store.getState().commandHistory).toBe(before.commandHistory);
      expect(feedback).toHaveLength(2);
      for (const message of feedback) expect(message).toMatchObject({ severity: 'warning', message: expect.stringContaining('member') });
    } finally {
      unsubscribe();
    }
  });

  test('previously recorded formation commands still replay during temporary navigation', () => {
    store.getState().setGroupFormation(groupId, 'lead');
    store.getState().stepSingleTick(0.25);
    const s = store.getState();
    const snapshot = canonicalBattleState(s);
    Object.assign(snapshot.units.member, temporaryNavigation[0][1](s));
    const recording = captureBattleRecording();
    const replayed = replayBattleRecording({
      ...recording,
      snapshots: [snapshot],
      commands: [...recording.commands, {
        action: 'setGroupFormation', args: [groupId], tick: snapshot.tick, sequence: snapshot.commandSequence,
      }],
    });
    expect(replayed.commandSequence).toBe(2);
    expect(replayed.units.member.formationLeaderId).toBeUndefined();
  });
});
