# Furniture builder implementation plan

> For agentic workers: use `superpowers:subagent-driven-development` to
> implement and review these units in order. Track completion in the plan's
> gitignored SDD ledger; do not restart completed units after compaction.

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

The shared interface to implement is:

```rust
// terri-core
// Codes: SouthEast=0, SouthWest=1, NorthWest=2, NorthEast=3.
pub struct ObjectFacing(pub Facing);
// Facing: ALL, code(), from_code(u8) -> Option<Self>, turned().

// terri-data::CompiledObject
pub fn supports(&self, facing: Facing) -> bool;
pub fn next_supported_facing(&self, from: Facing) -> Option<Facing>;
pub fn footprint_at(&self, facing: Facing) -> Footprint;
pub fn sockets_at(&self, x: f32, y: f32, facing: Facing)
    -> Vec<CompiledPlacementSocket>;

// terri-sim
pub fn placed_footprint(content: &ContentPack, id: ObjectDefId,
    facing: Option<&ObjectFacing>) -> Footprint;
pub fn apply_object_placement(world: &mut World, entity: Entity,
    definition: &CompiledObject, origin: Position, facing: Facing);
```

For old entities with no direction component, `placed_footprint` uses the
definition's base direction. The placement helper updates position, facing,
sprite, foreground and action sockets together; callers validate first.

- [ ] Run a red test that asserts a restored, explicitly turned object keeps
  its direction and rotated socket, then implement the save suffix.
- [ ] Run `cargo test -p terri-core`, `cargo test -p terri-data`, and targeted
  simulation facing/save tests. Expected green: exact authored defaults,
  rotation changes hash, roundtrip preserves direction, invalid suffix refuses.
- [ ] Run the full workspace and clippy once, record evidence and commit.

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
   Match the existing F5 lot rule: every object has at least one clear cardinal
   approach tile, and every clear approach tile belongs to the common reachable
   region. Authored action sockets are display projections, not route goals;
   do not require paths into a blocked footprint to reach them. Every live
   SmartObject blocks, including scenery. Keep out-of-bounds boundaries implicit
   rather than inventing perimeter wall cells. Reconstruct existing origins
   with the same nonnegative truncation as `new_from_lot`, not route rounding.
   Before deriving a candidate, reconstruct the current grid from the
   fingerprinted content's wall coordinates and all live object rectangles.
   Require equal dimensions and exact equality with the live bitmap; also
   reject overlapping current rectangles or current objects overlapping walls.
   If provenance does not match, return `UnsupportedLayout` without writes.
   Do not invent wall ownership by subtracting object cells from the bitmap.
   This admits valid moved layouts on the same walls and refuses arbitrary
   headless/custom grids whose wall ownership Save V1 cannot represent.
3. Preview returns status plus the candidate footprint and resolved render
   layers without mutating the world or consuming randomness. Commit reruns
   the planner and applies grid, position, facing, sockets and presentation
   together. Unchanged placement succeeds without unnecessary revision bumps.
   A successful moved placement records a one-shot render discontinuity for
   that entity. The next render sync reseeds only its previous position from
   its new current position, so paused interpolation cannot leave furniture
   halfway between tiles. Do not reseed every entity: paused Sim walking must
   retain its in-flight interpolation. Test the edited object and an unrelated
   walking Sim together, including at a nonzero interpolation fraction.
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

```rust
pub fn validate_placement(world: &World, object: u32, origin: (u32, u32),
    facing: Facing) -> Result<PlacementPlan, PlacementRefusal>;
// PlacementPlan owns candidate grid and resolved identity/origin/facing.
// The result must not borrow a World that commit will mutate.
```

```typescript
interface PlacementPreview {
  readonly valid: boolean;
  readonly reason: string | null;
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  readonly width: number;
  readonly depth: number;
  readonly sprite: number;
  readonly foreground: number | null;
}
// SimBridge methods, backed by boundary-validated WASM queries:
// placementPreview(object, x, y, facing): PlacementPreview
// placeObject(object, x, y, facing): boolean (queue acceptance, not commit)
// objectFacing(object): number | null
// objectFacingMask(object): number (four low bits)
// lotRevision(): number
// lastPlacementResult(): { object: number; reason: string | null } | null
```

- [ ] RED: preview a wall overlap, apply the same command, then compare the
  entire snapshot with before; assert both refuse for the same reason.
- [ ] GREEN: planner performs every check before writes; command result is
  distinct from queue acceptance and preserves strict command ordering.
- [ ] Run `cargo test -p terri-sim placement`, command-ordering tests,
  `cargo test -p terri-wasm --release` and bridge boundary tests.

## Task 3: Paused builder controls and visible preview

Ownership: new `web/src/ui/builder.ts`, `web/src/render/placement-preview.ts`,
associated tests, and focused integration in `main.ts`, `input.ts`, `frame.ts`,
HTML/CSS, help and command feedback. Consume Task 2's contract.

Visual direction: furniture placement should be the dominant visual, not a
new dashboard. Reuse the established HUD tokens: panel `#16161c`, edge
`#2c2c36`, text `#d8d8e0`, secondary `#9aa3ad`, valid/selected `#6fb2d2` and
invalid `#e58c85`. Keep the existing system font, 13px secondary text, 14px
controls and a 16px object-name heading. Do not add a font dependency.

On desktop, use the existing left HUD region for the editing panel and
temporarily collapse the ordinary person-detail surfaces, remembering their
state for exit. On narrow screens, keep mode and Exit visible independently
of the collapsible Menu; place the compact object controls in a safe-area-aware
bottom dock and preserve camera panning above it. Review both layouts at 390px.

```text
Build mode                 Exit
Reading chair
Facing: South-west         Rotate
Ready to place / specific refusal
[ Confirm placement ] [ Cancel ]
```

Use a restrained tinted candidate sprite and footprint, with a clear
selection marker for the original. No looping bounce, glow or decorative
entry motion. The exact furniture orientation is the distinguishing visual.
This keeps the current game's identity; a separate floating card theme would
consume canvas without improving placement.

The existing instance format has RGB tint and emissive, not opacity. Keep
that contract for this slice; do not reinterpret emissive as alpha. Tint and
the footprint identify the candidate without widening every instance.

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

- [ ] RED: an active builder consumes furniture clicks without calling the
  normal Sim-use handler; Cancel leaves the snapshot byte-identical.
- [ ] GREEN: confirm reads `lastPlacementResult`, not `placeObject`'s boolean;
  invalid previews remain visible with the refusal reason.
- [ ] Run `npm run typecheck`, `npm test -- --maxWorkers=1`, `npm run build`.

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
   Correct the stale bike-facing paragraphs in FEATURES and ARCHITECTURE:
   distinguish the approved four-facing art from the old mirrored-art failure,
   and distinguish that available art from runtime builder controls. Retain
   historical evidence as dated history, not as a current limitation.
5. Commit/push the reviewed feature, open and attach its PR, wait for all checks,
   merge, then verify the merge SHA's Pages deployment and running game.
