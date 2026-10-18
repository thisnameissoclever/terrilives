# R7 wiring-test review

## Real goal

[G1] Players can select and rename rooms or construct rectangles through Rooms, clear a tool selection before leaving Build, and return from a room review without losing the draft. Review must prevent construction input while preserving the existing Build exit confirmation and overlay blocking.

This review used the current uncommitted files, not HEAD `567736449`. No tests, builds, browser operations, source changes, index changes, or HEAD changes were performed. Only this report was written.

## Diagnosis check

[D1] The three wall-test failures came from one obsolete source-text contract. Each run stopped at its next failed assertion, so replacing one string merely exposed the next. The exact expected lines and evidence are:

1. [A1] `.local-build/r7-whole-web.log:11227-11233`: `AssertionError: expected ... to contain 'escapeBuild: () => { routeBuildKey(...)'`; expected `escapeBuild: () => { routeBuildKey('Escape', buildTools, builder); },`. Current `web/src/main.ts:1957` adds review Back before ordinary routing. The whole run had 9 failures and 3,691 passes, so this was not its only problem (`:13839-13840`).
2. [A2] `.local-build/r7-focused-third.log:34-40`: expected `const buildTools = [wallTool, roomTool, buyTool, floorTool, landTool] as const;`. Current `web/src/main.ts:1762` uses `roomsTool`, which owns both selection and construction. This run also had a separate async lifecycle failure, with 346 passes and 2 failures (`:2697-2698`).
3. [A3] `.local-build/r7-focused-fourth.log:13-19`: expected `wallTool.setBlocked(overlayPause.suspendedExcept('builder'))`. Current `web/src/main.ts:2303` also blocks while `roomReview.active`. The run had 348 passes and this one failure (`:2649-2650`).

[D2] These logs establish stale assertions, not three runtime regressions. The new expressions match approved behavior: review Back preserves the draft and cancels pending exit (`docs/specs/2026-10-17-room-identities.md:87`); Rooms must retain rectangle construction (`docs/superpowers/plans/2026-10-17-room-identities.md:161`); review must prevent editing (`.superpowers/sdd/2026-10-17-room-identities/task-7-review-focus.md:8`). Runtime correctness still requires proof. A substring can exist in unreachable code, can ignore the wrong branch, and cannot establish that one Escape was consumed once.

[D3] The old assertions protected six distinct intentions. Preserve all six through behavioral checks:

| ID | Old check in `web/tests/wall-tool.test.ts` | Necessary protection | Existing evidence and gap |
| --- | --- | --- | --- |
| P1 | `:489`, one ordinary `routeBuildKey` call | Keys reach the visible tool; hidden furniture does not receive its keys. | `:504-519` tests real routing, but supplies its own tool array. The page's actual array is untested by behavior. |
| P2 | `:490`, canvas calls `BuildExit.pressEscape` and prevents default | One canvas Escape follows the same exit policy as page Escape, without bubbling into a second action; repeats do nothing. | `web/tests/build-exit.test.ts:583-592` recreates the canvas callback. It does not execute the actual page callback. |
| P3 | `:491`, `escapeBuild` callback | Selection clears before exit; review Escape performs Back first. | `wall-tool.test.ts:522-530` tests wall selection. `room-review.test.ts:20-37` tests Back directly. Neither joins the actual page callback to those controllers. |
| P4 | `:492`, absence of `cancelBuildBatch(); event.preventDefault();` | Escape must not silently discard the batch. | The prohibition catches one spelling only. Observe native draft dirtiness and baseline preservation across Escape instead. |
| P5 | `:493`, literal array | Every non-furniture destination participates in routing, including both Rooms modes and Land. | The correct current entry is `roomsTool`. `RoomSelection` tests never instantiate `RoomsTool`; a repository search found no current test importing that wrapper. |
| P6 | `:494`, literal wall blocking call | Overlay suspension prevents wall edits; review adds another independent block; removing both restores editing. | `wall-tool.test.ts:348-358` proves `WallTool.setBlocked` itself prevents staging, but directly supplies the boolean. It cannot detect a disconnected or incorrect page predicate. |

[D4] The architecture already has the necessary owners. `routeBuildKey` chooses the active tool and permits Escape fallback (`web/src/ui/build-tools.ts:32-37`). `RoomsTool` delegates construction and clears native-room selection (`web/src/ui/room-selection.ts:93-109`). `BuildExit` owns Escape consumption and pending exit; `RoomReviewController.back` discards only preparation and reports `completed(false)` (`web/src/ui/room-review.ts:103-108`). The page joins these at `main.ts:1668-1682`, `:1941-1960`, `:2043-2075`, and `:2302-2308`. No second controller or new production export is needed.

