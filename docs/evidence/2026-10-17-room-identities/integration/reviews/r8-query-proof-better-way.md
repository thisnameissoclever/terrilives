## Real goal

[G1] A player can inspect an unconfirmed build without changing its eventual room ownership, saved household, cancellation result, or first resumed simulation step. Two independent current Wasm handles should receive the same valid household and commands; adding diagnostic queries to one should preserve those results.

## Diagnosis check

[D1] **All three failures are helper failures; they do not demonstrate a product defect.** Attempt one passes display coordinate `7.5` to placement (`web/.scratch/r8-query-purity.js:17`); `.local-build/r8-query-purity.log:2-4` records `Move queue`. Admission explicitly requires finite, unsigned integral coordinates (`crates/terri-wasm/src/lib.rs:134-136,149-163`) and returns false before enqueue on invalid arguments (`:934-946`). Use placement tile `(7,5)`, validate a non-null facing, and inspect the drained placement receipt. Queue acceptance alone is not placement success.

[D2] Attempt two eagerly evaluates `JSON.stringify(r)` even when `r.ok` is true (`web/.scratch/r8-query-purity-v2.js:5,20`). Its log records the BigInt serialization exception at that expression (`.local-build/r8-query-purity-v2.log:2-7`). A successful review contains three BigInts by design (`web/src/rooms/codec.ts:2-5,140-142`). Branch on refusal before formatting the error, and use lossless BigInt formatting for diagnostics. Keep token comparisons and submissions typed as BigInt; converting to Number can lose identity. Attempt three correctly repairs this error path (`web/.scratch/r8-query-purity-v3.js:5`).

[D3] **The worker's session-token hypothesis is confirmed.** Attempt three stops at cross-handle token equality (`web/.scratch/r8-query-purity-v3.js:21`; `.local-build/r8-query-purity-v3.log:2-4`). Each Build entry allocates a fresh session from module-global `NEXT_SESSION` (`crates/terri-sim/src/build_transaction.rs:81-87,244-250`). Preparation combines that session with the transaction revision and incremented preparation counter (`:360-368`). A submit requires the exact prepared token, owning session, revision, and captured draft (`:474-490`). The explicit cross-Sim control requires unequal sessions and rejects the foreign token (`build_transaction/cases.rs:363-378`). Independent handles sharing this module must have different session fields even with identical households and commands. Different session identity is required isolation, not query interference.

[D4] **Changing only the assertion would still leave an incomplete proof.** The helper never compares review content (`web/.scratch/r8-query-purity-v3.js:20-21`). Compare `groups`, `rooms`, `retiredNames`, and the complete `duties` object, exactly as decoded (`web/src/rooms/codec.ts:65-76,168-178`). Check token sessions differ separately. With this identical command/preparation history, revision and preparation counters should match; retain each original complete token for its own handle. Do not fabricate common tokens or strip identities from submitted data.

[D5] **Committed bytes during Build cannot establish raw-draft purity.** `saveBytes()` serializes `save_snapshot_v16` (`crates/terri-wasm/src/lib.rs:2610-2616`), which deliberately returns the baseline while a transaction exists (`crates/terri-sim/src/lib.rs:1407-1410`). Thus the helper's draft-save equality (`web/.scratch/r8-query-purity-v3.js:19`) proves persistence isolation. Its projection observes only clock, placement feedback, interaction targets, and activities (`:7`). Successful use of the original prepared token after the queries also checks the captured persistent draft through the native guard (`build_transaction.rs:488-489`), but still does not expose every unsaved runtime resource.

[D6] **The remaining terminal assertions need specific outcomes.** Cancel currently accepts any refusal as proof of token invalidation (`web/.scratch/r8-query-purity-v3.js:25`); require stale-token code 11 while Build remains active (`crates/terri-wasm/src/browser_rooms.rs:66`). First-tick equality currently passes even if both clocks fail to advance (`web/.scratch/r8-query-purity-v3.js:33-35`); assert actual advancement. Native ticks return early during Build (`crates/terri-sim/src/lib.rs:2303-2314`). The helper only calls End after Cancel or Confirm (`:23-29`), so it does not exercise discarding a still-dirty draft through End.

## What was taken as fixed but is not

[F1] **Equal behavior does not require equal capability identity.** Review content describes the proposed household; the token authorizes adoption of one privately prepared candidate. The native transaction owns both responsibilities (`crates/terri-sim/src/build_transaction.rs:92-108,456-471,553-578`). The bridge passes the actual token fields through unchanged (`web/src/bridge.ts:862-867`). The helper should model those two contracts explicitly.

