# Closeout of the five room-review annotations

These answers use current source and the retained PR290 room evidence. This was a read-only audit: no tests, CI, browser, source, index or reference changes. Only this report was written. Historical evidence keeps its original version and execution boundary; it is not presented as a new V18 test run.

## 1. Historical saves with heavily modified houses

**They do not need the original house layout or five rooms to load.** A supported historical save must first pass its historical decoder, content checks and source-state validation. Migration then calculates rooms from the saved architecture across the owned lot. Custom enclosures, openings and additions determine the result. It does not replace the house with the starter layout.

Household objects, people, funds, books, careers, dirt, histories and random state are preserved under the migration contract. Old room references are translated to the new physical rooms or shared Outside. Inferred old room labels are inherited by overlap where possible; unmatched new enclosures get numbered names. Old floor/surface-duty references follow their best-overlapping destination; duplicate assignments that collapse onto one key are reduced to one assignment. Old visits that still contain the person map to that person's new room; stale references remain separate retired history. Existing work is validated under its old rules and then reconciled only where its physical eligibility changed. This can change room grouping or replan work; it is not a promise that every historical duty remains a separate current duty.

**The complete historical shell is a narrow compatibility rule.** It applies to `LegacyAuthoredV1` or the exact frozen legacy wall-cell set, including that exact set translated by the lot frame. A modified wall-cell set does not qualify. Custom gaps remain open; the loader does not guess a missing complete shell to force five rooms. Smaller opaque authored grids use only the in-bounds implicit cells and doorway exceptions. Explicit bad coordinates still refuse.

No remaining valid-save load failure is identified by this annotation's current source or retained evidence. The previously problematic small implicit geometry has a specific current regression. This does not promise arbitrary malformed saves, unsupported future versions, incompatible content or invented architecture will load. The expansive funded play seed is explicitly artificial setup; it is not evidence that every private heavily modified historical household has been tested.

Evidence:

1. Contract: `docs/specs/2026-10-17-room-identities.md:38`, `:129`, `:131`, `:133`, `:135`.
2. Shell recognition: `crates/terri-sim/src/rooms/mod.rs:273`; exact-set/custom-gap controls: `rooms/tests.rs:323` and `:341`; small implicit geometry versus invalid explicit coordinates: `rooms/tests.rs:56`.
3. Name inheritance: `crates/terri-sim/src/rooms/runtime.rs:28`. Reference translation, assignment deduplication, continuing visits and physical-work reconciliation: `rooms/migration.rs:36` through the end of `migrate_inner`.
4. Retired historical references: `rooms/integration_tests.rs:358`. Preserved authentic surface-work migration: `crates/terri-wasm/src/room_save_tests.rs:470`.
5. Retained passing native results: `docs/evidence/2026-10-17-room-identities/integration/native/r8-native-final-01-workspace.log:1475`, `:1480`, `:1484`, `:1488`. Authentic V15 actual-module continuation and its fixture limit: `browser-transport/transport-report.md:48` and `:64` under that same dated room evidence directory.

## 2. Complete fallible review projection before replacing preparation state

**Fixed.** The original ordering could replace a valid prepared review/token and then fail while allocating or encoding the outgoing review bytes. The player would receive a refusal instead of the new review, while the old review token had already been displaced. No real runtime out-of-memory event was observed; source review found the failure path.

Current preparation validates the candidate and calls the fallible projector first. Only after that succeeds does it advance the preparation counter and install the new prepared candidate. The Wasm boundary uses this same native method with its serializer. The injected-failure test preserves the baseline, raw draft, pending names, revision, counter and nonempty runtime observations, then successfully commits the original token. Newly queued commands can still settle at preparation entry; the test deliberately has no new queued commands. That stated boundary does not leave the reported replacement-order bug open.

Evidence:

1. Current ordering: `crates/terri-sim/src/build_transaction.rs:467`; Wasm call: `crates/terri-wasm/src/browser_rooms.rs:416`.
2. Regression: `crates/terri-sim/src/build_transaction/cases.rs:87`, `failed_review_projection_preserves_existing_preparation_and_runtime`.
3. Retained result: `docs/evidence/2026-10-17-room-identities/browser-transport/r6-current-transactions.log:11`; explanation and scope: `browser-transport/transport-report.md:12`; later full native result: `integration/native/r8-native-final-01-workspace.log:692`.

## 3. Furniture-sale refusal feedback

