# Native batch budget shape fix 1

The confirmed P2 is corrected in two files. Compact records and raw outcomes now independently cover every observed payload after common identity substitution across the full manifest. Retained history selects its payload after future identity/provenance/reference normalization, preserves phases/status/baselines, and uses the existing 32-character execution-ID shape. Delta fixed-header selection excludes record and batch arrays. No policy, interface, graph, runner, model, dependency, limit or API-call change.

Boundary: original budget package plus the separately authorized test-only recovery fixture supplement. Both remain unchanged. This package changes only mutation_native.py and test_mutation_batch_budget.py. All eight other original budget files match their frozen hashes, including the explicit recovery-test override; the companion hash map records this audit.

Verification:

1. Red mixed-class regression failed at the intended assertion: 7,914 projected compact bytes versus 8,071 required, a 157-byte underprojection. Log: task-3-native-batch-budget-fix1-red.txt.
2. Focused MixedPayloadEnvelopeTests: 3 passed in 2.345 seconds. This includes long-identity Unviable versus short two-phase Caught payloads, homogeneous positive control, and isolated restoration of each old raw/history selector. Each old selector makes the mixed assertion fail while the homogeneous control passes, with no import/syntax errors and no production-byte mutation. Log: task-3-native-batch-budget-fix1-focused-tests.txt.
3. Covering command with PYTHONPATH=.github/scripts: python -B -m unittest test_mutation_batch_budget.MixedPayloadEnvelopeTests test_mutation_batch_budget.TypedRawBudgetTests test_mutation_batch_budget.HistoryBudgetTests test_mutation_native.NativeSizingTests test_mutation_native.NativeAuthenticationTests test_mutation_native.NativeGateBudgetTests test_mutation_native.NativePlanBudgetTests. All 21 passed in 30.627 seconds, exit 0. Log: task-3-native-batch-budget-fix1-covering-tests.txt. Owned session 43627 is complete.

Original integrated evidence remains 225 passing and one harness error out of 226, followed separately by the passing 1-case and 34-case fixture repair checks. Its failed/full and earlier interrupted logs are unchanged. API demand is unchanged by this pure sizing correction: retained full-wrapper totals are 171/175/177 at 10/30/50 attempts and 513 for the bounded eight-run case, below 800; these counters belong to the original complete-run boundary, not a new run. Covering gate/plan budget tests passed again; no network or native build ran.

The projection covers measured payload classes, with the existing growth qualifications and hard outgoing limits. It does not establish real Linux size/runtime/upload capacity or completed game coverage. No owner decision or implementation blocker remains.

Package: task-3-native-batch-budget-fix1-package.diff, SHA256 bf70a4aa13e1ece073e388814475ac7780bdee953e4fd87adc063781e6143d8b.

Hash map: task-3-native-batch-budget-fix1-hashes.json, SHA256 1ec6635882b1e3f83c783f8394bccede10dc6c434c3587fc80e377648eb13a69.

**Next steps**: Source is frozen and ownership is released for root’s scoped independent re-review and delivery. No user action is needed.
