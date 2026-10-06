use super::*;
use crate::Sim;
use terri_core::{CommandQueue, Position, SimCommand, SmartObject};

fn fixture(kind: ChoreKind) -> (Sim, Entity, ChoreKey) {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = sim
        .world_mut()
        .query::<(Entity, &terri_core::Agent)>()
        .iter(sim.world())
        .next()
        .unwrap()
        .0;
    let name = if kind == ChoreKind::Bins {
        "trashcan"
    } else {
        "counter"
    };
    let object = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == name)
        .unwrap()
        .0;
    let key = ChoreKey {
        kind,
        target: object.index_u32(),
    };
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    state.board_enabled = false;
    add(
        if kind == ChoreKind::Bins {
            &mut state.bins
        } else {
            &mut state.surfaces
        },
        key.target,
        500,
    );
    assert!(work::start(sim.world_mut(), &mut state, person, key, true));
    sim.world_mut().insert_resource(state);
    (sim, person, key)
}

fn reload(sim: &Sim) {
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v5(sim.save_snapshot_v5())
        .expect("ordinary lifecycle state must reload");
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

#[test]
fn unsupported_dish_task_and_remote_object_contact_are_rejected_before_adoption() {
    let (sim, _, _) = fixture(ChoreKind::Surfaces);
    for dishes in [true, false] {
        let mut snapshot = sim.save_snapshot_v5();
        let task = &mut snapshot.chores.as_mut().unwrap().tasks[0];
        if dishes {
            task.key = ChoreKey {
                kind: ChoreKind::Dishes,
                target: 0,
            };
            task.cells = vec![0];
            task.endpoint = Some(20);
        } else {
            task.endpoint = Some(0);
        }
        let mut loaded = Sim::new_from_shipped_lot();
        assert!(loaded.load_snapshot_v5(snapshot).is_err());
    }
}

#[test]
fn suspended_bin_sale_preserves_waste_and_removes_invalid_work() {
    let (mut sim, person, key) = fixture(ChoreKind::Bins);
    sim.world_mut()
        .entity_mut(person)
        .insert(terri_core::AtWork {
            remaining_ticks: 100,
        });
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    work::advance(sim.world_mut(), &mut state);
    assert!(state.tasks[0].suspended);
    sim.world_mut().insert_resource(state);
    reload(&sim);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject { object: key.target });
    sim.flush_commands();
    assert!(
        crate::dining::entity(sim.world(), key.target).is_none(),
        "sale must occur"
    );
    prune(sim.world_mut());
    let state = sim.world().resource::<SavedChores>();
    assert_eq!(state.unbinned, 500);
    assert!(state.tasks.is_empty());
    reload(&sim);
}

#[test]
fn resumed_surface_work_recomputes_contact_after_actual_furniture_move() {
    let (mut sim, person, key) = fixture(ChoreKind::Surfaces);
    let original = sim.world().resource::<SavedChores>().tasks[0]
        .endpoint
        .unwrap();
    sim.world_mut()
        .entity_mut(person)
        .insert(terri_core::AtWork {
            remaining_ticks: 100,
        });
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    work::advance(sim.world_mut(), &mut state);
    sim.world_mut().insert_resource(state);
    let object = crate::dining::entity(sim.world(), key.target).unwrap();
    let old_pos = *sim.world().get::<Position>(object).unwrap();
    let facing = sim
        .world()
        .get::<terri_core::ObjectFacing>(object)
        .unwrap()
        .0;
    let grid = sim.world().resource::<terri_core::TileGrid>();
    let destination = (0..grid.height())
        .flat_map(|y| (0..grid.width()).map(move |x| (x, y)))
        .find(|(x, y)| {
            (*x as f32 - old_pos.x).abs() + (*y as f32 - old_pos.y).abs() > 4.0
                && crate::placement::validate_placement(
                    sim.world(),
                    key.target,
                    (*x as u32, *y as u32),
                    facing,
                )
                .is_ok()
        })
        .unwrap();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::PlaceObject {
            object: key.target,
            x: destination.0 as u32,
            y: destination.1 as u32,
            facing,
        });
    sim.flush_commands();
    assert_ne!(*sim.world().get::<Position>(object).unwrap(), old_pos);
    reload(&sim);
    sim.world_mut()
        .entity_mut(person)
        .remove::<terri_core::AtWork>();
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    work::advance(sim.world_mut(), &mut state);
    assert_ne!(state.tasks[0].endpoint.unwrap(), original);
    assert_eq!(value(&state.surfaces, key.target), 500);
    sim.world_mut().insert_resource(state);
    reload(&sim);
}

