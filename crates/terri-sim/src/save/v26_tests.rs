use super::*;
use crate::{edit::living_entity, need_mood::MAX_UNITS};
use terri_core::{
    save_v17::SavedOrderActor, Agent, CommandQueue, Facing, Funds, Position, SimCommand, Skills,
};

fn set_balance(sim: &mut Sim, id: u32, units: i32) {
    let actor = living_entity(sim.world(), id).unwrap();
    sim.world_mut().entity_mut(actor).insert(NeedMood(units));
}

#[test]
fn the_current_save_restores_named_and_unnamed_actors_exactly() {
    let mut sim = Sim::new_from_shipped_lot();
    let unnamed = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 17.0, y: 13.0 },
            Needs::all_at(50.0),
            Skills::default(),
            NeedMood(3_208),
        ))
        .id();
    set_balance(&mut sim, 2, -MAX_UNITS);
    set_balance(&mut sim, 0, MAX_UNITS);
    set_balance(&mut sim, 1, 0);

    let snapshot = sim.save_snapshot_v26();
    assert_eq!(
        snapshot.need_mood,
        vec![
            SavedNeedMood {
                actor: SavedOrderActor::Sim(0),
                units: MAX_UNITS
            },
            SavedNeedMood {
                actor: SavedOrderActor::Sim(2),
                units: -MAX_UNITS
            },
            SavedNeedMood {
                actor: SavedOrderActor::Entity(unnamed.index_u32()),
                units: 3_208
            },
        ]
    );
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v26(snapshot.clone()).unwrap();
    assert_eq!(restored.world_hash(), sim.world_hash());
    assert_eq!(restored.save_snapshot_v26(), snapshot);
}

#[test]
fn build_rollback_and_ordinary_purchases_preserve_the_balance() {
    let mut sim = Sim::new_from_shipped_lot();
    set_balance(&mut sim, 0, -243);
    set_balance(&mut sim, 2, 179);
    sim.world_mut().resource_mut::<Funds>().0 = 1_000_000;
    let baseline = sim.save_snapshot_v26();
    sim.begin_build().unwrap();
    assert_eq!(sim.save_snapshot_v26(), baseline);
    sim.cancel_build().unwrap();
    sim.end_build().unwrap();
    assert_eq!(sim.save_snapshot_v26(), baseline);

    let funds = sim.world().resource::<Funds>().0;
    let lamp = terri_data::pack().find("floor_lamp").unwrap();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::BuyObject {
            definition: lamp.0,
            x: 17,
            y: 13,
            facing: Facing::SouthEast,
        });
    sim.flush_commands();
    assert!(sim.world().resource::<Funds>().0 < funds);
    assert_eq!(sim.save_snapshot_v26().need_mood, baseline.need_mood);
}

#[test]
fn confirming_a_build_edit_keeps_the_live_need_balance() {
    let mut sim = Sim::new_from_shipped_lot();
    set_balance(&mut sim, 0, 4_521);
    sim.world_mut().resource_mut::<Funds>().0 = 1_000_000;
    let baseline = sim.save_snapshot_v26();
    sim.begin_build().unwrap();
    let lamp = terri_data::pack().find("floor_lamp").unwrap();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::BuyObject {
            definition: lamp.0,
            x: 17,
            y: 13,
            facing: Facing::SouthEast,
        });
    sim.flush_commands();
    let review = sim.prepare_build_commit(Default::default()).unwrap();
    assert_eq!(sim.save_snapshot_v26(), baseline);
    sim.commit_build(review.token).unwrap();
    let saved = sim.save_snapshot_v26();
    assert_ne!(saved.legacy, baseline.legacy);
    assert_eq!(saved.need_mood, baseline.need_mood);
}
