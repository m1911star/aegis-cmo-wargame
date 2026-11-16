# Repository Guidelines

## Project Overview

**AEGIS-CMO** (`aegis-cmo-wargame`) is a browser-only, deterministic, semi-real-time multi-domain operational wargame sandbox inspired by *Command: Modern Operations* (CMO). It simulates air, surface, subsurface, land, and electromagnetic warfare with fog-of-war contact estimation, 4-layer equipment modeling (`Sensor → Weapon → Loadout → Platform`), mission AI, carrier/tanker operations, campaign persistence, and bit-exact replay—requiring zero backend services.

## Architecture & Data Flow

```text
User Input (Map Click / Hotkey / UI Panel)
  │
  ▼
Zustand Store (`src/store/useWargameStore.ts` + slices)
  ├─ Command gates: `canCommandUnit` (`src/engine/commandPolicy.ts`) & `isRouteAllowed` (`src/engine/environment.ts`)
  ├─ `COMMAND_ACTIONS` wrapper records `{ tick, sequence, action, args }`, increments `commandSequence` (worker epoch)
  │
  ▼
RTwP Loop (`src/App.tsx`, 100ms interval, `FIXED_DT_SEC = 0.25s` substeps)
  ├─ `timeScale` 1x/5x  ──► `stepSingleTick(budget)` synchronously on main thread
  └─ `timeScale` 15x/60x ─► `simulationWorkerClient.runBatch(..., epoch = commandSequence)` (`src/engine/workerClient.ts`)
                               │
                               ▼
                 `stepWorkingWorldInPlace` (`src/engine/simulation/worldStepper.ts`)
                   1. `advanceUnitPhysics` (kinematics, fuel burn, waypoints, formations)
                   2. `processPendingSortieOrders` + `advanceAirRefueling`
                   3. `computeContactsOnly` (radar/RCS aspect, ESM, sonar/baffles, weather/LOS, AOU)
                   4. `processPendingTotStrikeOrders` + `runAutoDefense` (mission AI, WRA, SAM/CIWS)
                   5. `runEvasionAndSoftKill` (chaff, flares, acoustic decoys, beam/baffle maneuvers)
                   6. `advanceWeaponPhysics` (datalink midcourse, seeker acquisition, swept-path hit/damage)
                   7. `resolveEventsAndObjectives` + `recordAarTick`
                               │
                               ▼
  `applySimulationResult(result, expectedTick, expectedSeq, expectedScenarioId)`
    ├─ Drops stale worker batches if `tick`, `commandSequence`, or `scenarioId` drifted
    ├──► React HUD/Panels (subscribed via Zustand selectors)
    └──► `TacticalMapCanvas.tsx` (imperative `subscribe` ──► `projectTacticalState` ──► MapLibre `source.setData`)
```

- **Zero-VDOM-Churn Map Rendering**: `src/map/TacticalMapCanvas.tsx` bypasses React re-renders per tick by subscribing imperatively to `useWargameStore` and pushing GeoJSON feature collections from `projectTacticalState()` (`src/map/tacticalProjection.ts`) directly into MapLibre GL sources.
- **4-Layer Catalog Resolution**: Runtime performance, sensors, and weapon mounts are never read off `PlatformSpec` alone; always resolve `PlatformSpec` + `LoadoutSpec` together via `resolveUnitConfiguration(catalog, platformId, activeLoadoutId)` (`src/engine/unitConfiguration.ts`).
- **Three Non-Interchangeable Persistence Formats** (`src/store/battleRecording.ts`, `src/scenarios/compileScenario.ts`):
  1. **Scenario Export** (`compileScenario`): clean starting setup; strips event progress and historical sorties.
  2. **Battle Save** (`captureBattleSave` / `restoreBattleSave`): resumable checkpoint with canonical digest validation.
  3. **Recording v2** (`captureBattleRecording` / `replayBattleRecording`): command log + periodic keyframe snapshots (`SNAPSHOT_INTERVAL_TICKS = 240`).

