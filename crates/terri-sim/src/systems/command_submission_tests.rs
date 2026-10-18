use super::*;
use crate::Sim;
use terri_core::{AtWork, SimId};

fn household(cap: u32) -> (Sim, Vec<Entity>, Entity) {
    let mut sim = Sim::new_from_shipped_lot();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.max_queued_intents = cap;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let mut people: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .map(|(actor, id)| (id.0, actor))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    let people: Vec<_> = people.into_iter().map(|(_, actor)| actor).collect();
    let bed = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| sim.world().resource::<Content>().0.object(object.0).id == "double_bed")
        .unwrap()
        .0;
    (sim, people, bed)
}

fn roundtrip(sim: &Sim) {
    let saved = sim.save_snapshot_v15();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .world_mut()
        .insert_resource(Content(sim.world().resource::<Content>().0));
    loaded
        .load_snapshot_v15(saved.clone())
        .expect("public commands must leave a loadable self-save");
    assert_eq!(loaded.save_snapshot_v15(), saved);
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

fn sleeping_order(cap: u32) -> (Sim, Entity, Entity) {
    let (mut sim, people, bed) = household(cap);
    let actor = people[0];
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: bed.index_u32(),
            interaction: 0,
        });
    sim.tick();
    assert_eq!(
        sim.world().get::<Target>(actor).map(|target| target.object),
        Some(bed)
    );
    assert!(sim.world().get::<Reserved>(bed).is_some());
    assert_eq!(sim.world().get::<IntentQueue>(actor).unwrap().len(), 1);
    (sim, actor, bed)
}

fn assert_failed(sim: &Sim, actor: Entity, id: u64, reason: &str) {
    let events = sim
        .action_events_since(0)
        .events
        .into_iter()
        .filter(|event| event.actor == actor.index_u32() && event.order_id == id)
        .collect::<Vec<_>>();
    assert_eq!(
        events
            .iter()
            .map(|event| event.phase.as_str())
            .collect::<Vec<_>>(),
        ["accepted", "failed"]
    );
    assert_eq!(events[1].reason.as_deref(), Some(reason));
}

#[test]
fn invalid_submission_append_behind_running_order_fails_exactly_and_self_save_loads() {
    let (mut sim, actor, bed) = sleeping_order(0);
    let before = sim.world().get::<IntentQueue>(actor).unwrap().clone();
    let target = sim.world().get::<Target>(actor).copied();
    let path = sim
        .world()
        .get::<Path>(actor)
        .map(|path| (path.steps.clone(), path.cursor));
    let eating = sim.world().get::<Eating>(actor).copied();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: actor.index_u32(),
            object: bed.index_u32(),
            interaction: u32::MAX,
        });
    sim.flush_commands();
    assert_eq!(
        sim.world().get::<IntentQueue>(actor).unwrap().entries(),
        before.entries()
    );
    assert_eq!(
        sim.world().get::<IntentQueue>(actor).unwrap().next_id(),
        before.next_id() + 1
    );
    assert_eq!(sim.world().get::<Target>(actor).copied(), target);
    assert_eq!(
        sim.world()
            .get::<Path>(actor)
            .map(|path| (path.steps.clone(), path.cursor)),
        path
    );
    assert_eq!(sim.world().get::<Eating>(actor).copied(), eating);
    assert!(sim.world().get::<Reserved>(bed).is_some());
    assert_failed(&sim, actor, before.next_id(), "Unknown object action");
    roundtrip(&sim);
}

#[test]
fn invalid_submission_front_at_full_capacity_preserves_running_owner_and_queue() {
    let (mut sim, actor, bed) = sleeping_order(1);
    let before = sim.world().get::<IntentQueue>(actor).unwrap().clone();
    let target = sim.world().get::<Target>(actor).copied();
    let path = sim
        .world()
        .get::<Path>(actor)
        .map(|path| (path.steps.clone(), path.cursor));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: bed.index_u32(),
            interaction: u32::MAX,
        });
    sim.flush_commands();
    assert_eq!(
        sim.world().get::<IntentQueue>(actor).unwrap().entries(),
        before.entries()
    );
    assert_eq!(
        sim.world().get::<IntentQueue>(actor).unwrap().next_id(),
        before.next_id() + 1
    );
    assert_eq!(sim.world().get::<Target>(actor).copied(), target);
    assert_eq!(
        sim.world()
            .get::<Path>(actor)
            .map(|path| (path.steps.clone(), path.cursor)),
        path
    );
    assert!(sim.world().get::<Reserved>(bed).is_some());
    assert_eq!(
        sim.world_mut()
            .resource_mut::<CommandFeedback>()
            .take_intent_displacements(),
        0
    );
    assert_failed(&sim, actor, before.next_id(), "Unknown object action");
    roundtrip(&sim);
}

