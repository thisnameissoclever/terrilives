Spec compliance: needs fixes. One Important malformed-review validation gap remains in R6 at `web/src/rooms/codec.ts:156-157`. The remaining inspected implementation matches the supplied R6 brief. This verdict covers base `e9fae39a1c9316ef88e1320c060dde76cc3eab24` through head `23bf404873b2e450658b8858d8a4395f2656686d`.

Code quality: needs fixes for the same bounded decoder defect. No Critical finding was identified. The native ownership, fallible projection boundary and revision-specific evidence are sound within the reviewed scope.

## Strengths

1. `crates/terri-sim/src/build_transaction.rs:463` performs the fallible projection before replacing the counter or Prepared. The public preparation method retains its clone-returning behavior. `crates/terri-sim/src/build_transaction/cases.rs:87` exercises refusal with a dirty draft, pending names, an existing token and nonempty runtime observations, then successfully commits that old token. Its explicit empty input queue correctly limits the atomicity claim.

2. `crates/terri-sim/src/build_transaction.rs:497` queries the retained sparse overlap vector through the validated token and candidate anchor. The native and actual-module witnesses cover A-X/A-Y/B-Y/B-Z, invalid choices, invalid anchors, stale tokens, an unrelated new component and both land offsets. The bridge contains no browser room reconstruction or second baseline.

3. `crates/terri-wasm/src/browser_rooms.rs:153`, `:233` and `:404` bound native ingress, check canonical integers and remaining bytes, reject duplicate choice anchors and validate the expected token before preparation. `web/src/rooms/codec.ts:103` preserves the controls-before-trim rule and literal BOM while rejecting lone surrogates. Independent wide-token literals in `crates/terri-wasm/src/room_transport_tests.rs:43` and `web/tests/room-codec.test.ts:4` preserve unequal values above 2^53 and u64::MAX.

4. `web/tests/room-bridge.test.ts:73`, `:93` and `:196` test authentic V15 migration/current continuation, real native committed capture through PersistenceController and an actual reached daily autosave boundary. The fixture README distinguishes newly generated V16 witnesses from immutable historical inputs. These checks support the transport contract without claiming page integration.

## Findings

1. **Important: prepared reviews accept impossible aggregate room area.** `web/src/rooms/codec.ts:156-157` bounds each row by the lot size, then checks IDs, anchors and the presence of Outside, but never bounds the sum of final room areas. `decodeRoomSummary` already checks that sum at line 137. With context `{ width: 1, height: 1 }`, the following complete private V1 review passes every visible review-decoder check:

   ```text
   [1,0,1,2,3,0,2,
    0,0,1,79,0,0,1,
    1,1,0,0,1,65,0,0,1,
    0,0,0,0]
   ```

   It contains token `(1,2,3)`, no groups, Outside named O with area 1, enclosed room 1 named A at `[0,0]` with area 1, and empty retired-name/duty/person lists. It therefore claims two cells in a one-cell lot. This is a missed malformed-relationship requirement under brief item 6. It does not show that native code currently produces such a review, and no player impact was observed. Reject a final-area sum greater than `cells` before returning the review; retain `<=`, since wall cells need not belong to a room. Add a focused malformed-review witness and valid zero-area Outside control. This finding follows static execution of the decoder; no test was run during review.

2. **Minor, pre-existing build notices:** `docs/evidence/2026-10-17-room-identities/browser-transport/r6-final-build.log:174-181` contains ineffective dynamic-import, large-chunk and asset-plugin timing notices. The build succeeded, but its output is not warning-free. These notices do not require an unrelated dependency or bundling change for R6.

## Evidence checked

1. Read the supplied source diff in bounded sections once, including its complete new files. Recovered only the decoder lines omitted by tool-output truncation. No changed source file was separately reread. Read the transport report, wire contract and selected receipts. No Git mutation, test, build, browser or subagent operation was performed.

2. Read-only hashing matched all 1,038 current source-manifest entries and all 32 retained viewing-copy hashes. The checked module is SHA256 `6c0562aca59fe17b20000845ebeddb71337859b2b39bd8e212a10ec5ab3154c1`; its JS glue is `9c9504d64f536e175ca02ebd842e204fd518286f58b329ea0420a0fd1597508e`. Both match `gates.json` and the Chrome module receipt. Raw log hashes and normalized viewing-copy hashes retain separate meanings in `retained-files.json`.

