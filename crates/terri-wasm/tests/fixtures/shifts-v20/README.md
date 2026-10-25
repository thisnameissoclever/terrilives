# Schema-20 saves from before shifts

These two saves were written by main at commit `2fa3eac5613a231cef86dd1443f802d79b1ae771`, the revision of main this branch merged on 2026-10-23, whose current save is schema 20. They test the move to schema 21 in [shifts and more career paths](../../../../../docs/specs/2026-10-18-shifts-and-careers.md) ([WS-save]) with bytes this branch's writer did not produce: every job loads on its level's standard shift, the shift stream at its seed and no draws. `manifest.json` records each file's length and SHA-256.

1. `shipped-household.sav` is 7,523 bytes, SHA-256 `3715a80e8d67e12853c128bfbaedda42bcce3f9642b45dfe1f158edda4e4174c`. It is the shipped household from `SimHandle::from_lot()`, saved after 4,920 ticks, Thursday at 10:00, after the job search has hired housemates.
2. `queued-setting.sav` is 7,202 bytes, SHA-256 `7bc82c6506050b2f7dd1e0536c9c5205dbc87027bc715f508d4ef22ebf7f9aec`. It is the same household with the third living person's job search turned off at tick 0, saved after the same 4,920 ticks with a second person's `set_job_search(false)` staged and not yet applied, so the per-person list and a queued setting both carry something.

The producer was a scratch example in a temporary worktree at the source revision, removed with the worktree afterward. To reproduce the files, check out the source revision, save the program below as `crates/terri-wasm/examples/write_shifts_v20_fixtures.rs` and run `cargo run --release -p terri-wasm --example write_shifts_v20_fixtures -- <output directory>`. A short absolute `CARGO_TARGET_DIR` avoids Windows path-length link failures in deep checkouts.

```rust
//! Scratch producer for issue 296 schema-20 fixtures, run only at main
//! 2fa3eac56 through the shipped browser writer `SimHandle::save_bytes`.
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
    assert_eq!(&bytes[8..10], &20u16.to_le_bytes());
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
    assert_eq!(&bytes[8..10], &20u16.to_le_bytes());
    std::fs::write(out.join("queued-setting.sav"), &bytes).expect("write queued");
    println!("wrote schema-20 fixtures at tick {TICKS}; people {living:?}");
}
```

The program ran natively with rustc 1.98.0 on Windows; the published browser build was not involved. The saves came from fresh local simulations, not from anyone's save data.

`src/shift_save_tests.rs` loads both files through `load_bytes` and checks that every job holds its standard shift.