#[test]
fn invalid_submission_front_during_book_return_preserves_journey_and_valid_orders() {
    use terri_core::{command::BookCommand, save_v6::ReadingStage};
    let (mut sim, people, bed) = household(0);
    let actor = people[0];
    for person in &people[1..] {
        sim.world_mut().entity_mut(*person).insert(AtWork {
            remaining_ticks: 10_000,
        });
    }
    let title = sim
        .book_copies()
        .first()
        .expect("shipped household owns books")
        .title_id
        .clone();
    let pack = sim.world().resource::<Content>().0;
    let (object, action) = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find_map(|(object, definition)| {
            pack.object(definition.0)
                .interactions
                .iter()
                .find(|action| action.book_reading)
                .map(|action| (object, action.id.clone()))
        })
        .expect("shipped household has a reading action");
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::Book(BookCommand::Read {
            agent: actor.index_u32(),
            object: object.index_u32(),
            action,
            title,
            front: true,
        }));
    for _ in 0..500 {
        sim.tick();
        if sim
            .world()
            .get::<crate::reading::ReadingJourney>(actor)
            .is_some_and(|journey| journey.stage == ReadingStage::Read)
        {
            break;
        }
    }
    assert_eq!(
        sim.world()
            .get::<crate::reading::ReadingJourney>(actor)
            .map(|journey| journey.stage),
        Some(ReadingStage::Read),
        "public reading must reach physical work: {:?}",
        sim.action_events_since(0).events
    );
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: bed.index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
    let journey = sim
        .world()
        .get::<crate::reading::ReadingJourney>(actor)
        .unwrap()
        .clone();
    assert_eq!(journey.stage, ReadingStage::Return);
    let queue = sim.world().get::<IntentQueue>(actor).unwrap().clone();
    let target = sim.world().get::<Target>(actor).copied();
    let path = sim
        .world()
        .get::<Path>(actor)
        .map(|path| (path.steps.clone(), path.cursor));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: bed.index_u32(),
            interaction: 999,
        });
    sim.flush_commands();
    assert_eq!(
        sim.world().get::<crate::reading::ReadingJourney>(actor),
        Some(&journey)
    );
    assert_eq!(
        sim.world().get::<IntentQueue>(actor).unwrap().entries(),
        queue.entries()
    );
    assert_eq!(sim.world().get::<Target>(actor).copied(), target);
    assert_eq!(
        sim.world()
            .get::<Path>(actor)
            .map(|path| (path.steps.clone(), path.cursor)),
        path
    );
    assert_failed(&sim, actor, queue.next_id(), "Unknown object action");
    roundtrip(&sim);
}

#[test]
fn invalid_submission_social_rows_fail_without_recalling_either_worker() {
    for front in [false, true] {
        let (mut sim, people, _) = household(0);
        let (actor, recipient) = (people[0], people[1]);
        for person in [actor, recipient] {
            sim.world_mut().entity_mut(person).insert(AtWork {
                remaining_ticks: 1000,
            });
        }
        roundtrip(&sim);
        let command = if front {
            SimCommand::TalkToFirst {
                agent: actor.index_u32(),
                target: recipient.index_u32(),
                interaction: u32::MAX,
            }
        } else {
            SimCommand::TalkTo {
                agent: actor.index_u32(),
                target: recipient.index_u32(),
                interaction: u32::MAX,
            }
        };
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
        sim.flush_commands();
        for person in [actor, recipient] {
            assert_eq!(
                sim.world().get::<AtWork>(person),
                Some(&AtWork {
                    remaining_ticks: 1000
                })
            );
        }
        let queue = sim.world().get::<IntentQueue>(actor).unwrap();
        assert!(queue.is_empty());
        assert_eq!(queue.next_id(), 1);
        assert_failed(&sim, actor, 0, "Unknown social action");
        roundtrip(&sim);
    }
}

#[test]
fn invalid_submission_keeps_capacity_and_exhausted_allocator_refusals() {
    let (mut sim, actor, bed) = sleeping_order(1);
    let before = sim.world().get::<IntentQueue>(actor).unwrap().clone();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: actor.index_u32(),
            object: bed.index_u32(),
            interaction: u32::MAX,
        });
    sim.flush_commands();
    assert_eq!(sim.world().get::<IntentQueue>(actor), Some(&before));
    assert_eq!(
        sim.world_mut()
            .resource_mut::<CommandFeedback>()
            .take_intent_capacity_rejections(),
        1
    );
    let events = sim.action_events_since(0).events;
    assert_eq!(events.last().unwrap().phase, "rejected");
    assert_eq!(
        events.last().unwrap().reason.as_deref(),
        Some("The order queue is full.")
    );

    let (mut sim, people, bed) = household(0);
    let actor = people[0];
    sim.world_mut()
        .entity_mut(actor)
        .insert(IntentQueue::from_entries(vec![], u64::MAX).unwrap());
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: bed.index_u32(),
            interaction: u32::MAX,
        });
    sim.flush_commands();
    assert_eq!(
        sim.world().get::<IntentQueue>(actor).unwrap().next_id(),
        u64::MAX
    );
    let events = sim.action_events_since(0).events;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].phase, "rejected");
    assert_eq!(
        events[0].reason.as_deref(),
        Some("No more order IDs are available.")
    );
}
