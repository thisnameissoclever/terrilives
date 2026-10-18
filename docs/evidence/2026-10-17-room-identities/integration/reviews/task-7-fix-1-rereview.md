# R7 fix 1 re-review

**Finding Verdict: ADDRESSED. Round verdict: PASS within the assigned scope.**

Reviewed base `ac116ae9d44e6976bf316644ca2bc0e4c22be4a3` through final released head `dc1a4b6bc684b475ca382d1e2eb594e29b95b140`. The runtime/test fix is `d13d9db155ae31304f357807a0363f5fd7b1fefa`; the final commit changes six evidence files only. Read the supplied primary package and evidence addendum once each, without deriving another Git diff or rereading changed source files.

## Finding 1

The shared `BuildExit` predicate now includes `roomReview.hasChoices` alongside native/tool dirtiness and selection-local names. This uses the existing input owner's contract and closes the immediate-discard path identified by the prior Important finding. It introduces no second baseline or new controller state.

The added behavioral cases support the required outcomes:

1. `reverseReviewedSplit` uses the current native module to enclose, split, enter a review name, choose Back and reverse the wall edits exactly. Before Exit, it asserts clean native dirtiness, clean selection-local names, retained review choices and unchanged committed bytes.
2. The actual canvas/document Escape binding opens the exit dialog. Keep building preserves both the retained name and baseline. The public `confirmAndLeave()` path opens a fresh review with no native groups and a different token. It preserves the name, refuses duplicate activation while pending, requires refreshed review before adoption, and records exactly one commit, end and leave. The final native summaries contain the adopted name.
3. Actual dialog Discard and footer Cancel clear the retained choices through the extracted page replacement binding, preserving baseline bytes. Discard leaves once; Cancel keeps Build open.
4. The same exact reversal without retained choices remains clean and leaves directly without a dialog.

The fixture extracts complete page declarations and assignments for review completion, review requests, retained choices, exit and replacement. It uses real `RoomReviewController`, `BuildSession`, `BuildExit` and tool controllers. The assertions therefore exercise the missing composition boundary rather than copying the repaired predicate into a fake controller. Async confirmation is settled before native-handle cleanup, including assertion-failure cleanup.

## Evidence assessment

The retained RED log records the three intended failures at the missing-dialog assertion, with 18 passing tests. GREEN records 98 passing tests across six files. The typecheck log records `tsc --noEmit`; its receipt records exit 0. The commands and counts agree with the report and supplied patch. These are inspected retained results; I did not execute tests or typecheck.

The addendum removes one trailing blank line from each retained log, updates the corresponding hashes and byte counts, and describes LF normalization with one final newline. The resulting retained-log hashes agree between `receipts.json` and `retained-files.json`; raw-log hashes, source hashes, commands and outcomes remain unchanged. The final report's trailing-blank-trimming wording matches this correction. I checked consistency within the packages, not the raw ignored log bytes or independently recomputed file hashes.

The RED source hash is explicitly reconstructed after the run by reversing the one-line fix and comparing prior identities. It is supporting provenance, not a contemporaneous broad source manifest. The reported unchanged regression file and native-module hash do not establish a new full-branch acceptance gate.

## New Breakage

None found in the one-line production change, supporting regression changes or evidence cleanup. The check conservatively preserves explicit pending review input and the no-choice control guards against making every exact reversal dirty.

## Out-of-Scope observations

1. Final R8 whole-web tests, typecheck and build remain pending. The focused 98-test pass does not replace them. Parent reports native 2452-test, formatting and clippy gates passed on unchanged native source; those gates were not rerun or independently audited here.
2. Prior visual acceptance, physical-mobile limits, the natural visibility-save trigger, outdoor-cleaning proof and final whole-branch review retain their separate boundaries. This fix changes no layout, rendering or native implementation and closes none of those gates.

No source, index, HEAD, ref, browser, server, dependency, test or build action was taken. The only written artifact is this report.

**Next steps**: Parent resumes R8 and final integration review. No user action is needed for this re-review.
