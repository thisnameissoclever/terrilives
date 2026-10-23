# Task 3 native admission implementation report

Frozen source base: `ad67b0b5995276a34c7434b9370042c6d6016dbd`. Root-only evidence/docs commit `b1c8d4bff19ad09b99dcb62fb62d666db498bcf3` is outside this package. The package uses saved pre-edit source bytes; root owns Git comparison and delivery.

Package: `task-3-native-admission-package.diff`. SHA-256: `db36c9dbfd0961cd4e566e7aadad5d0bda473d6d1117cde53bedc21a518df60d`. Exact file inventory and before/after hashes: `task-3-native-admission-hashes.json`.

## Behavior and ownership

1. Production now follows the same-run immutable plan, global-slot-zero native pilot, finished metadata report, deliberate `native_review_required` admission pause, later numeric admission rerun, then existing preparation/eight workers/aggregate. Fixture execution bypasses only this native gate. Every native diagnostic and sizing record contributes zero game coverage.
2. The new `mutation_native.py` owns explicit sample selection, lower-level diagnostic execution, bounded evidence receipts, finished-upload authentication, sizing/forecasting, and fixed admission evidence. `mutation_workflow.py` adapts those stages and packages calibration logs. `mutation_recovery.py` has only the approved native phase/admission hooks and timestamped-skipped compatibility repair. No runner, model or artifact-module interface changed.
3. `mutation_tool.CONTRACT_PATHS` now includes the native helper. Qualification checks original calibration-log declarations using the same strict helper. Changes invalidate earlier qualification contracts, as intended. No dependency, action, toolchain, permission, workflow input or source-selector changes.
4. Retained admission carries the four exact original pilot/report/review/admitted references, immutable producer proofs and original log bytes/expiry. Preparation and aggregate refresh original artifact inventories; all consumers compare the fixed plan/tool/runtime binding. Aggregate-only success cannot omit admission or a terminal historical decision.
5. Timestamped `skipped` preparation/aggregate/native jobs are excluded from executed history; known upload/receipt evidence contradicting a skip is fatal. Existing failed-worker, failed-aggregate, missing-evidence, source and bounded-replay protections remain.
6. Root owns changelog, lessons, app/native evidence, Git, independent reviews, dispatch, merge and browser/live verification. No nested agents, native builds, browser work, Git operations, push or dispatch were performed by this implementer. Existing tests create disposable Git fixtures where already required. This CI-only change needs no player-facing changelog note.

## Measurement and transport

1. The full original plan and every identity/slot/calibration/cap remain unchanged. Original cold calibration build/test bytes are separate declared bounded members. Recovery rejects missing, changed, undeclared or oversized log evidence.
2. Root's actual V20 size probe used 18,543 mutations and 52,895 scoped paths. Its lower-bound original plan is 34,234,770 pretty bytes, already above the unchanged 33,554,432-byte member cap; compact encoding is 22,720,322 bytes. The probe omits other context/calibration/producer fields and is diagnostic only. Final original-plan and result/bundle.json emissions now compact the complete parsed payload atomically. Receipt semantics and raw outcomes/log/diff bytes stay intact. Failed slots also compact existing bundles. An oversized compact bundle never enables the workflow upload flag.
3. Archive-boundary regressions scale the independently enforced member cap: a pretty, fully authenticated original plan is rejected; its complete compact payload is accepted through recover_plan. The analogous result bundle passes validate_bundle only after lossless compact transport. No global JSON writer, member limit, manifest or evidence content changed.
4. Samples resolve exact full identities from the original manifest, include an assertion-backed F32Bits getter control, a reviewed survivor candidate when present, and largest-function/span representatives from data/sim/wasm. The physical job holds slot zero while every batch retains its original logical slot. Whole-workspace locked argv, original tool bytes/caps, input guards, exact selected enumeration and process ownership are reused.
5. The F32Bits choice was checked statically: terri-data declares terri-core as normal/build dependency; build.rs includes build_pre_books and shared src modules. Searches of those paths found no F32Bits, terri_core::appearance or .value() use. The existing exact_float_values_preserve_signed_zero_and_reject_non_finite_inputs test backs the getter. Static inspection is not proof of a caught mutant: actual CaughtMutant is mandatory, and Unviable rejects the control.
6. The native pilot measures clone/setup, source verification, process startup, controlled pre-signal shutdown/reaping, owned-directory cleanup, baseline/sample phases, full-manifest lossless encode/decode/digest work, resource use and sizing. Worst measured owned cleanup is charged to the unchanged validation reserve. Finished report/admission authenticate the two completed upload steps and byte metadata, avoiding a receipt that claims to know its own future upload. Child max-RSS is explicitly the largest child, not simultaneous process-group memory.
7. Full sizing projects the largest measured record shape across the actual full identities, repeated full pending-ID arrays for every admitted attempt, base64 producer-log shapes, 16KiB per producer metadata allowance, and bounded native-proof overhead. It checks raw bundle/member/archive and snapshot logical/expanded/compressed bounds with 20% headroom. Raw projection uses the largest sampled raw member for every identity in the largest slot and four members per identity. These are declared shape/log-growth assumptions; runtime limits still fail closed. Compact snapshots continue to omit repeated full manifests from stored bundles.
8. The admitted ceiling counts orchestration and every attempt across linked runs. It uses the original baseline/setup, 1.5 times the slowest sampled mutation, 30 minutes queue allowance per wave, 1.5 times forecast waves, a separate admission attempt and two extra attempts. It must fit the original remaining seven-day lifetime and outer 8-run/51-attempt stops. Review delay consumes that same lifetime. The pessimistic all-at-caps time and maximum-history size projections remain visible even when they do not fit. A sample forecast is not a completion guarantee. Reaching the frozen ceiling is a capacity failure, never a reason to delete evidence or widen limits.

