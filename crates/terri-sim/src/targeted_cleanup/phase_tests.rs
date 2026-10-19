use super::*;
use crate::Sim;
use terri_core::{CommandQueue, Facing, Path, Personality, SimCommand, SimId, StepWork};

fn place(sim: &mut Sim, model: &str, x: usize, y: usize) -> Entity {
    let pack = sim.world().resource::<Content>().0;
    let kind = pack.find(model).expect("authored cleanup fixture object");
    let definition = pack.object(kind);
    let position = Position {
        x: x as f32,
        y: y as f32,
    };
    let facing = Facing::SouthEast;
    let object = sim.spawn_object(position, kind);
    crate::apply_object_placement(sim.world_mut(), object, definition, position, facing);
    let footprint = definition.footprint_at(facing);
    for dx in 0..footprint.width {
        for dy in 0..footprint.depth {
            sim.world_mut().resource_mut::<TileGrid>().set_blocked(
                x + dx as usize,
                y + dy as usize,
                true,
            );
        }
    }
    object
}

fn ordered_cleanup() -> (Sim, Entity, Entity, u64) {
    ordered_cleanup_surface("counter")
}

fn ordered_cleanup_surface(model: &str) -> (Sim, Entity, Entity, u64) {
    let mut sim = Sim::new_with_lot(24, 16);
    let counter = place(&mut sim, model, 16, 8);
    let sink = place(&mut sim, "kitchen_sink", 20, 8);
    let pack = sim.world().resource::<Content>().0;
    let actor = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Cleaner".into(),
            personality: 0,
            position: Position { x: 2., y: 8. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut().get_mut::<Personality>(actor).unwrap().drain = [0.; 7];
    let owner = sim.world().get::<SimId>(actor).unwrap().0;
    {
        let mut domestic = sim
            .world_mut()
            .get_resource_or_insert_with(SavedDomestic::default);
        let id = domestic.next_dish;
        domestic.next_dish += 1;
        domestic.dishes.push(SavedDishes {
            id,
            surface: counter.index_u32(),
            owner,
            units: 1,
        });
    }
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CleanDishesFirst {
            agent: actor.index_u32(),
            surface: counter.index_u32(),
            dishes: None,
        });
    sim.flush_commands();
    let id = sim.world().get::<IntentQueue>(actor).unwrap().entries()[0].id;
    (sim, actor, sink, id)
}

#[test]
fn scoped_cleanup_table_pickup_reports_actual_work_without_a_recipe_role() {
    let (mut sim, actor, _, id) = ordered_cleanup_surface("dining_table");
    let mut worked = false;
    for _ in 0..500 {
        sim.tick();
        if sim.world().get::<StepWork>(actor).is_some() {
            let target = sim.world().get::<terri_core::Target>(actor).unwrap();
            assert_eq!(
                sim.world()
                    .resource::<Content>()
                    .0
                    .object(sim.world().get::<SmartObject>(target.object).unwrap().0)
                    .id,
                "dining_table"
            );
            assert_eq!(phase(&sim, actor, id), "running");
            assert_eq!(
                events(&sim, actor, id)
                    .iter()
                    .filter(|event| event.phase == "started")
                    .count(),
                1
            );
            worked = true;
            break;
        }
    }
    assert!(
        worked,
        "the scoped table must perform the physical collection step"
    );
}

fn events(sim: &Sim, actor: Entity, id: u64) -> Vec<crate::player_actions::ActionEvent> {
    sim.action_events_since(0)
        .events
        .into_iter()
        .filter(|event| event.actor == actor.index_u32() && event.order_id == id)
        .collect()
}

fn phase(sim: &Sim, actor: Entity, id: u64) -> String {
    sim.action_queue_rows_of(actor.index_u32(), 8)
        .into_iter()
        .find(|row| row.order_id == Some(id))
        .expect("the accepted cleanup retains its row")
        .phase
}

fn round_trip(sim: &Sim) -> Sim {
    let mut restored =
        Sim::new_with_lot_and_content(24, 16, Content(sim.world().resource::<Content>().0));
    restored
        .load_current_v17_view(sim.current_v17_view())
        .expect("cleanup ownership and phase must restore");
    assert_eq!(restored.world_hash(), sim.world_hash());
    restored
}