[D5] Source execution has precedent, with real costs. `web/tests/instance-batch-production.test.ts:9-36` transpiles actual statements using the existing TypeScript dependency, executes them, and observes rendered instances. `floor-scene-presentation.test.ts:13-27` executes complete extracted callbacks. Its context mocks subsequently needed new room bindings (`:69-70`); the earlier whole-web log records three failures in that suite. Extraction is useful only when the complete relevant binding and its controlling conditions execute. Extracting a predicate or copying the new callback into the fixture would retain the original weakness.

[D6] The related async failure was an early observation followed by early cleanup. The third log shows three `Promise.resolve()` awaits at test line 320, then `expected true to be false` for the still-active builder (`.local-build/r7-focused-third.log:15-30`). Cleanup freed the handle at line 323; the log then records `Error: null pointer passed to rust` (`:2674-2675`). The inspected path includes review completion, `BuildSession.confirm`'s `catch/finally` chain (`web/src/ui/build-session.ts:61-63`), the page or fixture confirm continuation, and `BuildExit`'s finish continuation. Counting three microtasks was unjustified.

The current `setImmediate` at `web/tests/build-exit.test.ts:320` waits for a next-task boundary, allowing the current promise-only chain to drain. That has a concrete scheduling basis; it is not a longer wall-clock timeout. It still does not expose the operation's completion, and an earlier assertion can bypass it before `finally` frees Wasm. For the four lifecycle cases, prefer retaining and awaiting the already-public `BuildExit.confirmAndLeave()` result. Keep dialog-event coverage separately. In cleanup, close/reset an outstanding review and await that retained operation before freeing the handle. Do not add a production completion API or turn this into repeated flush polling.

## What was taken as fixed but is not

[F1] The test need not preserve old source spelling. Preserve observable keyboard, review, and blocking behavior instead. The exact `roomTool` identifier in the routing array is specifically obsolete because the approved destination now has two modes.

[F2] Wall tests need not own every page-composition invariant. Keep wall mechanics in `wall-tool.test.ts`, wrapper behavior in `room-selection.test.ts`, and actual page bindings in one small integration fixture. The duplicate Escape substring in `build-exit.test.ts:1053-1058` should move to the same behavioral coverage once it exists.

[F3] Importing all of `main.ts` is not the only way to execute its wiring. It starts persistence, Wasm, graphics, assets, and the frame loop. A test-local extraction can execute bounded production bindings without exporting application internals. It must fail clearly when its boundary disappears, rather than silently selecting a smaller fragment.

## Alternative routes

[ALT1] Execute bounded page bindings with the real controllers.

Mechanism: add one test-local fixture that reads `main.ts`, uses the installed TypeScript parser/transpiler, executes complete selected statements, and dispatches input through the registered callback. Supply narrow DOM/graphics side-effect doubles, but use the real key router, `RoomsTool`, `WallTool`, `BuildExit`, and review controller where the behavior depends on them.

Work required: replace the six source checks with scenarios listed below; add direct Rooms wrapper tests. Extract the complete `buildTools` declaration, `roomsTool` initializer, `BuildExit` declaration, and canvas keydown registration. For frame blocking, execute the original contiguous frame prefix from function entry through the final `landTool.setBlocked` statement, including command advancement and the intervening book drain. Preserve complete enclosing statements and branch order. Require these nodes at their expected scope and reject ambiguous/missing boundaries. Do not collect nested `setBlocked` calls and hoist them out of their guards. Return the instantiated objects from the test-generated function; this is not a production export.

Costs and risks: modest test fixture code and explicit context maintenance. This does not prove browser focus, DOM bubbling fidelity, rendering, or frame scheduling. Keep existing controller tests and headed verification. Avoid a generic source-execution framework.

Makes easier or harder later: refactoring statement formatting no longer breaks the assertions; meaningful wiring changes can fail on state. Large composition changes require a deliberate fixture update.

[ALT2] Move composition proof entirely to actual-game browser scenarios.

Mechanism: retain controller tests, replace source guards with a retained browser scenario that enters Build, uses each tool, opens review, presses Escape, and attempts edits under both blockers.

Work required: use the existing headed game verification workflow, reproducible state, DOM input, and native-state observations. Fault controls must run in an isolated copy or task-owned instance. Keep the scenario repeatable as an acceptance test, not an informal note that the page looked fine once.

Costs and risks: strongest coverage of real input and focus; substantially more setup and execution cost for a six-assertion repair. It cannot run in this read-only review and must not consume the parent's active browser or heavy slot. Controller tests alone would leave composition regressions undetected between browser passes.

Makes easier or harder later: catches more shell integration errors, but failures require separating graphics/readiness problems from input defects.

[ALT3] Extract an explicit production composition module.

Mechanism: move existing page bindings intact behind a cohesive initialization function, then import that function in tests and `main.ts`.

Work required: define ownership of keyboard registration, frame blocking, and disposal; update the page and tests. This is an architectural refactor, not another controller.

