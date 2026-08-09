# Seated reading action animation

Status: shipped in PR 48 at merge
`d405e70223dcc018f376da8ad52e783f081cbf3c`, with local and deployed Pages
WebGPU acceptance recorded in [A-seated-reading-action]. An operating-system
reduced-motion display session remains an explicit proof boundary. The owner
rejected the original seated body on 2026-08-09 because the neck was visibly
distorted. PR 50 shipped the redraw at merge
`7348bba5986e6b2df99aad009f655489c643db32`; the head now meets the shoulder
line and the narrow exposed-neck run is capped. Local and merged public played
WebGPU acceptance is recorded in [A-character-animation-repair]. Final owner
approval and the operating-system reduced-motion display session remain open.
The action hold is now doubled from 12 to 24 simulation ticks.

This slice gives `reading_chair.settle_in` a seated reading pose and establishes
the object-local action socket required by later furniture actions. It does not
turn the broad `reading` tag, the `USING_OBJECT` activity code, or every sitting
interaction into art. The content contract names one exact interaction and the
presentation layer fails closed everywhere else.

## [SR-scope] One interaction ships the socket contract

The only shipped content change is the existing single-slot interaction with
these stable authored ids:

1. Object id: `reading_chair`.
2. Interaction id: `settle_in`.
3. Action socket id: `seat`.
4. Visual action: `read`.
5. Visual anchor: `object_socket`.
6. Visual facing rule: `socket`.

The resulting content has this shape:

```toml
[[object]]
id = "reading_chair"
name = "The Wingback Sabbatical"
sprite = "loungeChairRelax"

  [[object.action_socket]]
  id = "seat"
  x = 0.0
  y = 0.0
  facing = "SE"

  [[object.interaction]]
  id = "settle_in"
  label = "Sit and read"
  advertises = { comfort = 15.0, fun = 19.0 }
  duration_ticks = 46
  slots = 1
  tags = ["reading"]
  satisfaction = 3.0
  visual = { action = "read", anchor = "object_socket", facing = "socket", socket = "seat" }
```

The socket remains on the object because it describes a place on that piece of
furniture. The interaction references it by stable authored id. Putting the
coordinates directly in `visual` would duplicate the seat if the object later
gained another seated interaction.

This slice does not change the interaction's label, need adverts, duration,
slot count, tags, satisfaction, selection weight, reservation behavior, path,
or completion effects.

## [SR-schema] The legal visual matrix remains exact

The authored schema gains optional `action_socket` entries on an object and an
optional `socket` field appended to `VisualDef`. Compiled socket and visual
fields append last in their containing postcard structures, following the
pack's existing growth rule.

The complete legal visual matrix is:

1. `talk / partner / toward_anchor`, with no socket, on a social interaction.
2. `eat / object / toward_anchor`, with no socket, on an object interaction.
3. `eat / station / toward_anchor`, with no socket, on a chain step.
4. `read / object_socket / socket`, with a socket id, on an object interaction.

Every other combination is a content error. That includes a missing field, an
unknown value, a socket on talk or eat, read without a socket, read on a social
interaction or chain step, `toward_anchor` with an object socket, and `socket`
facing with a partner, ordinary object, or station anchor.

Socket ids are unique within their owning object, non-empty, and compared
exactly. The referenced socket must belong to the same object definition as
the interaction. A socket on one object cannot satisfy a visual on another
object merely because both ids happen to be `seat`.

`CompiledVisualAction::Read`, `CompiledVisualAnchor::ObjectSocket`, and
`CompiledVisualFacing::Socket` append after the existing enum variants. Their
existing postcard discriminants do not move. The compiled visual stores the
resolved socket index as `Option<u32>` appended last. Old visual contracts
compile with `None`; the legal read contract compiles with the owning object's
socket index.

The renderer-facing wire ids are stable and append-only:

1. Visual action `0` remains none.
2. Visual action `1` remains talk.
3. Visual action `2` remains eat.
4. Visual action `3` means read.
5. Activity `0` through `6` retain their original meanings.
6. Activity `7` remains generic object use.
7. Activity `8` means reading.
8. Facing `0` remains none; `1` through `4` remain positive x, negative x,
   positive y, and negative y.