#[test]
fn scoped_cleanup_approach_precedes_actual_start_and_keeps_identity_after_reload() {
    let (mut sim, actor, _, id) = ordered_cleanup();
    sim.tick();
    assert!(
        sim.world().get::<Path>(actor).is_some(),
        "the dish pickup requires a real approach"
    );
    assert!(sim.world().get::<StepWork>(actor).is_none());
    assert_eq!(phase(&sim, actor, id), "approaching");
    assert!(!events(&sim, actor, id)
        .iter()
        .any(|event| matches!(event.phase.as_str(), "started" | "resumed")));
    let mut restored = round_trip(&sim);
    let mut saw_work = false;
    let mut completed = false;
    for _ in 0..700 {
        sim.tick();
        restored.tick();
        assert_eq!(restored.world_hash(), sim.world_hash());
        saw_work |= sim.world().get::<StepWork>(actor).is_some();
        if events(&sim, actor, id)
            .iter()
            .any(|event| event.phase == "completed")
        {
            completed = true;
            break;
        }
    }
    assert!(
        saw_work && completed,
        "the same accepted cleanup must physically work and complete"
    );
    let history = events(&sim, actor, id);
    assert_eq!(
        history
            .iter()
            .filter(|event| event.phase == "started")
            .count(),
        1
    );
    assert_eq!(
        history
            .iter()
            .filter(|event| matches!(event.phase.as_str(), "completed" | "canceled" | "failed"))
            .count(),
        1
    );
}

#[test]
fn scoped_cleanup_sink_contention_waits_without_repeating_lifecycle_records() {
    let (mut sim, actor, sink, id) = ordered_cleanup();
    let mut pack = sim.world().resource::<Content>().0.clone();
    let definition = sim.world().get::<SmartObject>(sink).unwrap().0;
    let row = pack.objects[definition.0 as usize]
        .interactions
        .iter()
        .position(|action| action.id == "wash_up" && action.recipe.is_none())
        .expect("authored ordinary sink use");
    pack.objects[definition.0 as usize].interactions[row].duration_ticks = 1000;
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let holder = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Sink user".into(),
            personality: 0,
            position: Position { x: 19., y: 8. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut()
        .get_mut::<Personality>(holder)
        .unwrap()
        .drain = [0.; 7];
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: holder.index_u32(),
            object: sink.index_u32(),
            interaction: row as u32,
        });
    sim.flush_commands();
    let mut waited = false;
    for _ in 0..500 {
        sim.tick();
        if sim
            .world()
            .get::<ChainState>(actor)
            .is_some_and(|state| state.step == 1)
            && sim.world().get::<terri_core::Blocked>(actor).is_some()
        {
            waited = true;
            break;
        }
    }
    assert!(waited, "the collected dish waits for the reserved sink");
    assert!(
        sim.world().get::<terri_core::Eating>(holder).is_some(),
        "the busy sink has a real current user"
    );
    assert_eq!(phase(&sim, actor, id), "waiting");
    let count = events(&sim, actor, id).len();
    let mut restored = round_trip(&sim);
    for _ in 0..5 {
        sim.tick();
        restored.tick();
        assert_eq!(restored.world_hash(), sim.world_hash());
        assert_eq!(phase(&sim, actor, id), "waiting");
    }
    assert_eq!(
        events(&sim, actor, id).len(),
        count,
        "unchanged contention emits no repeated transitions"
    );
    assert!(!events(&sim, actor, id)
        .iter()
        .any(|event| matches!(event.phase.as_str(), "completed" | "canceled" | "failed")));
}

#[test]
fn scoped_cleanup_activation_refusal_fails_without_claiming_work_started() {
    let (mut sim, actor, sink, id) = ordered_cleanup();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject {
            object: sink.index_u32(),
        });
    sim.flush_commands();
    assert!(
        sim.world().get_entity(sink).is_err(),
        "the only sink was removed before cleanup admission"
    );
    sim.tick();
    let history = events(&sim, actor, id);
    assert!(
        !history
            .iter()
            .any(|event| matches!(event.phase.as_str(), "started" | "resumed")),
        "refused cleanup never worked: {history:#?}"
    );
    let failed: Vec<_> = history
        .iter()
        .filter(|event| event.phase == "failed")
        .collect();
    assert_eq!(failed.len(), 1);
    assert!(failed[0].reason.is_some());
}

