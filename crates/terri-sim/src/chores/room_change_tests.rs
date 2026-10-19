use super::*;
use crate::{rooms::*, Sim};
use terri_core::{Position, TileGrid};

fn active_object_work(kind: ChoreKind) -> (Sim, Entity, ChoreKey) {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = sim
        .world_mut()
        .query_filtered::<Entity, With<terri_core::Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    let name = if kind == ChoreKind::Bins {
        "trashcan"
    } else {
        "counter"
    };
    let object = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| {
            sim.world()
                .resource::<crate::Content>()
                .0
                .object(object.0)
                .id
                == name
        })
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
        800,
    );
    assert!(work::start(sim.world_mut(), &mut state, person, key, true));
    let cell = state.tasks[0].endpoint.unwrap();
    let width = sim.world().resource::<TileGrid>().width() as u32;
    sim.world_mut().entity_mut(person).insert(Position {
        x: (cell % width) as f32,
        y: (cell / width) as f32,
    });
    work::advance(sim.world_mut(), &mut state);
    assert!(state.tasks[0].remaining > 0);
    if kind == ChoreKind::Surfaces {
        assert!(state.tasks[0].completed_units > 0);
    }
    sim.world_mut().insert_resource(state);
    (sim, person, key)
}

fn resolve(sim: &Sim, before: &RoomChangeContext, rename: bool) -> ResolvedRooms {
    let topology = RoomTopology::from_world(sim.world()).unwrap();
    let proposal = match_rooms(&before.map, &topology, (0, 0));
    let mut choices = RoomChoices::default();
    if rename {
        choices
            .names
            .insert(topology.components[0].anchor, "A renamed room".into());
    }
    resolve_rooms(
        &proposal,
        &choices,
        sim.world().resource::<terri_core::rooms::SavedRooms>(),
    )
    .unwrap()
}

#[test]
fn review_explicit_surface_work_survives_rename_and_historical_migration_exactly() {
    let (mut sim, person, _) = active_object_work(ChoreKind::Surfaces);
    let original = sim.world().resource::<SavedChores>().clone();
    let grime = sim
        .world()
        .resource::<terri_core::grime::SavedGrime>()
        .clone();
    let historical = sim.try_save_snapshot_v14().unwrap();
    let before = RoomChangeContext::capture(sim.world()).unwrap();
    let resolved = resolve(&sim, &before, true);
    let report = reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
    assert!(report.replanned_people.is_empty());
    assert!(report.unavailable_people.is_empty());
    assert_eq!(sim.world().resource::<SavedChores>(), &original);
    assert_eq!(
        sim.world().resource::<terri_core::grime::SavedGrime>(),
        &grime
    );
    assert!(sim.world().get::<ChoreWork>(person).is_some());
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v14(historical).unwrap();
    assert_eq!(loaded.world().resource::<SavedChores>(), &original);
    assert_eq!(
        loaded.world().resource::<terri_core::grime::SavedGrime>(),
        &grime
    );
}

#[test]
fn review_moved_bin_replans_contact_without_erasing_work_or_unrelated_path() {
    let (mut sim, person, key) = active_object_work(ChoreKind::Bins);
    sim.world_mut()
        .entity_mut(person)
        .insert(terri_core::AtWork {
            remaining_ticks: 100,
        });
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    work::advance(sim.world_mut(), &mut state);
    assert!(state.tasks[0].suspended);
    let original = state.tasks[0].clone();
    let dirt = state.bins.clone();
    sim.world_mut().insert_resource(state);
    let position = *sim.world().get::<Position>(person).unwrap();
    let steps = sim
        .world()
        .resource::<TileGrid>()
        .find_path(
            (position.x.round() as i32, position.y.round() as i32),
            (1, 1),
        )
        .unwrap();
    assert!(!steps.is_empty());
    let unrelated = terri_core::Path { steps, cursor: 0 };
    sim.world_mut().entity_mut(person).insert(unrelated.clone());
    let before = RoomChangeContext::capture(sim.world()).unwrap();
    let object = crate::dining::entity(sim.world(), key.target).unwrap();
    let old = *sim.world().get::<Position>(object).unwrap();
    let facing = sim
        .world()
        .get::<terri_core::ObjectFacing>(object)
        .unwrap()
        .0;
    let destination = (0..16)
        .flat_map(|y| (0..20).map(move |x| (x, y)))
        .find(|&(x, y)| {
            (x as f32 - old.x).abs() + (y as f32 - old.y).abs() > 4.0
                && crate::placement::validate_placement(sim.world(), key.target, (x, y), facing)
                    .is_ok()
        })
        .unwrap();
    crate::placement::commit(sim.world_mut(), key.target, destination, facing);
    assert!(!work::contact_valid(
        sim.world(),
        key,
        original.endpoint.unwrap()
    ));
    let resolved = resolve(&sim, &before, false);
    let report = reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
    let state = sim.world().resource::<SavedChores>();
    let task = state
        .tasks
        .iter()
        .find(|task| task.person == person.index_u32())
        .expect("the moved bin still has reachable work");
    assert_eq!(task.remaining, original.remaining);
    assert_eq!(task.completed_units, original.completed_units);
    assert_eq!(state.bins, dirt);
    assert_ne!(task.endpoint, original.endpoint);
    assert!(work::contact_valid(
        sim.world(),
        key,
        task.endpoint.unwrap()
    ));
    let retained = sim.world().get::<terri_core::Path>(person).unwrap();
    assert_eq!(
        (&retained.steps, retained.cursor),
        (&unrelated.steps, unrelated.cursor)
    );
    assert!(report.replanned_people.contains(&person.index_u32()));
    assert!(report.unavailable_people.is_empty());
    assert_eq!(state.disposed, 0);
}

