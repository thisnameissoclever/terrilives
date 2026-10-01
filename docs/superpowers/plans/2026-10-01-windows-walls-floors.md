# Windows, Walls and Floors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. The owner approved the plan and selected option 1 on 2026-10-01. Steps use checkbox syntax for tracking. Retain the Task 1 wall/floor appearance checkpoint before the full asset batch.

**Goal:** Replace placeholder architecture with substantial plaster walls, distinct floor materials and all nine approved windows, with reliable placement, preserved saves and daylight that stops at night.

**Architecture:** Author geometry in offline Blender and import reviewed sprites into the current WebGPU renderer. Keep simulation-owned window spans separate from rendered wall pieces, and give thick architecture a measured per-pixel depth surface instead of assuming every visible surface lies on one plane. Preserve the existing floor-covering identities, wall graph, cutaway behavior and day/night lighting model.

**Tech Stack:** Rust, Bevy ECS, serde/postcard, WASM, TypeScript, WebGPU/WGSL, Python/Pillow and the installed Blender launcher. No new package, SDK, service or paid generation is required.

**Spec:** [Windows, walls and floors](../../specs/2026-10-01-windows-walls-floors.md). Read it before execution; it defines approval, appearance, edit semantics and compatibility.

## Global constraints

1. Work only in the assigned `terrilives` worktree. Recheck status and upstream before implementation. Planning baseline: `fd75b9c2a9a43e5b49ac6467041cc49324339da3`.
2. All nine window designs are approved at their displayed widths. No second concept-selection gate. The first room is a new wall/floor appearance checkpoint.
3. Use the existing projection: half-tile width 32, half-tile height 21, vertical unit 38, full wall height 2.0. Preserve furniture coordinates, footprints, Sim proportions and source rig bytes.
4. Append new sprite records after the complete current atlas prefix. Preserve old names, IDs, dimensions and decoded pixels, including the old architecture needed by frozen legacy layouts.
5. Keep Boards=1, Tiles=2, Carpet=3 and unpainted=0. Do not reorder content or recolor the old sprite as a substitute for new material art.
6. Append command/layout enum variants. Do not add fields to existing postcard records or silently accept malformed new records.
7. The whole placed window owns placement, replacement and removal. Collision and save validation use its complete span.
8. Window light is outdoor daylight transmission, exactly zero at night. Flat lighting and reduced motion retain their existing semantics.
9. Use two Blender threads and hidden background launch. Use one local test worker and serial heavy checks. Do not stop another task's servers, browser pages or tests.
10. Close task-owned game pages in `finally`; stop task-owned preview servers when finished. Preserve the owner's browser saves with an isolated review context.
11. Apply the project writing skill, `my-writing-style` and `unslop`. Functional labels are literal. No em dashes, branding or co-author trailers.
12. No dependency changes, purchases, deployment or unrelated rewrite is included. Follow the project's delivery rules once delivery is explicitly authorized.

## Review focus

1. A three-unit window selected at its middle/end must behave as one object; a failed replacement must preserve every old line, command result and revision. Tasks 3, 4 and 8 own this.
2. Rear-shell windows at X=0/Y=0 must remove the correct opaque art, admit daylight and never create an off-lot path. Tasks 3, 6 and 9 own this.
3. A thick sill beside a desk, occupied bunk or doorway must use correct depth, including at fractional zoom and during a local wall fade. Tasks 1, 2, 6 and 10 own this.
4. Old saves, new saved command queues, Room edits and yard migration must preserve window model/span ownership. Tasks 3 through 5 own this.
5. A floor material must remain continuous across tiles and retain its selection after Load, while midnight windows remain dark and Flat mode stays readable. Tasks 7, 9 and 10 own this.

## Delivery order and ownership

This is one coordinated architecture change, split into independently reviewed tasks. Art/export,
simulation/persistence and presentation have separate modules, but share a pinned contract.
Use one source editor in this worktree at a time. A delegated worker owns only the task's
listed files, is not alone in the repository, and must preserve others' edits. Reviewers are
read-only. Do not run overlapping art exports against changing inputs.

Task 1 is the feasibility and taste checkpoint. Task 2 completes the asset/export contract.
Tasks 3 through 5 add persistent window ownership. Tasks 6 through 9 integrate the visuals,
controls and daylight. Task 10 verifies the combined result and updates behavior documents.
Each task ends with its focused checks and review; do not push an intermediate broken game.
Create commits only as part of authorized implementation/delivery.

## Shared interfaces

These are proposed interfaces to implement, not APIs that already exist.