#[test]
fn one_tick_cleanup_contact_records_start_before_completion() {
    let (mut sim, actor, _, id) = ordered_cleanup();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.min_interaction_ticks = 1;
    pack.tuning.duration_variance = 0.;
    pack.tuning.domestic.as_mut().unwrap().wash_ticks_per_unit = 0;
    let chain = pack
        .chains
        .iter_mut()
        .find(|chain| chain.id == crate::domestic::CLEANUP)
        .unwrap();
    for step in &mut chain.steps {
        step.duration_ticks = 1;
    }
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let mut saw_pickup = false;
    let mut completed = false;
    for _ in 0..300 {
        sim.tick();
        if !saw_pickup
            && sim
                .world()
                .get::<ChainState>(actor)
                .is_some_and(|chain| chain.step == 1)
        {
            saw_pickup = true;
            assert!(
                sim.world().get::<StepWork>(actor).is_none(),
                "the one-tick collection work has already completed this tick"
            );
            let tick = sim.world().resource::<terri_core::SimClock>().tick;
            let history = events(&sim, actor, id);
            let starts: Vec<_> = history
                .iter()
                .filter(|event| event.phase == "started")
                .collect();
            assert_eq!(starts.len(),1,"actual pickup contact must emit start before a later wash can mask it: {history:#?}");
            assert_eq!(
                starts[0].tick, tick,
                "the first physical work and its start record share the simulation tick"
            );
        }
        if events(&sim, actor, id)
            .iter()
            .any(|event| event.phase == "completed")
        {
            completed = true;
            break;
        }
    }
    assert!(
        saw_pickup && completed,
        "the all-short cleanup must collect and wash the dish"
    );
    let history = events(&sim, actor, id);
    let started = history
        .iter()
        .find(|event| event.phase == "started")
        .unwrap();
    let ended = history
        .iter()
        .find(|event| event.phase == "completed")
        .unwrap();
    assert!(started.sequence < ended.sequence);
    assert_eq!(
        history
            .iter()
            .filter(|event| event.phase == "started")
            .count(),
        1
    );
}

#[test]
fn one_tick_object_contact_records_start_before_completion() {
    let (mut sim, actor, sink, _) = ordered_cleanup();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: actor.index_u32(),
        });
    sim.flush_commands();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.min_interaction_ticks = 1;
    pack.tuning.duration_variance = 0.;
    let definition = sim.world().get::<SmartObject>(sink).unwrap().0;
    let row = pack.objects[definition.0 as usize]
        .interactions
        .iter()
        .position(|action| action.id == "wash_up" && action.recipe.is_none())
        .unwrap();
    pack.objects[definition.0 as usize].interactions[row].duration_ticks = 1;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: sink.index_u32(),
            interaction: row as u32,
        });
    sim.flush_commands();
    let id = sim.world().get::<IntentQueue>(actor).unwrap().entries()[0].id;
    let mut completed = false;
    for _ in 0..300 {
        sim.tick();
        if events(&sim, actor, id)
            .iter()
            .any(|event| event.phase == "completed")
        {
            completed = true;
            break;
        }
    }
    assert!(completed, "the ordinary one-tick sink use must complete");
    assert!(
        sim.world().get::<terri_core::Eating>(actor).is_none(),
        "one-tick work is already gone before the outer observer"
    );
    let history = events(&sim, actor, id);
    let started: Vec<_> = history
        .iter()
        .filter(|event| event.phase == "started")
        .collect();
    let ended = history
        .iter()
        .find(|event| event.phase == "completed")
        .unwrap();
    assert_eq!(
        started.len(),
        1,
        "a completed one-tick object order needs its actual start: {history:#?}"
    );
    assert_eq!(started[0].tick, ended.tick);
    assert!(started[0].sequence < ended.sequence);
}

