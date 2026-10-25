# Schema-21 saves from before wages and bills

These three saves were written by main at commit `44f5fb271ca1ca818ef3190e8c7b976a989601ad`, the revision of main this branch merged on 2026-10-24, whose current save is schema 21. They test the move to schema 22 in [wages and bills](../../../../../docs/specs/2026-10-18-wages-and-bills.md) ([WB-save]) with bytes this branch's writer did not produce: pay is migrated to the new range, the bills record starts empty, and a bed already standing outdoors stays where it is. `manifest.json` records each file's length and SHA-256.

1. `two-days-tim-at-work.sav` is 7,064 bytes, SHA-256 `d0580d3dad893a66153c8b9137ee3ac8d2d8eca896ef00376f1bd6ab5ad2854d`. It is the shipped household from `SimHandle::from_lot()`, saved after 3,480 ticks, Wednesday at 10:00, while Tim works his office shift. The job search had hired Bill as a kitchen porter and Casey as a night watch guard.
2. `night-shift-open.sav` is 6,448 bytes, SHA-256 `dbf48c6764c64adf458065def6641c06eda421b9614f576afbdeb75c53df8ac8`. It is the shipped household with the job search off for the second and third living people and the third assigned to the night watch on its standard night shift at tick 0, saved after 1,500 ticks, Tuesday at 01:00, while that person's night shift is open.
3. `double-bed-in-yard.sav` is 6,145 bytes, SHA-256 `d6d29f37f417cff803dd5bb70afc6095787ee3da0b4bbd678b74f5adb6c2fa50`. It is the shipped household with the double bed moved at tick 0 to the yard tile (16, 0), facing 0, which the game allowed before issue 298, saved after 600 ticks.

The producer was a scratch example in a temporary worktree at the source revision, removed with the worktree afterward. To reproduce the files, check out the source revision, save the program below as `crates/terri-wasm/examples/write_bills_v21_fixtures.rs` and run `cargo run --release -p terri-wasm --example write_bills_v21_fixtures -- <output directory>`. A short absolute `CARGO_TARGET_DIR` avoids Windows path-length link failures in deep checkouts.

```rust
//! Scratch producer for issue 298 schema-21 fixtures, run only at main
//! 44f5fb271 through the shipped browser writer `SimHandle::save_bytes`.
use terri_wasm::SimHandle;

const DAY: u32 = 1440;

/// The living people's entity indices in sim id order.
fn people(handle: &SimHandle) -> Vec<u32> {
    (0..64)
        .filter(|index| !handle.job_search_of(*index).is_empty())
        .collect()
}

fn run(handle: &mut SimHandle, ticks: u32) {
    for _ in 0..ticks {
        handle.tick();
    }
}

fn save(handle: &SimHandle, out: &std::path::Path, name: &str) {
    let bytes = handle.save_bytes();
    assert_eq!(&bytes[8..10], &21u16.to_le_bytes());
    std::fs::write(out.join(name), &bytes).expect("write fixture");
    println!("{name}: {} bytes", bytes.len());
}

fn main() {
    let out = std::path::PathBuf::from(std::env::args().nth(1).expect("output directory"));
    std::fs::create_dir_all(&out).expect("create output directory");

    // 1. A new game after two days, Wednesday at 10:00, with Tim at work
    //    on his 06:00 to 14:00 office shift.
    let mut shipped = SimHandle::from_lot();
    run(&mut shipped, 2 * DAY + 600);
    let living = people(&shipped);
    assert_eq!(living.len(), 3);
    println!("shipped careers: {:?}", living.iter().map(|p| shipped.career_of(*p)).collect::<Vec<_>>());
    save(&shipped, &out, "two-days-tim-at-work.sav");

    // 2. The third person assigned to the night watch on its standard
    //    night shift at tick 0 (path 2, shift 0), saved Tuesday at 01:00
    //    while that night's shift is open.
    let mut night = SimHandle::from_lot();
    let living = people(&night);
    assert!(night.set_job_search(living[1], false));
    assert!(night.set_job_search(living[2], false));
    assert!(night.assign_career_shift(living[2], 2, 0));
    night.flush_commands();
    println!("night career: {}", night.career_of(living[2]));
    run(&mut night, DAY + 60);
    println!("night schedule: {:?}", night.career_schedule_of(living[2]));
    println!("night attendance: {:?}", night.career_attendance_of(living[2]));
    save(&night, &out, "night-shift-open.sav");

    // 3. The double bed moved onto a yard tile at tick 0, which the game
    //    allowed before issue 298, then 600 ticks lived with it there.
    let mut yard = SimHandle::from_lot();
    let bed = (0..256u32)
        .find(|index| {
            yard.object_details_of(*index)
                .first()
                .is_some_and(|name| name == "Standard Double")
        })
        .expect("the shipped double bed");
    let mut target = None;
    'search: for y in 0..16u32 {
        for x in 16..19u32 {
            for facing in 0..4u32 {
                let preview =
                    yard.placement_preview(bed as f64, x as f64, y as f64, facing as f64);
                let (width, depth) = (preview[4] as u32, preview[5] as u32);
                let outside = (x..x + width).all(|tx| tx >= 16 && tx < 19)
                    && (y..y + depth).all(|ty| ty < 16);
                if preview[0] == 0.0 && outside {
                    target = Some((x, y, facing));
                    break 'search;
                }
            }
        }
    }
    let (x, y, facing) = target.expect("a free yard spot for the bed");
    assert!(yard.place_object(bed as f64, x as f64, y as f64, facing as f64));
    yard.flush_commands();
    println!("bed {bed} moved to ({x}, {y}) facing {facing}: {:?}", yard.last_placement_result());
    run(&mut yard, 600);
    save(&yard, &out, "double-bed-in-yard.sav");
}
```

The program ran natively with rustc 1.98.0 on Windows; the published browser build was not involved. The saves came from fresh local simulations, not from anyone's save data.
