# Varied autonomy: local mutation evidence

Captured 2026-09-30 in the active terrilives worktree. These checks establish that three specific behavioral defects fail their intended assertions. They do not replace the full regression suite, the remote mutation sweep, or a played browser check.

The targeted baseline passed with `cargo test -p terri-core -p terri-sim -p terri-wasm self_preservation -- --test-threads=1`: 1 core, 9 simulation, and 4 boundary tests; exit 0. Later autonomy follow-ups changed other Rust files. A fresh successful build and three exact passing tests established the baseline for the mutation window after those compilation fixes.

## Procedure and verdict rule

Rust edits were paused during the mutation window. Each mutation changed one production mechanism. Build and test execution were separate:

```text
cargo test -p terri-sim --lib --no-run --message-format=json
```

Each build exited 0. The fresh executable from its `compiler-artifact` record ran the fully qualified test name with `--exact --nocapture --test-threads=1`. Detection required one named failed test and the intended assertion panic. A nonzero Cargo exit alone was insufficient.

After each deletion, the original mechanism was restored, the test binary rebuilt, and the affected exact test passed with exit 0. Source bytes were checked against the original snapshot. The final autonomy follow-ups came after this window; their regression results are recorded separately.

## Observed assertion failures

1. Remove seed installation before household creation in `crates/terri-sim/src/lib.rs`.

   Test: `household::tests::self_preservation_seed_precedes_household_draws_and_legacy_move_in`.

   ```text
   running 1 test
   test household::tests::self_preservation_seed_precedes_household_draws_and_legacy_move_in ... FAILED
   panicked at crates\terri-sim\src\household_tests.rs:395:9:
   assertion `left == right` failed
     left: 55
    right: 96
   test result: FAILED. 0 passed; 1 failed
   TEST EXIT 101
   ```

   Restored source bytes matched the in-memory original snapshot. Rebuilding and rerunning the same exact test produced `1 passed; 0 failed`, exit 0.

2. Replace the component hash's captured self-preservation rows with an empty vector in `crates/terri-sim/src/lib.rs`.

   Test: `household::tests::self_preservation_component_and_staged_command_cause_hash_changes`.

   ```text
   running 1 test
   test household::tests::self_preservation_component_and_staged_command_cause_hash_changes ... FAILED
   panicked at crates\terri-sim\src\household_tests.rs:483:5:
   assertion `left != right` failed
     left: 5912772670859666743
    right: 5912772670859666743
   test result: FAILED. 0 passed; 1 failed
   TEST EXIT 101
   ```

   The completed proof used a persistent original-byte backup. After restoring the capture statement, the source matched that backup byte for byte; SHA-256 `eac6e234a52f6fb7a560d6fe6b036a24dd5a62d82d7feadf3d460f037478b803`. Rebuilding and rerunning the same exact test produced `1 passed; 0 failed`, exit 0.

3. Remove insertion of explicitly saved rows from `save/self_preservation.rs::restore`.

   Test: `save::self_preservation::tests::self_preservation_migration_draws_stably_then_persists_zero_without_redraw`.

   ```text
   running 1 test
   test save::self_preservation::tests::self_preservation_migration_draws_stably_then_persists_zero_without_redraw ... FAILED
   panicked at crates\terri-sim\src\save\self_preservation.rs:68:9:
   assertion `left == right` failed
     left: [(34, 47), (35, 69), (36, 40)]
    right: [(34, 47), (35, 0), (36, 69)]
   test result: FAILED. 0 passed; 1 failed
   TEST EXIT 101
   ```

   Losing a saved zero drew a replacement and shifted the following person's draw. After restoring the insertion, the source matched the persistent backup byte for byte; SHA-256 `2da60184f8f3eae2899bd19953af5b0aeca2fe0fe4e0596242ee8d3a518a3d55`. Rebuilding and rerunning the same exact test produced `1 passed; 0 failed`, exit 0.

## Rejected evidence and harness corrections

