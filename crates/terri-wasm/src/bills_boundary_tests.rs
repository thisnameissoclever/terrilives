//! Bills, the bed rule, night pay and schema twenty-two across the browser
//! boundary: issue 298, `docs/specs/2026-10-18-wages-and-bills.md`
//! ([WB-panel], [WB-beds], [WB-save]).
use super::*;
use terri_sim::bills::{Bill, Bills};

const DAY: u64 = 1440;

const TWO_DAYS: &[u8] = include_bytes!("../tests/fixtures/bills-v21/two-days-tim-at-work.sav");
const NIGHT_SHIFT: &[u8] = include_bytes!("../tests/fixtures/bills-v21/night-shift-open.sav");
const BED_IN_YARD: &[u8] = include_bytes!("../tests/fixtures/bills-v21/double-bed-in-yard.sav");

/// The shipped lot and its furniture with nobody living there.
fn empty_house() -> SimHandle {
    let pack = SimHandle::from_lot()
        .sim
        .world()
        .resource::<terri_sim::Content>()
        .0;
    SimHandle {
        sim: Sim::new_from_lot_and_content(&pack.lot, terri_sim::Content(pack)),
    }
}

/// The living people's entity indices in sim id order, as the fixtures'
/// producer found them.
fn people(handle: &SimHandle) -> Vec<u32> {
    (0..64)
        .filter(|index| !handle.job_search_of(*index).is_empty())
        .collect()
}

fn set_tick(handle: &mut SimHandle, tick: u64) {
    handle
        .sim
        .world_mut()
        .resource_mut::<terri_core::SimClock>()
        .tick = tick;
}

/// The old whole-dollar pay raised by half, rounded half up ([WB-wages]).
fn raised(pay: u32) -> u32 {
    (pay * 3).div_ceil(2)
}

/// The schema-twenty-one snapshot inside `bytes`.
fn old_snapshot(bytes: &[u8]) -> terri_core::SaveSnapshotV21 {
    assert_eq!(
        &bytes[SAVE_MAGIC.len()..SAVE_HEADER_BYTES],
        &21u16.to_le_bytes()
    );
    let (snapshot, rest) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV21>(&bytes[SAVE_HEADER_BYTES..])
            .expect("a schema-twenty-one payload");
    assert!(rest.is_empty());
    snapshot
}

#[test]
fn bills_exports_are_empty_without_a_lot() {
    let mut handle = SimHandle::new(12, 12);
    handle.tick();
    assert!(handle.bills_overview().is_empty());
    assert!(handle.bills_next().is_empty());
    for kind in [0.0, 1.0, 2.0, 3.0] {
        assert!(handle.bills_lines(kind).is_empty());
    }
    assert!(handle.bills_overdue().is_empty());
    assert!(handle.bills_last_month().is_empty());
    assert_eq!(handle.night_pay_cents_of(0), -1.0);
}

#[test]
fn bills_overview_on_a_new_game() {
    let mut handle = SimHandle::from_lot();
    handle.tick();
    let overview = handle.bills_overview();
    assert_eq!(overview.len(), 15);
    let [funds, keep_aside, shortfall, due, overdue, fees, month, grace, fee, cap, days, length, unpaid, unpaid_due, overdue_from] =
        overview[..]
    else {
        unreachable!()
    };
    assert_eq!((due, overdue, fees), (7.0, 0.0, 0.0));
    assert_eq!((month, grace, fee, cap, days), (7.0, 5.0, 5.0, 50.0, 1.0));
    assert_eq!(
        (length, unpaid, unpaid_due, overdue_from),
        (7.0, 0.0, -1.0, -1.0)
    );
    let next = handle.bills_next();
    assert_eq!(
        next.chunks(3).map(|bill| bill[0]).collect::<Vec<_>>(),
        [0.0, 1.0, 2.0, 3.0]
    );
    let expected: f64 = next.chunks(3).map(|bill| bill[2]).sum();
    assert_eq!(keep_aside, expected, "nothing is unpaid yet");
    assert_eq!(funds, handle.funds_cents());
    assert_eq!(shortfall, (keep_aside - funds.max(0.0)).max(0.0));
    assert!(handle.bills_overdue().is_empty());
    assert!(handle.bills_last_month().is_empty());
}

