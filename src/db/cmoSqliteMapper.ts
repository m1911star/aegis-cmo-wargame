import type { CmoArcMask, Domain, EquipmentCatalog, PlatformMountTemplate, PlatformSpec, SensorType, SignatureType } from '../types/wargame';
import { CMO_SECTOR_ARCS, dbsmToM2, ftToM, nmToKm } from '../engine/cmoUnits';
import { assertCatalogShape } from '../validation/wargameSchemas';

/** Structural interface deliberately keeps bun:sqlite out of browser bundles. */
export interface CmoSqliteDatabase {
  query(sql: string): { all(): unknown[] };
}
export interface CmoImportOptions {
  platforms?: string[];
  country?: string;
  limit?: number;
  includeHypothetical?: boolean;
  version?: string;
}
type Row = Record<string, unknown>;
const norm = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
function value(r: Row, ...keys: string[]): unknown {
  for (const key of keys) {
    const found = Object.keys(r).find(k => norm(k) === norm(key));
    if (found !== undefined && r[found] !== null) return r[found];
  }
}
const str = (r: Row, ...keys: string[]) => String(value(r, ...keys) ?? '');
const num = (r: Row, keys: string[], fallback = 0) => {
  const v = value(r, ...keys);
  return v !== undefined && Number.isFinite(Number(v)) ? Number(v) : fallback;
};
const positive = (r: Row, keys: string[], fallback = 0) => Math.max(0, num(r, keys, fallback));
const count = (r: Row, keys: string[], fallback = 0) => Math.floor(positive(r, keys, fallback));
const flag = (r: Row, ...keys: string[]) => /^(true|yes|1|-1)$/i.test(str(r, ...keys));
const key = (kind: string, id: unknown) => `cmo_${kind}_${String(id)}`;
const dbid = (r: Row) => count(r, ['ID', 'DBID']);
const description = (r: Row) => str(r, 'Comments', 'Description');
const unique = (ids: string[]) => [...new Set(ids)];

export function mapCmoArcs(row: Row): CmoArcMask | undefined {
  if (!CMO_SECTOR_ARCS.some(a => value(row, `${a}1`, a) !== undefined)) return undefined;
  return Object.fromEntries(CMO_SECTOR_ARCS.map(a => [a, flag(row, `${a}1`, a)]));
}

