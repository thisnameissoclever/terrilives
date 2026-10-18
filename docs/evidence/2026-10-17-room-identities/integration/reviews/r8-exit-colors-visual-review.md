# Exit Build decision colors: blind visual review

Reviewed the two submitted 1440 x 1000 images directly, before reading any condition mapping, implementation report, receipt, code, or other capture. The acceptance criteria require green Confirm, red Keep building and Discard, readable labels, a complete focus indicator, and separate enabled decisions that fit the dark interface.

## Image A: Fail

Inspected `docs/evidence/2026-10-17-room-identities/integration/played/r8-exit-proof-a.png`.

1. **Keep building:** The label is readable and centered. The button has a dark blue-gray fill, rather than the required red. Its pale outer focus outline is complete on all four sides, with rounded corners and visible separation from the button edge. It does not overlap its neighbors or clip the label.
2. **Confirm changes:** The label is readable and centered. Its dark neutral fill does not provide the required green affirmative cue. Its entire boundary is visible, with a clear gap above and below.
3. **Discard changes:** The label is readable and centered. Its dark neutral fill does not provide the required red negative cue. Its entire boundary is visible and the label is not clipped.
4. The three full-width decisions remain individually identifiable through labels, boundaries, and vertical spacing. The panel fits the dark interface. The required semantic colors fail for all three decisions, so layout and focus quality cannot make this image pass.

## Image B: Pass for the submitted still

Inspected `docs/evidence/2026-10-17-room-identities/integration/played/r8-exit-proof-b.png`.

1. **Keep building:** The label is readable and centered on a muted red fill. A complete pale focus outline surrounds all four sides and rounded corners, without clipping or colliding with the next button. The brighter red appearance and outline make the focused decision clear.
2. **Confirm changes:** The label is readable and centered on a dark green fill with a visible green boundary. It reads as the affirmative decision, with clear separation from the red decisions above and below.
3. **Discard changes:** The label is readable and centered on a muted dark red fill with a visible red boundary. The entire control is visible, with no overlap or clipping.
4. All three controls have separate boundaries and clear vertical gaps. Their muted green and red fills fit the charcoal dialog and surrounding dark interface. None has a visibly faded disabled treatment. The submitted appearance meets the stated color, readability, focus, and layout criteria.

## Limits

These stills establish visible appearance at the submitted desktop size and paused scene only. They do not prove keyboard activation, focus movement or trapping, pointer behavior, disabled-state logic, numerical contrast ratios, animation, responsive layouts, or physical phone behavior. No interaction, code, test, build, or unrelated game-art review was performed.

The A/B verdicts above were recorded while the condition mapping remained concealed. The parent can now reveal the mapping and request any scoped restoration review.

## Scoped restoration assessment after mapping disclosure

Read `.local-build/r8-exit-color-restoration.log` after recording the blind verdicts. Its disclosed mapping identifies A as the state with the three `data-action-intent` attributes removed and B as the final restored state. The blind review rejected A and accepted B before this disclosure.

1. **Attribute restoration:** The recorded before and restored attribute maps match for each button. Keep building and Discard changes each have `data-action-intent="negative"`; Confirm changes has `data-action-intent="affirmative"`. The other recorded attributes match too, including IDs, values, classes, and Keep building's autofocus attribute. In the removed state, those three intent attributes are absent and the other recorded attributes remain the same.
2. **Visible-state restoration:** The individual recorded values support restoration independently of the log's success flag. Before and restored Keep building both have background `rgb(113, 59, 69)`, text `rgb(255, 240, 241)`, and outline `rgb(216, 216, 224) solid 2px`. Confirm changes returns to background `rgb(38, 79, 61)` and text `rgb(232, 248, 237)`. Discard changes returns to background `rgb(91, 45, 53)` and text `rgb(255, 240, 241)`. The latter two retain their recorded `none 3px` outline values. These colors agree with the red, green, and red appearances inspected in B. The removed-state backgrounds agree with A's blue-gray Keep building and neutral Confirm and Discard.
3. **Matched setting and geometry:** All three recorded states use tick 838, camera origin `(336, -289.0000247955322)`, scale 1, and viewport 1440 x 1000. Focus stays on `build-exit-keep`. The labels and enabled values match throughout. Each button remains 322 x 44 at x 559, with respective y coordinates 483.015625, 535.015625, and 587.015625; the recorded full rectangles match throughout. The before and restored states therefore agree on the logged attributes, computed styles, focus, labels, enabled flags, and geometry.
4. **Separate harness failure:** The log reports that an earlier helper's `outerHTML` comparison failed because removing and readding attributes changed their incidental serialization order. That remains a failed harness assertion. Matching sorted attribute maps and visible-state values establish the narrower restoration described here; they do not establish byte-identical DOM serialization or erase that earlier failure.
5. **Verdict:** The missing semantic colors are addressed in the inspected final B still. No new visible breakage appears in these three controls: their labels, complete focused Keep building outline, spacing, and full boundaries remain clear. The receipt shows a browser-only attribute removal and restoration sequence, with restoration repeated in `finally`; it does not show a production source edit.

This assessment is limited to the two inspected desktop stills and the fields recorded in the supplied receipt. It is not a fresh browser run or an independent source, file-hash, DOM-byte, interaction, phone, responsive-layout, animation, or numerical-contrast verification. The logged enabled flags supplement the visible enabled appearance but do not prove successful activation or focus movement. No broader game-art judgment is made.
