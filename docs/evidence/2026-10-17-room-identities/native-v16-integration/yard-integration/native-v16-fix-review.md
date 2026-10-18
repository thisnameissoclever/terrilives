# Scoped native V16 repair review

Spec compliance: the original Important and Minor findings and all eight recorded full-suite failures are addressed at `477ca9ced027aad14d8c134435cb96d5bf5a3d76`. One Minor coverage requirement added by repair-brief item 6 remains open: explicit historical V15 writer checks after Confirm and Cancel.

Code quality: the scoped production repair is approved. No Critical or Important issue or direct runtime regression was identified. Complete task acceptance still requires the small test extension and the parent's remaining gates; this is not a full-suite, release or UI verdict.

## Original findings

1. **Addressed: stale current header expectation.** `crates/terri-wasm/src/lib.rs:4597-4601` now explicitly expects 16 and names schema 16. The full V16 equality, load and 300-update continuation assertions remain. The corresponding focused test passes. The literal is independent of the writer, so reverting the production header to 15 would fail it.

2. **Addressed: omitted public V15 baseline writers.** `crates/terri-sim/src/build_transaction/cases.rs:450-470` now captures fallible V15, checks convenience V15, separately names V16, and checks all three during the edited draft. Removing the committed-baseline branch from `try_save_snapshot_v15` would expose the draft's unsupported Outside state and fail the expected successful V15 result. This closes the original omission. The expanded lifecycle requirement is separately recorded below.

## Eight original failures

| Full01 failure | Judgment and immutable repair evidence | Concrete assertion or mutation assessment |
| --- | --- | --- |
| `placement_reseeds_only_edited_furniture_preserving_fractional_walking_sample` | Addressed by `crates/terri-sim/src/build_transaction/ordinary_runtime.rs:50-75`. Candidate discontinuity markers are captured before adoption consumes them, resolved into the installed world and restored for the next live render sync. The original placement test is unchanged by the repair diff and passes in focused02. | Removing the preserved marker restoration reproduces full01's old furniture sample `[0.0, 0.0]` instead of `[0.0, 1.0]`. Broadly reseeding render history would conflict with the original untouched walker's fractional-sample assertions. The next sync consumes the marker set; the repair does not introduce persistent per-frame snapping. |
| `a_wall_cannot_come_between_a_sim_and_what_it_is_using_or_who_it_is_talking_to` | Addressed at `crates/terri-sim/src/placement/wall_tests.rs:297-378`. Furniture InUse coverage remains. Each social direction starts a fresh native ordered conversation, proves admission and unchanged intended positions, and passes complete V16 admission before the original refusal checks. Distant-wall success and subsequent V16 admission remain. | Removing either direction's social InUse guard permits its crossing wall and fails the expected refusal. Rejecting every wall fails the distant positive control. A fabricated bare Target or incomplete ownership cannot pass the new precondition roundtrip. The test no longer relocates an already active conversation by hand. |
| `prior_openness_advances_only_on_ticks_and_resets_on_load` | Addressed at `crates/terri-sim/src/portals.rs:616` by changing only current continuation capture/load to V16. | Setting previous openness to current on every paused sync fails the retained equality with the pre-tick sample. Failing to reset previous openness on external Load fails equality with loaded current openness. More than 20 observed transitions prevent an inert fixture from passing. No production portal code changed. |
| `direct_legacy_recipe_loads_gain_origins_before_current_resave` | Addressed at `crates/terri-sim/src/recipe_actions/legacy_migration_tests.rs:9-69`. Legacy geometry/reference semantics are installed before spawning or ticking. Each real V1-V5 writer still feeds its matching historical loader. Origin inspection uses a complete-current field view; current V16 reload and 12 updates remain positive. | Omitting legacy origin reconstruction fails the required single fridge/grab_snack origin or strict current reload. Retuning creation/tick behavior to match a new expected snapshot is not part of this repair. The test still exercises historical admission rather than retagging a current payload. |
| `mixed_legacy_recipe_and_projection_actor_keep_their_distinct_contracts` | Addressed at `legacy_migration_tests.rs:95-139`. Exact original V5 field equality remains, read through the full-current view. The skeleton still lacks Needs and Origin; only the executable recipe gets an origin. Added current admission now explicitly rejects with `InvalidValue` and preserves destination V16 state/hash. | Migrating an origin onto the skeleton fails the absent-Origin and origin-count assertions. Weakening current origin coverage makes the required rejection fail. Mutating the receiver before rejection fails exact state/hash checks. The fixture is deliberately a projection-only synthetic actor, not evidence that a playable historical household cannot migrate. |
| `shipped_fridge_reach_survives_loads_before_and_during_the_step` | Addressed at `crates/terri-sim/src/render_buffer/fridge_reach_projection_tests.rs:393-427` with complete V16 capture/load and an added exact state comparison. Existing pre-step/during-step branches, FETCH action, progress 500, countdown and eventual step transition remain. | Dropping a request/book/room companion on current reload fails full snapshot equality. Losing active reach state fails FETCH/progress; stopping work advancement fails the retained bounded `finish_fetch` progression and completion assertions. No production fridge logic changed. |
| `save_bytes_round_trip_and_continue_the_running_sim` | Addressed at `crates/terri-wasm/src/lib.rs:4597`, also original finding 1. | Wrong public header fails explicit 16; lost persisted companions fail V16 equality; divergent post-load execution fails the retained 300-update comparison. |
| `creator_boundary_round_trips_exact_values_and_correlated_results` | Addressed at `crates/terri-wasm/src/character_tests.rs:44-47`. Only the stale version literal changes. | Wrong version fails explicit 16. Wrong request correlation, edited name or body height fails the original exact result/value assertions. Non-idempotent loading fails the complete saved-byte comparison. |

