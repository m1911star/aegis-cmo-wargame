# CMO Community Database (DB3000 / CWDB) Relational Schema Alignment Design

## 1. Goal & Scope

Align **AEGIS-CMO**'s internal `EquipmentCatalog` data model (`src/types/wargame.ts`, `src/db/`, `src/validation/wargameSchemas.ts`) with the relational structure and field semantics of the **Command: Modern Operations (CMO)** community SQLite databases (`DB3000` / `CWDB`), while preserving 100% deterministic parity with all built-in scenarios (`bun run smoke:scenarios:check`) and existing tests.

This unlocks two capabilities for local testing:
1. **Simulated Catalog on CMO Structure**: The built-in simulated equipment library (`src/db/`) is expressed using CMO-aligned relational entities (`MountSpec`, `MagazineSpec`, `PropulsionSpec`, `WarheadSpec`, `CommSpec`, `WeaponWraEntry`, 8-arc sensor/mount coverage, directional `dBsm`/multi-band signatures, OODA cycles).
2. **Local `.db3` Importer**: A local CLI script (`scripts/importCmoDb.ts` using `bun:sqlite`) reads an unmodified CMO `DB3K_*.db3` or `CWDB_*.db3` SQLite database and exports a valid `EquipmentCatalog` JSON (or scenario overlay) directly consumable by AEGIS-CMO without manual conversion.

---

## 2. Structural Comparison: Current AEGIS-CMO vs CMO DB3000/CWDB

| Concept | Current AEGIS-CMO (4-Layer) | CMO DB3000 / CWDB (Relational) | Target Aligned Model |
|---|---|---|---|
| **Catalog Root** | `sensors`, `weapons`, `loadouts`, `platforms` | `DataSensor`, `DataWeapon`, `DataWarhead`, `DataMount`, `DataMagazine`, `DataPropulsion`, `DataComm`, `DataLoadout`, `DataAircraft`/`Ship`/`Submarine`/`Facility`/`GroundUnit` | Add optional normalized component tables (`mounts`, `magazines`, `propulsions`, `warheads`, `comms`) on `EquipmentCatalog` |
| **Platform Metadata** | `id`, `name`, `className`, `origin`, `domain`, `category` | `ID` (DBID), `Name`, `Comments`, `Type`, `Category`, `OperatorCountry`, `OperatorService`, `YearCommissioned`, `YearDecommissioned`, `PhysicalSizeCode`, `Ergonomics`, `OODADetectionCycle`, `OODATargetingCycle`, `OODAEvasiveCycle`, `DamagePoints`, `MissileDefense`, `Hypothetical`, `Deprecated` | Preserve string `id` + add optional CMO metadata (`dbid`, `cmoTable`, `operatorCountry`, `operatorService`, `yearCommissioned`, `yearDecommissioned`, `missileDefense`, `ooda`, `ergonomics`, `lengthM`, `beamOrSpanM`, `displacementOrWeight`, `crew`, `hypothetical`) |
| **Propulsion & Speed** | Scalar `maxSpeedKts`, `cruiseSpeedKts`, `maxFuelSec` | `DataPropulsion` + `DataPropulsionPerformance` (`AltitudeBand`, `Throttle` 1..4, `Speed`, `AltitudeMin`, `AltitudeMax`, `Consumption`) + `DataFuel` | `PropulsionSpec` with `speedProfile[]` (throttle 1..4, altitude bands in m/ft, consumption); `PlatformSpec.propulsionIds` + `throttle` resolution fallback to scalar `maxSpeedKts`/`cruiseSpeedKts` |
| **Sensors & 8-Arc** | `SensorSpec` holds `coverageArcDeg`, `blindArcRearDeg`; `PlatformSpec.sensorIds: string[]` | `DataSensor` + `Data{Platform}Sensors` (`ComponentID`, `MastHeight`, `SB1..PS2` 8×45° arcs, `Max` arcs, `DegOverride`) | `PlatformSensorMount` (`sensorId`, `arcs?: CmoArcMask`, `mastHeightM?`, `isFireControl?`) alongside backward-compatible `sensorIds`; `SensorSpec` adds `dbid`, `role`, `generation`, `rangeMinKm`, `altitudeBandM`, `scanIntervalSec`, `radarParams`, `esmParams`, `ecmParams`, `sonarParams`, `minimumSignature` |
| **Mounts & Magazines** | `PlatformMountTemplate` inline `{ mountId, weaponId, maxAmmo, reloadTimeSec }` | `DataMount` (`ROF`, `Capacity`, `MagazineROF`, `MagazineCapacity`, `Trainable`, `Autonomous`, `DamagePoints`) + `DataMountWeapons` (`DefaultLoad`, `MaxLoad`) + `DataMagazine` + `DataMagazineWeapons` | `MountSpec` & `MagazineSpec` in catalog; `PlatformMountTemplate` supports `mountSpecId?`, `arcs?: CmoArcMask`, `autonomous?`, `trainable?` while keeping inline `weaponId`, `maxAmmo`, `reloadTimeSec` |
| **Weapons, Warheads & WRA** | `WeaponSpec` flat `maxRangeKm`, `basePk`, `warheadDamage`, `salvoDefault` | `DataWeapon` (per-domain `Air/Surface/Land/SubsurfaceRangeMin/Max` in nm, `Air/Surface/Land/SubsurfacePoK` 0-100, launch/target envelopes, `DataWeaponSensors`, `DataWeaponWarheads` -> `DataWarhead`, `DataWeaponWRA`) | `WarheadSpec` table; `WeaponSpec` adds optional `dbid`, `warheadId`, `warheadCount`, `cepM`, `maxFlightTimeSec`, `domainRangesKm`, `domainPk`, `launchEnvelope`, `targetEnvelope`, `seekerSensorIds`, `wraRules[]`, `torpedoProfile` |
| **Loadouts** | `LoadoutSpec` (`role`, `compatiblePlatformIds`, `mounts`, `speedPenaltyKts`, `rcsPenaltyM2`, `combatRadiusMultiplier`) | `DataLoadout` (`LoadoutRole`, `ReadyTime`, `ReadyTime_Sustained`, `DefaultCombatRadius` nm, `DefaultTimeOnStation` min, `DefaultMissionProfile`, `QuickTurnaround*`, `PayloadWeightDragModifier`) + `DataLoadoutWeapons` (`Optional`, `Internal`) | `LoadoutSpec` adds `dbid`, `readyTimeSec`, `readyTimeSustainedSec`, `defaultCombatRadiusKm`, `defaultTimeOnStationMin`, `missionProfile`, `quickTurnaround`, `payloadWeightDragModifier`; `PlatformMountTemplate` adds `internal?`, `optional?` |
| **Signatures** | `rcsM2`, `rcsProfile: { frontalM2, beamM2, rearM2 }`, `acousticSignatureDb` | `Data{Platform}Signatures` (`Type` -> `EnumSignatureType`, `Front`, `Side`, `Rear`, `Top` in `dBsm`, `dB` VLF/LF/MF/HF, Visual/IR nm) | `SignatureProfile` (`type`, `front`, `side`, `rear`, `top?`) + conversion helpers `dbsmToM2(dbsm)` / `m2ToDbsm(m2)` (`10^(dBsm/10)`) |
| **Comms / Datalinks** | `hasDatalink: boolean` | `DataComm` + `DataCommTypeCanTalkTo` | `CommSpec` table + `PlatformSpec.commIds` (derives `hasDatalink` if any comm supports CEC/datalink) |

