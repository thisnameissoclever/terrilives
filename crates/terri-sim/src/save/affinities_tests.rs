//! Tests for saved affinity values - [OA-values] and [OA-evidence] item 3
//! in `docs/specs/2026-10-06-object-affinities.md`.

use super::*;
use crate::Sim;
use terri_core::{SelfPreservation, SimName};

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

fn kind(id: &str) -> usize {
    pack()
        .affinities
        .iter()
        .position(|kind| kind.id == id)
        .unwrap_or_else(|| panic!("content has no affinity kind {id}"))
}

fn set(sim: &mut Sim, who: Entity, values: &[f32]) {
    sim.world_mut()
        .entity_mut(who)
        .insert(Affinities::from_values(values.to_vec()));
}

/// One person's entity index and values, or `None` for a person with no
/// `Affinities` component.
type Held = (u32, Option<Vec<f32>>);

/// Every living person's values, ascending by entity index. Read per
/// person, so a world where no person holds the component reads `None`
/// for each rather than failing the query.
fn held(sim: &Sim) -> Vec<Held> {
    let world = sim.world();
    let mut people = world.try_query_filtered::<Entity, With<Agent>>().unwrap();
    let mut rows: Vec<_> = people
        .iter(world)
        .map(|entity| {
            (
                entity.index_u32(),
                world
                    .get::<Affinities>(entity)
                    .map(|values| values.values().to_vec()),
            )
        })
        .collect();
    rows.sort_by_key(|row| row.0);
    rows
}

/// What [`crate::affinity::draw`] gives every living person of `sim`, in
/// ascending entity-index order, with their worn traits, from `rng`.
fn drawn_in_index_order(sim: &Sim, rng: &mut SimRng) -> Vec<Held> {
    let mut people = sim
        .world()
        .try_query::<(Entity, &Agent, Option<&Traits>)>()
        .unwrap();
    let mut worn: Vec<(u32, Option<Traits>)> = people
        .iter(sim.world())
        .map(|(entity, _, worn)| (entity.index_u32(), worn.cloned()))
        .collect();
    worn.sort_by_key(|row| row.0);
    let rows: Vec<Held> = worn
        .into_iter()
        .map(|(index, worn)| {
            let drawn = crate::affinity::draw(rng, pack(), worn.as_ref());
            (index, Some(drawn.values().to_vec()))
        })
        .collect();
    assert_eq!(rows.len(), 3, "the shipped household");
    rows
}

fn rng(sim: &Sim) -> SimRng {
    sim.world().resource::<SimRng>().clone()
}

#[test]
fn a_current_save_round_trips_affinity_rows_exactly() {
    let mut live = Sim::new_from_shipped_lot();
    let pack = pack();
    let casey = person(&live, "Casey");
    // Kinds order is plants, aquarium, television, radio; the aquarium
    // value is zero, so it has no row.
    set(&mut live, casey, &[0.123_456_7, 0.0, -1.0, 1.0]);
    let snapshot = live.save_snapshot_v5();

    let mut expected = Vec::new();
    for (index, values) in held(&live) {
        for (kind, value) in values
            .expect("every person holds values")
            .into_iter()
            .enumerate()
        {
            if value != 0.0 {
                expected.push((index, pack.affinities[kind].id.clone(), value));
            }
        }
    }
    expected.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    let casey_rows: Vec<_> = expected
        .iter()
        .filter(|row| row.0 == casey.index_u32())
        .map(|row| (row.1.as_str(), row.2))
        .collect();
    assert_eq!(
        casey_rows,
        vec![
            ("plants", 0.123_456_7),
            ("radio", 1.0),
            ("television", -1.0)
        ],
        "sorted by id, and no row for a zero"
    );
    assert!(
        expected.len() > casey_rows.len(),
        "the others' drawn values"
    );
    assert_eq!(
        snapshot.affinities,
        Some(SavedAffinities { rows: expected })
    );

    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(snapshot.clone()).unwrap();
    assert_eq!(held(&loaded), held(&live));
    assert_eq!(
        rng(&loaded),
        snapshot.world.rng,
        "a present field draws nothing"
    );
    assert_eq!(loaded.world_hash(), live.world_hash());
    assert_eq!(loaded.save_snapshot_v5(), snapshot);
    for _ in 0..50 {
        live.tick();
        loaded.tick();
    }
    assert_eq!(loaded.world_hash(), live.world_hash());
}

