# The House - Decisions

Goal item 8: "a home worth living in - multiple rooms, 25+ objects, real
footprints that cannot overlap." The lot went from one open room plus a
bathroom, 14 x 10, holding 8 objects, to five rooms, 16 x 12, holding 33.

Status: **built, looked at, and twice corrected by looking again.** Two of the
decisions below ([B5] and [B6]) record a first attempt that was wrong, because
in both cases the wrong version was green and plausible and the thing that
caught it was a measurement.

---

## [B1] Five rooms, and the circulation is a ring rather than a corridor

`content/lot.toml` carries a tile-by-tile plan; this is the shape of it.
Kitchen and living room north of a full-width spine at y = 5, with bedroom,
study and bathroom south of it, and five doorways: (7,2), (3,5), (13,5),
(5,9), (11,8).

Kitchen to living to bathroom to study to bedroom and back to the kitchen. A
closed loop, and it earns its keep twice:

- **Two routes between any pair of rooms.** A* has something to choose between,
  and two sims heading opposite ways need not share a tile. With one corridor
  every journey shares it, and contention would be an artefact of the floor plan
  rather than of the furniture - which matters directly for goal item 1's "three
  sims, contention without deadlock".
- **No dead ends.** A tree layout has a leaf room entered only on purpose. On a
  ring a sim crosses every room in the course of ordinary business, which is
  what makes the whole house worth drawing.

The cost is that there is no hall, so a sim walks THROUGH rooms rather than past
them. For a flat this size that is what a flat this size is like.

**The ring is asserted, not assumed.**
`the_shipped_lot_loads_its_walls_its_doorway_and_all_of_its_objects` seals each
of the five doorways in turn and re-checks that every room is still reachable,
then seals BOTH of the bedroom's doorways and requires that it becomes
unreachable. Two paths that merely both succeed would not have been the claim:
on a tree they would both succeed too, by sharing the one corridor.

**Rejected: a central corridor with rooms off it.** The obvious plan, and it
makes every journey in the house contend for the same tiles. It also spends more
tiles on circulation than a ring does at this size.

**On the size, and the derivation that was wrong.** This spec and `lot.toml`
both claimed the bound was "width + height at or under about 28, because the
tallest sprite reaches 98 px above its anchor". Both halves were wrong: the
tallest sprite is the 114 px bunk bed, and the derivation reasoned about the
TILE span while `tiles.ts` draws a boundary two half-tile rows further up again
at x = -1 and y = -1. The lot is 28, the bound said 28, and **three boundary
panels were being cut off the top of the page** - measured afterwards as a
topmost painted row of 0 where an unclipped picture starts at 25.

`cameraOrigin` in `web/src/render/iso.ts` owns the arithmetic now, centres the
DRAWN extent rather than the tile span, and reads the tallest sprite off the
atlas so a taller piece of furniture cannot silently push the house off screen.
The remaining authoring rule is one number: the drawn extent is 702 px of 720
at 16 x 12, so one more tile on either axis costs 21 px and there are 18 to
spare. 16 x 12 really is the largest this lot gets without a camera, just not
for the reason first given.

---

## [B2] Ten of the thirty objects are furniture nobody uses

30 object definitions, 33 placements: `counter`, `chair` and `potted_plant` are
each placed twice. Of the 30, **10 declare no interactions at all** - the
counter, the two chair kinds, the trashcan, the potted plant, the floor lamp,
the coat rack, the nightstand, the dresser and the washer-dryer. The former
moving box and personal reference shelf became the functional exercise bike and
aquarium in [AEB-scope], without changing their Save V1 persistence slots.

That is a category, not an omission. A house reads as a house because of the
things in it nobody uses on purpose. They advertise nothing, so `select_action`
never scores them; they cost one entity and one blocked tile each.
`an_object_may_declare_no_interactions` in `schema.rs` is what keeps it legal,
and `at_least_a_third_of_the_house_is_furniture_nobody_uses` is what says the
shipped content actually uses it.

That test asserts **both** directions, and the second is the one with a bug
behind it. A pipeline that silently dropped interactions - a bad merge, a
`#[serde(default)]` on the wrong field - would leave every object advertising
nothing, the house would look identical, and every sim would stand still for
ever ([L17]). "At least one has none" is green in that world.

The original behaviour trace was taught the same distinction. It flagged all
then-12 scenery definitions as `NEVER USED`, which buried the interactive
objects that really were at zero
under a dozen that never could be anything else - testing-protocol rule 5 from
the other end: a signal that fires on everything says nothing. Scenery now
prints as `(scenery)`.

