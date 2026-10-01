# Scoped activity-bubble integration review

**Ready to merge? Yes.** No Critical, Important or Minor findings in the integration at `07fdd9b9a9b843eb7b38d9471f5cee850dc98aa5` against shipped main `46e6b0a7`.

## Scope and checks

Read the net review package, appended worker report and appended verification record. Compared the activity integration against the previously approved `29f12e99` and the renderer changes against current shipped main. This review covers coexistence of the batch API with the new activity mapping and agent-only bubbles, not a repeat review of PR 190's complete feature. No source or Git state changed, browser was controlled, test was rerun or agent was dispatched. This report is the sole write. The writing skills preserve the report's voice and evidence limits.

1. The frame integration adds exactly the shipped activity table and agent-kind checks. `web/src/frame.ts:1145` gates bubble writes on `KIND_AGENT`; line 1337 applies the same rule in the retained legacy counter. The net diff against shipped main leaves this mapping and both guards unchanged. Neither the batch conversion nor the compatibility wrapper revives the former walking/generic-use omissions.
2. Each eligible agent still writes at most one activity row. The existing worst-case capacity reserves one bubble per entity, so the expanded mapping does not exceed its bound. The actual writer advances the slot; publication at `web/src/frame.ts:1282` therefore includes every newly eligible bubble without needing a second activity traversal. Hidden work rows keep the shipped null activity mapping. No new allocation, layout change or trailing-buffer clearing was introduced by integration.
3. The explicit `buildInstances` wrapper still delegates to the current packer at `web/src/frame.ts:1304`. Its arguments/defaults and borrowed storage behavior remain intact. Main.ts is unchanged from the approved dock integration; the batch producer/consumer and floor callback survive without an intervening build or legacy recount.
4. The only renderer-owned test edits are `web/tests/instance-batch.test.ts:67` and line 159: `indicatorEat` becomes the shipped `activityEat`. Activity code 3 and independent counts 14 and 3 are unchanged. Expectations resolve a canonical atlas name, not the packer's private table or a value calculated by the packer. Reverting the production eating mapping to the old sprite would fail these assertions; omitting its row would also fail the count/row expectations. No new mutation execution is claimed.
5. Live file hashes match the integration record: frame.ts `ed3d7f63bad0af0b53826f5280db604497a1f4549f1e17dbce8f781ca647c74b`, main.ts `fc3551b77dc8091c33bd29432853a87ae10aeb0186e3caf217acd251a383a45d`, and generated WASM `a7440ec0c4c486682f266923cf959be7d1946bc3c6e73b230026a6fbb5f76e0f`. The worker records copying all six matching generated files from a clean checkout at the exact shipped revision, with that source unchanged. I verified the destination WASM hash, not the copy operation retrospectively.

## Evidence assessment

The first focused run exposed two stale artwork expectations, with old sprite 43 versus shipped sprite 1372. Correcting those two names preserves the independent assertions rather than weakening them. The worker records six focused files / 127 tests passing, followed by a current combined full suite of 117 files / 1,759 tests passing with one worker and a 1024 MB Node heap limit. Typecheck, build, documentation IDs and whitespace checks also exited 0. This full-suite run is justified by changed upstream activity and WASM inputs; I did not repeat it.

Root's verification identifies rebuilt `index-BQx-xRrq.js`, hash `9a785ef0d706a1e5ab4be3bd13f46f45221768399043ef807f34a4bcf8581cf3`, and records actual desktop/mobile floor uploads of 45 to 46 rows and opaque draws of 394 to 395. Help transitions passed. The mobile preview used 48 rows; Cancel restored 45 and the original table, with a fresh 3159-byte save unchanged. Root inspected three new screenshots and closed the owned page/server. These browser observations are attributed to root's run, not a new browser session by this reviewer.

The net renderer branch against shipped main introduces no Rust, WASM source, dependency, art, sound or saved-state changes. PR 190's already-shipped source/art changes and refreshed generated artifact are not misrepresented as renderer-authored work.

## Findings

Critical: none. Important: none. Minor: none. No integration repair is required. The earlier whole-branch and dock-integration verdicts remain valid within their recorded boundaries.

## Declined to judge

1. Complete standalone PR 190 activity pairing, artwork and Rust behavior: separately shipped and reviewed; this assignment verifies preservation through renderer integration.
2. Complete standalone PR 189 dock acceptance: unchanged since the preceding integration review.
3. Audio-memory holds on PR 184 and PR 178: this integration supplies no memory acceptance for either held feature.
4. Subjective door audio and physical-speaker acceptance: no listening session or new audio work occurred here.
5. Measured frame-time, allocation profiles and 120Hz performance: removing duplicate work does not establish these measurements.
6. Full world/object visual acceptance and standing sleep poses: builder evidence is not a complete gameplay acceptance pass.
7. Physical-device and cross-browser/GPU coverage: the recorded viewport checks do not establish device-fleet compatibility.
8. Remote CI, full remote mutation results and deployed combined behavior: separate delivery evidence, not certified by this local review.
9. Retaining a batch across another build: outside the documented borrowed-storage contract; the unchanged production consumer uses it synchronously.

## Verdict

The new activity mapping and agent-only rule remain intact in the packer and legacy counter. The two test updates follow shipped content without weakening count checks, and the production draw path is unchanged from its approved form. No unmet reasonable-user expectation was identified within this integration scope.

**Next steps**: Root can complete the authorized PR 191 delivery and report remote checks and deployment separately.
