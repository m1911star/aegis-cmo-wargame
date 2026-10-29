# Gameplay Contracts

## Design boundary

Hard constraints protect consistent rules. Soft risks preserve player choice. Objectives define success, and diagnostics explain decisions. Adding restrictions is not a substitute for believable simulation or interesting play.

This implementation is a lightweight game model, not a validated model of real equipment performance. Existing catalog names and descriptions do not establish the accuracy of their parameters.

## Authority and information

- `playerSide` defines command authority; `activePerspective` is only an observation view. `playMode: sandbox` explicitly grants editor authority. GOD view alone does not grant commands.
- Unit, mission, hangar and loadout actions enforce command authority in the store, not only in buttons. Spawning requires sandbox mode. Runtime loadout changes remain an editor feature.
- Ordinary enemy selection resolves to a contact owned by the player's side. Detection logs contain `contactId`, not a selectable hostile runtime unit. Enemy command logs and exact damage reports are withheld until debrief; own-platform losses remain available.
- Observed enemy missiles use the same radar observation model as interception. Revealing a missile does not reveal its historical trajectory back to launch.
- This is a local single-player sandbox. The client holds world truth; these boundaries prevent gameplay/UI leaks, not inspection through developer tools or a hostile network client.

## Fire control

`evaluateFireControl` returns `executable`, `risky` or `blocked`, with shared reasons for the engine and UI.

Hard constraints include authority (checked at the command boundary), platform capability, ammunition, mount cooldown, weapon/target compatibility, range to the observed aimpoint, and mandatory guidance support. It does not consult the hidden target's current position or HP to authorize an attack.

Stale information, large uncertainty and missing optional updates are risks. HOLD means no automatic fire, not an absolute prohibition on manual authorization. Risk authorization applies to one order, retains the standing doctrine and rechecks hard constraints at execution. Automatic offensive fire is conservative and declines risky solutions. Mission doctrine overrides apply to fire/pursuit policy; sensor EMCON is controlled on the runtime unit.

An undiscovered runtime ID is not a blind-fire aimpoint. This version allows firing at retained contacts, not arbitrary coordinate or bearing-only orders. A mandatory-support profile cannot be bypassed with risk confirmation.

## Guidance and collision

- Midcourse steering uses contact estimates delivered by an active observation source and, when shared across platforms, a compatible receiving datalink.
- Lost updates preserve the last estimate and extrapolate its recorded heading/speed. They never read hidden target motion for steering.
- Seeker activation distance, detection distance, full field-of-view angle and search timeout are separate configurable values in `WeaponSpec.guidanceProfile`.
- Search can continue after an initial failure. Acquisition and continued lock require the seeker's own current range/FOV/domain conditions. Semi-active guidance also requires configured support. Passive anti-radiation guidance requires a detectable emitter; it is not globally omniscient.
- World truth is read only inside seeker observation and physical collision/damage resolution. Interceptors use the same guidance boundary as offensive weapons.
- Swept-path closest approach replaces coarse proximity thresholds. The application uses 0.25-second substeps; fixing the step establishes repeatability, not proven physical accuracy.

Default seeker parameters are deliberately provisional game values, differentiated by broad guidance family. They are overrideable and validated, but do not claim empirical calibration. Terrain masking, detailed propagation, decoys, seeker target switching and full missile energy models are out of scope.

## Resources, missions and damage

- Aircraft fuel is a cruise-time budget with a speed-dependent burn multiplier. Return reserve is estimated travel time to an available compatible carrier/base or a declared departure point, plus a safety margin. Carrier-launched aircraft cannot return to a fictitious destroyed host.
- Support aircraft do not withdraw simply because they have no weapons. Assigned attack/patrol aircraft withdraw when their task-relevant weapon set is depleted.
- Recovered units leave active movement, sensors, fire and task rosters, without being counted as losses. Recovery does not manufacture replacement aircraft, fuel or ammunition. There is no repair/rearm turnaround loop in this version.
- Mission AI uses observed contacts of the relevant domain, patrol-area/maximum-pursuit boundaries and a five-second decision interval. It returns to patrol after disengagement; manually assigned navigation takes priority. It is not an optimal tactical planner.
- Coarse domain-specific damage profiles reduce speed, radar capability and reload performance. Mission-killed platforms cannot launch weapons, but an aircraft that safely withdrew is not a mission kill.
- Damage credit has a per-victim ceiling. Mission-kill credit and subsequent destruction share that ledger; key-target bonuses and objective rewards are not repeatedly granted each tick.

## Objectives and debrief

Objectives support destruction, capability disablement, observation, preservation and withdrawal. Preservation may require either survival or retained combat capability. Primary objectives decide mission success; optional objectives add score. Successful primary objectives with own losses produce a costly-victory assessment rather than an unconditional failure.

Only explicitly critical preservation failures end play early. Otherwise the scenario ends at its declared time limit, freezes simulation and exposes the objective ledger and combat report for review. The six-unit, fifteen-minute fictional exercise is a vertical slice, not a claim that difficulty or competing strategies have finished playtesting.

## Determinism and recordings

- The application accumulates measured elapsed time multiplied by playback speed. Only fixed 0.25-second ticks advance the model; delayed frames do not enlarge or skip ticks.
- The world stores PRNG state. Commands carry tick and sequence numbers; simulation entity IDs use those counters rather than wall time. Camera timestamps are presentation-only.
- A batch stops on the exact auto-pause/end tick. Unused wall-time budget is discarded on interruption, not replayed after the player resumes.
- `canonicalBattleState` excludes display state, wall-clock timestamps and fractional frame budgets. Identical initial state, rule/catalog version, environment, seed and tick-stamped commands must produce equal canonical states at the same tick.
- `captureBattleRecording` and `replayBattleRecording` back the JSON UI. Replay validates the header and action sequence, uses atomic ticks, and rolls back if a recorded action is no longer legal. Playback-to-end is bounded to 200,000 ticks / 10,000 commands; there is no scrubber or resumable full-state save format yet.

## Verification

Run `bun test`, `bun run validate:db` and `bun run build`.

The gameplay regression suite covers command/view separation, detection-log selection, initial zero-side-effect sensing, hard/soft fire rules, missing support, hidden target movement, seeker searching/reacquisition, bounded passive guidance, cooldowns, swept crossings, dynamic return reserves, unarmed support behavior, fuel exhaustion, recovery, task bounds, damage-credit idempotence, costly victories, critical failures, fixed-step pause boundaries, recorded replay across speed batches, reset seeds, rollback and finite scenario completion.
