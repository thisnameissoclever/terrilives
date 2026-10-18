# Room Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Give every enclosed room a saved identity and editable name, extend cleaning to outdoor flooring/surfaces, and commit room-dependent consequences only with the complete Build batch.

**Architecture:** One shared architectural map supplies room membership. A simulation-owned Build transaction retains a valid baseline and accepted-command journal, prepares a private candidate, reconciles final room changes once, and adopts only a fully validated candidate. A new save envelope preserves the published readers and explicitly distinguishes legacy room seeds from current stable IDs.

**Tech Stack:** Existing Rust simulation and WebAssembly boundary; TypeScript and DOM controls; existing postcard serialization, Vitest, and browser verification tools. No new dependencies.

**Spec:** [Room identity, naming, and cleaning](../../specs/2026-10-17-room-identities.md). Read it before this plan. Apply the separate [action-button color plan](2026-10-17-action-button-colors.md) to the new controls.

**Published-schema integration:** Apply [V16 integration](2026-10-17-room-v16-integration.md) before releasing browser integration. It preserves published V15 conversation commitments, native draft ownership and the existing exit dialog while retaining the approved repeated-batch naming flow.

## Global constraints

1. Automatic room changes and their gameplay consequences become permanent only when the player confirms the complete build.
2. An open-plan space is one room when no architectural boundary separates it.
3. Outdoor flooring and applicable outdoor surfaces receive cleaning duties. Grass does not.
4. Freeze every published V1-V15 wire layout and command discriminant.
5. No dependencies or save resets are authorized.
6. Keep review videos out of the repository.
7. Do not implement a second camera, arbitrary-polygon construction tool, manual object-room override, or named outdoor zoning system.

## Review focus

1. Remove/re-add a wall while a cleaner is suspended: names, owners, progress, saved decisions, and random streams must survive. Owned by Tasks 4 and 5.
2. Buy north/west land before renaming or partitioning: translate coordinates once and keep room/object identities. Owned by Tasks 2 and 5.
3. Load old room history after its seed no longer identifies live geometry: preserve history without assigning it to an unrelated room. Owned by Task 3.
4. Remove outdoor covering over dirt, then save/reload: retain dormant dirt and exclude grass from active patches. Owned by Task 4.
5. Return from review, change walls, then submit an old review token: refuse without committing a different arrangement. Owned by Tasks 5 and 7.

## File responsibilities and implementation order

| Area | Files |
| --- | --- |
| Stable room and review types | New `crates/terri-core/src/rooms.rs`; export from `crates/terri-core/src/lib.rs` |
| Shared geometry, identity matching, query cache | Existing `crates/terri-sim/src/room_regions.rs`; new `crates/terri-sim/src/rooms/{mod,matching,tests}.rs` |
| Native draft/candidate lifecycle | New `crates/terri-sim/src/build_transaction.rs`; integrate `lib.rs`, `systems/lot_edit.rs`, placement/book/land paths |
| Historical/current persistence | New `crates/terri-core/src/save_v16.rs`, `crates/terri-sim/src/save/v16.rs`, `crates/terri-sim/src/rooms/migration.rs`; preserve published V15 request persistence and earlier readers |
| Cleaning and consumer reconciliation | `chores/{mod,board,groups,work,patches,grime,save}.rs`, `domestic.rs`, `dining.rs`, privacy/interpersonal/affinity/social consumers, `land.rs` |
| Browser persistence | `web/src/storage/{save-header,save-worker,save-store}.ts`; frozen V14/V15 workers and storage tests |
| Runtime/browser bridge | `crates/terri-wasm/src/lib.rs`, `web/src/bridge.ts`; new `web/src/ui/room-selection.ts`, `room-review.ts` |
| Build interface | `web/index.html`, `web/src/main.ts`, `web/src/ui/{build-session,build-tools,room-tool,room-tool-controls}.ts`, `web/src/ui/build-controls.css` |

Keep room matching, history conversion, and transaction orchestration separate. Do not expand `main.ts` into the implementation owner. Tasks 1-3 establish representation; Task 4 supplies final-state reconciliation; Task 5 establishes commit semantics; Tasks 6-7 expose them; Task 8 verifies the integrated result. This sequence is not permission to publish an intermediate build with mixed room meanings.