---

## 3. Architectural Decisions (Boring, Safe, Zero-Regression)

1. **Additive Relational Normalization on `EquipmentCatalog`**:
   - Keep `sensors`, `weapons`, `loadouts`, `platforms` as required top-level `Record<string, ...>` maps so all existing callers, scenarios, and overlays work without breaking changes.
   - Add optional relational tables on `EquipmentCatalog`:
     - `warheads?: Record<string, WarheadSpec>`
     - `mounts?: Record<string, MountSpec>`
     - `magazines?: Record<string, MagazineSpec>`
     - `propulsions?: Record<string, PropulsionSpec>`
     - `comms?: Record<string, CommSpec>`
   - Update `resolveEquipmentCatalog`, `validateCatalogIntegrity`, `assertCatalogShape`, and `CatalogViewerModal` to merge, validate, and display these new tables.

2. **8-Arc Geometry (`CmoArcMask`) & Unit Conversion Helpers (`src/engine/cmoUnits.ts`)**:
   - Represent CMO's 8 standard 45° sectors (`SB1: 0–45°`, `SMF1: 45–90°`, `SMA1: 90–135°`, `SS1: 135–180°`, `PS1: 180–225°`, `PMA1: 225–270°`, `PMF1: 270–315°`, `PB1: 315–360°`) as a compact type `CmoSectorArc` (`'SB' | 'SMF' | 'SMA' | 'SS' | 'PS' | 'PMA' | 'PMF' | 'PB'`) and `CmoArcMask`.
   - When `PlatformSensorMount.arcs` is present, `isTargetWithinSensorArc` checks the exact 45° sector relative to unit heading; when absent, it falls back to `SensorSpec.coverageArcDeg` / `blindArcRearDeg`.
   - Unit conversion helpers:
     - `dbsmToM2(dbsm: number): number` (`Math.pow(10, dbsm / 10)`) and `m2ToDbsm(m2: number): number` (`10 * Math.log10(Math.max(1e-6, m2))`)
     - `nmToKm(nm: number): number` (`nm * 1.852`)
     - `ftToM(ft: number): number` (`ft * 0.3048`)
     - `resolvePlatformSignatures(platform)` derives `RcsAspectProfile` from `radar_em` signature (`dBsm -> m²`) when `rcsProfile` is omitted, and derives `acousticSignatureDb` from passive sonar signatures when omitted.