Gameplay tags, need adverts, labels, object ids, and the broad activity code do
not infer visual action `3`. Only the exact compiled visual contract can emit
it.

## [SR-socket-space] Sockets use object-local lot coordinates

An action socket owns four authored facts:

1. A stable id.
2. An x offset in lot-tile units.
3. A y offset in lot-tile units.
4. A facing in the existing `NE`, `NW`, `SE`, `SW` vocabulary.

The origin is the object's existing rendered footprint centre, the same point
used for the object's render-buffer row:

```text
centre_x = placement.x + (footprint.width  - 1) / 2
centre_y = placement.y + (footprint.depth - 1) / 2
```

Offsets are finite `f32` values. After placement rotation and translation, the
resolved point's floored tile must lie inside that placement's compiled
footprint. A non-finite point or a point outside the target footprint is a
content error naming the object, socket, and resolved position. The compiler
does not clamp bad content into a plausible-looking lie.

The socket's authored coordinate system uses the default `SE` object import as
its orientation. A placement with no `facing` is `SE`. A placement-facing
variant rotates both the socket offset and its facing with this exact matrix:

| Placement facing | Resolved offset |
| --- | --- |
| `SE` or absent | `(x, y)` |
| `SW` | `(-y, x)` |
| `NW` | `(-x, -y)` |
| `NE` | `(y, -x)` |

Facing labels map to lot-axis unit vectors before the same rotation:

1. `SE` is positive x.
2. `NW` is negative x.
3. `SW` is positive y.
4. `NE` is negative y.

The compile step resolves every placement's sockets to absolute lot position
and a render-buffer facing code. These resolved values append to
`CompiledPlacement`; runtime code does not repeat the matrix.

`Sim::new_from_lot` attaches the resolved socket list to the placed object in a
presentation-only component, following the existing `SpriteVariant` pattern.
Save restoration rebuilds that component by matching the compiled placement's
object id and exact saved position, again following `SpriteVariant`, when that
identity and coordinate do not collide with a dynamically spawned object. Save
V1 does not persist placement identity, so a dynamic object with the same id
and exact position as an authored placement can inherit the authored facing
and sockets during restoration. That ambiguity is an existing Save V1 identity
boundary and needs a future save-format solution; this slice must not claim to
distinguish the two. It does not affect the shipped one-tile, default-`SE`
reading chair. The public dynamic object-spawn path must attach the definition's
default-`SE` resolved sockets too; it may not create a reading chair that can
run `settle_in` but cannot display it. The component is absent on definitions
and placements with no sockets so old fixtures remain untouched.

The shipped reading chair is one tile, has no placement-facing override, and
uses `(0.0, 0.0)` facing `SE`. Its resolved action position is therefore the
chair's existing world position with render facing positive x. Pixel alignment
belongs inside the fixed action sprite. Screen-pixel nudges do not belong in
the content socket.

## [SR-projection] Exact target identity controls the pose

Render sync may project seated reading only while all of these facts agree:

1. The agent has the existing active object-use components, including
   `Eating` and `Target`.
2. `Target.object` names the exact target entity.
3. The target entity carries `SmartObject`, `Position`, and the resolved socket
   component.
4. `Eating.object` equals that exact target's object definition.
5. `Eating.interaction` equals `Target.interaction`.
6. The exact compiled interaction owns
   `read / object_socket / socket / seat`.
7. The compiled socket index is in range on the exact target placement.

When every condition holds, the agent row emits action `3`, activity `8`, the
socket's facing, and the socket's resolved x and y as its displayed position.
The agent's ECS `Position` remains on the adjacent pathing tile.

Every missing component, out-of-range index, wrong entity, wrong object
definition, wrong interaction, or unauthored near miss emits no authored read
action. It retains the existing broad object-use fallback rather than
manufacturing socket data. Activity `8` is emitted only with a valid authored
read projection; broad activity never works in the opposite direction to
invent action `3`.

Conversation retains its established precedence if a malformed test entity
contains both a valid social pair and object-use state. Reading does not alter
talk or eat resolution.