**Fixed and preserved after the current upstream merge.** Native sale refusal was already correct. The browser subsequently refreshed the object list and placement preview, replacing the useful refusal with generic placement status. `FurnitureBuilder.afterCommands` now retains the sale result locally and restores that specific message after the refresh.

The current regression queues a verified real interaction and sale in one drain, without adding a tick. It checks the native refusal, no build error, retained selection, disabled Sell, exact refusal text, and a strict current V18 load/resave. The upstream integration changed that test's expected save header from 17 to 18; it retained those behavioral checks and did not change this builder implementation. No unresolved sale-feedback repair remains in this annotation.

Evidence: `web/src/ui/builder.ts:250` and `:281`; `web/tests/builder.test.ts:406`; retained PR290 assessment at `docs/evidence/2026-10-17-room-identities/integration/reviews/task-7-code-review.md:16` and `ui/README.md:14`; merge preservation is also recorded in `.local-build/build-ui-followup/v18-integration-review.md`.

## 4. Actual page-binding tests versus the old source snippets

**The replacement checks what the page does.** The old assertions searched for particular source text. They could pass when the text existed but was not connected correctly, or fail after a harmless rename. The replacement reads the actual page source, extracts complete named bindings and the relevant frame prefix, and runs them with the real Build, Rooms, review and native-module controllers. It sends keys and attempts edits, then checks the native draft, review state, exit behavior and whether a command was actually accepted.

The six retained deliberate faults remove Escape consumption, remove review-first Back, replace the Rooms wrapper, remove either editing blocker, or block editing permanently. Each fails a behavioral assertion. Parser errors or missing mock variables do not count as successful fault rejection.

**Some test maintenance remains explicit.** The extractor expects named top-level variables, a named `main`/`frame` function, the canvas key listener and `landTool.setBlocked` as its frame boundary. Moving or renaming those bindings requires updating the test fixture. New dependencies inside an extracted binding may require another narrow mock. The deliberate-fault substitutions also match exact source strings and require exactly one match, so a spelling change can require updating those substitutions. These failures are loud and localized; the fixture does not silently skip a missing binding. This is remaining test coupling, not an unresolved player defect. It still does not prove browser painting, focus, native event defaults or real touch behavior; separate browser evidence supplies those checks.

Evidence: `web/tests/main-build-wiring.test.ts:25` for extraction and `:350` for faults; the test requires an `AssertionError` at `:361`. Retained six failure records: `docs/evidence/2026-10-17-room-identities/ui/wiring-faults.jsonl:1` through `:6`. Completed replacement and bounded gate: `ui/README.md:29` and `:30`; independent PR290 assessment: `integration/reviews/task-7-code-review.md:15`.

## 5. Lost-enclosure review: Outside area and cleaning owner

**The missing receiving context is fixed.** When a room opens to Outside, the review names the receiving Outside area, shows its native membership-area change, and shows the actual Outside cleaning duty even when that duty keeps the same owner. It also shows the enclosed room's retiring identity/duty. The player can therefore distinguish the retiring indoor responsibility from the continuing outdoor responsibility before confirming.

The area is room-membership tiles, not a count of dirty or cleanable tiles. Outside remains one shared selection/cleaning region. Grass and street do not acquire floor-cleaning duties merely because they belong to that region. The displayed duty owner is the native assigned housemate's stable Sim ID, resolved to a name; it is not an object index or a promise that every tile will be cleaned. Owner zero is a real person, not Unassigned. Missing ownership displays Unassigned; a missing floor-duty row says No floor duty in this review.

The retained corrected case shows Outside growing from 500 to 548 membership tiles, Casey retaining the receiving floor duty and Bill's old duty retiring. No material unresolved presentation or ownership issue is identified for this annotation. The screenshots are retained historical evidence for that text repair; this audit did not rerun the scene.

Evidence:

1. Current display: `web/src/ui/room-review.ts:179` for Outside name/area and absent duty, and `:209` for retaining relevant unchanged Outside duty rows and resolving owners.
2. Owner-zero, unassigned, absent-duty and literal-name controls: `web/tests/room-review.test.ts:95`.
3. Retained comparison: `docs/evidence/2026-10-17-room-identities/ui/lost-before.png`, `ui/lost-after.png`, and `ui/README.md:51`. Contract: `docs/specs/2026-10-17-room-identities.md:107`, `:111`, `:119`.

**Next steps**: Parent can close these five annotations with the answers above. No additional repair is requested by this audit; unrelated delivery and CI obligations remain with their existing owners.