**Rejected: a `scenery = true` flag in content.** An empty interaction list
already says it, and a flag that had to agree with that list is a second copy
of one fact.

---

## [B3] Object declaration order is not Save V1 identity

An object's position in `objects.toml` assigns its pack-local `ObjectDefId`.
That numeric index is convenient inside one compiled build, but it is not
stable across content edits and Save V1 never persists it as object identity.
Snapshots store the authored string id and resolve it against the current pack.
Reordering definitions is therefore save-compatible, although it still
renumbers the compiled array, changes pack bytes, and creates needless churn in
numeric fixtures or deterministic goldens.

The rooms are a property of `lot.toml`, which is where a reader should go to
find out what is next to what. `objects.toml` remains organised as an authored
catalogue rather than being repeatedly regrouped to mirror one current lot.

---

## [B4] Everything in the house stands on the floor

A footprint BLOCKS its tiles, and the simulation has no notion of a decoration a
sim may walk over, nor of a thing mounted on a wall. So the kit's rugs,
doormats, wall mirrors, upper cabinets, ceiling fans and worktop appliances are
all deliberately absent. Each would be either an invisible obstacle in the middle
of a room, or a floating object occupying the tile a sim needs in order to reach
whatever is underneath it.

This cost real content. A microwave and a coffee machine were both wanted for
the kitchen and both are worktop appliances; the kitchen has a `counter` twice
instead. The kit's `plantSmall1` and `plantSmall2` were tried and measured at
**8 x 10 px** after scaling - a speck occupying a whole blocked tile, which
reads as an invisible obstacle rather than as an ornament. Anything standing on a
tile has to be big enough to explain why a sim cannot walk there.

**Rejected for now: `blocks = false` on a footprint.** It is the right feature
and it is not free: `Sim::new_from_lot` blocks tiles, `compile`'s three footprint
rules all reason about blocked tiles, and rule 3's reachability flood fill would
need to distinguish "occupied" from "impassable". Two of those three rules would
also lose their meaning for a non-blocking object - a rug genuinely may overlap
a table. Whoever wants a rug owns that change.

---

## [B5] A wall tile at a junction takes the orientation of the run that passes through it

**Got wrong twice, and the second wrong version looked like it worked.** Worth
recording in full because the failure mode is general; [L53] is the short form.

`wallOrientation` picks one of two sprites per wall tile: north-south if the
tile has a wall neighbour on the y axis, east-west otherwise.

**The first rule** resolved a both-ways tie towards north-south. It was correct
on the one-room flat, whose two runs met at a single L corner where either panel
closes the join, and wrong the moment a T-junction existed. This floor plan's
spine runs east-west and three of its tiles - (5,5), (7,5), (11,5) - carry a
north-south divider hanging off them. All three took the north-south panel, so
the spine had three panels turned 90 degrees in the middle of it and read as a
wall with holes punched through it, at exactly the three places the eye goes
first. **Found by looking at a PNG of the running game.** The gate was green.

**The second rule drew BOTH panels** at such a tile, on the reasoning that a
32 px panel on a 64 px tile diamond leaves room for two - one occupying the
tile's east half and one its west, abutting rather than overlapping. That
reasoning was false and the fix mostly did not work:

- `sprites.wgsl` centres every quad on its anchor, so two panels written at one
  tile occupy the **same** 32 px rather than two halves.
- Measured off the atlas PNG: only **356 of `wallEW`'s 2540 opaque pixels, 14%**,
  fall where `wallNS` is transparent. Neither sprite occupies a half; every
  column of both is 76 to 80 px solid.
- A pixel diff of the two frames confirmed it exactly. The whole 1280 x 720
  frame changed by 726 pixels, all of them inside the three junction boxes, and
  the (11,5) box changed by **356** - the same number. The junction still read
  as a north-south panel with a sliver behind it.
- Two coincident quads is also [V12]'s depth conflict waiting to happen, since
  `layeredDepth` gives them the same value and `depthCompare` is `less`.

**The rule that ships: the run that passes through wins.** A T-junction has
neighbours on both sides of one axis and on only one side of the other, and that
asymmetry is the answer - the through-run is a continuous surface and the spur
is a wall that ends against it. One panel per tile, no overlap, no depth
conflict. A true crossroads has no right answer with one sprite per tile and
falls through to north-south; the shipped lot has none.

The tests were rewritten around what each fixture can *express*. The L-shaped
one is kept and its corner is now asserted as an exact single sprite. A T is
added, because an L cannot contain a T-junction however its coordinates are
chosen. A **transposed** T is added as well, because the T alone cannot see "at
a junction, always prefer east-west" - there the through-run IS east-west. And a
free-standing tile, for a rule that returned two panels unconditionally.