## [SR-interpolation] Entry and exit reseed the displayed row

The socket changes the row's displayed position without changing its stable
entity id or ECS position. Ordinary interpolation would otherwise move the body
from the adjacent path tile through the chair on entry and back through it on
exit.

Render sync must track whether each stable entity row was socket-projected in
the previous sample. A transition between ordinary and socket-projected states
reseeds both previous and current displayed positions to the new displayed
position for that row. The same rule applies in both directions:

1. Entry snaps previous and current to the socket.
2. Continued reading advances both samples normally at the same socket.
3. Exit snaps previous and current to the restored ECS position.
4. An unchanged ordinary row keeps existing interpolation.
5. A paused command-only refresh preserves the current position samples only
   while socket-projection status is unchanged. A paused command that starts
   or cancels projection still reseeds both samples to the newly displayed
   position.

This slice does not add a sit-down or stand-up transition. The explicit snap is
honest and bounded. A one-frame glide through furniture is neither.

Selection, sprite picking, activity indicator, carried badge, light sampling,
and selection ring all consume the same interpolated render position. No
consumer may independently fall back to the ECS tile while the body is drawn
at the socket.

## [SR-determinism] Sockets are presentation, not simulation

Object sockets, compiled placement sockets, the runtime socket carrier, visual
action `3`, activity `8`, facing, and interpolation reseeding are presentation
metadata. They must not affect:

1. Pathfinding or blocked tiles.
2. Object selection, reservation, slots, or contention.
3. Interaction start, duration, satisfaction, need deltas, or completion.
4. ECS `Position`, `Eating`, `Target`, or any other gameplay component.
5. Random-number consumption or system order.
6. Save V1 fields, version, compatibility digest, or serialized bytes.
7. World-hash vectors.

The compiled content pack changes because its postcard shape gains appended
fields. Its golden bytes must be regenerated and reviewed. Save V1 does not
change. Object socket and visual metadata stay outside the Save V1
compatibility digest, just like the existing visual metadata. Tests must vary
the socket id, coordinate, and facing independently and prove an otherwise
compatible save still loads.

A world-hash change is a defect. It means presentation leaked into simulation
state. New golden world hashes are not an acceptable way to bless that leak.

No new WebAssembly pointer, JavaScript bridge accessor, render-buffer column,
GPU instance field, shader input, pipeline, pass, draw, or submit is required.
The existing position, activity, visual-action, and facing columns carry the
complete contract.

## [SR-art] Reading uses two fixed-envelope frames

Each of the three shipped Sim looks gains two reading frames for each of the
four lot-axis facings: 24 appended action sprites.

The sprite contract is exact:

1. Every body sprite is 38 by 88 pixels.
2. Every body remains bottom-centred on the existing anchor.
3. Frame zero is a quiet seated pose with an open, clearly readable book.
4. Frame one is a restrained page turn or book adjustment.
5. The seated silhouette, chair contact, book, face direction, and hands must
   read at native sprite size.
6. The pose remains within the existing picking, depth, indicator, ring, and
   carried-badge envelope.
7. The chair stays one existing prop quad below the Sim. This slice adds no
   foreground split or occlusion mask.

The 24 names follow the established pattern, such as `simReadSE0`,
`sim2ReadNW1`, and `sim3ReadNE0`. They append at atlas indices 98 through 121.
No existing atlas index moves.

`indicatorReading` appends at index 122, making 123 atlas entries in total. It
uses a book glyph and supplies a redundant non-motion explanation of the
action. The established vocabulary names activity code `8` as debug `reading`
and normal player HUD `Reading`. No meaning is available only through movement.

Reading alternates frames every 24 simulation ticks. Stable entity id supplies
the phase offset before frame division. Wall time and render-frame count are
forbidden inputs. Pause freezes the exact frame; speed controls scale it with
the simulation; Save and Load reconstruct it from the saved simulation tick
and active gameplay components. Reduced motion pins frame zero while
preserving the seated position and socket facing.

Generated-image acceptance is based on decoded pixels, dimensions, names, and
atlas placement rather than PNG byte identity. The reproducible generator
still owns all committed atlas outputs.

## [SR-performance] The existing render path remains bounded

