# R7 task review

## Spec Compliance

**Issues found: one Important blocker.** The implementation covers the requested selection, native review, deferred exit, raw names and receiving Outside presentation, but an exit after an exact wall reversal can silently discard retained review input. This violates the retained-choice contract in integration note 17 and the exit/preservation behavior in `docs/specs/2026-10-17-room-identities.md:87` and `docs/specs/2026-10-17-room-identities.md:147`.

Reviewed fixed base `567736449842f60c562fd459e35a927a01a6138d` through head `ac116ae9d44e6976bf316644ca2bc0e4c22be4a3`, using `task-7-source-review.diff`. This is the task review, not final branch acceptance.

## Strengths

1. Native transaction ownership is explicit. `web/src/ui/build-session.ts:34` delegates dirtiness to native state, and `web/src/ui/build-session.ts:28` requests committed native bytes. Preparation and commit failures retain the session. The new native-module tests cover exact name reversal, latest-confirmed cancellation, accepted/refused Load and saving during preparation in `web/tests/build-session-state.test.ts:14`.
2. Raw text and identity are kept separate. `web/src/ui/room-selection.ts:9` rejects raw controls and lone surrogates before trimming, counts Unicode scalars and preserves BOM semantics. Selection and membership use native IDs and exact bigint revisions; Outside zero remains valid. Literal labels use `textContent`, and the name listeners isolate Enter and composition. Native membership and high-revision tests exercise those boundaries in `web/tests/room-selection.test.ts:10`.
3. Review choices survive Back independently of the prepared candidate. `web/src/ui/room-review.ts:101` discards the native review while retaining local choices; edited choices obtain a fresh preparation and require another confirmation before adoption. `web/src/ui/build-session.ts:59` also opens review when retained choices exist despite an empty native group list. The wall-reversal regression in `web/tests/build-session.test.ts:10` tests that particular bypass directly.
4. Exit completion uses an explicit continuation. `web/src/ui/build-exit.ts:231` prevents duplicate confirmation and rejects an obsolete exit continuation. Main cancels that intent on review refusal, Back and replacement. Footer Confirm/Cancel stay in Build. The native-backed deferred-exit tests distinguish adoption, Back, dismissal and Load.
5. Main preserves the existing tool composition and adds floor-first selection plus a deferred-pick mode guard at `web/src/main.ts:2196`. The actual page-binding tests execute complete extracted bindings rather than only matching individual predicates. All six retained fault receipts in `docs/evidence/2026-10-17-room-identities/ui/wiring-faults.jsonl:1` fail behavioral assertions, including missing review blocking and an always-blocked wall tool.
6. Rename-only chore redraw includes resolved location labels at `web/src/ui/chores-board.ts:64`. The refused interactive sale preserves its specific feedback after the generic requery at `web/src/ui/builder.ts:281`; the repaired test retains a single drain, no tick, a valid object, the native error check and strict V16 roundtrip.

## Issues

### Critical

None found.

### Important

1. **Retained review input is missing from exit dirtiness.** `web/src/main.ts:1946` asks only `hasUnconfirmedChanges(buildDraft) || roomSelection.hasLocalChanges()`. Review names and inheritance choices are stored separately in `RoomReviewController.choices`; `web/src/ui/room-review.ts:56` exposes their presence, and Back intentionally keeps them. Once the native draft is clean, `BuildExit.gate()` takes its immediate-discard path. Main's end replacement at `web/src/main.ts:1965` then calls `roomReview.reset()`, whose implementation at `web/src/ui/room-review.ts:107` clears those choices.

   Reproduction from the existing wall-reversal scenario: start with a confirmed enclosure; split it; open review; give the surviving-anchor result a distinct explicit name; choose Back; remove the split walls so the original authored arrangement is restored; clear the wall selection and request Exit. The native semantic state and selection-name map are clean, but the review name remains pending. Exit therefore closes Build and erases that name without the unconfirmed-changes dialog. The existing test proves that Footer Confirm would instead reopen the retained name, so the two exit paths disagree about whether work remains. This is a changed-code preservation defect, separate from the unverified browser visibility trigger.

   Remedy: include retained review input in the shared decision about whether leaving would discard player work. The existing `hasChoices`/`needsReview` contract can supply the conservative check without introducing a second baseline or browser geometry matching. Keep building must preserve that input; Exit Confirm must reopen a freshly prepared review and leave once only after adoption; explicit Discard/Cancel may clear it. Extend the actual exit wiring/native-module scenario to assert a clean native wall reversal plus retained review text opens the dialog, preserves text on Keep building, adopts it only through refreshed review on Confirm, and removes it only on explicit discard. Keep the no-review-choice exact-reversal case clean.

   Evidence is the static call chain and the native semantic contract, not a newly executed reproduction. No test was run during this review.

### Minor

No additional code finding. The reported pre-final build includes existing chunk-size, ineffective dynamic-import and asset-plugin timing notices. Those remain build-output observations, not evidence of a new R7 defect or a warning-free build.

## External integration gates

1. R8 must finish the whole-web suite, typecheck and build on the resulting source after the blocker is repaired. The retained complete web runs are failures: 9 failures in the first and 1 in the second. `command-receipts.json` records the later bounded 134-test pass, while `post-full-run-delta.json` identifies subsequent CSS/review/test differences. None is a final broad green gate. Parent separately reported native gates completed with exit 0 during this review; I did not rerun or independently audit those gates.
2. Fresh visual review is a separate accepted input. `independent-visual-review.md` retains the historical failures, accepts the current captured states and resolves the final restoration receipt. This review did not inspect pixels or run a browser and does not replace that visual judgment. Physical mobile keyboard behavior remains unverified; desktop viewport simulations do not close that boundary.
3. Natural hide/save/return remains an open browser-trigger observation. The task report records no trusted visibility event or saving status from the attempted control. The changed `BuildSession.saveBytes()` and native-backed persistence tests preserve the committed-byte contract; I found no additional load-bearing serialization risk in this diff. A natural event, actual save invocation and saved committed state are still needed to close the trigger gate. Do not substitute a synthetic event or unchanged bytes for that evidence.
4. R8 outdoor physical cleaning, final whole-branch review and the parent's combined public changelog/delivery remain outside this task verdict.

## Review scope and checks

Read the supplied primary diff in one sequential pass, recovering tool-truncated context only. Read the task brief, integration notes, review focus, implementation/evidence reports, exact command and fault receipts, post-run delta and the independent visual report. The focused outside-hunk contract check was `web/src/ui/build-exit.ts:54`: its unchanged shared dirty predicate counts native changes and unsettled previews, confirming that it cannot account for review-local choices. The existing build-confirmation spec was checked for the same exit contract. No broader native geometry, matching, schema or transport review was repeated.

No source, index, HEAD, ref, browser, server or dependency action was taken. No test or build command was run. The only written artifact is this requested report.

## Assessment

**Task quality: Needs fixes. Blocker count: 1.** The native/browser division and causal test coverage are strong, but the missing retained-choice exit check permits silent loss of player input. Repair that bounded path before task acceptance; final integration gates remain distinct.

**Next steps**: Parent dispatches the retained-choice exit fix and its regression test, then completes R8 and final branch review. No user action is needed for this review.
