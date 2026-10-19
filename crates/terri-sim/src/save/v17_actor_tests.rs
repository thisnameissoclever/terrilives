use crate::{player_actions::ServedOrder, test_content, Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::{
    save_v17::SavedOrderActor, Agent, CommandQueue, IntentQueue, NeedId, Needs, Position,
    SimCommand, SimId, SimIdAllocator, Skills, SmartObject, StepWork,
};

fn bare(sim: &mut Sim, x: f32) -> Entity {
    sim.world_mut()
        .spawn((
            Agent,
            Position { x, y: 1.0 },
            Needs::all_at(90.0),
            Skills::default(),
        ))
        .id()
}

fn empty_fixture(content: &terri_data::ContentPack) -> Sim {
    let mut content = content.clone();
    content.reading = terri_data::pack().reading;
    assert!(content.books.is_empty());
    let content = Box::leak(Box::new(content));
    let sim = test_content::sim_with(12, 8, content);
    let saved = sim.current_v17_view();
    let mut loaded = test_content::sim_with(12, 8, content);
    loaded
        .load_current_v17_view(saved.clone())
        .expect("the empty custom fixture must satisfy the current save contract");
    assert_eq!(loaded.current_v17_view(), saved);
    assert_eq!(loaded.world_hash(), sim.world_hash());
    sim
}

fn ordinary_fixture() -> (Sim, Entity, Entity) {
    let pack = test_content::pack(vec![test_content::object(
        "workstation",
        &[(NeedId::Fun, 20.0)],
        40,
    )]);
    let mut sim = empty_fixture(pack);
    let actor = bare(&mut sim, 1.0);
    let object = sim
        .world_mut()
        .spawn((
            Position { x: 7.0, y: 1.0 },
            SmartObject(pack.find("workstation").unwrap()),
        ))
        .id();
    (sim, actor, object)
}

fn enqueue(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
}

fn checkpoint(sim: &Sim) -> Sim {
    let saved = sim.current_v17_view();
    let mut loaded = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    loaded.load_current_v17_view(saved.clone()).unwrap();
    assert_eq!(loaded.current_v17_view(), saved);
    assert_eq!(loaded.world_hash(), sim.world_hash());
    loaded
}

fn completed(sim: &Sim, actor: Entity) -> Vec<u64> {
    sim.action_events_since(0)
        .events
        .into_iter()
        .filter(|event| event.actor == actor.index_u32() && event.phase == "completed")
        .map(|event| event.order_id)
        .collect()
}

#[test]
fn bare_actor_queued_and_served_orders_round_trip_with_exact_completion() {
    let (mut sim, actor, object) = ordinary_fixture();
    for _ in 0..2 {
        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: actor.index_u32(),
                object: object.index_u32(),
                interaction: 0,
            },
        );
    }
    sim.flush_commands();
    let queued = sim.current_v17_view();
    assert_eq!(queued.player_orders.orders.len(), 2);
    assert!(queued
        .player_orders
        .orders
        .iter()
        .all(|row| { row.actor == SavedOrderActor::Entity(actor.index_u32()) }));
    let mut loaded = checkpoint(&sim);
    for _ in 0..100 {
        sim.tick();
        loaded.tick();
        assert_eq!(loaded.world_hash(), sim.world_hash());
        if sim.world().get::<ServedOrder>(actor).is_some() {
            break;
        }
    }
    assert_eq!(
        sim.world().get::<ServedOrder>(actor).map(|owner| owner.0),
        Some(0)
    );
    assert!(sim
        .current_v17_view()
        .player_orders
        .orders
        .iter()
        .any(|row| { row.order_id == 0 && row.served }));
    let mut loaded = checkpoint(&sim);
    for _ in 0..400 {
        sim.tick();
        loaded.tick();
        assert_eq!(loaded.world_hash(), sim.world_hash());
        if sim.world().get::<IntentQueue>(actor).unwrap().is_empty() {
            break;
        }
    }
    assert_eq!(completed(&sim, actor), vec![0, 1]);
    assert_eq!(completed(&loaded, actor), vec![0, 1]);
    assert!(loaded.world().get::<SimId>(actor).is_none());
}

