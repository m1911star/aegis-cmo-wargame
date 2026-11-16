# CMO Community Database Schema Alignment & Local Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align AEGIS-CMO's `EquipmentCatalog` data model, validation, engine resolution, simulated catalog, and UI with CMO's DB3000/CWDB relational schema, and build a local `bun:sqlite` `.db3` importer with synthetic DB3000 test coverage.

**Architecture:** Extend `EquipmentCatalog` with optional normalized relational maps (`warheads`, `mounts`, `magazines`, `propulsions`, `comms`), 8-sector (`CmoSectorArc`) sensor/mount coverage, `dBsm`/multi-band `SignatureProfile`s, OODA cycles, and per-domain weapon envelopes. Engine consumers (`unitConfiguration`, `sensors`, `fireControl`, `weaponPhysics`) resolve relational records with full backward compatibility so `smoke:scenarios:check` stays bit-exact. A standalone `scripts/importCmoDb.ts` CLI converts CMO `.db3` SQLite files into valid `EquipmentCatalog` JSON.

**Tech Stack:** TypeScript, Bun (`bun:sqlite`, `bun:test`), Vite, React, MapLibre.

---

### Task 1: Domain Types & CMO Unit/Signature/8-Arc Helpers
- **Files:**
  - Modify: `src/types/wargame.ts`
  - Create: `src/engine/cmoUnits.ts`
  - Test: `tests/unit/engine/cmoUnits.test.ts`
- **Steps:**
  1. Add CMO relational interfaces to `src/types/wargame.ts`: `CmoSectorArc`, `CmoArcMask`, `OodaCycleProfile`, `SignatureType`, `SignatureProfile`, `WarheadSpec`, `MountSpec`, `MagazineSpec`, `PropulsionSpeedPoint`, `PropulsionSpec`, `CommSpec`, `PlatformSensorMount`, `WeaponWraRule`, `WeaponEnvelopeBand`, `TorpedoPerformanceProfile`, plus optional CMO metadata fields on `SensorSpec`, `WeaponSpec`, `LoadoutSpec`, `PlatformSpec`, and optional tables on `EquipmentCatalog`.
  2. Implement `src/engine/cmoUnits.ts` with `dbsmToM2`, `m2ToDbsm`, `nmToKm`, `ftToM`, `isBearingInCmoArcs`, `resolvePlatformRcsProfile`, `resolvePlatformAcousticDb`, and `resolveWeaponDamage`.
  3. Write unit tests in `tests/unit/engine/cmoUnits.test.ts` and run `bun test tests/unit/engine/cmoUnits.test.ts`.
  4. Commit via eval `commit`.

### Task 2: Schema Validation & Catalog Integrity
- **Files:**
  - Modify: `src/validation/wargameSchemas.ts`
  - Modify: `src/db/index.ts`
  - Test: `tests/unit/engine/cmoUnits.test.ts` (or `tests/integration/catalogScenarioContracts.test.ts`)
- **Steps:**
  1. Add schema validators in `src/validation/wargameSchemas.ts` for `warheads`, `mounts`, `magazines`, `propulsions`, `comms`, `signatures`, `sensorMounts`, `wraRules`, and `ooda`.
  2. Update `resolveEquipmentCatalog` and `validateCatalogIntegrity` in `src/db/index.ts` to merge and validate foreign keys (`weapon.warheadId`, `mount.weaponIds`, `mount.sensorIds`, `magazine.weaponIds`, `platform.propulsionIds`, `platform.commIds`, `platform.sensorMounts[].sensorId`, `platform.mounts[].mountSpecId`).
  3. Verify `bun run validate:db` and `bun run build`.
  4. Commit via eval `commit`.

### Task 3: Engine Relational Resolution (`unitConfiguration`, `sensors`, `fireControl`, `weaponPhysics`)
- **Files:**
  - Modify: `src/engine/unitConfiguration.ts`
  - Modify: `src/engine/sensors.ts`
  - Modify: `src/engine/fireControl.ts`
  - Modify: `src/engine/simulation/weaponPhysics.ts`
  - Test: `tests/unit/engine/cmoRelationalResolution.test.ts`
