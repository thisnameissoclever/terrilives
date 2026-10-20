# Fixture readiness clock repair

The integrated Windows script suite ran 267 tests in 1512.788 seconds: 264 passed and three runner process tests failed. No production defect was found. These fixtures gave the child 0.8 or 1 seconds starting before process construction, so slow child startup could consume the entire observation interval before the expected report or completed exit was observable.

## Diagnosis before the change

`trace-runner-startup.py` instruments real `OwnedProcess` construction and controller results. A controlled 1.1-second construction delay reproduced all three failures with the unchanged test helper. The red transcript is `runner-startup-trace-before.txt`. Observed constructions in that controlled experiment took approximately 1.18 to 1.19 seconds; ordinary fixtures had not reached readiness, and the active-write fixture had reached only partial readiness before the expired controller deadline.

Those measurements belong to the controlled reproduction. The original integrated run did not instrument child construction, so its exact startup durations are unknown. The initial JSON trace was overwritten by the subsequent positive run; only the red transcript remains as the original retained red file. The current `runner-startup-trace-1.1.json` is post-repair evidence.

## Change

Only `.github/scripts/test_mutation_runner.py` changed. `FixtureClock` measures real elapsed monotonic time after the actual child readiness handshake. The ordinary process helper waits for its `ready` marker; the active-write helper waits for `partial-ready`. The existing 0.8/1-second execution windows and three-second cleanup and handshake limits remain unchanged. Readiness is cleared between ordinary invocations so a previous child cannot satisfy the next handshake.

The clock replaces only the runner module's time reference during these fixtures. Real child processes, native process-group cleanup, report validation, mutation identities, failure assertions and guard-removal controls remain active. Production code, production job deadlines, mutation timeout policy and resource caps are unchanged.

An added regression calls the production controller directly with a real child, its normal time source and an already-expired deadline. It requires `incomplete_without_progress`, `controller_deadline`, no accepted snapshot and no child readiness marker. Thus the fixture clock does not change the production rule that startup consumes the declared job budget.

## Verification

1. The same controlled 1.1-second delay passed all three originally affected tests after the change in 15.591 seconds. Raw output: `runner-startup-trace-after.txt`; instrumented observations: `runner-startup-trace-1.1.json`.
2. The entire affected `RunnerTests` class passed once: 39 tests in 104.813 seconds, including the direct production-deadline regression, actual descendant cleanup, pre-signal snapshot protection and existing isolated guard-removal controls. Raw output: `final-runner-fixture-tests.txt`.
3. The source diff passes `git diff --check`. Exact source and raw evidence hashes are in `runner-fixture-clock-hashes.json`; the retained diff is `runner-fixture-clock.diff`.

The full integrated suite was not repeated. The unchanged tests retain their original passing result; this is a focused correction and verification of the affected class, not a fabricated single all-green 268-test run. Root owns independent scoped review, final Git operations and delivery.