#[test]
fn bare_actor_recipe_keeps_its_exact_owner_through_current_save() {
    let base = test_content::pack(vec![test_content::object("workstation", &[], 30)]);
    let mut pack = base.clone();
    pack.roles = vec!["work_surface".into()];
    pack.chains = vec![terri_data::CompiledChain {
        id: "bare_recipe".into(),
        label: "Make a thing".into(),
        advertised_by: pack.find("workstation").unwrap(),
        advertises: vec![(NeedId::Fun.index() as u8, 20.0)],
        satisfaction: 0.0,
        steps: vec![terri_data::CompiledChainStep {
            role: 0,
            label: "Work".into(),
            duration_ticks: 30,
            tags: Vec::new(),
            yields: None,
            transforms: None,
            consumes: None,
            visual: None,
            sound_action: None,
            activity: None,
        }],
    }];
    let row = test_content::bind_recipe(&mut pack, 0, 0, 0);
    let mut sim = empty_fixture(&pack);
    let actor = bare(&mut sim, 1.0);
    let object = sim
        .world_mut()
        .spawn((
            Position { x: 7.0, y: 1.0 },
            SmartObject(pack.find("workstation").unwrap()),
        ))
        .id();
    enqueue(
        &mut sim,
        SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: row,
        },
    );
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<StepWork>(actor).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<StepWork>(actor).is_some());
    assert_eq!(
        sim.world()
            .get::<crate::recipe_actions::RecipeOrder>(actor)
            .map(|owner| owner.0),
        Some(0)
    );
    let mut loaded = checkpoint(&sim);
    assert_eq!(
        loaded
            .world()
            .get::<crate::recipe_actions::RecipeOrder>(actor)
            .map(|owner| owner.0),
        Some(0)
    );
    for _ in 0..200 {
        sim.tick();
        loaded.tick();
        assert_eq!(loaded.world_hash(), sim.world_hash());
        if sim.world().get::<IntentQueue>(actor).unwrap().is_empty() {
            break;
        }
    }
    assert_eq!(completed(&sim, actor), vec![0]);
    assert_eq!(completed(&loaded, actor), vec![0]);
}

#[test]
fn bare_actor_social_order_keeps_player_provenance_with_named_recipient() {
    let pack = test_content::pack_with_social(
        vec![test_content::object(
            "workstation",
            &[(NeedId::Fun, 20.0)],
            80,
        )],
        vec![test_content::interaction(
            "chat",
            &[(NeedId::Social, 20.0)],
            30,
        )],
        test_content::tuning(),
    );
    let mut sim = empty_fixture(pack);
    // The frozen-reader control requires a complete historical indoor region.
    test_content::enclose(&mut sim);
    let identity = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let recipient = sim
        .world_mut()
        .spawn((
            Agent,
            identity,
            Position { x: 7.0, y: 1.0 },
            Needs::all_at(90.0),
            Skills::default(),
        ))
        .id();
    let object = sim
        .world_mut()
        .spawn((
            Position { x: 7.0, y: 2.0 },
            SmartObject(pack.find("workstation").unwrap()),
        ))
        .id();
    enqueue(
        &mut sim,
        SimCommand::UseObjectFirst {
            agent: recipient.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        },
    );
    for _ in 0..40 {
        sim.tick();
        if sim.world().get::<terri_core::Eating>(recipient).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<terri_core::Eating>(recipient).is_some());
    let actor = bare(&mut sim, 1.0);
    enqueue(
        &mut sim,
        SimCommand::TalkToFirst {
            agent: actor.index_u32(),
            target: recipient.index_u32(),
            interaction: 0,
        },
    );
    sim.flush_commands();
    assert_eq!(
        crate::social_episode::execution_order(sim.world(), actor),
        Some(0)
    );
    let saved = sim.current_v17_view();
    assert!(saved
        .player_orders
        .orders
        .iter()
        .any(|row| row.actor == SavedOrderActor::Entity(actor.index_u32()) && row.order_id == 0));
    assert_eq!(saved.social_executions[0].provenance, 1);
    assert_eq!(saved.social_executions[0].order_id, Some(0));
    assert!(!saved.social_executions[0].admitted);
    let mut historical = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    historical
        .load_snapshot_v14(sim.save_snapshot_v14())
        .expect("the busy approach must satisfy the unchanged frozen prefix");
    let mut loaded = checkpoint(&sim);
    let mut checked_frozen_boundary = false;
    let mut checked_running_boundary = false;
    for _ in 0..250 {
        sim.tick();
        loaded.tick();
        assert_eq!(loaded.world_hash(), sim.world_hash());
        if !checked_frozen_boundary
            && sim
                .current_v17_view()
                .social_executions
                .iter()
                .any(|row| row.initiator == actor.index_u32() && row.admitted)
        {
            let mut historical = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
            assert!(matches!(
                historical.load_snapshot_v14(sim.save_snapshot_v14()),
                Err(crate::SaveError::InvalidEntityReference)
            ));
            checkpoint(&sim);
            checked_frozen_boundary = true;
        }
        if !checked_running_boundary && sim.world().get::<terri_core::Socialising>(actor).is_some()
        {
            checkpoint(&sim);
            checked_running_boundary = true;
        }
        if sim.world().get::<IntentQueue>(actor).unwrap().is_empty() {
            break;
        }
    }
    assert!(checked_frozen_boundary);
    assert!(checked_running_boundary);
    assert_eq!(completed(&sim, actor), vec![0]);
    assert_eq!(completed(&loaded, actor), vec![0]);
    assert!(loaded.world().get::<SimId>(actor).is_none());
    assert_eq!(loaded.world().get::<SimId>(recipient), Some(&identity));
}

