# Task 5: native Build transaction

Status: source checkpoint `52f8eb7b5` reviewed with two Important lifecycle findings. Its final placement gate failed 14 purchase/sale cases (127/141 passed); later combined gates did not run. Fix round 1 committed as `3524cab52` and accepted by scoped re-review. The repaired broad run passes placement and books, then stops on 27 reading failures. R6 implementation and fault instrumentation remain held; source is unchanged.

## Interfaces

Public module: `terri_sim::build_transaction`; no dependency, wire-format or generated-Wasm change.

1. Exact requested lifecycle: `begin_build()`, `stage_room_name(RoomSelection,String)`, `prepare_build_commit(RoomChoices) -> BuildReview`, `commit_build(BuildToken)`, `discard_build_review()`, `cancel_build()`, `end_build()`, all returning typed `Result` values. Cancel retains active paused Build; Exit restores before ending it.
2. `BuildToken { session:u64, revision:u64, preparation:u64 }`. Session IDs come from a checked nonserialized process-local AtomicU64 sequence, distinct across Sim instances. Native load/cancel/end/reentry cannot resurrect tokens. No RNG, saved field or target flag changes. Normal release-Wasm and Chrome proof remains R6/R8 work.
3. `BuildCommitError::{NotActive,AlreadyActive,AllocationFailed,CounterExhausted,InvalidRoom,InvalidName,Room(RoomError),ReplayMismatch { entry },DraftMismatch,Validation(SaveError),StaleToken,CommandNotAllowed}`.
4. `BuildReview { token, groups:Vec<BuildGroupReview>, rooms:Vec<BuildRoomReview>, retired_names:Vec<(RoomId,String)>, duties:DutyChangeReport }`. `BuildGroupReview { change:RoomChangeGroup, former_tiles:Vec<(u32,u32)>, openings:Vec<WallLine> }`. Former tiles use final coordinates; openings are actual removed boundary segments.
5. `BuildRoomReview { selection, anchor:Option<(u32,u32)>, name, previous_name:Option<String>, previous_area:u32, area:u32 }`. One Outside row has no anchor. Areas are physical membership, not eligible cleaning area.
6. `build_component_tiles(token,anchor) -> Result<Vec<(u32,u32)>,BuildCommitError>` and `validate_build_token(token) -> Result<(),BuildCommitError>` share the full token and unchanged raw-draft check. Commit validates before any mutation and never drains queued commands.
7. `build_rooms() -> Result<Vec<BuildRoomReview>,BuildCommitError>` exposes translated confirmed membership and pending names. `build_active()`, `build_revision() -> Option<u64>`, `rooms_revision() -> u64`, and `take_build_error()` provide session/cache/error state. Room-view revision is checked, nonserialized and monotonic across edits/names/adoption.
8. Accepted journal entries contain the typed command, expected receipt and `settle_inventory` marker. The marker preserves end-of-drain automatic shelving, including two queued transfers that free then refill a shelf. Rejected feedback sequence numbers are transient and do not enter persistence or replay.

## Ownership and behavior

The native resource owns the sole valid baseline, accepted journal, pending names and private prepared candidate. Journal capacity and counters are checked before mutation. All public snapshot writers use the baseline during Build; raw internal projection is separate. Prepare captures the complete RoomChangeContext before replay/land translation, compares replay with the visible draft, resolves against baseline records in the baseline coordinate frame, reconciles final consequences, and validates through strict V15 restoration. No-net comparison includes geometry, objects, materials, money, books and land; unchanged walls alone cannot discard moved-counter or paving changes.

Ordinary Sim construction also uses a private validated candidate. Prior ordinary commands flush before each construction action, and room reconciliation occurs after each accepted ordinary action so joined/split drains agree. Build remains final-only. A completed ordinary drain consumes its batch and clears old sounds even on typed refusal, matching drain semantics; preparation itself takes immutable input and does not mutate the live queue. This differs deliberately from a failed Build submission, which retains its pending queue exactly.

Shelf preview uses an explicit trusted physical reading projection for transient drafts. It is neither persisted nor adopted and does not relax public loaders.

## Ordinary runtime-state contract

Central implementation: `build_transaction/ordinary_runtime.rs`.

| Native state | Policy |
| --- | --- |
| Clock, RNG streams, funds, IDs, entities, architecture/frame, rooms, chores/grime/domestic/dining, books, appearance, bed ownership, social episodes, careers and moodlet state | Strict V15 reconstruction; candidate mutations install only after validation. |
| LotEditState receipts/revision/discontinuities; CommandFeedback; BookFeedback; AssignmentFeedback; CharacterResults; LegacyBookImportNotice | Copy into candidate and return candidate results even when durable state is unchanged. Remap entity discontinuities by stable raw index. |
| Careers.last_result | Preserve the unsaved field separately from validated persistent Careers data. |
| RelationshipDiagnostics and DecisionTelemetry | Preserve last-tick observations; no construction tick or invented observations. |
| CompletionSounds | Candidate drain clears prior events; new candidate output is returned. A refused completed drain clears the live prior events. |
| RenderBuffer, render row identities, projected-socket identities, PortalBuffer | Preserve ordinary presentation history, remap handles and reuse existing discontinuity/portal synchronization. External Load retains its reset behavior. |
| RelationshipContext and SocialCompany | Rebuild from final state without random draws. |
| Reading Options and InterpersonalPhase | Invalidate phase-local caches; their scheduled producers rebuild before consumption. |
| World, schedules, query/component registration and removal trackers | Rebuild for the candidate World. Native tick advances once; its already-consumed command stage is skipped. |
| BuildEpoch, transaction/replay/native-batch markers and NativeFeedback | Explicit transaction control outside persistence. Temporary candidate markers are removed; successful adoption advances the view revision. |

