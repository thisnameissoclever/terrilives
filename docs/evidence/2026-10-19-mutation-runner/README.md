# Mutation runner verification, October 19, 2026

These records cover the Python mutation manifest, process controller and artifact recovery code at `7e042f78c4edfdfacaa2e8de4d2bea197dd9a180`. They do not certify a GitHub workflow or a completed native mutation campaign.

The final focused suite passed 99 tests, including 15 isolated checks that deliberately remove safeguards and require the intended assertions to fail. Independent review found and verified repairs for executable selection, owned-source changes, current-input validation and observation of partial source writes. The final scoped approval is [task-2-rereview2.md](task-2-rereview2.md). Earlier reports retain their original findings and proof boundaries.

[verification.json](verification.json) identifies source hashes and the tested revisions. [focused-tests.txt](focused-tests.txt), [input-binding-controls.json](input-binding-controls.json) and [active-write-controls.json](active-write-controls.json) retain the test and fault-control output. Original execution paths in the reports describe the local run; the linked files here are retained copies.

The text log uses LF line endings and omits trailing whitespace and blank final lines. The receipt records both original and retained byte digests. The original local log remains unchanged.

The fixtures use disposable Git repositories, Python child processes and simulated GitHub API responses. They do not establish real Linux process cleanup, authenticated GitHub interruption and recovery, production artifact capacity or complete game mutation coverage. No patched tool was built or executed for this earlier Task 2 record. The owner's later approval and the subsequent [isolated Windows tool qualification](isolated-tool/README.md) are separate evidence. Workflow integration and real Linux qualification remain distinct gates.

The [V20 Windows inventory comparison](isolated-tool/v20/README.md) follows the native source integration. The [workflow recovery implementation record](task-3-core/README.md) covers its later committed source and independent reviews. Each record states its own revision and proof limits.

The [native-admission implementation](task-3-native-admission/initial/README.md), [forecast correction](task-3-native-admission/fix1/README.md) and [bounded-batch correction](task-3-native-batch-budget/README.md) retain their local checks and independent reviews separately from actual GitHub qualification and production coverage.