### Task 1: Establish shared architectural geometry

**Files:** `room_regions.rs`; new `rooms/mod.rs` and `rooms/tests.rs`; legacy tests in `room_regions.rs`; shared boundary helpers in `lot_frame.rs`/`placement/walls.rs` only where needed.

**Interfaces:** Define `RoomTopology { width: u32, height: u32, cells: Vec<TopologyCell>, components: Vec<RoomComponent> }`, `TopologyCell::{NotFloor, Outside, Enclosed(u32)}`, and `RoomComponent { anchor: (u32,u32), cells: Vec<u32> }`. `RoomTopology::from_world(&World) -> Result<RoomTopology, RoomError>` is the one geometry calculation. Its component indices are temporary, never persistent identities.

- [ ] Add `irregular_rooms_and_three_sided_yard` asserting seven unequal enclosed components, a single connected open-plan component, and outside on all unsealed sides.
- [ ] Add cases for a doorway with open/closed animation, windows, absent wall segments, furniture occupancy, explicit plot-edge walls, the implicit rear shell, the frozen legacy door gaps, and custom legacy gaps.
- [ ] Run `cargo test -p terri-sim rooms::tests` and the existing `room_regions` tests. Require the new outside/addition assertions to fail on the old detector.
- [ ] Implement a bounded cardinal flood fill with perimeter escape classification. Reuse the architecture's boundary representation; do not use furniture-blocked movement cells as the room floor mask.
- [ ] Run both test groups to passing. Remove doorway blocking and the visited guard separately in isolated mutation checks; require failure and restore source bytes exactly.
- [ ] Commit the geometry work only after reviewing its public/internal call sites; do not switch every consumer before current-save support exists.

### Task 2: Add stable identity, matching, and names

**Files:** new `terri-core/src/rooms.rs`; `terri-core/src/lib.rs`; `terri-sim/src/rooms/{mod,matching,tests}.rs`; `land.rs`.

**Interfaces:** Define `RoomId(pub u32)` with validated nonzero construction; `RoomSelection::{Outside, Room(RoomId)}`; `RoomRecord { id: RoomId, name: String, anchor: Option<(u32,u32)> }`; `SavedRooms { outside_name: String, next_id: u32, next_default_name: u32, records: Vec<RoomRecord> }`; and runtime `RoomMap { topology: RoomTopology, component_ids: Vec<RoomId> }`. `match_rooms(before: &RoomMap, after: &RoomTopology, translation: (i32,i32)) -> RoomMatchProposal` computes sparse overlap without changing state. `resolve_rooms(proposal: &RoomMatchProposal, choices: &RoomChoices, saved: &SavedRooms) -> Result<ResolvedRooms, RoomError>` returns updated records and old-to-new correspondence.

`RoomChoices` contains inheritance choices and names keyed by final component anchor. `ResolvedRooms` contains the current `RoomMap`, updated `SavedRooms`, and explicit retired/new mappings. Treat these new types as one contract shared by matching, transaction, migration, and review tasks.

- [ ] Add tests for exact matches, resize, split, merge, equal-overlap ties, many-to-many repartition, lost enclosure, and new rooms. Assert exact inherited IDs and default names, not just equal hashes.
- [ ] Add name tests for blank/control-character refusal, 48 versus 49 Unicode scalars, emoji, duplicate custom names, generated-name collisions, and text containing markup characters.
- [ ] Test the single Outside selection/name (ID zero), all disconnected outdoor flooring, and no duty for zero eligible area.
- [ ] Add north/west translation tests asserting unchanged room IDs/names/default-name allocator with translated anchors and geometry. Preserve object-index namespaces.
- [ ] Run `cargo test -p terri-sim rooms` and require the new identity tests to fail before implementation.
- [ ] Implement the matching order and validation from the spec. Reserve ID zero for outside; check allocator overflow. Retain bounded retired history records, without saving full footprints per object.
- [ ] Change `land.rs` to translate geometry and tile-indexed state while preserving current stable room references. Preserve the legacy translation path for old-schema validation.
- [ ] Run tests and targeted matching mutations; commit the identity layer.

### Task 3: Add current save semantics and historical conversion