#[test]
fn current_actor_tags_are_unambiguous_and_malformed_aliases_are_atomic() {
    let (mut sim, actor, object) = ordinary_fixture();
    let identity = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let named = sim
        .world_mut()
        .spawn((
            Agent,
            identity,
            Position { x: 1.0, y: 3.0 },
            Needs::all_at(90.0),
            Skills::default(),
        ))
        .id();
    assert_eq!(
        actor.index_u32(),
        identity.0,
        "the identity namespaces intentionally overlap"
    );
    for person in [actor, named] {
        enqueue(
            &mut sim,
            SimCommand::UseObject {
                agent: person.index_u32(),
                object: object.index_u32(),
                interaction: 0,
            },
        );
    }
    sim.flush_commands();
    let saved = sim.current_v17_view();
    assert_eq!(saved.player_orders.orders.len(), 2);
    assert!(saved
        .player_orders
        .orders
        .iter()
        .any(|row| row.actor == SavedOrderActor::Sim(identity.0)));
    assert!(saved
        .player_orders
        .orders
        .iter()
        .any(|row| row.actor == SavedOrderActor::Entity(actor.index_u32())));
    let mut loaded = checkpoint(&sim);
    let before = loaded.world_hash();
    for invalid in [
        SavedOrderActor::Sim(identity.0),
        SavedOrderActor::Entity(named.index_u32()),
        SavedOrderActor::Entity(object.index_u32()),
        SavedOrderActor::Entity(u32::MAX),
    ] {
        let mut malformed = saved.clone();
        malformed
            .player_orders
            .orders
            .iter_mut()
            .find(|row| row.actor == SavedOrderActor::Entity(actor.index_u32()))
            .unwrap()
            .actor = invalid;
        assert!(
            loaded.load_current_v17_view(malformed).is_err(),
            "accepted {invalid:?}"
        );
        assert_eq!(loaded.world_hash(), before);
        assert_eq!(loaded.current_v17_view(), saved);
    }
}

