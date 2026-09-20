# Furniture builder implementation plan

**Goal:** Let players move existing furniture and rotate it to supported
directions, with a reliable preview, clear refusals and durable saved layouts.

**Architecture:** Rust owns placement and validates both previews and commands
with one transaction planner. The browser owns an explicit paused edit mode,
selection and presentation. Runtime object facing drives footprint, sprite,
foreground and sockets together. No new dependency or external service.

**Tech stack:** Existing Rust ECS, postcard saves, WASM bridge, TypeScript DOM
controls and WebGPU instancing.

**Spec:** `docs/specs/2026-09-20-front-door-and-builder.md`.

## Global constraints

1. Preserve current main's bathtub rotation, front-door landing, approved
   furniture art, command ordering and older published household saves.
2. Fetch main at each unit boundary and before publishing. Integrate changes
   in the feature branch; do not alter other worktrees or discard their edits.
3. No purchasing, object deletion, wall construction or room resizing in this
   slice. No new dependencies, generic engine replacement or paid assets.
4. A refused placement changes no world state. Preview is observational and
   commit revalidates it. Never clear blocked tiles under an object; construct
   candidate occupancy from authored walls and every other live object.
5. Preserve entity identity, interaction rows, queues and save compatibility.
   Refuse occupied or targeted furniture and placements that block Sims,
   remaining paths, usable interaction approaches, door or door landing.
6. Direction support requires an actual matching sprite, foreground where
   needed, and valid sockets. Do not mirror asymmetric art or rotate a sprite
   plane. The current definition's footprint and sprite remain its authored
   base orientation, including the newly rotated bathtub.
7. All new controls work with keyboard, pointer and touch. Confirm and Cancel
   are explicit. Keep speed restoration and modal ownership correct.
8. Run focused red/green tests per unit, mutation checks for load-bearing
   guards, and a displayed browser played pass before release. Screenshots
   are evidence, not a substitute for exercising controls.

## Task 1: Runtime furniture direction and durable layout

Ownership: `crates/terri-core/src/{facing,components,save,hash,lib}.rs`,
`crates/terri-data/src/{schema,pack,compile,lib}.rs`, the corresponding
simulation construction, presentation and save code, and content direction
metadata. No command or builder UI work yet.

1. Inspect `twcl/b-facing-turn` commits `6cab1b9` and `9440dd6` as references.
   Port the small facing value type and tested transformations, not the whole
   branch. Its art, fingerprints and bathtub assumptions predate current main.
2. Introduce a stable four-value `Facing` and an `ObjectFacing` component.
   Resolve supported sprites/foregrounds at compile time. Encode an explicit
   base facing for definitions whose default sprite is already directional;
   orientation transforms use the delta from that base. Preserve every current
   placement's footprint, sprite, foreground and socket without a player edit.
3. Centralize object presentation application and `placed_footprint`; update
   all construction, rendering, interaction geometry and validation consumers.
   Search every footprint and socket caller. Unsupported directions fail
   compilation or command validation, never fall back silently.
4. Append saved per-object facing data without reordering existing Save V1
   fields. Validate duplicate, non-object, unsupported and invalid codes before
   replacement. Old saves without the suffix retain their authored direction.
   Preserve the frozen pre-bathtub migration and exact pre-door bridge.
5. Add causal tests for all directions, non-square dimensions, socket axes,
   foreground matching, world hash sensitivity and save replay. Use the real
   pre-bathtub fixture plus current public saves as compatibility evidence.
6. Run core/data/simulation/WASM focused tests, full workspace once, fmt and
   clippy. Report exact red/green and mutation evidence, then commit this unit.

Output contract: stable direction codes; `CompiledObject` support and geometry
queries; one function applying position/facing-derived presentation;
`placed_footprint`; validated persistent runtime directions.

## Task 2: Atomic placement preview and commands

Ownership: new `crates/terri-sim/src/placement.rs` and focused tests,
`systems/lot_edit.rs`, core command types/queue, simulation schedule wiring,
WASM exports and `web/src/bridge.ts` with boundary tests.

