use crate::{player_actions::ServedOrder, test_content, Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::{
    save_v15::SavedOrderActor, Agent, CommandQueue, IntentQueue, NeedId, Needs, Position,
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
    let saved = sim.save_snapshot_v15();
    let mut loaded = test_content::sim_with(12, 8, content);
    loaded
        .load_snapshot_v15(saved.clone())
        .expect("the empty custom fixture must satisfy the current save contract");
    assert_eq!(loaded.save_snapshot_v15(), saved);
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
    let saved = sim.save_snapshot_v15();
    let mut loaded = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    loaded.load_snapshot_v15(saved.clone()).unwrap();
    assert_eq!(loaded.save_snapshot_v15(), saved);
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
    let queued = sim.save_snapshot_v15();
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
        .save_snapshot_v15()
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
    let saved = sim.save_snapshot_v15();
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
    for _ in 0..250 {
        sim.tick();
        loaded.tick();
        assert_eq!(loaded.world_hash(), sim.world_hash());
        if !checked_frozen_boundary
            && sim
                .save_snapshot_v15()
                .social_executions
                .iter()
                .any(|row| row.initiator == actor.index_u32() && row.admitted)
        {
            let mut historical = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
            assert!(matches!(
                historical.load_snapshot_v14(sim.save_snapshot_v14()),
                Err(crate::SaveError::InvalidEntityReference)
            ));
            checked_frozen_boundary = true;
        }
        if sim.world().get::<IntentQueue>(actor).unwrap().is_empty() {
            break;
        }
    }
    assert!(checked_frozen_boundary);
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
    let saved = sim.save_snapshot_v15();
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
            loaded.load_snapshot_v15(malformed).is_err(),
            "accepted {invalid:?}"
        );
        assert_eq!(loaded.world_hash(), before);
        assert_eq!(loaded.save_snapshot_v15(), saved);
    }
}