fn architecture(sim: &mut Sim, dividers: &[u32], open_east: bool) {
    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
    let width = sim.world().resource::<TileGrid>().width() as u32;
    let height = sim.world().resource::<TileGrid>().height() as u32;
    let mut edges: Vec<_> = (0..width)
        .flat_map(|x| {
            [0, height].map(move |y| WallEdge {
                axis: EdgeAxis::Horizontal,
                x,
                y,
                doorway: false,
            })
        })
        .chain((0..height).flat_map(|y| {
            [0, width].map(move |x| WallEdge {
                axis: EdgeAxis::Vertical,
                x,
                y,
                doorway: false,
            })
        }))
        .collect();
    if open_east {
        edges.retain(|edge| !(edge.axis == EdgeAxis::Vertical && edge.x == width));
    }
    for &x in dividers {
        for y in 0..height {
            edges.push(WallEdge {
                axis: EdgeAxis::Vertical,
                x,
                y,
                doorway: y == 2,
            });
        }
    }
    edges.sort_by_key(|edge| (edge.axis as u8, edge.x, edge.y));
    let mut grid = TileGrid::new(width as usize, height as usize);
    for edge in &edges {
        let [from, to] = edge.cells();
        if !edge.doorway
            && from.0 >= 0
            && from.1 >= 0
            && to.0 < width as i32
            && to.1 < height as i32
        {
            grid.set_edge_blocked(from, to, true);
        }
    }
    if let Some(mut query) = sim.world().try_query::<(
        &terri_core::SmartObject,
        &Position,
        Option<&terri_core::ObjectFacing>,
    )>() {
        for (object, position, facing) in query.iter(sim.world()) {
            let size = crate::placed_footprint(
                sim.world().resource::<crate::Content>().0,
                object.0,
                facing,
            );
            for y in position.y as u32..position.y as u32 + size.depth {
                for x in position.x as u32..position.x as u32 + size.width {
                    assert!(grid.is_walkable(x as i32, y as i32));
                    grid.set_blocked(x as usize, y as usize, true);
                }
            }
        }
    }
    sim.world_mut().insert_resource(grid);
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges });
}

fn duty_fixture(counts: &[usize]) -> Sim {
    let mut sim = Sim::new_with_lot(counts.len() * 4, 4);
    let dividers: Vec<_> = (1..counts.len() as u32).map(|index| index * 4).collect();
    architecture(&mut sim, &dividers, false);
    for index in 0..3 {
        let id = sim
            .world_mut()
            .resource_mut::<terri_core::SimIdAllocator>()
            .issue();
        sim.world_mut().spawn((
            terri_core::Agent,
            id,
            terri_core::SimName(format!("Person {index}")),
            terri_core::Needs::all_at(60.0),
            Position {
                x: (index * 2 % (counts.len() * 4)) as f32,
                y: 3.0,
            },
            terri_core::SelfPreservation(50),
            terri_core::Satisfaction::default(),
        ));
    }
    let counter = sim
        .world()
        .resource::<crate::Content>()
        .0
        .find("counter")
        .unwrap();
    for (room, &count) in counts.iter().enumerate() {
        for index in 0..count {
            sim.spawn_object(
                Position {
                    x: (room * 4 + index) as f32,
                    y: 0.0,
                },
                counter,
            );
        }
    }
    architecture(&mut sim, &dividers, false);
    crate::rooms::initialize(sim.world_mut()).unwrap();
    ensure(sim.world_mut());
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    board::reconcile(sim.world(), &mut state);
    for assignment in &mut state.assignments {
        if assignment.key.kind == ChoreKind::Floors || assignment.key.kind.grouped() {
            assignment.owner = (assignment.key.target - 1) % 3;
        }
    }
    for episode in &mut state.episodes {
        episode.owner = state
            .assignments
            .iter()
            .find(|assignment| assignment.key == episode.key)
            .unwrap()
            .owner;
        if episode.key.kind == ChoreKind::Floors || episode.key.kind.grouped() {
            episode.decision = Some(episode.key.target % 2 == 1);
            episode.outcome = if episode.decision == Some(true) {
                DutyOutcome::WillDo
            } else {
                DutyOutcome::Skipped
            };
            episode.needed = true;
        }
    }
    for room in 0..counts.len() {
        add(
            &mut state.floors,
            (2 * counts.len() * 4 + room * 4 + 1) as u32,
            1000,
        );
    }
    for key in keys(sim.world())
        .into_iter()
        .filter(|key| key.kind.grouped())
    {
        for object in groups::members(sim.world(), key) {
            add(&mut state.surfaces, object, 1000);
        }
    }
    sim.world_mut().insert_resource(state);
    sim
}

