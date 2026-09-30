# Varied autonomy and self-preservation instinct

Status: implemented locally; validation evidence is recorded below. No release
approval or deployment is implied.

## [VA-choice] Every physically eligible alternative has a probability

Object reachability, occupied slots, partner ownership and action requirements
remain eligibility rules. Score thresholds no longer exclude actions. Needs,
personality, traits, relationships, habituation, travel and duration determine
utility. Each target receives one normalized probability based on its best
interaction utility; its eligible interactions are separately normalized. Adding
an equal interaction does not increase that target's total probability.

Selection combines stable softmax utility weights with explicitly positive
exploration. Survival risk also biases exploration. Each flattened candidate
reserves at least one of the sampler's 2^53 integer buckets, preventing numerical
underflow or cumulative rounding from excluding a dangerous or disliked choice.
The trace reports these actual bucket probabilities.

The lowest need determines comfort, clamped from 0 at the existing low band of
40 to 1 at the needs-met band of 70. Temperature and exploration interpolate
smoothly across that range. Positive Fun and Social benefits retain baseline
appeal at full meters, scaled by the same preferences as advertised benefits.
Wandering and waiting for an occupied object participate in the weighted choices.

## [VA-instinct] Saved numeric instinct, independent of trait slots

Each living person stores integer Self-preservation instinct in 0 through 100.
Starter households and accepted random move-ins draw uniformly across that range.
Explicit move-ins accept zero as an ordinary valid value. Refusals consume no
instinct draw. The Traits panel shows the value without using a trait slot.

Low-need urgency uses piecewise interpolation through these tunable anchors:

| Instinct | Multiplier |
| --- | --- |
| 0 | 0.02 |
| 5 | 0.10 |
| 30 | 0.75 |
| 50 | 1.00 |
| 70 | 1.40 |
| 100 | 2.00 |

For critical Hunger or Energy, choices that cannot recover the need before its
remaining survival time receive a penalty. Recovery uses actual restoration and
decay, independent of preferences; chain benefits arrive at completion. The
penalty accounts for duration variance, travel, current
decay, remaining deprivation time and the existing asleep decay reduction. The
penalty scales with the square of the urgency multiplier. This allows meaningful
neglect at 0 through 5 while making prolonged dangerous delays very unlikely at
ordinary values. Turning death off disables that risk penalty. Need decay,
restoration amounts and death timing remain unchanged.

## [VA-wandering] Finish the sampled stroll and pause

Destinations use the shared generator and retain both three-tile endpoint and
walked-path caps. Pause lengths draw uniformly within `wander_pause_variance`
of `wander_pause_ticks`, initially 12 through 28 ticks around a center of 20.
Ordinary decisions wait for the chosen stroll and pause to finish. Critical
needs may interrupt, and player commands remain immediately authoritative.
Action, conversation, chain and commute ownership remains unchanged.

## [VA-save] Additive save and command extension

Fresh games use a browser-cryptographic 64-bit seed installed before household
creation. Fixed-seed native and WASM constructors remain available for tests.
Loading restores RNG state rather than obtaining new entropy.

Save V5 appends sorted living-person `(entity index, instinct)` rows to its
extensible envelope. The frozen V1 snapshot and old command encodings retain
their layout. Explicit housemates use appended command wire 18. Instinct is
hashed alongside other causal person state and queued commands.

Loading validates the entire world before adoption, then installs explicit rows.
Missing values migrate uniformly across 30 through 70 using the restored RNG in
stable entity order. Identical legacy bytes migrate identically. Values are
stored immediately and emitted on the next save; existing values, including zero,
are never redrawn. Duplicate, unsorted, nonliving and out-of-range rows fail
transactionally, retaining the current world.

## [VA-tuning] Authored balance controls

`content/tuning.toml` owns `choice_comfort_temperature`, `choice_exploration`,
`choice_comfort_exploration`, `leisure_appeal`, `survival_risk_penalty`,
`choice_probability_floor`, `wander_pause_variance` and
`self_preservation_curve`. Compiler validation requires positive finite weights,
exploration strictly between zero and one, monotonically increasing anchors from
0 through 100, increasing comfort settings, and pause variance below one.
Existing `action_threshold` remains a compatibility tuning field; it no longer
filters ordinary autonomy. `idle_threshold` supplies wandering baseline utility.

## [VA-evidence] Verification

Run `cargo run -p terri-sim --example trace -- 12000 SEED INSTINCT` to inspect
need bands, actual selection probabilities, dangerous choices, deaths, instinct
and wandering pauses. Omitting INSTINCT uses each person's random value. Compare
multiple seeds and ordinary-instinct overrides before changing balance controls.
Detailed local results are in [the validation record](../autonomy-validation.md);
rendered desktop and mobile checks passed. The owner authorized deployment after
fresh-context review on 2026-09-30. The reviewed functional description is listed
in `docs/player-visible-strings.md`; the broader game voice session remains open.