## Evidence and remaining gates

1. Current source: `task-5-transaction-checkpoint.log`, **25 passed**. Strict core/sim/wasm all-target clippy: `task-5-clippy-2.log`, passed. Two clippy style findings from the first run were repaired. `git diff --check` passed.
2. Initial red: `task-5-initial-red.log` proves draft paving leaked through persistence. `task-5-tests-3.log` records the land-frame mismatch before correction; the later mixed west/north journal passes.
3. Runtime red/green: `task-5-runtime-red.log` has three intended failures for lost prior/new bed feedback and collapsed door interpolation, with two controls passing. `task-5-runtime-green.log` passes all five after centralized preservation. Controls pin typed-error queue/sound consumption and tick versus explicit-flush durable equality.
4. Entry conservation: `cases.rs::unchanged_drains_and_blocked_gameplay_do_not_mutate_draft` captures the entire raw V15 state before `begin_build`, with an initialized board, existing unassigned duties and `week: None`; immediate post-entry equality includes owners/week/all RNG. It also checks empty drains, ticks and Confirm.
5. Real suspended-work fixtures contain nonzero cleaned work, assignments, daily decisions and remembered dishes; temporary wall/paving removal restores exact saved state. Other cases cover stale/back/repeated tokens, failed load/replay/final validator, queued stale submission, mixed commerce, land, moved counters, new paving, lost footprints/openings and active shelf moves against stale draft topology.
6. The first broad placement gate exposed fixture issues plus real command-order/render regressions. The second passed 139/141. The last two fixture corrections pass separately in `task-5-focused-sale-refusal.log` and `task-5-focused-wall-active-use.log`; the book borrower correction passes in `task-5-focused-book-borrower.log`. These do not replace the pending final combined gate.
7. Fixture classes: coherent 7x7 content/frame and explicit room initialization; current continuation tests changed to V15 while explicit historical-reader tests remain historical; an unrelated active target now uses a real second fridge action; conversation actors receive issued SimIds; book borrowing/death uses actual lifecycle state. Original geometry/refusal assertions remain. The zero-people case now proves grass has no Outside duty, paving creates one, and assignments/week/RNG plus strict V15 round trips remain correct.
8. The third placement run (`task-5-final-placement.log`) passed 127/141. Its 14 purchase/sale failures share an incoherent command-free snapshot: removed pending purchases left extra V6 action manifest rows. The fresh audit `task-5-purchase-better-way.md` recommended a save-owned semantic projection. This is a producer repair, with strict loader checks retained. Full review `task-5-review.md` separately found pending loaded input was captured too early and preparation ignored fatal settlement errors.
9. Pending: repaired-source bounded gates and scoped review, then combined placement/book/reading/land/chores gate and two isolated fault executions with source-byte restoration proof. Full workspace, Wasm/browser integration and visible acceptance remain later tasks.

This local native checkpoint is not published. Parent owns player documentation/changelog and delivery. No push, merge, dependency change or generated-Wasm change was performed.

## Fix round 1