/// Day index 12, the sixth day of the second month, with nothing in Funds
/// and the first month's rent unpaid: past its five days of grace, it is
/// overdue and gains its first late fee on the day's first tick.
#[test]
fn bills_exports_mid_month_with_an_overdue_bill() {
    let mut handle = empty_house();
    handle.sim.world_mut().insert_resource(terri_core::Funds(0));
    set_tick(&mut handle, 12 * DAY);
    *handle.sim.world_mut().resource_mut::<Bills>() = Bills {
        last_counted_day: Some(11),
        month_days: 5,
        bills: vec![Bill {
            due_day: 7,
            kind: terri_sim::bills::RENT,
            amount_cents: 29_360,
            late_fee_cents: 0,
            paid_day: None,
            terms: terri_sim::bills::BillTerms::of(
                &handle.sim.world().resource::<terri_sim::Content>().0.bills,
            ),
        }],
        ..Bills::default()
    };
    handle.tick();
    assert_eq!(handle.bills_overdue(), [0.0, 7.0, 29_360.0, 1_468.0, -1.0]);
    assert_eq!(
        handle.bills_last_month(),
        [0.0, 7.0, 29_360.0, 1_468.0, -1.0]
    );
    let overview = handle.bills_overview();
    assert_eq!(&overview[3..6], [14.0, 29_360.0, 1_468.0]);
    assert_eq!(overview[10], 6.0, "six days of the month counted");
    assert_eq!(
        &overview[11..],
        [7.0, 29_360.0 + 1_468.0, 7.0, 12.0],
        "the unpaid rent, due day 7, overdue from day 12"
    );
    let expected: f64 = handle.bills_next().chunks(3).map(|bill| bill[2]).sum();
    assert_eq!(overview[1], 29_360.0 + 1_468.0 + expected);
    assert_eq!(overview[2], overview[1], "Funds hold nothing");
}

#[test]
fn bills_lines_for_each_bill_kind() {
    let mut handle = empty_house();
    handle.tick();
    let rows = |kind: f64| -> Vec<Vec<f64>> {
        handle
            .bills_lines(kind)
            .chunks(6)
            .map(<[f64]>::to_vec)
            .collect()
    };
    let rent = rows(0.0);
    assert_eq!(
        rent.iter().map(|line| line[0]).collect::<Vec<_>>(),
        [0.0, 1.0, 2.0]
    );
    assert_eq!(rent[0][2], 1.0, "one day counted");
    assert_eq!((rent[1][2], rent[2][2]), (192.0, 112.0));
    for kind in [1.0, 2.0] {
        let utility = rows(kind);
        assert_eq!(utility[0][0], 0.0, "the base charge leads");
        assert!(utility[1..]
            .iter()
            .all(|line| line[0] == 3.0 || line[0] == 4.0));
    }
    let trips = rows(3.0);
    assert_eq!(
        trips.iter().map(|line| line[0]).collect::<Vec<_>>(),
        [0.0, 5.0]
    );
    assert_eq!(trips[1][2], 0.0, "nobody has gone to work");
    for bad in [4.0, -1.0, 0.5, f64::NAN] {
        assert!(handle.bills_lines(bad).is_empty(), "{bad}");
    }
}

#[test]
fn night_pay_of_a_night_worker_and_of_a_day_worker() {
    let mut handle = SimHandle::from_lot();
    assert!(handle.load_bytes(NIGHT_SHIFT));
    let living = people(&handle);
    assert_eq!(living.len(), 3);
    // The night watch's first level pays $105, $70 before the raise; a
    // night shift pays 15 percent more.
    assert_eq!(handle.night_pay_cents_of(living[2]), 12_075.0);
    assert_eq!(handle.night_pay_cents_of(living[0]), -1.0, "Tim works days");
    assert_eq!(handle.night_shift_premium_percent(), 15);
}

/// The double bed's entity index in the shipped lot.
fn double_bed(handle: &SimHandle) -> u32 {
    (0..256u32)
        .find(|index| {
            handle
                .object_details_of(*index)
                .first()
                .is_some_and(|name| name == "Standard Double")
        })
        .expect("the shipped double bed")
}

/// A wall line whose removal would leave a bed outside every room.
fn wall_that_holds_a_bed_in(handle: &SimHandle) -> (f64, f64, f64) {
    let (width, height) = (handle.lot_width() as u32, handle.lot_height() as u32);
    for axis in 0..2u32 {
        for y in 0..=height {
            for x in 0..=width {
                let (axis, x, y) = (f64::from(axis), f64::from(x), f64::from(y));
                if handle.wall_edit_preview(axis, x, y, 0.0) == 22 {
                    return (axis, x, y);
                }
            }
        }
    }
    panic!("no wall holds a bed in");
}

#[test]
fn bed_refusals_cross_the_boundary_with_their_codes() {
    let mut handle = SimHandle::from_lot();
    let bed = f64::from(double_bed(&handle));
    assert_eq!(handle.placement_preview(bed, 16.0, 0.0, 0.0)[0], 21.0);

    let (axis, x, y) = wall_that_holds_a_bed_in(&handle);
    assert!(handle.set_wall_edge(axis, x, y, 0.0));
    handle.flush_commands();
    assert_eq!(handle.last_wall_edit_result()[4], 22);

    // Inside Build mode the same removal waits for Confirm, which refuses
    // it with the bed it would leave outside.
    assert_eq!(handle.begin_build(), [1, 0]);
    assert!(handle.set_wall_edge(axis, x, y, 0.0));
    handle.flush_commands();
    let refused = handle.prepare_build_commit(&[1, 0, 0, 0, 0]);
    assert_eq!(&refused[..4], [1, 1, 15, 1], "{refused:?}");
    let mut object = 0u64;
    for (shift, byte) in refused[4..].iter().enumerate() {
        object |= u64::from(byte & 127) << (7 * shift);
    }
    assert!(!handle.object_details_of(object as u32).is_empty());
    assert!(handle.build_active(), "the draft stays open");
}