## Direct regression checks

1. **Marker lifetime and entity identity.** The runtime patch restores only the captured marker collection and only after successful adoption. It does not replace LotEditState receipts/results, reset every entity's history or copy the old source-world request resource. It resolves marker indexes against the installed world instead of retaining raw Entity handles (`ordinary_runtime.rs:65-75`), following the existing row/socket remapping policy. The inspected adoption sequence transfers the validated candidate world; it does not spawn replacement identities between marker capture and installation. Failed adoption retains the prior buffers and does not install candidate markers.

2. **Marker consumption and external Load.** Named dependency check: inspected the existing frozen e08 adoption/sync code because the changed install function crosses that boundary. `crates/terri-sim/src/lib.rs:1605-1625` performs candidate sync and preserves the separate external-load reset behavior. `lib.rs:2453-2458` consumes discontinuities with `mem::take`; `lib.rs:3259-3264` reseeds only affected rows. The repair adds no external-load call-site change. Focused02's six ordinary-runtime controls and three paused/socket/reading controls are adjacent evidence, not a replacement for the parent full run.

3. **Historical versus current recipe contracts.** Named dependency check: inspected the already frozen e08 `crates/terri-sim/src/recipe_actions.rs:289-299,389-391,475-498`, unchanged in this repair. Historical origin migration scopes itself to Agent + Needs + ChainState; current restoration requires coverage of every ChainState. That source contract supports the final mixed-skeleton negative assertion. Focused01's newly added positive-current expectation contradicted this existing distinction. The fix changes that new expectation, without relaxing either reader or removing the positive executable-recipe controls.

4. **Partial-snapshot avoidance.** Portal/fridge cases now exercise complete current persistence because their subject is current runtime continuation. The historical recipe cases retain V1-V5 input/output pairs. The mixed test compares the entire historical V5 field payload, not a hand-selected subset; current wrappers retain the outer companions. No source hunk drops companions or adds fallback decoding.

## Remaining findings

### Critical

None.

### Important

None.

### Minor

1. **Expanded lifecycle writer coverage remains incomplete.** Repair-brief item 6 requests V15/V16 checks after draft, Confirm and Cancel. The updated all-writers test ends after its first edited-draft checks (`crates/terri-sim/src/build_transaction/cases.rs:437-471`). Existing lifecycle controls compare V16, so they do not independently prove the public historical V15 route after baseline replacement or later cancellation. This is a coverage gap, not a demonstrated persistence defect.

   Smallest repair: extend a representable-baseline lifecycle case to record an independently admitted baseline's fallible V15 result and V16 snapshot, then check the same results through a later draft and Cancel. Check the convenience V15 writer only when that baseline is representable. For a confirmed baseline containing unsupported Outside duties or stable history, expect the historical writer's refusal instead of assuming every V16 household can produce V15. A separate representable confirmed batch can test successful convenience output after Confirm. Do not weaken historical projection or drop new duties to make this assertion pass. The parent acknowledged this narrow follow-up and plans a test-only extension after the frozen full run.

## Evidence and scope

1. Read the full 16,330-byte repair diff once. Its SHA256 matches package value `5dc21f4216451dd1dac357a627f7a1eb828bbf0096c1b20cb6dd952acb226567`; all eight frozen source file hashes match the package. Full functions were read only where the short hunks cut off the marker, wall, portal, recipe, fridge or character assertions. The original review, scoped brief, repair report and named dependency snippets supplied context. No untouched subsystem was broadly reviewed.

2. Original full01 is retained red evidence at e08: workspace exit 101, 1602 simulation passes/six failures and 297 Wasm passes/two failures. Its elapsed time is 1473.43 seconds. Clippy did not run after that failure. The exact failure contexts correspond to the eight rows above.

3. Focused01 has aggregate exit 1 and a failing mixed-skeleton positive-current assertion. Its completed flag is not a pass. Focused02 records 12 groups, all exits zero, totalling 19 passes and zero failures. Build02 exited zero before execution. The aggregate wrapper also exited zero. Final source fingerprint is `895d643ae4b8d7a144fc87bf12e3fe28ce221f6a308c7f65e408fd136f43a3f4`; receipt artifact hashes are `54dd9830ae24a80fa0151639024ab0b6de718b890ae6344bec9f0712059b6cbf` for simulation and `f06926ef6e807390794cfb6f910aae97c9ba0edb9729032119b6fe9f73e3e8a6` for Wasm boundary tests. These are native executables, not generated current browser Wasm.

4. This reviewer ran no tests/builds/Cargo/browser/Git operations and delegated nothing. Only this report was written. Source was read from frozen packages, not a changing working tree. The parent owns full02 session 44885, strict clippy and later fault/restoration work. Their pending outcomes are not accepted here. R6 actual-module/storage/release-Wasm evidence, R7 UI behavior and final whole-branch review remain separate gates.

**Next steps**: Preserve the completed full-run evidence, add the narrow V15 lifecycle coverage after the parent's source freeze ends, run its targeted check and obtain scoped re-review. No user action is needed.