fn resolve_with_identity(sim: &Sim, before: &RoomChangeContext, id: u32) -> ResolvedRooms {
    let topology = RoomTopology::from_world(sim.world()).unwrap();
    let proposal = match_rooms(&before.map, &topology, (0, 0));
    let mut choices = RoomChoices::default();
    choices.inheritance.insert(
        topology.components[0].anchor,
        Some(terri_core::rooms::RoomId::new(id).unwrap()),
    );
    resolve_rooms(
        &proposal,
        &choices,
        sim.world().resource::<terri_core::rooms::SavedRooms>(),
    )
    .unwrap()
}

#[test]
fn review_floor_split_preserves_owner_and_decision_and_new_targets_obey_auto_assignment() {
    for automatic in [false, true] {
        let mut sim = duty_fixture(&[0]);
        sim.world_mut().resource_mut::<SavedChores>().board_enabled = automatic;
        let before = RoomChangeContext::capture(sim.world()).unwrap();
        let original = sim.world().resource::<SavedChores>().clone();
        let episode = original
            .episodes
            .iter()
            .find(|episode| episode.key.kind == ChoreKind::Floors)
            .unwrap();
        let rng = sim.world().resource::<terri_core::SimRng>().clone();
        architecture(&mut sim, &[2], false);
        let resolved = resolve(&sim, &before, false);
        let new = resolved.new_ids[0].get();
        reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
        let state = sim.world().resource::<SavedChores>();
        assert_eq!(
            state.episodes.iter().find(|row| row.id == episode.id),
            Some(episode)
        );
        assert_eq!(
            state
                .assignments
                .iter()
                .find(|row| row.key == episode.key)
                .unwrap()
                .owner,
            0
        );
        assert_eq!(
            state.assignments.iter().any(|row| row.key
                == ChoreKey {
                    kind: ChoreKind::Floors,
                    target: new
                }),
            automatic
        );
        if !automatic {
            assert_eq!(state.rng, original.rng);
        }
        assert_eq!(sim.world().resource::<terri_core::SimRng>(), &rng);
    }
}

#[test]
fn review_floor_merge_keeps_selected_owner_and_retires_without_credit_or_neglect() {
    let mut sim = duty_fixture(&[0, 0]);
    sim.world_mut().resource_mut::<SavedChores>().board_enabled = false;
    let before = RoomChangeContext::capture(sim.world()).unwrap();
    let original = sim.world().resource::<SavedChores>().clone();
    let survivor = original
        .episodes
        .iter()
        .find(|row| {
            row.key
                == ChoreKey {
                    kind: ChoreKind::Floors,
                    target: 2,
                }
        })
        .unwrap();
    architecture(&mut sim, &[], false);
    let resolved = resolve_with_identity(&sim, &before, 2);
    let report = reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
    let state = sim.world().resource::<SavedChores>();
    assert_eq!(
        state
            .assignments
            .iter()
            .find(|row| row.key == survivor.key)
            .unwrap()
            .owner,
        1
    );
    assert_eq!(
        state.episodes.iter().find(|row| row.id == survivor.id),
        Some(survivor)
    );
    let retired = state
        .episodes
        .iter()
        .find(|row| {
            row.key
                == ChoreKey {
                    kind: ChoreKind::Floors,
                    target: 1,
                }
        })
        .unwrap();
    assert!(retired.settled && retired.unavailable);
    assert_eq!(retired.outcome, DutyOutcome::Unavailable);
    assert_eq!(retired.completed_at, None);
    assert_eq!(state.profiles, original.profiles);
    assert_eq!(state.feelings, original.feelings);
    assert_eq!(state.floors, original.floors);
    assert_eq!(state.rng, original.rng);
    assert!(report
        .duties
        .iter()
        .any(|row| row.key == retired.key && row.kind == DutyChangeKind::Retired));
    assert!(sim
        .world()
        .resource::<crate::relationship_effects::RelationshipDiagnostics>()
        .effects
        .is_empty());
}