1. Write refusal tests before implementation: stale/non-object ID, bounds,
   unsupported direction, wall/furniture overlap, in-use object, standing Sim,
   remaining path, inaccessible interaction, blocked door and blocked landing.
2. Implement one planner taking object ID, integer origin and facing. Return
   either a complete placement plan or a stable refusal enum. Build candidate
   occupancy from fixed walls and other objects; check every live furniture
   approach and Sim route against the candidate grid. Bound all traversals.
3. Preview returns status plus the candidate footprint and resolved render
   layers without mutating the world or consuming randomness. Commit reruns
   the planner and applies grid, position, facing, sockets and presentation
   together. Unchanged placement succeeds without unnecessary revision bumps.
4. Append one serialized `PlaceObject` command for atomic move plus rotation.
   Preserve stream order across ordinary commands and edits by draining each
   ordinary stretch before the intervening edit. Do not make a second command
   queue. Test joined versus split drains and commands while paused.
5. Add a monotonic lot revision for shell caches; expose fresh memory views or
   scalar query results through WASM. Validate untrusted numeric inputs in
   release mode. Define refusal text in the shell, not Rust.
6. Test preview/commit parity, invalid transaction byte equality, preserved
   identity and use after movement, save/reload, rotated rectangles and sockets,
   foregrounds, wall preservation, door return after editing and memory growth.
7. Deliberately remove the collision and route guards and confirm causal test
   failures in an isolated copy. Restore byte-identically, then run focused
   suites and commit.

Output contract: placement query, appended command, result/refusal query,
lot revision and geometry projection available from `SimBridge`.

## Task 3: Paused builder controls and visible preview

Ownership: new `web/src/ui/builder.ts`, `web/src/render/placement-preview.ts`,
associated tests, and focused integration in `main.ts`, `input.ts`, `frame.ts`,
HTML/CSS, help and command feedback. Consume Task 2's contract.

1. Add a plainly labeled Build button with pressed state. Entering uses the
   existing pause ownership model and remembers player speed. Exiting restores
   it once, unless another modal still owns the pause. Keep save/load and
   mobile HUD interactions explicit and tested.
2. In Build mode, select furniture without sending Sim-use commands. A tile
   click sets the candidate origin. Pointer movement may preview before click;
   touch does not require hovering. Camera drag/pinch must remain available.
3. Draw candidate furniture and its footprint with clear valid/invalid styling,
   keeping the original object unchanged until Confirm. Show object name,
   direction, Rotate, Confirm and Cancel. Rotate cycles only supported art;
   disabled rotation explains why. Refusal text says what obstructs placement.
4. Provide keyboard selection and tile adjustment, R to rotate, Enter to
   confirm and Escape to cancel/exit, without stealing text-input shortcuts.
   Controls have visible focus, accessible names and touch-sized targets.
5. On commit, read actual command result, refresh floor/occupancy/lighting and
   selection caches using lot revision, and retain useful selection. Requery
   after load or any intervening edit. Never display speculative success.
6. Test mode ownership, input isolation, valid/invalid previews, rotation
   support, confirmation failure, cancellation, cache refresh, keyboard and
   mobile layout. Run typecheck, one-worker web suite, release build and commit.

## Task 4: Played review, documentation and delivery

Ownership: integration verification and documentation only, with fixes routed
to the owning implementation unit and independently reviewed.

1. Fetch/integrate main, run full Rust/web checks and required mutation gates.
2. In a displayed production browser, LOOK at moving a lamp, rotating the
   four-facing chair and bike, moving a rectangular object, invalid wall/door
   placement, Cancel, confirm, Save/Load and exiting back to normal speed.
   Inspect sockets/foregrounds during real interactions after placement.
3. Exercise keyboard-only and narrow touch layouts, camera controls, reduced
   motion and night lighting. Watch a career departure/return after editing,
   one need cycle and a conversation. Capture direct browser evidence.
4. Update FEATURES, architecture, alpha feel notes and lessons with precise
   shipped scope and findings. Do not call wider room construction complete.
5. Commit/push the reviewed feature, open and attach its PR, wait for all checks,
   merge, then verify the merge SHA's Pages deployment and running game.
