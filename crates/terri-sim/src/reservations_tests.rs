//! Lifecycle fixtures deliberately share a target. Admission remains exclusive
//! until sleeping places and their visual mapping are implemented.

use crate::{systems, test_content, Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::{
    Agent, Career, CommandQueue, Eating, Intent, IntentQueue, NeedId, Needs, ObjectDefId, Position,
    Reserved, SimCommand, SimId, SimName, SmartObject, Target,
};

fn fixture() -> (Sim, Entity, Entity, Entity, Target) {
    let mut sim = Sim::new_with_lot(16, 12);
    let object = test_content::object("bed", &[(NeedId::Energy, 60.0)], 20);
    let mut pack = test_content::pack_with_social(
        vec![object],
        vec![test_content::interaction(
            "talk",
            &[(NeedId::Social, 10.0)],
            10,
        )],
        test_content::tuning(),
    )
    .clone();
    pack.tuning.death_after_ticks = 1;
    pack.careers = terri_data::pack().careers.clone();
    pack.chains = terri_data::pack().chains.clone();
    pack.chains[0].advertised_by = ObjectDefId(0);
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let object = sim
        .world_mut()
        .spawn((
            SmartObject(ObjectDefId(0)),
            Position { x: 5.0, y: 5.0 },
            Reserved,
        ))
        .id();
    let target = Target {
        object,
        interaction: 0,
    };
    let mut people = Vec::new();
    for index in 0..2 {
        people.push(
            sim.world_mut()
                .spawn((
                    Agent,
                    SimId(index),
                    SimName(format!("Person {index}")),
                    Position {
                        x: 4.0,
                        y: 5.0 + index as f32,
                    },
                    Needs::all_at(80.0),
                    target,
                    Eating {
                        object: ObjectDefId(0),
                        interaction: 0,
                        remaining_ticks: 20,
                    },
                    IntentQueue::from_intents(vec![Intent {
                        object,
                        interaction: 0,
                    }]),
                ))
                .id(),
        );
    }
    (sim, object, people[0], people[1], target)
}

fn assert_remaining_owner(sim: &Sim, object: Entity, second: Entity, target: Target) {
    assert!(
        sim.world().get::<Reserved>(object).is_some(),
        "other owner's marker was cleared"
    );
    assert_eq!(sim.world().get::<Target>(second), Some(&target));
    assert!(
        sim.world().get::<Eating>(second).is_some(),
        "other owner's action was cleared"
    );
}

#[test]
fn completion_preserves_another_occupant_and_last_completion_frees_object() {
    let (mut sim, object, first, second, target) = fixture();
    sim.world_mut()
        .get_mut::<Eating>(first)
        .unwrap()
        .remaining_ticks = 1;
    let mut schedule = Schedule::default();
    schedule.add_systems(systems::interact::tick_interactions);
    schedule.run(sim.world_mut());
    assert!(sim.world().get::<Target>(first).is_none());
    assert_remaining_owner(&sim, object, second, target);
    assert_eq!(
        sim.world().get::<Eating>(second).unwrap().remaining_ticks,
        19
    );
    sim.world_mut()
        .get_mut::<Eating>(second)
        .unwrap()
        .remaining_ticks = 1;
    schedule.run(sim.world_mut());
    assert!(sim.world().get::<Reserved>(object).is_none());
}

#[test]
fn simultaneous_completions_release_the_last_occupant_in_one_system_run() {
    let (mut sim, object, first, second, _) = fixture();
    for person in [first, second] {
        sim.world_mut()
            .get_mut::<Eating>(person)
            .unwrap()
            .remaining_ticks = 1;
    }
    let mut schedule = Schedule::default();
    schedule.add_systems(systems::interact::tick_interactions);
    schedule.run(sim.world_mut());
    assert!(sim.world().get::<Target>(first).is_none());
    assert!(sim.world().get::<Target>(second).is_none());
    assert!(sim.world().get::<Reserved>(object).is_none());
}

#[test]
fn cancelling_one_order_preserves_another_occupant_and_batch_cancel_frees_object() {
    for batched in [false, true] {
        let (mut sim, object, first, second, target) = fixture();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents {
                agent: first.index_u32(),
            });
        if !batched {
            sim.flush_commands();
            assert!(sim.world().get::<Target>(first).is_none());
            assert_remaining_owner(&sim, object, second, target);
        }
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents {
                agent: second.index_u32(),
            });
        sim.flush_commands();
        assert!(sim.world().get::<Target>(first).is_none());
        assert!(sim.world().get::<Target>(second).is_none());
        assert!(sim.world().get::<Reserved>(object).is_none());
    }
}

#[test]
fn retargeting_another_object_preserves_the_other_occupant() {
    let (mut sim, object, first, second, target) = fixture();
    let other = sim
        .world_mut()
        .spawn((SmartObject(ObjectDefId(0)), Position { x: 9.0, y: 5.0 }))
        .id();
    sim.world_mut()
        .entity_mut(first)
        .insert(IntentQueue::from_intents(vec![Intent {
            object: other,
            interaction: 0,
        }]));
    let mut schedule = Schedule::default();
    schedule.add_systems(systems::action::serve_intents);
    schedule.run(sim.world_mut());
    assert_eq!(sim.world().get::<Target>(first).unwrap().object, other);
    assert_remaining_owner(&sim, object, second, target);
}