#[test]
fn a_save_without_the_field_draws_once_in_entity_order_from_the_saved_generator() {
    let live = Sim::new_from_shipped_lot();
    let mut legacy = live.save_snapshot_v5();
    legacy.affinities = None;
    let mut reference = legacy.world.rng.clone();
    let expected = drawn_in_index_order(&live, &mut reference);
    assert_ne!(expected, held(&live), "a fresh draw, not the spawn values");

    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(legacy.clone()).unwrap();
    assert_eq!(held(&loaded), expected);
    assert_eq!(rng(&loaded), reference, "four draws per person, no more");
    let bill = person(&loaded, "Bill");
    assert_eq!(
        loaded.world().get::<Affinities>(bill).unwrap().values()[kind("television")],
        0.8,
        "Bill wears Television devotee"
    );

    // The same bytes seed the same household on every load.
    let mut again = Sim::new_from_shipped_lot();
    again.load_snapshot_v5(legacy).unwrap();
    assert_eq!(held(&again), expected);
    assert_eq!(again.world_hash(), loaded.world_hash());

    // The next save carries the field, and loading it draws nothing more.
    let next = loaded.save_snapshot_v5();
    assert!(next.affinities.is_some());
    let mut reloaded = Sim::new_from_shipped_lot();
    reloaded.load_snapshot_v5(next.clone()).unwrap();
    assert_eq!(held(&reloaded), expected);
    assert_eq!(rng(&reloaded), next.world.rng);
    assert_eq!(reloaded.save_snapshot_v5(), next);
}

/// A save older than both instincts and affinities takes its instinct
/// draws first, so the instincts are the ones it got before affinities
/// existed, and the affinity draws follow them.
#[test]
fn a_save_without_instincts_or_affinities_draws_the_instincts_first() {
    let live = Sim::new_from_shipped_lot();
    let mut legacy = live.save_snapshot_v5();
    legacy.self_preservation = Vec::new();
    legacy.affinities = None;
    let mut reference = legacy.world.rng.clone();
    let indices: Vec<u32> = held(&live).into_iter().map(|row| row.0).collect();
    let instincts: Vec<(u32, u8)> = indices
        .iter()
        .map(|&index| (index, 30 + reference.range(41) as u8))
        .collect();
    let expected = drawn_in_index_order(&live, &mut reference);

    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(legacy).unwrap();
    let next = loaded.save_snapshot_v5();
    assert_eq!(next.self_preservation, instincts);
    assert_eq!(held(&loaded), expected);
    assert_eq!(rng(&loaded), reference);
}

/// The seed reads people in entity-index order, not in the order the
/// world happens to store them.
#[test]
fn the_seed_sorts_reordered_storage_before_drawing() {
    #[derive(Component)]
    struct Temporary;
    let mut world = World::new();
    world.insert_resource(SimRng::from_seed(17));
    let people: Vec<Entity> = (0..3)
        .map(|_| world.spawn((Agent, SelfPreservation(50))).id())
        .collect();
    world.entity_mut(people[0]).insert(Temporary);
    world.entity_mut(people[0]).remove::<Temporary>();
    let raw: Vec<u32> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(&world)
        .map(|entity| entity.index_u32())
        .collect();
    assert!(
        raw.windows(2).any(|pair| pair[0] > pair[1]),
        "fixture must reorder storage: {raw:?}"
    );
    let mut reference = SimRng::from_seed(17);
    let expected: Vec<Vec<f32>> = people
        .iter()
        .map(|_| {
            crate::affinity::draw(&mut reference, pack(), None)
                .values()
                .to_vec()
        })
        .collect();
    restore(&mut world, pack(), None).unwrap();
    for (person, values) in people.iter().zip(&expected) {
        assert_eq!(
            world.get::<Affinities>(*person).unwrap().values(),
            values.as_slice()
        );
    }
    assert_eq!(world.resource::<SimRng>(), &reference);
}