#[test]
fn bare_recipients_and_pairs_restore_with_strict_entity_reference_checks() {
    for named_initiator in [false, true] {
        let pack = test_content::pack_with_social(
            vec![],
            vec![test_content::interaction(
                "chat",
                &[(NeedId::Social, 20.0)],
                30,
            )],
            test_content::tuning(),
        );
        let mut sim = empty_fixture(pack);
        test_content::enclose(&mut sim);
        let actor = bare(&mut sim, 1.0);
        let recipient = bare(&mut sim, 7.0);
        if named_initiator {
            let identity = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
            sim.world_mut().entity_mut(actor).insert(identity);
        }
        enqueue(
            &mut sim,
            SimCommand::TalkToFirst {
                agent: actor.index_u32(),
                target: recipient.index_u32(),
                interaction: 0,
            },
        );
        sim.flush_commands();
        checkpoint(&sim);
        let mut running = false;
        for _ in 0..150 {
            sim.tick();
            if sim.world().get::<terri_core::Socialising>(actor).is_some() {
                checkpoint(&sim);
                let before = sim.current_v17_view();
                let before_hash = sim.world_hash();
                let mut invalid = before.clone();
                let social = &mut invalid
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .social;
                let topic = social
                    .topics
                    .first_mut()
                    .expect("running conversation has its topic");
                topic.initiator = u32::MAX;
                assert!(sim.load_current_v17_view(invalid).is_err());
                assert_eq!(sim.current_v17_view(), before);
                assert_eq!(sim.world_hash(), before_hash);
                running = true;
                break;
            }
        }
        assert!(running, "named initiator={named_initiator}");
        assert!(sim.world().get::<SimId>(recipient).is_none());
        if !named_initiator {
            assert!(sim.world().get::<SimId>(actor).is_none());
        }
    }
}

#[test]
fn current_bare_social_references_require_existing_agents_at_every_boundary() {
    let pack = test_content::pack_with_social(
        vec![],
        vec![test_content::interaction(
            "chat",
            &[(NeedId::Social, 20.0)],
            30,
        )],
        test_content::tuning(),
    );
    let mut sim = empty_fixture(pack);
    test_content::enclose(&mut sim);
    let actor = bare(&mut sim, 1.0);
    let recipient = bare(&mut sim, 7.0);
    enqueue(
        &mut sim,
        SimCommand::TalkToFirst {
            agent: actor.index_u32(),
            target: recipient.index_u32(),
            interaction: 0,
        },
    );
    for boundary in ["queued", "approaching", "talking"] {
        if boundary == "approaching" {
            sim.flush_commands();
        }
        if boundary == "talking" {
            for _ in 0..150 {
                if sim.world().get::<terri_core::Socialising>(actor).is_some() {
                    break;
                }
                sim.tick();
            }
            assert!(sim.world().get::<terri_core::Socialising>(actor).is_some());
        }
        checkpoint(&sim);
        let before = sim.current_v17_view();
        let before_hash = sim.world_hash();
        for victim in [actor.index_u32(), recipient.index_u32()] {
            for missing in [false, true] {
                let mut invalid = before.clone();
                let world = &mut invalid
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .world;
                if missing {
                    world.entities.retain(|entity| entity.index != victim);
                } else {
                    world
                        .entities
                        .iter_mut()
                        .find(|entity| entity.index == victim)
                        .unwrap()
                        .agent = false;
                }
                assert!(
                    sim.load_current_v17_view(invalid).is_err(),
                    "{boundary}: actor={victim}, missing={missing}"
                );
                assert_eq!(sim.current_v17_view(), before);
                assert_eq!(sim.world_hash(), before_hash);
            }
        }
    }
}

fn legacy_paused_order_phase(sim: &Sim, actor: Entity, expected: &str) {
    let grid = sim.world().resource::<terri_core::TileGrid>();
    let mut loaded = Sim::new_with_lot_and_content(
        grid.width(),
        grid.height(),
        *sim.world().resource::<Content>(),
    );
    let tick = sim.world().resource::<terri_core::SimClock>().tick;
    let random = sim.world().resource::<terri_core::SimRng>().clone();
    loaded
        .load_snapshot_v14(sim.save_snapshot_v14())
        .expect("real active legacy order restores");
    let before = loaded.current_v17_view();
    let rows = loaded.action_queue_rows_of(actor.index_u32(), 20);
    assert_eq!(
        rows.first().and_then(|row| row.order_id),
        Some(0),
        "current activity owns its exact card"
    );
    let exact: Vec<_> = rows.iter().filter(|row| row.order_id == Some(0)).collect();
    assert_eq!(exact.len(), 1);
    assert_eq!(exact[0].phase, expected);
    assert_eq!(loaded.world().resource::<terri_core::SimClock>().tick, tick);
    assert_eq!(loaded.world().resource::<terri_core::SimRng>(), &random);
    assert!(loaded.action_events_since(0).events.is_empty());
    assert_eq!(loaded.current_v17_view(), before);
    loaded.load_current_v17_view(before.clone()).unwrap();
    assert_eq!(
        loaded.current_v17_view(),
        before,
        "current owner metadata remains authoritative"
    );
}

