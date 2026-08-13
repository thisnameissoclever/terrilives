# Collapsible compact HUD

Status: implemented and locally acceptance-tested. Merge, public deployment,
and physical-phone acceptance remain open. Section ids are stable and must not
be renumbered.

## [CH1] Small screens start with the game, not its controls

A viewport no wider than 600 CSS pixels, or no taller than 480 CSS pixels,
shows one compact household-status strip by default. Time, Funds, and a Menu
button remain visible. The roster, Needs, People, speed controls, persistence
actions, Queue, New game, and Help do not occupy layout or accept focus until
the player opens Menu.

The threshold includes phone portrait, phone landscape, and short embedded
windows. Desktop retains the established sidebar without a Menu button.

## [CH2] Expansion reuses the existing controls

Menu changes only presentation state. It does not create a second roster,
speed controller, persistence surface, Queue command, or Help action. The same
DOM nodes and TypeScript controllers remain responsible for behavior, state,
labels, and focus order.

Entering compact mode closes Needs and People so the first expansion is still
compact. The player may then open either detail panel. Closing Menu hides the
whole secondary HUD without destroying the player's current selection or game
state.

## [CH3] Expanded content remains bounded and reachable

Phone portrait uses a contiguous top sheet instead of pinning controls to both
ends of the viewport. Needs and People retain independent height caps and
internal scrolling. If the expanded sheet exceeds the viewport, the outer HUD
scrolls while the document itself remains fixed to the game viewport.

Short screens wider than 360 pixels keep a 220-pixel edge sheet. Narrower short
screens use the portrait-style top strip because a 220-pixel column would leave
almost no game beside it. Every visible control target remains at least 44 CSS
pixels high.

## [CH4] Required evidence

1. At 418 by 910 and 320 by 568, the initial HUD must be a 60-pixel status
   strip. Roster and actions must compute to `display: none`, the document must
   have no horizontal or vertical overflow, and the game must remain visible
   below the strip.
2. Menu must expose the existing controls. Pause and 1x must change the checked
   speed, Queue must change `aria-pressed`, household selection must update the
   Needs and People captions, and Help must still open its modal.
3. Needs and People must be independently expandable. Their overflow must stay
   inside their caps, or inside the outer HUD scroll boundary at 320 by 568.
4. At 568 by 320 and 844 by 390, the closed surface must remain a compact edge
   strip and a viewport-center hit test must reach `#stage`.
5. At 240 by 568 and 240 by 320, the closed surface must remain a 60-pixel top
   strip with no document overflow.
6. At 1280 by 720, the Menu button must be absent from layout while the desktop
   roster, details, speed, and actions remain visible.
7. Deleting the `data-mobile-open` reflection must fail the focused controller
   test. Restoring it must reproduce the original file hash and return the test
   to green.
