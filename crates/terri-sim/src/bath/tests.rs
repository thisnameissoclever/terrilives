use super::*;
use crate::Sim;
use terri_core::{Position, Reserved};

fn occupied_bath() -> (Sim, Entity, Entity) {
    let mut sim = Sim::new_with_lot(12, 12);
    let definition = sim.world().resource::<Content>().0.find("bathtub").unwrap();
    let tub = sim.spawn_object(Position { x: 4., y: 4. }, definition);
    let actor = sim.spawn_agent(Position { x: 3., y: 4. }, 50.);
    let interaction = sim
        .world()
        .resource::<Content>()
        .0
        .object(definition)
        .interactions
        .iter()
        .position(|action| action.activity == Some(terri_data::CompiledActivity::Bathing))
        .unwrap() as u32;
    sim.world_mut().entity_mut(tub).insert(Reserved);
    sim.world_mut().entity_mut(actor).insert((
        Target {
            object: tub,
            interaction,
        },
        Eating {
            object: definition,
            interaction,
            remaining_ticks: 45,
        },
    ));
    (sim, actor, tub)
}

#[test]
fn one_toy_selection_survives_maintenance_and_elapsed_time() {
    let (mut sim, actor, _) = occupied_bath();
    let mut expected = sim.world().resource::<SimRng>().clone();
    let toy = expected.range(3) as u8 + 1;
    begin(sim.world_mut());
    assert_eq!(current(sim.world(), actor).unwrap().toy, toy);
    assert_eq!(sim.world().resource::<SimRng>(), &expected);
    for _ in 0..4 {
        begin(sim.world_mut());
        maintain(sim.world_mut());
    }
    assert_eq!(sim.world().resource::<SimRng>(), &expected);
    sim.world_mut()
        .get_mut::<Eating>(actor)
        .unwrap()
        .remaining_ticks -= 7;
    maintain(sim.world_mut());
    let episode = current(sim.world(), actor).unwrap();
    assert_eq!((episode.toy, episode.elapsed, episode.total), (toy, 7, 45));
    assert_eq!(sim.world().resource::<SimRng>(), &expected);
}

#[test]
fn paused_cancellation_and_replacement_retire_the_old_toy() {
    let (mut sim, actor, tub) = occupied_bath();
    begin(sim.world_mut());
    let random = sim.world().resource::<SimRng>().clone();
    let interaction = sim.world().get::<Target>(actor).unwrap().interaction;
    sim.world_mut().entity_mut(actor).remove::<Eating>();
    sim.flush_commands();
    assert!(sim.world().get::<BathEpisode>(actor).is_none());
    assert_eq!(sim.world().resource::<SimRng>(), &random);
    assert!(capture(sim.world()).is_empty());
    let definition = sim.world().get::<SmartObject>(tub).unwrap().0;
    sim.world_mut().entity_mut(tub).insert(Reserved);
    sim.world_mut().entity_mut(actor).insert((
        Target {
            object: tub,
            interaction,
        },
        Eating {
            object: definition,
            interaction,
            remaining_ticks: 30,
        },
    ));
    let mut expected = random;
    let toy = expected.range(3) as u8 + 1;
    begin(sim.world_mut());
    assert_eq!(current(sim.world(), actor).unwrap().toy, toy);
    assert_eq!(sim.world().resource::<SimRng>(), &expected);
}

#[test]
fn current_rows_require_complete_exact_bath_ownership() {
    let (mut sim, actor, _) = occupied_bath();
    begin(sim.world_mut());
    let valid = capture(sim.world());
    let mut cases = vec![Vec::new(), vec![valid[0].clone(), valid[0].clone()]];
    for mutate in [
        (|row: &mut SavedBathEpisode| row.toy = 0) as fn(&mut SavedBathEpisode),
        |row| row.toy = 4,
        |row| row.tub = row.actor,
        |row| row.interaction = u32::MAX,
        |row| row.elapsed = 1,
        |row| {
            row.elapsed = u32::MAX;
            row.total = 44;
        },
        |row| row.actor = u32::MAX,
    ] {
        let mut rows = valid.clone();
        mutate(&mut rows[0]);
        cases.push(rows);
    }
    for rows in cases {
        let (mut candidate, _, _) = occupied_bath();
        assert!(restore(candidate.world_mut(), rows).is_err());
    }
    sim.world_mut().entity_mut(actor).remove::<BathEpisode>();
    let random = sim.world().resource::<SimRng>().clone();
    restore(sim.world_mut(), valid.clone()).unwrap();
    assert_eq!(capture(sim.world()), valid);
    assert_eq!(sim.world().resource::<SimRng>(), &random);
}