#[test]
fn every_older_envelope_draws_affinities_after_the_instincts() {
    let source = Sim::new_from_shipped_lot_with_seed(1009);
    let saved = source.save_snapshot_v5();
    let mut reference = saved.world.rng.clone();
    // No envelope before V5 carries instincts either, so those come first.
    for _ in 0..3 {
        reference.range(41);
    }
    let expected = drawn_in_index_order(&source, &mut reference);
    for version in 1..=4 {
        let mut loaded = Sim::new_from_shipped_lot_with_seed(777);
        match version {
            1 => loaded.load_snapshot(source.save_snapshot()),
            2 => loaded.load_snapshot_v2(source.save_snapshot_v2()),
            3 => loaded.load_snapshot_v3(source.save_snapshot_v3()),
            _ => loaded.load_snapshot_v4(source.save_snapshot_v4()),
        }
        .unwrap();
        assert_eq!(held(&loaded), expected, "V{version}");
        assert_eq!(rng(&loaded), reference, "V{version}");
        assert!(loaded.save_snapshot_v5().affinities.is_some(), "V{version}");
    }
}

#[test]
fn a_present_empty_field_draws_nothing_and_leaves_zeros() {
    let live = Sim::new_from_shipped_lot();
    let mut snapshot = live.save_snapshot_v5();
    snapshot.affinities = Some(SavedAffinities::default());
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(snapshot.clone()).unwrap();
    let people = held(&loaded);
    assert_eq!(people.len(), 3);
    for (index, values) in people {
        assert_eq!(values, Some(vec![0.0; 4]), "person {index}");
    }
    assert_eq!(rng(&loaded), snapshot.world.rng);
    assert_eq!(loaded.save_snapshot_v5(), snapshot);
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
    assert_eq!(people.len(), 2);
    let (first, second) = (people[0], people[1]);
    let object = good
        .world
        .entities
        .iter()
        .find(|row| row.smart_object.is_some())
        .unwrap()
        .index;
    let row = |index: u32, id: &str, value: f32| (index, id.to_string(), value);
    let hash = live.world_hash();
    for (rows, error) in [
        (
            vec![row(first, "juggling", 0.5)],
            SaveError::InvalidContentReference,
        ),
        (
            vec![row(first, "plants", 0.5), row(second, "juggling", 0.5)],
            SaveError::InvalidContentReference,
        ),
        (
            vec![row(second, "plants", 0.5), row(first, "plants", 0.5)],
            SaveError::InvalidValue,
        ),
        (
            vec![row(first, "radio", 0.5), row(first, "plants", 0.5)],
            SaveError::InvalidValue,
        ),
        (
            vec![row(first, "plants", 0.5), row(first, "plants", 0.25)],
            SaveError::InvalidValue,
        ),
        (vec![row(object, "plants", 0.5)], SaveError::InvalidValue),
        (vec![row(dead, "plants", 0.5)], SaveError::InvalidValue),
        (vec![row(u32::MAX, "plants", 0.5)], SaveError::InvalidValue),
        (vec![row(first, "plants", 1.5)], SaveError::InvalidValue),
        (vec![row(first, "plants", -1.5)], SaveError::InvalidValue),
        (
            vec![row(first, "plants", f32::from_bits(1.0f32.to_bits() + 1))],
            SaveError::InvalidValue,
        ),
        (
            vec![row(first, "plants", f32::INFINITY)],
            SaveError::InvalidValue,
        ),
        (
            vec![row(first, "plants", f32::NAN)],
            SaveError::InvalidValue,
        ),
        (vec![row(first, "plants", 0.0)], SaveError::InvalidValue),
        (vec![row(first, "plants", -0.0)], SaveError::InvalidValue),
    ] {
        let mut bad = good.clone();
        bad.affinities = Some(SavedAffinities { rows: rows.clone() });
        assert_eq!(live.load_snapshot_v5(bad), Err(error), "{rows:?}");
        assert_eq!(live.world_hash(), hash, "{rows:?}");
        assert_eq!(live.save_snapshot_v5(), good, "{rows:?}");
    }
    // The control: the same world with values at both ends of the range,
    // and the smallest above zero, loads them exactly.
    let smallest = f32::from_bits(1);
    let mut edge = good.clone();
    edge.affinities = Some(SavedAffinities {
        rows: vec![
            row(first, "aquarium", -1.0),
            row(first, "plants", smallest),
            row(first, "television", 1.0),
        ],
    });
    live.load_snapshot_v5(edge.clone()).unwrap();
    let mut values = vec![0.0; 4];
    values[kind("aquarium")] = -1.0;
    values[kind("plants")] = smallest;
    values[kind("television")] = 1.0;
    assert_eq!(held(&live)[0], (first, Some(values)));
    assert_eq!(held(&live)[1], (second, Some(vec![0.0; 4])));
    assert_eq!(live.save_snapshot_v5(), edge);
}
