# Object Footprints - Decisions

Status: **decided, being built.** Five decisions, each with the alternative that
was rejected and why. Recorded before implementation so the reasoning survives
the code.

## The problem

An object occupies exactly one tile whatever its sprite's width. Measured
consequences on shipped content:

- The bed is drawn 1.45 tiles wide, so a sim standing on an *adjacent* tile has
  **88% of its own sprite inside the bed's**. One tile is 32 px of screen width
  and the bed is 93 px, so "stand beside it" does not visually clear it. No asset
  choice fixes this: **every bed in the kit is at least 1.46 tiles wide**, because
  a bed genuinely is a multi-tile object.
- Nothing prevents two objects being placed on tiles whose sprites overlap. The
  shipped lot happens not to, checked, but that is placement luck.
- 25 objects in a multi-room lot cannot be authored safely without it.

## [F1] A footprint is declared in content, not derived from the sprite

`content/objects.toml` gains an optional per-object `footprint = { width = 2,
depth = 1 }`, defaulting to 1x1 so existing content is unchanged.

**Rejected: derive it from the sprite's pixel width.** Tempting, since the sprite
is what looks wrong. But the sprite is *presentation* and the footprint is
*simulation* - a re-skin would silently change collision, pathing and where sims
stand, and a wall of the codebase exists to keep content out of the renderer and
vice versa. The two numbers should agree, and a mismatch is worth reporting, but
they are not the same fact.

## [F2] The placement coordinate is the ORIGIN tile; the footprint extends +x, +y

A `2x1` object at `(4, 7)` occupies `(4,7)` and `(5,7)`.

**Rejected: centre-anchored.** Even widths then land on half-tiles, so authoring
a lot means reasoning about whether a 2-wide object at x=4 covers 3-4 or 4-5, and
getting it wrong is invisible until a sim walks through a sofa. Origin-anchored is
what a tile editor would write and what build mode will write later.

## [F3] Footprint tiles become UNWALKABLE

**Rejected: keep them walkable and use the footprint only for adjacency.**
Cheaper, and wrong: sims would path straight through the furniture, which is the
defect this exists to fix wearing a different hat. Blocking them is also what
makes "cannot overlap" enforceable at all.

The risk this creates is real: **an object placed in a doorway can seal a room.**
So [F5].

## [F4] Adjacency targets the RECTANGLE, and the heuristic has to change with it

`find_path_adjacent` currently accepts any tile orthogonally adjacent to a single
target tile. It must accept any tile orthogonally adjacent to the footprint
rectangle.

**This breaks the optimality argument already written in that function's docs,
and the docs say so.** The current heuristic is `Manhattan(n, to)`, which is
inadmissible-but-safe because it is **exactly 1 at every goal** - uniform across
the goal set, so `f` ordering among goals is `g` ordering and the first goal
popped is the cheapest. With a rectangle, goals sit at different Manhattan
distances from the origin tile, that uniformity is gone, and the search would
happily return a reachable-but-not-nearest tile.

**The fix: `h(n)` becomes the Manhattan distance from `n` to the nearest tile of
the rectangle.** That is 1 at every goal again, so the argument transfers exactly.
It is also still consistent, changing by at most 1 per edge.

**Rejected: `h = 0`, i.e. Dijkstra.** Correct but slower, and selection already
runs one search per candidate object per idle agent per tick - the one thing in
the tick with a real cost.

## [F5] Build-time validation, three rules

Content that would produce an unplayable lot fails `cargo build`, per [D9]:

1. **No two footprints intersect.** The rule the goal asks for.
2. **No footprint intersects a wall, and none extends outside the lot.** Both are
   silent otherwise: the object draws fine and its tiles are simply gone.
3. **Every placed object has at least one walkable adjacent tile, and every one
   of them is reachable from every other.** A flood fill from the first walkable
   tile in the lot; anything unreachable fails the build.

Rule 3 is what catches [F3]'s doorway risk. **Rejected: leaving reachability to
runtime.** It already is - `find_path_adjacent` returns `None` and scoring treats
the object as unavailable - but the failure mode is a sim who quietly never uses
half the house, which is exactly the class of bug this project keeps finding by
accident weeks later. A lot is authored once and read forever; check it once.

## What this does not do

Footprints are **axis-aligned rectangles with no rotation.** Every sprite in the
kit is pre-rendered at one facing and the projection is fixed, so a rotation
concept has nothing to act on yet. When build mode adds rotation it will need a
facing on the placement and a swap of width/depth; nothing here should assume
square.
