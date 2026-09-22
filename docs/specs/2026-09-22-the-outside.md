# The outside: a yard, then a street

Status: [OS-slice-yard] is built, on branch `twcl/the-yard`. Its played
check is [A-yard]. [OS-slice-street] is built on branch `twcl/the-street`, and
its played check is [A-street].

This is [B-outside] in `docs/FEATURES.md` and the larger lot, item 5 of
[S-build] in `docs/GAME-SYSTEMS.md`. Before it, the lot was the house and
nothing else: 16 by 12 tiles, every tile indoor floor, the front door on the
lot's east edge, and a commuter who reached it simply vanished. Visitors, pets,
dog walks, disasters and neighbours all need somewhere outside the house to
be.

## What the player gets from the first slice

* **A yard.** The lot grows to 20 by 16. The house keeps its tiles, and a
  yard four tiles deep wraps its east and south sides. Yard tiles are drawn
  green until there is grass art.
* **A front door that opens onto the yard.** Sims walk out through the front
  door, wander the yard on their own, and come back in, and the door swings
  for them as the interior doors do.
* **More house.** The yard is part of the lot, so furniture can be bought and
  placed there, and the Walls and Room tools can build on it. The house's own
  east and south walls become walls like any other, so a player can knock
  through them to extend a room into the yard.
* **Saved houses gain the yard.** A save made before this loads with its
  house exactly as it was, standing in the new yard, when its walls are edges:
  every save since the Walls tool, and every older one the reviewed migration
  moves to edge walls. One kept in its frozen older layout loads as it always
  has, with no yard.

## [OS-grow] The lot grows east and south, so no coordinate moves

The lot becomes 20 by 16 and the house keeps tiles (0, 0) to (15, 11). Growing
only east and south means every saved position, path, wall edge, object and
queued command keeps its meaning, and the front door keeps its tile, (15, 2).

The save fingerprint does not hash the lot's size or its walls, only the front
door's tile and each portal's position and landing, and none of those move. So
the fingerprint is unchanged and no save is refused for it.

