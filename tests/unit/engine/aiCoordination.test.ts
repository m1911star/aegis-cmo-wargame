import { describe, expect, test } from 'bun:test';
import { MASTER_EQUIPMENT_CATALOG as catalog } from '../../../src/db';
import { computeMissileTerrainDogleg } from '../../../src/engine/environment';
import { getBearingDeg, getDistanceKm } from '../../../src/engine/geometry';
import { isUnitRadarEmittingAtTime } from '../../../src/engine/unitCapabilities';
import { updateUnitOperations } from '../../../src/engine/operations';
import { createRuntimeUnitFromPlacement, stepSimulationWorld, type SimulationWorldState } from '../../../src/engine/simulationEngine';
import type {
  CombatLogEntry,
  InitialUnitPlacement,
  MissionDefinition,
  RuntimeUnit,
  ScoreLedger,
  TacticalContact,
  WeaponInFlight,
} from '../../../src/types/wargame';

const pausesOff = { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false };

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

function makeUnit(id: string, extra: Partial<InitialUnitPlacement> = {}): RuntimeUnit {
  return createRuntimeUnitFromPlacement(
    {
      id,
      name: id,
      callsign: id.toUpperCase(),
      side: 'RED',
      platformId: 'j16d_roaring_wolf',
      parentGroupId: 'red_air',
      position: [122.0, 25.0],
      recoveryPosition: [121.0, 25.0],
      heading: 90,
      speedKts: 480,
      doctrine: { roe: 'free', emconRadar: true, emconJamming: false },
      ...extra,
    },
    catalog,
    () => 0.5
  );
}

function makeContact(
  observerSide: 'RED' | 'BLUE',
  target: RuntimeUnit,
  extra: Partial<TacticalContact> = {}
): TacticalContact {
  return {
    id: `${observerSide}_CONTACT_${target.id}`,
    actualUnitId: target.id,
    observerSide,
    targetSide: target.side,
    domain: target.domain,
    classification: 'identified',
    identifiedCategory: target.category,
    bdaStatus: 'intact',
    displayName: target.name,
    sidc: target.sidc,
    estimatedPosition: [...target.position],
    truePosition: [...target.position],
    uncertaintyRadiusKm: 0.3,
    heading: target.heading,
    speedKts: target.speedKts,
    altitudeM: target.altitudeM,
    firstDetectedTime: 0,
    lastDetectedTime: 5000,
    detectedBySources: ['OBS'],
    sourceUnitIds: ['obs'],
    fireControlSourceIds: ['obs'],
    emitterObserved: false,
    threatLevel: 'high',
    ...extra,
  };
}

