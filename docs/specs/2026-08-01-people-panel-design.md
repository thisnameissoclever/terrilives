# People panel working design

Status: implemented as the normal-play projection of the shipped M2d
relationship scalar.

## Goal

The simulation has changed its choices and social outcomes from relationships
since M2d, but ordinary play could only inspect that state through the
developer overlay. The People panel makes the selected person's current view
of every other live household member legible without creating a second source
of game state.

## Model boundary

The current relationship is one directional `f32` per ordered pair, bounded to
`-1..=1`. Terri's feeling about Doug is independent from Doug's feeling about
Terri. The panel therefore:

1. reads only the selected person's sparse relationship pairs;
2. builds the complete row set from the live household roster;
3. joins those sources by stable `SimId`, never reusable entity index;
4. treats a missing or decayed-away pair as `0`, or Stranger;
5. ignores pairs pointing at absent people; and
6. re-reads simulation truth at the ordinary HUD cadence and immediately after
   Load.

This slice does not invent friendship and romance axes. The M2 roadmap item for
those separate dimensions remains proposed work. It also does not change Rust,
the content pack, relationship tuning, or the save schema.

## Player surface

`People` is a native collapsible details section in the normal HUD. It starts
open on wider screens and folded at 600 CSS pixels or below, beside the same
phone-height policy as Needs.

When a person is selected, the summary reads `How {name} feels`. Every other
live household member receives a row with:

- their authored name;
- one plain qualitative state; and
- a centered meter from `-1` to `1`, with neutral at its midpoint.

Text carries the meaning rather than color alone. Each meter exposes its full
directional name, numeric minimum, maximum and current value, plus the same
qualitative state as accessible value text.

The presentation bands are deliberately broad while making the authored first
conversation visible:

| Feeling | State |
| --- | --- |
| `<= -0.60` | Hostile |
| `<= -0.20` | Dislikes |
| `< -0.05` | Wary |
| `<= 0.05` | Stranger |
| `< 0.20` | Warm |
| `< 0.60` | Friendly |
| otherwise | Close |

One completed Chat adds `0.15`, so a stranger becomes Warm and the marker moves
from the midpoint. The labels describe one person's feeling and make no claim
about romance or reciprocity.

## Acceptance

1. Every other named live household member appears, including missing sparse
   pairs as Stranger.
2. Switching selection shows the newly selected person's independent values.
3. Shuffled render rows and sparse pairs still render in stable household
   order.
4. A successful Load with replacement entity indices immediately reconciles
   rows through stable `SimId`.
5. Null, stale and non-person selections show the selected-person empty state
   rather than stale relationships.
6. Odd sparse tails, malformed ids, non-finite values and out-of-range values
   cannot leave stale or out-of-bounds presentation.
7. Every meter has an accessible directional name and qualitative value text.
8. At 390 x 844, Needs and People begin folded, the HUD has no horizontal
   overflow, and either section remains keyboard-operable.
9. A completed conversation visibly changes both directional rows according to
   simulation truth, and Save/Load restores them.