**Files:** new `terri-core/src/save_v16.rs`; `terri-core/src/{lib,save}.rs`; new `terri-sim/src/save/v16.rs`, `rooms/migration.rs`; existing published `save/v15.rs`, `save.rs`, `save/architecture.rs`, `save/v13.rs`, `save/v14.rs`, `domestic.rs`, `dining.rs`, `chores/save.rs`, `lib.rs`; corresponding save tests.

**Interfaces:** Define `SaveSnapshotV16 { legacy: SaveSnapshotV15, rooms: SavedRooms }`, retaining the exact published V15 conversation envelope. Define `RoomReferenceMode::{Legacy, Stable}` and carry the mode plus validated registry through lower-level restoration. `save::v16::capture(&Sim) -> SaveSnapshotV16` and `save::v16::restore(SaveSnapshotV16, &'static ContentPack, Carried) -> Result<Sim, SaveError>` are the current capture and private-candidate constructor. Add public `Sim::save_snapshot_v16` and `Sim::load_snapshot_v16` following the existing candidate-before-adoption pattern. Keep published V15 APIs and add a fallible historical projection where required.

Convert existing visit/opportunity room fields in place after verifying membership in the original source region. Preserve their existing noticed/known sets and pending decision. The current containing room ID, or zero for outside, supplies the new reference. Do not add duplicate saved visit metadata. Existing movement/reset rules own its lifetime.

- [ ] Freeze authentic V14 save bytes before changing the writer. Include active cleaning, dirty surfaces, suspended work, queued chore commands, domestic memory, careers, books, and purchased land. Retain the historical binary/source identity in dated evidence.
- [ ] Retain authentic published V15 queued, waiting, approaching, talking and suspended conversation evidence, with exact order ownership and original producer acceptance.
- [ ] Add failures for duplicate/missing room records, zero live IDs, bad anchors, invalid allocators, dangling visit references, truncated/trailing bytes, and unsupported versions. Assert failed adoption leaves the prior world untouched.
- [ ] Add migration tests using both legacy room maps. Assert preserved names where recoverable, owners, dirt, progress, queue order, memory sets, outcomes, funds, careers, and every random stream. Test an unrecoverable retired seed without attaching it to a live room.
- [ ] Save and reload a migrated continuing visit before its next boundary crossing. Assert unchanged noticed dishes/pending decision and no duplicate resentment or cleanup roll, then verify the ordinary next crossing/reset works.
- [ ] Run `cargo test -p terri-sim save` and the existing domestic/dining/chore-save groups. Require current stable-ID validation and exterior dirt cases to fail before adding support.
- [ ] Implement the new outer envelope without changing published V1-V15 layouts. Validate old references under old semantics first; install current room records before current dependent-state validation. Convert only room-bearing chore kinds and the two queued chore-command variants. Preserve V15 waiting-target stripping/restoration and request ownership.
- [ ] Make historical capture helpers explicitly project stable IDs back to representable legacy references or refuse the projection. Never emit mislabelled historical payloads; update fixture construction sites deliberately.
- [ ] Hash saved names, IDs, allocators, and retired records. Keep existing visit/opportunity hashing. Do not hash derived geometry caches independently.
- [ ] Run native historical/current tests plus targeted mutations against version/mode selection and transactional refusal. Commit the persistence layer. Recheck schema allocation at integration; use the next unused schema if 15 was claimed elsewhere.

### Task 4: Reconcile duties and extend outdoor cleaning

**Files:** `chores/{mod,board,groups,work,patches,grime,save,consequences}.rs`; `domestic.rs`, `dining.rs`, `systems/interpersonal.rs`, `relationship_dynamics.rs`, `affinity.rs`, `social_company.rs`, privacy consumers found by `rg`; floor material resolver/content metadata only if needed.

**Interfaces:** Define `CleaningArea::{Room(RoomId), Outside}`; `cleaning_area_at(&World, tile: (i32,i32)) -> Option<CleaningArea>` returns only eligible floor targets. Object surface membership uses architectural location independently of the underlying floor's cleanability. `RoomChangeContext::capture(&World) -> Result<RoomChangeContext, RoomError>` retains the baseline room map and sorted object IDs for each grouped surface duty before edits. `reconcile_committed_rooms(candidate: &mut Sim, before: &RoomChangeContext, resolved: &ResolvedRooms) -> Result<DutyChangeReport, RoomError>` is called exactly once during candidate preparation. Its report supplies the review's ownership and work effects. The old map alone cannot reconstruct the original group after a counter moves; use the retained object-ID membership.

