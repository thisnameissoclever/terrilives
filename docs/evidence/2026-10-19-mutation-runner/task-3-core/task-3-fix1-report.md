# Task 3 fix wave 1

Both accepted review findings are repaired and frozen for scoped re-review. The full affected mutation suite passed 148 tests. The final ten-test review set, including the strengthened positive tail-ingestion case and both new isolated guard-removal controls, also passed. The worst full-wrapper request fixture remains 513 requests. No workflow dispatch, native build, browser action, root Git operation, commit, push or dependency change occurred.

This patch is against the original Task 3 frozen package `b1036193ba11b06f2e986e54298a669ad0a079192a459b2a4fec80dfd892e813`. The scoped fix is `task-3-fix1-review-package.diff`, 37,956 bytes, SHA-256 `84eaf4335bbd13b0ff9e52a8285e2739d73602c7d5199912acb1db4b2fe8f14e`. Original Task 3 reports and package remain intact.

## Historical aggregate verdicts

1. Tail ingestion now records every started aggregate alongside preparation jobs. A historical aggregate must be completed and have an authenticated aggregate snapshot verdict. Missing verdict evidence is retained as a started job and refused by the shared retained-phase gate; it cannot disappear as an empty attempt. A failed producer is accepted only for an authenticated allowed incomplete verdict. Explicit infrastructure, baseline, policy and capacity verdicts remain terminal.

2. The currently running aggregate is a distinct pending identity, bound to the current run, attempt and numeric job ID. Its own snapshot cannot fetch its unfinished producer log. Sealing retains that pending identity; a later loader resolves it only after authenticating the completed producer job, exact snapshot receipt and upload-ID marker. The completed verdict, original snapshot reference and exact producer-log bytes are then carried forward with their original expiry. This uses the existing producer authenticator; no artifact-module or result-model change was needed.

3. Retained validation requires a phase inventory for each retained attempt and validates historical aggregate identity, scope, campaign, original plan, job conclusion and verdict evidence. Sealing another snapshot applies the same gate to all historical decisions. Only the current authenticated in-progress producer can remain pending. This closes both direct ingestion and subsequent-snapshot laundering paths.

4. Regression evidence uses actual API fixtures, snapshot/archive authentication, original log markers, model merging, the typed recovery handoff and `runner.aggregate`. With 24/24 historical coverage, a later aggregate-only attempt still succeeds when no bad predecessor exists. Adding a prior failed aggregate with no snapshot now fails. A terminal authenticated aggregate cannot load or be resealed as a later success. An authenticated incomplete aggregate permits both retained reconstruction and real bounded tail ingestion to final exact coverage. Only current native-context validation is substituted in the aggregate acceptance fixture; authentication and result policies run normally.

## Original plan policy

1. Immediately after `recover_plan` authenticates the original plan, `bind_chain_to_plan` binds supplied version, start, expiry, attempt limit and retention to that authenticated envelope, including their JSON value types. The original policy must itself be exactly seven days, 30-day retention and 51 attempts. The check does not depend on any aggregate snapshot.

2. Only an ordered append-only run extension is allowed. Existing run fields remain identical, predecessor links follow the recorded order, heads remain fixed, completed predecessors have bounded sealed attempts, the current run is not pre-sealed, and the chain stays within eight runs. Existing source/runtime and original artifact checks still follow.

3. Negative tests change only expiry, start, attempt limit or retention while real plan archive/digest, manifest, producer job and producer log authentication remain valid. The seven-to-fourteen-day expiry reproduction now fails at the original-plan binding. A valid append succeeds, while altered original run entries and a mutually wrong original/supplied policy fail. The shared qualification fixture now includes its original chain and uses an exact seven-day interval; its previous synthetic interval was seven days plus one hour.

## Validation and controls

| Command | Observed result |
| --- | --- |
| `python -B -m unittest discover -s .github/scripts -p 'test_mutation_*.py'` | 148 tests passed in 128.283 seconds. |
| Focused `AggregateVerdictRegressionTests`, `RecoveryFaultControls`, and `OriginalPlanPolicyTests` | Ten tests passed in 3.196 seconds after strengthening the positive tail-ingestion assertions. |
| Scoped added-line whitespace and punctuation checks | Passed. |
| Frozen-file comparison | Exactly the five files below differ from the original Task 3 package; all other owned files are unchanged. |

The full suite ran after the implementation changes. The only later change strengthened one positive test with actual tail ingestion and final aggregation; the final focused command passed that changed test and the covering controls. Exact command/output receipts are in `task-3-fix1-test-results.json`. Unchanged workflow/classifier/Pages suites were not repeated.

Two new isolated controls remove the historical aggregate acceptance gate and the authenticated original-plan policy binding in disposable module copies. The bad-input assertion fails ordinarily, while each test first accepts its valid control. No syntax/import error counts as a detection. Existing isolated controls continue to pass, and live source bytes are verified unchanged by the control harnesses.

## Request budget and remaining proof

`task-3-fix1-api-cost.json` records the complete wrapper rerun: 165 / 169 / 173 requests at 10 / 30 / 50 historical attempts; 271 at the eight-run ceiling; and 513 with eight campaign runs, three missing-snapshot attempts, sixteen artifact-list pages per campaign run and two external proof-source runs. The counts include quota observations, run-log probes, original plan and tool checks, eight consumers and aggregation.

Normal snapshot loads already fetched the producer job and log needed to resolve its aggregate verdict, so carrying that evidence adds no REST requests to these continuation shapes. A missing-snapshot gap remains resumable only when authenticated phase inventories establish that no failed aggregate without verdict evidence was omitted. The positive historical-incomplete test also exercises direct authentication and ingestion of its available verdict snapshot.

These remain injected API/request measurements over the small identity fixture, not proof of full V20 manifest or retained-log byte capacity. Original archive/record policies, the 128 MiB snapshot bounds, 32 MiB chunks, original evidence expiry, source/runtime validation, current job-token admission and the 800-request nominal ceiling are unchanged. Real Linux tool transport, GitHub fixture interruption/resumption and V20 production capacity measurements remain root-owned gates.

## Frozen files

| File | SHA-256 |
| --- | --- |
| `.github/scripts/mutation_recovery.py` | `acba3d4be65769eecb6dc1214ff98ede90bc84bb85f1d5f6180a2d028e77ee64` |
| `.github/scripts/mutation_workflow.py` | `2991a3588ee57ed6e2ff6f9b59ad8db238bbe7c82f08ce9a57645cb4d63ed880` |
| `.github/scripts/test_mutation_recovery.py` | `67f9c17e8c5de4dd91b0c69a338d717300c46fa6de56f7d48efe063693ba68b5` |
| `.github/scripts/test_mutation_workflow.py` | `3ec17ab0df035b2683b5a5e3f7b70af49239a95a21d105f4436b3e84a4fc88b5` |
| `.github/scripts/test_mutation_qualification.py` | `db58919543ccf30a742d1dcc3740e3e992ba2da2ff256f7385fdd06714a84981` |

Ownership is released for scoped independent re-review. No task-owned process remains. Root owns lessons, Git, dispatch, real qualification and delivery.

**Next steps**: Root should obtain scoped re-review of both repairs before any workflow dispatch.
