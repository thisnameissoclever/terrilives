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

Which lines hold doors follows from the saved walls: every vertical doorway,
on a lot whose front door has art that fits a vertical line, as the shipped
lot's does. A lot with no front door, or a cell-wall house, has none. So a door
adds nothing to the save or the save digest, and no save changes
meaning. A door's state is presentation, rebuilt every frame from positions
and walks that are already saved, exactly as the front door's is.

### [DR-state] When a door opens

A doorway spans the gap between the centres of the two tiles either side of
its line, and a sim walks in one-tile steps between tile centres. So a door
reads a sim's steps rather than its distance:

* **Open** while the sim's body is inside that gap, which only the step across
  the line passes through, or where a sim whose walk stopped midway stands.
* **Opening** while the step the sim is walking, or the one after it, crosses
  the line.
* **Closing** while the step the sim last finished crossed it.
* **Closed** otherwise: standing beside the door, walking along its wall,
  crossing the same line on another row, or walking up to the door and turning
  away.

When several sims ask different things of one door, open wins over opening,
opening over closing, and closing over closed, as for the front door.

The swing is cut short in two cases. A walk does not keep the tile it set
out from, so when a walk's first step is the one through the door, the door
can snap open or shut without its ajar frame. And a walk that ends on the tile
just past the door is removed on the next tick, so the door swings shut in
one tick instead of over a whole step. In a 20,000-tick run of the shipped
household the reviewer counted about 280 full swings, 8 snaps and 9 short
closes. The swing is presentation; saving the start tile only to show it is
not worth a save change.

The rule has no thresholds to tune: half a tile is where the tile centres
are.

### [DR-render] Where it is drawn

A door is one more row in the portal buffer the front door already uses,
after the front door's row: the renderer, the boundary's portal columns and
the reduced-motion leaf need no change. It stands on the +X edge of the tile
left of its line, where the front door's art stands on its own tile, with the
front door's depth offset. The shell leaves out the doorway's empty panel on a
line that holds a door (`interior_door_lines` at the boundary), so the two
never double up.

A portal is lit like the wall it stands in, from the brighter of its own tile
and the tile across its line, which each row carries in the portal buffer. For
a door that is the room on each side. For the front door the far tile is off
the lot, where the light field is always dark, so the front door is lit as
before.

Each loader synced the render buffer before it put the saved walls in, so a
loaded house would have drawn its doorways doorless until the next tick. The
three `Sim::load_snapshot` functions now rebuild the portal rows after the
restored world replaces the running one.

## Review record

The fresh-context review of [DR-slice-derived] raised eight findings, all
fixed in the same branch:

* [F1] and [F2]: the first rule judged a door by the distance from its line,
  so it swung for a sim standing beside it, walking along its wall, or walking
  up to it and turning away, and read a crossing from right to left
  differently from one left to right. [DR-state] now reads the walk's steps.
* [F3]: only the V2 and V3 loaders rebuilt the door rows; the V1 loader, which
  moves the cell-wall house to edge walls, did not.
* [F4]: the first rule's four distances were hard-coded. The step rule has
  none left, so there is no tuning knob to add.
* [F5]: a door took its light only from the room on its left. [DR-render]
  now lights it from the brighter side.
* [F6]: the glossary, this spec and a bridge doc comment said things that
  were no longer true.
* [F7]: the shipped-lot tests counted doors by asking the code under test.
  They now assert three doors and four portal rows.
* [F8]: the first rule built a list for each sim on every frame. The step
  rule reads the walk where it is stored.

A second round on the fixes found two more, both fixed:

* [F9]: with the strongest state taken by `max_by_key`, no test put a closing
  sim ahead of a closed one, so deleting closing's rank survived. A two-sim
  test now does.
* [F10]: the limitation above named one of the two ways a swing is cut
  short.

## Slices

* **[DR-slice-derived]** Everything above.
* **[DR-slice-choice]** A Door state in the Walls tool, so a doorway can be an
  open arch or hold a door, which needs a save change and is its own design.
* **[DR-slice-horizontal]** Doors on horizontal lines, once their art exists.

## What this does not do

Locks, doors that block anyone, or doors on the outside wall other than the
front door.
