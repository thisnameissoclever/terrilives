//! Tests for colourways - [RC-command], [RC-save] and [RC-render] in
//! `docs/specs/2026-09-22-colourways.md`.

use super::*;
use crate::Sim;
use terri_core::{Agent, CommandQueue, Reserved, SimCommand, SmartObject};

/// Every placed object whose definition has `id`, in index order.
fn placed(sim: &Sim, id: &str) -> Vec<Entity> {
    let world = sim.world();
    let wanted = terri_data::pack().find(id).unwrap();
    let mut query = world.try_query::<(Entity, &SmartObject)>().unwrap();
    let mut found: Vec<Entity> = query
        .iter(world)
        .filter(|(_, object)| object.0 == wanted)
        .map(|(entity, _)| entity)
        .collect();
    found.sort_by_key(|entity| entity.index_u32());
    found
}

fn a_sim(sim: &Sim) -> Entity {
    let world = sim.world();
    let mut query = world.try_query::<(Entity, &Agent)>().unwrap();
    query.iter(world).map(|(entity, _)| entity).min().unwrap()
}

fn stage(sim: &mut Sim, object: u32, colourway: u32) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetColourway { object, colourway });
}

fn recolour(sim: &mut Sim, object: Entity, colourway: u32) {
    stage(sim, object.index_u32(), colourway);
    sim.flush_commands();
}

fn last(sim: &Sim) -> Option<ColourwayResult> {
    sim.world().resource::<LotEditState>().last_colourway_result
}

fn revision(sim: &Sim) -> u64 {
    sim.world().resource::<LotEditState>().revision
}

fn colourway_of(sim: &Sim, entity: Entity) -> Option<u32> {
    sim.world()
        .get::<Colourway>(entity)
        .map(|colourway| colourway.0)
}

/// [RC-command] and [RC-render]: a colourway is applied, drawn in the render
/// column, hashed and counted as a lot edit; the first colourway undoes it
/// and stores nothing, so the world hashes as it did.
#[test]
fn a_colourway_is_drawn_and_hashed_and_the_first_undoes_it() {
    let mut sim = Sim::new_from_shipped_lot();
    let sofa = placed(&sim, "sofa")[0];
    let before = sim.world_hash();
    let revision_before = revision(&sim);
    recolour(&mut sim, sofa, 2);
    assert_eq!(
        last(&sim),
        Some(ColourwayResult {
            object: sofa.index_u32(),
            colourway: 2,
            reason: None
        })
    );
    assert_eq!(colourway_of(&sim, sofa), Some(2));
    assert_eq!(revision(&sim), revision_before + 1);
    assert_ne!(sim.world_hash(), before, "a colourway changes the world");
    sim.sync_render_buffer();
    let render = sim.render_buffer();
    let row = render
        .ids
        .iter()
        .position(|&id| id == sofa.index_u32())
        .unwrap();
    for (other, &colourway) in render.colourways.iter().enumerate() {
        assert_eq!(colourway, if other == row { 2 } else { 0 }, "row {other}");
    }

    recolour(&mut sim, sofa, 0);
    assert_eq!(
        colourway_of(&sim, sofa),
        None,
        "the first is stored as nothing"
    );
    assert_eq!(revision(&sim), revision_before + 2);
    assert_eq!(sim.world_hash(), before);
}

/// [RC-command]: an unknown object is refused before an unknown colourway,
/// by the preview and the drain alike, and a refusal writes nothing.
#[test]
fn a_refused_colourway_writes_nothing() {
    use PlacementRefusal::*;
    let mut sim = Sim::new_from_shipped_lot();
    let sofa = placed(&sim, "sofa")[0].index_u32();
    let person = a_sim(&sim).index_u32();
    let count = terri_data::pack().colourways.len() as u32;
    for (object, colourway, reason) in [
        (person, 1, UnknownObject),
        (u32::MAX, 1, UnknownObject),
        (person, count, UnknownObject),
        (sofa, count, UnknownColourway),
        (sofa, u32::MAX, UnknownColourway),
    ] {
        let hash = sim.world_hash();
        let revision_before = revision(&sim);
        assert_eq!(
            validate_colourway(sim.world(), object, colourway),
            Err(reason)
        );
        stage(&mut sim, object, colourway);
        sim.flush_commands();
        assert_eq!(
            last(&sim),
            Some(ColourwayResult {
                object,
                colourway,
                reason: Some(reason)
            })
        );
        assert_eq!(sim.world_hash(), hash, "{object} {colourway}");
        assert_eq!(revision(&sim), revision_before);
    }
}