1. Causal purchase red: `task-5-fix1-purchase-red.log` reports `Some(Validation(InvalidContentReference))` before receipt inspection. Current-load red leaves the restored queue pending (`task-5-fix1-load-red.log`); counter red returns an `Ok(BuildReview)` after settlement failure (`task-5-fix1-counter-red.log`).
2. Repairs: `save::v15::capture_without_commands` clears the three input columns and regenerates action metadata from projected V5 plus retained recipe origins. Active-Build adoption calls `begin_build` on the private loaded candidate before replacing the live world. Fatal reservation/counter failures invalidate the previous review; preparation propagates the stored error without consuming it. Blocked gameplay cannot overwrite that fatal error.
3. Four lifecycle checks pass in `task-5-fix1-lifecycle-green.log`: current pending Load, failed loaded settlement atomicity, counter failure, and an actual capacity-overflow reservation failure through the private reservation callback. No public API changes.
4. Projection fixture setup failed before exercising the helper: missing IntentQueue, then an invented Recover command for copy 999 was rejected by the strict book-command validator. A staged diagnostic proved the base and completed recipe origin valid. Three executions triggered the fresh bounded audit `task-5-projection-fixture-better-way.md`. Its three corrections use an authored inventory Purchase, fund both queued purchases in cents, and target the actual issued SimId. The exact projection test now passes (`task-5-fix1-projection-green.log`): original-source strict admission, raw-column-only InvalidContentReference control, recipe-only manifest model retained, nonempty intent queue preserved, projected strict restore/exact recapture, empty input, unchanged original capture.
5. Bounded checks pass: purchase module 26/26, the two previously failing sale cases 2/2, ordinary runtime 5/5 (`task-5-fix1-{purchase,sale,runtime}-green.log`). These ran from the compiled native test binary against the final production repair; only projection-test fixture changes followed. All 27 transaction-module tests and two adjacent book/shelf transaction cases pass; formatting, strict core/sim/wasm all-target clippy and `git diff --check` also pass. No broad rerun or fault instrumentation has started.
6. Native Wasm `cargo test -p terri-wasm --lib room_save_tests:: -- --test-threads=1` passes 10/10 (`task-5-fix1-wasm-room.log`), including pending authentic V14 chore-order Load during active Build, exact settled baseline, unchanged tick, replaced session, old-token refusal and usable Confirm. The immutable `floor-order-queued.sav` remains SHA256 `d3870b5424e20e2174abd0517dbbe299b840006caa7686193e26b4e587d30f08`; producer source `684707b3917b73d8e2fa5d65a58adf6691f0ca63` and producer Wasm `cc346229433593864f06caf1056379f4324c321d4cbbbd681abad6a25bdb92d8` remain recorded in the existing fixture manifest. No fixture bytes changed.
7. Causal red/green applies directly to the exact-price, current queued Load, and counter-settlement cases. Allocation uses a real `try_reserve(usize::MAX)` failure through a private callback and is a green failure-path check; no separate red run is claimed for that case or the authentic historical case.

Exact fix checkpoint gates:

| Command or binary filter | Result | Log |
| --- | --- | --- |
| `cargo test -p terri-sim --lib save::v15::command_projection_tests::command_free_projection_rederives_metadata_and_retains_orders_and_origins -- --exact --test-threads=1` | 1 passed | `task-5-fix1-projection-green.log` |
| Native test binary, `placement::purchase::tests:: --test-threads=1` | 26 passed | `task-5-fix1-purchase-green.log` |
| Native test binary, `placement::sale::tests::a_sale_and_a_purchase_in_one_drain_reseed_the_rows_they_shift` and `placement::sale::tests::a_sold_object_above_every_saved_index_stays_retired_after_a_load`, `--test-threads=1` | 2 passed | `task-5-fix1-sale-green.log` |
| Native test binary, `build_transaction::ordinary_tests:: --test-threads=1` | 5 passed | `task-5-fix1-runtime-green.log` |
| `cargo test -p terri-sim --lib build_transaction:: -- --test-threads=1` | 27 passed | `task-5-fix1-transactions.log` |
| Native test binary, `books::command_tests::build_transaction_book_transfers_preserve_drain_boundaries` and `reading::tests::build_transaction_active_shelf_move_uses_trusted_draft_projection`, `--test-threads=1` | 2 passed | `task-5-fix1-transactions-adjacent.log` |
| `cargo test -p terri-wasm --lib room_save_tests:: -- --test-threads=1` | 10 passed | `task-5-fix1-wasm-room.log` |
| `cargo fmt --all -- --check` | Passed | `task-5-fix1-fmt.log` |
| `cargo clippy -p terri-core -p terri-sim -p terri-wasm --all-targets -- -D warnings` | Passed | `task-5-fix1-clippy.log` |

Native test binary: `target/debug/deps/terri_sim-0bcea68002488dc1.exe`, rebuilt by the listed Cargo test command. Tests ran sequentially. The eight owned source/test paths comprise this fix; parent lesson/spec changes are excluded. This report and detailed logs remain in the ignored task-evidence folder.

## Accepted-source combined gate

Scoped re-review `task-5-rereview-1.md` closes both Important findings and accepts the canonical projection, with no new Critical/Important issue. The subsequent sequential combined run uses fresh logs and preserves every earlier failure/audit input.

| Suite | Result | Seconds | Log |
| --- | --- | --- | --- |
| placement | 141 passed | 252.46 | `task-5-accepted-placement.log` |
| books | 48 passed | 2.00 | `task-5-accepted-books.log` |
| reading | 26 passed, 27 failed | 37.32 | `task-5-accepted-reading.log` |
| land, chores | Not run; runner stopped on reading failure | | |

`task-5-accepted-gates.json` records exact commands and exits. Most reading failures are public historical-projection panics directing current rooms to V15; other failures are communal reading completion/held-company, Social delivery and upstream reading assertions. This log does not yet establish which are fixture compatibility issues versus behavioral regressions. No assertions, fixtures or production source were changed in response. Source/index remain clean at `3524cab52`.

The approved ignored `task-5-accepted-faults.py` is prepared but has not run. Its planned two isolated faults share one instrumented build, first require both exact neutral controls, then require specific deferral/stale-token assertion failures, and finally restore source bytes with hashes/index proof. Fault execution and the plain-source harness rebuild remain pending.

**Next steps**: Parent assessment of the reading failures before another run or repair. No user action is needed.