#[test]
fn ordinary_bath_keeps_toy_clock_and_random_stream_through_load_and_build() {
    use terri_core::{CommandQueue, IntentQueue, SimCommand, TileGrid};
    let mut sim = Sim::new_with_lot(12, 12);
    let pack = sim.world().resource::<Content>().0;
    let definition = pack.find("bathtub").unwrap();
    let footprint = pack
        .object(definition)
        .footprint_at(pack.object(definition).base_facing);
    let tub = sim.spawn_object(Position { x: 4., y: 4. }, definition);
    for y in 4..4 + footprint.depth as usize {
        for x in 4..4 + footprint.width as usize {
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(x, y, true);
        }
    }
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::PlaceObject {
            object: tub.index_u32(),
            x: 4,
            y: 4,
            facing: terri_core::Facing::SouthWest,
        });
    sim.flush_commands();
    let actor = sim.spawn_agent(Position { x: 3., y: 4. }, 70.);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: tub.index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
    for _ in 0..120 {
        sim.tick();
        if current(sim.world(), actor).is_some() {
            break;
        }
    }
    assert!(
        current(sim.world(), actor).is_some(),
        "ordinary arrival must initialize bathing"
    );
    assert!(
        sim.world()
            .get::<IntentQueue>(actor)
            .is_some_and(|queue| !queue.is_empty()),
        "arrival must still own the player's bath order; events={:?}",
        sim.action_events_since(0)
            .events
            .iter()
            .map(|event| (&event.phase, &event.reason))
            .collect::<Vec<_>>()
    );
    for _ in 0..6 {
        sim.tick();
    }
    sim.sync_render_buffer();
    let saved = sim.save_snapshot_v26();
    let hash = sim.world_hash();
    let random = sim.world().resource::<SimRng>().clone();
    assert_eq!(saved.baths.len(), 1);
    sim.load_snapshot_v26(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v26(), saved);
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.world().resource::<SimRng>(), &random);
    assert_eq!(
        sim.render_buffer().bath_toys,
        sim.render_buffer().prev_bath_toys
    );
    assert_eq!(
        sim.render_buffer().bath_elapsed,
        sim.render_buffer().prev_bath_elapsed
    );
    sim.begin_build().unwrap();
    assert_eq!(sim.save_snapshot_v26(), saved);
    sim.cancel_build().unwrap();
    assert_eq!(sim.save_snapshot_v26(), saved);
    assert_eq!(sim.world().resource::<SimRng>(), &random);
    sim.end_build().unwrap();
    assert!(!sim.build_active());
    assert_eq!(sim.save_snapshot_v26(), saved);
    let actor = crate::dining::entity(sim.world(), actor.index_u32()).unwrap();
    let target = *sim.world().get::<Target>(actor).unwrap();
    assert!(sim
        .world()
        .get::<IntentQueue>(actor)
        .unwrap()
        .contains(terri_core::Intent {
            object: target.object,
            interaction: target.interaction,
            cleanup: None,
            chore: None
        }));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: actor.index_u32(),
        });
    sim.flush_commands();
    assert!(sim.take_build_error().is_none());
    assert!(sim.world().get::<Eating>(actor).is_none());
    assert!(sim.world().get::<Target>(actor).is_none());
    sim.sync_render_buffer_after_commands();
    assert!(current(sim.world(), actor).is_none());
    assert!(sim.save_snapshot_v26().baths.is_empty());
    assert!(sim.render_buffer().bath_toys.iter().all(|toy| *toy == 0));
    assert_eq!(sim.world().resource::<SimRng>(), &random);
}

#[test]
fn legacy_active_bath_selects_once_and_current_missing_rows_fail_transactionally() {
    let (mut sim, actor, _) = occupied_bath();
    let old = sim.try_save_snapshot_editable_world_v22().unwrap();
    let mut migrated = Sim::new_with_lot(12, 12);
    migrated.load_snapshot_editable_world_v22(old.clone()).unwrap();
    let adopted = migrated.save_snapshot_v26();
    assert_eq!(adopted.baths.len(), 1);
    assert_eq!(adopted.baths[0].elapsed, 0);
    let random = migrated.world().resource::<SimRng>().clone();
    migrated.load_snapshot_v26(adopted.clone()).unwrap();
    assert_eq!(migrated.world().resource::<SimRng>(), &random);
    let mut malformed = adopted.clone();
    malformed.baths.clear();
    let before = migrated.world_hash();
    assert!(migrated.load_snapshot_v26(malformed).is_err());
    assert_eq!(migrated.world_hash(), before);
    sim.load_snapshot_editable_world_v22(old).unwrap();
    assert_eq!(sim.save_snapshot_v26(), adopted);
    assert!(current(
        sim.world(),
        crate::dining::entity(sim.world(), actor.index_u32()).unwrap()
    )
    .is_some());
}
