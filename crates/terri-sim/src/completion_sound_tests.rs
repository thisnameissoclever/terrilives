use crate::Sim;
use terri_core::{Agent, Eating, Needs, Position, Target};

fn fixture(ticks: u32) -> (Sim, bevy_ecs::entity::Entity, bevy_ecs::entity::Entity) {
    let pack = terri_data::pack();
    let toilet = pack.find("toilet").unwrap();
    let interaction = pack
        .object(toilet)
        .interactions
        .iter()
        .position(|a| a.id == "relieve_self")
        .unwrap() as u32;
    let mut sim = Sim::new_with_lot(24, 24);
    let object = sim.spawn_object(Position { x: 4.0, y: 4.0 }, toilet);
    let actor = sim
        .world_mut()
        .spawn((
            Agent,
            Needs::all_at(100.0),
            Position { x: 3.0, y: 4.0 },
            Eating {
                object: toilet,
                interaction,
                remaining_ticks: ticks,
            },
            Target {
                object,
                interaction,
            },
        ))
        .id();
    (sim, actor, object)
}

#[test]
fn completion_sound_occurs_on_positive_final_tick_only() {
    let (mut sim, actor, object) = fixture(2);
    assert!(sim.completion_sounds().is_empty());
    sim.tick();
    assert!(sim.completion_sounds().is_empty());
    sim.tick();
    assert_eq!(sim.completion_sounds(), &[1, object.index_u32()]);
    assert!(sim.world().get::<Eating>(actor).is_none());
    sim.tick();
    assert!(sim.completion_sounds().is_empty());
    sim.clear_completion_sounds();
    assert!(sim.completion_sounds().is_empty());
    let (mut zero, _, _) = fixture(0);
    zero.tick();
    assert!(zero.completion_sounds().is_empty());
}

fn finish(sim: &mut Sim) {
    let mut schedule = bevy_ecs::schedule::Schedule::default();
    schedule.add_systems(crate::systems::interact::tick_interactions);
    schedule.run(sim.world_mut());
}

#[test]
fn completion_sound_requires_each_exact_target_and_actor_identity() {
    for fault in [
        "mismatch",
        "sentinel",
        "definition",
        "smart-object",
        "position",
        "missing",
        "non-agent",
        "actor-position",
        "chain",
        "step",
        "work",
        "social",
        "partner",
    ] {
        let (mut sim, actor, object) = fixture(1);
        let mut pack = terri_data::pack().clone();
        let toilet = pack.find("toilet").unwrap();
        let sink = pack.find("sink").unwrap();
        let second = pack.object(toilet).interactions[0].clone();
        pack.objects[toilet.0 as usize].interactions.push(second);
        pack.objects[sink.0 as usize].interactions[0].completion_sound =
            Some(terri_data::pack::CompiledCompletionSound::ToiletFlush);
        sim.world_mut()
            .insert_resource(crate::Content(Box::leak(Box::new(pack))));
        match fault {
            "mismatch" => {
                sim.world_mut()
                    .get_mut::<Target>(actor)
                    .unwrap()
                    .interaction = 1;
            }
            "sentinel" => {
                sim.world_mut()
                    .get_mut::<Target>(actor)
                    .unwrap()
                    .interaction = crate::systems::chain::CHAIN_STEP;
            }
            "definition" => {
                let other = terri_data::pack().find("sink").unwrap();
                sim.world_mut()
                    .entity_mut(object)
                    .insert(terri_core::SmartObject(other));
            }
            "smart-object" => {
                sim.world_mut()
                    .entity_mut(object)
                    .remove::<terri_core::SmartObject>();
            }
            "position" => {
                sim.world_mut().entity_mut(object).remove::<Position>();
            }
            "missing" => {
                sim.world_mut().despawn(object);
            }
            "non-agent" => {
                sim.world_mut().entity_mut(actor).remove::<Agent>();
            }
            "actor-position" => {
                sim.world_mut().entity_mut(actor).remove::<Position>();
            }
            "chain" => {
                sim.world_mut()
                    .entity_mut(actor)
                    .insert(terri_core::ChainState::begin(0));
            }
            "step" => {
                sim.world_mut()
                    .entity_mut(actor)
                    .insert(terri_core::StepWork {
                        remaining_ticks: 10,
                    });
            }
            "work" => {
                sim.world_mut()
                    .entity_mut(actor)
                    .insert(terri_core::AtWork {
                        remaining_ticks: 10,
                    });
            }
            "social" | "partner" => {
                let talk = terri_core::Socialising {
                    partner: if fault == "social" { object } else { actor },
                    interaction: 0,
                    remaining_ticks: 10,
                };
                if fault == "social" {
                    sim.world_mut().entity_mut(actor).insert(talk);
                } else {
                    sim.world_mut().spawn(talk);
                }
            }
            _ => unreachable!(),
        }
        finish(&mut sim);
        assert!(sim.completion_sounds().is_empty(), "{fault} must be silent");
        assert!(
            sim.world().get::<Eating>(actor).is_none(),
            "{fault} must not prevent gameplay completion"
        );
    }
}