## Key Directories

- `src/engine/` — Pure deterministic tactical math, sensors, fire control, guidance, environment LOS/polygons, capabilities, and Web Worker protocol.
- `src/engine/simulation/` — Per-substep simulation pipeline (`worldStepper.ts`, `unitPhysics.ts`, `weaponPhysics.ts`, `autoDefense.ts`, `evasion.ts`, `airRefueling.ts`, `eventResolver.ts`, `battleAssessment.ts`).
- `src/db/` — 4-layer `MASTER_EQUIPMENT_CATALOG` (`sensors/`, `weapons/`, `loadouts/`, `platforms/`, `expansion/`, `forcePackages.ts`). Note: `src/catalog/` is only a legacy re-export shim.
- `src/scenarios/` — 7 built-in scenarios, 5-stage campaign (`campaign.ts`), procedural skirmish generator (`skirmishGenerator.ts`), and `compileScenario.ts` normalizer.
- `src/store/` — Authoritative Zustand store (`useWargameStore.ts`), domain slices (`slices/`), save/replay serializer (`battleRecording.ts`), and toast pub/sub (`actionFeedbackBus.ts`).
- `src/map/` — MapLibre GL WebGL layers (`tacticalLayers.ts`), GeoJSON projection (`tacticalProjection.ts`), basemap style loader (`basemaps.ts`, `offlineBasemap.ts`), and `milsymbol` sprite caching.
- `src/validation/` — Zero-dependency schema combinators (`schema.ts`) and boundary/SIDC/SVG sanitizers (`wargameSchemas.ts`).
- `src/components/` — Tactical HUD, ORBAT/mission sidebar (`sidebar/`), unit/contact telemetry (`inspector/`), modals (`modals/`), and primitives (`ui/`).
- `tests/` — Separated into `tests/unit/`, `tests/integration/` (`bun:test`), and `tests/e2e/` (`@playwright/test`).
- `scripts/` — CLI gates for DB/scenario validation (`validateDb.ts`), deterministic headless smoke runs (`smokeScenarios.ts`), and engine coverage enforcement (`checkEngineCoverage.ts`).

## Development Commands

```bash
# Development & Production Build
bun run dev                     # Start Vite dev server on http://0.0.0.0:8081
bun run build                   # Typecheck (tsc -b) + Vite production bundle (dist/)
bun run preview                 # Preview production build locally

# Unit, Integration & Coverage Tests (Bun)
bun test                        # Run all unit + integration tests (*.test.ts)
bun run test:unit               # Run unit tests only (tests/unit)
bun run test:integration        # Run integration & contract tests (tests/integration)
bun test tests/unit/engine/strikePackageTot.test.ts   # Run a single test file
bun run test:coverage           # LCOV run + enforce >= 80% line coverage on src/engine/

# Browser E2E Tests (Playwright Chromium)
bunx playwright install chromium  # One-time browser setup
bun run test:e2e                  # Serial E2E suite on http://127.0.0.1:4173 (tests/e2e/*.e2e.ts)

# Domain Validation, Deterministic Smoke & Docs
bun run validate:db             # Validate 4-layer catalog refs + instantiate all built-in scenarios
bun run smoke:scenarios:check   # Verify deterministic smoke parity against docs/SCENARIO_SMOKE_RESULTS.json
bun run smoke:scenarios         # Regenerate docs/SCENARIO_SMOKE_RESULTS.json after intentional sim/scenario changes
bun run docs:api                # Generate TypeDoc output in docs/api/ (gitignored)
```