#[test]
fn schema_twenty_two_round_trips_through_the_save_bytes() {
    let mut handle = SimHandle::from_lot();
    for _ in 0..20 {
        handle.tick();
    }
    let bytes = handle.save_bytes();
    assert_eq!(
        &bytes[SAVE_MAGIC.len()..SAVE_HEADER_BYTES],
        &22u16.to_le_bytes()
    );
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(loaded.save_bytes(), bytes);
    let bills = loaded.sim.world().resource::<Bills>();
    assert!(!bills.is_pristine());
    assert_eq!(bills, handle.sim.world().resource::<Bills>());
    assert_eq!(loaded.world_hash(), handle.world_hash());
}

/// [WB-save] older saves: every career record's pay and every open shift's
/// pay is raised by half, settled shifts keep what they were settled at,
/// the bills record starts empty and a bed already outdoors stays put.
#[test]
fn the_authentic_schema_twenty_one_fixtures_load_with_migrated_pay() {
    let mut open_shifts = 0;
    for (name, bytes) in [
        ("two-days-tim-at-work", TWO_DAYS),
        ("night-shift-open", NIGHT_SHIFT),
        ("double-bed-in-yard", BED_IN_YARD),
    ] {
        let old = old_snapshot(bytes);
        let old_careers = &old.legacy.legacy.legacy.legacy.legacy.legacy.legacy.careers;
        let old_attendance = &old.legacy.legacy.legacy.legacy.attendance;
        let mut handle = SimHandle::from_lot();
        assert!(handle.load_bytes(bytes), "{name} loads");
        let world = handle.sim.world();
        assert!(world.resource::<Bills>().is_pristine(), "{name}");
        let careers = world.resource::<terri_sim::Careers>();
        assert_eq!(careers.records.len(), old_careers.records.len(), "{name}");
        for record in &old_careers.records {
            let now = careers
                .records
                .get(&terri_core::SimId(record.sim))
                .expect("the record survives");
            assert_eq!(now.pay, raised(record.pay), "{name}: sim {}", record.sim);
        }
        let attendance = world.resource::<terri_sim::attendance::Attendance>();
        for shift in &old_attendance.shifts {
            let now = attendance
                .shifts
                .get(&terri_core::SimId(shift.sim))
                .expect("the shift survives");
            let expected = if shift.settled {
                shift.pay_cents
            } else {
                open_shifts += 1;
                i64::from(raised((shift.pay_cents / 100) as u32)) * 100
            };
            assert_eq!(now.pay_cents, expected, "{name}: sim {}", shift.sim);
        }
    }
    assert!(open_shifts >= 2, "Tim's and the guard's open shifts");

    // Tim's office clerk pay was $120 and his open shift $120.00.
    let old = old_snapshot(TWO_DAYS);
    let tim_sim = old
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .careers
        .records
        .iter()
        .find(|record| record.pay == 120)
        .map(|record| terri_core::SimId(record.sim))
        .expect("Tim at $120");
    let mut tim = SimHandle::from_lot();
    assert!(tim.load_bytes(TWO_DAYS));
    let world = tim.sim.world();
    assert_eq!(
        world
            .resource::<terri_sim::Careers>()
            .record(tim_sim)
            .map(|r| r.pay),
        Some(180)
    );
    assert_eq!(
        world
            .resource::<terri_sim::attendance::Attendance>()
            .shifts
            .get(&tim_sim)
            .map(|shift| (shift.pay_cents, shift.settled)),
        Some((18_000, false))
    );

    let mut yard = SimHandle::from_lot();
    assert!(yard.load_bytes(BED_IN_YARD));
    let bed = double_bed(&yard);
    let world = yard.sim.world();
    let origin = world
        .try_query::<(
            terri_core::Entity,
            &terri_core::SmartObject,
            &terri_core::Position,
        )>()
        .expect("registered")
        .iter(world)
        .find(|(entity, _, _)| entity.index_u32() == bed)
        .map(|(_, _, position)| (position.x, position.y))
        .expect("the bed");
    assert_eq!(origin, (16.0, 0.0), "the bed stays in the yard");
    for _ in 0..10 {
        yard.tick();
    }
    assert_eq!(
        yard.placement_preview(f64::from(bed), 16.0, 0.0, 0.0)[0],
        0.0,
        "left where it stands, it is not refused"
    );
    assert_eq!(
        yard.placement_preview(f64::from(bed), 16.0, 3.0, 0.0)[0],
        21.0,
        "moving it to another yard tile is refused"
    );
}
