# Moods and moodlets vertical slice

Status: implemented and accepted in visible Chromium on desktop and mobile;
release verification is pending. Section IDs are stable; do not renumber.

The score constants in this slice affect only the explanatory projection;
nothing in simulation choice or outcome reads mood yet. Before a future system
does read it, these balance values must move into `content/tuning.toml` and pass
the pack's validation rules.

## [M1] One derived answer

Mood is a read of the current world, not a second simulation clock and not a
stored component. `Sim::mood_of` derives one bounded score, one overall label,
and an ordered list of active moodlets from state the save already owns:
needs, worn condition traits, positions, names, stable sim ids, and directional
relationships.

This keeps Save V1 unchanged. A loaded world therefore cannot carry a stale
mood snapshot from before the save or from a different content pack. The HUD
must force one mood refresh immediately after a successful load, before the
next simulation tick.

## [M2] Need rules

Need moodlets follow `NeedId` order. A level at or below 20 is critical and
contributes -25; a level at or below 40 is low and contributes -12. The labels
are plain descriptions of the need state:

| Need | Low | Critical |
| --- | --- | --- |
| Hunger | Hungry | Starving |
| Energy | Tired | Exhausted |
| Hygiene | Needs a wash | Very dirty |
| Bladder | Needs the toilet | Desperate for the toilet |
| Social | Lonely | Very lonely |
| Fun | Bored | Very bored |
| Comfort | Uncomfortable | Very uncomfortable |

When every need is at least 70, one `Needs met` moodlet contributes +20. The
single summary avoids seven celebratory rows elbowing the useful information
off a phone screen.

## [M3] Trait rules

Every worn content trait whose compiled kind is `Condition` contributes its
content label once its severity is above 0.05. Its score is
`-30 * severity`. Conditions are handled by kind and pack index, never by a
hardcoded `low_spirits` id. Dispositions and capabilities do not imply a mood
without an authored mood mechanic, so this slice does not pretend that every
trait is emotional.

## [M4] Environment rules

A live named sim strictly nearer than four tiles may contribute a social
environment moodlet when the selected sim's directional feeling toward them
has an absolute value of at least 0.1. Positive feelings read
`Comforted by {name}` and negative feelings read `Uneasy around {name}`. The
score is `15 * feeling * (1 - distance / 4)`.

Candidates are ordered by stable `SimId`, not entity index or query order.
Missing relationship targets and recycled entity indices contribute nothing.
Only the selected sim's feeling is read; another sim's reciprocal feeling does
not leak into this answer.

## [M5] Score and labels

Moodlet scores sum and clamp to -100 through 100. The overall labels are:

| Score | Label |
| --- | --- |
| at most -50 | Miserable |
| over -50 through -15 | Low |
| over -15 and under 15 | Okay |
| 15 through under 50 | Good |
| at least 50 | Great |

The shell does not recompute these bands. Rust owns the game rule and exposes
the result; the browser only validates and renders it.

## [M6] Boundary and UI

The WASM boundary exposes aligned copies:

1. `mood_snapshot_of`: overall score followed by each moodlet score.
2. `mood_summary_of`: overall label followed by each moodlet label.

Both are empty for an absent, stale, or non-sim entity. The two calls are made
synchronously with no tick between them. A length mismatch or non-finite score
is invalid boundary data and renders the selected person's mood as unavailable
instead of preserving stale rows.

Normal play shows Mood in the existing selected-person panel. The overall
score uses an accessible meter from -100 to 100, with the overall label as its
value text. Active moodlets appear below it in deterministic order, each with
its signed contribution. No active moodlets reads as a deliberate empty state,
not a blank box.

## [M7] Acceptance

1. Native tests pin both threshold boundaries, the generic condition rule,
   directional proximity, stable ordering, and stale entities.
2. WASM tests pin the numeric and text projections and their alignment.
3. Browser tests pin invalid-boundary clearing, keyed row reconciliation,
   throttling, selection changes, and forced refresh after load.
4. A loaded saved household shows the same mood before the next tick.
5. Desktop and 390 by 844 browser checks prove the panel is readable, the
   meter has an accessible value, and the existing primary play path still
   works.
6. The full workspace, web, build, release-WASM, mutation, exact-head review,
   CI, merge, Pages, and public smoke gates pass.
