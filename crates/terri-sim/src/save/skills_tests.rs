//! Tests for saved skill practice - [SK-save] and [SK-evidence] item 5 in
//! `docs/specs/2026-10-05-skills.md`.

use super::*;
use crate::skills::{mastery_for_tag, seed_from_states, skill_for_tag, Ladder};
use crate::Sim;
use terri_core::{Agent, SimName, Skills, Traits};

fn pack() -> &'static ContentPack {
    terri_data::pack()
}

fn person(sim: &Sim, name: &str) -> Entity {
    let mut people = sim.world().try_query::<(Entity, &SimName)>().unwrap();
    people
        .iter(sim.world())
        .find(|(_, n)| n.0 == name)
        .unwrap_or_else(|| panic!("nobody named {name}"))
        .0
}

fn skill(tag: &str) -> u32 {
    skill_for_tag(pack(), tag).expect("shipped skill").0
}

fn trait_index(id: &str) -> u32 {
    pack()
        .traits
        .iter()
        .position(|definition| definition.id == id)
        .unwrap_or_else(|| panic!("content has no trait {id}")) as u32
}

fn top(tag: &str) -> f32 {
    let pack = pack();
    Ladder::from_tuning(&pack.tuning).max_practice(pack.skills[skill(tag) as usize].levels)
}

fn set(sim: &mut Sim, who: Entity, skill: u32, practice: f32) {
    sim.world_mut()
        .get_mut::<Skills>(who)
        .expect("a person holds practice")
        .set_practice(skill, practice);
}

fn wear_state(sim: &mut Sim, who: Entity, trait_id: &str, state: f32) {
    sim.world_mut()
        .get_mut::<Traits>(who)
        .unwrap()
        .set_state(trait_index(trait_id), state);
}

/// One person's entity index and practice entries, or `None` for a person
/// with no `Skills` component.
type Held = (u32, Option<Vec<(u32, f32)>>);

/// Every living person's practice entries, ascending by entity index.
fn held(sim: &Sim) -> Vec<Held> {
    let mut people = sim
        .world()
        .try_query::<(Entity, &Agent, Option<&Skills>)>()
        .unwrap();
    let mut rows: Vec<_> = people
        .iter(sim.world())
        .map(|(entity, _, skills)| {
            (
                entity.index_u32(),
                skills.map(|skills| skills.entries().to_vec()),
            )
        })
        .collect();
    rows.sort_by_key(|row| row.0);
    rows
}

/// Asserts every person holds exactly what [`seed_from_states`] gives
/// their worn traits, and that the shipped household was all checked.
fn assert_seeded_from_states(sim: &Sim, context: &str) {
    let mut people = sim
        .world()
        .try_query::<(Entity, &Agent, Option<&Traits>, Option<&Skills>)>()
        .unwrap();
    let mut checked = 0;
    for (entity, _, worn, skills) in people.iter(sim.world()) {
        let mut expected = Skills::default();
        if let Some(worn) = worn {
            seed_from_states(&mut expected, worn, pack());
        }
        assert_eq!(
            skills,
            Some(&expected),
            "{context}: person {}",
            entity.index_u32()
        );
        checked += 1;
    }
    assert_eq!(checked, 3, "{context}: the shipped household");
}

fn cooking_mastery(sim: &Sim, who: Entity) -> f32 {
    mastery_for_tag(sim.world().get::<Skills>(who), pack(), "cooking").unwrap()
}

#[test]
fn a_current_save_round_trips_practice_rows_exactly() {
    let mut live = Sim::new_from_shipped_lot();
    let pack = pack();
    let casey = person(&live, "Casey");
    let bill = person(&live, "Bill");
    set(&mut live, casey, skill("cooking"), 0.123_456_7);
    set(&mut live, casey, skill("reading"), top("reading"));
    set(&mut live, bill, skill("exercise"), 0.333_333_3);
    let snapshot = live.save_snapshot_v5();

    let mut expected = Vec::new();
    for (index, entries) in held(&live) {
        for (skill, practice) in entries.expect("every person holds practice") {
            if practice != 0.0 {
                expected.push((index, pack.skills[skill as usize].id.clone(), practice));
            }
        }
    }
    expected.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    for row in [
        (casey.index_u32(), "cooking".to_string(), 0.123_456_7),
        (casey.index_u32(), "reading".to_string(), top("reading")),
        (bill.index_u32(), "exercise".to_string(), 0.333_333_3),
    ] {
        assert!(expected.contains(&row), "{row:?}");
    }
    assert_eq!(snapshot.skills, Some(SavedSkills { rows: expected }));

    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(snapshot.clone()).unwrap();
    assert_eq!(held(&loaded), held(&live));
    assert_eq!(loaded.world_hash(), live.world_hash());
    assert_eq!(loaded.save_snapshot_v5(), snapshot);
    for _ in 0..50 {
        live.tick();
        loaded.tick();
    }
    assert_eq!(loaded.world_hash(), live.world_hash());
}

