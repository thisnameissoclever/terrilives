# Task 3 spec and workflow integration review

Spec verdict: changes required before dispatch. This review found one actionable P2 defect in the workflow adapter. The separate recovery reviewer owns the deep snapshot, artifact and runner audit; this report does not replace that review or its findings.

Reviewed base: `0b886b73d8fb0492fe8e8029957e0fc1db5715a7`. The frozen diff is 217,257 bytes with SHA-256 `b1036193ba11b06f2e986e54298a669ad0a079192a459b2a4fec80dfd892e813`. I independently checked all 18 file hashes against `task-3-file-hashes.json`; every hash matched. The final implementer handoff was available and read before this report.

## Finding

1. **P2: Bind externally supplied campaign limits to the authenticated original plan.** Location: `.github/scripts/mutation_workflow.py:111-119`, with the supplied-chain path at lines 188-202. `load_plan` accepts a supplied chain, authenticates the original plan, then checks the orchestration contract and current checkout. It never compares the supplied `started_at`, `expires_at`, `max_attempts` or `retention_days` with `planned["orchestration"]["chain"]`. The lower-level `validate_chain` accepts a lifetime up to the supplied retention period, rather than the original seven-day campaign. `refresh_recovery` compares start/end times only when a snapshot exists, at lines 268-270. Therefore an external cross-run continuation after an aggregate failed before uploading a snapshot can extend the campaign while retaining the original tool, calibration and outcomes. The permitted bounded raw-replay path does not close this gap. This violates the fixed seven-day lifetime and the rule that continuation cannot reset campaign limits.

   I reproduced the missing binding through the real `load_plan`, `recover_plan`, archive checks, committed-workflow checks and producer-log authentication. Starting with `QualificationAuthenticationTests`' API fixture, I added the original seven-day chain to the authenticated plan envelope and updated its fixture upload digest and trusted plan receipt consistently. I then supplied a copy of that chain with only `expires_at` extended seven days. Only local current-checkout and local contract acquisition were mocked; plan and producer authentication were not. The result was:

   ```json
   {"original_days": 7, "accepted_days": 14, "plan_and_producer_authentication": "real fixture code, not mocked", "result": "accepted changed campaign expiry"}
   ```

   Compare immutable policy fields with the authenticated original plan immediately after recovery, before any tool admission or expensive work. Validate the fixed seven-day/30-day/51-attempt policy there, while allowing only the explicitly permitted run-chain extension. Add an external-chain negative test with no aggregate snapshot. Keep every other input and authenticated producer field valid so rejection proves the lifetime binding itself. Also cover changed start, attempt limit and retention values rather than relying on the existing `extend_chain` test, which only demonstrates that the function preserves whatever caller-supplied values it receives.

## Integration assessment

1. The workflow graph is tool, immutable plan, current-attempt preparation, eight workers, aggregate. Tool/plan/preparation use global slot zero sequentially and release it before workers. All eight existing global groups, pending queues, read-only permissions, PR cancellation behavior and 120-minute mutation job caps remain. Rust/web are outside the preparation dependency subtree. Generic failed-worker reruns encounter current consumer-run/attempt checks before mutation execution; aggregate-only execution refreshes recovery independently.

2. Tool authentication verifies archive and executable hashes, receipt hashes, original job/run identity, upload-ID log evidence, successful tool production, committed workflow/helper/patch blobs, the approved upstream/tree/lock identities, retention and the actual consumer runtime. Runtime collection includes Ubuntu image/version, architecture, ELF interpreter, resolved library hashes and verbose Cargo/Rust identities. The verified absolute executable flows through the runner interface. The selector probe invokes that executable directly through command-line and config selection surfaces. This is source-level assessment; the Linux build and runtime execution remain unobserved.

3. Qualification verifies fixture scope, exact full coverage, original authenticated raw deltas, interrupted progress and later pending execution in the same original run. Production compares the current committed contract and exact tool reference. Reused preparation still restores the authenticated binary and checks runtime/current source. Fixture results remain separate from production coverage. The retained-log policy is described accurately as transitive original-byte evidence plus a limited run-level redirect signal; it does not claim fresh retrieval of every historical GitHub job body.

4. The workflow calls the reviewed model/runner acceptance logic rather than reproducing survivor or completion decisions in shell. The current source validation path remains ahead of historical completion acceptance. Whole-workspace testing, locked dependencies, debug assertions, overflow checks, counted survivor allowances and actual-timeout failures remain represented in the execution contract. I did not repeat the separate reviewer's deep result-model or process-boundary audit.

5. The complete-wrapper request fixture invokes actual preparation, all eight consumer adapters and aggregation. Its runtime/native-context substitutions do not remove REST calls from those paths. The reported 165/169/173 requests at 10/30/50 historical attempts and the measured 513-request shape include current-job discovery, original-plan authentication, retained-proof authentication, executable download verification, metadata inventory, run-log probes and quota observations. The two additional proof runs in the largest fixture are synthetic retained sources; their initial ingestion is separately tested, not measured by that continuation count. These counts establish the tested continuation shapes, not live GitHub quota behavior or full native proof capacity.

6. The implementer reports 139 mutation tests, eight workflow tests and 20 classifier/Pages tests passing, plus 12 new isolated guard-removal controls. I inspected their relevant test paths and did not rerun the already-passing suite. My only executable check beyond hash verification was the small, isolated chain-lifetime reproduction above. No native build, browser, workflow dispatch, source edit, Git/index/ref change, dependency change or heavy test was performed by this reviewer.

## Remaining proof boundaries

Quality within the primary workflow/tool/qualification surface is acceptable apart from finding 1; no additional P1/P2 defect was established in that surface. Final integrated approval must also resolve the independent recovery review.

Real GitHub acceptance of the workflow, targeted preparation rerun scheduling, upload/log availability, Linux owned-process cleanup, interrupted/resumed fixture execution and exact Linux executable transport still require the real fixture. The current V20 full manifest, reconstructed snapshot/log byte capacity, memory/parsing/upload cost and finite production throughput still require actual Linux plan/pilot measurements. A 24-identity API fixture and the historical V19 Windows inventory do not establish those gates.

**Next steps**: Root should batch finding 1 with the independent recovery findings, obtain scoped re-review of the repairs, and then perform the authorized real GitHub fixture and Linux capacity qualification. No user action is needed for this review.
