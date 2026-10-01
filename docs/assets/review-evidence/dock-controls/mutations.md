# Deliberate-defect verification

Evidence from the local implementation on 2026-10-01, based on `fd75b9c2`.

The harness saves each source file's original bytes, changes the named mechanism, runs focused assertions, and restores the original bytes in `finally`. It verifies byte equality after restoration and records the original SHA-256 digest. Rust assertion failures exit 101; web assertion failures exit 1. These are targeted checks, separate from the repository's full mutation sweep.

## Rust defects

| Change | Command | Assertions that fail |
| --- | --- | --- |
| Replace neutral default with zero | `cargo test -p terri-core -j 2 components::satisfaction_tests::starts_neutral` | Neutral start |
| Remove both clamps from addition | `cargo test -p terri-core -j 2 components::satisfaction_tests::clamps_both_ends` | Both bounds |
| Convert authored rewards at 1 instead of 0.001 | `cargo test -p terri-core -j 2 components::satisfaction_tests::converts_authored_reward_units` | Reward units |
| Ignore creation offsets and restore by adding to a default score | `cargo test -p terri-sim -j 2 --lib -- --test-threads=2 satisfaction_restores_without_reapplying_baseline_or_trait_bias shipped_household_gets_only_its_authored_initial_trait_bias move_in_applies_starting_trait_offsets_once` | Shipped values, move-in values and exact save restoration |
| Restore the old fast mood rate and make neglect too small for score precision | `cargo test -p terri-sim -j 2 --lib shipped_ -- --test-threads=2` | Month pacing and actual neglect at 100 |

[Core restoration digests](satisfaction-core-mutations.json), [creation and save digests](satisfaction-creation-mutations.json), [pacing digests](satisfaction-pacing-mutations.json).

Actual failure excerpts follow.

### Neutral start

```text
thread 'components::satisfaction_tests::starts_neutral' (55852) panicked at crates\terri-core\src\components.rs:491:9:
assertion `left == right` failed
  left: 0.0
 right: 50.0
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### Both bounds

```text
thread 'components::satisfaction_tests::clamps_both_ends' (67604) panicked at crates\terri-core\src\components.rs:498:9:
assertion `left == right` failed
  left: 120.0
 right: 100.0
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### Reward units

```text
thread 'components::satisfaction_tests::converts_authored_reward_units' (64956) panicked at crates\terri-core\src\components.rs:507:9:
assertion `left == right` failed
  left: 100.0
 right: 1.0
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### Creation offsets and exact restoration

```text
thread 'household::satisfaction_tests::shipped_household_gets_only_its_authored_initial_trait_bias' (86052) panicked at crates\terri-sim\src\household.rs:136:13:
assertion `left == right` failed
  left: Some(50.0)
 right: Some(46.0)
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### Month pacing and small neglect

```text
thread 'mood::tests::shipped_rates_move_extreme_mood_over_months_and_ordinary_mood_over_years' (62116) panicked at crates\terri-sim\src\mood.rs:486:13:
assertion failed: (ledger.value() - 50.0).abs() < 18.0
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### Exact restoration

```text
thread 'save::tests::satisfaction_restores_without_reapplying_baseline_or_trait_bias' (14596) panicked at crates\terri-sim\src\save.rs:1963:13:
assertion `left == right` failed
  left: Some(50.0)
 right: Some(0.0)

---- household::tests::move_in_applies_starting_trait_offsets_once stdout ----

```

### Public move-in offsets

```text
thread 'household::tests::move_in_applies_starting_trait_offsets_once' (68264) panicked at crates\terri-sim\src\household_tests.rs:208:9:
assertion `left == right` failed
  left: Some(100.0)
 right: Some(50.0)


failures:
    household::satisfaction_tests::shipped_household_gets_only_its_authored_initial_trait_bias
    household::tests::move_in_applies_starting_trait_offsets_once
    save::tests::satisfaction_restores_without_reapplying_baseline_or_trait_bias

test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 756 filtered out; finished in 0.01s

   Compiling terri-sim v0.1.0 (D:\VIBES\.worktrees\95bd\terrilives\crates\terri-sim)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 5.71s
     Running unittests src\lib.rs (target\debug\deps\terri_sim-0bcea68002488dc1.exe)
error: test failed, to rerun pass `-p terri-sim --lib`
```

### Actual small neglect at 100

```text
thread 'systems::satisfaction::tests::shipped_neglect_rate_still_costs_points_at_the_ceiling' (92192) panicked at crates\terri-sim\src\systems\satisfaction.rs:181:9:
assertion failed: after < 100.0 && after > 99.9999


failures:
    mood::tests::shipped_rates_move_extreme_mood_over_months_and_ordinary_mood_over_years
    systems::satisfaction::tests::shipped_neglect_rate_still_costs_points_at_the_ceiling

test result: FAILED. 15 passed; 2 failed; 0 ignored; 0 measured; 742 filtered out; finished in 36.16s

   Compiling terri-data v0.1.0 (D:\VIBES\.worktrees\95bd\terrilives\crates\terri-data)
   Compiling terri-sim v0.1.0 (D:\VIBES\.worktrees\95bd\terrilives\crates\terri-sim)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 9.56s
     Running unittests src\lib.rs (target\debug\deps\terri_sim-0bcea68002488dc1.exe)
error: test failed, to rerun pass `-p terri-sim --lib`
```

## Web defects

1. Assign Content to scores below 20. `vitest run tests/satisfaction-meter.test.ts --maxWorkers=1` fails the 0 and 19.99 band assertions.
2. Raise the display projection ceiling to 1,000. The same command fails the projection bound assertion.
3. Disable Queue mode's initial state, prevent repeated-click closure, or clear the sheet opener's expanded state. The focused Queue mode and compact HUD tests fail their corresponding assertions.

[Satisfaction web restoration digests](satisfaction-web-mutations.json) record the new meter checks. The dock-control cases also compare original source bytes and SHA-256 digests after each restoration.

The first creation/restoration run selected the entire simulation suite. Its expected failures exceeded the harness's default output buffer, so the harness could not record a normal exit. The source was restored. A subsequent run selected the three causal tests explicitly; all three failed and exited 101, and restoration was verified. This was a harness limit, not a passing mutation check.
