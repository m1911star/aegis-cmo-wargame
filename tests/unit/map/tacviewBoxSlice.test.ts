import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../../src/db';
import { THERMOCLINE } from '../../../src/engine/constants';
import { SCENARIO_EAST_SEA_THUNDER, instantiateScenarioUnits } from '../../../src/scenarios/builtinScenarios';
import {
  buildAarBoxSlice,
  buildLiveBoxSlice,
  lonLatAltToLocalBox,
} from '../../../src/tacview3d/boxSlice';
import type { BattleAarLedger, TacticalContact, WeaponInFlight } from '../../../src/types/wargame';

describe('local 3D air-sea box slice projection & FoW isolation', () => {
  test('lonLatAltToLocalBox maps positive altitude with air exaggeration and negative depth with subsurface exaggeration', () => {
    const center: [number, number] = [123.0, 25.0];
    const highAir = lonLatAltToLocalBox([123.0, 25.0], 10000, center, { airScale: 4, subScale: 60 });
    expect(highAir.xKm).toBeCloseTo(0, 5);
    expect(highAir.zKm).toBeCloseTo(0, 5);
    expect(highAir.yScaled).toBeCloseTo(40, 5);

    const deepSub = lonLatAltToLocalBox([123.0, 25.0], -200, center, { airScale: 4, subScale: 60 });
    expect(deepSub.yScaled).toBeCloseTo(-12, 5);
  });

  test('buildLiveBoxSlice enforces Fog-of-War: never leaks undetected enemy units, enemy missile trails, or actualUnitId', () => {
    const units = instantiateScenarioUnits(SCENARIO_EAST_SEA_THUNDER);
    const redAnchor = units.red_055_nanchang;
    const blueHiddenSub = Object.values(units).find((u) => u.side === 'BLUE' && u.domain === 'subsurface')!;
    const blueDetectedShip = units.blue_ddg125_lucas;

    // Place both enemy units near the red anchor so they are geometrically inside the 120km box
    blueHiddenSub.position = [redAnchor.position[0] + 0.25, redAnchor.position[1] + 0.1];
    blueDetectedShip.position = [redAnchor.position[0] + 0.35, redAnchor.position[1] - 0.1];

    const contact: TacticalContact = {
      id: 'RED_CONTACT_blue_ddg125_lucas',
      actualUnitId: blueDetectedShip.id,
      observerSide: 'RED',
      targetSide: 'BLUE',
      domain: 'surface',
      classification: 'classified',
      displayName: '接触 #101 水面舰艇',
      sidc: blueDetectedShip.sidc,
      estimatedPosition: [blueDetectedShip.position[0] + 0.02, blueDetectedShip.position[1]],
      truePosition: [...blueDetectedShip.position],
      uncertaintyRadiusKm: 4.5,
      heading: 270,
      speedKts: 24,
      altitudeM: 0,
      firstDetectedTime: 0,
      lastDetectedTime: 0,
      detectedBySources: ['R1'],
      threatLevel: 'high',
    };

    const friendlyMissile: WeaponInFlight = {
      id: 'red_m1',
      weaponId: 'yj18_ashm',
      name: 'YJ-18',
      side: 'RED',
      shooterId: redAnchor.id,
      shooterName: redAnchor.callsign,
      targetId: blueDetectedShip.id,
      targetType: 'unit',
      position: [redAnchor.position[0] + 0.15, redAnchor.position[1]],
      launchPosition: [...redAnchor.position],
      trail: [[...redAnchor.position], [redAnchor.position[0] + 0.15, redAnchor.position[1]]],
      altitudeTrail: [15, 18],
      altitudeM: 18,
      heading: 90,
      speedKts: 600,
      distanceRemainingKm: 30,
      maxRangeKm: 400,
      traveledKm: 15,
      basePk: 0.75,
      warheadDamage: 90,
      seekerState: 'terminal_locked',
    };

    const undetectedEnemyMissile: WeaponInFlight = {
      id: 'blue_m_stealth',
      weaponId: 'agm158c_lrasm',
      name: 'LRASM',
      side: 'BLUE',
      shooterId: blueDetectedShip.id,
      shooterName: blueDetectedShip.callsign,
      targetId: redAnchor.id,
      targetType: 'unit',
      position: [redAnchor.position[0] + 0.6, redAnchor.position[1] + 0.5],
      launchPosition: [...blueDetectedShip.position],
      trail: [[...blueDetectedShip.position], [redAnchor.position[0] + 0.6, redAnchor.position[1] + 0.5]],
      altitudeTrail: [12, 12],
      altitudeM: 12,
      heading: 250,
      speedKts: 580,
      distanceRemainingKm: 60,
      maxRangeKm: 370,
      traveledKm: 40,
      basePk: 0.8,
      warheadDamage: 100,
    };

    const slice = buildLiveBoxSlice({
      anchorCenter: redAnchor.position,
      anchorLabel: redAnchor.callsign,
      anchorId: redAnchor.id,
      radiusKm: 120,
      activePerspective: 'RED',
      units,
      contacts: { [contact.id]: contact },
      weaponsInFlight: {
        [friendlyMissile.id]: friendlyMissile,
        [undetectedEnemyMissile.id]: undetectedEnemyMissile,
      },
      detectedMissileIds: [],
      catalog,
      simTime: 1000,
      environment: {
        ...SCENARIO_EAST_SEA_THUNDER.environment!,
        landPolygons: [
          {
            id: 'local_ridge',
            name: '钓鱼岛主峰',
            elevationM: 362,
            areaPolygon: [
              [redAnchor.position[0] + 0.1, redAnchor.position[1] + 0.1],
              [redAnchor.position[0] + 0.2, redAnchor.position[1] + 0.1],
              [redAnchor.position[0] + 0.2, redAnchor.position[1] + 0.2],
              [redAnchor.position[0] + 0.1, redAnchor.position[1] + 0.2],
            ],
          },
        ],
        weather: {
          condition: 'overcast',
          seaState: 3,
          cloudFloorM: 1200,
          cloudCeilingM: 3800,
        },
      },
    });

    // Thermocline & clouds & local ridge included
    expect(slice.thermocline).toEqual({
      upperDepthM: THERMOCLINE.UPPER_BOUNDARY,
      lowerDepthM: THERMOCLINE.LOWER_BOUNDARY,
    });
    expect(slice.clouds).toEqual({ floorM: 1200, ceilingM: 3800, condition: 'overcast' });
    expect(slice.ridges).toHaveLength(1);
    expect(slice.ridges[0].elevationM).toBe(362);

    // Hidden BLUE submarine and true BLUE ship must NEVER appear in slice.entities
    const entityIds = slice.entities.map((e) => e.id);
    expect(entityIds).toContain(redAnchor.id);
    expect(entityIds).toContain(contact.id);
    expect(entityIds).not.toContain(blueHiddenSub.id);
    expect(entityIds).not.toContain(blueDetectedShip.id);

    const renderedContact = slice.entities.find((e) => e.id === contact.id)!;
    expect(renderedContact.kind).toBe('contact');
    expect(renderedContact.uncertaintyRadiusKm).toBe(4.5);
    expect('actualUnitId' in renderedContact).toBe(false);

    // Friendly missile has 3D trail; undetected enemy missile is excluded
    expect(slice.missiles.map((m) => m.id)).toEqual([friendlyMissile.id]);
    expect(slice.missiles[0].trail3d).toHaveLength(2);
    expect(slice.missiles[0].trail3d[1].altM).toBe(18);
  });

  test('buildAarBoxSlice reconstructs time-filtered 3D unit tracks and combat event markers', () => {
    const aar: BattleAarLedger = {
      tracks: [
        { tick: 0, simTime: 0, unitId: 'u_red', side: 'RED', position: [122.0, 25.0], altitudeM: 9000, status: 'operational' },
        { tick: 20, simTime: 5000, unitId: 'u_red', side: 'RED', position: [122.1, 25.0], altitudeM: 9500, status: 'engaged' },
        { tick: 40, simTime: 10000, unitId: 'u_red', side: 'RED', position: [122.2, 25.0], altitudeM: 10200, status: 'engaged' },
        { tick: 0, simTime: 0, unitId: 'u_blue', side: 'BLUE', position: [122.3, 25.0], altitudeM: -160, status: 'operational' },
        { tick: 20, simTime: 5000, unitId: 'u_blue', side: 'BLUE', position: [122.25, 25.0], altitudeM: -180, status: 'destroyed' },
      ],
      events: [
        {
          id: 'ev_intercept',
          tick: 20,
          simTime: 5000,
          side: 'RED',
          kind: 'intercept',
          title: 'HQ-9B 凌空拦截',
          quantity: 1,
          position: [122.15, 25.0],
          altitudeM: 12400,
        },
        {
          id: 'ev_future',
          tick: 40,
          simTime: 10000,
          side: 'BLUE',
          kind: 'hit',
          title: 'Future hit',
          quantity: 1,
          position: [122.2, 25.0],
          altitudeM: 10200,
        },
      ],
    };

    const sliceAtTick20 = buildAarBoxSlice({
      aar,
      units: {},
      upToTick: 20,
      radiusKm: 120,
    });

    expect(sliceAtTick20.unitTracks).toHaveLength(2);
    const redTrack = sliceAtTick20.unitTracks.find((t) => t.unitId === 'u_red')!;
    expect(redTrack.points).toHaveLength(2); // tick 40 excluded by upToTick=20
    expect(redTrack.points[1].altM).toBe(9500);
    expect(sliceAtTick20.eventMarkers).toHaveLength(1);
    expect(sliceAtTick20.eventMarkers[0].id).toBe('ev_intercept');
    expect(sliceAtTick20.eventMarkers[0].altM).toBe(12400);
  });
});
