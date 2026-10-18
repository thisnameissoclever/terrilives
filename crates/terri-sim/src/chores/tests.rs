use super::*;
use crate::Sim;
use terri_core::{SimClock, TileGrid};

#[test]
fn incoming_order_waits_for_current_directed_floor_task_to_finish() {
    let mut sim = Sim::new_with_lot(16, 8);
    let pack = sim.world().resource::<crate::Content>().0;
    let mut create = |name: &str, x: f32| {
        let person = crate::household::spawn_member(
            sim.world_mut(),
            &pack.personalities,
            &pack.traits,
            crate::household::Member {
                name: name.into(),
                personality: 0,
                position: terri_core::Position { x, y: 1. },
                needs: [100.; 7],
                hobbies: vec![],
                traits: &[],
                career: None,
                instinct: Some(50),
            },
        );
        sim.world_mut()
            .get_mut::<terri_core::Personality>(person)
            .unwrap()
            .drain = [0.; 7];
        person
    };
    let initiator = create("Talker", 1.);
    let recipient = create("Sweeper", 7.);
    ensure(sim.world_mut());
    let cell = 16 + 7;
    let key = ChoreKey {
        kind: ChoreKind::Floors,
        target: crate::rooms::cleaning_area_at(sim.world(), (7, 1))
            .unwrap()
            .key(),
    };
    add(
        &mut sim.world_mut().resource_mut::<SavedChores>().floors,
        cell,
        500,
    );
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::CleanChoreFirst {
            agent: recipient.index_u32(),
            key,
        });
    sim.tick();
    assert!(sim
        .world()
        .resource::<SavedChores>()
        .tasks
        .iter()
        .any(|task| task.person == recipient.index_u32()));
    assert!(
        sim.world()
            .get::<terri_core::chores::ChoreWork>(recipient)
            .is_some(),
        "the recipient is physically performing the original chore"
    );
    let admitted = sim
        .world()
        .resource::<crate::social_episode::SocialEpisodes>()
        .executions
        .iter()
        .find(|(_, execution)| execution.recipient == recipient && execution.admitted);
    assert!(admitted.is_none(),"an unfinished directed chore cannot already have an admitted autonomous conversation: {admitted:?}");
    let saved = sim.save_snapshot_v17();
    let hash = sim.world_hash();
    let mut restored = Sim::new_with_lot(16, 8);
    restored.load_snapshot_v17(saved.clone()).unwrap_or_else(|error|panic!("V17 chore state refused: {error:?}; player_orders={:#?}; chores={:#?}; queues={:#?}",saved.player_orders,saved.legacy.legacy.legacy.legacy.legacy.legacy.legacy.legacy.legacy.chores,saved.legacy.legacy.legacy.legacy.legacy.legacy.legacy.legacy.queues));
    super::lifecycle_tests::assert_v17_projection(&saved, &restored.save_snapshot_v17());
    assert_eq!(restored.world_hash(), hash);
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::TalkTo {
            agent: initiator.index_u32(),
            target: recipient.index_u32(),
            interaction: 0,
        });
    let mut talked = false;
    for _ in 0..1000 {
        sim.tick();
        if sim
            .world()
            .get::<terri_core::Socialising>(initiator)
            .is_some()
        {
            assert!(
                !sim.world()
                    .resource::<SavedChores>()
                    .tasks
                    .iter()
                    .any(|task| task.person == recipient.index_u32()),
                "the complete current chore must finish before incoming contact"
            );
            talked = true;
            break;
        }
    }
    assert!(talked, "the incoming order must run after the floor task");
    assert_eq!(
        value(&sim.world().resource::<SavedChores>().floors, cell),
        0
    );
}

#[test]
fn normal_household_enables_assignments_and_every_need_declines_during_play() {
    let mut sim = Sim::new_from_shipped_lot();
    let mut decline = [0.0f32; 7];
    let mut previous = std::collections::BTreeMap::new();
    for _ in 0..600 {
        sim.tick();
        let mut people = sim.world_mut().query::<(
            &terri_core::SimId,
            &terri_core::Needs,
            &terri_core::Personality,
        )>();
        for (id, needs, personality) in people.iter(sim.world()) {
            assert!(
                personality.drain.iter().all(|v| *v > 0.0),
                "playable households must use normal need decay"
            );
            let levels = terri_core::NeedId::ALL.map(|need| needs.get(need));
            if let Some(before) = previous.insert(id.0, levels) {
                for i in 0..7 {
                    decline[i] += (before[i] - levels[i]).max(0.0);
                }
            }
        }
    }
    assert!(sim.world().resource::<SavedChores>().board_enabled);
    for (i, amount) in decline.iter().enumerate() {
        assert!(*amount > 2.0, "need {i} never visibly declined: {amount}");
    }
}