#[test]
fn retargeting_a_conversation_preserves_the_other_occupant() {
    let (mut sim, object, first, second, target) = fixture();
    let other = sim
        .world_mut()
        .spawn((Agent, Needs::all_at(80.0), Position { x: 9.0, y: 5.0 }))
        .id();
    sim.world_mut()
        .entity_mut(first)
        .insert(IntentQueue::from_intents(vec![Intent {
            object: other,
            interaction: 0,
        }]));
    let mut schedule = Schedule::default();
    schedule.add_systems(systems::action::serve_intents);
    schedule.run(sim.world_mut());
    assert_eq!(sim.world().get::<Target>(first).unwrap().object, other);
    assert_remaining_owner(&sim, object, second, target);
}

#[test]
fn retargeting_a_chain_preserves_the_other_occupant() {
    let (mut sim, object, first, second, target) = fixture();
    sim.world_mut()
        .entity_mut(first)
        .insert(IntentQueue::from_intents(vec![Intent {
            object,
            interaction: 1,
        }]));
    let mut schedule = Schedule::default();
    schedule.add_systems(systems::action::serve_intents);
    schedule.run(sim.world_mut());
    assert!(sim.world().get::<Target>(first).is_none());
    assert!(sim.world().get::<terri_core::ChainState>(first).is_some());
    assert_remaining_owner(&sim, object, second, target);
}

#[test]
fn leaving_for_work_preserves_the_other_occupant() {
    let (mut sim, object, first, second, target) = fixture();
    let start = sim.world().resource::<Content>().0.careers[0].shift_start;
    sim.world_mut().resource_mut::<terri_core::SimClock>().tick = start as u64;
    sim.world_mut().entity_mut(first).insert(Career(0));
    let mut schedule = Schedule::default();
    schedule.add_systems(systems::career::start_shift);
    schedule.run(sim.world_mut());
    assert!(sim.world().get::<Target>(first).is_none());
    assert!(sim.world().get::<terri_core::Commuting>(first).is_some());
    assert_remaining_owner(&sim, object, second, target);
}

#[test]
fn invalid_owner_cleanup_preserves_another_occupant_then_frees_the_last() {
    let (mut sim, object, first, second, target) = fixture();
    sim.world_mut().entity_mut(first).remove::<Needs>();
    crate::mortality::cleanup(sim.world_mut());
    assert!(sim.world().get::<Target>(first).is_none());
    assert_remaining_owner(&sim, object, second, target);
    sim.world_mut().entity_mut(second).remove::<Needs>();
    crate::mortality::cleanup(sim.world_mut());
    assert!(sim.world().get::<Reserved>(object).is_none());
}

#[test]
fn death_preserves_the_other_occupant() {
    let (mut sim, object, first, second, target) = fixture();
    sim.world_mut().entity_mut(first).insert(Needs::all_at(0.0));
    crate::mortality::tick(sim.world_mut());
    assert!(
        sim.world().get_entity(first).is_err(),
        "fixture must actually kill the first owner"
    );
    assert_remaining_owner(&sim, object, second, target);
}

#[test]
fn cancelling_a_chain_station_preserves_another_target_owner() {
    let (mut sim, object, first, second, target) = fixture();
    sim.world_mut()
        .entity_mut(first)
        .remove::<Eating>()
        .insert((
            Target {
                interaction: systems::chain::CHAIN_STEP,
                ..target
            },
            terri_core::ChainState::begin(0),
            terri_core::StepWork { remaining_ticks: 7 },
            IntentQueue::default(),
        ));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: first.index_u32(),
        });
    sim.flush_commands();
    assert!(sim.world().get::<Target>(first).is_none());
    assert!(sim.world().get::<terri_core::ChainState>(first).is_none());
    assert_remaining_owner(&sim, object, second, target);
}

#[test]
fn completing_a_chain_station_preserves_another_target_owner() {
    let (mut sim, object, first, second, target) = fixture();
    sim.world_mut()
        .entity_mut(first)
        .remove::<Eating>()
        .insert((
            Target {
                interaction: systems::chain::CHAIN_STEP,
                ..target
            },
            terri_core::ChainState::begin(0),
            terri_core::StepWork { remaining_ticks: 1 },
        ));
    let mut schedule = Schedule::default();
    schedule.add_systems(systems::chain::tick_chain_steps);
    schedule.run(sim.world_mut());
    assert!(sim.world().get::<Target>(first).is_none());
    assert_eq!(
        sim.world()
            .get::<terri_core::ChainState>(first)
            .unwrap()
            .step,
        1
    );
    assert_remaining_owner(&sim, object, second, target);
}

#[test]
fn invalid_object_cleanup_releases_all_owners_and_the_marker() {
    let (mut sim, object, first, second, _) = fixture();
    sim.world_mut().entity_mut(object).remove::<SmartObject>();
    crate::mortality::cleanup(sim.world_mut());
    assert!(sim.world().get::<Target>(first).is_none());
    assert!(sim.world().get::<Target>(second).is_none());
    assert!(sim.world().get::<Reserved>(object).is_none());
}

#[test]
fn displacing_a_capped_order_preserves_the_other_occupant() {
    let (mut sim, object, first, second, target) = fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.max_queued_intents = 1;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let other = sim
        .world_mut()
        .spawn((SmartObject(ObjectDefId(0)), Position { x: 9.0, y: 5.0 }))
        .id();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: first.index_u32(),
            object: other.index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
    assert!(sim.world().get::<Target>(first).is_none());
    assert_eq!(sim.take_intent_displacements(), 1);
    assert_remaining_owner(&sim, object, second, target);
}
