# Final whole-branch review

**Ready to merge: Yes, on code and retained verification evidence.** I found no Critical, Important or Minor defect requiring a change in the reviewed implementation. Natural hide/save/return and an actual phone keyboard remain unverified acceptance checks. This verdict does not turn either into a pass or declare every planned acceptance observation complete. The parent must explicitly carry or resolve those two limits in delivery reporting.

Reviewed fixed base `513c86be2aa44fb4d5576279d0e1ae69991e870e` to head `ad85c8549801bfef2010dcf8e02ed4a01885f5dc`. A read-only `git rev-parse HEAD` confirmed that head during review. The supplied primary package is 1,892,961 bytes and 44,006 lines. I used it for source reading rather than repeatedly deriving a diff. The full package remained available; concrete evidence questions were answered from the retained evidence files instead.

## Scope and method

This was an independent cross-system review, not an acceptance-by-reference of R7 or R8. I read the final brief, installed reviewer contract, binding room spec, V16 integration plan, action-color spec and plan, relevant lessons, final integration README, R8 report and review, R8 minor resolution, readable decisions, and the ledger's deferred/open work. The old room-only V15 plan sketch is superseded by the explicit published-V15/current-V16 contract.

I reviewed in sequential subsystem passes:

1. Native registry, topology, matching, translation, legacy migration and strict current restoration; the native transaction, command allowlist, journal replay, dirty query, preparation, adoption and cancellation; chores, work replanning, visits and room-dependent consumer changes.
2. Wasm transport and schema dispatch; TypeScript wire validation, bridge, native-backed Build session, review, selection, deferred exit and actual page wiring; action-role definitions, relevant CSS, static controls, Patio descriptor/importer and generated catalogue changes.
3. Current snapshot test helpers and selected native/browser regression bodies; authentic producer/fixture provenance, recovery-worker behavior, final logs/manifests, causal fault records and selected actual images.

This is not a claim that every line of the 44,006-line package received equal scrutiny. Frozen fixture JSON was reviewed through producer provenance, schema ownership and comparison code, not by manually interpreting every repeated field. Broad mechanical test migrations, scene-authoring examples and verification scripts were sampled. I inspected the shared strict scene encoder and the current snapshot wrappers rather than claiming exhaustive review of every scene setup. Test bodies most closely tied to the transaction, current-schema, review-choice and failure boundaries received deeper reading. Some long tool outputs were truncated; the affected core runtime sections were reread in smaller bounded ranges.

Named checks outside the diff included the sole chore-row player consumer, persistence capture and natural visibility handler, the existing storage worker's locking/backup/write sequence, reading preview callers, and the installed Bevy entity-index API. No test suite, browser, server, dependency operation, source edit, index change or reference mutation ran. This report is the only file written by this reviewer. No nested agent was used.

## Strengths and cross-system judgment

1. **One architectural authority.** `crates/terri-sim/src/rooms/mod.rs:60` derives enclosure from physical boundaries rather than furniture or animated door openness. Exterior-connected components share Outside; explicit walls/windows and the narrowly recognized historical shell retain distinct meanings. `rooms/matching.rs:168` uses sparse overlap, exact matches, integer fraction comparison and deterministic ties. `:231` reserves explicit inheritance before defaults, rejects duplicate old-ID use and validates the resulting complete registry. The translation path moves membership and anchors while preserving stable IDs.

2. **The transaction has a coherent adoption boundary.** `crates/terri-sim/src/build_transaction.rs:343` restores a private baseline, replays accepted journal entries, compares the full draft, matches final geometry and validates before installing preparation. The fallible outward projection precedes token replacement. `:474` checks both the exact token and captured draft; commit does not drain new input first. `:593` restores the latest baseline for Cancel/End. Public current capture at `crates/terri-sim/src/lib.rs:1407` reads that baseline during Build. Browser state contains raw input and presentation choices, not a competing save baseline.

3. **Chore reconciliation preserves the relevant ownership and history.** `crates/terri-sim/src/chores/room_changes.rs:81` captures old grouped membership before replay and matches surviving object IDs within a chore kind. Floor identity retains its existing owner; new duties alone enter construction assignment policy. Settled history is not rewritten as a new duty's past. `:266` retains valid work, replans changed physical targets and releases only task-owned paths; unavailable work is not credited as cleaning. Dirt remains on its original targets, and dormant floor dirt is accepted separately from active eligibility. Shared Outside is filtered out of indoor room-effect queries while physical outdoor cleaning uses explicit material eligibility.