```rust
// crates/terri-core/src/windows.rs
// Enum order is the stored order. Public model IDs are 1 through 9.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WindowModel {
    Sash, Cottage, Arched, Sliding, SteelGrid, TwinCasement,
    Picture, Craftsman, Clerestory,
}
// Deserialize validates that the span fits the coordinate representation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct WindowPlacement {
    pub line: WallLine,
    pub model: WindowModel,
}
// Required methods:
// WindowModel::id(self) -> u8
// WindowModel::from_id(id: u8) -> Option<Self>
// WindowModel::width(self) -> u32
// WindowPlacement::checked_lines(self) -> Option<Vec<WallLine>>
// WindowPlacement::lines(self) -> Vec<WallLine>
// SavedLayout::window_placements(&self) -> Vec<WindowPlacement>
// SavedLayout::window_lines(&self) -> Vec<WallLine>
// SavedLayout::window_at(&self, line: WallLine) -> Option<WindowPlacement>
```

```ts
// web/src/architecture/windows.ts
export type WindowModelId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export interface WindowPlacement {
  readonly axis: 0 | 1;
  readonly x: number;
  readonly y: number;
  readonly model: WindowModelId;
}
export interface WindowDefinition {
  readonly id: WindowModelId;
  readonly label: string;
  readonly width: 1 | 2 | 3;
}
// catalogue data comes from Rust; art metadata supplies sprite mappings.
// decodeWindowPlacements(rows: Uint32Array): readonly WindowPlacement[]
// coveredWindowLines(window: WindowPlacement): readonly WallLine[]
// windowAt(windows: readonly WindowPlacement[], line: WallLine): WindowPlacement | null
// WindowEditPreview: { valid: boolean; reason: number;
//   affectedLines: readonly WallLine[]; placement: WindowPlacement | null }
// Bridge additions:
// windowPlacements(): Uint32Array       [axis, x, y, modelId] per placement
// windowCatalogue(): readonly WindowDefinition[]
// windowEditPreview(axis: number, x: number, y: number, model: number): WindowEditPreview
// fitWindow(axis: number, x: number, y: number, model: number): boolean
// removeWindow(axis: number, x: number, y: number): boolean
// windowRemovalPreview(axis: number, x: number, y: number): WindowEditPreview
// lastWindowEditResult(): { reason: number } | null
```

`WindowPlacement::lines` uses checked coordinate addition; malformed coordinates
are rejected before expansion. Deserialization rejects overflowing spans.
Untrusted edit/load boundaries use `checked_lines`; `lines` requires a representable
span. Public bridge inputs reject fractional, negative,
non-finite and unknown model values before conversion to unsigned integers.
Keep the old `windowLines()` bridge projection and historical command encodings.
The new controller uses the dedicated preview/result API, not several legacy
`setWallEdge` calls. Staging success is not application success.

## Task 1: Prove the architecture in one review room

**Files:** Create `assets/models/architecture/README.md`, `geometry.py`,
`render_review.py`, `test_geometry.py`; create `web/proofs/architecture-room.js`,
`web/tests/architecture-depth.test.ts` and evidence under
`docs/assets/review-evidence/architecture/room-01/`. Add the opt-in depth-texture
foundation to `web/src/render/atlas.ts`, `instances.ts`, `sprites.ts` and
`sprites.wgsl`; default historical sprites to their existing paths.
Read `assets/models/kitchen/render_static.py`,
`assets/models/bathroom/README.md`, `assets/models/sims/sim-01/README.md`,
`web/proofs/wall-occlusion.js` and `web/proofs/cutaway-walls.js`.

**Consumes:** Approved image and spec dimensions. **Produces:** One candidate
room, source geometry, registered trial exports and a measured feasibility result.

- [x] Record baseline source/atlas hashes and a visible current-game screenshot.
  Copy the approved board into the review evidence by reference, retaining its
  SHA-256 `40e46fa4b826ea149e8a96c2fb9fdd4ac35446438f70e2f4715354c21bf91820`.
- [x] Implement a small pure geometry description for a straight wall, corner,
  reveal, sill and floor patch. Put faces on their authored coordinates; do not
  spread panels apart to accommodate the bevel. Pin geometry with assertions:

```python
def test_architecture_dimensions():
    from geometry import WALL_HEIGHT, WALL_THICKNESS, window_span
    assert WALL_HEIGHT == 2.0
    assert WALL_THICKNESS == 0.12
    assert window_span(1) == 1.0
    assert window_span(2) == 2.0
    assert window_span(3) == 3.0
```

