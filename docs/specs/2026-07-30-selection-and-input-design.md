# Depth, Selection and the Input Model - Decisions

Status: **the depth fix is built and measured; the rest is decided, not yet
built.** All of it came out of one play session's reports, and all of it is goal
item 10 - "at a glance: which sim is selected, what it is doing, what it is about
to do, and why".

---

## [I1] The floor no longer depth-sorts. BUILT.

**Reported:** "the floor tiles keep overlapping the sim character itself."

**Measured, before any change**, with the sim at tile (8, 3.75) on the shipped
lot: the floor tiles at (9, 3.75) and (8, 4.75) each overlapped the sim's sprite
by **19 x 21 px** and each had a **smaller** depth - 0.4736 against the sim's
0.5088 - so both won those pixels. A sim standing shin-deep in the floor.

**The layer scheme could not fix it, and the arithmetic says why.**
`DEPTH_LAYER_STEP` is 1/4096, about 0.00024. One tile of depth on the shipped lot
is about 0.036 - **a hundred and fifty times larger.** So `LAYER_SIM` only ever
outranks something on the *same* tile; against a nearer tile it loses. And a floor
diamond is 42 px tall while a tile step is only 21 px, so a nearer floor tile
always covers the lower half of the previous tile's screen area, which is exactly
where a sim's feet are. Raising `DEPTH_LAYERS` would not have helped: the problem
is not too few layers, it is that layers are the wrong axis.

**Decision: every floor tile is drawn at one shared `FLOOR_DEPTH`.** The floor is
the ground - nothing is behind it, it should never occlude anything, so it does
not need a per-tile depth. Floor diamonds tile edge to edge and their opaque
pixels do not overlap each other, so they need no ordering among themselves
either; the 672-sample seam check in `alpha-feel-notes.md` [A-7] is the evidence
for that.

The value is `1 - DEPTH_LAYER_STEP / 2`, and both bounds are tight:

- it must sit behind `layeredDepth`'s maximum, which is `1 - DEPTH_LAYER_STEP` at
  a far-corner prop;
- it must sit **in front of the clear value.** `sprites.ts` clears to 1.0 and
  compares with `less`, and a fragment at exactly 1.0 is not less than 1.0 - so a
  floor at 1.0 would make the entire floor vanish with no error anywhere.

Derived from the constant rather than written as `0.9999`, so the relationship
survives that constant changing.

**Verified by A/B on the same frame and the same sim tile**, reverting the fix and
re-measuring: the share of the sim's lower body that reads as floor went
**10.9% to 5.3%**, removing 62 pixels of floor drawn over the sim. The residual
5.3% is the sprite's own transparent margin beside the legs, where floor is
supposed to show through.

**Rejected: raise `DEPTH_LAYERS` and give sims a much larger layer offset.** It
would have to exceed a whole tile of depth to work, at which point a sim would
draw in front of walls two rooms nearer the camera.

**Rejected: sort entities on the CPU and draw back to front.** The standard
answer, and [D10] rejected it at 100k objects for good reasons that have not
changed.

---

## [I2] A ring on the floor marks the selected sim

**Reported:** there is no way to tell which sim is selected. Three options were
offered: a head icon, an outline, or a floor circle.

**Decision: a ring on the floor at the sim's feet.**

- It is the isometric convention, so it needs no explaining.
- It does not cover the sprite, which matters when the sprite is 38 px wide.
- **It reinforces which tile the sim is on**, which is directly useful given [I1]
  was reported as confusion about where the sim was standing.

**Rejected: an outline around the sprite.** Best-looking option and much the most
expensive: an outline needs the sprite's silhouette, which means either a second
pre-rendered outline per sprite in the atlas or a shader pass that samples
neighbouring texels through the alpha channel. Not worth it for a selection cue.

**Rejected: an icon above the head.** Cheapest to draw and worst behaved: sprites
here are up to 114 px tall and the camera is fixed, so an icon above a sim near
the top of the lot leaves the canvas. It also collides with the wall sprites the
sim stands in front of.

Implementation: a generated ring sprite in the atlas, drawn as **one extra
instance per frame** for the selected sim at `LAYER_PROP` - above the floor, below
the sim. One instance and not one per entity, so [D11]'s no-allocation rule is
untouched. It uses the HUD's existing accent colour rather than introducing a new
one.

---

## [I3] Click redirects, ctrl-click queues

**Reported:** clicking a second object while the sim is still walking should
**redirect** it, and ctrl-click should add to the queue instead.

Today a plain click always appends, up to `max_queued_intents`. That was a
defensible first cut and it is the wrong default: the common case is correcting
yourself, and the rare case is planning a sequence.

**Decision:**

| input | effect |
| --- | --- |
| click a sim | select it |
| click an object | **replace** the queue with this one instruction |
| ctrl-click an object | **append** to the queue |
| click bare floor | clear the selection |

Replace means clearing the queue and cancelling the current target, which is
exactly what `CancelIntents` already does, followed by the new `UseObject`. Both
already exist as commands, so this needs no new simulation surface - it is a
change to what the shell sends, which is the right side of [D-2] for a change to
what a click *means*.

**Rejected: a modifier for replace and a plain click for append**, i.e. the
inverse. It matches what the code does today and asks the player to hold a key for
the common case.

**Note on the interruption question this settles.**
`2026-07-29-multi-step-interactions-design.md` [M-4] worried that immediate
preemption plus terminal-only satisfaction lets a mis-click destroy a cooking
chain. Making plain click *replace* raises those stakes rather than lowering them,
which strengthens the case for that document's preferred answer: **resume instead
of discard**, with chain progress held as stored state. Recorded here so the two
documents do not drift.

---

## [I4] Right-click opens a flyout of that object's interactions

**Reported:** right-click should open a menu for advanced interactions and for
objects with more than one, "even if there is only one interaction for every
object right now".

**Decision: build it now, with one entry per object, plus the cancel that
right-click currently performs.**

Building the menu before there is anything to put in it is deliberate. The
simulation has always supported several interactions per object -
`Intent::interaction` is an index and `UseObject` hardcodes 0 with a comment
saying a click names an object rather than one of its uses. The menu is the thing
that makes that index reachable, and every later feature that wants a second verb
on an object - cook versus snack, nap versus sleep, chat versus argue - needs it
to exist first.

Right-click currently cancels the selected sim's orders. That binding moves into
the menu as "Never mind", so the gesture keeps a cancel and gains everything else.

**Rejected: keep right-click as cancel and put the menu on a long press or a
double-click.** Cancel is a rare action and a menu is the conventional
right-click; giving the rare action the conventional gesture is backwards.

**Rejected: wait for a second interaction to exist before building the menu.**
That is the order that guarantees the first object with two verbs also has to ship
a UI, and it is how `UseObject`'s hardcoded 0 got there in the first place.