## Verification

Final complete CI Python discovery passed **204 tests in 201.305 seconds**, exit 0. Exact output is retained in `task-3-native-final-all-tests.txt`. Focused workflow source contracts passed 9 tests. Focused original-policy/transport/process tests passed 14 tests after the last compatibility repair. `python check-doc-ids.py` passed: documentation IDs are unique and allocation-free.

Commands:

```text
python -B -m unittest discover -s .github/scripts -p 'test_*.py'
python -B -m unittest discover -s .github/scripts -p 'test_workflow*.py'
python -B -m unittest test_mutation_workflow.OriginalPlanPolicyTests test_mutation_native.NativeTransportTests test_mutation_native.NativeExecutionTests
python check-doc-ids.py
```

The focused command uses `.github/scripts` on PYTHONPATH. API report environment variables are MUTATION_API_COST_REPORT, MUTATION_NATIVE_API_COST_REPORT, MUTATION_NATIVE_GATE_API_COST_REPORT and MUTATION_NATIVE_PLAN_API_COST_REPORT, pointing to the four adjacent JSON evidence files. All API calls use injectable fixtures; no GitHub workflow was dispatched.

1. Real small Python child processes prove the diagnostic adapter uses full-manifest context and original production argv, refuses exact-selection/source drift, and excludes post-signal terminal outcomes from the shutdown probe. They run no Cargo/native compilation.
2. Negative cases cover raw log/diff loss, tool/reference/expiry substitution, current source/runtime drift, missing/failed native predecessors, changed review verdict, upload overrun/missing completed upload, unviable/timeout/new-survivor control outcomes, missing admission and total-history exhaustion.
3. Isolated native guard-removal controls remove expected-review state, successful-admission state, history ceiling, upload reserve and raw-evidence presence guards. Each copied-module control requires the valid authenticated transition to pass and exactly one ordinary bad-input assertion to fail, with no import/syntax/runtime error. Source bytes remain unchanged.
4. Workflow controls remove the admission gate, shared slot identity, shard count, failed-worker aggregation or read-only permission requirement in temporary copies. Existing recovery/model/runner/tool guard-removal controls remain in the complete suite.
5. The first integrated run passed 161 mutation tests before expanded controls. A subsequent 173-test run found two harness issues: the new bundle_ready output lacked a stub in one test, and an existing byte-oriented policy fault control assumed LF. Both are fixed; the policy guard itself was unchanged. The old failed output is retained in task-3-native-final-tests.txt, not relabeled as passing. Files are normalized to LF and the original-policy fault control normalizes line endings before its isolated edit.

## API capacity evidence

Actual production wrapper fixtures authenticate original qualification, tool, plan, native decisions and raw producer archives. They use 1,600 synthetic production-scope identities and synthetic phase costs that yield a 56-total-attempt admitted ceiling. These are API/contract fixtures, not the actual 18,543-identity game plan, real native measurements, or accepted game outcomes. The eight-run production case has 49 total chain attempts and stays inside that admitted ceiling; it does not claim the theoretical 408-attempt history fits.

