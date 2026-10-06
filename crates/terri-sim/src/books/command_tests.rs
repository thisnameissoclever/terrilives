use super::*;
use crate::{Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::{
    books::*, command::BookCommand, Agent, CommandQueue, Funds, IntentQueue, SimCommand, SimId,
    SmartObject,
};

fn fixture() -> (Sim, Entity, Entity, String, String) {
    let mut pack = terri_data::pack().clone();
    let shelf = pack.find("bookshelf").unwrap();
    pack.objects[shelf.0 as usize].shelf_capacity = 1;
    pack.objects[shelf.0 as usize].interactions[0].book_reading = true;
    let action = pack.object(shelf).interactions[0].id.clone();
    let title = pack.books[0].id.clone();
    let seed = pack.tuning.rng_seed;
    let mut sim = Sim::new_household_with_content(Content(Box::leak(Box::new(pack))), seed);
    let person = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    let object = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| o.0 == shelf)
        .unwrap()
        .0;
    sim.world_mut().insert_resource(Funds(100_000));
    (sim, person, object, action, title)
}
fn issue(sim: &mut Sim, command: BookCommand) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::Book(command));
}
fn read(person: Entity, shelf: Entity, action: &str, title: &str, front: bool) -> BookCommand {
    BookCommand::Read {
        agent: person.index_u32(),
        object: shelf.index_u32(),
        action: action.into(),
        title: title.into(),
        front,
    }
}
#[test]
fn book_command_paused_transactions_charge_once_and_refuse_without_mutation() {
    let (mut sim, _, shelf, _, title) = fixture();
    let price = sim
        .book_titles()
        .iter()
        .find(|b| b.id == title)
        .unwrap()
        .price;
    let tick = sim.save_snapshot_v6().legacy.world.tick;
    issue(
        &mut sim,
        BookCommand::Purchase {
            title: title.clone(),
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.flush_commands();
    assert_eq!(sim.book_copies().len(), 1);
    assert_eq!(
        sim.world().resource::<Funds>().0,
        100_000 - i64::from(price)
    );
    assert_eq!(sim.save_snapshot_v6().legacy.world.tick, tick);
    assert_eq!(sim.take_book_results()[0].copy, Some(0));
    sim.flush_commands();
    assert_eq!(sim.book_copies().len(), 1);
    for (title, shelf, expected) in [
        ("unknown".to_string(), None, "unknown_title"),
        (title.clone(), Some(u32::MAX), "unknown_shelf"),
    ] {
        let before = sim.save_snapshot_v6();
        issue(&mut sim, BookCommand::Purchase { title, shelf });
        sim.flush_commands();
        assert_eq!(sim.take_book_results()[0].refusal, Some(expected));
        assert_eq!(sim.save_snapshot_v6(), before);
    }
    sim.world_mut().insert_resource(Funds(0));
    let before = sim.save_snapshot_v6();
    issue(&mut sim, BookCommand::Purchase { title, shelf: None });
    sim.flush_commands();
    assert_eq!(
        sim.take_book_results()[0].refusal,
        Some("insufficient_funds")
    );
    assert_eq!(sim.save_snapshot_v6(), before);
}
#[test]
fn book_command_reserved_home_full_fallback_transfer_and_death_recovery() {
    let (mut sim, person, shelf, _, title) = fixture();
    issue(
        &mut sim,
        BookCommand::Purchase {
            title: title.clone(),
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.flush_commands();
    let id = *sim.world().get::<SimId>(person).unwrap();
    let mut library = sim.world().resource::<BookLibrary>().clone();
    with_book_world(sim.world(), |context| {
        library.reserve(BookCopyId(0), id, context)?;
        library.pick_up(BookCopyId(0), id, context)
    })
    .unwrap();
    sim.world_mut().insert_resource(library);
    issue(
        &mut sim,
        BookCommand::Purchase {
            title,
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.flush_commands();
    assert_eq!(sim.book_copies()[1].location, BookLocation::Inventory);
    assert_eq!(
        sim.book_shelf_slots(shelf.index_u32(), true).unwrap(),
        vec![Some(BookCopyId(0))]
    );
    assert_eq!(
        sim.book_shelf_slots(shelf.index_u32(), false).unwrap(),
        vec![None]
    );
    let before = sim.book_copies().to_vec();
    issue(
        &mut sim,
        BookCommand::Transfer {
            copy: 0,
            shelf: None,
        },
    );
    sim.flush_commands();
    assert_eq!(sim.book_copies(), before);
    assert_eq!(
        sim.take_book_results().last().unwrap().refusal,
        Some("borrowed")
    );
    super::recover_before_death(sim.world_mut(), person);
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Lot { .. }
    ));
    issue(
        &mut sim,
        BookCommand::Transfer {
            copy: 0,
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.flush_commands();
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Shelf(_)
    ));
    issue(
        &mut sim,
        BookCommand::Transfer {
            copy: 1,
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.flush_commands();
    assert_eq!(sim.book_copies()[1].location, BookLocation::Inventory);
    issue(
        &mut sim,
        BookCommand::Transfer {
            copy: 0,
            shelf: None,
        },
    );
    sim.flush_commands();
    issue(
        &mut sim,
        BookCommand::Transfer {
            copy: 1,
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.flush_commands();
    assert_eq!(sim.book_copies()[1].id, BookCopyId(1));
    assert!(matches!(
        sim.book_copies()[1].location,
        BookLocation::Shelf(_)
    ));
}
#[test]
fn book_command_selected_titles_round_trip_exactly_and_never_run_bookless() {
    let (mut sim, person, shelf, action, title) = fixture();
    let second = sim.book_titles()[1].id.clone();
    issue(&mut sim, read(person, shelf, &action, &title, false));
    issue(&mut sim, read(person, shelf, &action, &second, false));
    issue(&mut sim, read(person, shelf, &action, &title, false));
    sim.flush_commands();
    assert_eq!(
        sim.take_book_results()
            .iter()
            .map(|r| r.order)
            .collect::<Vec<_>>(),
        vec![Some(0), Some(1), Some(2)]
    );
    let queue = sim.world().get::<IntentQueue>(person).unwrap();
    assert_eq!(
        queue.entries()[1].title_id.as_deref(),
        Some(second.as_str())
    );
    let saved = sim.save_snapshot_v6();
    let hash = sim.world_hash();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
    assert_eq!(sim.world_hash(), hash);
    sim.tick();
    assert!(sim.world().get::<terri_core::Eating>(person).is_none());
    assert!(sim.world().get::<terri_core::Target>(person).is_none());
    assert_eq!(sim.world().get::<IntentQueue>(person).unwrap().len(), 3);
    assert_eq!(
        sim.world_mut()
            .get_mut::<IntentQueue>(person)
            .unwrap()
            .remove_order(1)
            .unwrap()
            .title_id
            .as_deref(),
        Some(second.as_str())
    );
    assert_eq!(
        sim.world()
            .get::<IntentQueue>(person)
            .unwrap()
            .entries()
            .iter()
            .map(|e| e.id)
            .collect::<Vec<_>>(),
        vec![0, 2]
    );
    let identical = sim
        .world_mut()
        .get_mut::<IntentQueue>(person)
        .unwrap()
        .remove_order(2)
        .unwrap();
    assert_eq!(identical.title_id.as_deref(), Some(title.as_str()));
    assert_eq!(
        sim.world().get::<IntentQueue>(person).unwrap().entries()[0].id,
        0
    );
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: person.index_u32(),
        });
    sim.flush_commands();
    issue(&mut sim, read(person, shelf, &action, &title, false));
    sim.flush_commands();
    assert_eq!(
        sim.world().get::<IntentQueue>(person).unwrap().entries()[0].id,
        3
    );
}
#[test]
fn book_command_v6_metadata_corruption_rolls_back_every_field() {
    let (mut sim, person, shelf, action, title) = fixture();
    issue(&mut sim, read(person, shelf, &action, &title, false));
    issue(&mut sim, read(person, shelf, &action, &title, false));
    sim.flush_commands();
    let valid = sim.save_snapshot_v6();
    let hash = sim.world_hash();
    for fault in 0..9 {
        let mut bad = valid.clone();
        let q = bad
            .queues
            .iter_mut()
            .find(|q| q.owner == person.index_u32())
            .unwrap();
        match fault {
            0 => {
                q.orders.pop();
            }
            1 => q.orders[1].id = q.orders[0].id,
            2 => q.next_id = 0,
            3 => q.orders[0].title = Some("absent".into()),
            4 => q.orders[0].target = person.index_u32(),
            5 => q.orders[0].action = "interaction:absent".into(),
            6 => q.owner = shelf.index_u32(),
            7 => bad.queues.clear(),
            _ => bad.command_order.push(None),
        }
        assert!(sim.load_snapshot_v6(bad).is_err(), "accepted fault {fault}");
        assert_eq!(sim.save_snapshot_v6(), valid);
        assert_eq!(sim.world_hash(), hash);
    }
}
#[test]
fn book_command_pending_interleaving_and_query_purity() {
    let (mut sim, person, shelf, action, title) = fixture();
    issue(
        &mut sim,
        BookCommand::Purchase {
            title: title.clone(),
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::Select(Some(person.index_u32())));
    issue(
        &mut sim,
        BookCommand::Transfer {
            copy: 0,
            shelf: None,
        },
    );
    issue(&mut sim, read(person, shelf, &action, &title, false));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: person.index_u32(),
        });
    let saved = sim.save_snapshot_v6();
    let hash = sim.world_hash();
    for _ in 0..50 {
        assert!(
            sim.book_interest(person.index_u32(), shelf.index_u32(), &action, &title)
                .unwrap()
                > 0.0
        );
        sim.book_titles();
        sim.book_copies();
        sim.book_shelves().unwrap();
    }
    assert_eq!(sim.save_snapshot_v6(), saved);
    assert_eq!(sim.world_hash(), hash);
    let mut restored = fixture().0;
    restored.load_snapshot_v6(saved).unwrap();
    sim.flush_commands();
    restored.flush_commands();
    assert_eq!(sim.save_snapshot_v6(), restored.save_snapshot_v6());
    assert_eq!(sim.book_copies()[0].location, BookLocation::Inventory);
    assert!(sim.world().get::<IntentQueue>(person).unwrap().is_empty());
    let results = sim.take_book_results();
    assert_eq!(
        results.iter().map(|r| r.sequence).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
}
#[test]
fn book_command_interest_applies_dispositions_once_and_separates_novelty() {
    let (mut sim, person, shelf, action, title) = fixture();
    let base = sim
        .book_interest(person.index_u32(), shelf.index_u32(), &action, &title)
        .unwrap();
    let object = sim.world().get::<SmartObject>(shelf).unwrap().0;
    sim.world_mut()
        .entity_mut(person)
        .insert(terri_core::Personality::with_dispositions(
            [1.0; 7],
            [1.0; 7],
            vec![(object, 0, 2.0)],
        ));
    assert_eq!(
        sim.book_interest(person.index_u32(), shelf.index_u32(), &action, &title)
            .unwrap(),
        base * 2.0
    );
    assert_eq!(
        sim.book_taste_multiplier(person.index_u32(), shelf.index_u32(), &action, &title)
            .unwrap(),
        base * 2.0
    );
}
#[test]
fn book_command_requires_owned_action_and_exhaustion_is_atomic() {
    let (mut sim, person, shelf, action, title) = fixture();
    issue(&mut sim, read(person, shelf, "absent", &title, false));
    sim.flush_commands();
    assert_eq!(
        sim.take_book_results()[0].refusal,
        Some("not_owned_reading_action")
    );
    sim.world_mut()
        .entity_mut(person)
        .insert(IntentQueue::from_entries(vec![], u64::MAX).unwrap());
    let before = sim.save_snapshot_v6();
    issue(&mut sim, read(person, shelf, &action, &title, true));
    sim.flush_commands();
    assert_eq!(
        sim.take_book_results()[0].refusal,
        Some("order_ids_exhausted")
    );
    assert_eq!(sim.save_snapshot_v6(), before);
}

#[test]
fn book_command_full_transfer_keeps_source_and_later_transfer_preserves_copy_id() {
    let (mut sim, _, shelf, _, title) = fixture();
    let definition = sim.world().get::<SmartObject>(shelf).unwrap().0;
    let grid = sim.world().resource::<terri_core::TileGrid>();
    let (x, y) = (2..grid.height() as i32 - 2)
        .flat_map(|y| (2..grid.width() as i32 - 2).map(move |x| (x, y)))
        .find(|&(x, y)| (0..2).all(|dx| (0..2).all(|dy| grid.is_walkable(x + dx, y + dy))))
        .unwrap();
    let other = sim.spawn_object(
        terri_core::Position {
            x: x as f32,
            y: y as f32,
        },
        definition,
    );
    for target in [shelf, other] {
        issue(
            &mut sim,
            BookCommand::Purchase {
                title: title.clone(),
                shelf: Some(target.index_u32()),
            },
        );
    }
    sim.flush_commands();
    let before = sim.save_snapshot_v6();
    issue(
        &mut sim,
        BookCommand::Transfer {
            copy: 1,
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.flush_commands();
    assert_eq!(
        sim.take_book_results().last().unwrap().refusal,
        Some("shelf_full")
    );
    assert_eq!(sim.save_snapshot_v6(), before);
    for command in [
        BookCommand::Transfer {
            copy: u32::MAX,
            shelf: None,
        },
        BookCommand::Transfer {
            copy: 1,
            shelf: Some(u32::MAX),
        },
    ] {
        issue(&mut sim, command);
        sim.flush_commands();
        assert_eq!(sim.save_snapshot_v6(), before);
    }
    issue(
        &mut sim,
        BookCommand::Transfer {
            copy: 0,
            shelf: None,
        },
    );
    sim.flush_commands();
    issue(
        &mut sim,
        BookCommand::Transfer {
            copy: 1,
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.flush_commands();
    let copy = &sim.book_copies()[1];
    assert_eq!(copy.id, BookCopyId(1));
    assert_eq!(
        copy.home.unwrap().shelf,
        BookShelfId(shelf.index_u32().into())
    );
    assert!(matches!(copy.location, BookLocation::Shelf(_)));
}
#[test]
fn book_command_empty_allocator_is_saved_hashed_and_not_reused() {
    let (mut sim, person, shelf, action, title) = fixture();
    sim.world_mut()
        .entity_mut(person)
        .insert(IntentQueue::default());
    let before = sim.world_hash();
    issue(&mut sim, read(person, shelf, &action, &title, false));
    sim.flush_commands();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: person.index_u32(),
        });
    sim.flush_commands();
    assert_ne!(sim.world_hash(), before);
    let saved = sim.save_snapshot_v6();
    let hash = sim.world_hash();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.save_snapshot_v6(), saved);
    let mut advanced = saved.clone();
    advanced
        .queues
        .iter_mut()
        .find(|q| q.owner == person.index_u32())
        .unwrap()
        .next_id = 2;
    sim.load_snapshot_v6(advanced).unwrap();
    assert_ne!(sim.world_hash(), hash);
    sim.load_snapshot_v6(saved).unwrap();
    issue(&mut sim, read(person, shelf, &action, &title, false));
    sim.flush_commands();
    assert_eq!(
        sim.world().get::<IntentQueue>(person).unwrap().entries()[0].id,
        1
    );
}
#[test]
fn book_command_front_displacing_selected_title_preserves_unrelated_ordinary_commitment() {
    for book_front in [false, true] {
        let (mut sim, person, shelf, action, title) = fixture();
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.max_queued_intents = 1;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        issue(&mut sim, read(person, shelf, &action, &title, false));
        sim.flush_commands();
        let target = terri_core::Target {
            object: shelf,
            interaction: 0,
        };
        sim.world_mut().entity_mut(person).insert(target);
        if book_front {
            issue(&mut sim, read(person, shelf, &action, &title, true));
        } else {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObjectFirst {
                    agent: person.index_u32(),
                    object: shelf.index_u32(),
                    interaction: 0,
                });
        }
        sim.flush_commands();
        assert_eq!(
            sim.world()
                .get::<terri_core::Target>(person)
                .unwrap()
                .object,
            shelf
        );
        assert_eq!(sim.world().get::<IntentQueue>(person).unwrap().len(), 1);
        assert_eq!(
            sim.world().get::<IntentQueue>(person).unwrap().entries()[0].id,
            1
        );
        assert_eq!(sim.take_intent_displacements(), 1);
    }
}
#[test]
fn book_command_historical_ordinary_queues_receive_deterministic_ids() {
    let mut old = crate::test_content::pre_books_sim();
    let snapshot = old.save_snapshot_v5();
    let person = snapshot
        .world
        .entities
        .iter()
        .find(|e| e.agent)
        .unwrap()
        .index;
    let object = snapshot
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    for _ in 0..2 {
        old.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObject {
                agent: person,
                object,
                interaction: 0,
            });
    }
    old.flush_commands();
    let saved = old.save_snapshot_v5();
    let mut current = Sim::new_from_shipped_lot();
    current
        .load_legacy_snapshot(crate::LegacySnapshot::V5(Box::new(saved)))
        .unwrap();
    let new = current.save_snapshot_v6();
    let queue = new.queues.iter().find(|q| q.owner == person).unwrap();
    assert_eq!(queue.next_id, 2);
    assert_eq!(
        queue.orders.iter().map(|o| o.id).collect::<Vec<_>>(),
        vec![0, 1]
    );
    assert!(queue.orders.iter().all(|o| o.title.is_none()));
    current.load_snapshot_v6(new.clone()).unwrap();
    assert_eq!(current.save_snapshot_v6(), new);
}

#[test]
fn book_command_store_estimate_needs_no_placed_reading_furniture() {
    let (mut sim, person, _, _, title) = fixture();
    let pack = sim.world().resource::<Content>().0;
    let furniture: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .filter(|(_, o)| {
            pack.object(o.0).shelf_capacity > 0
                || pack
                    .object(o.0)
                    .interactions
                    .iter()
                    .any(|a| a.tags.iter().any(|t| t == "reading"))
        })
        .map(|(e, _)| e.index_u32())
        .collect();
    for object in furniture {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SellObject { object });
    }
    sim.flush_commands();
    assert!(sim.book_shelves().unwrap().is_empty());
    let def = pack.find("bookshelf").unwrap();
    sim.world_mut()
        .entity_mut(person)
        .insert(terri_core::Personality::with_dispositions(
            [1.0; 7],
            [1.0; 7],
            vec![(def, 0, 2.0)],
        ));
    let id = *sim.world().get::<SimId>(person).unwrap();
    let library = sim.world().resource::<BookLibrary>();
    let base = with_book_world(sim.world(), |world| {
        library.estimate_interest(id, &title, world)
    })
    .unwrap();
    let trait_factor = crate::systems::trait_effects::disposition_multiplier(
        sim.world().get::<terri_core::Traits>(person),
        pack,
        &["reading".into()],
    );
    let saved = sim.save_snapshot_v6();
    let hash = sim.world_hash();
    for _ in 0..20 {
        assert!(
            (sim.book_store_interest(person.index_u32(), &title).unwrap()
                - base * 2.0 * trait_factor)
                .abs()
                < 0.00001
        );
    }
    assert_eq!(sim.save_snapshot_v6(), saved);
    assert_eq!(sim.world_hash(), hash);
}
#[test]
fn book_command_death_cleanup_preserves_surviving_titles_ids_and_allocator() {
    let (mut sim, person, shelf, action, title) = fixture();
    let other = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .find(|e| *e != person)
        .unwrap();
    issue(&mut sim, read(person, shelf, &action, &title, false));
    sim.flush_commands();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkTo {
            agent: person.index_u32(),
            target: other.index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
    issue(&mut sim, read(person, shelf, &action, &title, false));
    sim.flush_commands();
    let threshold = sim.world().resource::<Content>().0.tuning.death_after_ticks;
    sim.world_mut()
        .get_mut::<terri_core::Needs>(other)
        .unwrap()
        .set(terri_core::NeedId::Hunger, 0.0);
    {
        let mut mortality = sim
            .world_mut()
            .resource_mut::<terri_core::save::SavedMortality>();
        mortality.enabled = true;
        mortality.counts = vec![(other.index_u32(), threshold - 1)];
    }
    crate::mortality::tick(sim.world_mut());
    assert!(sim.world().get_entity(other).is_err());
    let queue = sim.world().get::<IntentQueue>(person).unwrap();
    assert_eq!(queue.next_id(), 3);
    assert_eq!(
        queue.entries().iter().map(|e| e.id).collect::<Vec<_>>(),
        vec![0, 2]
    );
    assert!(queue
        .entries()
        .iter()
        .all(|e| e.title_id.as_deref() == Some(title.as_str())));
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
}

fn opted_action_fixture(owned: bool) -> (Sim, Entity, Entity) {
    let mut pack = terri_data::pack().clone();
    let definition = pack.find("bookshelf").unwrap();
    pack.objects[definition.0 as usize].interactions[0].book_reading = owned;
    let mut sim = Sim::new_with_lot_and_content(8, 8, Content(Box::leak(Box::new(pack))));
    let id = sim
        .world_mut()
        .resource_mut::<terri_core::SimIdAllocator>()
        .issue();
    let mut needs = terri_core::Needs::all_at(100.0);
    needs.set(terri_core::NeedId::Fun, 0.0);
    let person = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            terri_core::SimName("Reader".into()),
            terri_core::Position { x: 1.0, y: 1.0 },
            needs,
        ))
        .id();
    let shelf = sim.spawn_object(terri_core::Position { x: 4.0, y: 4.0 }, definition);
    (sim, person, shelf)
}
#[test]
fn book_command_ordinary_owned_action_waits_for_an_available_copy() {
    use bevy_ecs::system::RunSystemOnce;
    for owned in [false, true] {
        let (mut sim, person, shelf) = opted_action_fixture(owned);
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObject {
                agent: person.index_u32(),
                object: shelf.index_u32(),
                interaction: 0,
            });
        sim.flush_commands();
        sim.world_mut()
            .run_system_once(crate::systems::action::serve_intents)
            .unwrap();
        assert_eq!(
            sim.world().get::<terri_core::Target>(person).is_none(),
            owned
        );
        assert_eq!(sim.world().get::<IntentQueue>(person).unwrap().len(), 1);
    }
}
#[test]
fn book_command_autonomous_reading_requires_available_copy() {
    use bevy_ecs::system::RunSystemOnce;
    for owned in [false, true] {
        let (mut sim, person, _) = opted_action_fixture(owned);
        sim.world_mut()
            .run_system_once(crate::systems::action::select_action)
            .unwrap();
        assert_eq!(
            sim.world().get::<terri_core::Target>(person).is_none(),
            owned
        );
    }
}
#[test]
fn book_command_review_combined_pending_limit_has_valid_controls_and_atomic_refusal() {
    let (mut sim, _, _, _, title) = fixture();
    let cap = sim
        .world()
        .resource::<Content>()
        .0
        .tuning
        .max_queued_commands as usize;
    let original = sim.save_snapshot_v6();
    let command = Some(BookCommand::Purchase { title, shelf: None });
    for ordinary_count in [0, 1, cap / 2] {
        let mut valid = original.clone();
        valid.legacy.world.queued_commands =
            vec![terri_core::SavedCommand::SetSpeed(0); ordinary_count];
        valid.command_order = vec![None; ordinary_count];
        valid
            .command_order
            .extend(vec![command.clone(); cap - ordinary_count]);
        sim.load_snapshot_v6(valid.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v6(), valid);
        let hash = sim.world_hash();
        let mut bad = valid.clone();
        bad.command_order.push(command.clone());
        assert_eq!(
            sim.load_snapshot_v6(bad),
            Err(crate::SaveError::TooManyCommands)
        );
        assert_eq!(sim.save_snapshot_v6(), valid);
        assert_eq!(sim.world_hash(), hash);
    }
}
#[test]
fn book_command_nonfresh_interest_discount_is_not_in_reward_multiplier() {
    let (mut sim, person, shelf, action, title) = fixture();
    let factor = sim
        .book_taste_multiplier(person.index_u32(), shelf.index_u32(), &action, &title)
        .unwrap();
    issue(
        &mut sim,
        BookCommand::Purchase {
            title: title.clone(),
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.flush_commands();
    let person_id = *sim.world().get::<SimId>(person).unwrap();
    let mut library = sim.world().resource::<BookLibrary>().clone();
    let minutes = sim
        .book_titles()
        .iter()
        .find(|b| b.id == title)
        .unwrap()
        .reading_minutes;
    with_book_world(sim.world(), |world| {
        library.reserve(BookCopyId(0), person_id, world)?;
        library.pick_up(BookCopyId(0), person_id, world)?;
        for _ in 0..minutes {
            if library
                .read_work(BookCopyId(0), person_id, world.tuning.session_ticks, world)?
                .completed
            {
                break;
            }
        }
        Ok(())
    })
    .unwrap();
    sim.world_mut().insert_resource(library);
    let floor = sim
        .world()
        .resource::<Content>()
        .0
        .reading
        .unwrap()
        .reread_floor;
    let contextual = sim
        .book_interest(person.index_u32(), shelf.index_u32(), &action, &title)
        .unwrap();
    assert!((contextual - factor * floor).abs() < 0.00001);
    assert!(contextual < factor);
    assert!(
        (sim.book_store_interest(person.index_u32(), &title).unwrap() - factor * floor).abs()
            < 0.00001
    );
    assert_eq!(
        sim.book_taste_multiplier(person.index_u32(), shelf.index_u32(), &action, &title)
            .unwrap(),
        factor
    );
}
#[test]
fn book_command_copy_allocator_exhaustion_refuses_without_charge() {
    let (mut sim, _, shelf, _, title) = fixture();
    let mut saved = sim.save_snapshot_v6();
    saved.books.next_copy_id = u32::MAX;
    sim.load_snapshot_v6(saved.clone()).unwrap();
    issue(
        &mut sim,
        BookCommand::Purchase {
            title,
            shelf: Some(shelf.index_u32()),
        },
    );
    sim.flush_commands();
    assert_eq!(
        sim.take_book_results()[0].refusal,
        Some("copy_ids_exhausted")
    );
    assert_eq!(sim.save_snapshot_v6(), saved);
}