#[test]
fn a_legacy_save_seeds_practice_from_capability_states_once() {
    let mut live = Sim::new_from_shipped_lot();
    let casey = person(&live, "Casey");
    // The start level is 0.25; the saved state is what the seed must read.
    wear_state(&mut live, casey, "cannot_cook", 0.7);
    let mut legacy = live.save_snapshot_v5();
    legacy.skills = None;

    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(legacy).unwrap();
    assert!((cooking_mastery(&loaded, casey) - 0.7).abs() < 1e-5);
    assert_seeded_from_states(&loaded, "legacy V5");

    let next = loaded.save_snapshot_v5();
    let rows = next
        .skills
        .clone()
        .expect("the next save carries the field");
    assert!(!rows.rows.is_empty());
    // Raise the saved state: a second seed would raise practice with it.
    let mut reloaded = next.clone();
    let traits = reloaded
        .world
        .entities
        .iter_mut()
        .find(|row| row.index == casey.index_u32())
        .unwrap()
        .traits
        .as_mut()
        .unwrap();
    traits
        .iter_mut()
        .find(|worn| worn.id == "cannot_cook")
        .unwrap()
        .state = 0.95;
    let mut again = Sim::new_from_shipped_lot();
    again.load_snapshot_v5(reloaded).unwrap();
    assert_eq!(held(&again), held(&loaded));
    assert_eq!(again.save_snapshot_v5().skills, Some(rows));
}

#[test]
fn every_older_envelope_seeds_practice_from_capability_states() {
    for version in 1..=4 {
        let mut source = Sim::new_from_shipped_lot();
        let casey = person(&source, "Casey");
        wear_state(&mut source, casey, "cannot_cook", 0.7);
        // Practice an older envelope cannot carry.
        set(&mut source, casey, skill("cooking"), top("cooking"));
        let mut loaded = Sim::new_from_shipped_lot();
        match version {
            1 => loaded.load_snapshot(source.save_snapshot()),
            2 => loaded.load_snapshot_v2(source.save_snapshot_v2()),
            3 => loaded.load_snapshot_v3(source.save_snapshot_v3()),
            _ => loaded.load_snapshot_v4(source.save_snapshot_v4()),
        }
        .unwrap();
        assert!(
            (cooking_mastery(&loaded, casey) - 0.7).abs() < 1e-5,
            "V{version}"
        );
        assert_seeded_from_states(&loaded, &format!("V{version}"));
        assert!(loaded.save_snapshot_v5().skills.is_some(), "V{version}");
    }
}

#[test]
fn a_present_empty_field_seeds_nothing() {
    let mut live = Sim::new_from_shipped_lot();
    let casey = person(&live, "Casey");
    wear_state(&mut live, casey, "cannot_cook", 0.7);
    let mut snapshot = live.save_snapshot_v5();
    snapshot.skills = Some(SavedSkills::default());
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(snapshot).unwrap();
    let people = held(&loaded);
    assert_eq!(people.len(), 3);
    for (index, entries) in people {
        assert_eq!(entries, Some(vec![]), "person {index}");
    }
}

