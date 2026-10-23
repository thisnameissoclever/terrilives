# Task 3 scoped spec re-review, fix wave 1

Verdict: approve the repair of the original-plan policy P2. No new P1/P2 defect was established in the changed workflow integration surface. This is scoped acceptance of this repair; the independent historical-aggregate review and real qualification gates remain separate.

The reviewed fix package is 37,956 bytes, SHA-256 `84eaf4335bbd13b0ff9e52a8285e2739d73602c7d5199912acb1db4b2fe8f14e`, against original frozen package `b1036193ba11b06f2e986e54298a669ad0a079192a459b2a4fec80dfd892e813`. I independently verified the package size/hash and all five changed-file hashes. Every other file in the original 18-file manifest retains its original hash. I read the fix report and exact test-result receipt.

## Repair assessment

1. `mutation_workflow.py:139-147` now calls `bind_chain_to_plan` immediately after `recover_plan` authenticates the original plan. This precedes tool restoration/admission, calibration, worker execution and snapshot lookup. A missing snapshot no longer bypasses the policy binding. The helper at lines 111-136 requires the original version, seven-day duration, 51-attempt limit and 30-day retention, then compares supplied policy values and their JSON types with the authenticated original values.

2. The supplied run list may grow in order while the original entries remain fixed. The helper checks predecessor ordering, unchanged head, bounded sealed predecessor attempts, an unsealed final run and the eight-run ceiling. The positive test uses real plan/archive/producer authentication and successfully appends run 200 to root run 100 with unchanged policy. Existing current-checkout, committed-contract, original-artifact and runtime checks still follow. The repair does not add network operations to the wrapper.

3. `OriginalPlanPolicyTests` exercises changed supplied expiry, start, attempt limit and retention through the real `load_plan` and original-plan authenticator. Its expiry case first accepts valid input, then rejects the exact seven-to-fourteen-day reproduction without a snapshot. The isolated control removes only the new binding call and requires that ordinary rejection assertion to fail. Source acquisition and current local checkout are substituted; archive/digest, plan, producer-job and producer-log authentication are not.

4. I ran one additional narrow check for the requested mutually wrong-policy boundary. For each of `started_at`, `expires_at`, `max_attempts` and `retention_days`, I changed both the original plan envelope and supplied chain consistently, recomputed the fixture archive digest and trusted producer receipt, and invoked real `load_plan`. All four cases reached original producer log authentication and then rejected with `original plan violates fixed campaign policy`. Authentication was not mocked. This supplements the committed test, whose mutually wrong-policy case calls the binding helper directly after authenticating its valid starting plan.

5. The only other workflow changes pass `allow_current_aggregate=include_current` through the four fresh-inventory calls. Preparation retains `include_current=False`; aggregate refresh retains `True`. Current-source validation, typed recovery handoff and tool/qualification bindings remain in their existing order. The independent reviewer owns the historical aggregate verdict implementation behind that parameter, so this report does not duplicate its deep audit.

## Verification limits

The implementation receipt records 148 mutation tests passing in 128.283 seconds and the final ten covering/control tests passing in 3.196 seconds after a positive-test strengthening. I inspected the relevant tests and did not repeat either passing set or the unchanged broad suites. The recorded wrapper request shapes remain 165/169/173/271/513; this repair adds local comparisons rather than requests.

I performed only reads, hash checks, the four isolated authenticated-policy reproductions and this report write. No source, Git/index/ref, dependency, browser, native-build or workflow-dispatch operation was performed. Real GitHub targeted-rerun behavior, Linux tool/runtime/process proof, interrupted/resumed fixture qualification and current V20 full-manifest byte/throughput capacity remain unproven by these tests.

**Next steps**: Root should combine this scoped approval with the independent recovery re-review. This report authorizes no implementation or dispatch; root retains those decisions and the remaining real qualification gates. Nothing is needed from the user for this review.
