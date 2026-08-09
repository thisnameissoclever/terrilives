# Standing bookshelf reading animation

Status: shipped in PR 49 at merge `579f35d0`, with automated, local production,
exact-SHA Pages deployment, and public WebGPU acceptance passing. Displayed
reduced motion and owner review at the corrected cadence remain open. The
reading hold was doubled from 12 to 24 simulation ticks after the 2026-08-09
animation review.

This slice gives the exact `bookshelf.read` interaction a standing reading
pose. It completes the frequent bookshelf route without changing gameplay,
moving the Sim onto the object, or weakening the seated reading contract that
already ships for `reading_chair.settle_in`.

## [BR-scope] One exact interaction gains standing read art

The shipped bookshelf interaction authors this complete visual contract:

```toml
visual = { action = "read", anchor = "object", facing = "toward_anchor" }
```

The existing chair keeps its distinct contract:

```toml
visual = { action = "read", anchor = "object_socket", facing = "socket", socket = "seat" }
```

The compiler accepts both exact combinations and rejects mixed or partial
forms. A `reading` gameplay tag, activity code, object id, label, or broad
object-use state never invents body art.

This slice does not change the interaction label, duration, adverts, tags,
satisfaction, capacity, scoring, pathing, or reservation behavior.

## [BR-wire] Standing and seated reading remain distinguishable

Compiled content continues to use the existing `Read` action enum. Its anchor
and facing fields distinguish the two authored contracts.

Renderer-facing visual action codes remain append-only:

1. `0` remains none.
2. `1` remains talk.
3. `2` remains eat.
4. `3` remains seated read at an object socket.
5. `4` means standing read toward an object anchor.

Both reading routes emit existing activity code `8`. The HUD remains
`Reading`, the debug panel remains `reading`, and both reuse
`indicatorReading`. No player-visible string or activity code is added.

## [BR-projection] Exact target identity chooses the standing pose

Render sync may emit visual action `4` only when every condition holds:

1. The row is an agent with the existing active object-use components.
2. `Target.object` names the exact target entity.
3. That entity has `SmartObject` and `Position`.
4. `Eating.object` equals the target object's definition.
5. `Eating.interaction` equals `Target.interaction`.
6. The exact compiled interaction owns
   `read / object / toward_anchor` with no socket.
7. The active state is not a chain step or social interaction.

The body remains at its ordinary adjacent pathing position. Facing is computed
toward the target object's compiled footprint centre through the same
lot-axis rule already used by exact eating. Both signs and both axes require
causal tests.

Conversation keeps first precedence, exact eating keeps second, seated socket
reading keeps its existing projection, and standing reading follows those
established exact cases. A malformed overlap must not turn another action into
reading or move a seated reader back to the path tile.

Every missing component, wrong entity, wrong object, wrong interaction,
surplus socket, or unauthored near miss falls back to existing generic object
use. Activity `8` is emitted only with a valid exact read contract.

## [BR-determinism] Presentation does not enter simulation state

Standing reading must not change:

1. ECS position, target, interaction state, reservation, or completion.
2. Random-number consumption, system order, scoring, needs, or satisfaction.
3. Save V1 fields, bytes, version, compatibility digest, or migration tables.
4. World hashes or replay results.
5. WebAssembly pointer count, JavaScript bridge shape, render-buffer columns,
   GPU instance fields, shader inputs, passes, draw calls, or submit calls.

The content pack bytes change because the bookshelf gains compiled visual
metadata. That reviewed pack golden is not permission to update a world-hash or
save-byte golden.

## [BR-art] Twenty-four fixed-envelope standing poses append to the atlas

Each of the three shipped looks gains two standing-reading frames for each of
the four lot-axis facings. The 24 names use the `simStandRead...` pattern and
append at indices 123 through 146, making 147 sprites total. No existing atlas
index moves.

Every new body must:

1. Remain exactly 38 by 88 pixels and bottom-centred on the ordinary Sim
   anchor.
2. Read as upright at native size, with an open book clearly held in both
   hands.
3. Keep the face oriented toward the authored lot-axis direction.
4. Use frame zero as a quiet read and frame one as a restrained page turn or
   book adjustment.
5. Preserve the existing body, picking, ring, indicator, lighting, and depth
   envelope.
6. Remain visually distinct from the seated-reading silhouette.

