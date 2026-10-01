# Reservation release evidence

This is the release foundation for bed assignment. Shared-target fixtures
are deliberate synthetic states; they prove cleanup, not two-person bed
admission or occupied visual fit. No new sleep capacity is enabled.

Each fault ran `cargo test -p terri-sim reservations -- --test-threads=1`.
All thirteen exited 101 with named assertion failures, not compilation
failures. After each run the exact original file bytes were restored and
their SHA-256 compared equal. Logs and the replay script are retained locally
under `.tmp/bed-assignment/`.

| Fault | Failed assertions | Exact bytes restored |
| --- | ---: | --- |
| ignore-other-owner | 15 | True |
| count-departing-owner | 5 | True |
| ignore-replacement-commitment | 1 | True |
| ignore-target-object | 2 | True |
| omit-marker-release | 9 | True |
| eager-completion-release | 1 | True |
| eager-order-release | 2 | True |
| eager-chain-cancel-release | 1 | True |
| eager-retarget-release | 3 | True |
| eager-career-release | 1 | True |
| eager-chain-completion-release | 1 | True |
| eager-death-release | 1 | True |
| eager-invalid-owner-release | 1 | True |

## Observed failures

The restored code passed `cargo test --workspace -- --test-threads=1`
(1,241 tests), strict Clippy, formatting, WASM compilation, web typecheck,
`npm test -- --maxWorkers=1` (1,494 tests), the production build, 219 asset
tests, atlas reproducibility, document IDs and 15 CI-script tests. Independent
adversarial review found no blockers in the release-only foundation.

The displayed production build on isolated origin `127.0.0.1:5204` showed Tim
sleeping in the bunk, accepted a replacement double-bed order, and showed
`Go to bed: The Restorative Unit`. Paused Clear orders changed Tim to deciding
with no queued actions. Bill then received that same bed order and reached
Sleeping with the named action in his queue. No browser errors or warnings
were recorded. The owned page was closed in a finally block and its preview
server was stopped. This proves the ordinary release flow in the built game,
not two simultaneous sleeping places or a new double-bed pose.

After integrating main `522260d0` (door recordings), the combined web
typecheck, all 1,535 web tests and production build passed. That integration
changed no Rust, compiled game content or Cargo files, so the native checks
above still cover the exact simulation source. Document IDs and whitespace
checks passed again for the combined tree.

The first assertion output for each fault follows.

### ignore-other-owner

```text
thread 'reservations::tests::earlier_claim_keeps_marker_when_previous_owner_leaves' (52716) panicked at crates\terri-sim\src\reservations.rs:117:9:
assertion failed: world.get::<Reserved>(object).is_some()
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### count-departing-owner

```text
thread 'mortality::tests::removing_a_redirected_conversation_initiator_releases_both_reservations' (38356) panicked at crates\terri-sim\src\mortality.rs:1047:9:
assertion failed: sim.world().get::<terri_core::Reserved>(object).is_none()
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### ignore-replacement-commitment

```text
thread 'reservations::tests::stale_release_preserves_replacement_on_the_same_object' (38216) panicked at crates\terri-sim\src\reservations.rs:87:9:
assertion failed: world.get::<Reserved>(object).is_some()
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### ignore-target-object

```text
thread 'mortality::tests::removing_a_redirected_conversation_initiator_releases_both_reservations' (70584) panicked at crates\terri-sim\src\mortality.rs:1048:9:
assertion failed: sim.world().get::<terri_core::Reserved>(partner).is_none()
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### omit-marker-release

```text
thread 'mortality::tests::removing_a_redirected_conversation_initiator_releases_both_reservations' (68804) panicked at crates\terri-sim\src\mortality.rs:1047:9:
assertion failed: sim.world().get::<terri_core::Reserved>(object).is_none()
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### eager-completion-release

```text
thread 'reservations_tests::completion_preserves_another_occupant_and_last_completion_frees_object' (53088) panicked at crates\terri-sim\src\reservations_tests.rs:73:5:
other owner's marker was cleared
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### eager-order-release

```text
thread 'reservations_tests::cancelling_one_order_preserves_another_occupant_and_batch_cancel_frees_object' (63584) panicked at crates\terri-sim\src\reservations_tests.rs:73:5:
other owner's marker was cleared
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### eager-chain-cancel-release

```text
thread 'reservations_tests::cancelling_a_chain_station_preserves_another_target_owner' (536) panicked at crates\terri-sim\src\reservations_tests.rs:73:5:
other owner's marker was cleared
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### eager-retarget-release

```text
thread 'reservations_tests::retargeting_a_chain_preserves_the_other_occupant' (35268) panicked at crates\terri-sim\src\reservations_tests.rs:73:5:
other owner's marker was cleared
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### eager-career-release

```text
thread 'reservations_tests::leaving_for_work_preserves_the_other_occupant' (29168) panicked at crates\terri-sim\src\reservations_tests.rs:73:5:
other owner's marker was cleared
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### eager-chain-completion-release

```text
thread 'reservations_tests::completing_a_chain_station_preserves_another_target_owner' (56896) panicked at crates\terri-sim\src\reservations_tests.rs:73:5:
other owner's marker was cleared
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### eager-death-release

```text
thread 'reservations_tests::death_preserves_the_other_occupant' (44404) panicked at crates\terri-sim\src\reservations_tests.rs:73:5:
other owner's marker was cleared
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

### eager-invalid-owner-release

```text
thread 'reservations_tests::invalid_owner_cleanup_preserves_another_occupant_then_frees_the_last' (16308) panicked at crates\terri-sim\src\reservations_tests.rs:73:5:
other owner's marker was cleared
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

## Restoration digests

| Faults sharing a source file | Original and restored SHA-256 |
| --- | --- |
| ignore-other-owner, count-departing-owner, ignore-replacement-commitment, ignore-target-object, omit-marker-release | `05a754d0b3c0e9314270aff6348c20bf5f54be0723ccecd5cfac7a95dd12d937` |
| eager-completion-release | `faa3d96032cead9800556807916e6e80ad8d9dab2a77588c6d8984e4c7e242bc` |
| eager-order-release, eager-chain-cancel-release | `abf72b076c5134419f485d50dc6ed7c5333a8532e4a4a35c65c5405ab185705c` |
| eager-retarget-release | `70ee6dcc14195db4f6579c51b5b95d06374af7270388328b1e281b5801bf6b93` |
| eager-career-release | `9e179b97f808f7f49f8bb84e071435b6b231fb54d3b195d2659c5ceb098d19fd` |
| eager-chain-completion-release | `eb008676e02ae27b0ddbc5b26c19263eeb3c5ebb2bad716c55ec51ce2bfc2a1b` |
| eager-death-release, eager-invalid-owner-release | `f5199c75c7689ca64be21106f64c14fa11314dbb0135d8814d9e6e4f7eb1eb22` |
