import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../../src/db';
import { createRuntimeUnitFromPlacement } from '../../../src/engine/simulationEngine';
import {
  BUILTIN_CAMPAIGN_WESTPAC,
  applyCampaignResupplyChoice,
  applyCampaignRuntimeCarryover,
  buildCampaignStageScenario,
  computeCampaignResupplyDiff,
  computeNextCampaignCarryover,
  createInitialCampaignState,
} from '../../../src/scenarios/campaign';
import { INFORMATION_EXERCISE } from '../../../src/scenarios/informationExercise';
import { SCENARIO_EAST_SEA_THUNDER } from '../../../src/scenarios/builtinScenarios';
import { SCENARIO_JOINT_AMPHIBIOUS_ASSAULT } from '../../../src/scenarios/jointAmphibiousScenario';
import { captureBattleRecording, canonicalBattleState, replayBattleRecording } from '../../../src/store/battleRecording';
import { useWargameStore as store } from '../../../src/store/useWargameStore';

describe('Campaign strategic depth: supplyPoints, airbaseIntegrityPct, modifiers & resupply tradeoffs', () => {
  test('initial campaign state exposes theater supplyPoints, airbaseIntegrityPct, and stageModifiers', () => {
    const state = createInitialCampaignState(BUILTIN_CAMPAIGN_WESTPAC, 'RED');
    expect(state.supplyPoints).toBe(100);
    expect(state.airbaseIntegrityPct).toBe(100);
    expect(state.carryover.supplyPoints).toBe(100);
    expect(state.carryover.airbaseIntegrityPct).toBe(100);
    expect(state.stageModifiers.length).toBeGreaterThan(0);
  });

  test('computeNextCampaignCarryover adjusts supplyPoints and airbaseIntegrityPct by outcome, losses, and airbase damage', () => {
    const initial = createInitialCampaignState(BUILTIN_CAMPAIGN_WESTPAC, 'RED').carryover;

    // Victory boosts supplyPoints and preserves airbase integrity
    const afterVictory = computeNextCampaignCarryover(
      initial,
      { endedAt: 900000, reason: 'time_limit', outcomes: { RED: 'victory', BLUE: 'defeat' } },
      'RED',
      400,
      0,
      {}
    );
    expect(afterVictory.supplyPoints).toBe(180); // 100 + 60 + floor(400/20)
    expect(afterVictory.airbaseIntegrityPct).toBe(100);

    // Defeat with own airbase damaged degrades airbaseIntegrityPct and yields minimal emergency supply
    const damagedAirbase = createRuntimeUnitFromPlacement(
      {
        id: 'test_red_airbase',
        name: '前线机场',
        callsign: 'AB-1',
        side: 'RED',
        platformId: 'red_airbase',
        parentGroupId: 'g1',
        position: [119, 24],
        heading: 0,
        speedKts: 0,
      },
      catalog
    );
    damagedAirbase.hp = Math.round(damagedAirbase.maxHp * 0.5);

    const afterDefeat = computeNextCampaignCarryover(
      initial,
      { endedAt: 900000, reason: 'time_limit', outcomes: { RED: 'defeat', BLUE: 'victory' } },
      'RED',
      80,
      3,
      { [damagedAirbase.id]: damagedAirbase }
    );
    expect(afterDefeat.supplyPoints).toBe(112); // 100 + 10 + floor(80/40)
    expect(afterDefeat.airbaseIntegrityPct).toBeLessThan(70);
    expect(afterDefeat.airbaseIntegrityPct).toBeGreaterThanOrEqual(25);
  });

  test('buildCampaignStageScenario applies outcome-driven modifiers for victory and defeat', () => {
    const initial = createInitialCampaignState(BUILTIN_CAMPAIGN_WESTPAC, 'RED').carryover;

    const victoryCarry = computeNextCampaignCarryover(
      initial,
      { endedAt: 900000, reason: 'time_limit', outcomes: { RED: 'victory', BLUE: 'defeat' } },
      'RED',
      300,
      0,
      {}
    );
    const victoryStage = buildCampaignStageScenario(SCENARIO_EAST_SEA_THUNDER, victoryCarry, 'RED', 1);
    expect(victoryStage.environment?.satellitePasses?.some((p) => p.id === 'campaign_forward_isr_s2')).toBe(true);
    expect(victoryStage.events?.some((e) => e.id === 'campaign_carryover_bonus_s2')).toBe(true);
    expect(victoryStage.briefing.situation).toContain('175 SP');
    expect(victoryStage.briefing.situation).toContain('机场完好度 100%');

    const defeatCarry = computeNextCampaignCarryover(
      initial,
      { endedAt: 900000, reason: 'time_limit', outcomes: { RED: 'defeat', BLUE: 'victory' } },
      'RED',
      40,
      4,
      {}
    );
    const defeatStage = buildCampaignStageScenario(SCENARIO_EAST_SEA_THUNDER, defeatCarry, 'RED', 1);
    const alertEvent = defeatStage.events?.find((e) => e.id === 'campaign_opfor_alert_s2');
    expect(alertEvent).toBeDefined();
    expect(
      alertEvent?.actions.some(
        (a) => a.type === 'UPDATE_SIDE_DOCTRINE' && a.side === 'BLUE' && a.doctrinePatch.roe === 'free'
      )
    ).toBe(true);
    expect(defeatStage.briefing.situation).toContain('ROE FREE');
  });

  test('applyCampaignResupplyChoice enforces SP costs and distinct strategic tradeoffs including base_repair', () => {
    const baseCarry = {
      ...createInitialCampaignState(BUILTIN_CAMPAIGN_WESTPAC, 'RED').carryover,
      completedStages: 1,
      supplyPoints: 100,
      airbaseIntegrityPct: 60,
      readinessMultiplier: 0.85,
      airframeAttritionDebt: 4,
      platformDamageDebt: { type055_destroyer: 0.3 },
      scarceAmmoDebt: { yj21_hypersonic: 10 },
      lastOutcome: 'costly_victory' as const,
    };

    const munitions = applyCampaignResupplyChoice(baseCarry, 'munitions');
    expect(munitions.supplyPoints).toBe(60); // -40 SP
    expect(munitions.scarceAmmoDebt.yj21_hypersonic).toBe(2); // 80% cleared
    expect(munitions.platformDamageDebt.type055_destroyer).toBe(0.3); // unchanged
    expect(munitions.airbaseIntegrityPct).toBe(60); // unchanged

    const baseRepair = applyCampaignResupplyChoice(baseCarry, 'base_repair');
    expect(baseRepair.supplyPoints).toBe(65); // -35 SP
    expect(baseRepair.airbaseIntegrityPct).toBe(85); // +25%
    expect(baseRepair.airframeAttritionDebt).toBe(3); // -1 recovered airframe

    const hullRepair = applyCampaignResupplyChoice(baseCarry, 'hull_repair');
    expect(hullRepair.supplyPoints).toBe(55); // -45 SP
    expect(hullRepair.platformDamageDebt.type055_destroyer).toBeCloseTo(0.09, 2); // 70% cleared
    expect(hullRepair.airbaseIntegrityPct).toBe(66); // +6%

    const balanced = applyCampaignResupplyChoice(baseCarry, 'balanced');
    expect(balanced.supplyPoints).toBe(75); // -25 SP
    expect(balanced.airbaseIntegrityPct).toBe(68); // +8%
    expect(balanced.airframeAttritionDebt).toBe(2);
    expect(balanced.scarceAmmoDebt.yj21_hypersonic).toBe(6);

    // Low SP rations specialized repair effectiveness proportionally
    const lowSupplyCarry = { ...baseCarry, supplyPoints: 0 };
    const starvedBaseRepair = applyCampaignResupplyChoice(lowSupplyCarry, 'base_repair');
    expect(starvedBaseRepair.supplyPoints).toBe(0);
    expect(starvedBaseRepair.airbaseIntegrityPct).toBe(60);
  });

  test('applyCampaignRuntimeCarryover degrades airbase HP and hangar turnaround when airbaseIntegrityPct is low', () => {
    const airbaseUnit = createRuntimeUnitFromPlacement(
      {
        id: 'joint_red_airbase',
        name: '西岸前线机场',
        callsign: 'AB-WEST',
        side: 'RED',
        platformId: 'red_airbase',
        parentGroupId: 'joint_red_air_land',
        position: [119.2, 24.1],
        heading: 90,
        speedKts: 0,
      },
      catalog
    );
    const baseTurnaround = airbaseUnit.hangar[0].turnaroundSec;
    const baseCooldown = airbaseUnit.hangar[0].launchCooldownSec;

    const degradedCarry = {
      ...createInitialCampaignState(BUILTIN_CAMPAIGN_WESTPAC, 'RED').carryover,
      completedStages: 1,
      airbaseIntegrityPct: 60,
      lastOutcome: 'defeat' as const,
    };

    const carried = applyCampaignRuntimeCarryover(
      { [airbaseUnit.id]: airbaseUnit },
      degradedCarry,
      'RED',
      catalog
    );
    expect(carried[airbaseUnit.id].hp).toBeLessThan(airbaseUnit.maxHp);
    expect(carried[airbaseUnit.id].hp).toBeGreaterThanOrEqual(Math.ceil(airbaseUnit.maxHp * 0.55));
    expect(carried[airbaseUnit.id].hangar[0].turnaroundSec).toBeGreaterThan(baseTurnaround);
    expect(carried[airbaseUnit.id].hangar[0].launchCooldownSec).toBeGreaterThan(baseCooldown);
  });

  test('store advanceCampaignStage syncs supplyPoints, airbaseIntegrityPct, and stageModifiers', () => {
    store.getState().startCampaign('RED');
    store.setState({
      autoPause: { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false },
    });
    store.getState().stepSingleTick(905);
    expect(store.getState().battleResult).toBeDefined();

    store.getState().advanceCampaignStage('munitions');
    const s2 = store.getState().campaignState;
    expect(s2).not.toBeNull();
    expect(s2?.currentStageIndex).toBe(1);
    expect(s2?.supplyPoints).toBe(s2?.carryover.supplyPoints);
    expect(s2?.airbaseIntegrityPct).toBe(s2?.carryover.airbaseIntegrityPct);
    expect(s2?.stageModifiers).toEqual(s2?.carryover.stageModifiers);
    expect(SCENARIO_JOINT_AMPHIBIOUS_ASSAULT.id).toBeTruthy();
  });

  test('computes resupply before/after diffs, hot-reloads CMO JSON catalog overlays, and replays draw_polygon commands deterministically', () => {
    const preCarry = {
      ...createInitialCampaignState(BUILTIN_CAMPAIGN_WESTPAC, 'RED').carryover,
      completedStages: 2,
      supplyPoints: 120,
      airbaseIntegrityPct: 65,
      readinessMultiplier: 0.88,
      airframeAttritionDebt: 4,
      platformDamageDebt: { type055_destroyer: 0.25 },
      scarceAmmoDebt: { yj21_hypersonic: 8, pl17_ulraam: 4 },
    };
    const diff = computeCampaignResupplyDiff(preCarry, 'munitions');
    expect(diff.supplyPoints).toEqual({ before: 120, after: 80, delta: -40 });
    expect(diff.totalScarceAmmoDebt.before).toBe(12);
    expect(diff.totalScarceAmmoDebt.after).toBeLessThan(diff.totalScarceAmmoDebt.before);
    expect(diff.totalScarceAmmoDebt.delta).toBeLessThan(0);

    // Hot-load & reset CMO JSON overlay in store
    store.getState().loadScenario(INFORMATION_EXERCISE, false, 777);
    const samplePlatform = structuredClone(catalog.platforms.type055_destroyer);
    samplePlatform.id = 'cmo_ship_9999';
    samplePlatform.dbid = 9999;
    samplePlatform.name = 'CMO Hotload Cruiser';
    const importRes = store.getState().importCatalogJson(
      JSON.stringify({ version: 'cmo_hotload_test', platforms: { cmo_ship_9999: samplePlatform } }),
      'merge'
    );
    expect(importRes.ok).toBe(true);
    expect(store.getState().catalog.platforms.cmo_ship_9999?.dbid).toBe(9999);
    const resetRes = store.getState().resetCatalogToDefault();
    expect(resetRes.ok).toBe(true);
    expect(store.getState().catalog.platforms.cmo_ship_9999).toBeUndefined();

    // Sandbox draw_polygon flow + deterministic Recording v2 replay
    store.getState().setPlayMode('sandbox');
    store.getState().startPolygonDraw({
      targetKind: 'land',
      name: 'Drawn Ridge',
      elevationM: 920,
    });
    expect(store.getState().interactionMode).toBe('draw_polygon');
    store.getState().appendPolygonDrawVertex([124.0, 25.0]);
    store.getState().appendPolygonDrawVertex([124.3, 25.0]);
    store.getState().appendPolygonDrawVertex([124.2, 25.3]);
    expect(store.getState().commitPolygonDraw()).toBe(true);
    expect(store.getState().environment.landPolygons.some((p) => p.name === 'Drawn Ridge' && p.elevationM === 920)).toBe(true);

    store.getState().stepSingleTick(2);
    const expectedSnapshot = canonicalBattleState();
    const rec = captureBattleRecording();
    const replayed = replayBattleRecording(rec);
    expect(replayed).toEqual(expectedSnapshot);
  });
});