The two frames alternate every 24 simulation ticks. Stable entity id supplies
the phase before division. Pause freezes the frame, speed changes scale with
simulation time, Load reconstructs from saved tick state, and reduced motion
pins frame zero without removing the book or directional pose.

## [BR-automated-acceptance] Tests own the mechanical contract

Automated coverage must prove:

1. Both legal read contracts compile, while missing fields, mixed anchors,
   mixed facing rules, misplaced sockets, and non-object owners fail.
2. The shipped bookshelf carries exactly
   `Read / Object / TowardAnchor / None`; the chair retains
   `Read / ObjectSocket / Socket / seat`.
3. Postcard round-trip preserves both distinct contracts and existing enum
   order.
4. A real bookshelf interaction emits visual action `4`, activity `8`, and the
   correct facing without changing ECS or displayed position.
5. Every exact-target and required-component near miss independently emits no
   standing read art. A generic object-use activity or `reading` tag alone is
   insufficient.
6. Positive x, negative x, positive y, negative y, and deterministic tie cases
   are pinned with non-unit target geometry where arithmetic matters.
7. The chair independently retains action `3`, activity `8`, socket position,
   and socket facing. Eating retains action `2`; generic object use retains no
   action and activity `7`.
8. Save and Load preserve the active bookshelf action through the existing
   simulation state, with unchanged save bytes and world hash.
9. Release WebAssembly memory growth preserves literal action `4`, activity
   `8`, and facing through freshly reacquired existing views.
10. Web tests cover all three looks, four facings, two frames, transition
    boundaries, neighboring-id staggering, Pause, speed, Load, reduced motion,
    invalid-code fallback, and the unchanged seated mapping.
11. Ring, indicator, local-light sampling, sprite picking, zoom, and instance
    count keep using the ordinary path-tile position.
12. The generated atlas has 147 entries, old indices remain fixed, standing
    reading owns 123 through 146, and every new body is 38 by 88 with nonempty
    decoded pixels.

Targeted mutations must delete or alter each exact owner guard, target identity
check, facing term, action code, activity code, frame duration,
phase-before-division term, reduced-motion branch, and atlas mapping. Every
mutation must compile, fail causally, be inverted exactly, and restore the
pre-mutation file hash.

## [BR-displayed-acceptance] The player must see bookshelf reading

A displayed production WebGPU pass must use normal controls to watch one real
`bookshelf.read` interaction from approach through completion and departure.
It must verify:

1. The Sim stops on an adjacent path tile and faces the shelf without standing
   inside it or clipping a wall.
2. The upright body, both hands, open book, and restrained page motion read at
   native size and close zoom.
3. Both frames appear during the 34-tick interaction.
4. Pause visibly freezes the exact frame and position.
5. The visible 1x, 2x, and 3x controls produce plausible cadence.
6. Reduced motion keeps the static standing-read pose and open book.
7. Selection by body pixels, the ring, and the Reading indicator remain
   aligned at the ordinary pathing position.
8. Default, minimum, and maximum supported zoom preserve shelf clearance and
   alignment.
9. Daylight and night lighting keep the book and silhouette legible.
10. Completion restores the ordinary standing body without a snap or glide.
11. The displayed production canvas remains WebGPU and the console reports no
    warning or error.

The result and every visual finding belong in `docs/alpha-feel-notes.md`.
Source tests and a screenshot do not replace this played pass.

## [BR-docs] Current-state records change with the implementation

The implementation updates `docs/FEATURES.md`, `docs/ARCHITECTURE.md`,
`docs/alpha-feel-notes.md`, `ASSETS.md`, and the two glossary wire-code rows.
`docs/player-visible-strings.md` changes only if a visible string changes.
`docs/lessons-learned.md` changes only for a material correction or new
recurring failure class.

## [BR-exclusions] Adjacent animation work stays separate

This slice does not add sitting transitions, carried inventory books,
bookshelf-door animation, foreground prop layers, television poses, washing,
sleeping, bathing, showering, toilet use, multi-user furniture, or new voice.
Those categories still need their own anchors, silhouettes, and displayed
acceptance.

## [BR-proof-boundary] Completion claims stay narrow

Automated gates prove code and data contracts. They do not prove that the book
is legible, the pose faces the shelf, the body clears the wall, or the motion
looks intentional at shipping size. This slice is complete only after the
displayed production WebGPU pass is recorded and every finding is fixed or
explicitly deferred with its reason.