#[test]
fn review_combined_groups_prefer_existing_survivor_owner_then_contribution_then_old_id() {
    for (counts, remove_survivor_owner, winning_room) in [
        ([3, 2, 1], false, 3),
        ([3, 1, 0], false, 1),
        ([2, 2, 0], false, 1),
        ([1, 3, 1], true, 2),
    ] {
        let mut sim = duty_fixture(&counts);
        let key = ChoreKey {
            kind: ChoreKind::CounterSurfaces,
            target: 3,
        };
        {
            let mut state = sim.world_mut().resource_mut::<SavedChores>();
            state.board_enabled = false;
            if remove_survivor_owner {
                state.assignments.retain(|row| row.key != key);
                for row in state.episodes.iter_mut().filter(|row| row.key == key) {
                    row.settled = true;
                    row.unavailable = true;
                    row.outcome = DutyOutcome::Unavailable;
                }
            }
        }
        let actor = crate::dining::entity(sim.world(), 0).unwrap();
        if remove_survivor_owner {
            let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
            assert!(work::start(sim.world_mut(), &mut state, actor, key, true));
            work::advance(sim.world_mut(), &mut state);
            let cell = state.tasks[0].endpoint.unwrap();
            let width = sim.world().resource::<TileGrid>().width() as u32;
            sim.world_mut()
                .entity_mut(actor)
                .remove::<terri_core::Path>()
                .insert(Position {
                    x: (cell % width) as f32,
                    y: (cell / width) as f32,
                });
            work::advance(sim.world_mut(), &mut state);
            assert!(state.tasks[0].completed_units > 0);
            sim.world_mut().insert_resource(state);
        }
        let before = RoomChangeContext::capture(sim.world()).unwrap();
        let original = sim.world().resource::<SavedChores>().clone();
        let inherited = original
            .episodes
            .iter()
            .find(|row| {
                row.key
                    == ChoreKey {
                        kind: ChoreKind::CounterSurfaces,
                        target: winning_room,
                    }
            })
            .unwrap();
        architecture(&mut sim, &[], false);
        let resolved = resolve_with_identity(&sim, &before, 3);
        reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
        let state = sim.world().resource::<SavedChores>();
        assert_eq!(
            state
                .assignments
                .iter()
                .find(|row| row.key == key)
                .map(|row| row.owner),
            Some(winning_room - 1),
            "counts={counts:?} unassigned survivor={remove_survivor_owner}"
        );
        let episode = state
            .episodes
            .iter()
            .find(|row| row.id == inherited.id)
            .unwrap();
        assert_eq!(episode.key, key);
        assert_eq!(episode.decision, inherited.decision);
        assert_eq!(episode.outcome, inherited.outcome);
        assert_eq!(state.rng, original.rng);
        assert_eq!(state.surfaces, original.surfaces);
        assert_eq!(state.profiles, original.profiles);
        if remove_survivor_owner {
            let task = state
                .tasks
                .iter()
                .find(|task| task.person == actor.index_u32())
                .expect("valid work in the previously unassigned group survives");
            let old_task = &original.tasks[0];
            assert_eq!(
                (task.remaining, task.completed_units, task.endpoint),
                (
                    old_task.remaining,
                    old_task.completed_units,
                    old_task.endpoint
                )
            );
            let inherited_id = inherited.id;
            let old_history = original
                .episodes
                .iter()
                .find(|row| row.key == key)
                .unwrap()
                .clone();
            let mut movement = bevy_ecs::schedule::Schedule::default();
            use bevy_ecs::schedule::IntoScheduleConfigs;
            movement.add_systems(
                (
                    crate::systems::interpersonal::prepare,
                    crate::systems::movement::follow_path,
                    crate::systems::interpersonal::apply,
                )
                    .chain(),
            );
            let mut finished = false;
            for _ in 0..400 {
                sim.world_mut().resource_mut::<terri_core::SimClock>().tick += 1;
                movement.run(sim.world_mut());
                let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
                work::advance(sim.world_mut(), &mut state);
                finished = state.tasks.is_empty();
                sim.world_mut().insert_resource(state);
                if finished {
                    break;
                }
            }
            assert!(finished);
            let state = sim.world().resource::<SavedChores>();
            let completed = state
                .episodes
                .iter()
                .find(|row| row.id == inherited_id)
                .unwrap();
            assert!(
                completed.completed_at.is_some(),
                "retired history must not hide the live duty's completion"
            );
            assert_eq!(completed.performer, Some(0));
            assert_eq!(
                state.episodes.iter().find(|row| row.id == old_history.id),
                Some(&old_history)
            );
        }
    }
}