- [x] Build a room with an L corner, one doorway, a Sash, Sliding and Picture
  window, and separate oak, tile and carpet floor patches. Place the accepted
  Sim, desk and bed as scale/contact references without editing their sources.
- [x] Render both axes, full height and the cut plane, with the installed hidden
  Blender launch command from the Sim README. Use a new candidate directory,
  `--threads 2`, `--python-exit-code 1` and an absolute script path. Require a
  fresh proof containing `bpy.app.background`, complete status and output hashes.
- [x] Implement the opt-in depth-texture foundation used again by Task 6, and
  exercise trial color/depth exports through the actual `SpriteRenderer` in the
  isolated GPU proof page. Do not duplicate the shader inside a mock renderer. Prove
  the physical depth formula on a front face, back face, top cap and sill. Include
  a close-up beside the desk and occupied bed; keep the production atlas untouched.
- [x] Run `python -B -m unittest discover -s assets/models/architecture -p 'test_*.py'`.
  Also run `npm --prefix web test -- --maxWorkers=1 tests/architecture-depth.test.ts
  tests/wall-depth.test.ts tests/cutaway-walls.test.ts` and web typecheck.
  Save native-scale and enlarged images, actual GPU results and baseline/candidate
  texture bytes and render times. A source render alone is not renderer evidence.
- [x] Show the room to the owner for the new walls and floors. Keep all nine
  window approvals. If thickness, outlines or materials need adjustment, change
  this shared source and repeat only the affected room proof before full export.

**Exit:** The room's appearance is accepted, depth is correct and the current
renderer can carry the new architecture without relocating existing objects.

The owner accepted candidate08's wall and floor appearance on 2026-10-01.
[Review evidence](../../assets/review-evidence/architecture/room-01/README.md)
records the actual-renderer captures, immutable fixture hashes, depth and coverage
checks, and the original-renderer timing comparison with its measurement limits.
The generated atlas stays owned by its generator; the optional architecture
registration lives in a separate helper.

## Task 2: Export and register the complete architecture set

**Files:** Create `assets/models/architecture/windows.py`, `walls.py`, `floors.py`,
`materials.py`,
`render_batch.py`, `check_scene.py`, `review_batch.py`, `export_batch.py` and
`architecture.json`; create `assets/sprites/gen/offline_architecture.py` and
`test_offline_architecture.py`; modify `assets/sprites/gen/build.py` and generated
atlas outputs. Tests also cover `test_geometry.py`.

**Consumes:** Accepted Task 1 geometry/camera. **Produces:** Reviewed sprite/depth
assets, an append-only atlas extension and generated architecture registration.

- [x] Define data-driven wall/floor finish descriptors with separate stable
  geometry, pattern and palette keys. Retain material-role masks so wall finishes
  exclude glazing, frames and independent trim. Reuse geometry/depth across
  appearances; avoid exporting the Cartesian product of colors and models.
  Keep catalogue metadata separate from loaded texture resources and validate
  budgets for the accepted set and expanded test catalogues.
- [x] Render all nine models for both axes and visible sides. Include full and
  cutaway forms. Build straight walls, exposed ends, all corner/T/cross masks,
  short/full transitions, door surrounds and shared baseboards. Derive split
  pieces from one rendered surface and ownership mask, not independent redraws.
- [x] Author repeatable floor patches for Boards, Tiles, Carpet, neutral interior,
  grass and street. Render a four-by-four patch per material; crop tile variants
  from the common raster so plank ends and grout match. Coordinates select phases
  deterministically; no simulation random draws and no per-frame generation.
- [x] Test extra patterns and at least two palettes as unshipped fixtures. Confirm
  identical physical bounds/depth across color choices, correct material-mask
  ownership, repeat alignment and rejection of unknown catalogue references.
- [x] Export transparent straight-alpha color plus local `x+y` depth. Store
  model, direction, height mode, origin, logical bounds, physical bounds,
  texture density, owned span and source hashes in `architecture.json`.
  Match color/depth dimensions and registration exactly. Preserve source originals.
- [x] Validate physical contacts, window height, width, joins, padding and both
  side views. Reject floating sills, unsupported lintels, pane/bar intersections
  outside their authored joints, clipped arches and mislabeled rotations.
- [x] Implement import guards before switching any live sprite mapping. Reject
  incomplete batches, changed hashes, missing models/directions, mismatched depth
  registration and overlapping split ownership. Mechanical test examples:

```python
def test_window_catalogue_is_complete():
    from offline_architecture import load_reviewed_architecture
    batch = load_reviewed_architecture()
    assert set(batch.window_ids) == set(range(1, 10))
    assert batch.widths == {1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2,
                            7: 3, 8: 3, 9: 3}
    assert batch.missing_directions == []
    assert batch.depth_registration_errors == []
```

- [x] Give `load_reviewed_architecture()` the fields asserted above and reject
  bad data before returning. Mutation cases remove model 9, change a width,
  flip one direction, offset depth by one pixel and detach a sill. Each must fail
  a named assertion, then the byte-identical source must pass.
- [x] Pack new assets after the current complete atlas prefix. Add companion
  depth metadata without changing old color UV ownership. Query actual device
  limits in the proof and keep the existing build-time texture-size guard.
- [x] Run architecture and generator Python suites, then
  `python -B assets/sprites/gen/build.py --check`. Review every original and
  native-scale window independently. Keep rejected candidates with reasons.

**Exit:** The accepted set covers every model, supported orientation and cutaway
state. Import cannot silently accept a stale or partial batch.

## Task 3: Define canonical window models and spans

**Files:** Create `crates/terri-core/src/windows.rs`; modify
`crates/terri-core/src/lib.rs`, `layout.rs`, `command.rs` and `save.rs`.
Put focused unit tests beside the new types and existing wire-contract tests.

**Consumes:** The nine model definitions. **Produces:** The shared Rust types,
layout projections and appended command variants defined above.

- [x] Add the nine `WindowModel` variants in the approved order. Widths are
  `[1,1,1,2,2,2,3,3,3]`; public IDs are `[1,2,3,4,5,6,7,8,9]`.
  Implement the shared methods and the new `EdgeWallsV3` variant.
- [x] Add model/span tests before implementation. Example:

```rust
#[test]
fn picture_window_owns_three_lines_in_both_axes() {
    for axis in [EdgeAxis::Vertical, EdgeAxis::Horizontal] {
        let placed = WindowPlacement {
            line: WallLine { axis, x: 4, y: 3 },
            model: WindowModel::Picture,
        };
        let lines = placed.lines();
        assert_eq!(lines.len(), 3);
        let end = if axis == EdgeAxis::Vertical { (4, 5) } else { (6, 3) };
        assert_eq!((lines[2].x, lines[2].y), end);
    }
}
```

- [x] Preserve old serialized layouts byte for byte. V2 projection supplies Sash
  descriptors without rewriting the stored resource. New projections return
  every covered line, while `window_at` resolves any segment to its owner.
- [x] Append FitWindow `{ axis, x, y, model }` and RemoveWindow `{ axis, x, y }`
  to live and saved commands. Use a validated model type inside the simulation;
  boundary IDs remain integers. Pin old command vectors and record the actual
  appended tags from the execution baseline rather than guessing unused codes.
- [x] Run `cargo test -p terri-core -j 1`. Test IDs 0/10, checked overflow,
  single-unit defaults, both axes and all interior segments of every model.

**Exit:** A window has one unambiguous identity, span and serialized representation.

## Task 4: Apply whole-window transactions and protect every writer

**Files:** Create `crates/terri-sim/src/placement/windows.rs` and `window_tests.rs`;
modify `placement.rs`, `placement/walls.rs`, `placement/rooms.rs`,
`systems/lot_edit.rs`, `systems/command.rs`, `save/yard.rs`, `save.rs`,
`save/architecture.rs`, the window hash in `lib.rs`, and relevant wall/room tests.

**Consumes:** Task 3 types. **Produces:**
`validate_window_edit(world: &World, edit: WindowEdit) -> Result<WindowPlan, PlacementRefusal>`
and `apply_window_edit(world: &mut World, edit: WindowEdit) -> WindowEditResult`.
Define `WindowEdit` as Fit(WindowPlacement) or Remove(WallLine); `WindowPlan`
owns the entire candidate layout/grid and a changed flag; the result contains
the edit and optional refusal. Preview and commit call the same validator.

- [ ] Search all `windows()`, `EdgeWallsV2`, `from_parts`, `WallState::Window`,
  layout writes and enum matches before editing. Update room edits, yard migration
  and test helpers, not just the new window button. Keep ordinary edge bounds intact.
- [ ] Complete the saved-command conversions and V3 restoration cases needed to
  compile the simulation with the new variants. Reuse the actual span and shell
  validation; do not add temporary no-op or catch-all handlers. Include model
  identity in the V3 world hash while retaining historical hash behavior. Task 5
  verifies full save/replay compatibility and adds the external bridge.