- [ ] Append Outdoor patio as ID 4 with distinct paved art, preserving existing IDs, historical content/save compatibility, and unchanged enclosure. Verify placement/removal and cleaning.
- [ ] Add tests for outdoor Boards/Tiles/Carpet, unpainted grass, street exclusion, enclosed grass, tables on grass, disconnected patios, unreachable dirt, and dormant dirt after covering removal/replacement/save-load.
- [ ] Add ownership tests for unchanged rooms, new rooms with automatic assignment on/off, floor split/merge, moved surface groups, combined same-kind groups, and retired duties. Assert exact owners and unchanged existing daily decisions.
- [ ] Add tests for in-progress patch preservation, required replanning, blocked contact, unrelated path ownership, and no fabricated credit/neglect after room removal. Preserve already cleaned quantities.
- [ ] Add stationary-occupant privacy and domestic-memory tests around wall edits and migration; actual later movement must still trigger entry. Keep shared-device cross-room tests passing.
- [ ] Run `cargo test -p terri-sim chores` and relevant room-consumer groups to establish the failures.
- [ ] Implement resolved-material eligibility without changing existing grime probabilities or durations. Add one outside-floor target and outside surface groups. Current dirt validation permits in-bounds dormant dirt; active work validation requires eligible reachable targets.
- [ ] Replace duplicated room geometry calls with the shared map. Preserve intentional cross-room/proximity behavior and avoid treating Outside as a shared private room. Remove the duplicate domestic flood fill only after its migration reader is frozen.
- [ ] Produce review effects from the candidate: unchanged, reassigned, newly automatic/unassigned, or retired duties. Preserve saved episode history and task ownership.
- [ ] Run tests, conservation mutations, and native paused-command integration tests. Commit final reconciliation and outdoor eligibility.

### Task 5: Make Build a native transaction

**Files:** new `build_transaction.rs`; `terri-sim/src/lib.rs`, `systems/lot_edit.rs`, `placement.rs`, `placement/sale.rs`, book commerce/movement paths found by impact scan, `land.rs`; new transaction test module.

**Interfaces:** Define nonserialized `BuildTransaction` owning baseline `SaveSnapshotV16`, accepted `Vec<BuildJournalEntry>`, pending names, monotonically changing revision, and optional prepared candidate. A journal entry stores the accepted typed command and expected placement/purchase result. Define `BuildToken { session: u64, revision: u64, preparation: u64 }` and `BuildCommitError` with typed reasons.

Add `Sim::begin_build() -> Result<(), BuildCommitError>`, `Sim::stage_room_name(RoomSelection, String) -> Result<(), BuildCommitError>`, `Sim::prepare_build_commit(RoomChoices) -> Result<BuildReview, BuildCommitError>`, `Sim::commit_build(BuildToken) -> Result<(), BuildCommitError>`, `Sim::discard_build_review() -> Result<(), BuildCommitError>`, `Sim::cancel_build() -> Result<(), BuildCommitError>`, and `Sim::end_build() -> Result<(), BuildCommitError>`. Cancel restores the baseline while remaining in paused Build. End restores it and ends the transaction so the shell may resume its prior speed. Discard invalidates the prepared token/candidate without changing the draft. `BuildReview` contains the token, change groups, proposed names, area changes, and duty effects; it never exposes a mutable candidate. Current persistence capture returns the committed baseline while active; internal draft inspection uses a separate nonpersistent projection.

