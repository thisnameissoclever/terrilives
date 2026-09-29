# Death slice verification

The manual mutation report in [mutations.json](mutations.json) records each removed mechanism, exact test command, nonzero exit code, actual failing assertion, and SHA-256 of the restored source. The runner restored the original bytes in a `finally` block and verified the checksum after every mutation. All listed mutations caused assertion failures rather than compile failures.

The first entity-order fixture accidentally iterated in entity order and the first record-order fixture also violated uniqueness. Both were corrected before the recorded successful checks: the former now asserts reverse raw iteration order, and the latter uses distinct valid identities. These were test weaknesses, not successful mutation evidence.

The [played notes](../../alpha-feel-notes.md#a-death) distinguish observed browser behavior from code-only checks. Screenshots record the warning and survivor grief. Local delivery checks are recorded in the pull request, on its exact reviewed head. The remote full mutation sweep is additional evidence and is not represented by these targeted checks.