Compile-time work may walk each object's small socket list and each lot
placement once. Runtime render sync may directly read the target entity's
resolved socket component and index it once for the active row.

It must not scan all objects, all placements, all interactions, or all active
users per agent. It must not allocate a map or vector per row. Any tick-local
tracking needed for transition reseeding is keyed once by stable entity id and
bounded by the live render prefix.

The web renderer resolves the 24 body names and one indicator name once at
module load. It reuses the existing dynamic instance buffer and live-prefix
contract.

## [SR-automated-acceptance] Tests prove every boundary

Automated coverage must prove:

1. The four legal visual contracts compile and every missing, unknown,
   cross-owner, mixed, or surplus-field combination fails with the owning
   content id in the error.
2. Socket ids are non-empty and unique per object; visual references resolve
   only within that object; non-finite and out-of-footprint sockets fail.
3. Asymmetric x and y fixtures exercise `SE`, `SW`, `NW`, and `NE` placement
   rotations. Both signs, both axes, and all four resolved facings are pinned.
4. Compiled object, visual, and placement socket fields survive postcard
   round-trip with distinct values. Existing enum variants retain their
   encoded order.
5. Socket id, x, y, and facing changes independently leave the Save V1 digest
   unchanged. Save V1 bytes and world-hash goldens remain unchanged.
6. New-lot spawn and public dynamic object spawn attach the exact resolved
   socket component to the matching placement or default orientation, and
   attach none to an ordinary object. Save V1 restoration proves the same for
   non-colliding object-id and exact-position matches, while retaining the
   documented same-coordinate dynamic collision boundary.
7. A real `reading_chair.settle_in` emits action `3`, activity `8`, positive-x
   facing, and the exact seat position without changing ECS `Position`.
8. Every target-identity and required-component near miss independently emits
   no authored read projection. A generic `USING_OBJECT` activity or `reading` tag
   alone never chooses read art.
9. Entry and exit independently reseed both axes in previous and current
   position samples. A paused cancel exercises the exit seam. Continued
   reading stays planted. Ordinary walking interpolation and command-only
   paused sync remain unchanged when projection status does not change.
10. A save taken during `settle_in` loads with action `3`, activity `8`, facing,
   socket position, and equal previous/current samples before the first new
   tick. Continuing the source and restored simulations preserves equal world
   hashes.
11. WebAssembly memory growth preserves action `3`, activity `8`, facing, and
   both socket-position axes through the existing accessors.
12. All three looks, four facings, two frames, ticks 23, 24, 47, and 48,
   staggered neighbouring ids, invalid-code fallback, pause, speed, and
   reduced motion are pinned in web tests.
13. Ring, indicator, carried badge, local-light sampling, sprite picking,
    zoom, and live instance count use the socketed displayed position.
    `pickAt` at the old ECS coordinate does not return the reader, opaque
    seated-body pixels select the reader, and the sprite-selection box is
    anchored at the socket.
14. The normal HUD names activity `8` as `Reading`; the debug panel uses the
    established lowercase `reading` vocabulary.
15. Atlas output has 123 entries; old indices remain fixed; reading occupies
    98 through 121; `indicatorReading` is 122; every new body is 38 by 88;
    decoded pixels and generated manifests are reproducible.

The full Rust mutation sweep must report no new survivors. Targeted hand
mutations must kill:

1. Each legal-matrix owner and field guard.
2. Cross-object socket lookup.
3. Socket index bounds checking.
4. Each placement-rotation sign and axis term.
5. Exact target object and interaction identity checks.
6. Either x or y socket projection.
7. Entry or exit reseeding of either previous or current positions.
8. Action `3` collapsed to eat or none.
9. Activity `8` collapsed to generic object use or eating.
10. Frame duration, phase-before-division, facing reversal, and reduced-motion
    frame selection.
11. Any statement deletion that ordinary `cargo mutants` cannot generate.

## [SR-displayed-acceptance] The player must see the complete interaction

A displayed production WebGPU pass must use normal controls to watch one real
`reading_chair.settle_in` interaction from approach through completion and
departure. The pass must verify:

1. The standing body leaves the adjacent approach tile and appears on the
   chair seat without a visible glide through the prop.
2. The seated body, chair contact, open book, hands, face, and page adjustment
   read at native size and close zoom.
3. Both animation frames appear during the 46-tick interaction.
4. Pause visibly freezes the exact frame and displayed position.
5. Each speed presents a visually correct cadence without skipped or
   wall-clock-driven-looking motion. Automated tests own the exclusive
   simulation-tick time-source claim.
6. Reduced motion holds frame zero without falling back to standing or moving
   the body off the seat.
7. Selection by body pixels works while seated. The ring and Reading indicator
   follow the displayed body rather than the adjacent ECS tile.
8. Default, minimum, and maximum supported zoom keep the body, book, chair,
   ring, and indicator aligned.
9. Daylight and night lighting leave the book and seated silhouette legible.
10. Completion restores the ordinary body to the real pathing tile without a
    reverse glide through the chair.
11. The browser console reports no warning or error and the production canvas
    is visibly rendered through WebGPU.

The result and any finding belong in `docs/alpha-feel-notes.md`. A visual
finding is fixed or explicitly deferred with its reason before this slice is
called complete. Tests can prove coordinates and pixels; they cannot approve
whether a seated figure actually reads as seated at shipping size.

If this slice does not change the GPU contract, existing scoped GPU validation
remains sufficient. Do not claim new device-level validation that was not run.
A hidden tab without animation frames is not displayed renderer evidence.

## [SR-docs] Implementation updates the current-state record

The implementation PR updates:

1. `docs/FEATURES.md` to mark only `reading_chair.settle_in` seated reading as
   shipped and leave the remaining categories proposed.
2. `docs/ARCHITECTURE.md` with the compiled socket, placement carrier, restore,
   and presentation-only boundaries.
3. `docs/alpha-feel-notes.md` with the displayed acceptance result and any
   deferred finding.
4. `docs/player-visible-strings.md` with the player-facing `Reading` activity
   label.
5. `docs/lessons-learned.md` only if implementation reveals a material
   correction or a new recurring failure class.

This specification remains the governing contract. `docs/REQUIREMENTS.md`
already points at the canonical feature, architecture, and acceptance
documents and does not need a duplicate requirement entry.

## [SR-exclusions] Adjacent categories remain separate work

This slice does not animate or change:

1. `bookshelf.read` or any other reading route.
2. Generic sitting, the ottoman sofa, dining table, long sofa, armchair, desk
   chair, or television use.
3. Sleeping, either bed, showering, bathing, toilet use, or sink use.
4. Multi-slot reservation, per-user slot assignment, shared furniture, or
   deterministic seat ownership.
5. Foreground prop layers, split sprites, occlusion masks, object compositing,
   or a second render pass.
6. Sit-down, stand-up, page-pickup, or book-put-away transition animations.
7. A book inventory item, carried-book component, new interaction command, or
   menu behavior.
8. Gameplay position, pathfinding, collision, scoring, needs, satisfaction,
   traits, hobbies, or interaction timing.
9. Save versioning, bridge shape, shader shape, draw count, submit count, or
   dependencies.

The single-slot reading chair deliberately avoids the unresolved capacity
problem: content can declare two or three slots, but runtime reservation still
claims the whole object. Extending sockets to sofas or the double bed before
per-slot ownership exists would give several bodies named seats that the
simulation cannot assign. That is a separate gameplay slice.

The existing chair can plausibly draw below the full seated body. Beds,
showers, and toilets need foreground occlusion decisions before their bodies
can pass displayed acceptance. This socket contract supplies position and
facing; it does not pretend position solved occlusion.

## [SR-proof-boundary] Completion claims stay narrow

Source tests, type checks, builds, atlas checks, save checks, world hashes, and
mutation results prove their named contracts. They do not prove the visible
chair contact, native-size book, WebGPU canvas, zoom alignment, lighting, or
reduced-motion behavior that requires a displayed pass.

This slice is complete only when every automated gate above is green, the
played acceptance record exists, and no required visible criterion remains
unobserved. Any external or owner-approval gate still outstanding must be
named as a blocker rather than rounded up into completion.