| Case | Requests |
| --- | ---: |
| Production prepare + eight workers + aggregate, 10 historical attempts | 171 |
| Same, 30 historical attempts | 175 |
| Same, 50 historical attempts | 177 |
| Eight production runs, three replay gaps, sixteen artifact pages/run, two total external proof sources | 513 |
| Original planning, including qualification/tool authentication | 56 |
| Native pilot / finished report / initial review-required | 63 / 20 / 31 |
| Original planning plus all three measurement stages | 170 |
| Later admission rerun | 36 |
| First preparation with no production snapshot or records | 79 |

The separate original fixture transport suite still measures the outer eight-run/51-attempt history, three gaps and two external sources at 513 requests. Workers each use 13 in the production complete-history fixtures. The native-stage test also sums separately measured later-admission, 79-request preparation and eight-consumer costs with the measured 182-request padded aggregate case to 401; this is a conservative component sum, not one observed GitHub attempt. The later two-external-source stress aggregate is 185 and its complete wrapper sum is 513. All nominal sums remain below 800. The code still checks actual in-job token availability, including 850 before later admission releases preparation. Local credential quota is not represented as repository GITHUB_TOKEN availability.

## Proof limits and external handoff

1. No actual Linux plan, binary size, native timings, shutdown cleanup cost, full 18,543-record/producer-log capacity or upload timings have been measured by this package. The real Linux gate must establish those and may reject the campaign. The actual lower-bound plan-size defect is established; the capacity of a final full plan is not inferred from the small fixtures.
2. Source tests pin literal workflow mappings; they do not emulate GitHub dependency scheduling or numeric job reruns. Root must obtain fresh independent reviews, then the real interrupted/resumed GitHub fixture at the final source contract before any game sweep.
3. Root must inspect the finished native report, make the finite spending decision, and deliberately rerun only the authenticated admission job. A later attempt proves a separate external action, not human reading. Subsequent continuation targets preparation. Missing evidence, real failures, changed runtime, expiry, capacity and no-progress stops remain terminal.
4. Original per-job log bytes are retained with their own original expiry under the approved compact recovery policy; later run-log probes are additional deletion signals, not fresh downloads of every historical per-job URL. No retention extension, mutable ledger, general tool registry, credentials or new permissions were added.

## Frozen files

| Path | SHA-256 |
| --- | --- |
| `.github/workflows/ci.yml` | `57313ed033b3c85fed7ca4e9a6a2aa9db9821eeedb9a20ae8cf70e9c3895246b` |
| `.github/scripts/mutation_workflow.py` | `def444ac2407cc3fbb2350b649065a77611b47f89d1c24226f58e38835151dbd` |
| `.github/scripts/mutation_tool.py` | `2524b4689123df8e25b4f8c5c01baa0a15c4e1b0257e39cf156da41c89259048` |
| `.github/scripts/mutation_qualification.py` | `a942c23bded1fe1bf79e8268d3ec56043b33572bcbc0e04196da08040770fbcd` |
| `.github/scripts/mutation_recovery.py` | `7370097e186d0f07dd859db42dda1d1fd69179cb7cb632059a94d17bfc8df562` |
| `.github/scripts/test_workflow_concurrency.py` | `4ebfd13921d07595858ba5cdf778d8301f9c8bb7c4242e525060663368f85813` |
| `.github/scripts/test_mutation_recovery.py` | `44eb950f9871d79f3fd9b67af35b0f9946ad5152dc5f38cd0ac98784b47ceada` |
| `.github/scripts/test_mutation_workflow.py` | `8f038e445555a85d6a160823b2b61fa79ab17d92bbb6cd624e8b06493fa3fecf` |
| `.github/scripts/test_mutation_qualification.py` | `9e05da6a208a971913caafc06b57c9408f2a2a34b2e9ec5d2f4288806c339788` |
| `docs/mutation-campaign.md` | `aa7daac3b72faa310357a850c10d04df0b2a6fefd1397217687efa5e6a8993ac` |
| `docs/testing-protocol.md` | `50862d6438823f449dd108a1ae68bfe48dbe4229a478cc3869d08886e43ea8b6` |
| `.github/scripts/mutation_native.py` | `024006d0bdfd5e5085c1735661213c97492783e7b2332df6046ed6942b08f355` |
| `.github/scripts/test_mutation_native.py` | `36250c5c7c05ccccb04b7a510a53967a49ba09d983ce7103c9c2b6adf5537996` |

Source and test files are frozen. Implementation ownership is released for independent review; no test, build or process remains running from this work. Original Task 3/fix1 packages and reports remain intact.

**Next steps**: Root obtains fresh spec and quality reviews of this frozen package, then owns Git delivery and the real Linux fixture/native admission gates. No owner answer is pending.