/** Import tolerates absent version-specific tables, but propagates actual SQLite errors. */
export function importCmoSqlite(db: CmoSqliteDatabase, options: CmoImportOptions = {}): EquipmentCatalog {
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) throw new Error('limit must be a non-negative integer');
  const tables = new Map((db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Row[]).map(r => [norm(str(r, 'name')), str(r, 'name')]));
  const cache = new Map<string, Row[]>();
  const rows = (name: string): Row[] => {
    const actual = tables.get(norm(name));
    if (!actual) return [];
    if (!cache.has(actual)) cache.set(actual, db.query(`SELECT * FROM "${actual.replaceAll('"', '""')}"`).all() as Row[]);
    return cache.get(actual)!;
  };
  const lookup = (table: string, raw: unknown) => {
    const row = rows(table).find(r => str(r, 'ID', 'Code') === String(raw));
    return row ? str(row, 'Name', 'Description') || String(raw ?? '') : String(raw ?? '');
  };
  const related = (table: string, owner: string, id: number) => rows(table).filter(r => num(r, [owner, `${owner}ID`, `${owner}DBID`, 'ParentID'], -1) === id);
  const refs = (table: string, owner: string, id: number, component: string, target: object) => unique(related(table, owner, id).map(r => key(component.toLowerCase(), value(r, `${component}ID`, component, 'ComponentID'))).filter(id => Object.hasOwn(target, id)));
  const catalog: EquipmentCatalog = { version: options.version ?? 'cmo-sqlite-import', sensors: {}, weapons: {}, platforms: {}, loadouts: {}, warheads: {}, mounts: {}, magazines: {}, propulsions: {}, comms: {} };
  for (const r of rows('DataSensor')) {
    const id = key('sensor', dbid(r));
    const label = lookup('EnumSensorType', value(r, 'Type', 'SensorType')).toLowerCase();
    const type: SensorType = /passive.*sonar|sonar.*passive/.test(label) ? 'sonar_passive' : /sonar/.test(label) ? 'sonar_active' : /esm|rwr/.test(label) ? 'esm' : /ecm|jammer/.test(label) ? 'ecm_jammer' : /infrared|optical|irst|visual/.test(label) ? 'irst_optical' : /oth/.test(label) ? 'radar_oth' : 'radar_air_surface';
    const coverage = Math.min(360, Math.max(10, num(r, ['CoverageArcDeg', 'CoverageArc'], 360)));
    const blind = Math.min(180, positive(r, ['BlindArcRearDeg']));
    catalog.sensors[id] = { id, dbid: dbid(r), name: str(r, 'Name') || id, codeName: str(r, 'Name') || id, type, maxRangeKm: nmToKm(positive(r, ['RangeMax', 'MaxRange', 'Range'])), rangeMinKm: nmToKm(positive(r, ['RangeMin'])), isActiveEmitter: !['esm', 'sonar_passive', 'irst_optical'].includes(type), lookDownCapable: flag(r, 'LookDownCapable', 'LookDown'), detectDomains: type.startsWith('sonar') ? ['surface', 'subsurface'] : ['air', 'surface', 'land'], frequencyBand: str(r, 'FrequencyBand', 'Frequency'), coverageArcDeg: Math.min(coverage, 360 - blind), blindArcRearDeg: blind, altitudeMinM: ftToM(num(r, ['AltitudeMin'])), altitudeMaxM: ftToM(num(r, ['AltitudeMax'])), scanIntervalSec: positive(r, ['ScanInterval', 'ScanIntervalSec']), description: description(r) };
  }
  for (const r of rows('DataWarhead')) {
    const id = key('warhead', dbid(r));
    catalog.warheads![id] = { id, dbid: dbid(r), name: str(r, 'Name') || id, type: lookup('EnumWarheadType', value(r, 'Type')), damagePoints: positive(r, ['DamagePoints', 'DP']), explosivesWeightKg: positive(r, ['ExplosivesWeight']), description: description(r) };
  }
  for (const r of rows('DataWeapon')) {
    const id = key('weapon', dbid(r));
    const label = lookup('EnumWeaponType', value(r, 'Type', 'WeaponType'));
    const domainRangesKm: NonNullable<EquipmentCatalog['weapons'][string]['domainRangesKm']> = {};
    const domainPk: Partial<Record<Domain, number>> = {};
    for (const domain of ['air', 'surface', 'subsurface', 'land'] as const) {
      const max = positive(r, [`${domain}RangeMax`]);
      if (max > 0) domainRangesKm[domain] = { minKm: nmToKm(Math.min(max, positive(r, [`${domain}RangeMin`]))), maxKm: nmToKm(max) };
      if (value(r, `${domain}PoK`, `${domain}Pk`) !== undefined) domainPk[domain] = Math.min(1, positive(r, [`${domain}PoK`, `${domain}Pk`]) / 100);
    }
    const torpedo = /torpedo/i.test(label);
    const targetDomains = Object.keys(domainRangesKm) as Domain[];
    if (!targetDomains.length) targetDomains.push(torpedo ? 'subsurface' : 'air');
    const maxRangeKm = Math.max(0.001, nmToKm(positive(r, ['RangeMax', 'MaxRange'])), ...Object.values(domainRangesKm).map(v => v.maxKm));
    const wh = related('DataWeaponWarheads', 'Weapon', dbid(r)).find(w => Object.hasOwn(catalog.warheads!, key('warhead', value(w, 'WarheadID', 'Warhead', 'ComponentID'))));
    const warheadId = wh ? key('warhead', value(wh, 'WarheadID', 'Warhead', 'ComponentID')) : undefined;
    catalog.weapons[id] = { id, dbid: dbid(r), name: str(r, 'Name') || id, codeName: str(r, 'Name') || id, weaponType: label, category: torpedo ? 'torpedo' : /anti.radiation/i.test(label) ? 'arm' : targetDomains.includes('land') ? 'lacm' : targetDomains.includes('surface') ? 'ashm' : 'aam', guidance: torpedo ? 'acoustic_homing' : /infrared/i.test(str(r, 'Guidance')) ? 'infrared' : 'active_radar', targetDomains, canInterceptMissile: flag(r, 'CanInterceptMissile'), maxRangeKm, minRangeKm: Math.min(maxRangeKm, nmToKm(positive(r, ['RangeMin', 'MinRange']))), speedKts: Math.max(1, positive(r, ['SpeedMax', 'Speed'], torpedo ? 40 : 1000)), cruiseAltitudeM: ftToM(num(r, ['CruiseAltitude'], torpedo ? -100 : 10000)), basePk: Math.min(1, positive(r, ['PoK', 'Pk'], 70) / 100), warheadDamage: warheadId ? catalog.warheads![warheadId].damagePoints : positive(r, ['DamagePoints']), warheadId, warheadCount: wh ? Math.max(1, count(wh, ['Number', 'Quantity', 'Count'], 1)) : undefined, salvoDefault: 1, domainRangesKm, domainPk, seekerSensorIds: refs('DataWeaponSensors', 'Weapon', dbid(r), 'Sensor', catalog.sensors), wraRules: related('DataWeaponWRA', 'Weapon', dbid(r)).map(w => ({ targetType: lookup('EnumTargetType', value(w, 'TargetType')), weaponQty: num(w, ['WeaponQty', 'WeaponQuantity'], 1), shooterQty: num(w, ['ShooterQty', 'ShooterQuantity'], 1), autoFireRangePct: Math.max(-99, Math.min(100, num(w, ['AutoFireRange', 'AutoFireRangePct'], 100))), selfDefenseRangeKm: nmToKm(positive(w, ['SelfDefenseRange'])) })), description: description(r) };
  }
  for (const r of rows('DataMount')) {
    const id = key('mount', dbid(r));
    catalog.mounts![id] = { id, dbid: dbid(r), name: str(r, 'Name') || id, rofPerMin: positive(r, ['ROF']), capacity: count(r, ['Capacity']), magazineRofPerMin: positive(r, ['MagazineROF']), magazineCapacity: count(r, ['MagazineCapacity']), damagePoints: positive(r, ['DamagePoints']), trainable: flag(r, 'Trainable'), autonomous: flag(r, 'Autonomous'), weaponIds: refs('DataMountWeapons', 'Mount', dbid(r), 'Weapon', catalog.weapons), sensorIds: refs('DataMountSensors', 'Mount', dbid(r), 'Sensor', catalog.sensors), description: description(r) };
  }
  for (const r of rows('DataMagazine')) {
    const id = key('magazine', dbid(r));
    catalog.magazines![id] = { id, dbid: dbid(r), name: str(r, 'Name') || id, rofPerMin: positive(r, ['ROF']), capacity: count(r, ['Capacity']), weaponIds: refs('DataMagazineWeapons', 'Magazine', dbid(r), 'Weapon', catalog.weapons), description: description(r) };
  }
  for (const r of rows('DataPropulsion')) {
    const id = key('propulsion', dbid(r));
    catalog.propulsions![id] = { id, dbid: dbid(r), name: str(r, 'Name') || id, type: lookup('EnumPropulsionType', value(r, 'Type')), speedProfile: related('DataPropulsionPerformance', 'Propulsion', dbid(r)).map(p => ({ altitudeBand: Math.max(1, Math.min(4, count(p, ['AltitudeBand'], 1))), throttle: Math.max(1, Math.min(4, count(p, ['Throttle'], 2))) as 1 | 2 | 3 | 4, speedKts: positive(p, ['Speed']), altitudeMinM: ftToM(num(p, ['AltitudeMin'])), altitudeMaxM: ftToM(num(p, ['AltitudeMax'])), consumptionPerHour: positive(p, ['Consumption']) })), description: description(r) };
  }
  for (const r of rows('DataComm')) {
    const id = key('comm', dbid(r));
    const type = lookup('EnumCommType', value(r, 'Type'));
    catalog.comms![id] = { id, dbid: dbid(r), name: str(r, 'Name') || id, type, supportsDatalink: flag(r, 'SupportsDatalink', 'Datalink') || /data.?link|link.?\d|cec/i.test(`${type} ${str(r, 'Name')}`), supportsCec: flag(r, 'SupportsCEC') || /cec/i.test(type), rangeKm: nmToKm(positive(r, ['Range', 'RangeMax'])), description: description(r) };
  }
  const payload = (rs: Row[], prefix: string, mountSpecId?: string): PlatformMountTemplate[] => rs.flatMap((r, i) => {
    const weaponId = key('weapon', value(r, 'WeaponID', 'Weapon', 'ComponentID'));
    return catalog.weapons[weaponId] ? [{ mountId: `${prefix}_${i}`, weaponId, mountSpecId, maxAmmo: count(r, ['DefaultLoad', 'MaxLoad', 'Quantity'], 1), reloadTimeSec: mountSpecId && catalog.mounts![mountSpecId].rofPerMin > 0 ? 60 / catalog.mounts![mountSpecId].rofPerMin : 0, internal: flag(r, 'Internal'), optional: flag(r, 'Optional') }] : [];
  });
  for (const type of ['Aircraft', 'Ship', 'Submarine', 'Facility', 'GroundUnit'] as const) {
    const table = `Data${type}` as NonNullable<PlatformSpec['cmoTable']>;
    const domain: Domain = type === 'Aircraft' ? 'air' : type === 'Ship' ? 'surface' : type === 'Submarine' ? 'subsurface' : 'land';
    for (const r of rows(table)) {
      const n = dbid(r), id = key(type.toLowerCase(), n), name = str(r, 'Name') || id;
      const country = lookup('EnumOperatorCountry', value(r, 'OperatorCountry', 'Country'));
      if ((!options.includeHypothetical && flag(r, 'Hypothetical')) || (options.limit !== undefined && Object.keys(catalog.platforms).length >= options.limit)) continue;
      if (options.platforms?.length && !options.platforms.some(q => q === String(n) || name.toLowerCase().includes(q.toLowerCase()))) continue;
      if (options.country && options.country.toLowerCase() !== country.toLowerCase() && options.country !== str(r, 'OperatorCountry', 'Country')) continue;
      const links = (suffix: string) => related(`${table}${suffix}`, type, n);
      const propulsionIds = refs(`${table}Propulsion`, type, n, 'Propulsion', catalog.propulsions!);
      const commIds = refs(`${table}Comms`, type, n, 'Comm', catalog.comms!);
      const speeds = propulsionIds.flatMap(p => catalog.propulsions![p].speedProfile);
      const maxSpeedKts = Math.max(positive(r, ['SpeedMax', 'MaxSpeed']), ...speeds.map(s => s.speedKts), 0);
      const cruiseSpeedKts = Math.min(maxSpeedKts, positive(r, ['SpeedCruise', 'CruiseSpeed'], speeds.find(s => s.throttle === 2)?.speedKts ?? maxSpeedKts * 0.7));
      const minAltitudeM = domain === 'air' ? ftToM(num(r, ['AltitudeMin'])) : domain === 'subsurface' ? -Math.abs(num(r, ['DepthMax', 'MaxDepth'], 300)) : 0;
      const maxAltitudeM = Math.max(minAltitudeM, domain === 'air' ? ftToM(num(r, ['AltitudeMax', 'ServiceCeiling'], 40000)) : 0);
      const signatures = links('Signatures').flatMap(s => {
        const label = norm(lookup('EnumSignatureType', value(s, 'Type', 'SignatureType')));
        const types: SignatureType[] = ['radar_em', 'radar_ad', 'passive_sonar_vlf', 'passive_sonar_lf', 'passive_sonar_mf', 'passive_sonar_hf', 'active_sonar', 'infrared_detect', 'infrared_classify', 'visual_detect', 'visual_classify'];
        const sigType = types.find(t => norm(t) === label) ?? (/radar/.test(label) ? 'radar_em' : undefined);
        return sigType ? [{ type: sigType, front: num(s, ['Front']), side: num(s, ['Side']), rear: num(s, ['Rear']), top: num(s, ['Top']) }] : [];
      });
      const sensorMounts = links('Sensors').flatMap(s => {
        const sensorId = key('sensor', value(s, 'SensorID', 'Sensor', 'ComponentID'));
        return catalog.sensors[sensorId] ? [{ sensorId, arcs: mapCmoArcs(s), mastHeightM: positive(s, ['MastHeight']), componentNumber: count(s, ['ComponentNumber']), isFireControl: flag(s, 'IsFireControl') }] : [];
      });
      const mounts = links('Mounts').flatMap((m, i) => {
        const mountSpecId = key('mount', value(m, 'MountID', 'Mount', 'ComponentID'));
        if (!catalog.mounts![mountSpecId]) return [];
        return payload(related('DataMountWeapons', 'Mount', Number(value(m, 'MountID', 'Mount', 'ComponentID'))), `${id}_mount_${i}`, mountSpecId).map(p => ({ ...p, arcs: mapCmoArcs(m), trainable: catalog.mounts![mountSpecId].trainable, autonomous: catalog.mounts![mountSpecId].autonomous }));
      });
      const radar = signatures.find(s => s.type === 'radar_em' || s.type === 'radar_ad');
      const symbol = domain === 'air' ? 'APMF' : domain === 'surface' ? 'SPSCL' : domain === 'subsurface' ? 'UPS' : 'GPEV';
      catalog.platforms[id] = { id, dbid: n, cmoTable: table, name, className: str(r, 'ClassName') || name, origin: country || 'Unknown', operatorCountry: country, operatorService: lookup('EnumOperatorService', value(r, 'OperatorService')), domain, category: domain === 'air' ? 'fighter' : domain === 'surface' ? 'destroyer' : domain === 'subsurface' ? 'ssn' : 'ground_force', defaultSidcRed: `SH${symbol}------`, defaultSidcBlue: `SF${symbol}------`, maxSpeedKts, cruiseSpeedKts, minAltitudeM, maxAltitudeM, defaultAltitudeM: Math.max(minAltitudeM, Math.min(maxAltitudeM, domain === 'air' ? 6000 : domain === 'subsurface' ? -50 : 0)), radarAntennaHeightM: positive(r, ['MastHeight', 'Height'], 10), maxFuelSec: positive(r, ['MaxFuelSec'], 86400), maxHp: Math.max(1, positive(r, ['DamagePoints'], 100)), rcsM2: radar ? dbsmToM2(radar.front) : 1, acousticSignatureDb: Math.max(0, ...signatures.filter(s => s.type.startsWith('passive_sonar')).map(s => Math.max(s.front, s.side, s.rear))), hasDatalink: commIds.some(c => catalog.comms![c].supportsDatalink), ciwsDefenseProb: 0, sensorIds: unique(sensorMounts.map(s => s.sensorId)), sensorMounts, mounts, propulsionIds, commIds, magazineIds: refs(`${table}Magazines`, type, n, 'Magazine', catalog.magazines!), signatures, hypothetical: flag(r, 'Hypothetical'), ooda: { detectionSec: positive(r, ['OODADetectionCycle']), targetingSec: positive(r, ['OODATargetingCycle']), evasionSec: positive(r, ['OODAEvasiveCycle']) }, description: description(r) };
      const loadoutIds = unique(links('Loadouts').map(l => key('loadout', value(l, 'LoadoutID', 'Loadout', 'ComponentID'))));
      for (const l of rows('DataLoadout').filter(l => loadoutIds.includes(key('loadout', dbid(l))) || num(l, ['AircraftID', 'Aircraft'], -1) === n && type === 'Aircraft')) {
        const lid = key('loadout', dbid(l));
        if (!catalog.loadouts[lid]) catalog.loadouts[lid] = { id: lid, dbid: dbid(l), name: str(l, 'Name') || lid, codeName: str(l, 'Name') || lid, role: 'multi_mission', compatiblePlatformIds: [], mounts: payload(related('DataLoadoutWeapons', 'Loadout', dbid(l)), lid), readyTimeSec: positive(l, ['ReadyTime']) * 60, readyTimeSustainedSec: positive(l, ['ReadyTimeSustained']) * 60, defaultCombatRadiusKm: nmToKm(positive(l, ['DefaultCombatRadius'])), defaultTimeOnStationMin: positive(l, ['DefaultTimeOnStation']), missionProfile: str(l, 'DefaultMissionProfile'), quickTurnaround: flag(l, 'QuickTurnaround'), description: description(l) };
        catalog.loadouts[lid].compatiblePlatformIds.push(id);
        const platform = catalog.platforms[id];
        (platform.availableLoadoutIds ??= []).push(lid);
        platform.defaultLoadoutId ??= lid;
      }
    }
  }
  // Keep platform metadata optional when older databases omit it or use sentinel years.
  for (const platform of Object.values(catalog.platforms)) {
    const source = rows(platform.cmoTable!).find(r => dbid(r) === platform.dbid)!;
    const commissioned = count(source, ['YearCommissioned']);
    const decommissioned = count(source, ['YearDecommissioned']);
    if (commissioned >= 1900 && commissioned <= 2100) platform.yearCommissioned = commissioned;
    if (decommissioned <= 2100) platform.yearDecommissioned = decommissioned;
    platform.lengthM = positive(source, ['Length']);
    platform.beamOrSpanM = positive(source, ['Beam', 'Span', 'Wingspan']);
    platform.crew = count(source, ['Crew']);
    platform.physicalSize = lookup('EnumPhysicalSize', value(source, 'PhysicalSizeCode', 'PhysicalSize'));
    platform.ergonomics = lookup('EnumErgonomics', value(source, 'Ergonomics'));
    platform.missileDefense = positive(source, ['MissileDefense']);
  }
  assertCatalogShape(catalog);
  return catalog;
}

export const mapCmoSqliteDatabase = importCmoSqlite;
