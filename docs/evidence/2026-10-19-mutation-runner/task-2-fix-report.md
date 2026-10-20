# Task 2 fix wave 1

All three reviewed P1 defects are repaired and frozen for scoped re-review. The final focused suite passed 93 tests in 23.530 seconds. Seven new isolated guard-removal controls produced their intended assertion failures; the original five controls still pass. No real mutation campaign, native game test/build, tool installation, tool patch, workflow dispatch, index change, commit or push was performed.

The stock tool's known StructField selection defect remains a separate fail-closed blocker. These executor repairs do not approve a tool replacement or establish production capacity.

## Fixes

1. **Exact executable binding.** `installed_tool()` resolves the plugin once, accounting for Cargo's extra Cargo-home bin search location, hashes that absolute executable, and asks that same executable for its version. `tool_argv()` verifies the retained byte digest before constructing every enumeration, selected-enumeration and mutation command. Every command begins with `[absolute_executable, "mutants"]`; the second argument preserves cargo-mutants' Cargo-plugin parser convention. The process never returns to `cargo mutants` dispatch after selecting the executable. `installed_tool()` now includes an ephemeral `executable` field; `tool_identity()` keeps only version and byte digest in reusable fingerprints, so identical bytes at another absolute location do not change the computation identity.
2. **Owned input verification.** `OwnedInputs` freezes actual file bytes, modes and the scoped path set in the owned workspace. Calibration checks them after each phase and once more before accepting its receipt. Selection must leave them unchanged. Each newly accepted report checks them again, allowing only unchanged input or the exact next pending mutation in its expected file. After shutdown the controller verifies the owned inputs before returning any checkpoint. Unexpected lockfile, source, mode, path or link changes discard the checkpoint and return infrastructure failure; the code never resets a changed tree and then accepts the earlier result.
3. **Current aggregate acceptance.** The aggregate independently reconstructs and compares the current clean source and execution fingerprint before reading historical coverage and again before writing acceptance. It binds actual current checkout metadata to the current chain entry and retains both the current checkout and the original tested checkout in its detailed report. Every mutation worker actually listed in the current attempt must have its own authenticated current-attempt evidence. A failed listed job cannot pass by carrying a bundle that claims completion. Complete historical coverage no longer bypasses these checks.

Both calibration phases now pass `--locked`. Mutation execution passes `--cargo-arg=--locked` alongside the single workspace argument. The generated tiny fixture includes a deterministic Cargo.lock. The narrowly authorized Task 1 change accepts `--locked` once in normalized Cargo argv, retains it in declared-versus-observed comparison, and rejects duplicates. No other model rule changed. The new model regression covers valid locked commands, missing/extra locked flags, duplicate observed flags and duplicate declared flags.

The exact pending-mutation bytes follow the reviewed upstream commit `8ab1dc786a1f61a4e370416cc6c68b81a704e917`: source loading normalizes CRLF, replacement uses character-based line/column coordinates and the tool's marker comment, and each completed mutation is reverted before its outcome is published. This permits the next active mutation left behind by a controlled interruption without permitting arbitrary changes to that file or another file. The source was inspected read-only; no SDK was built. Relevant upstream files are [source.rs](https://github.com/sourcefrog/cargo-mutants/blob/8ab1dc786a1f61a4e370416cc6c68b81a704e917/src/source.rs), [span.rs](https://github.com/sourcefrog/cargo-mutants/blob/8ab1dc786a1f61a4e370416cc6c68b81a704e917/src/span.rs), [mutant.rs](https://github.com/sourcefrog/cargo-mutants/blob/8ab1dc786a1f61a4e370416cc6c68b81a704e917/src/mutant.rs) and [lab.rs](https://github.com/sourcefrog/cargo-mutants/blob/8ab1dc786a1f61a4e370416cc6c68b81a704e917/src/lab.rs).

Validation reads actual bytes. While a process is running, an unchanged raw report does not trigger another whole-tree hash pass. New acceptance events, calibration phase boundaries and final shutdown still validate inputs. A report that changes during an input check is deferred. These checks establish input state at those observation boundaries. Task 3 still needs to measure validation and upload reserves, and exercise the Linux implementation with the real pinned tool.

## Regression and control evidence

Final command:

```text
python -B -m unittest discover -s .github/scripts -p 'test_mutation_*.py'
Ran 93 tests in 23.530s
OK
```

The complete output is retained at `.local-build/build-ui-followup/task-2-fix-controls/focused-tests.txt`. `fix-controls.json` in the same directory retains each new control's exact test name, exit code, stdout, stderr and the compared source hashes. Every control exits 1 with an ordinary assertion failure; each rejects import/syntax errors and verifies that production source bytes are unchanged.

| Isolated fault | Regression that detects it |
| --- | --- |
| Return to indirect Cargo plugin dispatch | Divergent Cargo-home and PATH candidates with the same displayed version; every invoked path must equal the hashed absolute plugin. |
| Remove the executable byte check | Changing the resolved executable's bytes must invalidate later command construction. |
| Remove calibration's immediate phase check | A real fixture process changes owned Cargo.lock or a native input; calibration must reject it before the test phase and leave the original checkout clean. |
| Remove the owned-result byte check | A valid completed report cannot rescue an owned lockfile or another tracked source input changed by the child process. |
| Replace current-context reconstruction with the historical declared inputs | Complete authenticated historical coverage must not accept a new native-input commit. |
| Remove current worker failure/evidence checks | Complete historical coverage must not accept an actual current validation failure with no current artifact. |
| Remove the locked-option duplicate guard | Duplicate locked flags must be rejected by the exact normalization rule. |