4. **Published V15 remains a separate wire contract.** V16 wraps the complete V15 payload. `crates/terri-sim/src/save/v16.rs:37` supplies stable room context before nested restoration and validates current work afterward. Standalone V15 dispatch remains distinct in the Wasm loader. The test-only fingerprint adapter at `crates/terri-wasm/src/current_test_snapshot.rs:7` asserts both independently measured values and changes only that metadata field; it is not used by production readers. Typed current test views retain the entire V16 envelope for equality and reload. Authentic V15 request/order comparisons and 120-tick current continuation tests exercise real producer bytes.

5. **Review choices are not silently adopted or discarded.** `web/src/ui/room-review.ts:108` refreshes edited choices and requires the player to inspect the refreshed review before a later adoption. Raw invalid names remain local, names are inserted as text, and native predecessor queries constrain identity choices. `web/src/main.ts:1946` includes retained review choices in exit dirtiness even when exact wall reversal makes native dirtiness false. `web/src/ui/build-exit.ts:231` distinguishes a pending review from successful adoption and guards duplicate/obsolete exit continuations. Footer Confirm/Cancel retain Build; explicit Exit owns leaving.

6. **Storage and presentation changes are scoped.** `web/src/storage/save-worker.ts:30` adds V15 recovery to the existing locked backup-before-primary-write path. Cached old-worker refusal and actual OPFS failure controls are separately retained. Patio appends covering 4 and the importer rejects overwritten identities or gaps. Existing atlas/depth inputs remain bound to the native manifest. Action intent is assigned at control definitions, including dynamic controls, rather than inferred from labels. The approved policy explicitly makes final Start over and Load confirmations green; this is intentional, not an overlooked destructive-action exception.

7. **The tests address failures rather than merely restating implementation.** Sampled controls cover raw draft versus committed bytes, queued input on rejected submit, usable prior preparation after injected projection refusal, stale sessions, actual native review choices and explicit owner zero. The review tests use the generated module. Current fixtures must first pass strict admission. The saved full state and random streams are compared at the important boundaries. Historical fixture generation and current scene setup are clearly distinguished.

## Ruling 26: draft chore rows

I support the ruling without adding a row cache or another baseline.

`crates/terri-sim/src/chores/mod.rs:541` derives keys from current draft positions and looks up saved ownership. The missing Outside key returns `u32::MAX` in the result; it does not create an unassigned record. Group membership and dirt lookup take shared world references. The Wasm export and bridge feed `ChoresBoard.update`; `web/src/main.ts:1608` refuses opening that board during Build. Native Build ticking and command draining bypass gameplay reconciliation, while final candidate reconciliation uses baseline membership rather than these rows.

The retained observation is real: moving table 7 into Outside changes its diagnostic row before confirmation. Its meaning is limited to that projection. The contemporaneous Cancel/capture/replayed Place sequence preserves committed bytes, and Confirm retains Bill on the Outside duty. The actual paired API receipt covers Cancel, Confirm and direct dirty End, own-token usability, exact refusal codes, a real first resumed tick and equal final bytes. The control arm still performs checkpoint observations; it is not literally devoid of every query, and it does not expose every private claim/cache. Source inspection supplies the separate purity reasoning. A future gameplay consumer of draft rows would need review at that consumer.

## Verification evidence checked