- [ ] Add `temporary_wall_removal_preserves_suspended_work` asserting exact names, allocators, owner, task cursor/cells/remaining ticks, daily decision, noticed dishes, and all random streams after remove/re-add and Confirm.
- [ ] Add tests for cancel, consecutive confirmed batches, split/remerge before Confirm, unchanged command drains, failed replay, failed final validation, stale tokens, review Back, and repeated submit. Assert failure retains both baseline and editable draft.
- [ ] Assert Cancel remains paused/active, Exit ends Build only after successful restoration, and Back to build makes the old review token unusable without cancelling edits.
- [ ] Add mixed-journal tests for floor edits, object moves/recolors, buys/sales, books, and land translation. Assert candidate authored state/funds/identities match the visible draft. Verify rejected commands consume no hidden identity/random state.
- [ ] Add an unchanged-wall case that moves a counter between rooms and another that paves grass. Assert unchanged room IDs alongside the required changed surface/outdoor duties; the no-net-change shortcut must not discard those edits.
- [ ] Run `cargo test -p terri-sim build_transaction` and require the current early-pruning path to fail the preservation test.
- [ ] Centralize begin, recording, preparation, adoption, and cancel in the transaction module. Reserve journal capacity before mutation. Record accepted actions only. Reject unrelated gameplay commands and prevent ticks while active, including native callers.
- [ ] Classify every edit hook: retain geometry checks, accounting, contacts needed for placement, receipts, and coordinate translation; defer topology-driven room/chore/visit consequences. Keep active-use sale/move refusals. Do not globally disable validation or catch-and-ignore pruning errors.
- [ ] Prepare a private candidate from the baseline, capture Task 4's RoomChangeContext before replay, replay accepted actions under transaction rules, then invoke final reconciliation. Validate a current snapshot of the candidate before storing it for adoption. Apply once only if token and choices still match.
- [ ] Ensure successful Load starts a fresh baseline without an old journal, rejected Load changes nothing, and Cancel restores portals/render resources using existing adoption hooks.
- [ ] Run transaction, placement, book, and land tests; mutate the deferral and stale-token guard separately; commit the transaction boundary.

### Task 6: Expose rooms and transactions; protect browser saves

**Files:** `crates/terri-wasm/src/lib.rs` and current save boundary tests; `web/src/bridge.ts`; `web/src/storage/{save-header,save-worker}.ts`; `web/tests/{save-worker,save-store,legacy-save,persistence-controller}.test.ts`; frozen `web/tests/fixtures/v14-worker/` and new authentic `v15-worker/`.

**Interfaces:** Expose existing-pattern primitive/typed-array methods rather than adding JSON dependencies. Room summaries use rows `[room_id, anchor_x, anchor_y, area, flags]` plus `room_name(room_id) -> String`; ID zero denotes Outside in this presentation. Expose `room_tiles(room_id) -> Vec<u32>` and a single revision to invalidate summaries/highlights. The browser wraps these as `RoomSummary { id, name, anchor, area, outside }` and validates row lengths.

These selection methods report the confirmed map, translated into the current draft land frame. They do not expose newly enclosed provisional rooms. Final review components are addressed by their anchor plus the preparation token through `RoomChoices`; IDs are allocated only in the prepared candidate and become live only on adoption.

Transaction bridge methods mirror Task 5. Encode tokens as three u64 values with the project's existing exact-integer wire helpers; never round them through JavaScript numbers. Review transport uses postcard bytes and an explicitly versioned record layout matching `BuildReview`/`RoomChoices`; define the TypeScript codec alongside its Rust byte-contract tests. Freeze new layout/tag values when first published.

