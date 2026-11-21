# AGENTS.md

## Toolchain and commands

- Use Bun only (`bun.lock`); scripts use `Bun.file`, `Bun.write`, and `bun:sqlite` and are not Node-compatible.
- There is no lint or formatter command. `bun run build` (`tsc -b && vite build`) is the authoritative static check; TypeScript is strict and rejects unused locals/parameters and switch fallthrough.
- `tsconfig.json` covers only `src/` and `tests/`. Verify edits under `scripts/` by running the affected script.
- No path aliases are configured; keep imports relative.

```bash
bun run dev                                      # Vite on 0.0.0.0:8081
bun run build                                    # typecheck, then production bundle
bun test                                         # all Bun unit + integration tests
bun run test:unit                                # tests/unit
bun run test:integration                         # tests/integration
bun test tests/unit/engine/strikePackageTot.test.ts  # one Bun test file
bun run test:coverage                            # tests + >=80% aggregate src/engine line coverage
bun run validate:db                              # catalog references + built-in scenario instantiation
bun run smoke:scenarios:check                    # compare deterministic smoke output with committed JSON
bun run smoke:scenarios                          # intentionally regenerate that JSON
bunx playwright test tests/e2e/tacticalScenario.e2e.ts # one E2E file
bun run test:e2e                                 # serial Chromium suite; server auto-starts on 127.0.0.1:4173
bun run docs:api                                 # ignored output at docs/api/
```

- Playwright requires Chromium once: `bunx playwright install chromium`.
- Bun tests must be `tests/{unit,integration}/**/*.test.ts`; Playwright discovers only `tests/e2e/**/*.e2e.ts`. Crossing these suffixes either invokes the wrong runner or silently skips the test.

## Architecture that constrains changes

- This is a browser-only app. `src/store/useWargameStore.ts` is the authoritative state source: commands enter store slices, then `src/engine/simulation/worldStepper.ts` advances fixed `0.25s` substeps. `src/App.tsx` runs low speeds on the main thread and `>=15x` batches through `src/engine/workerClient.ts`.
- `worldStepper.ts` clones the world once per batch, then mutates only that isolated working copy across substeps. Store actions must continue to produce immutable shallow updates.
- High-frequency map state does not flow through React renders. `src/map/TacticalMapCanvas.tsx` subscribes to Zustand and pushes `projectTacticalState()` GeoJSON directly into MapLibre sources.
- Canonical equipment data is in `src/db/`; `src/catalog/` is a compatibility re-export. Canonical unit resolution is `src/engine/unitConfiguration.ts`; `src/db/unitConfiguration.ts` is also only a re-export.

## Simulation invariants

- Engine/simulation code must not use `Math.random()`, `Date.now()`, or `performance.now()`. Use `world.rngState`/`createRandomStream`, deterministic tick/sequence-derived IDs, and `simTime`/`FIXED_DT_SEC`.
- Every in-battle command that mutates simulation state must be listed in `COMMAND_ACTIONS` in `src/engine/determinism.ts`. The wrapper records replay commands and increments the battle-local `commandSequence`. Worker request epochs are separate; writeback must also match the original session and batch inputs.
- Never mutate an `EquipmentCatalog` in place. Unit-resolution caches and worker catalog transfer deduplication are keyed by catalog object identity; construct a new object (or `structuredClone` in tests).
- Runtime performance, sensors, and mounts require platform + active loadout resolution through `resolveUnitConfiguration(...)`; do not read `PlatformSpec` alone.
- Enforce command ownership in store actions with `canCommandUnit(...)`, not only in UI controls. `activePerspective` is view-only; sandbox mode is the explicit cross-side authority bypass.
- Fire control, mission AI, evasion, threat projection, and detection triggers may use only the observing side's `TacticalContact` estimate. Hidden target position, HP, and platform truth are reserved for physical seeker/hit resolution.
- Units in refueling, evasion, or baffle-clearing park routes in `resumeWaypoints`/`savedWaypoints`. Route edits must use the `getPlannedWaypoints` and `applyManualWaypointsToUnit` pattern in `src/store/slices/commandSlice.ts`, not overwrite `unit.waypoints`.

## Geography, map, and boundaries

- Coordinates are `[lon, lat]`; distance is km, speed is knots, altitude/depth is metres (underwater is negative). Online tiles are visual only—scenario polygons decide land/sea, terrain LOS, and acoustics.
- Import Turf only through `src/engine/turfGeo.ts`. Reuse `getCompiledPolygon()` from `src/engine/environment.ts` so polygon geometry/BBox caches remain effective.
- `map.setStyle(...)` removes custom sources/layers. Add tactical sources/layers in `installTacticalLayers()` and hydrate them in `syncStoreToLayers()` so basemap changes reinstall them.
- Validate routes with `isRouteAllowed(...)`. Reject invalid orders in store slices and emit user-visible feedback through `emitActionFeedback(...)`.
- Imported scenarios/catalog overlays must pass through `compileScenario` and `src/validation/wargameSchemas.ts`; sanitize milsymbol SIDCs/SVG before rendering.

## Persistence and tests

- Do not conflate the three persistence contracts: scenario export validates a clean restart (`compileScenario`), battle save is a resumable digest-checked checkpoint, and recording is command history plus snapshots (`src/store/battleRecording.ts`). Save and recording share the immutable opening definition, not the live edited terrain.
- Prefer injected deterministic RNG, `WorkerLike`, or fetch callbacks over global module mocks. Clone `MASTER_EQUIPMENT_CATALOG` before test mutation.
- `useWargameStore` is a singleton. Headless tests should reload a scenario with an explicit seed and disable all auto-pause triggers before stepping.

## Verification gates

- Engine changes: run focused tests, `bun run build`, and `bun run test:coverage`.
- Catalog, scenario, or simulation changes: also run `bun run validate:db` and `bun run smoke:scenarios:check`.
- Run `bun run smoke:scenarios` only when a deterministic trajectory change is intended, then review `docs/SCENARIO_SMOKE_RESULTS.json`.
- Run E2E for changed browser workflows; Playwright is serial (`workers: 1`, no retries).
- `GAMEPLAY.md` is the current rules contract. Do not copy volatile catalog/test counts into docs; command output and `docs/SCENARIO_SMOKE_RESULTS.json` are the sources of truth.