describe('AI tactical coordination and force preservation', () => {
  test('critical HP (<= 25% maxHp) forces airborne mission unit to disengage and RTB', () => {
    const striker = makeUnit('red_striker', {
      platformId: 'j15t_flanker',
      loadoutId: 'loadout_j15t_maritime_strike',
      assignedMissionId: 'm_asuw',
      position: [122.0, 25.0],
      recoveryPosition: [121.0, 25.0],
    });
    const enemy = makeUnit('blue_ddg', {
      side: 'BLUE',
      platformId: 'arleigh_burke_flt3',
      position: [122.4, 25.0],
      speedKts: 15,
    });
    const contact = makeContact('RED', enemy, { emitterObserved: true });
    const mission: MissionDefinition = {
      id: 'm_asuw',
      name: 'ASuW',
      side: 'RED',
      type: 'asuw_patrol',
      isActive: true,
      areaPolygon: [[121.8, 24.8], [122.8, 24.8], [122.8, 25.2], [121.8, 25.2]],
      prosecuteOutsideAreaKm: 40,
      description: '',
    };

    const logs: CombatLogEntry[] = [];
    // Initially healthy -> presses into engagement
    updateUnitOperations(striker, { red_striker: striker, blue_ddg: enemy }, { [contact.id]: contact }, [mission], catalog, 5000, 1, emptyScore(), logs, {}, undefined, 'RED');
    expect(striker.status).toBe('operational');
    expect(striker.missionTargetId).toBe(contact.id);

    // HP drops to 25% of maxHp -> disengages and RTBs toward recoveryPosition
    striker.hp = Math.floor(striker.maxHp * 0.25);
    striker.nextMissionDecisionTime = 0;
    updateUnitOperations(striker, { red_striker: striker, blue_ddg: enemy }, { [contact.id]: contact }, [mission], catalog, 6000, 1, emptyScore(), logs, {}, undefined, 'RED');

    expect(striker.status).toBe('returning');
    expect(striker.missionState).toBe('egress');
    expect(striker.returnReason).toBe('damage');
    expect(striker.missionTargetId).toBeUndefined();
    expect(striker.waypoints[0].position).toEqual([121.0, 25.0]);
  });

  test('non-player AI surface unit with critical HP breaks off into defensive egress away from threat', () => {
    const blueShip = makeUnit('blue_ffg', {
      side: 'BLUE',
      platformId: 'constellation_ffg',
      position: [122.0, 25.0],
      recoveryPosition: [122.0, 25.0],
      speedKts: 20,
      waypoints: [[121.5, 25.0]],
    });
    const redThreat = makeUnit('red_ddg', {
      side: 'RED',
      platformId: 'type055_destroyer',
      position: [121.6, 25.0],
      speedKts: 20,
    });
    const threatContact = makeContact('BLUE', redThreat, { emitterObserved: true, lastDetectedTime: 5000 });
    blueShip.hp = Math.floor(blueShip.maxHp * 0.2);

    const logs: CombatLogEntry[] = [];
    // Player is RED, so BLUE unit is AI-controlled non-player side
    updateUnitOperations(blueShip, { blue_ffg: blueShip, red_ddg: redThreat }, { [threatContact.id]: threatContact }, [], catalog, 5000, 1, emptyScore(), logs, {}, undefined, 'RED');

    expect(blueShip.status).toBe('returning');
    expect(blueShip.missionState).toBe('egress');
    expect(blueShip.returnReason).toBe('damage');
    expect(blueShip.waypoints).toHaveLength(1);
    const egressBearing = getBearingDeg(blueShip.position, blueShip.waypoints[0].position);
    // Threat is due west (270°), so egress should head generally east (~90°)
    expect(Math.abs(((egressBearing - 90 + 540) % 360) - 180)).toBeLessThan(40);
  });

  test('manual player-side unit retains manual control on low HP, while airborne fuel reserve still triggers RTB', () => {
    const manualFighter = makeUnit('player_j20', {
      side: 'RED',
      platformId: 'j20_mighty_dragon',
      position: [122.0, 25.0],
      recoveryPosition: [121.0, 25.0],
      speedKts: 500,
      waypoints: [[122.5, 25.0]],
    });
    manualFighter.hp = Math.floor(manualFighter.maxHp * 0.2);

    const world: SimulationWorldState = {
      startTime: 0,
      simTime: 0,
      tick: 0,
      rngState: 1,
      units: { player_j20: manualFighter },
      contacts: {},
      weaponsInFlight: {},
      explosions: [],
      missions: [],
      score: emptyScore(),
    };
    const afterDamage = stepSimulationWorld(world, catalog, 1, pausesOff, 'RED').nextState;
    expect(afterDamage.units.player_j20.status).toBe('operational');
    expect(afterDamage.units.player_j20.waypoints).toHaveLength(1);
    expect(afterDamage.units.player_j20.waypoints[0].position).toEqual([122.5, 25.0]);

    // Fuel drops to critical reserve -> airborne RTB triggers
    afterDamage.units.player_j20.fuelRemainingSec = 100;
    const afterFuel = stepSimulationWorld(afterDamage, catalog, 1, pausesOff, 'RED').nextState;
    expect(afterFuel.units.player_j20.status).toBe('returning');
    expect(afterFuel.units.player_j20.returnReason).toBe('fuel');
    expect(afterFuel.units.player_j20.waypoints[0].position).toEqual([121.0, 25.0]);
  });

  test('SEAD and EW/ARM units prioritize active radar emitters (SAM, radar site, destroyer, AWACS) over closer non-emitters', () => {
    const seadFlight = makeUnit('sead_j16d', {
      platformId: 'j16d_roaring_wolf',
      loadoutId: 'loadout_j16d_sead_escort',
      assignedMissionId: 'm_sead',
      position: [122.0, 25.0],
    });
    const seadMission: MissionDefinition = {
      id: 'm_sead',
      name: 'SEAD',
      side: 'RED',
      type: 'sead',
      isActive: true,
      areaPolygon: [[121.8, 24.5], [123.2, 24.5], [123.2, 25.5], [121.8, 25.5]],
      prosecuteOutsideAreaKm: 50,
      description: '',
    };

    const closeAsm = makeUnit('blue_asm', {
      side: 'BLUE',
      platformId: 'yj12b_coastal_asm',
      position: [122.15, 25.0], // ~15 km away, NOT a primary radar emitter category
      speedKts: 0,
    });
    const farSam = makeUnit('blue_sam', {
      side: 'BLUE',
      platformId: 'patriot_pac3_site',
      position: [122.65, 25.0], // ~65 km away, active SAM radar emitter
      speedKts: 0,
    });
    const farAwacs = makeUnit('blue_awacs', {
      side: 'BLUE',
      platformId: 'e2d_hawkeye',
      position: [122.8, 25.1], // ~81 km away, active AWACS emitter
      speedKts: 300,
    });
    const silentSite = makeUnit('blue_radar_off', {
      side: 'BLUE',
      platformId: 'blue_radar_station',
      position: [122.1, 25.0], // ~10 km away, silent
      speedKts: 0,
    });

    const cAsm = makeContact('RED', closeAsm, { emitterObserved: true });
    const cSam = makeContact('RED', farSam, { emitterObserved: true });
    const cAwacs = makeContact('RED', farAwacs, { emitterObserved: true });
    const cSilent = makeContact('RED', silentSite, { emitterObserved: false });

    const units = { sead_j16d: seadFlight, blue_asm: closeAsm, blue_sam: farSam, blue_awacs: farAwacs, blue_radar_off: silentSite };
    const contacts = { [cAsm.id]: cAsm, [cSam.id]: cSam, [cAwacs.id]: cAwacs, [cSilent.id]: cSilent };

    updateUnitOperations(seadFlight, units, contacts, [seadMission], catalog, 5000, 1, emptyScore(), []);
    // Must pick active SAM over closer active ASM battery and silent radar site
    expect(seadFlight.missionTargetId).toBe(cSam.id);

    // When SAM goes offline/destroyed, SEAD can prosecute active emitting AWACS
    delete contacts[cSam.id];
    delete contacts[cAsm.id];
    seadFlight.nextMissionDecisionTime = 0;
    updateUnitOperations(seadFlight, units, contacts, [seadMission], catalog, 10000, 1, emptyScore(), []);
    expect(seadFlight.missionTargetId).toBe(cAwacs.id);

    // Also verify destroyer (surface active emitter) beats closer non-emitter on EW/ARM strike
    const armAsUwUnit = makeUnit('arm_j15t', {
      platformId: 'j15t_flanker',
      loadoutId: 'loadout_j15t_sead',
      assignedMissionId: 'm_asuw_arm',
      position: [122.0, 25.0],
    });
    const asuwMission: MissionDefinition = { ...seadMission, id: 'm_asuw_arm', type: 'asuw_patrol' };
    const silentShip = makeUnit('blue_lha_silent', {
      side: 'BLUE',
      platformId: 'america_lha',
      position: [122.15, 25.0],
      speedKts: 15,
    });
    const activeDdg = makeUnit('blue_ddg_active', {
      side: 'BLUE',
      platformId: 'arleigh_burke_flt3',
      position: [122.6, 25.0],
      speedKts: 20,
    });
    const cLha = makeContact('RED', silentShip, { emitterObserved: false });
    const cDdg = makeContact('RED', activeDdg, { emitterObserved: true });
    updateUnitOperations(
      armAsUwUnit,
      { arm_j15t: armAsUwUnit, blue_lha_silent: silentShip, blue_ddg_active: activeDdg },
      { [cLha.id]: cLha, [cDdg.id]: cDdg },
      [asuwMission],
      catalog,
      5000,
      1,
      emptyScore(),
      []
    );
    expect(armAsUwUnit.missionTargetId).toBe(cDdg.id);
  });

  test('land_strike units coordinate with active SEAD by preferring softened/non-SAM targets and holding when ARM is in flight', () => {
    const seadEscort = makeUnit('red_sead', {
      platformId: 'j16d_roaring_wolf',
      loadoutId: 'loadout_j16d_sead_escort',
      assignedMissionId: 'm_sead',
      position: [122.0, 25.0],
    });
    seadEscort.missionState = 'engaging';
    const striker = makeUnit('red_striker', {
      platformId: 'h6n_bomber',
      assignedMissionId: 'm_strike',
      position: [121.9, 25.0],
    });

    const seadMission: MissionDefinition = {
      id: 'm_sead',
      name: 'SEAD',
      side: 'RED',
      type: 'sead',
      isActive: true,
      areaPolygon: [[121.8, 24.6], [123.2, 24.6], [123.2, 25.4], [121.8, 25.4]],
      prosecuteOutsideAreaKm: 40,
      description: '',
    };
    const strikeMission: MissionDefinition = {
      ...seadMission,
      id: 'm_strike',
      name: 'Land Strike',
      type: 'land_strike',
    };

    const activeSam = makeUnit('blue_sam', {
      side: 'BLUE',
      platformId: 'patriot_pac3_site',
      position: [122.2, 25.0], // closer to striker
      speedKts: 0,
    });
    const airbaseTarget = makeUnit('blue_ab', {
      side: 'BLUE',
      platformId: 'blue_airbase',
      position: [122.7, 25.0], // farther, non-SAM target
      speedKts: 0,
    });

    const cSam = makeContact('RED', activeSam, { emitterObserved: true, bdaStatus: 'intact' });
    const cAb = makeContact('RED', airbaseTarget, { emitterObserved: false, bdaStatus: 'intact' });
    const units = { red_sead: seadEscort, red_striker: striker, blue_sam: activeSam, blue_ab: airbaseTarget };

    // With active friendly SEAD operating against active SAM threat, striker prefers non-SAM target over closer active SAM
    updateUnitOperations(
      striker,
      units,
      { [cSam.id]: cSam, [cAb.id]: cAb },
      [seadMission, strikeMission],
      catalog,
      5000,
      1,
      emptyScore(),
      []
    );
    expect(striker.missionTargetId).toBe(cAb.id);

    // If only the active SAM remains AND a friendly ARM is already in flight against it, striker holds standoff
    const armInFlight: WeaponInFlight = {
      id: 'arm_1',
      weaponId: 'ld10_arm',
      name: 'LD-10',
      side: 'RED',
      shooterId: seadEscort.id,
      shooterName: seadEscort.callsign,
      targetId: activeSam.id,
      targetType: 'unit',
      position: [122.1, 25.0],
      launchPosition: [122.0, 25.0],
      trail: [],
      altitudeM: 12000,
      heading: 90,
      speedKts: 2400,
      distanceRemainingKm: 10,
      maxRangeKm: 180,
      traveledKm: 10,
      basePk: 0.82,
      warheadDamage: 62,
    };
    striker.nextMissionDecisionTime = 0;
    striker.missionTargetId = undefined;
    striker.waypoints = [];
    cSam.lastDetectedTime = 10000;
    updateUnitOperations(
      striker,
      units,
      { [cSam.id]: cSam },
      [seadMission, strikeMission],
      catalog,
      10000,
      1,
      emptyScore(),
      [],
      { arm_1: armInFlight }
    );
    expect(striker.missionTargetId).toBeUndefined();
    expect(striker.missionState).toBe('on_station');

    // Once SAM is softened (damaged_suspected / radar silent), striker engages it cleanly
    cSam.bdaStatus = 'damaged_suspected';
    cSam.emitterObserved = false;
    cSam.lastDetectedTime = 15000;
    striker.nextMissionDecisionTime = 0;
    updateUnitOperations(
      striker,
      units,
      { [cSam.id]: cSam },
      [seadMission, strikeMission],
      catalog,
      15000,
      1,
      emptyScore(),
      []
    );
    expect(striker.missionTargetId as string | undefined).toBe(cSam.id);
    expect(striker.missionState).toBe('engaging');
    expect(getDistanceKm(striker.waypoints[0].position, cSam.estimatedPosition)).toBeLessThan(0.1);
  });

  test('maritime_strike prioritizes carrier HVUs, holds standoff launch station, and generates ridge doglegs', () => {
    const bomber = makeUnit('red_h6_ms', {
      platformId: 'j15t_flanker',
      loadoutId: 'loadout_j15t_maritime_strike',
      assignedMissionId: 'm_ms',
      position: [121.0, 25.0],
      doctrine: { roe: 'free', automaticFireRangeFraction: 0.8 },
    });
    const blueFfg = makeUnit('blue_ffg_escort', {
      side: 'BLUE',
      platformId: 'constellation_ffg',
      position: [122.6, 25.0], // closer escort
    });
    const cvnPlatformId =
      Object.values(catalog.platforms).find((p) => p.category === 'carrier' && p.origin === 'BLUE')?.id ??
      'america_lha';
    const blueCvn = makeUnit('blue_cvn_hvu', {
      side: 'BLUE',
      platformId: cvnPlatformId,
      position: [123.0, 25.0], // farther carrier HVU (~200 km)
    });
    const cFfg = makeContact('RED', blueFfg);
    const cCvn = makeContact('RED', blueCvn);
    const msMission: MissionDefinition = {
      id: 'm_ms',
      name: 'Maritime Strike',
      side: 'RED',
      type: 'maritime_strike',
      isActive: true,
      areaPolygon: [[122.4, 24.6], [123.4, 24.6], [123.4, 25.4], [122.4, 25.4]],
      prosecuteOutsideAreaKm: 60,
      description: '',
    };

    updateUnitOperations(
      bomber,
      { [bomber.id]: bomber, [blueFfg.id]: blueFfg, [blueCvn.id]: blueCvn },
      { [cFfg.id]: cFfg, [cCvn.id]: cCvn },
      [msMission],
      catalog,
      5000,
      1,
      emptyScore(),
      []
    );
    // Prioritizes CVN/LHA over closer frigate, and holds standoff orbit instead of flying onto CVN
    expect(bomber.missionTargetId).toBe(cCvn.id);
    expect(bomber.waypoints.length).toBeGreaterThan(0);
    expect(getDistanceKm(bomber.waypoints[0].position, cCvn.estimatedPosition)).toBeGreaterThan(80);

    // Mountain ridge blocking sea-skimming AShM produces a valid bypass dogleg
    const ashmSpec = Object.values(catalog.weapons).find((w) => w.category === 'ashm' && w.cruiseAltitudeM < 100)!;
    const ridgeEnv = {
      landPolygons: [
        {
          id: 'island_ridge',
          name: 'Central Ridge',
          elevationM: 1200,
          areaPolygon: [
            [121.95, 24.92],
            [122.05, 24.92],
            [122.05, 25.08],
            [121.95, 25.08],
          ] as [number, number][],
        },
      ],
      acousticZones: [],
    };
    const dogleg = computeMissileTerrainDogleg(
      [121.5, 25.0],
      [122.5, 25.0],
      ashmSpec,
      ridgeEnv
    );
    expect(dogleg).toBeDefined();
    expect(dogleg!.length).toBe(1);

    // Distant maritime_strike striker approaches standoff release point via terrain-bypassing route
    bomber.position = [119.5, 25.0];
    bomber.altitudeM = 400;
    bomber.nextMissionDecisionTime = 0;
    bomber.waypoints = [];
    updateUnitOperations(
      bomber,
      { [bomber.id]: bomber, [blueCvn.id]: blueCvn },
      { [cCvn.id]: cCvn },
      [msMission],
      catalog,
      10000,
      1,
      emptyScore(),
      [],
      {},
      ridgeEnv
    );
    expect(bomber.waypoints.length).toBeGreaterThanOrEqual(1);
  });

  test('executes intermittent EMCON radar duty-cycle, auto ASW sonobuoy drops, and low-fuel auto AAR', () => {
    const fighterA = makeUnit('blink_alpha', {
      doctrine: { roe: 'free', emconRadar: true, emconRadarIntermittent: true },
    });
    const samples: boolean[] = [];
    for (let t = 0; t < 60_000; t += 5_000) {
      samples.push(isUnitRadarEmittingAtTime(fighterA, t));
    }
    // 15s ON out of 60s = 3 of 12 samples true
    expect(samples.filter(Boolean).length).toBe(3);

    // Auto sonobuoy drop on ASW aircraft over open water
    const aswPlatformId = Object.values(catalog.platforms).find(
      (p) => p.domain === 'air' && p.deployables?.some((d) => catalog.platforms[d.platformId]?.category === 'sonobuoy')
    )!.id;
    const mpa = makeUnit('red_mpa_asw', {
      platformId: aswPlatformId,
      assignedMissionId: 'm_asw',
      position: [122.5, 25.0],
      doctrine: { roe: 'free', autoDeploySonobuoys: true },
    });
    const startBuoys = Object.values(mpa.deployableInventory).reduce((s, v) => s + v, 0);
    expect(startBuoys).toBeGreaterThan(0);
    const unitsMap: Record<string, RuntimeUnit> = { [mpa.id]: mpa };
    const aswMission: MissionDefinition = {
      id: 'm_asw',
      name: 'ASW Barrier',
      side: 'RED',
      type: 'asw_patrol',
      isActive: true,
      areaPolygon: [[122.2, 24.8], [122.8, 24.8], [122.8, 25.2], [122.2, 25.2]],
      prosecuteOutsideAreaKm: 20,
      description: '',
    };
    updateUnitOperations(mpa, unitsMap, {}, [aswMission], catalog, 5000, 1, emptyScore(), []);
    const spawnedBuoys = Object.values(unitsMap).filter((u) => u.category === 'sonobuoy');
    expect(spawnedBuoys).toHaveLength(1);

    // Low-fuel auto AAR joins nearest friendly tanker queue
    const tanker = makeUnit('red_tanker', {
      platformId: 'y20u_tanker',
      position: [122.15, 25.0],
      speedKts: 420,
      altitudeM: 8000,
    });
    const thirstyJet = makeUnit('red_thirsty', {
      platformId: 'j15t_flanker',
      position: [122.0, 25.0],
      recoveryPosition: [119.0, 25.0],
      doctrine: { roe: 'free', autoAirRefuel: true },
    });
    thirstyJet.fuelRemainingSec = Math.round(thirstyJet.maxFuelSec * 0.28);
    const aarWorld: SimulationWorldState = {
      startTime: 0,
      tick: 0,
      simTime: 5000,
      rngState: 99,
      units: { [tanker.id]: tanker, [thirstyJet.id]: thirstyJet },
      contacts: {},
      weaponsInFlight: {},
      explosions: [],
      missions: [],
      score: emptyScore(),
    };
    const stepped = stepSimulationWorld(aarWorld, catalog, 0.25, pausesOff, 'RED');
    expect(stepped.nextState.units[thirstyJet.id].airRefuelState?.tankerId).toBe(tanker.id);
    expect(stepped.nextState.units[tanker.id].aarQueue).toContain(thirstyJet.id);
  });
});