An earlier harness ran three mutation commands while new autonomy tests contained unavailable `Needs::default()` calls. All three failed compilation with E0599 before any test ran. Those failures provide no mutation evidence. The corrected harness separated successful compilation from exact assertion execution, and the compilation defect was fixed before establishing a new baseline.

A Python restoration during the first component-hash attempt failed with Windows `OSError: [Errno 22] Invalid argument` while opening `lib.rs`. The one-line mutation was immediately reversed with the normal patch tool, and its rebuilt test passed. The hash proof was then repeated using a persistent byte backup and patch edits in both directions, so its completed restoration could be verified independently of the interrupted Python process.

At the end of the completed window, all three production mechanisms were restored and each affected test passed against a fresh binary. No mutation remained in the source.

## Autonomy policy verification

The later exclusive window began after the full workspace checks and release WASM build. A new successful no-run build and four exact passing tests established its baseline. Each of the five cases below changed one mechanism, required its named assertion to fail, then restored bytes and passed that exact test against a rebuilt executable. The original-byte backups and raw build/test logs remain in the task's temporary evidence directory.

## Autonomy mutation 1: telemetry

Remove publication of the selected decision probabilities.

Exact test: systems::autonomy::schedule_tests::critical_wait_releases_the_previous_stroll_without_moving.

Mutant and restored builds both exited 0. The mutant exact test exited 101:

```text
running 1 test

thread 'systems::autonomy::schedule_tests::critical_wait_releases_the_previous_stroll_without_moving' (69652) panicked at crates\terri-sim\src\systems\autonomy.rs:625:9:
autonomy must publish its actual selection probabilities
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
test systems::autonomy::schedule_tests::critical_wait_releases_the_previous_stroll_without_moving ... FAILED

failures:

failures:
    systems::autonomy::schedule_tests::critical_wait_releases_the_previous_stroll_without_moving

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 671 filtered out; finished in 0.01s
```

Restored source matched the frozen byte backup; SHA-256 41170ccf26c7bd533472065983cf42aaee8c18bc1891cdc88aabd8d87ea338b3. The rebuilt exact test passed: 1 passed; 0 failed, exit 0.

## Autonomy mutation 2: path-release

Remove the Path release when an urgent choice replaces a committed stroll.

Exact test: systems::autonomy::schedule_tests::critical_wait_releases_the_previous_stroll_without_moving.

Mutant and restored builds both exited 0. The mutant exact test exited 101:

```text
running 1 test

thread 'systems::autonomy::schedule_tests::critical_wait_releases_the_previous_stroll_without_moving' (63368) panicked at crates\terri-sim\src\systems\autonomy.rs:635:9:
assertion failed: sim.world().get::<Path>(agent).is_none()
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
test systems::autonomy::schedule_tests::critical_wait_releases_the_previous_stroll_without_moving ... FAILED

failures:

failures:
    systems::autonomy::schedule_tests::critical_wait_releases_the_previous_stroll_without_moving

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 671 filtered out; finished in 0.01s
```

Restored source matched the frozen byte backup; SHA-256 41170ccf26c7bd533472065983cf42aaee8c18bc1891cdc88aabd8d87ea338b3. The rebuilt exact test passed: 1 passed; 0 failed, exit 0.

## Autonomy mutation 3: minimum-bucket

Remove the minimum one-bucket allocation for microscopic alternatives.

Exact test: systems::autonomy::tests::microscopic_alternatives_retain_an_actual_random_bucket.

Mutant and restored builds both exited 0. The mutant exact test exited 101:

```text
running 1 test

thread 'systems::autonomy::tests::microscopic_alternatives_retain_an_actual_random_bucket' (68704) panicked at crates\terri-sim\src\systems\autonomy.rs:400:9:
assertion `left == right` failed
  left: [0, 0]
 right: [1, 1]
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
test systems::autonomy::tests::microscopic_alternatives_retain_an_actual_random_bucket ... FAILED

failures:

failures:
    systems::autonomy::tests::microscopic_alternatives_retain_an_actual_random_bucket

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 671 filtered out; finished in 0.00s
```

