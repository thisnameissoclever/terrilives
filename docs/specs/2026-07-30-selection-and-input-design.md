# Depth, Selection and the Input Model - Decisions

Status: **all four are built.** All of it came out of one play session's
reports, and all of it is goal item 10 - "at a glance: which sim is selected,
what it is doing, what it is about to do, and why".

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

## [I2] A ring on the floor marks the selected sim. BUILT.

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

**Rejected: an icon above the head.** Cheapest to draw and worst behaved:
sprites here are up to 136 px tall, so an icon above a sim near the top of the
current panned or zoomed view can leave the canvas. It also collides with the
wall sprites the sim stands in front of.

Implementation: a generated ring sprite in the atlas, drawn as **one extra
instance per frame** for the selected sim at `LAYER_PROP` - above the floor, below
the sim. One instance and not one per entity, so [D11]'s no-allocation rule is
untouched. It uses the HUD's existing accent colour rather than introducing a new
one.

---

## [I3] Click redirects, ctrl-click queues. BUILT.

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

## [I4] Right-click opens a flyout of that object's interactions. BUILT.

**Reported:** right-click should open a menu for advanced interactions and for
objects with more than one, "even if there is only one interaction for every
object right now".

**Decision: build it now, with one entry per object, plus the cancel that
right-click currently performs.**

Building the menu before there is anything to put in it is deliberate. The
simulation has always supported several interactions per object -
`Intent::interaction` is an index, and `UseObject` hardcoded 0 with a comment
saying a click names an object rather than one of its uses. The menu is the thing
that makes that index reachable, and every later feature that wants a second verb
on an object - cook versus snack, nap versus sleep, chat versus argue - needs it
to exist first. (The hardcode is gone; see the build note below.)

Right-click currently cancels the selected sim's orders. That binding moves into
the menu as "Never mind", so the gesture keeps a cancel and gains everything else.

**Rejected: keep right-click as cancel and put the menu on a long press or a
double-click.** Cancel is a rare action and a menu is the conventional
right-click; giving the rare action the conventional gesture is backwards.

**Rejected: wait for a second interaction to exist before building the menu.**
That is the order that guarantees the first object with two verbs also has to ship
a UI, and it is how `UseObject`'s hardcoded 0 got there in the first place.

**Built, and the index now reaches the simulation.** The menu lists an
object's real interactions - `content/objects.toml` gained an optional `label`
per interaction and `SimHandle::interaction_labels` carries them across the
boundary in index order - each row carries its own interaction index, and
`SimCommand::UseObject` grew an `interaction: u32` field as its LAST member, so
picking row `n` runs interaction `n`.

The first build stopped short of that field, on the grounds that widening the
command moves a published byte encoding. **Closed immediately afterwards, and
the timing is the argument:**

- The encoding is a wire format for [D8]'s save-file command log and for Layer 2
  multiplayer, and `command_encoding_is_pinned_by_a_golden_byte_vector` exists to
  make a change to it loud. But **nothing has been persisted yet** - the save
  format is goal item 9 and is not built. Appending a field now costs one byte in
  a golden vector and nothing else. Doing it after the first save file exists
  costs a migration, and the same field would still be needed.
- **Appending is the cheapest shape available.** Postcard writes a struct
  variant's fields in declaration order, so `UseObject` grows from
  `[0x01, agent, object]` to `[0x01, agent, object, interaction]` and every other
  variant's bytes are untouched. Putting `interaction` anywhere but last would
  move `object`, which is the same class of break as renumbering a variant.
- **A plain click sends 0**, which is what it always effectively sent, so the
  shipped game's behaviour and its world hash are unchanged. The field is only
  observable on an object with a second verb, of which there are none yet - which
  is why the tests that pin it use a two-interaction fixture in
  `crates/terri-sim/src/test_content.rs` whose two interactions advertise
  different needs for different lengths. A fixture whose verbs agreed on either
  would make "interaction 1 ran" and "interaction 0 ran" indistinguishable, which
  is [L34].

**Rejected: a separate `UseInteraction` variant alongside `UseObject`.** Two
commands meaning "use this thing" is two code paths for the queue cap, for the
staging in `fresh`, and for the `serving` guard in `CancelIntents` - all three of
which are already subtle, and the last of which had a mutation survive in it
once already.

One thing the field made obvious rather than changed: the `serving` guard's
`intent.interaction == target.interaction` clause used to be justified by
"`UseObject` always names 0", which was true and is no longer. The clause is
plainly load-bearing now, because two rows of one object's flyout name the same
object and different interactions, and its comment says so.

Two smaller things this decision did not settle, resolved in the build and
recorded here so they are not re-litigated:

- **Nothing selected: no menu at all**, rather than rows drawn disabled. Every
  row acts on the selected sim, so a menu with no selection could only be a list
  of things that do nothing, and the player's actual next move is to click a sim,
  which an open menu is in the way of. The browser's own context menu is still
  suppressed.
- **Right-clicking a sim, bare floor or a wall opens a menu of just "Never
  mind".** The cancel moved into the menu rather than being deleted, so a flyout
  that only appeared over furniture would take the binding away everywhere else.
