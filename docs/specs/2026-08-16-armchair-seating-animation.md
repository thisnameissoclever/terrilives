# Armchair seating animation

Status: implemented and locally played. Merge, exact-head CI, public Pages
deployment, physical-phone review, operating-system reduced motion, and final
owner acceptance remain open. This specification owns the first ordinary
seating slice: `armchair.take_the_chair` only. It extends the shipped
action-socket contract without changing gameplay, saves, the WASM bridge shape,
or the GPU pipeline.

The visual reference is
`docs/assets/armchair-seating/reference-armchair-seating.png`. It was generated
from the current Muted Line people/actions sheet and armchair crop to study
seat contact, planted feet, and calm motion. The reference pixels are not a
runtime asset. The deterministic Python generator remains the only source for
the shipped atlas.

## [AS-scope] One real interaction gains an honest seated body

The only content change is:

```toml
[[object.action_socket]]
id = "seat"
x = 0.0
y = 0.0
facing = "SE"

visual = { action = "sit", anchor = "object_socket", facing = "socket", socket = "seat" }
```

The object id remains `armchair`, the interaction id remains
`take_the_chair`, and the player label remains `Sit down`. Need adverts,
duration, slot count, scoring, reservation, pathing, and completion effects do
not change.

The armchair is the correct first slice because it has one interaction slot
and one authored placement. Sofas and the double bed declare more than one
slot, but runtime reservation still owns the entire object. Giving those
objects several visible seat sockets before deterministic per-user slot
ownership would promise gameplay the simulation does not implement.

## [AS-data] The contract is append-only and exact

`CompiledVisualAction::Sit` appends after `Watch`. The compiler accepts only:

1. An object interaction.
2. Action `sit`.
3. Anchor `object_socket`.
4. Facing `socket`.
5. A named socket owned by that same object.

Missing sockets, cross-object sockets, other owners, other anchors, and
toward-anchor facing fail compilation. Labels, tags, adverts, and broad
activity state never infer sitting art.

The renderer-facing wire ids append without moving existing meanings:

1. Visual action `8` is sitting.
2. Activity `11` is sitting.

Activity `11` is text-only. The body and the normal HUD label `Sitting`
explain the action without adding another bubble to the house.

## [AS-projection] Existing sockets own position and facing

The armchair seat resolves at the object's footprint centre with `SE` facing.
The runtime projects the displayed body to that socket only while the exact
target object and exact active interaction agree with the compiled visual.
The ECS `Position` stays on the adjacent path tile.

The existing projection transition rule remains in force:

1. Entry reseeds previous and current display positions at the socket.
2. Continued sitting stays planted at the socket.
3. Exit reseeds both samples at the real ECS position.
4. No frame glides through the chair in either direction.

Conversation and exact eating retain precedence over the sitting projection.
Malformed or incomplete state falls back to generic object use rather than
inventing a seated position.

## [AS-art] Two restrained frames preserve chair contact

Each of the three shipped looks gains two frames for all four facings, for 24
new sprites named from `simSitSE0` through `sim3SitNE1`. They append after the
current 311 atlas records at indices 311 through 334. No existing index moves.

Every sitting sprite is 38 by 88 pixels and bottom-centred. Both frames must:

1. Put the hips visibly on the cushion.
2. Keep both shoes planted rather than crossing the chair base.
3. Preserve a believable head, neck, shoulder, hip, knee, and foot chain.
4. Keep the body inside the established pick and camera envelope.
5. Let enough of the armchair remain visible to explain the pose.

Frame zero is a quiet seated pose with one hand near the armrest. Frame one is
a small shoulder and hand adjustment. The torso, hips, and head do not bob
vertically. Sitting holds each frame for 24 simulation ticks. Stable entity id
is applied before frame division so nearby Sims do not move in lockstep.
Reduced motion pins the seated frame zero instead of reverting to a standing
body.

## [AS-determinism] Presentation does not alter the world

The slice adds no simulation component, random draw, system, command, save
field, save version, bridge column, shader input, draw call, or dependency.
The existing position, activity, visual-action, and facing columns carry the
complete presentation contract. Save V1 rebuilds object sockets from compiled
placements as it already does for seated reading and exercise.

The content pack postcard changes by appending an enum variant. Existing
variant order is pinned. The Save V1 compatibility digest and world hashes do
not change because sockets and visual metadata are presentation-only.

## [AS-automated-acceptance] Tests prove the contract boundaries

Automated coverage must prove:

1. The exact legal visual row compiles and malformed rows fail with the owning
   object and interaction.
2. The append-only enum round-trip preserves all older discriminants.
3. The shipped armchair resolves the expected socket and exact visual.
4. Exact active use emits action `8`, activity `11`, positive-x facing, and
   the seat position without changing ECS `Position`.
5. Target, object, interaction, socket, or component near misses do not emit
   sitting.
6. Entry, continued use, paused cancellation, and exit preserve the existing
   interpolation reseed contract.
7. Save and load restore the same displayed sitting state and world hash.
8. All looks, facings, frames, phase transitions, invalid-code fallback, and
   reduced motion are pinned in web tests.
9. Atlas generation proves indices 311 through 334, exact dimensions,
   nonempty pixels, directional distinction, visible seat contact, and
   meaningful but restrained frame differences.
10. The normal HUD says `Sitting`; debug output says `sitting`; code `11`
    draws no indicator.

The complete Rust, web, atlas, docs, formatting, lint, and mutation gates must
remain green.

## [AS-displayed-acceptance] The played action is the visual gate

A production WebGPU pass must use normal game controls to run the real
`armchair.take_the_chair` interaction. At native size and close zoom it must
verify:

1. The body visibly sits in the chair with planted feet and believable joints.
2. Both restrained frames appear during the 41-tick interaction.
3. Entry and exit do not slide through furniture.
4. Pause freezes the exact seated frame and position.
5. Reduced motion retains the quiet seated pose.
6. Selection ring, picking, label, lighting, and zoom stay aligned at the
   displayed socket.
7. Desktop and phone-width layouts keep the action usable.
8. The browser console remains free of warnings and errors.

The reference and runtime capture must be inspected together at the same scale
and state. Automated pixel differences cannot approve whether the body looks
comfortably seated.

## [AS-exclusions] Adjacent systems remain separate slices

This slice does not add sofas, dining-table seating, desk-chair use, lounging,
sleep, bed occlusion, foreground furniture layers, sit-down or stand-up
transition frames, multi-slot ownership, Build Mode, or new dependencies.
Those remain separately specified backlog work. In particular, sleep requires
a horizontal-body envelope and bedding-occlusion decision before art begins.