#[test]
fn review_floor_replanning_keeps_nonzero_cleaned_units_and_unrelated_activity_path() {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = sim
        .world_mut()
        .query_filtered::<Entity, With<terri_core::Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    sim.world_mut()
        .entity_mut(person)
        .insert(Position { x: 1.0, y: 2.0 });
    let width = sim.world().resource::<TileGrid>().width() as u32;
    let key = ChoreKey {
        kind: ChoreKind::Floors,
        target: sim
            .world()
            .resource::<RoomMap>()
            .selection_at((1, 2))
            .unwrap()
            .key(),
    };
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    state.board_enabled = false;
    add(&mut state.floors, 2 * width + 1, 600);
    add(&mut state.floors, 2 * width + 5, 600);
    assert!(work::start(sim.world_mut(), &mut state, person, key, true));
    for _ in 0..5 {
        work::advance(sim.world_mut(), &mut state);
    }
    assert!(state.tasks[0].completed_units > 0);
    let units = state.tasks[0].completed_units;
    let dirt = state.floors.clone();
    sim.world_mut()
        .entity_mut(person)
        .insert(terri_core::AtWork {
            remaining_ticks: 100,
        });
    work::advance(sim.world_mut(), &mut state);
    assert!(state.tasks[0].suspended);
    sim.world_mut().insert_resource(state);
    let steps = (0..6)
        .flat_map(|y| (0..4).map(move |x| (x, y)))
        .find_map(|tile| {
            sim.world()
                .resource::<TileGrid>()
                .find_path((1, 2), tile)
                .filter(|path| !path.is_empty())
        })
        .unwrap();
    let unrelated = terri_core::Path { steps, cursor: 0 };
    sim.world_mut().entity_mut(person).insert(unrelated.clone());
    let before = RoomChangeContext::capture(sim.world()).unwrap();
    for y in 0..6 {
        crate::placement::walls::commit(
            sim.world_mut(),
            crate::placement::walls::WallEdit {
                axis: terri_core::layout::EdgeAxis::Vertical,
                x: 4,
                y,
                state: if y == 2 {
                    terri_core::layout::WallState::Doorway
                } else {
                    terri_core::layout::WallState::Wall
                },
            },
        );
    }
    let resolved = resolve(&sim, &before, false);
    let report = reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
    let state = sim.world().resource::<SavedChores>();
    let task = state
        .tasks
        .iter()
        .find(|task| task.person == person.index_u32())
        .unwrap();
    assert_eq!(task.completed_units, units);
    assert_eq!(state.floors, dirt);
    assert_eq!(task.cells, vec![2 * width + 1]);
    assert!(task.suspended);
    let path = sim.world().get::<terri_core::Path>(person).unwrap();
    assert_eq!(
        (&path.steps, path.cursor),
        (&unrelated.steps, unrelated.cursor)
    );
    assert!(report.replanned_people.contains(&person.index_u32()));
    assert!(report.unavailable_people.is_empty());
    assert!(sim
        .world()
        .resource::<crate::relationship_effects::RelationshipDiagnostics>()
        .effects
        .is_empty());
}

#[test]
fn review_outdoor_work_finishes_reachable_patches_and_marks_inaccessible_remainder_unavailable() {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = sim
        .world_mut()
        .query_filtered::<Entity, With<terri_core::Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    sim.world_mut()
        .entity_mut(person)
        .insert(Position { x: 17.0, y: 13.0 });
    let counter = sim
        .world()
        .resource::<crate::Content>()
        .0
        .find("counter")
        .unwrap();
    for (x, y) in [(16, 0), (18, 0), (17, 1)] {
        let object = sim.spawn_object(
            Position {
                x: x as f32,
                y: y as f32,
            },
            counter,
        );
        let size = crate::placed_footprint(
            sim.world().resource::<crate::Content>().0,
            counter,
            sim.world().get::<terri_core::ObjectFacing>(object),
        );
        assert_eq!((size.width, size.depth), (1, 1));
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(x, y, true);
    }
    let mut floors = terri_core::layout::SavedFloors::default();
    for (x, y) in [(17, 0), (17, 13), (18, 13), (17, 15)] {
        floors.set(x, y, 4);
    }
    sim.world_mut().insert_resource(floors);
    let width = sim.world().resource::<TileGrid>().width() as u32;
    let reachable = [13 * width + 17, 13 * width + 18, 15 * width + 17];
    let unreachable = 17;
    let grass = 14 * width + 17;
    assert!(sim
        .world()
        .resource::<TileGrid>()
        .find_path((17, 13), (17, 0))
        .is_none());
    let key = ChoreKey {
        kind: ChoreKind::Floors,
        target: 0,
    };
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    state.board_enabled = false;
    for cell in reachable {
        add(&mut state.floors, cell, 500);
    }
    add(&mut state.floors, unreachable, 900);
    add(&mut state.floors, grass, 777);
    let profiles = state.profiles.clone();
    state.episodes.push(ChoreEpisode {
        id: 0,
        key,
        owner: 0,
        day: 0,
        decision: Some(true),
        outcome: DutyOutcome::WillDo,
        performer: None,
        completed_at: None,
        settled: false,
        needed: true,
        unavailable: false,
    });
    state.next_episode = 1;
    assert!(work::start(sim.world_mut(), &mut state, person, key, true));
    sim.world_mut().insert_resource(state);
    let mut movement = bevy_ecs::schedule::Schedule::default();
    use bevy_ecs::schedule::IntoScheduleConfigs;
    movement.add_systems(
        (
            crate::systems::interpersonal::prepare,
            crate::systems::movement::follow_path,
            crate::systems::interpersonal::apply,
        )
            .chain(),
    );
    let mut maximum_cleaned = 0;
    let mut generated = 0;
    let mut finished = false;
    for _ in 0..300 {
        sim.world_mut().resource_mut::<terri_core::SimClock>().tick += 1;
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        work::advance(sim.world_mut(), &mut state);
        for task in &state.tasks {
            maximum_cleaned = maximum_cleaned.max(task.completed_units);
        }
        finished = state.tasks.is_empty();
        let total_before: u32 = state.floors.iter().map(|row| u32::from(row.1)).sum();
        sim.world_mut().insert_resource(state);
        if finished {
            break;
        }
        movement.run(sim.world_mut());
        let total_after: u32 = sim
            .world()
            .resource::<SavedChores>()
            .floors
            .iter()
            .map(|row| u32::from(row.1))
            .sum();
        generated += total_after - total_before;
        let snapshot = sim.save_snapshot_v16();
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v16(snapshot.clone()).unwrap();
        assert_eq!(restored.save_snapshot_v16(), snapshot);
    }
    assert!(finished, "unreachable paving must not cause a retry loop");
    let state = sim.world().resource::<SavedChores>();
    for cell in reachable {
        assert_eq!(value(&state.floors, cell), 0);
    }
    assert_eq!(value(&state.floors, unreachable), 900);
    assert_eq!(value(&state.floors, grass), 777);
    assert_eq!(maximum_cleaned, 1500 + generated);
    assert_eq!(state.profiles, profiles);
    assert!(state.episodes[0].unavailable);
    assert_eq!(state.episodes[0].completed_at, None);
    assert_eq!(state.episodes[0].performer, None);
    assert!(sim.world().get::<ChoreWork>(person).is_none());
}

