# Life satisfaction

Owner direction, 2026-10-01: life satisfaction measures a whole life on a bounded 0-100 scale. It changes over game weeks, months and years. Mood still describes the person's current state.

## [LS-score] Bounds and starting values

A new Sim starts at exactly 50 before trait offsets. Each trait may author `starting_satisfaction_offset`, defaulting to zero. An offset must be finite and between -9 and +9 points. The sum of worn traits is capped at those same bounds, so every new Sim starts between 41 and 59.

The shipped offsets are Low spirits -6, Isolated -4, Cooped up -3, Bookworm +2 and Chatterbox +2. Other traits contribute zero. The shipped household starts with Tim at 46, Bill at 50 and Casey at 52. These offsets apply only when creating a Sim; loading a save never applies them again.

All changes clamp the score between 0 and 100. Existing finite saved scores in that range restore exactly, including zero. Earlier scores above 100 restore as 100. The existing validation still rejects negative or non-finite saved scores. No save version, content ID or compatibility fingerprint changes.

## [LS-pacing] Long-term changes

One simulation tick is one game minute; a game day has 1,440 ticks. Pausing contributes nothing.

1. Sustained mood uses the existing neutral band of -15 through +15. Beyond it, contribution grows linearly with mood. At an extreme it changes about 0.556 points per day, so moving from 50 to an endpoint takes about three months of constant extreme mood. Constant +20 mood adds about 0.0327 points per day before floating-point rounding, about twelve points per year.
2. Completed activities, social interactions, chains and career shifts convert their authored satisfaction yield to points at 0.001 points per authored unit. Hobby and condition multipliers apply before conversion. A loved read authored at 3 with the 3x hobby multiplier adds 0.009 points; a career yield of 1 adds 0.001.
3. Each neglected need subtracts 0.00001 points per tick, about 0.0144 per game day. This rate remains representable at the score's upper bound. Seven simultaneous neglected needs add about 0.101 points of daily loss before rounding.

There is no spring back toward 50 and no daily reset. A bad week matters after years because the score keeps its upper bound. Activities still affect immediate needs and mood at their existing rates; their direct life-satisfaction reward is deliberately small. The rates describe fixed conditions, not a promise about how every household plays.

## [LS-meter] Player display

The dock centers a compact native HTML meter between mood and its controls. The label, fill and accessible value share the selected Sim's score. Bands are presentation thresholds; they do not change autonomy.

| Score | Label |
| --- | --- |
| 0 to less than 20 | Very dissatisfied |
| 20 to less than 40 | Dissatisfied |
| 40 to less than 60 | Content |
| 60 to less than 80 | Satisfied |
| 80 through 100 | Fulfilled |

The exact score, to one decimal place out of 100, appears on pointer hover and keyboard focus. Touch can focus the summary. Screen readers receive the band and score. With no selected Sim, the label says Unavailable and the meter is hidden. Refreshes preserve unchanged text nodes and attributes.

## [LS-expression] Future direction

Unique facial expressions and animations should eventually reflect both current mood and overall life satisfaction. This direction is recorded for later design. The meter implementation does not add animation states.

## [LS-verification] Verification

Core tests check both bounds, the neutral default and reward conversion. Content tests check finite offsets and their bounds. Household tests check combined offsets and the shipped starting values. Save tests check exact restoration, old values above the ceiling and repeated loading. Simulation tests check every completion writer, mood in both directions, month-scale extreme changes, year-scale ordinary changes and small neglect at the ceiling.

Web tests check every band boundary, missing values, the shared numeric projection, accessible values and unchanged refreshes. Browser evidence and reproducible checks are recorded in [dock verification](../assets/review-evidence/dock-controls/README.md).