3. **Engine Integration (`unitConfiguration.ts`, `sensors.ts`, `fireControl.ts`, `weaponPhysics.ts`)**:
   - `resolveUnitConfiguration`:
     - Resolves `platform.sensorMounts` (if present) + `platform.sensorIds` + `loadout.additionalSensorIds` into `ResolvedSensorSlot[]` (`{ sensorId, arcs?, mastHeightM?, isFireControl? }`) while preserving `sensorIds: string[]`.
     - Resolves `propulsionIds` speed profile (throttle 2 = cruise, throttle 4 = max) when `platform.maxSpeedKts`/`cruiseSpeedKts` are derived or overridden.
     - Resolves `mountSpecId` defaults from `catalog.mounts[mount.mountSpecId]` when inline fields omit them, and resolves `commIds` for `hasDatalink`.
   - `sensors.ts`:
     - Uses `ResolvedSensorSlot` (per-mount `arcs` & `mastHeightM`) in `computeContactsOnly` and `hasDirectReconBdaCoverage`, falling back to `SensorSpec.coverageArcDeg` and `platform.radarAntennaHeightM`.
     - Uses `resolveEffectiveRcsProfile(targetSpec)` so platforms defined purely via CMO `signatures` (`dBsm`) work seamlessly with aspect-dependent radar detection.
   - `fireControl.ts` & `weaponPhysics.ts`:
     - Resolves `weapon.warheadId -> catalog.warheads[id].damagePoints * (warheadCount ?? 1)` as fallback for `warheadDamage`, and `domainRangesKm[targetDomain]` / `domainPk[targetDomain]` when present.
   - **Zero-Regression Invariant**: All existing built-in platforms/weapons/sensors keep their exact numerical values; new CMO relational records and fields only supplement or cleanly resolve identical numbers so `bun run smoke:scenarios:check` passes without drift.

4. **Simulated Catalog Alignment (`src/db/`)**:
   - Populate `MASTER_EQUIPMENT_CATALOG.warheads`, `mounts`, `magazines`, `propulsions`, and `comms` for the simulated catalog.
   - Link built-in platforms, weapons, sensors, and loadouts to these relational records (`warheadId`, `mountSpecId`, `propulsionIds`, `commIds`, `signatures`, `ooda`, `operatorCountry`, `yearCommissioned`) while keeping existing gameplay balance intact.

5. **Local CMO SQLite (`.db3`) Importer (`scripts/importCmoDb.ts`)**:
   - Uses Bun's built-in `bun:sqlite` (`Database.open(path, { readonly: true })`).
   - Supports importing from either `DB3000` or `CWDB` SQLite files via CLI flags:
     - `--db <path/to/DB3K_514.db3>`
     - `--out <path/to/cmo-catalog.json>`
     - `--platforms <comma-separated IDs or query>` / `--country <id|name>` / `--include-hypothetical` / `--limit <n>` (allows exporting either a focused task-force subset for fast browser loading or a broader catalog).
   - Maps `DataAircraft`, `DataShip`, `DataSubmarine`, `DataFacility`, `DataGroundUnit`, `DataSensor`, `DataWeapon`, `DataWarhead`, `DataMount`, `DataMagazine`, `DataPropulsion`, `DataPropulsionPerformance`, `DataLoadout`, `DataComm`, and all `Enum*` + junction tables into `EquipmentCatalog` that passes `validateCatalogIntegrity()`.
   - Tested deterministically in `tests/unit/db/cmoSqliteImporter.test.ts` using an in-memory/temp SQLite database built with the exact DB3000 DDL.

6. **UI Inspection (`CatalogViewerModal.tsx`)**:
   - Add tabs or detail pills for CMO relational tables (`Warheads`, `Mounts`, `Propulsion`, `Comms`) and display CMO metadata (`DBID`, `Country`, `Commissioned`, `OODA`, `dBsm` signatures, `8-Arc` mounts) when present.

---

## 4. Verification Plan

- `bun run validate:db`: verifies all relational foreign keys across `warheads`, `mounts`, `magazines`, `propulsions`, `comms`, `sensors`, `weapons`, `loadouts`, `platforms`.
- `bun test`: all unit & integration tests, plus new unit tests for `cmoUnits` (dBsm/8-arc/signature conversion), `unitConfiguration` relational resolution, and `cmoSqliteImporter` (synthetic DB3000 `.db3` -> `EquipmentCatalog` -> `validateCatalogIntegrity` + `createRuntimeUnitFromPlacement` + `stepSimulationWorld`).
- `bun run smoke:scenarios:check`: guarantees 0% deterministic drift on existing scenarios.
- `bun run test:coverage`: maintains >= 80% line coverage on `src/engine/`.
- `bun run build`: `tsc -b` + Vite production bundle passes cleanly.
