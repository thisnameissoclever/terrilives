# Privacy avoidance and relationship development implementation

Implementation uses one editor in the existing worktree and independent read-only review. The owner authorized publication and merge through [PR #196](https://github.com/thisnameissoclever/terrilives/pull/196). [Publication evidence](../../evidence/relationship-development/publication/verification.md) records the combined meals and sleeping-place implementation, aggregate balance, layout variation and need-access limits. [Earlier evidence](../../evidence/relationship-development/verification.md) remains historical. No dependencies changed.

The approved conversation plan is the behavioral contract. Extend the original privacy specification with measured results after implementation.

## Tasks

1. [x] Add per-tick, read-only relationship diagnostics and a native balance trace. Record requested and clamped changes by cause; group one privacy action across its victims.
2. [x] Add authored shared-activity metadata and validated tuning. Derive directional compatibility from personality dispositions, disposition traits and hobbies. Exclude skills, conditions, names and shyness.
3. [x] Add pleasant proximity, shared activity and compatibility friction; integrate compatibility-scaled conversation rewards without duplicate gains. Preserve need delivery and mood-to-satisfaction behavior.
4. [x] Add one privacy policy across selection, wandering, chains and movement. Preserve player overrides and reservation ownership. Cache lapses for 30 minutes; critical relevant needs override after ten blocked minutes, needs at or below five immediately.
5. [x] Save, validate and hash sparse boundary state. Preserve historical V5 decoding and deterministic continuation.
6. [x] Calibrate privacy frequency, recovery and conflict pace using seeds 1-16; validate seeds 17-24. Seven settling days, 56 measured days; shipped household and adequately furnished two-, three- and four-person fixtures.
7. [x] Run causal mutation checks, full repository validation, browser verification and independent review. Update documentation and record the planned B-hostility-expression roadmap item.

## Binding balance and interpretation

1. Preserve base penalties 0.11/0.20/0.25 and shyness reaction scaling. Target 0.75-1.25 autonomous privacy violations per neutral-shyness Sim-week in ordinary households.
2. Target average recovery in 1.5-2.5 days, with failed and interrupted recoveries reported. Positive gains may be calibrated, without changing action durations or need delivery.
3. Strong incompatibility should reach -0.5 affinity in 14-28 days with privacy penalties disabled. Enjoyable common activities can still produce smaller gains.
4. Derive each tag preference by averaging explicit personality weights, multiplying matching disposition-trait weights, subtracting one, adding 0.5 for a hobby, and clamping to [-1,1]. Normalize ordered overlapping products by max(1, subject absolute preference sum). Both-negative products contribute zero.
5. Compatibility below -0.2 creates friction. Eligible contact requires the same room, four-tile range, awake/present Sims, and no private use or commute. Positive gains require the other's hygiene above the low threshold and no critical subject need left unhelped by the current activity. Existing dislike never blocks recovery.
6. Initial hourly rates: proximity +0.002, shared activity ten times that, strongest friction -0.012. Initial chat completion gain 0.15. Positive compatibility multiplier clamps 1 + compatibility to [0.25,2].
7. Shared reading, exercise and aquarium watching require matching authored groups, different objects, non-disliked activities and no failed attempt. Shared activity replaces proximity and suspends friction. Paired conversation receives only its completion reward.
8. Broader shared furniture, group scheduling, fights and hostility presentation are outside this implementation. Record hostility indicators, reactions/animations and mild needs-aware directional avoidance as planned roadmap work.

## Verification contract

Test directionality, timing, boundaries, safe routes, emergency/player overrides, bounded decisions, cancellation ownership, profiles, activity exclusions, smell/needs gating, save replay and malformed input. Remove load-bearing guards and prove their tests fail, then restore byte-identically. Run Rust tests/fmt/Clippy, real WASM/web tests/type checks/build and required repository gates. Close owned browser pages and servers. Report balance misses honestly rather than hiding seeds or unfinished recoveries.