- [ ] Validate complete straight spans, supported shell coordinates and matching
  wall state. Check corners, crossings, front-door lines, occupied routes,
  furniture contact and existing loader usability rules against the candidate.
- [ ] Implement whole-window selection, narrower/wider replacement and removal
  semantics from the spec. Expand a legacy Wall/Open/Doorway edit that hits a
  window into a complete candidate change. Refuse opening the implicit rear shell.
- [ ] Preserve legacy `SetWallEdge(Window)` behavior for old command replay;
  map its one-line window to Sash when upgrading the layout. It cannot cut a new
  multi-unit window in half. New UI placement uses FitWindow.
- [ ] Add causal tests: invalid third line leaves layout/grid/revision unchanged;
  fit increments revision once; removing from any owned line restores the same
  span; a shorter replacement restores exposed wall; a crossing Room edit fails
  without changing anything; an unrelated Room edit retains the model ID.
- [ ] Test rear X=0/Y=0 apertures separately from invalid off-lot coordinates.
  Grid collision stays bounded; neither Sims nor pathfinding gain an outside tile.
  A front-door window attempt remains refused.
- [ ] Run `cargo test -p terri-sim -j 1 window`, then the affected wall/room tests.
  Mutation-check skipped third-line validation, per-line partial writes, and a
  Room/yard writer that drops model metadata. Require assertion failures.

**Exit:** Every edit is all-or-nothing and no existing writer can dismantle a window
without the specified whole-span semantics.

## Task 5: Preserve saved games, replay and the WASM bridge

**Files:** Modify `crates/terri-sim/src/save.rs`, `save/architecture.rs`,
`save/architecture_boundary_tests.rs`, `lib.rs`, `crates/terri-wasm/src/lib.rs`
and `web/src/bridge.ts`; add `web/src/architecture/windows.ts` and
`web/tests/window-bridge.test.ts`. Touch `crates/terri-data/src/lib.rs` only if
the measured compiled content fingerprint requires a narrow compatibility update.

**Consumes:** Tasks 3 and 4. **Produces:** Safe V3 restoration, saved command
round trips, hash coverage, catalogue/descriptor exports and TypeScript decoding.

- [ ] Load historical fixtures and current V2 saves. Confirm old windows project
  as Sash, old floor IDs remain unchanged, and unrelated edits do not force V3.
- [ ] Validate V3 model/span bounds, order, overlap and wall/window exclusivity
  before restoring the candidate world. Apply the same shell rules as Task 4.
  Keep a failed load from replacing the active world.
- [ ] Round-trip all nine models, both axes, rear-shell apertures and pending
  FitWindow/RemoveWindow commands. Test every byte truncation inside a new record,
  duplicate spans and unknown IDs. Never default a partial new record to Sash.
- [ ] Verify save-command conversion and world hashing from Task 4. Swapping Sash for Cottage
  on the same line must change the hash; changing light mode must not. Load and
  uninterrupted command replay must reach the same resulting layout and hash.
- [ ] Add the bridge methods in Shared interfaces. Assert descriptor stride is
  four and old `window_lines` remains expanded triples. Validate catalogue IDs,
  model widths and command-refusal propagation across Rust and TypeScript.
- [ ] Compare compiled fingerprints before/after art import. Keep existing
  covering values and simulation content stable. If a fingerprint changes,
  identify its exact cause and test the historical content shape; do not
  disable fingerprint checking or accept arbitrary old hashes.
- [ ] Run `cargo test -p terri-sim -j 1`, `cargo test -p terri-wasm -j 1`, rebuild
  WASM, then `npm --prefix web test -- --maxWorkers=1 tests/window-bridge.test.ts
  tests/legacy-save.test.ts tests/save-worker.test.ts`. These commands run serially.

**Exit:** The user can load an old house, edit new windows, save and reload without
losing architecture, covering choices, household state or queued operations.

## Task 6: Render connected walls and actual windows

**Files:** Create `web/src/render/architecture.ts`, `web/tests/architecture.test.ts`
and `web/proofs/architecture-depth.js`; modify `render/edge-walls.ts`, `tiles.ts`,
`instances.ts`, `sprites.ts`, `sprites.wgsl`, `wall-fade.ts`,
`main.ts`, and existing edge-wall/cutaway/wall-depth tests.

**Consumes:** Generated `architecture-data.ts` from Task 2 and Task 5 descriptors.
**Produces:** Architecture sprite/depth lookup and full/cutaway wall instances.

