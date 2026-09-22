# Confirm and Cancel over the piece being placed

Status: built on branch `twcl/placement-buttons`; its played check is [A-placement-buttons].

This is [B-placement-buttons] in `docs/FEATURES.md`, asked for by the owner on 2026-09-22. Moving a piece of furniture put its ghost in the game view but its Confirm and Cancel in the Build panel, so nothing near the piece said the move waited on the player.

## [PA-show] When the buttons show, and what they do

While the Furniture tool has a piece lifted, or the Buy tool has something chosen and pointed at the floor, two buttons float in the game view just above the ghost: Confirm and Cancel for a move, Buy and Cancel for a purchase. They are the Build panel's own pair in a second place. Each calls the same tool method as the panel's button, and each is enabled exactly when the panel's is, so the two pairs cannot disagree. The panel keeps its pair, and on a phone the dock's footer still holds it ([PD-tall] in `docs/specs/2026-09-22-phone-build-dock.md`).

They hide when the piece is put down or cancelled, when the tool changes, and when Build ends. A focused button that is about to hide or turn off, as Confirm does while its move is on its way, hands focus to the game view first, so the arrow keys, R and the list keys keep working. The Walls and Room tools have no ghost and show nothing here; their edits apply when pressed ([WT-shell]).

## [PA-place] Where they go

The anchor is the top of the ghost's visible art, found with the same arithmetic picking in `input.ts` uses: the body's centre tile projected through the camera, the half tile the shader drops each sprite's base below its point, the art's height above its base from the atlas's content bounds (the taller of the body and its foreground layer), and the sprite's side offset, all scaled with the camera. That drawing-buffer point becomes client pixels through the canvas's size on the page, since the buffer is that size times the device pixel ratio. The pair is centred over the anchor, 8 pixels above it, and kept inside the window. On a desktop it stays right of the sidebar, so it never covers the Build panel, and below the Options gear where it would slide under it. On a phone with the Build dock showing it is kept above the dock's top edge, and a change in either tool places it again, since the dock's height can change with its status line.

The buttons follow every pan, zoom and resize. Each frame compares the ghost's tile and size, the camera, and the drawing buffer's size with the last frame's as plain numbers. The page is measured and written only when one of them changes, so a steady frame does no layout work and allocates nothing ([D11]). The box lets clicks through to the floor; only the buttons take them.

## [PA-evidence] Evidence

Tests pin the buffer-to-client mapping at device pixel ratios of 1, 2 and 3 and its round trip; the anchor at two zooms; the clamping at the window's edge and above a phone's dock; the labels and enablement for a move and a purchase; that a steady frame writes nothing and each kind of movement places the pair once; the keep-out from the sidebar and the gear; when focus leaves the pair; and the markup and wiring. The played check lifts and moves a chair and points a purchase; the household could not afford it, so nothing was bought.
