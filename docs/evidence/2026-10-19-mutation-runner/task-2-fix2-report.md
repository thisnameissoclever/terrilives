# Task 2 fix round 2: active-file observation

The remaining P2 race is repaired and frozen for scoped re-review. All 99 focused Python tests pass. Only `mutation_runner.py` and `test_mutation_runner.py` changed. The approved model, artifact implementation and their tests remain byte-identical. This round did not reopen the three approved P1 repairs.

## Reproduction and repair

Two new deterministic fixtures reproduced the defect before the repair. Each real Python child published a valid report, opened the pending source file with `wb`, and paused after truncation or a partial write. The input observer read those partial bytes before releasing the child to finish the exact approved apply or revert. The process wrapper ensured that write finished before shutdown. Both tests proved the final source bytes were exact and the report bytes were unchanged, then failed because the controller returned `infrastructure_failure` instead of an incomplete checkpoint. The retained output is `.local-build/build-ui-followup/task-2-fix2-controls/before-fix.txt`; both failures were ordinary state assertions.

`OwnedInputs.verify()` now has a strict default and an explicit `defer_active_write` option used only while the mutation process is running. A byte mismatch in the currently pending mutation's file can produce the typed `ActiveInputTransition` exception. Before raising it, verification still checks every other scoped input. Unexpected paths, modes, links, lockfile changes and unrelated source changes remain failures. This avoids treating the first partial file encountered as permission to skip later checks.

The controller handles that one typed observation by deferring report acceptance. It retains the earlier accepted snapshot and imports no records from the deferred report. Polling intervals, policy outcomes and tool timeout semantics are unchanged. The stopped-process boundary uses strict verification, including when an interruption leaves an active mutation in place: final source bytes must be exactly original or the permitted pending mutation. Permanently corrupt bytes fail and discard the checkpoint. No files are reset to make evidence acceptable.

The controller separately remembers the pending position from a report parsed and schema-validated before signaling. That position is used only to check final source bytes. It does not add the deferred report's terminal records to the frozen snapshot. A targeted deadline fixture proves this distinction: the report contains a valid completed mutation, its active source observation is deferred, and the write finishes before shutdown, but the result still has no accepted snapshot or new terminal progress.

## Verification

The five fixture cases cover:

1. An apply transition with an empty source read, followed by the exact pending mutation.
2. A revert transition with a partial source read, followed by exact original bytes.
3. A permanently corrupt active file that remains invalid at the final stopped-process boundary.
4. A partial active file combined with a changed Cargo.lock or another source file. Both unrelated changes cause immediate refusal, including when the partial file appears earlier in the observed input ordering.
5. Shutdown after a deferred observation, proving that eventual exact source bytes do not retroactively import unaccepted terminal records.

The fixtures record each verification observation and assert that no partial observation returns success. They synchronize through task-owned files rather than hoping a sleep lands in the write window. Their process teardown reaps the owned children.

Three isolated controls prove the new tests detect losing the required behavior:

| Control | Observed test failure |
| --- | --- |
| Disable running active-file deferral | The legitimate apply transition again fails as infrastructure failure. |
| Return success instead of raising the typed deferral | The fixture detects acceptance of partial input bytes. |
| Remove final stopped-process source verification | Permanently corrupt active bytes incorrectly survive as an incomplete result. |

Each control exits 1 with the intended assertion failure, rejects syntax/import errors and verifies unchanged source bytes. Exact control stdout/stderr and source hashes are retained in `.local-build/build-ui-followup/task-2-fix2-controls/active-write-controls.json`. The previously approved twelve controls also passed in the full focused suite.

Targeted verification ran the five fixture tests and the control test:

```text
Ran 6 tests in 6.892s
OK
```

The final focused command was:

```text
python -B -m unittest discover -s .github/scripts -p 'test_mutation_*.py'
Ran 99 tests in 30.509s
OK
```

Full command output is retained in `targeted-after-fix.txt` and `focused-tests.txt` under the same ignored controls directory. All fixture repositories and source trees were disposable and independent of the live project. Root's concurrent main integration did not change the six Python files or supply native inputs to these tests.

## Frozen scope

Preimages are retained under `.superpowers/sdd/mutation-campaign-repair-plan/task-2-fix2-before/`. The fix-only diff is `.superpowers/sdd/mutation-campaign-repair-plan/task-2-fix2-review-package.diff`, SHA-256 `27a4a0bcc6503a90216e30316a1cdd4c3ff52ba8075d2ee8c276bf13b13aeb0f`.

| File | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| `mutation_runner.py` | `7aea3b593a2fa5907eb2fa380aa38cae47d4cb9a8db6f70db867644597ec3c05` | `bf2d8d292bdc68ac7ca1bfd63b803c364b7c124ee0de7175955b4eaf0f969982` |
| `test_mutation_runner.py` | `39a0a09f8eea81c3a68e15de821086091b060e5061abf36c6173dcf7ec2aee1f` | `9e1095cad1da92f7fa5a7f0c010e7fd3512768fe38402e0af514532b9f60f25e` |

`frozen-evidence.json` in the controls directory also records the unchanged hashes for `mutation_campaign.py`, `test_mutation_campaign.py`, `mutation_artifacts.py` and `test_mutation_artifacts.py`. No SDK build/install, native game build/test, campaign, workflow, browser, Git mutation or nested agent was used in this round.

The CLI, artifact schema and aggregate API are unchanged. `OwnedInputs.verify(..., defer_active_write=False)` defaults to strict verification; calibration, selection and final shutdown keep that default. The real Linux/tool transition exercise and the other previously documented Task 3 gates remain open. This Python proof does not establish production throughput or campaign completion.

Ownership of the two Python files and this round's ignored report/diff is released. Root owns scoped re-review, commits and delivery.

**Next steps**: Root can review the narrow frozen diff and retained positive, negative and guard-removal evidence. No user action is needed for this executor correction.
