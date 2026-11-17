import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { importCmoSqlite, mapCmoArcs } from '../../../src/db/cmoSqliteMapper';
import { validateCatalogIntegrity } from '../../../src/db';
import { assertCatalogShape } from '../../../src/validation/wargameSchemas';
import { createRuntimeUnitFromPlacement, stepSimulationWorld } from '../../../src/engine/simulationEngine';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE EnumOperatorCountry (ID INTEGER PRIMARY KEY, Name TEXT);
    INSERT INTO EnumOperatorCountry VALUES (1, 'United States');
    CREATE TABLE EnumOperatorService (ID INTEGER PRIMARY KEY, Name TEXT);
    INSERT INTO EnumOperatorService VALUES (1, 'Navy');
    CREATE TABLE EnumSensorType (ID INTEGER PRIMARY KEY, Name TEXT);
    INSERT INTO EnumSensorType VALUES (1, 'Radar'), (2, 'Passive Sonar');
    CREATE TABLE EnumWeaponType (ID INTEGER PRIMARY KEY, Name TEXT);
    INSERT INTO EnumWeaponType VALUES (1, 'Guided Missile');
    CREATE TABLE EnumSignatureType (ID INTEGER PRIMARY KEY, Name TEXT);
    INSERT INTO EnumSignatureType VALUES (1, 'Radar EM'), (2, 'Passive Sonar LF');
    CREATE TABLE DataAircraft (ID INTEGER PRIMARY KEY, Name TEXT, OperatorCountry INTEGER, OperatorService INTEGER, SpeedMax REAL, SpeedCruise REAL, AltitudeMin REAL, AltitudeMax REAL, DamagePoints REAL, Hypothetical INTEGER, OODADetectionCycle REAL, OODATargetingCycle REAL, OODAEvasiveCycle REAL);
    INSERT INTO DataAircraft VALUES (1, 'F/A-18 Test', 1, 1, 1000, 450, 0, 50000, 50, 0, 5, 6, 7), (2, 'Future Fighter', 1, 1, 1200, 500, 0, 60000, 50, 1, 1, 1, 1);
    CREATE TABLE DataShip (ID INTEGER PRIMARY KEY, Name TEXT, OperatorCountry INTEGER, SpeedMax REAL, SpeedCruise REAL, DamagePoints REAL);
    INSERT INTO DataShip VALUES (1, 'Test Destroyer', 1, 31, 18, 500);
    CREATE TABLE DataSubmarine (ID INTEGER PRIMARY KEY, Name TEXT, OperatorCountry INTEGER, SpeedMax REAL, SpeedCruise REAL, DepthMax REAL);
    INSERT INTO DataSubmarine VALUES (1, 'Test SSN', 1, 30, 12, 400);
    CREATE TABLE DataSensor (ID INTEGER PRIMARY KEY, Name TEXT, Type INTEGER, RangeMax REAL, RangeMin REAL, CoverageArcDeg REAL, BlindArcRearDeg REAL);
    INSERT INTO DataSensor VALUES (10, 'Test Radar', 1, 100, 1, 360, 0), (11, 'Test Sonar', 2, 20, 0, 360, 60);
    CREATE TABLE DataWeapon (ID INTEGER PRIMARY KEY, Name TEXT, Type INTEGER, AirRangeMax REAL, AirRangeMin REAL, SurfaceRangeMax REAL, SurfaceRangeMin REAL, AirPoK REAL, SpeedMax REAL);
    INSERT INTO DataWeapon VALUES (20, 'Test Missile', 1, 80, 2, 40, 1, 85, 2000);
    CREATE TABLE DataWarhead (ID INTEGER PRIMARY KEY, Name TEXT, Type TEXT, DamagePoints REAL);
    INSERT INTO DataWarhead VALUES (30, 'Blast Fragmentation', 'HE', 60);
    CREATE TABLE DataWeaponWarheads (WeaponID INTEGER, WarheadID INTEGER, Number INTEGER);
    INSERT INTO DataWeaponWarheads VALUES (20, 30, 1);
    CREATE TABLE DataWeaponSensors (WeaponID INTEGER, SensorID INTEGER);
    INSERT INTO DataWeaponSensors VALUES (20, 10);
    CREATE TABLE DataWeaponWRA (WeaponID INTEGER, TargetType TEXT, WeaponQty INTEGER, ShooterQty INTEGER, AutoFireRange REAL, SelfDefenseRange REAL);
    INSERT INTO DataWeaponWRA VALUES (20, 'Aircraft', 2, 1, 75, 5);
    CREATE TABLE DataMount (ID INTEGER PRIMARY KEY, Name TEXT, ROF REAL, Capacity INTEGER, MagazineROF REAL, MagazineCapacity INTEGER, DamagePoints REAL, Trainable INTEGER, Autonomous INTEGER);
    INSERT INTO DataMount VALUES (40, 'Test VLS', 12, 8, 1, 16, 20, 0, 1);
    CREATE TABLE DataMountWeapons (MountID INTEGER, WeaponID INTEGER, DefaultLoad INTEGER, MaxLoad INTEGER);
    INSERT INTO DataMountWeapons VALUES (40, 20, 8, 8);
    CREATE TABLE DataMountSensors (MountID INTEGER, SensorID INTEGER);
    INSERT INTO DataMountSensors VALUES (40, 10);
    CREATE TABLE DataMagazine (ID INTEGER PRIMARY KEY, Name TEXT, ROF REAL, Capacity INTEGER);
    INSERT INTO DataMagazine VALUES (50, 'Test Magazine', 2, 24);
    CREATE TABLE DataMagazineWeapons (MagazineID INTEGER, WeaponID INTEGER);
    INSERT INTO DataMagazineWeapons VALUES (50, 20);
    CREATE TABLE DataPropulsion (ID INTEGER PRIMARY KEY, Name TEXT, Type TEXT);
    INSERT INTO DataPropulsion VALUES (60, 'Test Turbine', 'Gas Turbine');
    CREATE TABLE DataPropulsionPerformance (PropulsionID INTEGER, AltitudeBand INTEGER, Throttle INTEGER, Speed REAL, AltitudeMin REAL, AltitudeMax REAL, Consumption REAL);
    INSERT INTO DataPropulsionPerformance VALUES (60, 1, 2, 18, 0, 0, 10), (60, 1, 4, 31, 0, 0, 30);
    CREATE TABLE DataComm (ID INTEGER PRIMARY KEY, Name TEXT, Type TEXT, Range REAL);
    INSERT INTO DataComm VALUES (70, 'Link 16', 'Datalink', 200);
    CREATE TABLE DataLoadout (ID INTEGER PRIMARY KEY, Name TEXT, ReadyTime REAL, ReadyTime_Sustained REAL, DefaultCombatRadius REAL);
    INSERT INTO DataLoadout VALUES (80, 'CAP', 30, 45, 400);
    CREATE TABLE DataLoadoutWeapons (LoadoutID INTEGER, WeaponID INTEGER, DefaultLoad INTEGER, Internal INTEGER, Optional INTEGER);
    INSERT INTO DataLoadoutWeapons VALUES (80, 20, 4, 0, 0);
    CREATE TABLE DataAircraftLoadouts (AircraftID INTEGER, LoadoutID INTEGER);
    INSERT INTO DataAircraftLoadouts VALUES (1, 80);
    CREATE TABLE DataShipSensors (ShipID INTEGER, ComponentID INTEGER, MastHeight REAL, SB1 INTEGER, SMF1 INTEGER, SMA1 INTEGER, SS1 INTEGER, PS1 INTEGER, PMA1 INTEGER, PMF1 INTEGER, PB1 INTEGER);
    INSERT INTO DataShipSensors VALUES (1, 10, 25, 1, 1, 0, 0, 0, 0, 1, 1);
    CREATE TABLE DataShipMounts (ShipID INTEGER, MountID INTEGER, SB INTEGER, SMF INTEGER, SMA INTEGER, SS INTEGER, PS INTEGER, PMA INTEGER, PMF INTEGER, PB INTEGER);
    INSERT INTO DataShipMounts VALUES (1, 40, 1, 1, 1, 1, 1, 1, 1, 1);
    CREATE TABLE DataShipMagazines (ShipID INTEGER, MagazineID INTEGER);
    INSERT INTO DataShipMagazines VALUES (1, 50);
    CREATE TABLE DataShipPropulsion (ShipID INTEGER, PropulsionID INTEGER);
    INSERT INTO DataShipPropulsion VALUES (1, 60);
    CREATE TABLE DataShipComms (ShipID INTEGER, CommID INTEGER);
    INSERT INTO DataShipComms VALUES (1, 70);
    CREATE TABLE DataShipSignatures (ShipID INTEGER, Type INTEGER, Front REAL, Side REAL, Rear REAL, Top REAL);
    INSERT INTO DataShipSignatures VALUES (1, 1, 10, 20, 15, 20), (1, 2, 90, 100, 95, 90);
  `);
  return db;
}

describe('CMO SQLite importer', () => {
  test('maps DB3000 relational records into a valid runnable catalog', () => {
    const db = fixture();
    try {
      const catalog = importCmoSqlite(db);
      expect(() => assertCatalogShape(catalog)).not.toThrow();
      expect(validateCatalogIntegrity(catalog)).toEqual({ valid: true, errors: [] });
      expect(Object.keys(catalog.platforms)).toHaveLength(3);
      const ship = catalog.platforms.cmo_ship_1;
      expect(ship.dbid).toBe(1);
      expect(ship.propulsionIds).toEqual(['cmo_propulsion_60']);
      expect(ship.commIds).toEqual(['cmo_comm_70']);
      expect(ship.magazineIds).toEqual(['cmo_magazine_50']);
      expect(ship.hasDatalink).toBe(true);
      expect(ship.rcsM2).toBe(10);
      expect(ship.signatures?.[0]).toEqual({ type: 'radar_em', front: 10, side: 20, rear: 15, top: 20 });
      expect(ship.sensorMounts?.[0].arcs).toEqual({ SB: true, SMF: true, SMA: false, SS: false, PS: false, PMA: false, PMF: true, PB: true });
      expect(Object.values(ship.mounts[0].arcs!)).toEqual(Array(8).fill(true));
      expect(ship.mounts[0].mountSpecId).toBe('cmo_mount_40');
      const aircraft = catalog.platforms.cmo_aircraft_1;
      expect(aircraft.ooda).toEqual({ detectionSec: 5, targetingSec: 6, evasionSec: 7 });
      expect(aircraft.maxAltitudeM).toBe(15240);
      expect(catalog.loadouts[aircraft.defaultLoadoutId!].readyTimeSec).toBe(1800);
      const weapon = catalog.weapons.cmo_weapon_20;
      expect(weapon.warheadId).toBe('cmo_warhead_30');
      expect(weapon.domainRangesKm?.air).toEqual({ minKm: 3.704, maxKm: 148.16 });
      expect(weapon.domainPk?.air).toBe(0.85);
      expect(weapon.seekerSensorIds).toEqual(['cmo_sensor_10']);
      expect(weapon.wraRules?.[0].weaponQty).toBe(2);
      expect(catalog.sensors.cmo_sensor_11.coverageArcDeg).toBe(300);
      const units = Object.fromEntries(Object.values(catalog.platforms).map((p, i) => {
        const unit = createRuntimeUnitFromPlacement({ id: `u${i}`, name: p.name, callsign: `u${i}`, platformId: p.id, side: 'BLUE', parentGroupId: 'g', position: [120 + i, 25], heading: 0, doctrine: { roe: 'hold' } }, catalog);
        return [unit.id, unit];
      }));
      const result = stepSimulationWorld({ tick: 0, rngState: 42, simTime: 0, units, contacts: {}, weaponsInFlight: {}, explosions: [], missions: [], score: { redLosses: 0, blueLosses: 0, redMissilesFired: 0, blueMissilesFired: 0, redInterceptions: 0, blueInterceptions: 0, redScore: 0, blueScore: 0, sortiesLaunched: 0, firedEventIds: [] } }, catalog, 0.25, { onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false }, 'GOD');
      expect(result.nextState.simTime).toBe(250);
      expect(Object.keys(result.nextState.units)).toHaveLength(3);
    } finally { db.close(); }
  });

  test('filters platforms and preserves compatible loadout foreign keys', () => {
    const db = fixture();
    try {
      expect(Object.keys(importCmoSqlite(db, { includeHypothetical: true }).platforms)).toHaveLength(4);
      const catalog = importCmoSqlite(db, { platforms: ['F/A-18'], country: 'United States', limit: 1, version: 'test-import' });
      expect(Object.keys(catalog.platforms)).toEqual(['cmo_aircraft_1']);
      expect(catalog.version).toBe('test-import');
      expect(validateCatalogIntegrity(catalog).valid).toBe(true);
      expect(Object.keys(importCmoSqlite(db, { platforms: ['1'], country: '1' }).platforms)).toHaveLength(3);
      expect(Object.keys(importCmoSqlite(db, { country: 'missing' }).platforms)).toHaveLength(0);
      expect(() => importCmoSqlite(db, { limit: NaN })).toThrow();
    } finally { db.close(); }
  });

  test('handles CWDB-style missing optional tables and arc aliases', () => {
    const db = new Database(':memory:');
    try {
      db.exec("CREATE TABLE DataGroundUnit (ID INTEGER PRIMARY KEY, Name TEXT); INSERT INTO DataGroundUnit VALUES (9, 'Infantry'); CREATE TABLE DataFacility (ID INTEGER PRIMARY KEY, Name TEXT); INSERT INTO DataFacility VALUES (10, 'Depot');");
      const catalog = importCmoSqlite(db);
      expect(validateCatalogIntegrity(catalog).valid).toBe(true);
      expect(Object.values(catalog.platforms).map(p => p.domain)).toEqual(['land', 'land']);
      expect(mapCmoArcs({ SB: 1, PB: 0 })).toEqual({ SB: true, SMF: false, SMA: false, SS: false, PS: false, PMA: false, PMF: false, PB: false });
      expect(mapCmoArcs({})).toBeUndefined();
    } finally { db.close(); }
  });
});
