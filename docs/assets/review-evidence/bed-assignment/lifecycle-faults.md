# Shared-bed lifecycle fault checks

2026-10-01. Tests introduced by `1cff6afe`, checked against that commit.
These are targeted assertion checks, not a full mutation sweep or occupied
visual acceptance.

Each fault ran `cargo test -p terri-sim <test> -- --test-threads=1`. Each
command exited 101 with the named test marked `FAILED` and the assertion
below. A compile failure or timeout would not count as detection.

| Fault | Test |
| --- | --- |
| Delete completion's `reservations::release` call in `systems/interact.rs` | `staggered_and_simultaneous_completions_release_only_active_use` |
| Delete the worker's release call in `systems/career.rs` | `a_worker_leaving_a_shared_bed_preserves_the_other_sleep_and_both_assignments` |
| Delete release after loss of the target definition in `systems/movement.rs` | `vanished_bed_cleanup_releases_every_travelling_place` |
| Delete `Occupancy::claim`'s `self.targets.push((agent, target, place))` | `autonomous_claims_share_two_places_and_the_third_waits_in_the_same_pass` |
| Replace `if !occupied` with `if true` in `reservations::release_now` | `staggered_and_simultaneous_completions_release_only_active_use` |

Actual assertion output, in table order:

```text
assertion failed: sim.world().get::<SleepPlace>(first).is_none()

assertion failed: sim.world().get::<SleepPlace>(worker).is_none()

assertion failed: sim.world().get::<Reserved>(bed).is_none()

assertion `left == right` failed
  left: Some(SleepPlace(0))
 right: Some(SleepPlace(1))

assertion `left == right` failed
  left: false
 right: true
```

Each fault restored the original file bytes in a `finally` block and checked
SHA-256 before moving to the next case. Restored hashes:

| Source under `crates/terri-sim/src` | SHA-256 |
| --- | --- |
| `systems/interact.rs` | `FAA3D96032CEAD9800556807916E6E80AD8D9DAB2A77588C6D8984E4C7E242BC` |
| `systems/career.rs` | `9E179B97F808F7F49F8BB84E071435B6B231FB54D3B195D2659C5CEB098D19FD` |
| `systems/movement.rs` | `350597106C005313DE3B8F1BAD0B7945AAC785C0076B9983FFA408A51A57CCB6` |
| `beds.rs` | `4B79009825E081C1ACD3820017487669A1C7049128D67C67A7F4615DD0073C59` |
| `reservations.rs` | `96D3FF136936C21A056DEA13A3E42870482DD4B3D7DEAD070C7581C9198BF141` |

After restoration, `cargo test -p terri-sim beds::tests::lifecycle --
--test-threads=1` passed with exit 0:

```text
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 747 filtered out
```

`git status --short` was empty after the restored run, before writing this
evidence. Local runner and full logs are under `.tmp/bed-assignment/`.