#[test]
fn cancelled_or_dead_dish_actors_leave_no_start_records() {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = sim
        .world_mut()
        .query::<(Entity, &terri_core::Agent)>()
        .iter(sim.world())
        .next()
        .unwrap()
        .0;
    sim.world_mut()
        .resource_mut::<SavedChores>()
        .dish_started
        .push((person.index_u32(), 0));
    crate::domestic::abandon(sim.world_mut(), person);
    assert!(sim
        .world()
        .resource::<SavedChores>()
        .dish_started
        .is_empty());
    sim.world_mut()
        .resource_mut::<SavedChores>()
        .dish_started
        .push((person.index_u32(), 0));
    sim.world_mut().despawn(person);
    prune(sim.world_mut());
    assert!(sim
        .world()
        .resource::<SavedChores>()
        .dish_started
        .is_empty());
    reload(&sim);
}

#[test]
fn unreachable_contact_cancels_only_owned_work_and_preserves_dirt() {
    let (mut sim, person, key) = fixture(ChoreKind::Surfaces);
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    work::advance(sim.world_mut(), &mut state);
    assert!(sim.world().get::<terri_core::Path>(person).is_some());
    let endpoint = state.tasks[0].endpoint.unwrap();
    let grid = sim.world().resource::<terri_core::TileGrid>().clone();
    let width = grid.width() as u32;
    sim.world_mut()
        .resource_mut::<terri_core::TileGrid>()
        .set_blocked(
            (endpoint % width) as usize,
            (endpoint / width) as usize,
            true,
        );
    sim.world_mut().insert_resource(state);
    prune(sim.world_mut());
    assert!(sim.world().resource::<SavedChores>().tasks.is_empty());
    assert!(sim.world().get::<ChoreWork>(person).is_none());
    assert!(sim.world().get::<terri_core::Path>(person).is_none());
    assert_eq!(
        value(&sim.world().resource::<SavedChores>().surfaces, key.target),
        500
    );
    sim.world_mut().insert_resource(grid);
    reload(&sim);
}

#[test]
fn commute_interruption_keeps_the_career_path_when_chore_is_suspended_or_cancelled() {
    let (mut sim, person, _) = fixture(ChoreKind::Surfaces);
    let path = terri_core::Path {
        steps: vec![(7, 2), (7, 3)],
        cursor: 0,
    };
    sim.world_mut()
        .entity_mut(person)
        .insert((terri_core::Commuting::Outbound, path.clone()));
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    work::advance(sim.world_mut(), &mut state);
    assert!(state.tasks[0].suspended);
    assert_eq!(
        sim.world()
            .get::<terri_core::Path>(person)
            .map(|p| (p.steps.as_slice(), p.cursor)),
        Some((path.steps.as_slice(), path.cursor))
    );
    // Cancellation can also run before the next chore tick removes its marker.
    sim.world_mut().entity_mut(person).insert(ChoreWork);
    sim.world_mut().insert_resource(state);
    cancel(sim.world_mut(), person);
    assert_eq!(
        sim.world()
            .get::<terri_core::Path>(person)
            .map(|p| (p.steps.as_slice(), p.cursor)),
        Some((path.steps.as_slice(), path.cursor))
    );
}