#[test]
fn one_tick_conversation_records_start_before_same_tick_completion() {
    let (mut sim, actor, _, _) = ordered_cleanup();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: actor.index_u32(),
        });
    sim.flush_commands();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.min_interaction_ticks = 1;
    pack.tuning.duration_variance = 0.;
    pack.voice_clips.clear();
    let row = pack
        .social
        .iter()
        .position(|action| action.id == "chat")
        .unwrap();
    pack.social[row].duration_ticks = 1;
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let recipient = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Listener".into(),
            personality: 0,
            position: Position { x: 5., y: 8. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut()
        .get_mut::<Personality>(recipient)
        .unwrap()
        .drain = [0.; 7];
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkToFirst {
            agent: actor.index_u32(),
            target: recipient.index_u32(),
            interaction: row as u32,
        });
    sim.flush_commands();
    let id = sim.world().get::<IntentQueue>(actor).unwrap().entries()[0].id;
    let mut completed = false;
    for _ in 0..100 {
        sim.tick();
        if events(&sim, actor, id)
            .iter()
            .any(|event| event.phase == "completed")
        {
            completed = true;
            break;
        }
    }
    assert!(
        completed,
        "the one-tick conversation must make contact and complete"
    );
    let history = events(&sim, actor, id);
    let started: Vec<_> = history
        .iter()
        .filter(|event| event.phase == "started")
        .collect();
    let ended = history
        .iter()
        .find(|event| event.phase == "completed")
        .unwrap();
    assert_eq!(
        started.len(),
        1,
        "conversation contact must be recorded before its short work disappears: {history:#?}"
    );
    assert_eq!(started[0].tick, ended.tick);
    assert!(started[0].sequence < ended.sequence);
}

#[test]
fn prepared_food_approach_does_not_claim_station_work_started() {
    let (mut sim, actor, _, _) = ordered_cleanup();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: actor.index_u32(),
        });
    sim.flush_commands();
    let table = place(&mut sim, "dining_table", 20, 12);
    let counter = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| sim.world().resource::<Content>().0.object(object.0).id == "counter")
        .unwrap()
        .0;
    let pack = sim.world().resource::<Content>().0;
    let cook = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Cook".into(),
            personality: 0,
            position: Position { x: 2., y: 3. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut().get_mut::<Personality>(cook).unwrap().drain = [0.; 7];
    let cook_id = sim.world().get::<SimId>(cook).unwrap().0;
    let actor_id = sim.world().get::<SimId>(actor).unwrap().0;
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .meals
        .push(SavedMeal {
            cook: cook_id,
            counter: counter.index_u32(),
            table: Some(table.index_u32()),
            guests: vec![actor_id],
            claimed: vec![],
            collected: vec![],
            eaten: vec![],
            scale: 1.,
            tick: 0,
            dining_started: true,
        });
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::Select(Some(actor.index_u32())));
    sim.flush_commands();
    assert_eq!(
        sim.table_action_rows(table.index_u32()),
        vec![0, 1],
        "the public table protocol exposes its prepared-food row"
    );
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: table.index_u32(),
            interaction: 1,
        });
    sim.flush_commands();
    let id = sim.world().get::<IntentQueue>(actor).unwrap().entries()[0].id;
    sim.tick();
    assert!(sim.world().get::<Path>(actor).is_some());
    assert!(sim.world().get::<StepWork>(actor).is_none());
    let history = events(&sim, actor, id);
    assert!(
        !history
            .iter()
            .any(|event| matches!(event.phase.as_str(), "started" | "resumed")),
        "claiming a meal is not physical work: {history:#?}"
    );
    let before = sim.world_hash();
    let mut impossible = sim.current_v17_view();
    let owned = impossible
        .player_orders
        .orders
        .iter_mut()
        .find(|order| {
            order.actor == terri_core::save_v17::SavedOrderActor::Sim(actor_id)
                && order.order_id == id
        })
        .unwrap();
    assert!(!owned.started);
    owned.phase = 3;
    assert!(
        sim.load_current_v17_view(impossible).is_err(),
        "running work still requires a recorded physical start"
    );
    assert_eq!(sim.world_hash(), before);
    let mut restored = round_trip(&sim);
    let mut worked = false;
    for _ in 0..300 {
        sim.tick();
        restored.tick();
        assert_eq!(restored.world_hash(), sim.world_hash());
        if sim.world().get::<StepWork>(actor).is_some() {
            let starts: Vec<_> = events(&sim, actor, id)
                .into_iter()
                .filter(|event| event.phase == "started")
                .collect();
            assert_eq!(starts.len(), 1);
            assert_eq!(
                starts[0].tick,
                sim.world().resource::<terri_core::SimClock>().tick
            );
            worked = true;
            break;
        }
    }
    assert!(
        worked,
        "the same prepared-food order eventually reaches actual pickup work"
    );
}
