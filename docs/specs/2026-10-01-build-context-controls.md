# Build controls beside the selection

## Panels and shortcuts

All five desktop tools have a 304px outer panel, including padding and scrollbar space. The heading and Exit build precede tool navigation, settings, selection feedback, pointer instructions and a native Shortcuts disclosure. Catalogue filters, object identity, colours, prices and sale refusals remain available. Action labels are centered; descriptions and form labels retain reading alignment.

Build uses a bottom panel at widths of 700px or less, or heights of 480px or less. Navigation and Exit build remain outside scrolling tool content. Wide labels retain their natural width; navigation scrolls horizontally when necessary. The unrelated Sim dock retains its 600px / 480px breakpoint. Compact world controls reserve separate areas for status and zoom / Options.

Shortcuts starts closed on load, Build entry and tool changes. Updating a selection does not close an opened disclosure. `web/src/ui/shortcuts.ts` supplies the same task groups, action labels and keycaps to each tool and Help. Alternative keys are separated by “or”; pointer instructions and validation feedback remain outside the disclosure. Target-selection feedback names the target without embedding key instructions.

Help groups Build & place, People & actions, Camera, and Options & saves. Its Shortcuts reference starts closed and groups bindings by interaction. All earlier topics remain represented.

## Contextual actions

`web/src/ui/placement-actions.ts` reads a typed presentation model from the active controllers. Controllers own commands, capabilities and validation; the presentation does not synthesize keyboard input or modify simulation rules.

| Tool | Actions |
| --- | --- |
| Walls | Wall, Doorway and Window form the upper arc. Both curved arrows alternate the two supported edge orientations without editing the house. Remove and Clear sit below. |
| Furniture | Confirm, both supported rotation directions, Sell with the actual payout, and Cancel. Placement, facing and sale restrictions remain authoritative. |
| Buy | Buy with the actual price, both supported rotations, Choose item and Cancel. Choose item focuses the existing catalogue selector. Affordability, colour and placement checks remain intact. |
| Room | Build room, Doorway, Corners and Cancel. Doorway requests an outline edge and toggles its doorway. Clicking elsewhere during that selection does not restart the room. Corners clears the outline without building. |
| Floors | Clicking only selects and highlights a tile. Covering buttons read names from content and apply to the selected tile. Remove restores the original floor; Clear removes selection. Selecting another tile never applies the previous covering. |

Floor number bindings apply a covering to an existing tile. Without selection, they stage nothing and show “Select a tile first.” Commands already sent retain their results across tool changes; loading resets controllers as before.

## Placement and input

Actions follow the existing world projection. Furniture uses the visible art's framing height and side offset, including the foreground layer. Drawing-buffer points convert to client pixels at the current device pixel ratio. Layout accounts for the build panel, world controls, zoom, open Options and viewport edges. Short screens use compact rows without reducing touch targets below 44px.

When the arc cannot fit a compact viewport, `web/src/ui/build-layout.ts` allocates world controls, visible game space, contextual rows and the tool panel in one grid. The tool content scrolls below fixed navigation. Short landscape places heading and navigation beside each other and gives action rows the available width. Reparenting preserves focused controls, and the camera keeps the selection in the free game area. Leaving the selection or tool restores the ordinary layout. Options temporarily suspends contextual actions while its flyout is open.

Only buttons own pointer input; empty space remains available to the game. Pending, blocked and invalid actions use controller capabilities. Before a focused action hides, changes tools or becomes disabled, focus returns to the game view. Local SVG rotation icons have literal accessible names. Modal dialogs suspend contextual actions, and the hidden rule must outrank the compact display rule.

Selection and content callbacks invalidate the presentation. Camera scale, origin and canvas size invalidate positioning. Resize observers account for panel content and enlarged text. Unchanged frames do not measure or rewrite contextual DOM.

Zoom presses multiply scale by 1.12 or its reciprocal, using existing camera limits and anchored-origin calculations at the center of the unobstructed game area. No Rust command, content schema, save format or dependency changes are part of this work.

## Verification

See [build controls evidence](../assets/review-evidence/build-controls/README.md) for exact commands, mutation outcomes, viewport measurements, screenshots and the owner acceptance boundary.