1. Final web receipt 02 records six successful checks: typecheck, 3732 tests in 270 files, production build, document IDs, 12 changelog tests and changelog generation. I read the actual suite summary. I independently verified all six original raw log hashes against the receipt and each retained viewing-copy hash against `retained-files.json`. Normalized viewing copies intentionally differ from some raw hashes; the raw-to-retained mappings are explicit and the original raw files still match.
2. Native receipt records formatting, the complete workspace and strict all-target clippy. I read every workspace result row: 2452 passed, zero failed and one optional private-input fixture ignored. All three original raw log hashes and retained-copy mappings match. Before/after native file maps are equal, and I rehashed all 463 current native inputs with zero mismatches against fingerprint `67adab4fb28ea4bbc3f42543069939636f414f883cca00fbb2925926a20881bd`.
3. The web before/after receipt and parent audit bind 52,748 inputs to fingerprint `2385c68250bb874c96a25f31a82497edd05c6e7df30a7fe0b5ce9ddcedf18a09`. I read the compressed manifest and independently rehashed the eight selected current files from the audit, including HTML, main, room CSS, selection/review, Wasm, the public note and action-intent test; all match. I did not rehash all 52,748 current web/asset files. The unchanged release Wasm is `6c0562aca59fe17b20000845ebeddb71337859b2b39bd8e212a10ec5ab3154c1`.
4. Earlier red/interrupted runs remain earlier failures. The 3729-test pass precedes the Exit attribute correction. The final 3732-test run covers it. The two deferral/stale-token fault logs fail the intended assertions, with passing neutral controls and exact restoration receipts. The six native faults in the other retained package share one instrumented build with isolated selectors. These are source-bound causal checks reused from their stated revisions, not newly executed final-head mutations or a full remote mutation sweep.
5. The R8 glossary correction removes the stale Buy ordinal. The October 18 note describes player behavior, preserves earlier history and avoids internal test/PR claims. Fresh-main delivery-date reconciliation and remote delivery remain parent work.

## Selected image inspection

These are my observations of the actual retained pixels. They do not establish motion or physical-device behavior.

1. `integration/played/r8-exit-proof-a.png`: all three Exit decisions are gray. This fails the required action-color convention despite readable labels and visible focus.
2. `integration/played/r8-exit-proof-b.png`: Keep building and Discard changes are red, Confirm changes is green, and the Keep building focus outline remains visible. It addresses the visible defect in A. This was an additional known-condition inspection, not a new blind test; the earlier blind review remains separately retained.
3. `integration/played/r8-patio-west-after-load.png`: paused Build, all six destinations, Outdoor patio, Save-loaded feedback and the gray outdoor patch remain visible. The receipt, not this view alone, establishes exact floor IDs and retained land.
4. `ui/review-desktop.png`: the split children are highlighted; names, inherited identity, area and duty outcomes are readable. The input displays literal `<b>Hall</b>` text. Back and Update review remain accessible.
5. `ui/selection-restoration-v4.png`: the selected room-name field and its complete focus outline fit within the compact scroll area, with Cancel and Confirm visible below.
6. `ui/forced-colors.png`: system-colored controls retain visible boundaries, labels and a distinct focused name field. This supports that captured state, not every operating-system high-contrast configuration.

## Issues and recommendations

**Critical: 0. Important: 0. Minor: 0.** No source remedy is requested.

The two remaining acceptance checks should stay explicit. `docs/specs/2026-10-17-room-identities.md:149` calls for on-screen-keyboard testing. Reduced viewport captures do not prove actual OS keyboard opening, dismissal, occlusion or focus behavior. Natural visibility saving likewise lacks a trusted hidden/visible cycle. I inspected `web/src/main.ts:1359` and `web/src/ui/persistence-controller.ts:135`: the existing handler reaches the same native committed-byte capture used by other save paths. That supports the code boundary, but does not establish browser lifecycle timing. Neither missing observation demonstrates data loss or a new defect, so I do not recommend speculative source changes or another synthetic visibility variant.

## Declined to judge

1. Actual physical phone keyboard behavior: no device observation was supplied or performed. This is an open acceptance item, not outside the feature's scope.
2. Natural hide/save/return completion: no trusted event sequence was established. Manual Save, autosave, OPFS and static control-flow evidence cannot substitute for it.
3. Browser/process power-loss durability: the retained worker checks cover actual API failures and concurrency, not crash-at-instruction-boundary experiments. No new durability claim is warranted.
4. Every animation, asset facing and original scene-authoring helper: selected stills and retained played reviews were sampled; I did not replay the entire game or exhaustively reread every historical fixture field. No unobserved visual quality claim is made.
5. Large-lot performance and cross-browser/device performance: no new benchmark ran. I found no concrete performance regression in the inspected paths, but test/build timing is not a gameplay performance measurement.
6. Remote CI, a full remote mutation sweep, merge, deployment and later main changes: outside this fixed-head read-only review. They are not reported as passed.

## Assessment

**Ready to merge: Yes.** The inspected native and browser paths meet the binding ownership, identity, compatibility and review contracts, and the retained final checks are tied to the current relevant inputs. Preserve the two unverified acceptance items in the parent's explicit closeout ruling; do not describe this review as proof that those events occurred.

**Next steps**: Parent owns the acceptance-limit ruling and authorized delivery. No implementation fix or duplicate test run is requested by this review.
