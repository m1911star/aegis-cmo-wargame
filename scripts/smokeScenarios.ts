import { BUILTIN_SCENARIOS } from '../src/scenarios/builtinScenarios';
import { useWargameStore } from '../src/store/useWargameStore';

const SEEDS: Record<string, number> = {
  op_east_sea_thunder_2027: 4242,
  op_deep_sea_carrier_hunt_2028: 5252,
  op_bashi_channel_blockade_2029: 7373,
  op_joint_amphibious_assault_2027: 8484,
  op_inland_mountain_strike_2027: 9595,
  op_fog_bay_relay: 8642,
  limited_information_exercise: 6262,
  interactive_command_tutorial: 1010,
};

const pausesOff = {
  onNewContact: false,
  onMissileDetected: false,
  onUnitHitOrDestroyed: false,
};

const summaries = [];
for (const scenario of BUILTIN_SCENARIOS) {
  const seed = SEEDS[scenario.id];
  if (seed === undefined) throw new Error(`Missing fixed smoke seed for ${scenario.id}`);
  const durationSec = scenario.victoryConditions?.durationSec;
  if (!durationSec) throw new Error(`Missing duration for ${scenario.id}`);

  useWargameStore.getState().loadScenario(scenario, false, seed);
  useWargameStore.setState({ autoPause: pausesOff });
  useWargameStore.getState().stepSingleTick(durationSec + 1);
  const state = useWargameStore.getState();
  if (!state.battleResult) throw new Error(`${scenario.id} did not terminate by ${durationSec + 1}s`);
  const invalidUnit = Object.values(state.units).find((unit) =>
    !Number.isFinite(unit.position[0]) || !Number.isFinite(unit.position[1]) ||
    !Number.isFinite(unit.hp) || !Number.isFinite(unit.fuelRemainingSec));
  if (invalidUnit) throw new Error(`${scenario.id} contains non-finite unit state: ${invalidUnit.id}`);
  const pending = state.pendingSortieOrders.filter((order) => order.status === 'pending');
  if (pending.length) throw new Error(`${scenario.id} has unresolved sortie orders: ${pending.map((order) => order.orderId).join(', ')}`);
  for (const value of Object.values(state.score)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`${scenario.id} has invalid score value ${value}`);
    }
  }

  summaries.push({
    scenarioId: scenario.id,
    title: scenario.title,
    seed,
    tick: state.tick,
    elapsedSec: (state.simTime - state.startTime) / 1000,
    configuredDurationSec: durationSec,
    terminalReason: state.battleResult.reason,
    outcomes: state.battleResult.outcomes,
    losses: { red: state.score.redLosses, blue: state.score.blueLosses },
    missilesFired: { red: state.score.redMissilesFired, blue: state.score.blueMissilesFired },
    interceptions: { red: state.score.redInterceptions, blue: state.score.blueInterceptions },
    score: { red: state.score.redScore, blue: state.score.blueScore },
    sortiesLaunched: state.score.sortiesLaunched,
    events: state.events.map((event) => ({
      id: event.id,
      fireCount: event.fireCount ?? 0,
      lastFiredElapsedSec: event.lastFiredSimTime === undefined
        ? null : (event.lastFiredSimTime - state.startTime) / 1000,
    })),
    sortieOrders: {
      pending: state.pendingSortieOrders.filter((order) => order.status === 'pending').length,
      failed: state.pendingSortieOrders.filter((order) => order.status === 'failed')
        .map((order) => ({ eventId: order.eventId, reason: order.failureReason })),
    },
    objectives: state.objectiveProgress,
    aarEvents: state.aar.events.length,
    finiteState: true,
  });
}

const report = {
  contract: {
    fixedStepSec: 0.25,
    commandMode: 'no-command',
    recordingVersion: 2,
    scenarios: summaries.length,
  },
  summaries,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const checkOnly = process.argv.includes('--check');
const reportPath = 'docs/SCENARIO_SMOKE_RESULTS.json';

if (checkOnly) {
  const existing = await Bun.file(reportPath).text();
  if (existing !== serialized) {
    throw new Error(
      `${reportPath} is out of sync with deterministic smoke output. Run \`bun run smoke:scenarios\` to refresh.`
    );
  }
} else {
  await Bun.write(reportPath, serialized);
}
console.log(JSON.stringify(report, null, 2));