#[test]
fn review_group_split_keeps_one_owner_and_decision_in_the_selected_surviving_room() {
    for automatic in [false, true] {
        for inherit_right in [false, true] {
            let mut sim = duty_fixture(&[3]);
            sim.world_mut().resource_mut::<SavedChores>().board_enabled = automatic;
            let original = sim.world().resource::<SavedChores>().clone();
            let old_key = ChoreKey {
                kind: ChoreKind::CounterSurfaces,
                target: 1,
            };
            let episode = original
                .episodes
                .iter()
                .find(|row| row.key == old_key)
                .unwrap();
            let before = RoomChangeContext::capture(sim.world()).unwrap();
            architecture(&mut sim, &[2], false);
            let topology = RoomTopology::from_world(sim.world()).unwrap();
            let proposal = match_rooms(&before.map, &topology, (0, 0));
            let mut choices = RoomChoices::default();
            if inherit_right {
                choices
                    .inheritance
                    .insert((2, 0), Some(terri_core::rooms::RoomId::new(1).unwrap()));
            }
            let resolved = resolve_rooms(
                &proposal,
                &choices,
                sim.world().resource::<terri_core::rooms::SavedRooms>(),
            )
            .unwrap();
            let fresh = resolved.new_ids[0].get();
            reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
            let state = sim.world().resource::<SavedChores>();
            assert_eq!(
                state
                    .assignments
                    .iter()
                    .find(|row| row.key == old_key)
                    .unwrap()
                    .owner,
                0
            );
            assert_eq!(
                state.episodes.iter().find(|row| row.id == episode.id),
                Some(episode)
            );
            assert_eq!(
                state.assignments.iter().any(|row| row.key
                    == ChoreKey {
                        kind: ChoreKind::CounterSurfaces,
                        target: fresh
                    }),
                automatic
            );
            assert_eq!(
                groups::members(sim.world(), old_key).len(),
                if inherit_right { 1 } else { 2 }
            );
            if !automatic {
                assert_eq!(state.rng, original.rng);
            }
        }
    }
}

