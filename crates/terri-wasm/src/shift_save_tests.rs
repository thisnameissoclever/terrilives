//! Saves written before shifts load through the browser path with every job
//! on its level's standard shift: issue 296,
//! `docs/specs/2026-10-18-shifts-and-careers.md`, [WS-save].
use super::*;

/// Real saves of schemas fourteen to twenty, each named with the schema its
/// header records. The schema-eighteen and schema-twenty files were written
/// by main for this test; the others are the committed fixtures earlier
/// work recorded.
const OLDER_SAVES: [(&str, u16, &[u8]); 12] = [
    (
        "room-identities-v14/lived.sav",
        14,
        include_bytes!("../tests/fixtures/room-identities-v14/lived.sav"),
    ),
    (
        "room-identities-v14/north-west-land-career.sav",
        14,
        include_bytes!("../tests/fixtures/room-identities-v14/north-west-land-career.sav"),
    ),
    (
        "room-identities-v15/fresh.sav",
        15,
        include_bytes!("../tests/fixtures/room-identities-v15/fresh.sav"),
    ),
    (
        "room-transport-v16/funded-fresh.sav",
        16,
        include_bytes!("../tests/fixtures/room-transport-v16/funded-fresh.sav"),
    ),
    (
        "job-search-v17/shipped-household.sav",
        17,
        include_bytes!("../tests/fixtures/job-search-v17/shipped-household.sav"),
    ),
    (
        "job-search-v17/job-search-off.sav",
        17,
        include_bytes!("../tests/fixtures/job-search-v17/job-search-off.sav"),
    ),
    (
        "shifts-v18/shipped-household.sav",
        18,
        include_bytes!("../tests/fixtures/shifts-v18/shipped-household.sav"),
    ),
    (
        "shifts-v18/queued-setting.sav",
        18,
        include_bytes!("../tests/fixtures/shifts-v18/queued-setting.sav"),
    ),
    (
        "published-v19/initial.sav",
        19,
        include_bytes!("../tests/fixtures/published-v19/initial.sav"),
    ),
    (
        "published-v19/running-fight.sav",
        19,
        include_bytes!("../tests/fixtures/published-v19/running-fight.sav"),
    ),
    (
        "shifts-v20/shipped-household.sav",
        20,
        include_bytes!("../tests/fixtures/shifts-v20/shipped-household.sav"),
    ),
    (
        "shifts-v20/queued-setting.sav",
        20,
        include_bytes!("../tests/fixtures/shifts-v20/queued-setting.sav"),
    ),
];

/// [WS-save] "Older saves": each older save loads through `load_bytes`
/// with every employed person on their level's standard shift, the shift
/// stream at its seed and no draws. The schema-eighteen and schema-twenty
/// households were hired by main's search, so employed housemates other
/// than the household worker are covered.
#[test]
fn schemas_fourteen_to_twenty_load_on_the_standard_shift() {
    let mut employed_total = 0;
    for (name, schema, bytes) in OLDER_SAVES {
        assert_eq!(&bytes[..SAVE_MAGIC.len()], &SAVE_MAGIC, "{name}");
        assert_eq!(
            &bytes[SAVE_MAGIC.len()..SAVE_HEADER_BYTES],
            &schema.to_le_bytes(),
            "{name}"
        );
        let mut handle = SimHandle::from_lot();
        assert!(handle.load_bytes(bytes), "{name} loads");
        let world = handle.sim.world();
        let pack = world.resource::<terri_sim::Content>().0;
        let careers = world.resource::<terri_sim::Careers>();
        assert_eq!(
            (&careers.shift_rng, careers.shift_draws),
            (
                &terri_core::SimRng::from_seed(terri_sim::shifts::SHIFTS_SEED),
                0
            ),
            "{name}: the shift stream at its seed"
        );
        assert!(
            careers.records.values().all(|record| record.shift == 0),
            "{name}: every record on the standard shift"
        );
        let workers: Vec<terri_core::Entity> = world
            .try_query::<(terri_core::Entity, &terri_core::Agent, &terri_core::Career)>()
            .expect("registered")
            .iter(world)
            .map(|(worker, _, _)| worker)
            .collect();
        for worker in &workers {
            let shift = terri_sim::shifts::shift_of(world, pack, *worker).expect("employed");
            assert_eq!((shift.index, shift.id), (0, "standard"), "{name}");
        }
        employed_total += workers.len();
        let saved = handle.sim.save_snapshot_v21();
        assert!(saved.shifts.held.is_empty(), "{name}");
    }
    assert!(employed_total > OLDER_SAVES.len(), "housemates were hired");
}
