# Schema-18 saves from before shifts

These two saves were written by main at commit `7b45ac301142a3dfbbb6cce4239428a79af018c4`, the last revision of main whose current save is schema 18. They test the move to schema 21 in [shifts and more career paths](../../../../../docs/specs/2026-10-18-shifts-and-careers.md) ([WS-save]) with bytes this branch's writer did not produce: every job loads on its level's standard shift, the shift stream at its seed and no draws. `manifest.json` records each file's length and SHA-256.

1. `shipped-household.sav` is 6,909 bytes, SHA-256 `a348b65b596307e9293db36d1f53f38cb27c7a1c370699fc6f6c9645899b1a80`. It is the shipped household from `SimHandle::from_lot()`, saved after 4,920 ticks, Thursday at 10:00, after the job search has hired housemates.
2. `queued-setting.sav` is 6,738 bytes, SHA-256 `446a4223208e2000756395a14331e08d59872915ebb4c149b7b5bcd8586242b0`. It is the same household with the third living person's job search turned off at tick 0, saved after the same 4,920 ticks with a second person's `set_job_search(false)` staged and not yet applied, so the per-person list and a queued setting both carry something.

The producer was a scratch example in a temporary worktree at the source revision, removed with the worktree afterward. To reproduce the files, check out the source revision, save the program below as `crates/terri-wasm/examples/write_shifts_v18_fixtures.rs` and run `cargo run --release -p terri-wasm --example write_shifts_v18_fixtures -- <output directory>`. A short absolute `CARGO_TARGET_DIR` avoids Windows path-length link failures in deep checkouts.

```rust
//! Scratch producer for issue 296's schema-18 fixtures, run only at main
//! 7b45ac301 through the shipped browser writer `SimHandle::save_bytes`.
use terri_wasm::SimHandle;

/// Monday's first tick to Thursday at 10:00, as the schema-17 fixtures.
const TICKS: u32 = 1440 * 3 + 600;

/// The living people's entity indices in sim id order.
fn people(handle: &SimHandle) -> Vec<u32> {
    (0..64)
        .filter(|index| !handle.job_search_of(*index).is_empty())
        .collect()
}

fn main() {
    let out = std::path::PathBuf::from(std::env::args().nth(1).expect("output directory"));
    std::fs::create_dir_all(&out).expect("create output directory");

    let mut shipped = SimHandle::from_lot();
    for _ in 0..TICKS {
        shipped.tick();
    }
    let bytes = shipped.save_bytes();
    assert_eq!(&bytes[8..10], &18u16.to_le_bytes());
    std::fs::write(out.join("shipped-household.sav"), &bytes).expect("write shipped");

    // One housemate's search off from the start, and a queued setting
    // staged just before the save, so the schema-18 list and the queued
    // settings rows both carry something.
    let mut queued = SimHandle::from_lot();
    let living = people(&queued);
    assert_eq!(living.len(), 3);
    assert!(queued.set_job_search(living[2], false));
    queued.flush_commands();
    for _ in 0..TICKS {
        queued.tick();
    }
    assert!(queued.set_job_search(living[1], false));
    let bytes = queued.save_bytes();
    assert_eq!(&bytes[8..10], &18u16.to_le_bytes());
    std::fs::write(out.join("queued-setting.sav"), &bytes).expect("write queued");
    println!("wrote schema-18 fixtures at tick {TICKS}; people {living:?}");
}
```

The program ran natively with rustc 1.98.0 on Windows; the published browser build was not involved. The saves came from fresh local simulations, not from anyone's save data.

`src/shift_save_tests.rs` loads both files through `load_bytes` and checks that every job holds its standard shift.