- [ ] Add real WebAssembly boundary tests for names, provisional review choices, stale tokens, current save bytes, and old reference conversion. Keep published command bytes unchanged.
- [ ] Preserve V14 recovery and its immutable worker. Add V15 recovery and an authentic published V15 worker. Test V16 writes over both older formats, failed backup writes, New game recovery retention, and cached old-worker refusal.
- [ ] Test manual Save, visibility-triggered saving and autosave while the draft is dirty or a review is open. Each must write baseline bytes, never the draft. Verify that graphics recovery preserves the native handle and transaction.
- [ ] Run `cargo test -p terri-wasm` and `npm --prefix web test -- --maxWorkers=1` for the storage/persistence test files.
- [ ] Implement bridge codecs and native committed-byte routing. Update native/browser version markers together. Preserve exact historical recovery names and older fixtures.
- [ ] Rebuild WebAssembly with `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, then run the browser storage tests against those actual bytes. Commit the complete persistence boundary.

### Task 7: Add room selection and final review

**Files:** new `web/src/ui/room-selection.ts`, `room-review.ts`; `build-session.ts`, `build-tools.ts`, `room-tool.ts`, `room-tool-controls.ts`, `build-controls.css`, `main.ts`, `web/index.html`; new `web/tests/room-selection.test.ts`, `room-review.test.ts`; existing build-session and land tests.

**Interfaces:** `RoomSelection` owns selection and pending name editing, and supplies the existing `TileHighlight` type. `RoomReviewController` owns grouped review choices and token submission; it has `open(review: BuildReview): void`, `back(): void`, and `confirm(): Promise<boolean>`. The controller delegates all world decisions to `RoomBridge`. `BuildSession` keeps preview settlement/hooks but delegates baseline and transaction lifecycle to native methods.

- [ ] Add tests for click/dropdown selection, furniture/book picking precedence, 48-scalar names, duplicate names, selecting another room without losing text, switching to Walls and back, Enter not committing, and Cancel after a confirmed prior batch.
- [ ] Test new enclosure, Confirm, automatic `Room N`, rename without leaving Build, and a second Confirm. While walls are pending, assert that selection still refers to the confirmed map and shows the pending-boundary message.
- [ ] Add review tests for multiple changes in one batch, inherited-name reassignment after a split, custom name preservation when choosing a merge survivor, lost enclosure/Show opening, retained edits while changing review rows, Back to build, stale tokens, and failed commit.
- [ ] Run `npm --prefix web test -- --maxWorkers=1 tests/room-selection.test.ts tests/room-review.test.ts tests/build-session.test.ts tests/build-session-state.test.ts tests/land-tool.test.ts` and require new behavior failures before implementation.
- [ ] Add Select rooms / Build room modes within the existing Room destination, rename its navigation label to Rooms, and retain all six tools including Land. Keep drag-to-pan and existing rectangle construction unchanged.
- [ ] Render one name field and room/outside dropdown; reuse arbitrary tile highlights. Build the grouped review with Back to build and Confirm changes. Use the shared action-intent attributes from the color plan.
- [ ] Preserve compact dock/navigation/footer behavior and focus during reparenting. Keep text input shortcuts isolated from world commands. Distinguish the Buy catalog's room-type filter from actual room selection.
- [ ] Run targeted interface tests and `npm --prefix web run typecheck`. Commit UI integration after browser review.

### Task 8: Verify the complete behavior and prepare delivery

**Files:** relevant existing docs, `docs/glossary.md`, `docs/player-visible-strings.md`, build/cleaning/floor/land specs; dated evidence under `docs/evidence/2026-10-17-room-identities/`; dated player changelog entry when delivered.

- [ ] Play the real game in an isolated browser with ordinary needs/autonomy. Exercise the seven-room irregular fixture and a retained real historical household. Watch an indoor and outdoor cleaner physically complete work.
- [ ] Exercise the full sequence: rename, change tool, temporarily remove/restore a wall, Confirm, split, review Back, edit again, Confirm changes, merge, lose enclosure, buy land, cancel a later batch, save, reload, and resume active work. Record exact source revision and test data.
- [ ] Check desktop, phone, short landscape, enlarged text, and on-screen keyboard behavior. Inspect the actual captures and obtain independent visual review. Retain screenshots and written observations, never review videos.
- [ ] Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, the WebAssembly build command from Task 6, `npm --prefix web run typecheck`, `npm --prefix web test -- --maxWorkers=1`, and `npm --prefix web run build`. Run heavy commands sequentially on the shared host.
- [ ] Run targeted mutations for identity preservation, commit deferral, outside eligibility, current-schema mode, and failed-adoption atomicity. Record killed mutations and byte-identical restoration. Distinguish this evidence from a full remote mutation sweep.
- [ ] Update documented behavior, glossary terms, and public notes. Correct older build docs that enumerate only five tools; preserve historical evidence. Run `python check-doc-ids.py`, `node --test scripts/build-changelog.test.mjs`, and `node scripts/build-changelog.mjs`.
- [ ] Obtain a fresh complete-change review. When delivery is authorized, apply the changelog skill before each push and before merge, verify remote merge state, synchronize this checkout, and report deployment separately. Passing duplicate remote checks are not an extra wait gate under the project's delivery rule.

## Planning evidence and boundaries

This plan is based on source inspection at `684707b3917b73d8e2fa5d65a58adf6691f0ca63`. The reviewed mockups establish interaction direction; they do not prove game integration or save migration. Implementation, native tests, real-game browser verification, and publication remain execution work. The independent button-color plan can be implemented first; do not ship room semantics piecemeal.
