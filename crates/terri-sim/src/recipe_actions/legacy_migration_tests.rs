use super::*;
use crate::{Content, Sim};
use terri_core::{CommandQueue, Position, SimCommand};

fn active_recipe() -> Sim {
    let mut sim = Sim::new_with_lot(12, 8);
    let actor = sim.spawn_agent(Position { x: 1., y: 1. }, 10.);
    let pack = sim.world().resource::<Content>().0;
    let fridge = sim.spawn_object(Position { x: 5., y: 1. }, pack.find("fridge").unwrap());
    sim.spawn_object(Position { x: 8., y: 1. }, pack.find("counter").unwrap());
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: fridge.index_u32(),
            interaction: 0,
        });
    sim.tick();
    assert!(sim.world().get::<ChainState>(actor).is_some());
    sim
}

#[test]
fn direct_legacy_recipe_loads_gain_origins_before_current_resave() {
    for version in 1..=5 {
        let source = active_recipe();
        let mut loaded = Sim::new_with_lot(12, 8);
        match version {
            1 => loaded.load_snapshot(source.save_snapshot()),
            2 => loaded.load_snapshot_v2(source.save_snapshot_v2()),
            3 => loaded.load_snapshot_v3(source.save_snapshot_v3()),
            4 => loaded.load_snapshot_v4(source.save_snapshot_v4()),
            5 => loaded.load_snapshot_v5(source.save_snapshot_v5()),
            _ => unreachable!(),
        }
        .unwrap_or_else(|error| panic!("legacy version {version}: {error:?}"));
        let origins = loaded.save_snapshot_v6().chain_origins;
        assert_eq!(origins.len(), 1, "legacy version {version}");
        assert!(
            matches!(&origins[0].origin, ChainOrigin::Action { model, action, .. }
            if model == "fridge" && action == "grab_snack")
        );
        let mut replay = Sim::new_with_lot(12, 8);
        replay
            .load_snapshot_v15(loaded.save_snapshot_v15())
            .unwrap();
        assert_eq!(replay.world_hash(), loaded.world_hash());
        for _ in 0..12 {
            loaded.tick();
            replay.tick();
            assert_eq!(replay.world_hash(), loaded.world_hash());
        }
    }
}

#[test]
fn current_recipe_save_without_its_origin_is_still_rejected_transactionally() {
    let source = active_recipe();
    let mut saved = source.save_snapshot_v15();
    let origins = &mut saved
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .chain_origins;
    assert_eq!(origins.len(), 1);
    origins.clear();
    let mut live = Sim::new_with_lot(12, 8);
    let before = live.world_hash();
    assert!(live.load_snapshot_v15(saved).is_err());
    assert_eq!(live.world_hash(), before);
}

#[test]
fn mixed_legacy_recipe_and_projection_actor_keep_their_distinct_contracts() {
    let mut source = active_recipe();
    let skeleton = source
        .world_mut()
        .spawn((
            terri_core::Agent,
            Position { x: 1., y: 3. },
            ChainState::begin(0),
            terri_core::SelfPreservation(50),
        ))
        .id();
    let before = source.save_snapshot_v5();
    let mut loaded = Sim::new_with_lot(12, 8);
    loaded.load_snapshot_v5(before.clone()).unwrap();
    assert_eq!(loaded.save_snapshot_v5(), before);
    assert!(loaded.world().get::<terri_core::Needs>(skeleton).is_none());
    assert!(
        loaded.world().get::<Origin>(skeleton).is_none(),
        "a projection-only legacy actor must not gain causal recipe metadata"
    );
    let origins = loaded.save_snapshot_v6().chain_origins;
    assert_eq!(
        origins.len(),
        1,
        "the executable recipe still gains its origin"
    );
    assert_ne!(origins[0].person, skeleton.index_u32());
}
