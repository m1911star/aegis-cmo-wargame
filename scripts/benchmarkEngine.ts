import { advanceSimulation } from '../src/engine/simulation/worldStepper';
import { BUILTIN_SCENARIOS } from '../src/scenarios/builtinScenarios';
import { captureBattleRecording, captureBattleSave, replayBattleRecording } from '../src/store/battleRecording';
import { extractSimulationWorldState, useWargameStore } from '../src/store/useWargameStore';

const off = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };
const cases = [
  { id: 'limited_information_exercise', seed: 6262 },
  { id: 'op_east_sea_thunder_2027', seed: 4242 },
];
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function start({ id, seed }: typeof cases[number]) {
  const scenario = BUILTIN_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`Missing benchmark scenario ${id}`);
  useWargameStore.getState().loadScenario(scenario, false, seed);
  useWargameStore.setState({ autoPause: off });
  return useWargameStore.getState();
}
function run(fixture: typeof cases[number]) {
  const state = start(fixture);
  let world = extractSimulationWorldState(state);
  const initialUnits = Object.keys(world.units).length;
  const begin = performance.now();
  for (let i = 0; i < 60; i++) world = advanceSimulation(world, state.catalog, 6, off, state.playerSide).nextState;
  const elapsedMs = performance.now() - begin;
  if (world.tick !== 1440 || !Object.values(world.units).every((u) => u.position.every(Number.isFinite))) {
    throw new Error(`Invalid benchmark workload at tick ${world.tick}`);
  }
  return { ...fixture, elapsedMs, initialUnits, units: Object.keys(world.units).length, tick: world.tick,
    actualScale: 360_000 / elapsedMs, contacts: Object.keys(world.contacts).length,
    inFlight: Object.keys(world.weaponsInFlight).length, digest: Bun.hash(JSON.stringify(world)).toString(16) };
}
if (process.argv.includes('--long')) {
  const fixture = cases[1];
  start(fixture);
  for (let batch = 1; batch <= 200; batch++) {
    useWargameStore.getState().stepSingleTick(15);
    if (![4, 40, 120, 200].includes(batch)) continue;
    const state = useWargameStore.getState();
    if (state.tick !== batch * 60) throw new Error(`Unexpected long-run tick ${state.tick}`);
    const recording = captureBattleRecording();
    console.log(JSON.stringify({ ...fixture, tick: state.tick, tracks: state.aar.tracks.length,
      snapshots: recording.snapshots?.length ?? 0, saveBytes: bytes(captureBattleSave()), recordingBytes: bytes(recording) }));
    if (batch === 200) {
      const target = state.tick - 9;
      const begin = performance.now();
      const result = replayBattleRecording(recording, 60, target);
      if (result.tick !== target) throw new Error(`Wrong seek result ${result.tick}`);
      console.log(JSON.stringify({ ...fixture, target, seekMs: performance.now() - begin }));
    }
  }
} else {
  for (const fixture of cases) run(fixture);
  const digests = new Map<string, string>();
  for (let i = 0; i < 5; i++) {
    for (const fixture of i % 2 ? [...cases].reverse() : cases) {
      const row = run(fixture);
      if (digests.has(fixture.id) && digests.get(fixture.id) !== row.digest) throw new Error(`Nonrepeatable fixture ${fixture.id}`);
      digests.set(fixture.id, row.digest);
      console.log(JSON.stringify({ run: i + 1, ...row }));
    }
  }
}
