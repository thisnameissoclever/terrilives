# Contextual actions around the build selection

The original Confirm / Cancel pair shipped in PR 113 at merge `5b124bc`, with played check [A-placement-buttons]. The owner-approved [build controls revision](2026-10-01-build-context-controls.md) supplies contextual selection actions and replaces duplicate panel action rows. Build has six destinations, including Land; each keeps the controls appropriate to its selection.

## [PA-show] Active selection and controller capabilities

Furniture, Buy, Walls, room construction and Floors share one typed presentation model. Rooms defaults to Select rooms, whose dropdown and name field are separate from Build room's construction actions. Land keeps its strip selection, quote and purchase dialog. Only the active selection has contextual actions. Commands, supported facings, actual prices and payouts, affordability, placement validation, pending state and refusal messages remain owned by existing controllers.

Before hiding or disabling a focused action, the surface focuses the game view. Rotation SVGs have accessible direction names. Modal dialogs suspend the surface; its hidden rule outranks compact layout rules.

## [PA-place] Projection, bounds and unchanged frames

The anchor uses world projection and the furniture art framing and side offsets used for drawing. Drawing-buffer coordinates convert to client pixels through canvas bounds at the current device pixel ratio.

Buttons follow selection, pan, zoom, resize and content changes. Bounds keep them clear of the desktop panel, phone dock, world controls, zoom and open Options. Arcs become compact rows where space requires it. Empty space passes input through; button presses do not select or paint tiles beneath them.

Compact rows allocate space with world controls and the tool dock in one grid. Their height comes from actual buttons; it is never clamped below that content. The camera keeps the selection in the remaining game area. Options suspends contextual actions while open. Reparenting preserves focused visible controls.

Dirty callbacks update the model; camera and buffer comparisons update positioning. Resize observers invalidate after panel dimensions change. Steady frames neither measure nor rewrite contextual DOM.

## [PA-evidence] Verification boundary

Projection tests retain device pixel ratios 1, 2 and 3 and art-anchor scaling. Controller and presentation tests cover contextual construction actions, supported directions, actual prices and payouts, refusal and pending guards, and unchanged frames. Room selection and Land have their own controller checks. Browser checks exercise the actual game, bounds, hit testing and focus restoration. Dated commands and screenshots are in [build controls evidence](../assets/review-evidence/build-controls/README.md). Local checks do not constitute owner visual acceptance.