[F2] **Every diagnostic row need not remain a committed-world view.** Group keys read current object position (`crates/terri-sim/src/chores/groups.rs:23-35`); rows then look up that key in saved assignments (`chores/mod.rs:541-567`). A moved table can therefore show an unassigned Outside row while its saved Kitchen assignment remains intact. The room contract permits draft geometry and defers reconciliation to the private Confirm candidate (`docs/specs/2026-10-17-room-identities.md:81-86`). Preserve this distinction from the earlier R8 audit; freezing rows would impose a stronger product contract without evidence of a consumer defect.

[F3] **A Wasm proof need not claim inaccessible internal coverage.** Existing public component queries can validate a prepared token without preparing again: `buildComponentTiles` forwards the original token (`web/src/bridge.ts:872-874`) and the native implementation calls `prepared_build` before reading the candidate (`crates/terri-sim/src/build_transaction.rs:531-546`). Re-preparing is unsuitable as a passive probe because it increments preparation and replaces the candidate (`:360-368,464-471`). Full raw-state equality belongs in a native control if it becomes a required runtime claim.

## Alternative routes

[ALT1] **Compare paired Wasm outcomes under the existing protocol.**

Mechanism: retain actual independent handles, compare semantic review payloads and exact committed bytes, and validate each original token only against its own transaction. Exercise queries before preparation and after preparation.

Work required: replace the helper's implicit identity assumptions with one explicit checkpoint sequence. Use three terminal cases from fresh pairs: Cancel, Confirm, and direct dirty End. Verify fixture ownership and placement admission first. Compare copied endpoint observations on both arms; the control omits the repeated exercise-query batches, while both arms receive the same checkpoint observations. Preserve typed tokens and assert exact terminal results.

Costs and risks: one bounded ignored-helper repair and run under R8's existing execution ownership. Public observations cannot expose every private runtime resource. Keep any static claims separate. Existing typed-array views must be copied immediately when retained across native calls (`web/src/bridge.ts:1577-1579`).

Makes easier or harder later: tests the actual release-Wasm/bridge contract without new production APIs. A future raw-state claim would still need native evidence.

[ALT2] **Prove full internal state at the native transaction seam.**

Mechanism: an in-module native control captures raw `save::v16::capture`, saved chores, random streams, claims, and transaction state around the same query-heavy/control sequence. Native tests can call `validate_build_token` directly (`crates/terri-sim/src/build_transaction/cases.rs:35-51`) and already enforce foreign-token isolation (`:363-378`).

Work required: a separately authorized source-test change with the real dirty-table fixture, then its targeted native verification and source/artifact accounting. Preserve independent sessions here too.

Costs and risks: exceeds the current frozen production/source boundary and adds native fixture work. Native coverage alone would not establish browser decoding or the loaded release-Wasm behavior.

Makes easier or harder later: supplies precise internal mutation evidence and a lasting regression control; requires maintaining a coherent native fixture and separate transport evidence.

## Recommendation

[R1] Take **[ALT1], paired Wasm outcomes under the existing protocol**. The two-handle strategy is sound; its equality model was wrong. Repair admission, lazy lossless error reporting, semantic review comparison, per-handle token validation, and terminal checkpoints together before running again. For each original review choose a non-null indoor anchor and require `buildComponentTiles` success before and after the second query batch. Cancel must preserve exact baseline bytes, remain active/clean, and reject the old token with code 11. Confirm must accept each original own token, remain active/clean, produce equal bytes that differ from the original baseline, and retain the expected owner on the Outside table group. End after those cases must preserve the selected baseline; direct dirty End must restore the original baseline and leave Build, with old-token submission returning NotActive code 1. After End, compare complete rows/history and existing activity/target observations on both arms, check the expected owner/location explicitly, and require the first ordinary tick to advance both clocks and yield identical complete save bytes. This addresses the requested boundary without expanding into an unrelated active-work matrix or inventing a production API.

## What I could not determine

[U1] No corrected control ran in this read-only review. The three retained logs stop before terminal assertions. The stated unchanged Wasm digest and prior suite/build results were supplied by the caller, not independently re-established here. A passing repaired helper receipt, tied to the actual loaded module and fixture hashes, would establish the bounded public-API claim.

[U2] The public helper cannot directly prove equality of every raw claim, transaction field, or unsaved runtime cache. Its exact post-End save bytes and first-tick behavior are useful evidence; token success checks the captured draft; source inspection explains the remaining boundary. Do not report these as a runtime comparison of all private fields. If that stronger claim is required, **[ALT2], a native transaction-seam control**, supplies it under a separate scope decision.

[U3] Only this report was written. No helpers, source, index, HEAD, references, browser, servers, suites, builds, or dependencies were changed. Memory lookup returned no relevant room-query history and supplied no conclusions.

**Next steps**: R8 can make the single coherent helper repair in [R1], the paired Wasm protocol recommendation, then retain its actual result and API-proof limits. No production change is justified by these three failures.