#[test]
fn legacy_object_order_phase_is_exact_while_paused() {
    let (mut sim, actor, object) = ordinary_fixture();
    test_content::enclose(&mut sim);
    let identity = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    sim.world_mut().entity_mut(actor).insert(identity);
    enqueue(
        &mut sim,
        SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        },
    );
    sim.flush_commands();
    sim.tick();
    assert_eq!(
        sim.world().get::<ServedOrder>(actor).map(|owner| owner.0),
        Some(0)
    );
    assert_eq!(
        sim.world()
            .get::<terri_core::Target>(actor)
            .map(|target| target.object),
        Some(object)
    );
    assert!(sim.world().get::<terri_core::Path>(actor).is_some());
    legacy_paused_order_phase(&sim, actor, "approaching");
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<terri_core::Eating>(actor).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<terri_core::Eating>(actor).is_some());
    assert_eq!(
        sim.world().get::<ServedOrder>(actor).map(|owner| owner.0),
        Some(0)
    );
    legacy_paused_order_phase(&sim, actor, "running");
}

#[test]
fn legacy_recipe_order_phase_is_exact_while_paused() {
    let mut sim = Sim::new_with_lot(12, 8);
    test_content::enclose(&mut sim);
    let actor = sim.spawn_agent(Position { x: 1.0, y: 1.0 }, 90.0);
    let pack = sim.world().resource::<Content>().0;
    let fridge = sim.spawn_object(Position { x: 5.0, y: 1.0 }, pack.find("fridge").unwrap());
    sim.spawn_object(Position { x: 8.0, y: 1.0 }, pack.find("counter").unwrap());
    enqueue(
        &mut sim,
        SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: fridge.index_u32(),
            interaction: 0,
        },
    );
    for _ in 0..200 {
        sim.tick();
        if sim.world().get::<StepWork>(actor).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<StepWork>(actor).is_some());
    assert_eq!(
        sim.world()
            .get::<crate::recipe_actions::RecipeOrder>(actor)
            .map(|owner| owner.0),
        Some(0)
    );
    legacy_paused_order_phase(&sim, actor, "running");
}

#[test]
fn legacy_reading_order_phase_is_exact_while_paused() {
    let mut sim = Sim::new_with_lot(20, 20);
    test_content::enclose(&mut sim);
    let actor = sim.spawn_agent(Position { x: 1.0, y: 1.0 }, 90.0);
    sim.world_mut()
        .insert_resource(terri_core::Funds::from_dollars(10000));
    let pack = sim.world().resource::<Content>().0;
    let shelf = sim.spawn_object(Position { x: 3.0, y: 3.0 }, pack.find("bookshelf").unwrap());
    let chair = sim.spawn_object(Position { x: 9.0, y: 5.0 }, pack.find("armchair").unwrap());
    let title = pack
        .books
        .iter()
        .find(|book| book.reading_minutes == 180)
        .unwrap()
        .id
        .clone();
    enqueue(
        &mut sim,
        SimCommand::Book(terri_core::command::BookCommand::Purchase {
            title: title.clone(),
            shelf: Some(shelf.index_u32()),
        }),
    );
    sim.flush_commands();
    let action = pack
        .object(pack.find("armchair").unwrap())
        .interactions
        .iter()
        .find(|action| action.book_reading)
        .unwrap()
        .id
        .clone();
    enqueue(
        &mut sim,
        SimCommand::Book(terri_core::command::BookCommand::Read {
            agent: actor.index_u32(),
            object: chair.index_u32(),
            action,
            title,
            front: false,
        }),
    );
    for _ in 0..200 {
        sim.tick();
        if sim
            .world()
            .get::<crate::reading::ReadingJourney>(actor)
            .is_some_and(|journey| journey.stage == terri_core::save_v6::ReadingStage::Read)
        {
            break;
        }
    }
    assert!(sim
        .world()
        .get::<crate::reading::ReadingJourney>(actor)
        .is_some_and(|journey| journey.stage == terri_core::save_v6::ReadingStage::Read));
    legacy_paused_order_phase(&sim, actor, "running");
}