- [ ] Add `architectureSprite(modelId, axis, side, cutaway)` using generated,
  validated metadata. Draw one span model rather than stretched or repeated
  one-unit glass. Remove the blue tint from this new path; retain old records
  required by legacy rendering and tests.
- [ ] Resolve wall appearances through Task 2's finish descriptors, with the
  accepted plaster as the default. Pattern and palette choices share physical
  geometry/depth and respect exported material roles. Prove alternate fixture
  finishes without recoloring glazing/frames, changing wall spans or adding a
  renderer branch per finish. Keep resource loading bounded by active assets.
- [ ] Join opaque wall half-segments with windows at exact endpoints. Suppress
  rear-shell solid arms covered by apertures. Add joining arms only outside an
  aperture, and keep material and baseboard continuity around doors.
- [ ] Connect the Task 1 companion depth-texture foundation to the Task 2
  generated metadata. Old sprites use their current depth logic. New architecture computes:

```wgsl
// localSum is an authored signed x+y offset sampled without color conversion.
// depthStep equals layeredDepth(0,0,gridSize,LAYER_PROP)
//                 - layeredDepth(1,0,gridSize,LAYER_PROP).
out.depth = clamp(in.clip.z - localSum * depthStep, 0.0, 1.0);
```

- [ ] Use explicit texture level/load behavior inside conditional sampling.
  Apply the existing alpha coverage test before opacity. Keep the short-wall
  pass depth-tested without depth writes, including its wall-only draw path.
- [ ] Give a wide cutaway panel the union of its far-side cells. Any relevant Sim
  fades it; all must leave before it recovers. Camera changes preserve fade state,
  successful Load resets it, reduced motion applies target opacity immediately.
- [ ] Prove all masks, aperture endpoints, both axes and full/low transitions.
  Compare split-piece reconstruction to the common source raster. Exercise
  0.5, 1, 1.375 and 2.5 zoom and paired 25% panels giving 43.75% combined coverage.
- [ ] Run the focused web tests and real GPU depth proof. Deliberately reverse
  the depth sign, omit aperture suppression and enable low-wall depth writes;
  each must fail the relevant pixel assertion. Preserve source bytes afterward.

**Exit:** No seams, floating window parts or furniture clipping in the new shell;
the existing movement and cutaway contracts remain intact.

## Task 7: Give floor coverings their own material art

**Files:** Create `web/src/render/floor-materials.ts` and
`web/tests/floor-materials.test.ts`; modify `render/tiles.ts`,
`ui/floor-tool-controls.ts`, relevant floor-tool tests and Task 1's room proof.

**Consumes:** Task 2 floor sprites and unchanged saved covering IDs.
**Produces:** `floorSpriteName(covering: number, zone: 'house' | 'yard' | 'street',
x: number, y: number): string` and matching visible swatches.

- [ ] Write mapping tests before changing the current one-sprite selection:

```ts
expect(floorSpriteName(1, 'house', 0, 0)).toContain('boards');
expect(floorSpriteName(2, 'house', 0, 0)).toContain('tiles');
expect(floorSpriteName(3, 'house', 0, 0)).toContain('carpet');
expect(floorSpriteName(0, 'yard', 0, 0)).toContain('grass');
expect(floorSpriteName(0, 'street', 0, 0)).toContain('street');
expect(floorSpriteName(1, 'house', 4, 4))
  .toBe(floorSpriteName(1, 'house', 0, 0));
```

- [ ] Map 1/2/3 to material families explicitly. Test this against the existing
  ordered covering list; never infer a material from hue, translated label or
  name substrings. Unpainted interior uses the accepted neutral surface.
- [ ] Resolve those mappings through the finish catalogue, not a fixed three-case
  switch. Prove an appended covering resolves its pattern and palette through
  data alone and appears through the existing content-driven floor controls.
  Keep legacy saved IDs stable and test mixed patterns and multiple colors.
- [ ] Select pattern phase by `(x % 4, y % 4)` for nonnegative lot coordinates.
  Keep one floor instance per tile and the shared `FLOOR_DEPTH`. Preview writes
  the exact same material as commit, with the existing highlight overlay.
- [ ] Reuse Task 1's canonical floor diamonds and shared camera transform.
  Pass world tile coordinates; adjacent corners must project identically.
  Preserve the fractional-origin, reversed-order, mixed-material and missing-tile
  GPU cases that caught gaps in the initial floor coverage approaches.
