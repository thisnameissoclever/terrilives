//! Schema twenty-three and the lingering lift of liked furniture: issue 344,
//! `docs/specs/2026-10-06-object-affinities.md`, [OA-presence].
use super::*;
use crate::presence_fade::PresenceFade;
use crate::Sim;
use terri_core::{save_v23::SavedPresenceFade, SimClock, SimId};
use terri_data::LONGEST_PRESENCE_FADE_TICKS;

const NOW: u64 = 40;

fn kind(id: &str) -> u32 {
    terri_data::pack()
        .affinities
        .iter()
        .position(|kind| kind.id == id)
        .unwrap_or_else(|| panic!("content has no affinity kind {id}")) as u32
}

fn row(sim: u32, kind: &str, end_tick: u64) -> SavedPresenceFade {
    SavedPresenceFade {
        sim,
        kind: kind.into(),
        end_tick,
    }
}

/// The shipped household at tick 40 with three fades: person 1 has both
/// presence kinds fading and person 2 one.
fn fading() -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut().resource_mut::<SimClock>().tick = NOW;
    let mut fade = sim.world_mut().resource_mut::<PresenceFade>();
    fade.refresh(SimId(1), kind("plants"), NOW, 120);
    fade.refresh(SimId(1), kind("aquarium"), NOW, 60);
    fade.refresh(SimId(2), kind("plants"), NOW, 228);
    sim
}

/// Schema twenty-three carries every fade through a save and load, in
/// person then kind id order, with the world digest unchanged and the lift
/// still readable; a schema-twenty-two snapshot of the same world loads
/// with none and a different digest.
#[test]
fn schema_twenty_three_round_trips_the_fades_and_schema_twenty_two_loads_with_none() {
    let sim = fading();
    let snapshot = sim.save_snapshot_v23();
    assert_eq!(
        snapshot.presence_fade,
        vec![
            row(1, "aquarium", NOW + 60),
            row(1, "plants", NOW + 120),
            row(2, "plants", NOW + 228),
        ],
        "ascending by person, then kind id"
    );
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v23(snapshot.clone()).expect("loads");
    assert_eq!(
        restored.world().resource::<PresenceFade>(),
        sim.world().resource::<PresenceFade>()
    );
    assert_eq!(restored.world_hash(), sim.world_hash());
    assert_eq!(restored.save_snapshot_v23(), snapshot);

    let older = sim.save_snapshot_v22();
    assert_eq!(older, snapshot.legacy, "schema 22 is the inner envelope");
    let mut none = Sim::new_from_shipped_lot();
    none.load_snapshot_v22(older).expect("loads");
    assert!(none.world().resource::<PresenceFade>().entries().is_empty());
    assert_ne!(none.world_hash(), sim.world_hash(), "the fades are hashed");
    assert!(none.save_snapshot_v23().presence_fade.is_empty());
}

/// A fade loaded from a save is the fade the person reads: the restored
/// person who left the plants half a fade ago reads "Enjoyed the plants".
#[test]
fn a_restored_fade_is_read_as_the_same_lift() {
    let mut sim = fading();
    let tim = crate::edit::living_entity(sim.world(), 1).unwrap();
    // Person 1 stands in the kitchen, with nothing liked around.
    *sim.world_mut()
        .get_mut::<terri_core::Position>(tim)
        .unwrap() = terri_core::Position { x: 4.0, y: 2.0 };
    let mut values = vec![0.0; terri_data::pack().affinities.len()];
    values[kind("plants") as usize] = 1.0;
    sim.world_mut()
        .entity_mut(tim)
        .insert(terri_core::Affinities::from_values(values));
    sim.world_mut().resource_mut::<SimClock>().tick = NOW + 60;
    // The tick's refresh drops the aquarium fade, which ends right now; a
    // saved world never holds a fade that is already over.
    sim.world_mut()
        .resource_mut::<PresenceFade>()
        .expire(NOW + 60);
    let read = |sim: &Sim| {
        let tim = crate::edit::living_entity(sim.world(), 1).unwrap();
        sim.mood_of(tim.index_u32())
            .unwrap()
            .moodlets
            .into_iter()
            .filter(|moodlet| moodlet.label.starts_with("Enjoyed the "))
            .map(|moodlet| (moodlet.label, moodlet.score))
            .collect::<Vec<_>>()
    };
    let before = read(&sim);
    assert_eq!(before.len(), 1, "{before:?}");
    assert_eq!(before[0].0, "Enjoyed the plants");
    assert!((before[0].1 - 5.0).abs() < 1e-4, "{before:?}");

    let mut restored = Sim::new_from_shipped_lot();
    restored
        .load_snapshot_v23(sim.save_snapshot_v23())
        .expect("loads");
    assert_eq!(read(&restored), before);
}

/// A person who dies takes their rows with them, so a save taken after the
/// death still loads.
#[test]
fn a_dead_persons_rows_are_forgotten_so_the_save_still_loads() {
    let mut sim = fading();
    let person = crate::edit::living_entity(sim.world(), 1).unwrap();
    crate::mortality::remove_person(sim.world_mut(), person);
    let snapshot = sim.save_snapshot_v23();
    assert_eq!(snapshot.presence_fade, vec![row(2, "plants", NOW + 228)]);
    let mut fresh = Sim::new_from_shipped_lot();
    assert_eq!(fresh.load_snapshot_v23(snapshot), Ok(()));
}

