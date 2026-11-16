import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../../src/db';
import { updateUnitOperations } from '../../../src/engine/operations';
import { createRuntimeUnitFromPlacement } from '../../../src/engine/simulationEngine';
import { BUILTIN_SCENARIOS } from '../../../src/scenarios/builtinScenarios';
import { useWargameStore } from '../../../src/store/useWargameStore';
import type {
  MissionDefinition,
  ScoreLedger,
  TacticalContact,
} from '../../../src/types/wargame';

const emptyScore = (): ScoreLedger => ({
  redLosses: 0,
  blueLosses: 0,
  redMissilesFired: 0,
  blueMissilesFired: 0,
  redInterceptions: 0,
  blueInterceptions: 0,
  redScore: 0,
  blueScore: 0,
  firedEventIds: [],
  sortiesLaunched: 0,
});

describe('Strike Package TOT mission planning', () => {
  test('store creates and updates missions with coordinatedPackageId and packageTotSec', () => {
    const store = useWargameStore.getState();
    const scenario = BUILTIN_SCENARIOS.find((s) => s.id === 'information_exercise') ?? BUILTIN_SCENARIOS[0];
    store.loadScenario(scenario);
    const initial = useWargameStore.getState();
    const playerSide = initial.playerSide;
    const refs = initial.referencePoints.filter((r) => r.side === playerSide);
    const needed = 3 - refs.length;
    for (let i = 0; i < needed; i += 1) {
      initial.addReferencePoint([121.0 + i * 0.4, 24.5 + (i % 2) * 0.4], playerSide);
    }
    const afterRefs = useWargameStore.getState().referencePoints.filter((r) => r.side === playerSide).slice(0, 3);
    const beforeCount = useWargameStore.getState().missions.length;

    useWargameStore.getState().createMissionFromReferencePoints({
      name: 'TOT 协同打击波次',
      type: 'land_strike',
      referencePointIds: afterRefs.map((r) => r.id),
      prosecuteOutsideAreaKm: 60,
      coordinatedPackageId: 'PKG-ALPHA',
      packageTotSec: 600,
    });

    const created = useWargameStore.getState().missions.at(-1);
    expect(useWargameStore.getState().missions.length).toBe(beforeCount + 1);
    expect(created?.coordinatedPackageId).toBe('PKG-ALPHA');
    expect(created?.packageTotSec).toBe(600);

    useWargameStore.getState().updateMissionFromReferencePoints(created!.id, {
      name: 'TOT 协同打击波次-调整',
      type: 'land_strike',
      referencePointIds: afterRefs.map((r) => r.id),
      prosecuteOutsideAreaKm: 80,
      coordinatedPackageId: 'PKG-BRAVO',
      packageTotSec: 900,
    });

    const updated = useWargameStore.getState().missions.find((m) => m.id === created!.id);
    expect(updated?.coordinatedPackageId).toBe('PKG-BRAVO');
    expect(updated?.packageTotSec).toBe(900);
  });

  test('units hold on station before packageTotSec ingress window and engage once window opens', () => {
    const striker = createRuntimeUnitFromPlacement(
      {
        id: 'red_striker_tot',
        name: 'Striker',
        callsign: 'STRIKER-1',
        side: 'RED',
        platformId: 'h6n_bomber',
        loadoutId: 'loadout_h6n_land_cruise',
        parentGroupId: 'red_air',
        position: [122.0, 25.0],
        recoveryPosition: [121.0, 25.0],
        heading: 90,
        speedKts: 480,
        assignedMissionId: 'm_tot_strike',
        doctrine: { roe: 'free', emconRadar: true, emconJamming: false },
      },
      catalog,
      () => 0.5
    );

    const target = createRuntimeUnitFromPlacement(
      {
        id: 'blue_ab_tot',
        name: 'Airbase',
        callsign: 'AB-1',
        side: 'BLUE',
        platformId: 'blue_airbase',
        parentGroupId: 'blue_land',
        position: [122.3, 25.0], // ~30 km away -> ~120s ETA at ~480 kts
        heading: 0,
        speedKts: 0,
        doctrine: { roe: 'free', emconRadar: true, emconJamming: false },
      },
      catalog,
      () => 0.5
    );

    const contact: TacticalContact = {
      id: 'RED_CONTACT_blue_ab_tot',
      actualUnitId: target.id,
      observerSide: 'RED',
      targetSide: 'BLUE',
      domain: 'land',
      classification: 'identified',
      identifiedCategory: target.category,
      bdaStatus: 'intact',
      displayName: target.name,
      sidc: target.sidc,
      estimatedPosition: [...target.position],
      truePosition: [...target.position],
      uncertaintyRadiusKm: 0.3,
      heading: 0,
      speedKts: 0,
      altitudeM: 0,
      firstDetectedTime: 0,
      lastDetectedTime: 5000,
      detectedBySources: ['OBS'],
      sourceUnitIds: ['obs'],
      fireControlSourceIds: ['obs'],
      emitterObserved: false,
      threatLevel: 'high',
    };

    const mission: MissionDefinition = {
      id: 'm_tot_strike',
      name: 'TOT Strike',
      side: 'RED',
      type: 'land_strike',
      isActive: true,
      areaPolygon: [[121.8, 24.6], [122.6, 24.6], [122.6, 25.4], [121.8, 25.4]],
      prosecuteOutsideAreaKm: 40,
      coordinatedPackageId: 'PKG-1',
      packageTotSec: 600,
      description: '',
    };

    // At T=10s (ETA ~120s -> arrival ~130s < 600 - 15), striker holds on station
    updateUnitOperations(
      striker,
      { [striker.id]: striker, [target.id]: target },
      { [contact.id]: contact },
      [mission],
      catalog,
      10_000,
      1,
      emptyScore(),
      []
    );
    expect(striker.missionTargetId).toBeUndefined();
    expect(striker.missionState).toBe('on_station');

    // At T=500s (ETA ~120s -> arrival ~620s >= 600 - 15), striker begins ingress/engagement
    contact.lastDetectedTime = 500_000;
    striker.nextMissionDecisionTime = 0;
    updateUnitOperations(
      striker,
      { [striker.id]: striker, [target.id]: target },
      { [contact.id]: contact },
      [mission],
      catalog,
      500_000,
      1,
      emptyScore(),
      []
    );
    expect(striker.missionTargetId as string | undefined).toBe(contact.id);
    expect(striker.missionState).toBe('engaging');
  });
});
