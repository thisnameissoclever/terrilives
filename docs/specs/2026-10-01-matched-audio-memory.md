# Match audio memory workloads

Status: implemented and independently task-reviewed. Root verified matched
worlds in all three browser pairs; corrected raw memory acceptance still fails.
Indoor ambience and PR 178 remain held. See the
[root evidence](../assets/review-evidence/audio/indoor-ambience/verification.md#matched-protocol-and-failed-acceptance).

## Purpose and authority

The owner delegated routine implementation and verification decisions. The
indoor-ambience investigation found that the existing memory comparison creates
different random worlds and stops at different ticks. This slice repairs those
confirmed comparison defects. It does not change a failing result into a pass,
exclude generated code, or increase an allowance.

Seed-only matching is insufficient because polling can overshoot tick endpoints.
A new ownership-only metric would discard part of the existing contract. Use
recorded seeds plus an exact fixed-step stop, retaining the raw heap metric.

## Boundaries

1. Preserve 60 warm-up ticks, 540 measured ticks, three enabled/disabled pairs,
   alternating pair order, the 65,536-byte allowance and exact document/node/
   listener equality. Preserve positive playback and all source/track bounds.
2. Predeclare these unsigned 32-bit seed pairs, in repetition order:
   `(104729, 130363)`, `(155921, 196613)`, `(262147, 327673)`. They are test
   fixtures selected before running the repaired comparison, not selected for
   favorable results. Record them in every report.
3. Normal gameplay keeps crypto seed generation and its current speed semantics.
   Opt in only with `stress` plus both `probeSeedLow` and `probeSeedHigh` URL
   parameters. Without `stress`, ignore the probe parameters. With stress,
   reject incomplete, non-integer, negative or overflowing probe seeds.
4. An opted-in page starts paused at tick zero. Keep visible rendering, normal
   fixed-step audio sampling, real Web Audio clocks, trusted unlock gestures,
   complete HUD normalization and audio draining. Never drive `sim.tick()` from
   the browser harness, freeze rendering or alter optimization settings.
5. Add a stress-only `runUntilTick(targetTick)` operation. Validate a safe integer
   strictly above the current tick before changing state. Arm the target, choose
   speed 3 through existing control ownership, and stop exactly at the target.
   Keep speed controls synchronized. Existing blocking overlays remain effective.
6. Enforce the remaining tick budget inside FixedStepDriver, not by polling or
   merely changing speed inside a tick. A frame owing several ticks cannot
   overshoot. On exhausting a finite budget, discard leftover accumulated time
   and return alpha zero. A zero budget performs no tick and drops accumulation.
   Calls without a budget preserve current behavior. Reject invalid budgets.
7. Run warm-up from tick zero to 60, then the measured interval from 60 to 600.
   Keep intermediate samples during continuous normal running; only normalized
   baseline/final endpoints require exact equality. Record `worldHash()` as a
   decimal string after the endpoint's pause/selection commands settle.
8. Require each pair to match seed, baseline tick/hash and final tick/hash.
   Require the prescribed ticks and fixture seed for that repetition. Missing
   metadata or a mismatch fails comparability before attribution; never label
   an unmatched difference audio-specific. Old reports remain historical and
   cannot pass the new comparison silently.
9. This does not eliminate compilation timing differences. If the repaired
   raw gate fails, retain the failure and investigate; do not lengthen warm-up,
   cherry-pick seeds or subtract code memory. Do not import or release PR 178.

## Verification

The stress handle now exposes `memoryProbeSeed` and `runUntilTick(targetTick)`.
Each memory snapshot records `seed: {low, high}`, `tick`, and decimal-string
`worldHash`. The runner starts at zero, stops at 60 and 600 through the existing
speed controls, and preserves the live interval's 60-tick sampling cadence.
The analyzer returns `comparable: false`, explicit `comparabilityErrors`, no
pair attribution and a null median when fixture seeds or endpoint tick/hash
metadata are missing or mismatched. This rejects historical unmatched reports;
it does not revise their reported outcomes.

Test the driver with a multi-tick accumulator and a one-tick budget, zero budget,
invalid values, and later resume. Pin unbudgeted behavior. Test query parsing,
initial pause and target validation without browser globals where practical.
Test pair analysis against missing metadata and independent seed/tick/hash
mutations, preserving existing leak and positive-playback rejection tests.

Root will verify exact endpoints and equal hashes in an actual enabled/disabled
browser pair before running the complete corrected acceptance once. Preserve
every result. If comparability fails, diagnose that defect before another full
run. Run focused tests while iterating, the full web suite once on the completed
change, typecheck, build, doc checks and independent review. No dependency or
paid-service changes are needed.