---

## [B6] The comfort rebalance, which took three passes and overshot on the second

The five-room house added five comfort objects. Each pass was measured; each
found the previous one's mistake.

**Pass one: all five at zero uses in 12 000 ticks.** The candidate table said
why in one line - `comfort` sat at level 87, a deficit of 0.13, and score is
`delta * deficit^3 / (distance / 0.25 + duration + 1)`. Cubed, that deficit is
0.0022. The armchair's 38 comfort, the best comfort-per-tick object in the
house, scored **0.0071 standing beside it** against an `action_threshold` of
0.05. An order of magnitude short at point-blank range, so no delta and no
duration fixes it. This is [C6]'s shape in a different need.

Comfort was over-supplied and barely drained: 298 points delivered against 252
over 12 000 ticks, floor 60.8.

**Pass two: three changes, and one of them overshot.**

1. **The double bed's comfort went 27 to 10.** Eight nights' sleep was supplying
   216 of those 298 points - comfort was being kept topped up as a side effect of
   an action taken for a different need, which is precisely what was wrong with
   `fun` through the television.
2. **`comfort` decay went 0.021 to 0.032.** It was the slowest of the seven at
   0.021; at 0.032 it is second slowest behind `social`'s 0.026, deliberately -
   comfort should be a background ache rather than an alarm.
3. **The five new comfort deltas were roughly halved.** This is the part that
   overshot. It fixed the supply and created a monopoly: at 23 and 27 the dining
   table and the long sofa were worth about 0.37 comfort per tick against the
   **pre-existing** ottoman sofa's 0.667, so the ottoman took every comfort
   decision in the house. Over 120 000 ticks it got 72 uses and those two got
   **zero**.

**Pass three: match the rate rather than halve the delta.** The dining table
went to 37 and the long sofa to 43, which puts both at 0.597 per tick against
the ottoman's 0.667 and the armchair's 0.707. Four seats within 16% of each
other, so which one a sim picks is decided by distance and habituation rather
than by one of them being twice as good.

The lesson is narrower than "measure it": **halving a delta and halving a rate
are different operations, and the one that matters for whether an object is ever
chosen is the rate.** Duration is in the score's denominator.

Two other objects were at zero for reasons worth writing down separately.

- **The reading chair missed by 0.0004.** At 66 ticks it scored 0.0497 against a
  threshold of 0.0500, standing two tiles from an idle sim. Nothing was wrong
  with either delta. 51 ticks scores 0.062. An object can be at zero uses and be
  four ten-thousandths away from working.
- **The bathtub could not have worked at 130 ticks.** Its direct rival is the
  45-tick shower, and duration in the denominator means a 130-tick action needs
  about three times the delta to compete. With hygiene and comfort both at their
  floors it scored 0.15 against the shower's 0.32, which at temperature 0.06 it
  loses about nineteen times in twenty. A large enough delta could in principle
  have closed a 1.7x gap; nothing that still read as a bath could. 78 ticks did.

**Rejected: lowering `action_threshold` and `choice_temperature`.** Measured
across six settings. It works on the stated criterion - `0.012 / 0.010 / 0.008`
took never-used objects from 4 to 2 - and it costs the thing goal item 4 needs:
idle time fell from 16.8% to **5.7%**, because a lower bar means something is
always worth doing. Item 4 wants idle time to be the raw material hobbies
consume, so spending it to make a table look better is the wrong trade. The
thresholds are unchanged at 0.05 and 0.04.

**What the distance term is, and why it was not touched.** Score divides by
`distance / TILES_PER_TICK + duration + 1`, so the factor of 4 on distance is
not a weight - it is the real number of ticks the walk takes, and `movement.rs`
uses the same constant. Doubling the lot's diagonal genuinely halved every
distant object's score, and that is correct rather than a bug to tune away.

---

## [B7] Walls live on tile centres and consume a walkable tile. This is wrong, and it is deferred.

Worth stating plainly because the house makes it visible for the first time: a
wall in this game **is a tile**. The 16 x 12 lot spends 28 of its 192 tiles on
interior walls, and each wall panel is drawn 32 px wide at the centre of a 64 px
tile diamond, so floor shows on both sides of every run and a wall reads as a row
of free-standing screens rather than as one surface.

The right model is the one The Sims uses: **a wall lies on the EDGE between two
tiles**, occupies no floor, and a doorway is a property of an edge rather than a
gap in a list of tiles. That would give back 28 tiles, make walls look like
walls, and make a door a thing that can be open or shut. It would also make
[B5]'s whole problem disappear, because an edge has one orientation by
construction.