- [ ] Use each finish's generated authored-content-color baseline to apply
  current covering settings relative to the accepted art: hue difference,
  strength ratio and lightness difference. Unchanged content must produce the
  identity transform, so the accepted hue appears once. Keep saved IDs, content
  tuning and historical sprite transforms untouched. Test default identity and
  nondefault transform composition for each final material.
- [ ] Verify adjacent edges at native/fractional zoom and mixed materials. No
  visible tile border on carpet, no crossed diagonals on any replacement, no
  floor triangle covering a Sim's feet. Grass/street retain their zone behavior.
- [ ] Run focused floor/material/static-instance tests and screenshot each
  surface after paint, Remove, save/load and a desktop-to-mobile resize.

**Exit:** Materials are identifiable by structure as well as color, and painting
continues to use the original covering and save contracts.

## Task 8: Add the nine-window chooser and whole-span preview

**Files:** Create `web/src/ui/window-tool.ts`, `window-tool-controls.ts`,
`web/tests/window-tool.test.ts` and `window-tool-controls.test.ts`; modify
`ui/wall-tool.ts`, `ui/wall-tool-controls.ts`, `ui/build-tools.ts`,
`render/placement-preview.ts`, `main.ts` and `web/index.html` for shell markup/styles.

**Consumes:** Task 5 bridge and Task 6 art mappings.
**Produces:** A Windows chooser within Build > Walls with previews and safe edits.

- [ ] Show all nine models grouped by width, using the actual exported thumbnail,
  literal model label and a visible 1/2/3-unit badge. Keep floor controls separate.
  Reuse current responsive dock behavior; do not add a second mobile interface.
- [ ] `N` selects the window tool and retains the last chosen model in transient
  UI state. Preserve arrows, V/H orientation, Escape cancellation and focus rules.
  Clicking an existing span selects its whole owner and exposes replacement and
  **Remove window**. Window controls distinguish it from **Remove wall**.
- [ ] Ask Rust for a preview for the full candidate. Highlight all affected
  lines, including restored wall from narrower replacement; draw one ghost model.
  Hide the old window visual during its replacement preview, while leaving the
  simulation unchanged until commit.
- [ ] Disable edits while blocked/loading or while an edit result is pending.
  Consume the authoritative result before showing success. On refusal retain
  the selected window and show the exact literal reason.
- [ ] Test middle/end selection, widths in both axes, touch, keyboard focus,
  viewport changes, invalid third line, model switching, exit/re-entry while a
  command is pending, and Load into a differently sized lot.
- [ ] Run focused controller/control tests and typecheck; inspect controls in
  the production build at desktop, 390px width and 200% text size.

**Exit:** The player can discover, preview, place, replace and remove every model
without guessing its occupied width or losing part of an existing window.

## Task 9: Prove day-only light through every window

**Files:** Modify `web/src/render/sky.ts`, `daylight.ts` only if needed,
`lighting.ts`, `main.ts`, `web/tests/sky.test.ts`, `daylight.test.ts` and
`lighting.test.ts`; add `web/tests/window-daylight.test.ts` and
`web/proofs/window-daylight.js`.

**Consumes:** Expanded window lines, rear-shell descriptors and current daylight tuning.
**Produces:** Daylight exposure for every legal aperture with no nighttime window source.

- [ ] Extend `buildSkyExposure` with an optional window-line argument for rear
  shell apertures; default to an empty list for existing callers. Ordinary
  window lines already pass the sky because they are absent from solid edges.
- [ ] Seed each in-bounds rear-adjacent cell at `max(0, 1 - reachPerTile)` from
  virtual outside sky. Keep solid shell cells unseeded. Internal windows never
  seed light themselves. Use a bounded flood and only valid tile indices.
- [ ] Keep the current per-frame multiplier `interiorDaylightShade * sunStrength(ambient)`.
  Rebuild exposure on relevant lot revision/Load, not every frame. Use all covered
  window lines for lamp blocking, including rotated/multi-unit models.
- [ ] Tests use a sealed room control and exactly one changed aperture. Assert
  increased indoor exposure at noon, attenuation with distance, broader coverage
  for a three-unit span, and unchanged exposure through an interior-only window
  between two sealed dark rooms. Then add an external source and prove propagation.
- [ ] Pin the daily multiplier with the actual `ambientFor(tick, dayTicks)` API:

```ts
expect(sunStrength(ambientFor(0, 1440))).toBe(0);
expect(sunStrength(ambientFor(720, 1440))).toBe(1);
```

  Compare identical no-lamp rooms with and without
  windows: floor lighting must match. Check dawn/dusk continuity, Flat mode,
  reduced-motion override, lamp blocking and world-hash independence.