Restored source matched the frozen byte backup; SHA-256 aa2750d7abf1972e8aefc661e5989865822867bf40003d6d034eeaa829153fb0. The rebuilt exact test passed: 1 passed; 0 failed, exit 0.

## Autonomy mutation 4: comfort

Fix the comfort interpolation factor at zero.

Exact test: systems::autonomy::tests::comfortable_choices_are_more_varied_without_erasing_the_best_option.

Mutant and restored builds both exited 0. The mutant exact test exited 101:

```text
running 1 test

thread 'systems::autonomy::tests::comfortable_choices_are_more_varied_without_erasing_the_best_option' (74304) panicked at crates\terri-sim\src\systems\autonomy.rs:308:9:
assertion `left == right` failed
  left: 0.005
 right: 0.2
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
test systems::autonomy::tests::comfortable_choices_are_more_varied_without_erasing_the_best_option ... FAILED

failures:

failures:
    systems::autonomy::tests::comfortable_choices_are_more_varied_without_erasing_the_best_option

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 671 filtered out; finished in 0.01s
```

Restored source matched the frozen byte backup; SHA-256 aa2750d7abf1972e8aefc661e5989865822867bf40003d6d034eeaa829153fb0. The rebuilt exact test passed: 1 passed; 0 failed, exit 0.

## Autonomy mutation 5: exploration

Remove the positive exploration contribution from normalized probabilities.

Exact test: systems::autonomy::tests::underflowing_utility_keeps_a_positive_alternative_through_exploration.

Mutant and restored builds both exited 0. The mutant exact test exited 101:

```text
running 1 test

thread 'systems::autonomy::tests::underflowing_utility_keeps_a_positive_alternative_through_exploration' (52084) panicked at crates\terri-sim\src\systems\autonomy.rs:407:9:
assertion failed: p[1] > 0.0 && p[0] < 1.0
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
test systems::autonomy::tests::underflowing_utility_keeps_a_positive_alternative_through_exploration ... FAILED

failures:

failures:
    systems::autonomy::tests::underflowing_utility_keeps_a_positive_alternative_through_exploration

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 671 filtered out; finished in 0.00s
```

Restored source matched the frozen byte backup; SHA-256 aa2750d7abf1972e8aefc661e5989865822867bf40003d6d034eeaa829153fb0. The rebuilt exact test passed: 1 passed; 0 failed, exit 0.

## Fresh-review mutation 1: stable legacy migration order

The review found that naturally ordered fixtures did not constrain the migration
sort. The new fixture moves an entity between ECS tables, verifies that query
order differs from Sim order, and compares assignments with sorted reference draws.

Command: `cargo test -p terri-sim self_preservation_migration_sorts_reordered_storage_before_drawing -- --test-threads=1`.

Removing only `people.sort_unstable_by_key(|entity| entity.index_u32());` compiled
successfully and exited 101 with the intended assertion:

```text
assertion `left == right` failed
  left: [(0, 49), (1, 51), (2, 47)]
 right: [(0, 47), (1, 51), (2, 49)]
test result: FAILED. 0 passed; 1 failed
```

Restoration matched SHA-256
`57448982e06c60e6eabcef79ccc4d98c4cec839cccef17c7fd40dca1091f0a60`.
The rebuilt original test passed, exit 0.

## Fresh-review mutation 2: browser entropy reaches the real constructor

The review found that the helper and seeded simulation tests bypassed the
production startup call. The new test executes the actual construction statements
from `main.ts` with controlled browser entropy and observes constructor arguments.

Command in `web/`: `npm test -- --maxWorkers=1 tests/new-game-seed.test.ts`.

Replacing the production call's two seed arguments with `0, 0` exited 1:

```text
FAIL forwards fresh browser entropy through the production startup constructor
AssertionError: expected [ +0, +0 ] to deeply equal [ 1, 4275878552 ]
Tests 1 failed | 1 passed (2)
```

Restoration matched SHA-256
`1e10681338bb4d02136f5d5a62c9e5e3ca907fa6ddef720ab6a787ff81253908`.
Both original tests passed after restoration, exit 0. All mutations in this
record were temporary; none is retained in the delivered source.