/// A fade is part of the build baseline, so opening Build mode and leaving
/// it again keeps every fade, whether the player confirms or cancels.
#[test]
fn entering_and_leaving_build_keeps_the_fades() {
    let mut sim = fading();
    let rows = sim.save_snapshot_v23().presence_fade;
    assert_eq!(rows.len(), 3);
    sim.begin_build().expect("build opens");
    assert_eq!(sim.save_snapshot_v23().presence_fade, rows, "in build");
    sim.cancel_build().expect("cancel");
    sim.end_build().expect("leave");
    assert_eq!(sim.save_snapshot_v23().presence_fade, rows, "after cancel");
}

/// An ordinary construction command is applied to a candidate rebuilt from
/// a capture of the live world and installed over it, so a purchase made
/// outside Build mode must carry every fade through that capture.
#[test]
fn buying_furniture_keeps_the_fades() {
    let mut sim = fading();
    sim.world_mut().resource_mut::<terri_core::Funds>().0 = 1_000_000;
    let rows = sim.save_snapshot_v23().presence_fade;
    assert_eq!(rows.len(), 3);
    let before = sim.world().resource::<terri_core::Funds>().0;
    let floor_lamp = terri_data::pack().find("floor_lamp").expect("a floor lamp");
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::BuyObject {
            definition: floor_lamp.0,
            x: 17,
            y: 13,
            facing: terri_core::Facing::SouthEast,
        });
    sim.flush_commands();
    assert!(
        sim.world().resource::<terri_core::Funds>().0 < before,
        "the lamp was bought, so the world was rebuilt around it"
    );
    assert_eq!(sim.save_snapshot_v23().presence_fade, rows);
}

/// Rows that name nobody living, an unknown kind, a kind that has no
/// presence, repeat a pair, arrive out of order, are already over, or end
/// further ahead than any fade can last refuse the whole load and leave
/// the running world alone.
#[test]
fn schema_twenty_three_refuses_each_bad_row_and_leaves_the_world_alone() {
    let clean = fading().save_snapshot_v23();
    let beyond = NOW + LONGEST_PRESENCE_FADE_TICKS + 1;
    let cases: Vec<(&str, Vec<SavedPresenceFade>, SaveError)> = vec![
        (
            "nobody living",
            vec![row(99, "plants", NOW + 10)],
            SaveError::InvalidValue,
        ),
        (
            "an unknown kind",
            vec![row(1, "gardens", NOW + 10)],
            SaveError::InvalidContentReference,
        ),
        (
            "a kind with no presence",
            vec![row(1, "television", NOW + 10)],
            SaveError::InvalidValue,
        ),
        (
            "over this tick",
            vec![row(1, "plants", NOW)],
            SaveError::InvalidValue,
        ),
        (
            "over before this tick",
            vec![row(1, "plants", NOW - 1)],
            SaveError::InvalidValue,
        ),
        (
            "over at the start",
            vec![row(1, "plants", 0)],
            SaveError::InvalidValue,
        ),
        (
            "past the longest fade",
            vec![row(1, "plants", beyond)],
            SaveError::InvalidValue,
        ),
        (
            "an end that cannot be a tick",
            vec![row(1, "plants", u64::MAX)],
            SaveError::InvalidValue,
        ),
        (
            "the same pair twice",
            vec![row(1, "plants", NOW + 10), row(1, "plants", NOW + 11)],
            SaveError::InvalidValue,
        ),
        (
            "people out of order",
            vec![row(2, "plants", NOW + 10), row(1, "plants", NOW + 10)],
            SaveError::InvalidValue,
        ),
        (
            "kinds out of id order",
            vec![row(1, "plants", NOW + 10), row(1, "aquarium", NOW + 10)],
            SaveError::InvalidValue,
        ),
    ];
    for (name, rows, expected) in cases {
        let mut target = fading();
        let before_hash = target.world_hash();
        let before_rows = target.world().resource::<PresenceFade>().clone();
        let mut snapshot = clean.clone();
        snapshot.presence_fade = rows;
        assert_eq!(target.load_snapshot_v23(snapshot), Err(expected), "{name}");
        assert_eq!(target.world_hash(), before_hash, "{name}: world unchanged");
        assert_eq!(
            target.world().resource::<PresenceFade>(),
            &before_rows,
            "{name}: the fades are unchanged"
        );
    }

    // The bound itself is allowed: a fade may end exactly the longest a
    // fade can last after the saved tick, and the next tick is allowed too.
    for end in [NOW + 1, NOW + LONGEST_PRESENCE_FADE_TICKS] {
        let mut at_bound = clean.clone();
        at_bound.presence_fade = vec![row(1, "plants", end)];
        let mut target = Sim::new_from_shipped_lot();
        assert_eq!(target.load_snapshot_v23(at_bound), Ok(()), "end {end}");
    }
    // An empty list is a save with nothing fading.
    let mut empty = clean;
    empty.presence_fade = Vec::new();
    let mut target = fading();
    assert_eq!(target.load_snapshot_v23(empty), Ok(()));
    assert!(target
        .world()
        .resource::<PresenceFade>()
        .entries()
        .is_empty());
}

/// The digest sees a fade only while one is running: a world whose list is
/// emptied hashes as a world that never had one.
#[test]
fn the_world_hash_changes_only_while_a_fade_is_running() {
    let mut bare = Sim::new_from_shipped_lot();
    bare.world_mut().resource_mut::<SimClock>().tick = NOW;
    let plain = bare.world_hash();
    let mut sim = fading();
    assert_eq!(sim.world().resource::<PresenceFade>().entries().len(), 3);
    assert_ne!(sim.world_hash(), plain, "three fades running are hashed");
    for person in [SimId(1), SimId(2)] {
        sim.world_mut()
            .resource_mut::<PresenceFade>()
            .forget(person);
    }
    assert!(sim.world().resource::<PresenceFade>().entries().is_empty());
    assert_eq!(sim.world_hash(), plain, "no fade running, nothing hashed");
}