#[test]
fn invalid_rows_refuse_the_load_without_touching_the_live_world() {
    let mut live = Sim::new_from_shipped_lot();
    let bill = person(&live, "Bill");
    crate::mortality::remove_person(live.world_mut(), bill);
    let good = live.save_snapshot_v5();
    let dead = bill.index_u32();
    assert!(good.retired_indices.contains(&dead));
    let people: Vec<u32> = held(&live).into_iter().map(|(index, _)| index).collect();
    let (first, second) = (people[0], people[1]);
    let object = good
        .world
        .entities
        .iter()
        .find(|row| row.smart_object.is_some())
        .unwrap()
        .index;
    let top = top("cooking");
    let above = f32::from_bits(top.to_bits() + 1);
    let row = |index: u32, id: &str, practice: f32| (index, id.to_string(), practice);
    let hash = live.world_hash();
    for (rows, error) in [
        (
            vec![row(first, "juggling", 0.1)],
            SaveError::InvalidContentReference,
        ),
        (
            vec![row(first, "cooking", 0.1), row(second, "juggling", 0.1)],
            SaveError::InvalidContentReference,
        ),
        (
            vec![row(second, "cooking", 0.1), row(first, "cooking", 0.1)],
            SaveError::InvalidValue,
        ),
        (
            vec![row(first, "reading", 0.1), row(first, "cooking", 0.1)],
            SaveError::InvalidValue,
        ),
        (
            vec![row(first, "cooking", 0.1), row(first, "cooking", 0.2)],
            SaveError::InvalidValue,
        ),
        (vec![row(object, "cooking", 0.1)], SaveError::InvalidValue),
        (vec![row(dead, "cooking", 0.1)], SaveError::InvalidValue),
        (vec![row(u32::MAX, "cooking", 0.1)], SaveError::InvalidValue),
        (vec![row(first, "cooking", above)], SaveError::InvalidValue),
        (
            vec![row(first, "cooking", f32::INFINITY)],
            SaveError::InvalidValue,
        ),
        (vec![row(first, "cooking", -0.1)], SaveError::InvalidValue),
        (
            vec![row(first, "cooking", f32::NAN)],
            SaveError::InvalidValue,
        ),
        (vec![row(first, "cooking", 0.0)], SaveError::InvalidValue),
    ] {
        let mut bad = good.clone();
        bad.skills = Some(SavedSkills { rows: rows.clone() });
        assert_eq!(live.load_snapshot_v5(bad), Err(error), "{rows:?}");
        assert_eq!(live.world_hash(), hash, "{rows:?}");
        assert_eq!(live.save_snapshot_v5(), good, "{rows:?}");
    }
    // The control: the same world with rows at both ends of the range loads.
    let smallest = f32::from_bits(1);
    let mut edge = good.clone();
    edge.skills = Some(SavedSkills {
        rows: vec![row(first, "cooking", top), row(first, "reading", smallest)],
    });
    live.load_snapshot_v5(edge.clone()).unwrap();
    assert_eq!(
        held(&live)[0],
        (
            first,
            Some(vec![(skill("cooking"), top), (skill("reading"), smallest)])
        )
    );
    assert_eq!(live.save_snapshot_v5(), edge);
}

#[test]
fn the_world_hash_observes_practice_and_its_owner() {
    let mut sim = Sim::new_from_shipped_lot();
    let casey = person(&sim, "Casey");
    let bill = person(&sim, "Bill");
    let (cooking, reading) = (skill("cooking"), skill("reading"));
    let names = |sim: &Sim| {
        let mut people = sim.world().try_query::<(Entity, &SimName)>().unwrap();
        let mut names: Vec<_> = people
            .iter(sim.world())
            .map(|(entity, name)| (entity.index_u32(), name.0.clone()))
            .collect();
        names.sort();
        names
    };
    let named = names(&sim);
    let original = sim.world().get::<Skills>(casey).unwrap().practice(cooking);
    assert!(original > 0.0, "Casey's cooking is seeded at spawn");
    let base = sim.world_hash();

    set(
        &mut sim,
        casey,
        cooking,
        f32::from_bits(original.to_bits() + 1),
    );
    assert_ne!(sim.world_hash(), base, "one f32 step of practice");
    set(&mut sim, casey, cooking, original);
    assert_eq!(sim.world_hash(), base, "restored practice");

    set(&mut sim, casey, cooking, 0.0);
    let without = sim.world_hash();
    assert_ne!(without, base, "practice removed");
    set(&mut sim, bill, cooking, original);
    let moved = sim.world_hash();
    assert_ne!(moved, base, "the same practice held by someone else");
    assert_ne!(moved, without);
    set(&mut sim, bill, cooking, 0.0);
    set(&mut sim, bill, reading, original);
    assert_ne!(
        sim.world_hash(),
        moved,
        "the same practice in another skill"
    );
    assert_eq!(names(&sim), named);
}