Positive controls preserve the intended behavior: the exact pending mutation is accepted after interruption; another pending identity or an unexpected mutation in a normally completed invocation is rejected. Unicode coordinates and CRLF normalization have a focused fixture. The aggregate regressions use real disposable Git commits and the injectable GitHub API fixtures, including actual ZIP digests, authenticated producer receipts, job-log markers, raw-report validation and model merging. They cover changed native inputs, changed execution settings, a documentation-only commit with a different checkout SHA, a failed current job after a complete bundle, and complete historical coverage with failed current validation.

Partial reruns remain supported. The aggregate checks the mutation workers present in the current attempt's paginated job list; it does not demand all eight jobs. Historical results for previously successful slots can be reused when those slots are absent from a failed-job rerun. An aggregate-only rerun can reuse exact historical coverage after its independent current-context checks, provided no actual current worker failed. Tests cover one current worker and zero current workers. The real API's partial-rerun behavior remains part of Task 3's GitHub qualification.

## API and command contract changes

The CLI commands and arguments are unchanged. Aggregate's existing `--root` now controls real source verification. The Python aggregate call is now:

```python
aggregate(root, planned, chain, settings, output, api=None)
```

`planned` is the complete original plan object, including `manifest` and frozen `calibration`, rather than only the manifest. The aggregate needs the same current toolchain/environment settings as workers so it can independently reconstruct the execution fingerprint. Documentation-only continuation is decided by identical computation inputs, not equal commit/tree SHAs.

`collect_context(root, settings, calibration, *, tool=None)` accepts an already resolved executable binding, letting a slot use one binding for context enumeration, selected enumeration and execution. `generation_argv(scope, tool=None)` uses the bound executable when supplied and a path-independent plugin name in the fingerprint. `execution_argv(settings, calibration, tool, config, output_parent)` centralizes the production command contract. The optional `input_guard` on `run_controller()` is always supplied by production slot execution.

The retained `.local-build/build-ui-followup/task-2-fix-controls/command-contract.json` contains the exact absolute version/listing/selection/execution arguments and normalized Cargo build/test arguments. Only the resolved stock executable's version command was actually executed while generating this report. Its identity was:

```text
C:\Users\myema\.cargo\bin\cargo-mutants.exe
version: 27.1.0
SHA-256: b4173bae5c104a37e72c1944b5f7ef79b6f235e09f5e6a7bcc5e6771bb75c406
```

The production execution shape is:

```text
ABSOLUTE_CARGO_MUTANTS_EXE mutants
  -p terri-core -p terri-sim -p terri-data -p terri-wasm
  --config TASK_TEMP/batch.toml
  --test-workspace false --cap-lints true
  --cargo-arg=--workspace --cargo-arg=--locked
  --timeout FIXED_CALIBRATED_SECONDS --build-timeout FIXED_BUILD_SECONDS
  --jobs 1 --no-shuffle --in-place --output TASK_TEMP/attempt
```

The expected normalized Cargo phases are `cargo test --no-run --verbose --workspace --locked` and `cargo test --verbose --workspace --locked`. The report's illustrative cap values are argument-contract examples, not a production calibration result. Actual tool-phase argv still needs inspection in the real qualification run.

## Frozen review package

Original Task 2 preimages were copied before editing and match the previously reviewed hashes. The two model preimages were also compared with the blobs at `e2f4452c41221a625e42ec173f2886d8b9ece34f`; only line-ending normalization was permitted for that comparison. They are retained in `.superpowers/sdd/mutation-campaign-repair-plan/task-2-fix-before/`.

The fix-only diff is `.superpowers/sdd/mutation-campaign-repair-plan/task-2-fix-review-package.diff`, SHA-256 `898c523885e0002ea8824ae16c107a4c35445ca77e9bdbdd63c8f476bee8b15b`. It contains no unrelated work and was generated without touching the Git index.

| File | Frozen SHA-256 |
| --- | --- |
| `mutation_runner.py` | `7aea3b593a2fa5907eb2fa380aa38cae47d4cb9a8db6f70db867644597ec3c05` |
| `test_mutation_runner.py` | `39a0a09f8eea81c3a68e15de821086091b060e5061abf36c6173dcf7ec2aee1f` |
| `mutation_campaign.py` | `c929edbd45d8e0bca0afb5d23a4e8ac45bc8d266881df38e88baacc793a54895` |
| `test_mutation_campaign.py` | `67285350a74a3d34296ac980f882f9448a3eea8798d98fed710cc90b9f45bce6` |
| `mutation_artifacts.py`, unchanged | `ca2a65a9e045255a509fb51df77dc13a467acd6f5a9348ea2107050e107bbded` |
| `test_mutation_artifacts.py`, unchanged | `a92aa57faa496f96c331b7e298f08975496ac2c0ac1319d466285ecc91890420` |

The pinned upstream raw source files are retained under `.local-build/build-ui-followup/task-2-fix-source/`. The final command-contract JSON records before/after hashes and the diff digest. The seven control logs record the same final source hashes.

Ownership of the four Task 2 Python files, the narrowly authorized model/test edits and this fix report is released. Root owns scoped re-review, main integration, the pending tool decision, Task 3 and delivery. No GitHub or production completion claim is made by this fix wave.

**Next steps**: Root can review the frozen fix-only package and retained controls, then integrate main after approval. No additional user action is needed for these executor repairs.
