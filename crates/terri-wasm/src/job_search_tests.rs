//! Job search as each person's own setting, through the browser save
//! boundary: issue 297, `docs/specs/2026-10-18-job-search-per-person.md`.
use super::*;

fn living_people(handle: &SimHandle) -> Vec<u32> {
    let world = handle.sim.world();
    let mut people: Vec<(u32, u32)> = world
        .try_query::<(terri_core::Entity, &terri_core::Agent, &terri_core::SimId)>()
        .expect("registered")
        .iter(world)
        .map(|(person, _, id)| (id.0, person.index_u32()))
        .collect();
    people.sort_unstable();
    people.into_iter().map(|(_, index)| index).collect()
}

fn encoded(version: u16, payload: Vec<u8>) -> Vec<u8> {
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend_from_slice(&version.to_le_bytes());
    bytes.extend(payload);
    bytes
}

/// The payload of `bytes` as `$snapshot`, after checking its header names
/// `$version`.
macro_rules! payload {
    ($bytes:expr, $version:expr, $snapshot:ty) => {{
        let bytes: &[u8] = $bytes;
        assert_eq!(&bytes[..SAVE_MAGIC.len()], SAVE_MAGIC);
        assert_eq!(
            &bytes[SAVE_MAGIC.len()..SAVE_HEADER_BYTES],
            &($version as u16).to_le_bytes()
        );
        let (snapshot, tail) =
            postcard::take_from_bytes::<$snapshot>(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        assert!(tail.is_empty());
        snapshot
    }};
}

/// Loads `bytes` into a new game and returns every living person's
/// setting as the exports read it.
fn settings_after_load(bytes: &[u8], case: &str) -> Vec<Vec<u8>> {
    let mut handle = SimHandle::from_lot();
    assert!(handle.load_bytes(bytes), "{case} loads");
    let people = living_people(&handle);
    assert!(!people.is_empty(), "{case} has a household");
    people
        .into_iter()
        .map(|person| handle.job_search_of(person))
        .collect()
}

fn everyone(settings: &[Vec<u8>], search: bool) -> bool {
    settings
        .iter()
        .all(|setting| setting == &vec![u8::from(search)])
}

#[test]
fn the_exports_read_and_set_each_persons_search_and_current_schema_keeps_it() {
    let mut source = SimHandle::from_lot();
    let people = living_people(&source);
    assert!(people.len() > 1);
    for person in &people {
        assert_eq!(source.job_search_of(*person), vec![1], "on by default");
    }
    let furniture = source
        .sim
        .world()
        .try_query::<(terri_core::Entity, &terri_core::SmartObject)>()
        .expect("registered")
        .iter(source.sim.world())
        .next()
        .expect("the lot has furniture")
        .0
        .index_u32();
    assert!(source.job_search_of(furniture).is_empty());
    assert!(source.job_search_of(99_999).is_empty());

    assert!(source.set_job_search(people[1], false));
    assert_eq!(
        source.job_search_of(people[1]),
        vec![1],
        "a command, applied by the drain"
    );
    source.flush_commands();
    assert_eq!(source.job_search_of(people[1]), vec![0]);
    assert_eq!(source.job_search_of(people[0]), vec![1]);
    assert!(source.career_change_autonomy());

    let bytes = source.save_bytes();
    assert_eq!(
        bytes[SAVE_MAGIC.len()..SAVE_HEADER_BYTES],
        21u16.to_le_bytes()
    );
    let saved = payload!(&bytes, 21, terri_core::SaveSnapshotV21);
    let saved = saved.legacy.legacy;
    assert_eq!(saved.legacy.job_search_off.len(), 1);
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(loaded.job_search_of(people[1]), vec![0]);
    assert_eq!(loaded.job_search_of(people[0]), vec![1]);
    assert_eq!(loaded.world_hash(), source.world_hash());
    assert_eq!(loaded.save_bytes(), bytes);

    // A list naming nobody alive refuses the load and leaves the game.
    let mut bad = saved.clone();
    bad.legacy.job_search_off = vec![999];
    let mut target = SimHandle::from_lot();
    let before = target.world_hash();
    assert!(!target.load_bytes(&encoded(
        20,
        postcard::to_allocvec(&terri_core::SaveSnapshotV20 {
            legacy: bad,
            conflicts: Default::default()
        })
        .unwrap()
    )));
    assert_eq!(target.world_hash(), before);
}

/// Every reader that carries the household setting gives it to each
/// living person: the published schema-fourteen and schema-fifteen
/// fixtures, the current native schema-sixteen fixture (which claims no
/// historical producer), each as saved (search on) and with the setting
/// turned off, a schema-seventeen save from this branch's writer, and a
/// schema-thirteen save, which predates the setting and leaves everyone
/// on. The saves main wrote are tested below.
#[test]
fn older_saves_give_every_living_person_the_household_setting() {
    let v14 = include_bytes!("../tests/fixtures/room-identities-v14/lived.sav").as_slice();
    let v15 = include_bytes!("../tests/fixtures/room-identities-v15/fresh.sav").as_slice();
    let v16 = include_bytes!("../tests/fixtures/room-transport-v16/funded-fresh.sav").as_slice();

    let mut snapshot14 = payload!(v14, 14, terri_core::SaveSnapshotV14);
    assert!(snapshot14.careers.autonomous_search, "published as on");
    assert!(everyone(&settings_after_load(v14, "published v14"), true));
    snapshot14.careers.autonomous_search = false;
    let off = encoded(14, postcard::to_allocvec(&snapshot14).unwrap());
    assert!(everyone(&settings_after_load(&off, "v14 off"), false));

    let mut snapshot15 = payload!(v15, 15, terri_core::SaveSnapshotV15);
    assert!(
        snapshot15.legacy.careers.autonomous_search,
        "published as on"
    );
    assert!(everyone(&settings_after_load(v15, "published v15"), true));
    snapshot15.legacy.careers.autonomous_search = false;
    let off = encoded(15, postcard::to_allocvec(&snapshot15).unwrap());
    assert!(everyone(&settings_after_load(&off, "v15 off"), false));

    let mut snapshot16 = payload!(v16, 16, terri_core::SaveSnapshotV16);
    assert!(snapshot16.legacy.legacy.careers.autonomous_search);
    assert!(everyone(&settings_after_load(v16, "v16"), true));
    snapshot16.legacy.legacy.careers.autonomous_search = false;
    let off = encoded(16, postcard::to_allocvec(&snapshot16).unwrap());
    assert!(everyone(&settings_after_load(&off, "v16 off"), false));

    let source = SimHandle::from_lot();
    for search in [true, false] {
        let mut snapshot17 = source.sim.save_snapshot_v17();
        snapshot17.legacy.legacy.legacy.careers.autonomous_search = search;
        let bytes = encoded(17, postcard::to_allocvec(&snapshot17).unwrap());
        assert!(everyone(&settings_after_load(&bytes, "v17"), search));
    }

    let thirteen = encoded(
        13,
        postcard::to_allocvec(&source.sim.save_snapshot_v13()).unwrap(),
    );
    assert!(everyone(&settings_after_load(&thirteen, "v13"), true));

    // The migrated game saves in the current schema with everyone listed.
    let mut migrated = SimHandle::from_lot();
    assert!(migrated.load_bytes(&off));
    let resaved = payload!(&migrated.save_bytes(), 21, terri_core::SaveSnapshotV21);
    let resaved = resaved.legacy.legacy;
    assert_eq!(
        resaved.legacy.job_search_off.len(),
        living_people(&migrated).len()
    );
}

/// The schema-seventeen saves main wrote at 2b15dcfea, before the setting
/// moved to each person (`tests/fixtures/job-search-v17/README.md`): every
/// living person takes the household value, the game resaves in the current
/// schema and carries on exactly from the resave.
#[test]
fn main_schema_seventeen_saves_move_to_current_with_their_setting() {
    for (name, bytes, search) in [
        (
            "shipped household",
            include_bytes!("../tests/fixtures/job-search-v17/shipped-household.sav").as_slice(),
            true,
        ),
        (
            "job search off",
            include_bytes!("../tests/fixtures/job-search-v17/job-search-off.sav").as_slice(),
            false,
        ),
    ] {
        let source = payload!(bytes, 17, terri_core::SaveSnapshotV17);
        assert_eq!(
            source.legacy.legacy.legacy.careers.autonomous_search, search,
            "{name} as main saved it"
        );
        let mut game = SimHandle::from_lot();
        assert!(game.load_bytes(bytes), "{name} loads");
        let people = living_people(&game);
        assert!(people.len() > 1, "{name} has a household");
        for person in &people {
            assert_eq!(
                game.job_search_of(*person),
                vec![u8::from(search)],
                "{name}"
            );
        }
        let employed = people
            .iter()
            .filter(|person| !game.career_of(**person).is_empty())
            .count();
        if search {
            assert!(employed > 1, "main's search hired a housemate");
        } else {
            assert_eq!(employed, 1, "only the shipped worker holds a job");
        }
        let current = game.save_bytes();
        let resaved = payload!(&current, 21, terri_core::SaveSnapshotV21);
        let resaved = resaved.legacy.legacy;
        assert_eq!(
            resaved.legacy.job_search_off.len(),
            if search { 0 } else { people.len() },
            "{name}"
        );
        let mut resumed = SimHandle::from_lot();
        assert!(resumed.load_bytes(&current), "{name} resave loads");
        assert_eq!(resumed.save_bytes(), current);
        for _ in 0..120 {
            game.tick();
            resumed.tick();
            assert_eq!(resumed.world_hash(), game.world_hash(), "{name}");
        }
    }
}