#[test]
fn real_dish_washing_crosses_midnight_and_reloads_without_double_settlement() {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    board::reconcile(sim.world(), &mut state);
    let key = ChoreKey {
        kind: ChoreKind::Dishes,
        target: 0,
    };
    let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    episode.needed = true;
    episode.decision = Some(true);
    episode.outcome = DutyOutcome::WillDo;
    let episode_id = episode.id;
    let owner = episode.owner;
    let people: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &terri_core::SimId)>()
        .iter(sim.world())
        .map(|(e, id)| (e, id.0))
        .collect();
    let person = people.iter().find(|(_, id)| *id == owner).unwrap().0;
    for (other, _) in &people {
        if *other != person {
            sim.world_mut()
                .entity_mut(*other)
                .insert(terri_core::AtWork {
                    remaining_ticks: 10000,
                });
        }
    }
    let counter = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "counter")
        .unwrap()
        .0;
    sim.world_mut()
        .insert_resource(terri_core::save::SavedDomestic {
            next_dish: 1,
            cleanliness: people.iter().map(|(e, _)| (e.index_u32(), 0.0)).collect(),
            dishes: vec![terri_core::save::SavedDishes {
                id: 0,
                surface: counter.index_u32(),
                owner,
                units: 1,
            }],
            ..Default::default()
        });
    let day_ticks = sim.world().resource::<crate::Content>().0.tuning.day_ticks;
    sim.world_mut().resource_mut::<terri_core::SimClock>().tick = u64::from(day_ticks) - 1;
    state.last_age_tick = u64::from(day_ticks) - 1;
    assert!(work::start(sim.world_mut(), &mut state, person, key, true));
    assert_eq!(state.dish_started, vec![(person.index_u32(), 0)]);
    sim.world_mut().insert_resource(state);
    let mut finished = false;
    for _ in 0..1000 {
        sim.tick();
        reload(&sim);
        let episode = sim
            .world()
            .resource::<SavedChores>()
            .episodes
            .iter()
            .find(|e| e.id == episode_id)
            .unwrap();
        assert_ne!(episode.outcome, DutyOutcome::Missed);
        if episode.completed_at.is_some() {
            assert_eq!(episode.performer, Some(owner));
            finished = true;
            break;
        }
        assert!(!episode.settled);
    }
    assert!(finished, "actual collection and washing must complete");
}

#[test]
fn suspended_floor_plan_is_cancelled_when_room_partition_changes_its_cells() {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = sim
        .world_mut()
        .query::<(Entity, &terri_core::Agent)>()
        .iter(sim.world())
        .next()
        .unwrap()
        .0;
    // Split the kitchen at x=4 while preserving the western room identity.
    let width = sim.world().resource::<terri_core::TileGrid>().width() as u32;
    let key = floor_at(sim.world(), 1, 2).unwrap_or_else(|| ChoreKey {
        kind: ChoreKind::Floors,
        target: crate::room_regions::RoomRegions::from_world(sim.world())
            .at((1, 2))
            .unwrap(),
    });
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    state.board_enabled = true;
    board::reconcile(sim.world(), &mut state);
    let owner = sim.world().get::<terri_core::SimId>(person).unwrap().0;
    state
        .assignments
        .iter_mut()
        .find(|a| a.key == key)
        .unwrap()
        .owner = owner;
    let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    episode.owner = owner;
    episode.needed = true;
    episode.decision = Some(true);
    episode.outcome = DutyOutcome::WillDo;
    for cell in [2 * width + 1, 2 * width + 5] {
        add(&mut state.floors, cell, 500);
    }
    assert!(work::start(sim.world_mut(), &mut state, person, key, true));
    sim.world_mut()
        .entity_mut(person)
        .insert(terri_core::AtWork {
            remaining_ticks: 100,
        });
    work::advance(sim.world_mut(), &mut state);
    assert!(state.tasks[0].suspended);
    sim.world_mut().insert_resource(state);
    for y in 0..6 {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetWallEdge {
                axis: terri_core::layout::EdgeAxis::Vertical,
                x: 4,
                y,
                state: if y == 2 {
                    terri_core::layout::WallState::Doorway
                } else {
                    terri_core::layout::WallState::Wall
                },
            });
    }
    sim.flush_commands();
    assert_ne!(
        crate::room_regions::RoomRegions::from_world(sim.world()).at((1, 2)),
        crate::room_regions::RoomRegions::from_world(sim.world()).at((5, 2)),
        "actual edit must split rooms"
    );
    prune(sim.world_mut());
    assert!(sim.world().resource::<SavedChores>().tasks.is_empty());
    reload(&sim);
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    assert!(
        state
            .episodes
            .iter()
            .find(|e| e.key == key && e.day == 0)
            .unwrap()
            .unavailable
    );
    let day = sim.world().resource::<crate::Content>().0.tuning.day_ticks;
    sim.world_mut().resource_mut::<terri_core::SimClock>().tick = u64::from(day);
    board::tick(sim.world_mut(), &mut state);
    assert_eq!(
        state
            .episodes
            .iter()
            .find(|e| e.key == key && e.day == 0)
            .unwrap()
            .outcome,
        DutyOutcome::Unavailable
    );
}