It is not a content change. It touches the tile grid's representation, the lot
file format, `compile`'s three footprint rules, pathfinding's neighbour test, and
the whole of `tiles.ts`. Doing it inside this milestone would have replaced
"there is a house" with "there is a rewrite", so the house was built on the model
that exists. **Whoever needs doors owns it**, and build mode is the natural
moment: an editor that lets a player draw a wall wants edges anyway.

---

## [B8] One atlas, and `MAX_SPRITES` raised from 32 to 128

The atlas went from 13 sprites to 35 and `packSpriteTable`'s guard fired -
correctly, because WGSL **clamps** an out-of-range uniform-array index rather
than trapping, so sprite 32 upward would have silently drawn as sprite 31.

The choice was between raising the limit and splitting the art, and [D10] rules
splitting out: one atlas is what keeps the whole frame a single instanced draw
call. Raising it is nearly free, and the arithmetic is worth having written down:
each entry is 8 floats = 32 bytes, so the uniform buffer is 4 KiB against
WebGPU's guaranteed minimum `maxUniformBufferBindingSize` of 64 KiB. Unused
entries cost 32 bytes of zeroes and nothing else, because the shader indexes the
array rather than iterating it. So the ceiling is 2048 sprites; 128 was chosen as
the next power of two with real room to grow rather than the smallest number that
fits today.

The atlas texture also widened from 256 to 512, because shelf packing wastes the
tail of every shelf and at 256 a 93 px bed left almost nothing usable beside it.
Nothing downstream reads the dimensions as a constant.

---

## [B9] Goal criterion 3 is met, and the 12 000-tick horizon is what was hiding it

The criterion is "no object at zero or near-zero uses over 12 000 ticks". The
shipped house, measured:

| horizon | interactions | interactive objects at zero | back-to-back repeats | idle |
| --- | --- | --- | --- | --- |
| 12 000 | 106 | **4 of 18** | 1.0% | 17.0% |
| 120 000 | 1 079 | **0 of 18** | 0.7% | 15.8% |

**Identical content, and the two rows disagree.** That is the finding, and it
took an accident to see: changing the radio's `social` delta from 7 to 5 - a
correction made for an unrelated reason, see [F12] on sign collisions - moved
*five* objects from non-zero to zero at 12 000 ticks. A two-point change to one
object cannot make five others unreachable, so the zero-set could not be a
property of those objects.

Lengthening the horizon settled it. One sim performs about 106 interactions in
12 000 ticks across 18 objects, and the draw is deliberately not uniform:
bladder drains fastest, so the toilet takes 26.7% of all actions, correctly. The
tail is thin by design - armchair 2 uses, kitchen sink 1 - but at ten times the
sample **every interactive object in the house is used.** Nothing is
unreachable.

So the criterion as written measures the sample size as much as the content. The
honest statement of what is true: *every object in the house earns its place,
and one sim cannot visit eighteen of them in 12 000 ticks.* Three sims will
roughly triple the sample at any horizon, which is M2c.

**What the trace numbers should be read as.** The 12 000-tick column is what a
player sees in twenty minutes at 1x and is the right number for feel. The
120 000-tick column is the right number for "is this object reachable at all".
Quoting the first as the second is the mistake this entry exists to prevent.

---

## [B10] Two things `compile` cannot check, and why neither is fixed

The build validates bounds, walls, overlap, and that every object's approach
tiles are in one connected region. It does not validate that a layout is
*sensible*, and two things in this lot are legal and arguably bad.

**Six objects have exactly one approach tile** - the fridge, both counters, the
stove, the potted plant by the east wall, and the washer-dryer. The kitchen's
working run is deliberate: every station is approached from the open row at
y = 1, which is what makes it a counter run rather than an island.

Left as it is, and the reason is that a single approach tile is not a deadlock.
A sim occupies its approach tile only while using that object, `slots` already
limits that to one sim for every object in the kitchen, and nothing paths
*through* row y = 0 because rows 1 to 4 are open floor. What a single approach
costs is the ability for a second sim to stand waiting, and `Reserved` means
there is no waiting to do. If M2c's three sims prove otherwise, the fix is a
gap in the run rather than a new rule.

**The bathroom's south-east corner hangs off a one-tile pinch at (13, 9)**, and
ten other tiles are single-tile cul-de-sacs. Also left as it is: a pinch matters
only if something can block it, and nothing can - objects are static, and a sim
standing on a tile does not make it impassable to another sim's path.

Both are recorded rather than fixed so that whoever hits a real contention
problem in M2c knows these two were considered and why.