3. `gates.json:31-156` and the retained logs record exit-zero optimized native transport checks (10), actual-module/web checks (248 in eight files), type checking and strict workspace/all-target clippy. The normal wasm-pack command has no additional target or optimization setting. The release build uses source fingerprint `ce7487c3e8e1e66ba8e077daccaf46a6ec31b37a9004e248fc40a4a07c9ddb2d`; `post-build-test-delta.json` identifies the subsequent three test-only files. Final focused receipts use `d4934194273928875a1ee056e548a7c93a08abec339d4382c99aa0bf75671dae`. The 35 transaction tests have their own earlier fingerprint and passing log, including the injected projection failure.

4. `r6-native-full.log:314-325` records the earlier 307 native tests and four example tests passing, with one explicitly ignored private-input example. `full307-source-reconstruction.json` explicitly identifies its source snapshot as reconstructed after the run. It is not a contemporaneous manifest or a final-source broad test run. The later focused, release and module receipts supply distinct evidence for the projector change. Prior yard acceptance remains available in `native-v16-yard-review.md:3-5` and was not promoted into R6 approval.

5. `chrome-opfs.json:6-70` and the retained harness support ten actual Chrome OPFS cases: original V14/V15 backups, repeat writes, cached-worker refusal, all six open/write/close fault positions and retry, malformed backup refusal, concurrent writers and New game retention. The harness uses actual directory handles, streams, workers and locks, with injected exceptions at real filesystem boundaries. Cleanup is recorded. This is headless API/storage evidence, not power-loss or played UI proof.

6. `chrome-opfs.json:62-63` independently records the current literal checksum `4661132544113609906` on the matching release module. `legacy-golden-continuation.json` records the unchanged original V15 file hash and 120-update exact current continuation. Original checksum `4676206450852028819` and the original/current content fingerprints remain separate prior controls, as documented by the accepted yard review. No universal cross-target equivalence follows from these scenarios.

## Focused cross-boundary checks

1. **Risk: shared decoding strips a BOM or accepts malformed integers/UTF-8.** Inspected unchanged `web/src/books/codec.ts:31-67`. Its reader uses fatal UTF-8 with `ignoreBOM: true`, canonical bounded varints, remaining-byte count bounds and trailing-byte rejection. The new room decoder therefore inherits the required byte semantics.

2. **Risk: the 100,000 bound confuses identity values with entity counts.** Inspected `crates/terri-core/src/components.rs:922-962` and the native save-validation references at `crates/terri-sim/src/save.rs:1270-1308`. Native admission bounds both entity indices and the issued stable-ID allocator. Thus the room decoder's owner/person bounds do not reject an otherwise admitted larger stable SimId merely because the population is small.

3. **Risk: report bounds or wire meanings disagree with native duty producers.** Inspected `crates/terri-sim/src/chores/mod.rs:398-439`, `chores/groups.rs:4-37` and `chores/room_changes.rs:225-255`. The producers support Dishes, three room-group kinds and object bins, with both final and retired key sets. The doubled capacity bound covers both sets; owners come from stable assignment owners. Replanned/unavailable raw indices are separately exercised by the reused-slot native and actual-module witnesses.

## Remaining gates

1. R7 still owns native Begin integration, removal of the existing browser BuildSession byte copy, room controls, session/deferred exit wiring, actual DOM manual Save and visibility events, and graphics Retry handle preservation. `transport-report.md:62` explicitly leaves those open. Their absence is not an additional R6 defect.

2. Played responsive behavior, captured visual inspection, a fresh independent visual review and the final whole-branch gates remain unapproved. This task does not authorize delivery or claim a clean full-web run.

3. During this review the parent reported a still-running whole-web run with a failure in `web/tests/builder.test.ts`, test `keeps the choice and turns Sell off when the drain refuses a sale`. Exact failure output and read-only diagnosis were pending. R6 does not directly change sale admission, but the failure must remain visible for broader integration classification; neither a production defect nor a stale fixture is established here. I did not repeat the run.

**Next steps**: The parent should repair and narrowly verify finding 1, finish classifying the existing whole-web failure, and retain the R7, played and final-review boundaries. No user action is needed for this review.