*Note*: No ESLint, Biome, or Prettier is configured; `bun run build` (`tsc -b`) is the authoritative static check (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`).

## Code Conventions & Common Patterns

- **Naming & Imports**:
  - Logic/data modules use `camelCase.ts`; React components use `PascalCase.tsx`; constants use `SCREAMING_SNAKE_CASE`.
  - **No path aliases**: `tsconfig.json` defines no `paths`/`baseUrl`; always use relative imports.
  - **Centralized Turf**: Import geospatial helpers via `src/engine/turfGeo.ts` rather than scattering direct `@turf/turf` imports, and use `getCompiledPolygon()` (`src/engine/environment.ts`) so polygon bbox/geometry caches remain effective.
- **Determinism Invariants (`src/engine/`)**:
  - **NEVER** call `Math.random()`, `Date.now()`, or `performance.now()` in simulation/engine logic. Derive randomness solely from the world PRNG (`world.rngState` / `createRandomStream` in `src/engine/determinism.ts`), entity IDs from deterministic counters/ticks, and time from `simTime` (ms) / `FIXED_DT_SEC` (`0.25` s).
  - Any new store action that mutates simulation state **MUST** be registered in `COMMAND_ACTIONS` (`src/engine/determinism.ts`) so `useWargameStore` logs it for replay v2 and bumps `commandSequence` to invalidate in-flight worker batches.
- **State Cloning & Immutability**:
  - Store actions return immutable shallow updates to Zustand; inside `worldStepper.ts`, `cloneWorldForStepping(world)` clones once per batch and `stepWorkingWorldInPlace` mutates that isolated working copy across substeps.
  - **NEVER** mutate an `EquipmentCatalog` object in place: `SimulationWorkerClient` deduplicates worker transfers via `WeakMap<EquipmentCatalog, string>` reference identity. Construct a new catalog object (or `structuredClone` in tests) when modifying specs.
- **Fog-of-War & Command Authority**:
  - Enforce `playerSide` vs `playMode === 'sandbox'` inside store actions via `canCommandUnit(context, unit)` (`src/engine/commandPolicy.ts`), not merely in UI buttons; `activePerspective` (`RED` | `BLUE` | `GOD`) is view-only.
  - `evaluateFireControl`, `autoEvade`, mission AI, threat rings, and `UNIT_DETECTED` category triggers must read **only** side-owned `TacticalContact` estimates—never hidden target `RuntimeUnit` position, HP, or platform truth (world truth is restricted to physical seeker observation and swept-path hit/damage resolution).
- **Navigation, Units & Map Layers**:
  - Units in refueling, evasion, or submarine baffle-clearing park their active route in `airRefuelState.resumeWaypoints`, `evasionState.resumeWaypoints`, or `baffleClearState.savedWaypoints`. Route edits must go through `getPlannedWaypoints` / `applyManualWaypointsToUnit` (`src/store/slices/commandSlice.ts`) instead of overwriting `unit.waypoints` directly.
  - Physical units: coordinates are `[lon, lat]` (`[number, number]`), distances `km`, speeds `kts` (`1.852 km/h`), altitudes/depths `m` (negative underwater). Online map tiles (`OpenFreeMap`) are purely visual; terrain/LOS/coastline physics rely solely on scenario polygons.
  - `map.setStyle(...)` wipes custom MapLibre sources/layers; register any new tactical source/layer inside `installTacticalLayers` (`src/map/tacticalLayers.ts`) and hydrate it in `syncStoreToLayers` (`src/map/TacticalMapCanvas.tsx`).
- **Validation & Feedback**:
  - Reject invalid user orders in store slices via `emitActionFeedback('warning' | 'error' | 'info', message)` (`src/store/actionFeedbackBus.ts`).
  - Sanitize imported scenarios/catalogs and `milsymbol` SIDCs/SVGs through `compileScenario` and `src/validation/wargameSchemas.ts` (`sanitizeSidc`, `sanitizeMilsymbolSvg`).

## Important Files

- `src/App.tsx` — Top-level RTwP tick scheduler (main thread vs Web Worker handoff), global hotkeys (`Space`, `F1`, `F3`, `F9`, `Tab`, `Esc`), and layout shell.
- `src/types/wargame.ts` — Canonical TypeScript interfaces for the 4-layer catalog, runtime entities, fire control, doctrine, missions, and scenarios.
- `src/store/useWargameStore.ts` — Zustand store assembly, `subscribeWithSelector` wiring, and `COMMAND_ACTIONS` replay/epoch interceptor.
- `src/store/battleRecording.ts` — `canonicalBattleState`, FNV-style state digest, save/restore, and Recording v2 replay verification.
- `src/engine/simulation/worldStepper.ts` — Ordered `0.25s` substep execution pipeline (`stepWorkingWorldInPlace`).
- `src/engine/fireControl.ts` & `src/engine/sensors.ts` — `executable | risky | blocked` engagement evaluation, radar/ESM/sonar detection, and contact tracking.
- `src/db/index.ts` & `src/scenarios/builtinScenarios.ts` — `MASTER_EQUIPMENT_CATALOG`, `validateCatalogIntegrity`, and built-in scenario registry.
- `src/map/TacticalMapCanvas.tsx` & `src/map/tacticalProjection.ts` — Imperative MapLibre bridge and store-to-GeoJSON projection.
- `GAMEPLAY.md` & `docs/README.md` — Authoritative domain rules and documentation hygiene policy (never hardcode volatile test/catalog counts in docs; rely on `bun run validate:db` and `docs/SCENARIO_SMOKE_RESULTS.json`).

## Runtime/Tooling Preferences

- **Bun-only workflow**: Always use `bun` (`bun install`, `bun run ...`, `bun test`) with `bun.lock`. Scripts in `scripts/` directly invoke `Bun.file` and `Bun.write` and will not run under plain Node.
- **TypeScript scope**: `tsconfig.json` checks `src` and `tests` (`"moduleResolution": "bundler"`, `"allowImportingTsExtensions": true`, `"noEmit": true`). `scripts/` is outside `tsconfig.json` `include`, so verify script edits by executing them via `bun run`.
- **Vite bundling (`vite.config.ts`)**: Tailwind CSS v4 runs via `@tailwindcss/vite`; production chunks split `maplibre-gl`, `milsymbol`, `@turf`, React/Zustand, and `/src/db/` + `/src/scenarios/` (`wargame-data`). Dev server binds `:8081`, whereas Playwright starts a dedicated dev instance on `127.0.0.1:4173`.

## Testing & QA

- **Strict Runner File-Extension Boundary**:
  - `bun:test` discovers `*.test.ts` in `tests/unit/` and `tests/integration/`.
  - `@playwright/test` discovers **only** `*.e2e.ts` in `tests/e2e/` (1 worker, serial Chromium).
  - **Never** name a Playwright test `*.test.ts` (breaks `bun test`) or name a Bun test `*.spec.ts`/`*.e2e.ts` (skipped by `bun test`). Do not co-locate test files inside `src/`.
- **Fixtures & Isolation Over Global Mocks**:
  - Avoid `mock.module` / global spies. Inject deterministic RNG functions (e.g., `() => 0.5`), `WorkerLike` fakes, or `fetch` callbacks directly, and `structuredClone(MASTER_EQUIPMENT_CATALOG)` before mutating catalog data in tests.
  - `useWargameStore` is a singleton: reset state via `useWargameStore.getState().loadScenario(scenario, false, seed)` and disable `autoPause` (`{ onNewContact: false, onMissileDetected: false, onUnitHitOrDestroyed: false }`) when stepping headless ticks.
- **Required Verification Gates**:
  - Engine changes: maintain **≥ 80% line coverage** across `src/engine/` (`bun run test:coverage`).
  - Catalog/scenario/simulation changes: pass `bun run validate:db`, `bun run build`, and `bun run smoke:scenarios:check` (update `docs/SCENARIO_SMOKE_RESULTS.json` via `bun run smoke:scenarios` only when deterministic trajectory changes are intentional).