- [ ] Run the daylight/sky/lighting suites, then read actual GPU room pixels at
  noon, dusk and midnight. Removing the night multiplier or incorrectly seeding
  an internal window must fail the corresponding regression check.

**Exit:** Windows visibly admit outdoor daylight, but add no illumination at night.

## Task 10: Verify the combined game and document delivery

**Files:** Update `docs/specs/2026-09-22-windows.md`,
`2026-09-22-floors.md`, `2026-09-30-cutaway-walls.md`,
`docs/ARCHITECTURE.md`, `TECH_STACK.md`, `FEATURES.md`, `GAME-SYSTEMS.md`,
`TIM-TODO.md`, `player-visible-strings.md` and the new architecture README.
Add `docs/assets/review-evidence/architecture/verification.md` and a dated
`docs/changelog/` note when the implementation exists. Update lessons for material
corrections encountered, not speculative failures.

**Consumes:** Tasks 1 through 9. **Produces:** Verified local result, owner-visible
room evidence and an accurate implementation/delivery report.

- [ ] Run these final checks serially after the last code change. Record exact
  command, relevant output, exit code and PASS/FAIL/SKIPPED in the evidence file:

```powershell
python -B -m unittest discover -s assets/models/architecture -p 'test_*.py'
python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'
python -B assets/sprites/gen/build.py --check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -j 1 -- -D warnings
cargo test --workspace -j 1
wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm
npm --prefix web test -- --maxWorkers=1
npm --prefix web run typecheck
npm --prefix web run build
python check-doc-ids.py
node --test scripts/build-changelog.test.mjs
node scripts/build-changelog.mjs
git diff --check
```

- [ ] Use the repository's isolated proof harness for depth, blending and light
  pixels. Record device/browser and proof source hashes. Inspect actual game play
  separately; a hidden page or successful import is not visual acceptance.
- [ ] Review a furnished room containing all nine models, both axes, adjacent
  windows, a corner, T/cross junctions, front/interior doors, all floor coverings,
  a Sim behind cutaways, occupied furniture and build ghosts. Capture full/play
  walls, native/enlarged/fractional zoom, noon/dusk/midnight and Flat lighting.
- [ ] Load historical fixtures in an isolated storage context, then perform
  fit/replace/remove/paint/Room operations and save/load. Inspect both successful
  changes and rejected edits. Never use the owner's actual household as a fixture.
- [ ] Measure the same scene before/after using identical visible-browser warmup
  and sampling. Record atlas and depth-texture bytes, upload/draw counts and frame
  times. Investigate more than 10% p95 frame-time growth under repeated comparable
  samples before claiming the rendering cost is acceptable. Keep architecture
  rebuilds on layout changes and per-frame fading allocation-free.
- [ ] Obtain independent code and screenshot review, then show the final room
  and controls to the owner. List any unobserved device coverage or visual issue
  explicitly. Do not treat source hashes or passing unit tests as owner approval.
- [ ] Update stale art-pipeline text and remove the current placeholder-art
  descriptions only when their replacements work. Record all significant changes
  in the public changelog using the maintain-changelog skill. The plan alone does
  not justify a release note.
- [ ] If commit/push/merge is authorized, deliver the coherent batch. Do not wait
  for duplicate remote checks after their required local equivalents pass; report
  pending remote mutation work accurately and respect enforced protections.
  Verify merge state, synchronize this checkout and leave it clean. Deployment
  and live verification are separate claims.

## Completion criteria

1. All nine approved windows are selectable and recognizable at game scale;
   widths occupy exactly one, two or three wall units in either axis.
2. Walls have consistent thickness, joins, caps, reveals and baseboards; floor
   materials read as boards, tile or carpet without the old crossed grid.
3. A window never splits through selection, removal, another build tool, saved
   command replay or Load. Rear-shell openings work without off-lot movement.
4. Daylight reaches rooms through windows during the day and contributes exactly
   zero at night. Internal dark rooms do not invent their own sunlight.
5. Old saves and historical atlas records are preserved; all required local
   checks and actual GPU/played reviews have evidence.
6. The owner has seen the wall/floor room checkpoint and the final combined result.
   Approval of the original concept sheet is not claimed as approval of unseen pixels.

## Planning handoff

The owner selected sequential subagent implementation with independent reviews.
Use one implementing worker at a time in this worktree and fresh read-only reviewers.
Record execution in this plan's local ledger. Task 1 remains the first visual
checkpoint; its generated room has not yet received owner approval.