#[test]
fn review_continuing_visit_memory_survives_split_and_reload_until_actual_crossing() {
    use terri_core::save::{
        SavedCleanupOpportunity, SavedDining, SavedDishes, SavedDomestic, SavedRoomVisit,
    };
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    sim.world_mut().resource_mut::<SavedChores>().board_enabled = false;
    let people: Vec<_> = sim
        .world_mut()
        .query_filtered::<Entity, With<terri_core::Agent>>()
        .iter(sim.world())
        .collect();
    let person = *people
        .iter()
        .find(|&&actor| sim.world().get::<terri_core::SimId>(actor) == Some(&terri_core::SimId(0)))
        .unwrap();
    let pack = sim.world().resource::<crate::Content>().0;
    let bike = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| pack.object(object.0).id == "moving_box")
        .unwrap()
        .0;
    for &actor in &people {
        sim.world_mut()
            .entity_mut(actor)
            .insert(terri_core::IntentQueue::from_intents(vec![
                terri_core::Intent {
                    object: bike,
                    interaction: 0,
                    cleanup: None,
                    chore: None,
                },
            ]));
    }
    sim.world_mut()
        .entity_mut(person)
        .insert((Position { x: 1.0, y: 2.0 }, terri_core::Needs::all_at(60.0)));
    let room = sim
        .world()
        .resource::<RoomMap>()
        .selection_at((1, 2))
        .unwrap()
        .key();
    let surface = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject, &Position)>()
        .iter(sim.world())
        .find(|(_, object, pos)| {
            pack.object(object.0).id == "counter"
                && pos.x >= 4.0
                && sim
                    .world()
                    .resource::<RoomMap>()
                    .selection_at((pos.x as u32, pos.y as u32))
                    .is_some_and(|value| value.key() == room)
        })
        .unwrap()
        .0;
    sim.world_mut().insert_resource(SavedDomestic {
        cleanliness: vec![(person.index_u32(), 1.0)],
        dishes: vec![SavedDishes {
            id: 500,
            surface: surface.index_u32(),
            owner: 1,
            units: 4,
        }],
        visits: vec![SavedRoomVisit {
            person: person.index_u32(),
            room,
            seen: vec![500],
        }],
        next_dish: 501,
        ..Default::default()
    });
    sim.world_mut().insert_resource(SavedDining {
        opportunities: vec![SavedCleanupOpportunity {
            person: person.index_u32(),
            room,
            known: vec![500],
            pending: false,
        }],
        ..Default::default()
    });
    // This room-memory regression needs an overdue pile so an actual new
    // visit can charge resentment after the grace period.
    crate::neglect::refresh(sim.world_mut());
    sim.world_mut().resource_mut::<terri_core::SimClock>().tick +=
        crate::neglect::UNFINISHED_WORK_GRACE_TICKS;
    crate::neglect::refresh(sim.world_mut());
    let feeling = |sim: &Sim| {
        sim.world()
            .get::<terri_core::Relationships>(person)
            .map_or(0.0, |feelings| feelings.feeling(terri_core::SimId(1)))
    };
    let old_feeling = feeling(&sim);
    let rng = sim.world().resource::<terri_core::SimRng>().clone();
    let before = RoomChangeContext::capture(sim.world()).unwrap();
    for y in 0..6 {
        crate::placement::walls::commit(
            sim.world_mut(),
            crate::placement::walls::WallEdit {
                axis: terri_core::layout::EdgeAxis::Vertical,
                x: 4,
                y,
                state: if y == 2 {
                    terri_core::layout::WallState::Doorway
                } else {
                    terri_core::layout::WallState::Wall
                },
            },
        );
    }
    let topology = RoomTopology::from_world(sim.world()).unwrap();
    let proposal = match_rooms(&before.map, &topology, (0, 0));
    let TopologyCell::Enclosed(index) = topology.at((5, 2)).unwrap() else {
        panic!("right child must be enclosed")
    };
    let mut choices = RoomChoices::default();
    choices.inheritance.insert(
        topology.components[index as usize].anchor,
        Some(terri_core::rooms::RoomId::new(room).unwrap()),
    );
    let resolved = resolve_rooms(
        &proposal,
        &choices,
        sim.world().resource::<terri_core::rooms::SavedRooms>(),
    )
    .unwrap();
    reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
    let current_room = sim
        .world()
        .resource::<RoomMap>()
        .selection_at((1, 2))
        .unwrap()
        .key();
    assert_ne!(current_room, room);
    let visit = sim
        .world()
        .resource::<SavedDomestic>()
        .visits
        .iter()
        .find(|row| row.person == person.index_u32())
        .unwrap();
    assert_eq!(visit.room, current_room);
    assert_eq!(visit.seen, vec![500]);
    let saved = sim.current_v19_view();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_current_v19_view(saved.clone()).unwrap();
    assert_eq!(loaded.current_v19_view(), saved);
    crate::domestic::tick(loaded.world_mut());
    let visit = loaded
        .world()
        .resource::<SavedDomestic>()
        .visits
        .iter()
        .find(|row| row.person == person.index_u32())
        .unwrap();
    assert_eq!(visit.seen, vec![500]);
    let opportunity = loaded
        .world()
        .resource::<SavedDining>()
        .opportunities
        .iter()
        .find(|row| row.person == person.index_u32())
        .unwrap();
    assert_eq!(opportunity.known, vec![500]);
    assert!(!opportunity.pending);
    assert_eq!(feeling(&loaded), old_feeling);
    assert_eq!(loaded.world().resource::<terri_core::SimRng>(), &rng);
    let path = loaded
        .world()
        .resource::<TileGrid>()
        .find_path((1, 2), (5, 2))
        .unwrap();
    loaded
        .world_mut()
        .entity_mut(person)
        .insert(terri_core::Path {
            steps: path,
            cursor: 0,
        });
    let mut movement = bevy_ecs::schedule::Schedule::default();
    use bevy_ecs::schedule::IntoScheduleConfigs;
    movement.add_systems(
        (
            crate::systems::interpersonal::prepare,
            crate::systems::movement::follow_path,
            crate::systems::interpersonal::apply,
        )
            .chain(),
    );
    for _ in 0..100 {
        movement.run(loaded.world_mut());
        if loaded.world().get::<terri_core::Path>(person).is_none() {
            break;
        }
    }
    assert_eq!(
        *loaded.world().get::<Position>(person).unwrap(),
        Position { x: 5.0, y: 2.0 }
    );
    crate::domestic::tick(loaded.world_mut());
    let after = feeling(&loaded);
    assert!(
        after < old_feeling,
        "actual entry must notice the other person's dishes"
    );
    let opportunity = loaded
        .world()
        .resource::<SavedDining>()
        .opportunities
        .iter()
        .find(|row| row.person == person.index_u32())
        .unwrap();
    assert_eq!(opportunity.room, room);
    assert!(opportunity.pending);
    crate::domestic::tick(loaded.world_mut());
    assert_eq!(
        feeling(&loaded),
        after,
        "one entry must not charge resentment twice"
    );
}

