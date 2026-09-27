# Build mode: the house is judged from its front door

Status: [RD-slice-root] shipped in PR 99 at merge `ed9f5fb`.

This is [B-reach-from-the-door] in `docs/FEATURES.md`, found in review of the
Room tool (`docs/specs/2026-09-22-room-tool.md`). Every lot edit proves the
house stays usable (`prove_lot_usable` in `crates/terri-sim/src/placement.rs`):
it floods the floor from one tile and checks that every sim, every object's
approach and the front door's landing are in the flooded region. The flood
started at the first walkable tile in reading order, so an empty room sealed
around that tile made the rest of the house look cut off. In the shipped lot
that tile is (7, 0): a one-tile room with no doorway there was refused as
blocking someone's way, while the same room at (9, 0) was built.

## What the player gets

* **An empty room with no way in can be built anywhere.** Sealing off floor
  with nobody and nothing in it is allowed wherever it is, not only away from
  the top-left corner of the house.
* **A refusal names what the edit would cut off from the front door**:
  someone's way, or furniture out of reach.

## Decisions

### [RD-root] The flood starts at the front door

On a lot with a front door the flood starts at the front door's tile, which
every usable house must reach anyway. On a lot whose content names no front
door it starts at the first walkable tile in reading order, as before, so that
tile still cannot be sealed off there. No lot a player can reach is one: a
blank custom lot (`Sim::new_with_lot`) keeps the shipped content and its front
door. Only test content without a door uses the fallback.

### [RD-reasons] Which refusal a cut-off house gives

The checks keep their order ([WT-rules] 8 in
`docs/specs/2026-09-21-wall-tool.md`): the front door's tile and its landing
are clear, then every sim, then every object's approach, then every portal's
landing is in the region. A house cut in two now reads as what the cut leaves
unreachable from the front door:

* a sim on the far side: `BlockedRoute`, "A wall there would block someone's
  way.";
* furniture on the far side: `InaccessibleInteraction`, "A wall there would
  leave furniture out of reach.";
* nothing on the far side: built.

The door's own reach check goes: the flood starts there. The landing's reach
check stays, for two cases. A lot with a second portal could cut that portal's
landing off; the wall rules guard only the front door's own line. And a loaded
save may already hold a wall between the front door and its landing, which the
loader accepts while nobody has a job; no edit can build that wall, because
the wall rules refuse it first.

Before this, a cut that left the first walkable tile on the far side from the
door reported `BlockedDoor`, "A wall there would cut off the front door.",
when no sim and no object's approach stood on the door's side; otherwise it
reported `BlockedRoute` or `InaccessibleInteraction`, because the door's reach
check ran last. `BlockedDoor` now only refuses an edit while the front door's
tile is not open floor: something stands on it, or it lies outside the lot. A
furniture move or a purchase can stand something there; a wall or a room never
changes whether a tile is walkable, so it meets `BlockedDoor` only where the
door tile is already not open floor. Play never makes that: it takes a
hand-edited save, or a blank custom lot too small to hold the shipped door at
(15, 2). No doorway can mend it, so the Room tool's doorway hint no longer
offers one for it. The line
stays in the shell's refusal tables so every code keeps its meaning.

### [RD-save] Nothing saved changes

The flood runs only while validating an edit, and the V3 loader does not
flood, so no save that loads today stops loading, and no save or world hash
changes. Build-time content validation in `terri-data` keeps its own flood
from the first walkable tile (rule 3 of the content checks in
`docs/specs/2026-07-30-object-footprints-design.md`): an authored lot must have
every object reachable from every other, which is a stricter rule than this
one and is unchanged.

## Slices

* **[RD-slice-root]** Everything above.

## What this does not do

It does not mend a house that is already cut off from its front door: such a
house refuses every new wall until the player opens a way through, as before.