`content/lot.toml` gains the house's size, `house = { width = 16, height = 12
}`, the house standing in the lot's north-west corner. The compiler checks the
house fits the lot, and that every line between a house tile and a yard tile
holds a wall or a doorway, so the house is closed by content rather than by
the lot's edge. A lot that names no house is all house, as every lot was.

## [OS-yard] A tile is yard when it is outside the house

A tile is yard when it lies outside the house's rectangle. This is derived
from the content's house size, not saved. A saved per-tile floor is [B-floors],
which will save each tile's surface and read older saves by this rule.

Yard tiles are walkable floor to the simulation, exactly as house tiles are:
routes, idle wandering, placement, the Walls and Room tools, and the proofs
that flood the floor from the front door ([RD-root]) all treat them alike.

The shell draws a yard tile with the floor's art under a colour shift, the
same shift a colourway applies ([RC-shift]) and with a colourway's ranges, its
values in `content/lot.toml` beside the house size: hue turned 65 degrees,
strength 2 and lightness down 0.22, which turns the beige floor a muted green.
Grass art waits on the owner ([T-yard-art]).

## [OS-walls] The house's outside walls are ordinary walls

The house's east wall is the vertical line x = 16 for y from 0 to 11, and its
south wall is the horizontal line y = 12 for x from 0 to 15: 28 new
`wall_edge` rows in `content/lot.toml`, all walls except the front door's line,
(16, 2), which is a doorway. The lot's own edge stays the outside wall the
tools cannot change, as now. The house's north and west walls are still drawn
on it, along the house only: along the yard the lot's edge has no wall, so the
house does not seem to carry on past its corner.

**They are cut away.** The view looks at the house from the south-east, so a
full wall on the east or south side would hide a strip of every room along it.
Those sides are not drawn today, and they stay undrawn: the renderer leaves out
any wall or doorway on a line with a house tile on its north or west side and
a yard tile on its south or east side. They still stop sims, routes and lamp
light, as every wall does. Walls a player builds in the yard are drawn as any
other wall. Low wall art for a cut-away view waits on [T-yard-art].

## [OS-door] The front door stands on the house's wall

The front door keeps its tile, (15, 2), its facing, south-east, and its
landing, (15, 3). Its line, (16, 2), is now a doorway into the yard.

* **Content.** The compiler accepts a front door either on the lot's edge, as
  before, or on the house's outside wall: inside the house, facing south-east
  so that its line is vertical like the only door art there is, with the tile
  across the line in the yard and the line a doorway in `wall_edge`. Only
  south-east: the house stands in the lot's north-west corner, so a door facing
  north-west or north-east has no yard across it, and one facing south-west
  would stand on a horizontal line, which has no door art.
* **Its swing.** The door is open for a sim walking through its line, by the
  interior doors' rule ([DR-state]), and for a commuter, by its own rule as
  before; whichever is more open wins.
* **No second door.** Interior doors are derived for every vertical doorway
  ([DR-derived]) except the front door's line, which already has its door.
* **It stays a door.** A wall edit or room that would make the front door's
  line a wall is refused as cutting off the front door, refusal 12, which the
  Walls and Room tools already word. Making the line open floor is allowed:
  the door stands in the opening, and nobody's way is cut. Every lot edit also
  keeps the yard tile beyond the line open floor the door reaches, so nothing
  is bought onto it and no wall comes between it and the door, with the same
  refusal. That keeps the tile, not the yard behind it.
* **Read from content.** The door's line comes from the content's front door,
  matched to its portal as the loader matches it, and the grid's width, never
  from the presentation-only portal rows, so a world built without the door's
  art keeps the same rules and the same digest. Facing is not in the save
  digest. It follows from the door's tile together with the lot's size and
  house, for which the compiler allows exactly one facing; neither is hashed,
  and a content change to them is a change of the lot itself, the kind
  [OS-migrate] meets with a reviewed migration.

Commuters walk out through the yard to the street: [OS-street].

**Known until later slices.** The house's cut-away walls
facing the yard show nothing, so a doorway the player makes in one changes
nothing on screen though sims now walk through it, and lamp light stops at a
line nobody can see; only the floor's colour marks the house's edge until
there is low wall art ([T-yard-art]). Walls or a room can still shut parts of
an empty yard off from the door where nothing needs to reach them, but never
the street's exit ([OS-street]). The exit looks like the rest of the street,
so furniture refused there reads as blocking someone's route with nobody in
sight; marking the exit waits on street art. A save crafted with the front
door's line
walled still loads, and the Walls tool can open the line again. A worker
reaching the street vanishes on its tile, at the lot's edge, until there is a
way to draw it walking off along the street.

## [OS-migrate] An older save grows into the yard on Load

A save whose house was saved with edge walls ([WT-apply]) and whose grid is
exactly the content's house size, loaded into content whose lot is larger,
grows after every other check has passed and before it replaces the running
world:

1. The grid becomes the content lot's size, each saved blocked tile and edge
   barrier kept at its own coordinates.
2. The content's walls that are not inside the house, its outside walls and
   any wall in the yard, follow the saved walls in the list, and every edge
   barrier is rebuilt from that list, as a load builds them. A saved house has
   no wall on its outside lines, since they were the lot's edge and no wall
   could stand there, so nothing is replaced.

Everything else in the save is kept as saved. A save already at the lot's
size, or saved before edge walls, is not grown: the second keeps its frozen
layout, which the Walls tool already refuses to edit, and loads as it always
has. The migration of Save V1 houses to edge walls reads its reviewed
destination from the house's own size and walls rather than the whole lot's,
so a V1 save still reaches edge walls, and then grows. Every loader passes
through the growth, since it runs where a restored world replaces the running
one.

The world hash of the grown world differs from the saved one, as every
migration's does; a Load is not a replay.

## [OS-camera] The view opens on the house

At 1280 by 720 the house fills the view with about 12 pixels to spare
([B1] in `docs/specs/2026-07-30-the-house-design.md`), so a larger lot cannot
open at the same scale and still show all of itself. The view opens framed on
the house, at the scale it opens at today, and the player pans and zooms to
see the yard. Panning, and the rule that keeps part of the lot in view, use the
whole lot. A lot smaller than the house, one saved before the yard that never
grew, opens framed whole.

## [OS-street] Commuters walk out to the street

This is [OS-slice-street]. The street is the lot's edge column that the front
door faces across the yard: for the shipped lot, the east column, x = 19. Its
**exit** is the street tile straight across the yard from the door, (19, 2).
Both are worked out from the content's front door, its portal and the lot's
width, as the door's line is ([OS-door]), so nothing is added to the save and
the save digest does not move. A lot whose front door has no yard beyond it
has no street, and its commute ends on the door's tile as it always has.

* **Leaving.** At the shift's start the worker walks from where it stands, out
  through the front door and across the yard, to the exit, and clocks in
  there, out of sight. The door swings as it passes. A house saved with
  furniture on the exit, by a build that had the yard before the street,
  sends its worker out by the door instead, as before the street.
* **Coming home.** At the shift's end the worker reappears on the exit and
  walks home along a path to the door's landing, in through the front door
  unless the player has opened another way into the house. The pay, the
  energy and the satisfaction are settled on the tick it reappears, as
  before.
* **Old saves finish as they started.** A commuter saved on its way to the door
  still clocks in at the door; a worker saved at work on the door's tile still
  steps home to the landing; a commuter saved on its way home still ends there.
  Which way a commuter is going is still read from where its walk ends, so no
  save field is added.
* **The save check.** A worker saved at work on the exit must have a path
  home to the landing; one at work anywhere else keeps the straight-line check
  it had.
* **The way stays open.** A lot edit that would cut off an exit the front
  door reaches is refused as blocking someone's way (refusal 10). One that
  leaves an already shut-off exit shut off is not, so a house saved that way
  can still be changed and mended.
* **The door.** Only the one step in from the door's tile counts as closing
  the door; a walk home from the street swings it by the crossing rule as
  anyone's does, and leaves it shut when it comes in by another doorway. The
  half-tile drawing offset for a commuter stepping through a door on the lot's
  edge is not applied to one walking through a door with a yard beyond it;
  a worker at work on the door's tile keeps it, though it is not drawn then.
* **The look.** The street column is drawn as the floor under the lot's
  `street` colour shift, grey until there is street art ([T-yard-art]); it is
  yard to everything else, so furniture and walls may stand on it, off the
  exit.

## Slices

* **[OS-slice-yard]** Everything above, in one pull request: the yard, the
  door onto it, the walls, the migration and the camera.
* **[OS-slice-street]** A street along the yard's far edge. Commuters walk out
  of the door and through the yard to the street, vanish there, and come back
  the same way, so the door stops being where a sim vanishes. Walking off
  along the street waits on a way to draw it.
* **[OS-slice-daylight]** Sunlight on the yard by day and darkness by night,
  separate from the house's lamps, and windows ([B-windows]) letting it in.
* **[OS-slice-exterior]** The house seen from outside: exterior wall art and
  roofs. Waits on art.
* **[OS-slice-outdoor-objects]** Things that belong outdoors: a bench, a
  barbecue, a garden. Waits on art.

## What this does not do

A second storey, lots of other sizes or shapes, other lots and the
neighbourhood around them, and visitors arriving. Each builds on the street.

## Review record

A fresh-context review of [OS-slice-yard] loaded 60 real saves written by the
build before the yard, one every 500 ticks with workers at work and
commuting, a player's wall and queued wall edits, and found every one loads,
grows and replays alike. It found an untested half of the check that a front
door stands inside the house, which the mutation sweep would have failed, now
pinned by a door on the first yard row below a house; and the front door's
line read from the presentation-only portal rows, so a world without the
door's art would take a wall the game refuses, now read from the content with
a test that the two worlds agree. It also found the tile beyond the door
unguarded once a player opens a second way into the yard, now kept open by
every lot edit; three doc comments moved off
their functions; a wrong reason for allowing only a south-east door; an
overclaim that every saved house grows; a stale comment on the door's far
side; and no real pre-yard Save V5 among the fixtures, now `pre-yard-600.hex`.
The cut-away walls showing nothing, a worker vanishing in the doorway, and a
crafted save with the door's line walled are recorded above as known until
later slices. It also judged a test that reads the startup source as text to
prove little; it stays, as the way this project checks `main.ts` wiring.

A second round found no fault in the code. It found that the new test for
the tile beyond the door passed without the rule, since that purchase was
already refused for its own approaches; the test now opens a second doorway
into the yard first. It also found that a walled-off yard behind the tile is
possible, now recorded above, a reason for not hashing the door's facing that
leaned on the lot's size, now reworded, and no lesson for reading a rule from
presentation-only state, now [L-a-rule-read-the-picture].

A fresh-context review of [OS-slice-street] played every real saved stage of
a shift, the front door release's at work and walking home and main's
walking out, and 22 more saves from main and the yard build, to their end,
each paid once. It found a house saved by the yard build with furniture on
the exit would miss every shift and refuse almost every edit, now sent out
by the door, with edits refused only for cutting off an exit the door
reaches; the door drawn closing for a walk home by another doorway, now only
the one step in closes it; a test for a shut-in exit that passed without its
rule, now isolated with a doorway that clears the straight line; the fixture
tests comparing two loaded games rather than the shift's end, now played to
it with a real mid-commute save from main; one test for standing on a tile
shared by the commute and the save check; and stale comments and docs.