#[test]
fn review_existing_unassigned_duty_stays_unassigned_when_another_room_splits() {
    let mut sim = duty_fixture(&[0, 0]);
    let unchanged = ChoreKey {
        kind: ChoreKind::Floors,
        target: 1,
    };
    {
        let mut state = sim.world_mut().resource_mut::<SavedChores>();
        state.assignments.retain(|row| row.key != unchanged);
        state.episodes.retain(|row| row.key != unchanged);
    }
    let original = sim.world().resource::<SavedChores>().clone();
    let before = RoomChangeContext::capture(sim.world()).unwrap();
    architecture(&mut sim, &[4, 6], false);
    let resolved = resolve(&sim, &before, false);
    let fresh = resolved.new_ids[0].get();
    reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
    let state = sim.world().resource::<SavedChores>();
    assert!(!state.assignments.iter().any(|row| row.key == unchanged));
    assert!(!state.episodes.iter().any(|row| row.key == unchanged));
    assert!(state.assignments.iter().any(|row| row.key
        == ChoreKey {
            kind: ChoreKind::Floors,
            target: fresh
        }));
    let mut expected = original.rng.unwrap();
    expected.next_f32();
    assert_eq!(
        state.rng,
        Some(expected),
        "only the new duty draws an owner"
    );
}

fn new_outside_duty_with_saved_week(saved_week: Option<u64>) {
    let mut sim = Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    board::reconcile(sim.world(), &mut state);
    state.week = saved_week;
    if saved_week.is_none() {
        state.assignments.clear();
        state.episodes.clear();
        state.dish_contributions.clear();
    }
    sim.world_mut().insert_resource(state);
    let day_ticks = sim.world().resource::<crate::Content>().0.tuning.day_ticks;
    sim.world_mut().resource_mut::<terri_core::SimClock>().tick = u64::from(day_ticks) * 7;
    let saved = sim.save_snapshot_v16();
    let mut admitted = Sim::new_from_shipped_lot();
    admitted
        .load_snapshot_v16(saved.clone())
        .expect("the initial saved week is valid");
    assert_eq!(admitted.save_snapshot_v16(), saved);
    let original = admitted.world().resource::<SavedChores>().clone();
    let outside = ChoreKey {
        kind: ChoreKind::Floors,
        target: 0,
    };
    assert!(!keys(admitted.world()).contains(&outside));
    let before = RoomChangeContext::capture(admitted.world()).unwrap();
    admitted
        .world_mut()
        .resource_mut::<terri_core::layout::SavedFloors>()
        .set(17, 13, 4);
    let resolved = resolve(&admitted, &before, false);
    reconcile_committed_rooms(&mut admitted, &before, &resolved).unwrap();
    let current = admitted.save_snapshot_v16();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v16(current.clone())
        .expect("new duty must keep a coherent saved assignment week");
    assert_eq!(loaded.save_snapshot_v16(), current);
    let after = admitted.world().resource::<SavedChores>();
    assert_eq!(after.week, Some(saved_week.unwrap_or(1)));
    assert!(after
        .assignments
        .iter()
        .all(|row| Some(row.week) == after.week));
    assert_eq!(
        after
            .assignments
            .iter()
            .filter(|row| row.key != outside)
            .cloned()
            .collect::<Vec<_>>(),
        original.assignments
    );
    assert_eq!(
        &after.episodes[..original.episodes.len()],
        original.episodes.as_slice()
    );
    assert_eq!(
        after
            .assignments
            .iter()
            .filter(|row| row.key == outside)
            .count(),
        1
    );
    let mut expected_rng = original.rng.unwrap();
    expected_rng.next_f32();
    assert_eq!(after.rng, Some(expected_rng));
}

#[test]
fn review_new_duty_initializes_an_absent_saved_week_only_when_assigned() {
    new_outside_duty_with_saved_week(None);
    let mut empty = Sim::new_from_lot(&terri_data::pack().lot, &terri_data::pack().objects);
    ensure(empty.world_mut());
    empty
        .world_mut()
        .init_resource::<terri_core::layout::SavedFloors>();
    let outside = ChoreKey {
        kind: ChoreKind::Floors,
        target: 0,
    };
    assert!(
        !keys(empty.world()).contains(&outside),
        "uncovered outdoor grass has no floor duty"
    );
    let initial = empty.save_snapshot_v16();
    empty.load_snapshot_v16(initial.clone()).unwrap();
    assert_eq!(empty.save_snapshot_v16(), initial);
    let initial_rng = empty.world().resource::<SavedChores>().rng.clone();
    let before = RoomChangeContext::capture(empty.world()).unwrap();
    empty
        .world_mut()
        .resource_mut::<terri_core::layout::SavedFloors>()
        .set(17, 13, 4);
    assert!(
        keys(empty.world()).contains(&outside),
        "paving creates the previously absent outdoor duty"
    );
    let resolved = resolve(&empty, &before, false);
    reconcile_committed_rooms(&mut empty, &before, &resolved).unwrap();
    let state = empty.world().resource::<SavedChores>();
    assert!(state.assignments.is_empty());
    assert_eq!(state.week, None);
    assert_eq!(state.rng, initial_rng);
    let final_save = empty.save_snapshot_v16();
    empty.load_snapshot_v16(final_save.clone()).unwrap();
    assert_eq!(empty.save_snapshot_v16(), final_save);
}

#[test]
fn review_new_duty_preserves_a_stale_saved_week_and_existing_decisions() {
    new_outside_duty_with_saved_week(Some(0));
}