#[test]
fn floor_work_walks_and_cleans_over_time_with_valid_saves_at_every_tick() {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = sim
        .world_mut()
        .query::<(Entity, &terri_core::SimId)>()
        .iter(sim.world())
        .min_by_key(|(_, id)| id.0)
        .unwrap()
        .0;
    let width = sim.world().resource::<TileGrid>().width();
    let rooms = crate::room_regions::RoomRegions::from_world(sim.world());
    let cell = (0..width * sim.world().resource::<TileGrid>().height())
        .find(|cell| {
            let xy = ((cell % width) as i32, (cell / width) as i32);
            rooms.at(xy).is_some() && sim.world().resource::<TileGrid>().is_walkable(xy.0, xy.1)
        })
        .unwrap() as u32;
    let key = ChoreKey {
        kind: ChoreKind::Floors,
        target: rooms
            .at((
                (cell as usize % width) as i32,
                (cell as usize / width) as i32,
            ))
            .unwrap(),
    };
    add(
        &mut sim.world_mut().resource_mut::<SavedChores>().floors,
        cell,
        500,
    );
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::CleanChoreFirst {
            agent: person.index_u32(),
            key,
        });
    let mut started = false;
    let mut walking = false;
    let mut working = false;
    for _ in 0..1000 {
        sim.tick();
        let state = sim.world().resource::<SavedChores>();
        if let Some(task) = state.tasks.iter().find(|t| t.person == person.index_u32()) {
            started = true;
            walking |= sim.world().get::<terri_core::Path>(person).is_some();
            working |= task.remaining > 0;
        }
        let saved = sim.save_snapshot_v17();
        let mut loaded = Sim::new_from_shipped_lot();
        loaded
            .load_snapshot_v17(saved)
            .expect("floor walking and work must save at the transition boundary");
        assert_eq!(loaded.save_snapshot_v17(), sim.save_snapshot_v17());
        assert_eq!(loaded.world_hash(), sim.world_hash());
        if started && !state.tasks.iter().any(|t| t.person == person.index_u32()) {
            break;
        }
    }
    assert!(started && walking && working);
    assert_eq!(
        value(&sim.world().resource::<SavedChores>().floors, cell),
        0
    );
}

#[test]
fn mixed_dish_chore_and_ordinary_orders_restore_their_complete_queue_order() {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let saved = sim
        .save_snapshot_v17()
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy;
    let person = saved.world.entities.iter().find(|e| e.agent).unwrap().index;
    let counter = saved
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("counter"))
        .unwrap()
        .index;
    let queue = &mut sim.world_mut().resource_mut::<terri_core::CommandQueue>();
    queue.push(terri_core::SimCommand::CleanChore {
        agent: person,
        key: ChoreKey {
            kind: ChoreKind::Surfaces,
            target: counter,
        },
    });
    queue.push(terri_core::SimCommand::CleanDishes {
        agent: person,
        surface: counter,
        dishes: None,
    });
    queue.push(terri_core::SimCommand::UseObject {
        agent: person,
        object: 0,
        interaction: 0,
    });
    sim.flush_commands();
    let expected = sim.action_queue_of(person);
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v17(sim.save_snapshot_v17()).unwrap();
    assert_eq!(loaded.action_queue_of(person), expected);
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