- **Steps:**
  1. Update `ResolvedUnitConfiguration` and `resolveUnitConfiguration` to resolve `sensorMounts` (with 8-arc + mastHeightM), `propulsionIds` speed profiles, `mountSpecId` defaults, and `commIds` datalink capability.
  2. Update `sensors.ts` to evaluate `ResolvedSensorSlot` (per-mount `arcs` & `mastHeightM`) and `resolvePlatformRcsProfile` / `resolvePlatformAcousticDb`.
  3. Update `fireControl.ts` and `weaponPhysics.ts` to resolve `warheadId` damage and `domainRangesKm` / `domainPk` when present.
  4. Write unit tests proving 8-arc directional blind spots, `dBsm` signature radar detection, propulsion speed profile resolution, and warhead damage resolution.
  5. Run `bun test`, `bun run smoke:scenarios:check`, `bun run test:coverage`.
  6. Commit via eval `commit`.

### Task 4: Populate Simulated Catalog with CMO Relational Tables
- **Files:**
  - Create: `src/db/cmoRelationalData.ts`
  - Modify: `src/db/index.ts`
  - Modify: `scripts/validateDb.ts`
- **Steps:**
  1. Build `src/db/cmoRelationalData.ts` generating normalized `warheads`, `mounts`, `magazines`, `propulsions`, and `comms` derived cleanly from and linked to the simulated `MASTER_EQUIPMENT_CATALOG` platforms/weapons/sensors, plus enriching platforms/weapons with `signatures` (`dBsm` / acoustic), `ooda`, and `warheadId` / `propulsionIds` / `commIds` without altering any numeric gameplay values.
  2. Wire into `src/db/index.ts` and update `scripts/validateDb.ts` output to report the relational tables.
  3. Run `bun run validate:db`, `bun run smoke:scenarios:check`, and `bun test`.
  4. Commit via eval `commit`.

### Task 5: Local CMO SQLite (`.db3`) Importer & Synthetic DB3000 Test
- **Files:**
  - Create: `src/db/cmoSqliteMapper.ts`
  - Create: `scripts/importCmoDb.ts`
  - Test: `tests/unit/db/cmoSqliteImporter.test.ts`
- **Steps:**
  1. Implement `src/db/cmoSqliteMapper.ts` (pure mapping functions from `bun:sqlite` DB3000/CWDB query rows & enum dictionaries into `EquipmentCatalog` — handling `DataAircraft`, `DataShip`, `DataSubmarine`, `DataFacility`, `DataGroundUnit`, `DataSensor`, `DataWeapon`, `DataWarhead`, `DataMount`, `DataMagazine`, `DataPropulsion`, `DataPropulsionPerformance`, `DataLoadout`, `DataComm`, signatures, 8-arcs, WRA, and SIDC inference).
  2. Implement `scripts/importCmoDb.ts` CLI (`--db`, `--out`, `--platforms`, `--country`, `--limit`, `--include-hypothetical`).
  3. Write `tests/unit/db/cmoSqliteImporter.test.ts` creating a synthetic SQLite DB3000 database in-memory/temp, importing it into `EquipmentCatalog`, passing `validateCatalogIntegrity()`, spawning units, and stepping `stepSimulationWorld()`.
  4. Run `bun test tests/unit/db/cmoSqliteImporter.test.ts`.
  5. Commit via eval `commit`.

### Task 6: UI Catalog Viewer & Full Verification Gates
- **Files:**
  - Modify: `src/components/modals/CatalogViewerModal.tsx`
- **Steps:**
  1. Add relational tabs (`mounts`, `warheads`, `propulsions`, `comms`) and CMO metadata badges (`DBID`, `Country`, `OODA`, `dBsm`) to `CatalogViewerModal.tsx`.
  2. Run full verification: `bun run validate:db`, `bun test`, `bun run smoke:scenarios:check`, `bun run test:coverage`, `bun run build`.
  3. Commit via eval `commit`.