#[test]
fn completion_sound_deduplicates_sources_caps_tick_and_retains_storage() {
    let (mut sim, actor, object) = fixture(1);
    let eating = *sim.world().get::<Eating>(actor).unwrap();
    let target = *sim.world().get::<Target>(actor).unwrap();
    sim.world_mut().spawn((
        Agent,
        Position { x: 3.0, y: 4.0 },
        Needs::all_at(100.0),
        eating,
        target,
    ));
    finish(&mut sim);
    assert_eq!(sim.completion_sounds(), &[1, object.index_u32()]);
    sim.clear_completion_sounds();
    let pointer = sim.completion_sounds().as_ptr();
    for _ in 0..70 {
        let source = sim.spawn_object(Position { x: 8.0, y: 8.0 }, eating.object);
        sim.world_mut().spawn((
            Agent,
            Position { x: 7.0, y: 8.0 },
            Needs::all_at(100.0),
            eating,
            Target {
                object: source,
                interaction: target.interaction,
            },
        ));
    }
    finish(&mut sim);
    assert_eq!(sim.completion_sounds().len(), 128);
    assert_eq!(sim.completion_sounds().as_ptr(), pointer);
    sim.flush_commands();
    assert!(sim.completion_sounds().is_empty());
    assert_eq!(sim.completion_sounds().as_ptr(), pointer);
}

#[test]
fn completion_sound_is_unsaved_unhashed_and_world_replacement_drops_it() {
    let (mut sim, _, _) = fixture(1);
    sim.tick();
    assert_eq!(sim.completion_sounds().len(), 2);
    let hash = sim.world_hash();
    let save = sim.save_snapshot_v5();
    sim.clear_completion_sounds();
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.save_snapshot_v5(), save);
    sim.load_snapshot_v5(save).unwrap();
    assert!(sim.completion_sounds().is_empty());
    sim.tick();
    assert!(sim.completion_sounds().is_empty());
}

#[test]
fn world_replacement_discards_an_undrained_completion() {
    let (mut sim, actor, _) = fixture(1);
    // Current saves already have instinct; avoid exercising legacy migration here.
    sim.world_mut()
        .entity_mut(actor)
        .insert(terri_core::SelfPreservation(50));
    sim.tick();
    assert_eq!(sim.completion_sounds().len(), 2);
    let save = sim.save_snapshot_v5();
    let hash = sim.world_hash();
    sim.load_snapshot_v5(save.clone()).unwrap();
    assert!(sim.completion_sounds().is_empty());
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.save_snapshot_v5(), save);
    sim.tick();
    assert!(sim.completion_sounds().is_empty());
}

#[test]
fn completion_sound_repeats_real_uses_but_not_cancellation_or_unrelated_objects() {
    let (mut sim, actor, object) = fixture(1);
    let eating = *sim.world().get::<Eating>(actor).unwrap();
    let target = *sim.world().get::<Target>(actor).unwrap();
    let second = sim.spawn_object(Position { x: 8.0, y: 8.0 }, eating.object);
    sim.world_mut().spawn((
        Agent,
        Position { x: 7.0, y: 8.0 },
        Needs::all_at(100.0),
        eating,
        Target {
            object: second,
            interaction: target.interaction,
        },
    ));
    finish(&mut sim);
    let pairs: Vec<_> = sim
        .completion_sounds()
        .chunks_exact(2)
        .map(|p| (p[0], p[1]))
        .collect();
    assert_eq!(pairs.len(), 2);
    assert!(pairs.contains(&(1, object.index_u32())));
    assert!(pairs.contains(&(1, second.index_u32())));
    sim.clear_completion_sounds();
    sim.world_mut().entity_mut(actor).insert((eating, target));
    finish(&mut sim);
    assert_eq!(sim.completion_sounds(), &[1, object.index_u32()]);
    sim.clear_completion_sounds();
    sim.world_mut().entity_mut(actor).insert((eating, target));
    sim.world_mut().entity_mut(actor).remove::<Eating>();
    finish(&mut sim);
    assert!(sim.completion_sounds().is_empty());
    sim.world_mut().entity_mut(actor).insert(eating);
    sim.world_mut().entity_mut(actor).remove::<Target>();
    finish(&mut sim);
    assert!(sim.completion_sounds().is_empty());
    let sink = terri_data::pack().find("sink").unwrap();
    let other = sim.spawn_object(Position { x: 12.0, y: 12.0 }, sink);
    sim.world_mut().entity_mut(actor).insert((
        Eating {
            object: sink,
            interaction: 0,
            remaining_ticks: 1,
        },
        Target {
            object: other,
            interaction: 0,
        },
    ));
    finish(&mut sim);
    assert!(sim.completion_sounds().is_empty());
}

#[test]
fn completion_sound_metadata_and_drain_preserve_save_hash_and_rng_continuation() {
    let (mut audible, _, _) = fixture(2);
    let (mut silent, _, _) = fixture(2);
    let mut pack = terri_data::pack().clone();
    let toilet = pack.find("toilet").unwrap();
    pack.objects[toilet.0 as usize].interactions[0].completion_sound = None;
    silent
        .world_mut()
        .insert_resource(crate::Content(Box::leak(Box::new(pack))));
    let mut emitted = 0;
    for _ in 0..120 {
        audible.tick();
        silent.tick();
        emitted += audible.completion_sounds().len() / 2;
        assert!(silent.completion_sounds().is_empty());
        assert_eq!(audible.world_hash(), silent.world_hash());
        assert_eq!(audible.save_snapshot_v5(), silent.save_snapshot_v5());
        audible.clear_completion_sounds();
    }
    assert!(
        emitted > 0,
        "comparison must include actual completion events"
    );
}