#[test]
fn surface_and_bin_work_require_elapsed_work_and_keep_valid_interrupted_saves() {
    for (kind, object_id) in [
        (ChoreKind::Surfaces, "counter"),
        (ChoreKind::Bins, "trashcan"),
    ] {
        let mut sim = Sim::new_from_shipped_lot();
        ensure(sim.world_mut());
        let saved = sim
            .save_snapshot_v17()
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy;
        let person = saved.world.entities.iter().find(|e| e.agent).unwrap().index;
        let object = saved
            .world
            .entities
            .iter()
            .find(|e| e.smart_object.as_deref() == Some(object_id))
            .unwrap()
            .index;
        {
            let mut s = sim.world_mut().resource_mut::<SavedChores>();
            add(
                if kind == ChoreKind::Surfaces {
                    &mut s.surfaces
                } else {
                    &mut s.bins
                },
                object,
                500,
            );
        }
        sim.world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::CleanChoreFirst {
                agent: person,
                key: ChoreKey {
                    kind,
                    target: object,
                },
            });
        sim.tick();
        assert!(sim
            .world()
            .resource::<SavedChores>()
            .tasks
            .iter()
            .any(|t| t.person == person));
        let mut work_observed = false;
        let mut partial_fade = false;
        for _ in 0..1200 {
            sim.tick();
            let state = sim.world().resource::<SavedChores>();
            if let Some(task) = state.tasks.iter().find(|t| t.person == person) {
                work_observed |= task.remaining > 0;
                partial_fade |= kind == ChoreKind::Surfaces
                    && task.remaining > 0
                    && (1..500).contains(&value(&state.surfaces, object));
                let mut loaded = Sim::new_from_shipped_lot();
                loaded.load_snapshot_v17(sim.save_snapshot_v17()).unwrap();
                assert_eq!(loaded.world_hash(), sim.world_hash());
            } else {
                break;
            }
        }
        assert!(work_observed);
        assert!(kind != ChoreKind::Surfaces || partial_fade);
        let state = sim.world().resource::<SavedChores>();
        assert_eq!(
            value(
                if kind == ChoreKind::Surfaces {
                    &state.surfaces
                } else {
                    &state.bins
                },
                object
            ),
            0
        );
    }
}

#[test]
fn paused_cancel_releases_chore_work_without_deleting_unfinished_dirt() {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let saved = sim
        .save_snapshot_v17()
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy;
    let person = saved.world.entities.iter().find(|e| e.agent).unwrap().index;
    let counter = saved
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("counter"))
        .unwrap()
        .index;
    add(
        &mut sim.world_mut().resource_mut::<SavedChores>().surfaces,
        counter,
        500,
    );
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::CleanChoreFirst {
            agent: person,
            key: ChoreKey {
                kind: ChoreKind::Surfaces,
                target: counter,
            },
        });
    sim.tick();
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::CancelIntents { agent: person });
    sim.flush_commands();
    assert!(sim.world().resource::<SavedChores>().tasks.is_empty());
    assert!(value(&sim.world().resource::<SavedChores>().surfaces, counter) >= 500);
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v17(sim.save_snapshot_v17()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

#[test]
fn unused_tiles_remain_clean_and_profiles_round_trip_without_rerolling() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut().insert_resource(SavedChores::default());
    let width = sim.world().resource::<TileGrid>().width();
    let regions = crate::room_regions::RoomRegions::from_world(sim.world());
    let inside = (0..width * sim.world().resource::<TileGrid>().height())
        .find(|cell| {
            let tile = ((cell % width) as i32, (cell / width) as i32);
            regions.at(tile).is_some()
                && sim
                    .world()
                    .resource::<TileGrid>()
                    .is_walkable(tile.0, tile.1)
        })
        .unwrap() as u32;
    sim.world_mut().resource_mut::<SimClock>().tick = 20;
    tick(sim.world_mut());
    let state = sim.world().resource::<SavedChores>();
    assert_eq!(value(&state.floors, inside), 0);
    let (house_width, _) = sim.world().resource::<crate::Content>().0.lot.house;
    let yard = width as u32 + house_width + 1;
    assert_eq!(value(&state.floors, yard), 0);
    assert_eq!(state.profiles.len(), 3);
    let before = sim.world_hash();
    let saved = sim.save_snapshot_v17();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v17(saved).unwrap();
    assert_eq!(loaded.world_hash(), before);
    assert_eq!(loaded.world().resource::<SavedChores>(), state);
}

#[test]
fn chore_hash_observes_grime_and_independent_personality_values_at_the_same_tick() {
    let mut sim = Sim::new_from_shipped_lot();
    tick(sim.world_mut());
    let original = sim.world().resource::<SavedChores>().clone();
    let baseline = sim.world_hash();
    for state in [
        {
            let mut s = original.clone();
            s.floors.push((0, 42));
            s
        },
        {
            let mut s = original.clone();
            s.profiles[0].responsibility += 1;
            s
        },
        {
            let mut s = original.clone();
            s.profiles[0].preferences[0] += 1;
            s
        },
        {
            let mut s = original.clone();
            s.profiles[0].commitment += 1;
            s
        },
    ] {
        sim.world_mut().insert_resource(state);
        assert_ne!(sim.world_hash(), baseline);
        sim.world_mut().insert_resource(original.clone());
        assert_eq!(sim.world_hash(), baseline);
    }
}