Costs and risks: cleanest long-term import boundary, but larger production change and new exports exceed this repair's explicit constraints. Not recommended within R7.

Makes easier or harder later: removes source extraction maintenance; adds a lifecycle interface that must remain coherent with the main frame and DOM.

## Recommendation

[R1] Choose [ALT1], executing bounded page bindings with real controllers. It is the smallest route that restores automated composition coverage without production restructuring. Replace the whole obsolete six-assertion test in one change, not the remaining string alone. Keep the native transaction and existing controllers as the behavioral authority. Supplement this with the already-required actual-game checks; do not claim the DOM-less fixture proves focus or visual behavior.

[R2] Executable next step for the implementer:

1. Add `web/tests/main-build-wiring.test.ts` with the scoped fixture described in [ALT1], executing bounded page bindings with real controllers. Use the existing TypeScript dependency and fake-document pattern from `build-exit.test.ts:83-147`; do not add dependencies. Capture the entire registered canvas listener, then dispatch through it and the document listener with shared `defaultPrevented`, target, repeat, and modifier state.
2. Prove ordinary Escape clears a selected wall without cancelling a dirty native draft; a later Escape reaches the exit policy. Prove one canvas event cannot perform both actions, and held Escape does neither again. Assert the draft is nonempty before testing preservation.
3. Prove review Escape invokes actual Back, leaves Build active and dirty, invalidates the old preparation, and does not route the same key to a tool or cancel the batch. Use the existing native split fixture in `room-review.test.ts:10-18`. Keep the more extensive async adoption cases in `build-exit.test.ts`.
4. Exercise the actual tool array by activating Walls, Rooms selection, Rooms construction, Buy, Floors, and Land in separate cases. In Rooms selection, Escape clears the selected room and Enter does not commit; in construction it reaches the actual rectangle tool. Exercise the wrapper's enter, exit, and mode transitions directly in `room-selection.test.ts`. Assert furniture receives no editing key while another tool is active.
5. Execute the frame prefix for the four combinations of overlay suspension and review activity, using the real overlay controller where practical. With a valid selected wall, attempt staging and observe the command receipt/log. Require refusal when either blocker is true and successful staging when both are false. A truth table of recorded booleans alone is weaker than observing staging.
6. Remove the superseded source-only routing assertions after these scenarios exist. Preserve unrelated HTML, rendering, Load, and tool-mechanics assertions. Consolidate the duplicate main Escape check in `build-exit.test.ts` into this same fixture rather than maintaining two copies.
7. Run `npm --prefix web test -- --maxWorkers=1 tests/main-build-wiring.test.ts tests/wall-tool.test.ts tests/room-selection.test.ts tests/room-review.test.ts tests/build-exit.test.ts`. Then perform isolated fault controls, followed by the clean focused run. Do not overlap the parent's heavy slot.

[R3] Required defect rejection controls for the replacement:

| ID | Deliberate fault | Required failing observation |
| --- | --- | --- |
| M1 | Remove `preventDefault` or the Escape return from the actual canvas binding. | One Escape clears a selection and then reaches the exit policy, or reaches ordinary routing twice. |
| M2 | Remove the review-first branch in the actual `escapeBuild` binding. | Review remains open or the underlying selection/exit changes; the expected Back and retained draft do not occur. |
| M3 | Replace only the actual routing-array `roomsTool` entry with `roomTool`. | Selection-mode Enter/Escape leaks to furniture or fails to clear the selected room. |
| M4 | Remove only `roomReview.active` from the wall-blocking predicate. | Review-only case stages a wall command. |
| M5 | Remove only overlay suspension from that predicate, or replace OR with AND. | Overlay-only case stages a wall command. |
| M6 | Replace the wall predicate with constant true. | Neither-blocker positive control cannot stage the valid edit. |

Apply faults to an in-memory copy passed to the same extraction helper, or an isolated validation copy. Never mutate the live source served to the parent's browser. Require each fault to produce the intended behavioral assertion failure, not a parser error or missing mock. Capture actual failures, restore the clean input, and verify clean source hashes. This follows `docs/testing-protocol.md:20-30` and `docs/lessons-learned.md:11864-11869`.

## What I could not determine

[U1] This is a static review. I did not execute the proposed fixture or its fault controls, and I did not verify headed input, focus, appearance, or mobile keyboard behavior. The reported 348 passes are from the fourth saved log, not a fresh run.

[U2] These six old checks do not establish all review protections. The page also gates pointer picks, contextual actions, and book actions (`main.ts:1592`, `:1976`, `:2192-2195`). Full R7 acceptance must retain their own behavioral and actual-game verification. This report does not certify those paths or the entire UI implementation.

**Next steps**: The implementer should replace the complete stale wiring test using [R2], the executable repair steps, and prove the [R3] defect controls before rerunning the wider suite. No user decision or additional permission is needed for that bounded test repair.
