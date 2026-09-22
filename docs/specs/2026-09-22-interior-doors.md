# Build mode: hinged doors in doorways

Status: [DR-slice-derived] is built, on branch `twcl/interior-doors`.

This is [WT-slice-interior-doors] in `docs/specs/2026-09-21-wall-tool.md` and
the "doors" part of [B-builder] in `docs/FEATURES.md`. The Walls and Room tools
make doorways: gaps in a wall drawn as an empty frame. The only door in the
game is the front door, which swings open when someone leaves for work or comes
home.

## What the player gets

* **Doors in doorways.** A doorway on a line that runs the way the front door's
  wall runs holds a hinged door, drawn with the front door's art. It swings
  open as a sim walks through and closes behind them.
* **Nothing to press.** Doors come with doorways; there is no new tool state in
  this slice.

## What already exists, and is reused

* **The front door's machinery.** Each frame `sync_portals` works out a door's
  state (closed, opening, open, closing) from where sims are and where they are
  walking. The renderer draws any number of portal rows, each a frame and a
  leaf, with reduced-motion leaves and depth offsets.
* **The art.** `frontDoorFrameSELeft` and its closed, ajar and open leaves fit a
  vertical line. There is no art for a horizontal line, and mirroring the
  sprites would light them from the wrong side, so horizontal doorways stay
  empty frames until the owner's art arrives ([T-interior-door-art]).

## Decisions

### [DR-derived] A door is derived from a doorway, not saved

Which lines hold doors follows from the saved walls: every vertical doorway.
So a door adds nothing to the save or the save digest, and no save changes
meaning. A door's state is presentation, rebuilt every frame from positions
and walks that are already saved, exactly as the front door's is.

### [DR-state] When a door opens

A door is open while a sim stands within half a tile of its line, opening while
a sim's next step crosses the line within a tile and a half, closing for the
frames after the last sim leaves, and closed otherwise. The rule reads each
sim's position and the remaining steps of its walk, and is the same one the
front door uses for a commuter, generalised from "walking to the door tile" to
"walking across the door's line".

### [DR-render] Where it is drawn

A door is one more row in the portal buffer the front door already uses,
after the front door's row: the renderer, the boundary's portal columns and
the reduced-motion leaf need no change. It stands on the +X edge of the tile
left of its line, where the front door's art stands on its own tile, with the
front door's depth offset and lighting. The shell leaves out the doorway's
empty panel on a line that holds a door (`interior_door_lines` at the
boundary), so the two never double up.

The loader synced the render buffer before it put the saved walls in, so a
loaded house would have drawn its doorways doorless until the next tick; the
loader now rebuilds the portal rows once the walls are in.

## Slices

* **[DR-slice-derived]** Everything above.
* **[DR-slice-choice]** A Door state in the Walls tool, so a doorway can be an
  open arch or hold a door, which needs a save change and is its own design.
* **[DR-slice-horizontal]** Doors on horizontal lines, once their art exists.

## What this does not do

Locks, doors that block anyone, or doors on the outside wall other than the
front door.
