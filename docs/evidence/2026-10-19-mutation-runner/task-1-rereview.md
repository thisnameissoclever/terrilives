# Task 1 scoped re-review

Spec verdict: approved for Task 1. Code-quality verdict: approved for Task 1. Both prior findings are resolved; no new actionable regression was found in the repair diff.

Reviewed `task-1-fix-round-1.diff`, its five executed controls, the appended implementation report, and the affected source and tests. Verified current SHA-256 values match the reviewed correction:

| File | SHA-256 |
| --- | --- |
| `.github/scripts/mutation_campaign.py` | `9d97531c39c5eb93b15c91493e39c597fe64ce300aae8c7e54e50ab0279ea203` |
| `.github/scripts/test_mutation_campaign.py` | `3d201a2821e8aa49533b781e88caaf863564d2050a5847f5cf6f6dc49c67acde` |

1. **P1 resolved.** Survivor allowances use counted entries. Each matching miss consumes one allowance in canonical manifest order, and excess misses retain their exact failing IDs. Allocation precedes slot projection and is independent of record input order. The added tests cover one, two and three allowances, exactly two matching misses, and global allocation across all eight slots. Timeout outcomes still fail without consuming a survivor allowance; caught and unviable outcomes do not consume one either. The set-membership fault now fails both the counted-allocation and global-allocation tests.
2. **P2 resolved.** Each of the four new tests supplies otherwise consistent bad evidence and asserts the intended rejection. The retained control logs show ordinary assertion failures when the corresponding guard is removed: completed-batch coverage, report identity uniqueness, phase ordering and function-span containment. None relies on an import, syntax or unrelated execution error.

The correction report records 32 passing focused tests, including the retained-inventory check. I inspected the five raw fault logs under the reported temporary directory's `controls/` subdirectory and confirmed their named failures match `task-1-fix-round-1-controls.json`. I did not rerun those passing checks or broaden the review into unrelated model behavior, game tests or workflow execution.

Task 2 must honor the documented caller contract: authoritative survivor policy needs the complete merged record collection before any slot projection. A worker's partial collection cannot establish final campaign acceptance. This is an integration requirement, not an unresolved Task 1 finding. No campaign execution, artifact authentication, capacity measurement or production completion is approved by this pure-model review.

No production source or tests were modified during re-review.

**Next steps**: Root can proceed to Task 2 using the approved pure-model interface. No user action is needed.