/// [RC-command]: a colourway changes no tile, reservation or route, so an
/// object in use takes one.
#[test]
fn an_object_in_use_takes_a_colourway() {
    let mut sim = Sim::new_from_shipped_lot();
    let sofa = placed(&sim, "sofa")[0];
    sim.world_mut().entity_mut(sofa).insert(Reserved);
    recolour(&mut sim, sofa, 1);
    assert_eq!(last(&sim).unwrap().reason, None);
    assert_eq!(colourway_of(&sim, sofa), Some(1));
}

/// [RC-save]: a V5 save records each recoloured object by index and
/// colourway id, ascending, and loads to the same world; the same world saved
/// as V4 loads with every object as drawn.
#[test]
fn a_v5_save_keeps_colourways_and_a_v4_save_loads_as_drawn() {
    let mut sim = Sim::new_from_shipped_lot();
    let stove = placed(&sim, "stove")[0];
    let sofa = placed(&sim, "sofa")[0];
    recolour(&mut sim, stove, 4);
    recolour(&mut sim, sofa, 2);
    let saved = sim.save_snapshot_v5();
    let mut expected = vec![
        (stove.index_u32(), "rich".to_string()),
        (sofa.index_u32(), "colour_3".to_string()),
    ];
    expected.sort();
    assert_eq!(saved.object_colourways, expected);

    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(saved).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
    assert_eq!(
        (colourway_of(&loaded, stove), colourway_of(&loaded, sofa)),
        (Some(4), Some(2))
    );

    let mut older = Sim::new_from_shipped_lot();
    older.load_snapshot_v4(sim.save_snapshot_v4()).unwrap();
    // No query means the component was never used in that world at all.
    let world = older.world();
    let recoloured = world
        .try_query::<&Colourway>()
        .map_or(0, |mut query| query.iter(world).count());
    assert_eq!(recoloured, 0);
}

/// [RC-save]: a V5 save whose colourways break the order, repeat an index or
/// name something that is not a placed object is refused, and the running
/// world is untouched. An id the content no longer has, or one naming the
/// first colourway, loads as drawn.
#[test]
fn a_v5_save_with_bad_colourways_is_refused() {
    let mut sim = Sim::new_from_shipped_lot();
    let stove = placed(&sim, "stove")[0].index_u32();
    let sofa = placed(&sim, "sofa")[0].index_u32();
    let person = a_sim(&sim).index_u32();
    let sofa_entity = placed(&sim, "sofa")[0];
    recolour(&mut sim, sofa_entity, 1);
    let good = sim.save_snapshot_v5();
    let (low, high) = (stove.min(sofa), stove.max(sofa));
    let entry = |index: u32, id: &str| (index, id.to_string());
    for colourways in [
        vec![entry(high, "muted"), entry(low, "muted")],
        vec![entry(low, "muted"), entry(low, "rich")],
        vec![entry(person, "muted")],
        vec![entry(99_999, "muted")],
        vec![entry(u32::MAX, "muted")],
    ] {
        let mut bad = good.clone();
        bad.object_colourways = colourways.clone();
        let mut target = Sim::new_from_shipped_lot();
        let before = target.world_hash();
        assert!(target.load_snapshot_v5(bad).is_err(), "{colourways:?}");
        assert_eq!(target.world_hash(), before);
    }
    for as_drawn in ["tartan", "as_drawn"] {
        let mut retired = good.clone();
        retired.object_colourways = vec![entry(low, as_drawn)];
        let mut target = Sim::new_from_shipped_lot();
        target.load_snapshot_v5(retired).unwrap();
        let world = target.world();
        let recoloured = world
            .try_query::<&Colourway>()
            .map_or(0, |mut query| query.iter(world).count());
        assert_eq!(recoloured, 0, "{as_drawn} loads as drawn");
    }
    let mut target = Sim::new_from_shipped_lot();
    target.load_snapshot_v5(good).unwrap();
    assert_eq!(target.world_hash(), sim.world_hash());
}

