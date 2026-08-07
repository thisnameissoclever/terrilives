# Mobile HUD reflow

Status: implemented, acceptance-tested, and merged through PR 44 after local
idle wandering. The merged GitHub Pages evidence is recorded at
[A-mobile-hud-reflow]. Section ids are stable and must not be renumbered.

## [MH1] The problem is layout, not control count

The live 390 by 844 layout still treated the HUD as a desktop sidebar. Its
mobile rule narrowed the same vertical stack from 220 to 212 CSS pixels, so the
overlay occupied 54.4% of the viewport width and 58.0% of its height after the
roster, People, persistence, Queue, and Help features accumulated. Every
control remained present, but presence alone did not leave a comfortable game
surface.

The mobile contract is therefore a reflow of the existing controls around the
canvas. It does not hide actions behind a drawer, reorder the document, or add
a second mobile controller. The same DOM nodes, focus order, labels, live
regions, and TypeScript controllers continue to own behavior.

## [MH2] Portrait uses a transparent two-dimensional dock

At 600 CSS pixels or narrower, portrait and other sufficiently tall viewports
fill the safe inset rectangle with a two-column HUD grid. Time and Funds share
the first row, the roster spans the next, Needs and People share the third, and
speed plus game actions occupy the bottom. A flexible transparent row between
the details and bottom controls is the playable canvas aperture.

The full-screen grid remains pointer-transparent. Only its existing child
panels accept input, so a tap or drag in the aperture reaches `#stage`. The
roster stays three columns, speed stays four equal columns, and the six game
actions become three columns by two rows. A viewport no taller than 480 pixels
and wider than it is tall keeps a scrollable 220-pixel edge column; forcing the
portrait dock into 568 by 320 otherwise places its bottom action row outside
the viewport. Desktop keeps the same sidebar shape.

## [MH3] Expansion cannot bury the controls

The Needs and People summaries are at least 44 by 44 CSS pixels. Opening one
panel does not stretch its closed sibling across the canvas. Each open panel is
capped at `min(34dvh, 300px)` and scrolls its own content. At normal text sizing
the speed and game-action rows remain pinned to the safe bottom inset; under
enlarged text they remain reachable through the outer dock's scroll boundary.

This cap is a reachability boundary, not a fixed content promise. A six-person
household, long moodlet list, text zoom, or future row may need to scroll inside
the details panel. When enlarged text makes the fixed top and bottom rows taller
than the viewport budget, the outer dock also scrolls. Save, Load, Pause, and
Help must remain reachable without giving the transparent canvas aperture
pointer ownership to the HUD.

## [MH4] Existing behavior and accessibility stay owned by existing code

The CSS reflow does not replace `time-controls.ts`, `queue-mode.ts`,
`persistence-controller.ts`, or `household-roster.ts`. Radio state, Queue's
`aria-pressed`, Save and Load focus behavior, roster selection, live status
announcements, and document tab order must remain unchanged. Help, action
menus, and dialogs remain outside `#hud` so their existing viewport clamps and
focus ownership still apply.

Safe-area insets are honored on all four sides. Focus outlines must remain
visible inside a scrolling details panel, and no mobile control may have a
rendered target smaller than 44 by 44 CSS pixels.

## [MH5] Evidence required before merge

1. At 390 by 844 with both details folded, there must be no horizontal
   overflow, every control must remain in the viewport, and the transparent
   full-width canvas aperture must be at least 400 CSS pixels high.
2. A hit test and an actual drag through that aperture must reach `#stage` and
   pan the rendered house. Pause, 1x, Queue, Save or Load, and every household
   selection must still use their visible controls.
3. Opening Needs, People, and both together must keep the bottom controls
   reachable. A closed sibling must remain compact, and an overflowing detail
   panel must scroll within its cap.
4. The same checks must cover 320 by 568 portrait, 568 by 320 short landscape,
   844 by 390 wide landscape, and 1280 by 720 desktop. Both landscape cases
   must retain a scrollable edge column rather than inherit the portrait dock.
5. Manual CSS mutations must prove that the geometry gate catches removal of
   full-width reflow, the flexible canvas row, three-column actions, 44-pixel
   summaries, independent detail sizing, the detail height cap, and the short
   landscape fallback. Enlarged-text mutations must also prove the adaptive
   open-panel row and outer HUD overflow are load-bearing. The production file
   must be restored byte-for-byte afterward.
6. Web typecheck, tests, release-WASM build, production build, documentation-id,
   diff, independent review, CI, merged Pages deployment, and public revision
   smoke gates must pass. The user's supplied phone screenshot is valid evidence
   of the old defect; the corrected physical-phone pass remains separate until
   the merged revision is opened on that device.
