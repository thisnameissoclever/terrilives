# Mutation runner verification, October 19, 2026

These records cover the Python mutation manifest, process controller and artifact recovery code at `7e042f78c4edfdfacaa2e8de4d2bea197dd9a180`. They do not certify a GitHub workflow or a completed native mutation campaign.

The final focused suite passed 99 tests, including 15 isolated checks that deliberately remove safeguards and require the intended assertions to fail. Independent review found and verified repairs for executable selection, owned-source changes, current-input validation and observation of partial source writes. The final scoped approval is [task-2-rereview2.md](task-2-rereview2.md). Earlier reports retain their original findings and proof boundaries.

[verification.json](verification.json) identifies source hashes and the tested revisions. [focused-tests.txt](focused-tests.txt), [input-binding-controls.json](input-binding-controls.json) and [active-write-controls.json](active-write-controls.json) retain the test and fault-control output. Original execution paths in the reports describe the local run; the linked files here are retained copies.

The text log uses LF line endings and omits trailing whitespace and blank final lines. The receipt records both original and retained byte digests. The original local log remains unchanged.

The fixtures use disposable Git repositories, Python child processes and simulated GitHub API responses. They do not establish real Linux process cleanup, authenticated GitHub interruption and recovery, production artifact capacity or complete game mutation coverage. The stock tool's field-selection defect remains a separate issue; no patched tool was built or executed for these records. Workflow integration and real qualification require the owner's separate tool decision.