/// [RC-save]: a colourway change staged just before a save is saved by id
/// and applies after the Load exactly as it would have; one naming no
/// colourway restores as one the drain refuses.
#[test]
fn a_staged_colourway_is_saved_and_replayed() {
    let mut playing = Sim::new_from_shipped_lot();
    let sofa = placed(&playing, "sofa")[0];
    stage(&mut playing, sofa.index_u32(), 3);
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(playing.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), playing.world_hash());
    playing.flush_commands();
    loaded.flush_commands();
    assert_eq!(loaded.world_hash(), playing.world_hash());
    assert_eq!(colourway_of(&loaded, sofa), Some(3));

    stage(&mut playing, sofa.index_u32(), 99);
    let mut unknown = Sim::new_from_shipped_lot();
    unknown
        .load_snapshot_v5(playing.save_snapshot_v5())
        .unwrap();
    unknown.flush_commands();
    assert_eq!(
        last(&unknown).map(|result| (result.colourway, result.reason)),
        Some((u32::MAX, Some(PlacementRefusal::UnknownColourway)))
    );
    assert_eq!(colourway_of(&unknown, sofa), Some(3));
}

/// [RC-save]: the colourway section of the world hash is in entity-index
/// order, so worlds recoloured in different orders hash alike, and a Load
/// hashes as the world that wrote it.
#[test]
fn recolouring_in_any_order_hashes_alike() {
    let mut down = Sim::new_from_shipped_lot();
    let mut up = Sim::new_from_shipped_lot();
    let mut objects: Vec<Entity> = ["sofa", "stove", "chair", "armchair"]
        .iter()
        .map(|id| placed(&down, id)[0])
        .collect();
    objects.sort_by_key(|entity| entity.index_u32());
    for (colourway, &object) in objects.iter().enumerate().rev() {
        recolour(&mut down, object, 1 + colourway as u32);
    }
    for (colourway, &object) in objects.iter().enumerate() {
        recolour(&mut up, object, 1 + colourway as u32);
    }
    assert_eq!(down.world_hash(), up.world_hash());
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(down.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), down.world_hash());
}

/// [RC-save]: a staged change naming no colourway hashes the same before a
/// save and after the Load that restores it as `u32::MAX`.
#[test]
fn a_staged_unknown_colourway_hashes_alike_across_a_load() {
    let mut playing = Sim::new_from_shipped_lot();
    let sofa = placed(&playing, "sofa")[0];
    stage(&mut playing, sofa.index_u32(), 99);
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(playing.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), playing.world_hash());
}

/// [RC-save]: a staged change's colourway is in the hash, so staging two
/// different colourways makes different worlds, and an index one past the
/// table, the first that names nothing, hashes alike across a Load.
#[test]
fn a_staged_colourway_is_hashed_by_what_it_names() {
    let mut first = Sim::new_from_shipped_lot();
    let mut second = Sim::new_from_shipped_lot();
    let sofa = placed(&first, "sofa")[0].index_u32();
    stage(&mut first, sofa, 1);
    stage(&mut second, sofa, 2);
    assert_ne!(first.world_hash(), second.world_hash());

    let mut playing = Sim::new_from_shipped_lot();
    let past = terri_data::pack().colourways.len() as u32;
    stage(&mut playing, sofa, past);
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(playing.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), playing.world_hash());
}
