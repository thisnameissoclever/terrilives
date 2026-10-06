//! [OA-hud] in docs/specs/2026-10-06-object-affinities.md: the word for
//! each person's affinity values and the kind labels cross the boundary for
//! the Likes and dislikes view. Run in release too (`cargo test -p terri-wasm
//! --release affinity_boundary`), the profile `wasm-pack build` ships
//! ([L12]).

use super::*;
use terri_core::{Affinities, Entity, SimName};

/// The entity index of the household member called `name`. The household
/// spawns after the placed objects, so a short scan past them finds it.
fn index_named(handle: &SimHandle, name: &str) -> u32 {
    let bound = handle
        .sim
        .world()
        .resource::<Content>()
        .0
        .lot
        .placements
        .len() as u32
        + 16;
    (0..bound)
        .find(|&index| handle.sim_name(index) == name)
        .unwrap_or_else(|| panic!("{name} is in the shipped household"))
}

/// The person called `name`, read from the world rather than through the
/// boundary under test.
fn entity_named(handle: &mut SimHandle, name: &str) -> Entity {
    let world = handle.sim.world_mut();
    world
        .query::<(Entity, &SimName)>()
        .iter(world)
        .find(|(_, held)| held.0 == name)
        .unwrap_or_else(|| panic!("{name} is in the shipped household"))
        .0
}

#[test]
fn affinity_labels_follow_pack_order() {
    let mut handle = SimHandle::from_lot();
    let pack = handle.sim.world().resource::<Content>().0;
    assert_eq!(
        handle.affinity_labels(),
        ["plants", "aquarium", "television", "radio"]
    );
    assert_eq!(
        handle.affinity_labels(),
        pack.affinities
            .iter()
            .map(|kind| kind.label.clone())
            .collect::<Vec<_>>()
    );
    // The shipped labels equal the ids, so a pack whose labels differ shows
    // that the read is the label a player sees, not the id a save names.
    let mut relabelled = pack.clone();
    for kind in &mut relabelled.affinities {
        kind.label = format!("{} label", kind.id);
    }
    handle
        .sim
        .world_mut()
        .insert_resource(Content(Box::leak(Box::new(relabelled))));
    assert_eq!(
        handle.affinity_labels(),
        [
            "plants label",
            "aquarium label",
            "television label",
            "radio label"
        ]
    );
}

#[test]
fn affinity_words_of_words_each_persons_stored_values_in_kind_order() {
    let mut handle = SimHandle::from_lot();
    let bytes = handle.save_bytes();
    let hash = handle.world_hash();
    let tuning = handle.sim.world().resource::<Content>().0.tuning;
    for name in ["Tim", "Bill", "Casey"] {
        let index = index_named(&handle, name);
        let entity = entity_named(&mut handle, name);
        let stored = handle
            .sim
            .world()
            .get::<Affinities>(entity)
            .expect("a household member holds affinity values")
            .values()
            .to_vec();
        assert_eq!(
            handle.sim.affinities_of(index),
            Some(stored.clone()),
            "{name}: the simulation reads the stored values"
        );
        let words = handle.affinity_words_of(index);
        assert_eq!(words.len(), 4, "{name}: one word per kind");
        assert_eq!(
            words,
            stored
                .iter()
                .map(|&value| terri_sim::affinity::band(value, &tuning))
                .collect::<Vec<_>>(),
            "{name}"
        );
    }
    // Bill wears Television devotee, which sets television, the third kind,
    // to `affinity_from_trait`, and Fish watcher, which sets the aquarium,
    // the second, to `affinity_from_mild_trait`.
    let bill = index_named(&handle, "Bill");
    let values = handle.sim.affinities_of(bill).expect("Bill is a person");
    assert_eq!((values[1], values[2]), (0.4, 0.8));
    let words = handle.affinity_words_of(bill);
    assert_eq!((words[1].as_str(), words[2].as_str()), ("Likes", "Loves"));
    assert_eq!(handle.save_bytes(), bytes, "reading words saves nothing");
    assert_eq!(handle.world_hash(), hash, "reading words hashes nothing");

    // The read follows the stored values, not a copy taken at spawn.
    let tim = index_named(&handle, "Tim");
    let entity = entity_named(&mut handle, "Tim");
    handle
        .sim
        .world_mut()
        .entity_mut(entity)
        .insert(Affinities::from_values(vec![-1.0, 0.25, 0.0, 0.6]));
    assert_eq!(
        handle.affinity_words_of(tim),
        ["Hates", "Likes", "Indifferent", "Loves"]
    );

    // And the word follows the edges in tuning, not edges of its own.
    let mut retuned = handle.sim.world().resource::<Content>().0.clone();
    retuned.tuning.affinity_band_loves = 0.75;
    retuned.tuning.affinity_band_likes = 0.5;
    handle
        .sim
        .world_mut()
        .insert_resource(Content(Box::leak(Box::new(retuned))));
    assert_eq!(
        handle.affinity_words_of(tim),
        ["Hates", "Indifferent", "Indifferent", "Likes"]
    );
}

#[test]
fn affinity_words_of_rejects_non_people_in_release() {
    let mut handle = SimHandle::from_lot();
    let tim = index_named(&handle, "Tim");
    assert_eq!(handle.affinity_words_of(tim).len(), 4);

    // Tim dies of hunger on the first tick it is empty, so his index is
    // retired the way a real death retires it.
    let mut retuned = handle.sim.world().resource::<Content>().0.clone();
    retuned.tuning.death_after_ticks = 1;
    handle
        .sim
        .world_mut()
        .insert_resource(Content(Box::leak(Box::new(retuned))));
    assert!(handle.set_death_enabled(true));
    handle.flush_commands();
    for _ in 0..8 {
        if handle.sim_name(tim).is_empty() {
            break;
        }
        let world = handle.sim.world_mut();
        let mut people = world.query::<(&SimName, &mut Needs)>();
        for (name, mut needs) in people.iter_mut(world) {
            if name.0 == "Tim" {
                needs.set(NeedId::Hunger, 0.0);
            }
        }
        handle.tick();
    }
    assert!(handle.sim_name(tim).is_empty(), "Tim died");
    assert!(handle.sim.save_snapshot_v5().retired_indices.contains(&tim));

    let object = 0;
    assert!(object < tim, "index 0 is a placed object");
    assert!(handle.sim_name(object).is_empty());
    let bytes = handle.save_bytes();
    let hash = handle.world_hash();
    for index in [object, u32::MAX, tim] {
        assert!(handle.affinity_words_of(index).is_empty(), "{index}");
        assert_eq!(handle.sim.affinities_of(index), None, "{index}");
    }
    let bill = index_named(&handle, "Bill");
    assert_eq!(
        handle.affinity_words_of(bill).len(),
        4,
        "a living person still reads"
    );
    assert_eq!(handle.save_bytes(), bytes);
    assert_eq!(handle.world_hash(), hash);
}
