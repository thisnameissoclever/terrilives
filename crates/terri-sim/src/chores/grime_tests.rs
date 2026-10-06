use super::*;
use terri_core::{Agent, Position, SimClock, TileGrid};

#[test]
fn unused_rooms_and_surfaces_do_not_age() {
    let mut sim = crate::Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    sim.world_mut().resource_mut::<SavedChores>().board_enabled = false;
    sim.world_mut().resource_mut::<SimClock>().tick += 10000;
    tick(sim.world_mut());
    let state = sim.world().resource::<SavedChores>();
    assert!(state.floors.is_empty());
    assert!(state.surfaces.is_empty());
}

#[test]
fn diagonal_patch_does_not_reach_past_blocked_tile_corners() {
    let mut sim = crate::Sim::new_from_shipped_lot();
    let (at, room, width) = open_square(&sim);
    let center = at.1 as u32 * width as u32 + at.0 as u32;
    let diagonal = center + width as u32 + 1;
    assert!(patches::cells(sim.world(), room, center).contains(&diagonal));
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(
        (at.0 + 1) as usize,
        at.1 as usize,
        true,
    );
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(
        at.0 as usize,
        (at.1 + 1) as usize,
        true,
    );
    assert!(!patches::cells(sim.world(), room, center).contains(&diagonal));
}

#[test]
fn ordinary_completion_rolls_follow_identity_order_after_component_churn() {
    let run = |churn: bool| {
        let mut sim = crate::Sim::new_from_shipped_lot();
        ensure(sim.world_mut());
        let first_actor = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                terri_core::Needs::all_at(100.0),
            ))
            .id();
        let second_actor = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 1.0 },
                terri_core::Needs::all_at(100.0),
            ))
            .id();
        let people = [first_actor, second_actor];
        let table = groups::members(
            sim.world(),
            ChoreKey {
                kind: ChoreKind::TableSurfaces,
                target: 0,
            },
        )[0];
        let first = crate::dining::entity(sim.world(), table).unwrap();
        let definition = sim.world().get::<terri_core::SmartObject>(first).unwrap().0;
        let second = sim.spawn_object(Position { x: 10.0, y: 4.0 }, definition);
        let state = sim.world().resource::<SavedChores>().clone();
        grime::ensure(sim.world_mut(), &state);
        let seed = (0..100000)
            .find(|seed| {
                let mut r = terri_core::SimRng::from_seed(*seed);
                r.next_f32() < 0.04 && r.next_f32() > 0.20
            })
            .unwrap();
        sim.world_mut()
            .resource_mut::<terri_core::grime::SavedGrime>()
            .rng = terri_core::SimRng::from_seed(seed);
        let mut arrivals = vec![(people[0], first), (people[1], second)];
        if churn {
            arrivals.reverse();
        }
        for (person, object) in arrivals {
            sim.world_mut().entity_mut(person).insert((
                terri_core::Target {
                    object,
                    interaction: 0,
                },
                terri_core::Eating {
                    object: definition,
                    interaction: 0,
                    remaining_ticks: 1,
                },
            ));
        }
        let actual_order: Vec<_> = sim
            .world_mut()
            .query::<(
                Entity,
                &terri_core::Eating,
                &terri_core::Needs,
                &terri_core::Target,
                Option<&terri_core::IntentQueue>,
                Option<&terri_core::Habituation>,
                Option<&terri_core::Personality>,
                Option<&terri_core::Satisfaction>,
                Option<&terri_core::Hobbies>,
                Option<&terri_core::Fumbled>,
                Option<&terri_core::Traits>,
            )>()
            .iter(sim.world())
            .map(|row| row.0)
            .collect();
        assert_eq!(
            actual_order,
            if churn {
                vec![people[1], people[0]]
            } else {
                people.to_vec()
            }
        );
        let mut phase = bevy_ecs::schedule::Schedule::default();
        phase.add_systems(crate::systems::interact::tick_interactions);
        phase.run(sim.world_mut());
        let dirt = sim.world().resource::<SavedChores>().surfaces.clone();
        assert_eq!(dirt, vec![(table, 100)]);
        dirt
    };
    assert_eq!(run(false), run(true));
}

fn actor(sim: &mut crate::Sim) -> Entity {
    sim.world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .next()
        .unwrap()
}

fn open_square(sim: &crate::Sim) -> ((i32, i32), u32, usize) {
    let rooms = crate::room_regions::RoomRegions::from_world(sim.world());
    let grid = sim.world().resource::<TileGrid>();
    let width = grid.width();
    let center = (1..grid.height() - 1)
        .flat_map(|y| (1..width - 1).map(move |x| (x as i32, y as i32)))
        .find(|&(x, y)| {
            rooms.at((x, y)).is_some()
                && (-1..=1).all(|dy| {
                    (-1..=1).all(|dx| {
                        grid.is_walkable(x + dx, y + dy)
                            && rooms.at((x + dx, y + dy)) == rooms.at((x, y))
                    })
                })
        })
        .unwrap();
    (center, rooms.at(center).unwrap(), width)
}

#[test]
fn cleanliness_scales_rolls_and_surface_probability_is_doubled() {
    for (cleanliness, floor) in [(0.0, 0.10), (0.5, 0.06), (1.0, 0.02)] {
        assert!((grime::chance(cleanliness, false) - floor).abs() < 0.000001);
        assert!((grime::chance(cleanliness, true) - floor * 2.0).abs() < 0.000001);
    }
    let mut sim = crate::Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = actor(&mut sim);
    let mut chores = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    grime::ensure(sim.world_mut(), &chores);
    chores.board_enabled = false;
    sim.world_mut().insert_resource(chores);
    let general = sim.world().resource::<terri_core::SimRng>().clone();
    let assignment = sim.world().resource::<SavedChores>().rng.clone();
    let mut totals = vec![];
    let (to, _, width) = open_square(&sim);
    sim.world_mut()
        .get_resource_or_insert_with(terri_core::save::SavedDomestic::default);
    for clean in [0.0, 0.5, 1.0] {
        sim.world_mut()
            .resource_mut::<terri_core::save::SavedDomestic>()
            .cleanliness = vec![(person.index_u32(), clean)];
        sim.world_mut()
            .resource_mut::<terri_core::grime::SavedGrime>()
            .rng = terri_core::SimRng::from_seed(72);
        let mut successes = 0;
        for _ in 0..1000 {
            sim.world_mut().resource_mut::<SavedChores>().floors.clear();
            grime::footstep(sim.world_mut(), person, (to.0 - 1, to.1), to);
            let amount = value(
                &sim.world().resource::<SavedChores>().floors,
                to.1 as u32 * width as u32 + to.0 as u32,
            );
            assert!(amount == 0 || amount == 100);
            successes += u32::from(amount > 0);
        }
        totals.push(successes);
    }
    assert!(
        totals[0] > totals[1] && totals[1] > totals[2] && totals[2] > 0,
        "{totals:?}"
    );
    assert_eq!(sim.world().resource::<terri_core::SimRng>(), &general);
    assert_eq!(sim.world().resource::<SavedChores>().rng, assignment);
}

#[test]
fn patch_contact_rejects_partial_walls_and_diagonal_corners() {
    let mut sim = crate::Sim::new_from_shipped_lot();
    let (at, room, width) = open_square(&sim);
    let width = width as u32;
    let center = at.1 as u32 * width + at.0 as u32;
    assert!(patches::cells(sim.world(), room, center).contains(&(center + 1)));
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_edge_blocked(at, (at.0 + 1, at.1), true);
    let patch = patches::cells(sim.world(), room, center);
    assert!(!patch.contains(&(center + 1)));
    assert!(!patch.contains(&(center + 1 + width)));
    assert!(!patch.contains(&(center + 1 - width)));
    assert!(patch.contains(&center));
}

#[test]
fn grime_mood_scales_with_opacity_even_without_dirty_floors() {
    let mut sim = crate::Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = actor(&mut sim);
    let counter = groups::members(
        sim.world(),
        ChoreKey {
            kind: ChoreKind::CounterSurfaces,
            target: 0,
        },
    )[0];
    sim.world_mut()
        .entity_mut(person)
        .insert(Position { x: 1.0, y: 1.0 });
    let mut scores = vec![];
    for amount in [100, 500, 1000] {
        sim.world_mut().resource_mut::<SavedChores>().surfaces = vec![(counter, amount)];
        let score = moodlets(sim.world(), person)
            .into_iter()
            .find(|m| m.label == "Grimy surfaces")
            .expect("dirty surfaces matter with a clean floor")
            .score;
        scores.push(score);
    }
    assert!((scores[1] - scores[0] * 5.0).abs() < 0.000001);
    assert!((scores[2] - scores[0] * 10.0).abs() < 0.000001);
}

#[test]
fn actual_last_walking_step_rolls_once_and_standing_does_not() {
    let mut sim = crate::Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = actor(&mut sim);
    let (to, _, width) = open_square(&sim);
    let from = (to.0 - 1, to.1);
    let chores = sim.world().resource::<SavedChores>().clone();
    grime::ensure(sim.world_mut(), &chores);
    let seed = (0..10000)
        .find(|seed| terri_core::SimRng::from_seed(*seed).next_f32() < 0.02)
        .unwrap();
    sim.world_mut()
        .resource_mut::<terri_core::grime::SavedGrime>()
        .rng = terri_core::SimRng::from_seed(seed);
    sim.world_mut().resource_mut::<SavedChores>().board_enabled = false;
    sim.world_mut().entity_mut(person).insert((
        Position {
            x: from.0 as f32,
            y: from.1 as f32,
        },
        terri_core::Path {
            steps: vec![to],
            cursor: 0,
        },
    ));
    let cell = to.1 as u32 * width as u32 + to.0 as u32;
    // Isolate movement from the autonomy system, which may replace a bare wander path.
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
    let mut expected_rng = sim
        .world()
        .resource::<terri_core::grime::SavedGrime>()
        .rng
        .clone();
    expected_rng.next_f32();
    for _ in 0..60 {
        movement.run(sim.world_mut());
        let p = sim.world().get::<Position>(person).unwrap();
        if p.x == to.0 as f32 && p.y == to.1 as f32 {
            break;
        }
    }
    assert_eq!(
        value(&sim.world().resource::<SavedChores>().floors, cell),
        100
    );
    assert_eq!(
        *sim.world().get::<Position>(person).unwrap(),
        Position {
            x: to.0 as f32,
            y: to.1 as f32
        }
    );
    assert!(sim
        .world()
        .get::<terri_core::Path>(person)
        .is_none_or(|p| p.next_step().is_none()));
    assert_eq!(
        sim.world().resource::<terri_core::grime::SavedGrime>().rng,
        expected_rng
    );
    let rng = sim
        .world()
        .resource::<terri_core::grime::SavedGrime>()
        .rng
        .clone();
    for _ in 0..20 {
        movement.run(sim.world_mut());
    }
    assert_eq!(
        sim.world().resource::<terri_core::grime::SavedGrime>().rng,
        rng
    );
    assert_eq!(
        value(&sim.world().resource::<SavedChores>().floors, cell),
        100
    );
    let saved = sim.save_snapshot_v5();
    let mut loaded = crate::Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(saved).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
    let mut loaded_movement = bevy_ecs::schedule::Schedule::default();
    loaded_movement.add_systems(
        (
            crate::systems::interpersonal::prepare,
            crate::systems::movement::follow_path,
            crate::systems::interpersonal::apply,
        )
            .chain(),
    );
    loaded_movement.run(loaded.world_mut());
    assert_eq!(
        loaded
            .world()
            .resource::<terri_core::grime::SavedGrime>()
            .rng,
        rng
    );
    assert_eq!(
        value(&loaded.world().resource::<SavedChores>().floors, cell),
        100
    );
}

#[test]
fn completed_station_use_dirties_only_adjacent_counters_and_preserves_waste() {
    let mut sim = crate::Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = actor(&mut sim);
    let sink = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "kitchen_sink")
        .unwrap()
        .0;
    let targets = grime::adjacent_counters(sim.world(), sink);
    assert_eq!(targets.len(), 2);
    for _ in 0..300 {
        grime::used(sim.world_mut(), person, sink);
    }
    let state = sim.world().resource::<SavedChores>();
    assert_eq!(state.surfaces.len(), 2);
    for id in targets {
        assert_eq!(value(&state.surfaces, id), 1000);
    }
    assert!(state.bins.is_empty());
    assert_eq!(state.unbinned, 0);
    let hash = sim.world_hash();
    let saved = sim.save_snapshot_v5();
    let mut loaded = crate::Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(saved).unwrap();
    assert_eq!(loaded.world_hash(), hash);
    grime::used(sim.world_mut(), person, sink);
    grime::used(loaded.world_mut(), person, sink);
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

#[test]
fn real_dish_washing_rolls_for_sink_neighbors_after_washing() {
    let mut sim = crate::Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = actor(&mut sim);
    let day = sim.world().resource::<crate::Content>().0.tuning.day_ticks;
    sim.world_mut().resource_mut::<SimClock>().tick = u64::from(day) * 5 + 660;
    let counter = groups::members(
        sim.world(),
        ChoreKey {
            kind: ChoreKind::CounterSurfaces,
            target: 0,
        },
    )[0];
    let sink = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "kitchen_sink")
        .unwrap()
        .0;
    let neighbors = grime::adjacent_counters(sim.world(), sink);
    let owner = sim.world().get::<terri_core::SimId>(person).unwrap().0;
    let mut domestic = terri_core::save::SavedDomestic {
        next_dish: 1,
        ..Default::default()
    };
    domestic.dishes.push(terri_core::save::SavedDishes {
        id: 0,
        surface: counter,
        owner,
        units: 1,
    });
    sim.world_mut().insert_resource(domestic);
    let others: Vec<_> = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .filter(|e| *e != person)
        .collect();
    for other in others {
        sim.world_mut()
            .entity_mut(other)
            .insert(terri_core::AtWork {
                remaining_ticks: 10000,
            });
    }
    sim.world_mut().resource_mut::<SavedChores>().board_enabled = false;
    let chores = sim.world().resource::<SavedChores>().clone();
    grime::ensure(sim.world_mut(), &chores);
    let seed = (0..100000)
        .find(|seed| {
            let mut r = terri_core::SimRng::from_seed(*seed);
            r.next_f32() < 0.02 && r.next_f32() < 0.02
        })
        .unwrap();
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::CleanDishesFirst {
            agent: person.index_u32(),
            surface: counter,
            dishes: Some(vec![0]),
        });
    let mut finished = false;
    for _ in 0..1000 {
        sim.world_mut()
            .resource_mut::<terri_core::grime::SavedGrime>()
            .rng = terri_core::SimRng::from_seed(seed);
        sim.tick();
        if sim
            .world()
            .resource::<terri_core::save::SavedDomestic>()
            .dishes
            .is_empty()
        {
            finished = true;
            break;
        }
        assert!(sim.world().resource::<SavedChores>().surfaces.is_empty());
    }
    assert!(finished);
    assert_eq!(
        sim.world().resource::<SavedChores>().surfaces,
        neighbors
            .into_iter()
            .map(|id| (id, 100))
            .collect::<Vec<_>>()
    );
}

#[test]
fn stove_neighbors_follow_rotation_walls_moves_and_missing_counters() {
    let mut sim = crate::Sim::new_from_shipped_lot();
    let stove = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "stove")
        .unwrap()
        .0;
    let expected = grime::adjacent_counters(sim.world(), stove);
    assert_eq!(expected.len(), 2);
    for facing in terri_core::Facing::ALL {
        sim.world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::PlaceObject {
                object: stove.index_u32(),
                x: 2,
                y: 0,
                facing,
            });
        sim.flush_commands();
        assert_eq!(
            sim.world()
                .get::<terri_core::ObjectFacing>(stove)
                .unwrap()
                .0,
            facing
        );
        assert_eq!(grime::adjacent_counters(sim.world(), stove), expected);
    }
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_edge_blocked((2, 0), (3, 0), true);
    assert_eq!(
        grime::adjacent_counters(sim.world(), stove),
        vec![expected[0]]
    );
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_edge_blocked((2, 0), (3, 0), false);
    let destination = (1u32..5)
        .flat_map(|y| (0u32..8).map(move |x| (x, y)))
        .find(|&(x, y)| {
            x.abs_diff(2) + y > 1
                && crate::placement::validate_placement(
                    sim.world(),
                    expected[1],
                    (x, y),
                    terri_core::Facing::SouthWest,
                )
                .is_ok()
        })
        .unwrap();
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::PlaceObject {
            object: expected[1],
            x: destination.0,
            y: destination.1,
            facing: terri_core::Facing::SouthWest,
        });
    sim.flush_commands();
    assert_eq!(
        grime::adjacent_counters(sim.world(), stove),
        vec![expected[0]]
    );
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::SellObject {
            object: expected[0],
        });
    sim.flush_commands();
    assert!(grime::adjacent_counters(sim.world(), stove).is_empty());
}

#[test]
fn actual_cooking_completion_adds_one_roll_per_stove_neighbor() {
    let mut sim = crate::Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = actor(&mut sim);
    let day = sim.world().resource::<crate::Content>().0.tuning.day_ticks;
    sim.world_mut().resource_mut::<SimClock>().tick = u64::from(day) * 5 + 660;
    let others: Vec<_> = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .filter(|e| *e != person)
        .collect();
    for other in others {
        sim.world_mut()
            .entity_mut(other)
            .insert(terri_core::AtWork {
                remaining_ticks: 10000,
            });
    }
    sim.world_mut().resource_mut::<SavedChores>().board_enabled = false;
    let fridge = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "fridge")
        .unwrap()
        .0;
    let stove = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "stove")
        .unwrap()
        .0;
    let neighbors = grime::adjacent_counters(sim.world(), stove);
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::UseObjectFirst {
            agent: person.index_u32(),
            object: fridge.index_u32(),
            interaction: 1,
        });
    let mut reached = false;
    for _ in 0..1600 {
        if sim
            .world()
            .get::<terri_core::Target>(person)
            .is_some_and(|t| t.object == stove)
            && sim
                .world()
                .get::<terri_core::StepWork>(person)
                .is_some_and(|s| s.remaining_ticks == 1)
        {
            reached = true;
            break;
        }
        sim.tick();
    }
    assert!(
        reached,
        "the actual recipe must reach its last stove-work tick"
    );
    let before = sim.world().resource::<SavedChores>().surfaces.clone();
    let seed = (0..100000)
        .find(|seed| {
            let mut r = terri_core::SimRng::from_seed(*seed);
            r.next_f32() < 0.02 && r.next_f32() < 0.02
        })
        .unwrap();
    sim.world_mut()
        .resource_mut::<terri_core::grime::SavedGrime>()
        .rng = terri_core::SimRng::from_seed(seed);
    sim.tick();
    let after = &sim.world().resource::<SavedChores>().surfaces;
    for id in neighbors {
        assert_eq!(value(after, id), value(&before, id) + 100);
    }
}

#[test]
fn nine_tiles_fade_together_over_twenty_four_work_ticks() {
    let mut sim = crate::Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    let (center, room, width) = open_square(&sim);
    let key = ChoreKey {
        kind: ChoreKind::Floors,
        target: room,
    };
    let cells: Vec<_> = (-1..=1)
        .flat_map(|dy| {
            (-1..=1).map(move |dx| (center.1 + dy) as u32 * width as u32 + (center.0 + dx) as u32)
        })
        .collect();
    sim.world_mut().entity_mut(person).insert(Position {
        x: center.0 as f32,
        y: center.1 as f32,
    });
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    state.board_enabled = false;
    for cell in &cells {
        add(&mut state.floors, *cell, 1000);
    }
    assert!(work::start(sim.world_mut(), &mut state, person, key, true));
    for _ in 0..12 {
        work::advance(sim.world_mut(), &mut state);
        sim.world_mut().insert_resource(state);
        let snapshot = sim.save_snapshot_v5();
        let mut loaded = crate::Sim::new_from_shipped_lot();
        loaded.load_snapshot_v5(snapshot.clone()).unwrap();
        assert_eq!(loaded.world_hash(), sim.world_hash());
        if snapshot
            .grime
            .as_ref()
            .is_some_and(|s| !s.patches.is_empty())
        {
            let mut invalid = snapshot.clone();
            invalid.grime.as_mut().unwrap().patches[0]
                .cells
                .push(u32::MAX);
            assert!(loaded.load_snapshot_v5(invalid).is_err());
            assert_eq!(loaded.world_hash(), sim.world_hash());
            let mut missing = snapshot;
            missing.grime = None;
            assert!(loaded.load_snapshot_v5(missing).is_err());
        }
        state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    }
    assert!(cells
        .iter()
        .all(|cell| (490..=510).contains(&value(&state.floors, *cell))));
    sim.world_mut().insert_resource(state.clone());
    let mut cancelled = crate::Sim::new_from_shipped_lot();
    cancelled.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    let before = cancelled.world().resource::<SavedChores>().floors.clone();
    work::cancel(cancelled.world_mut(), person);
    assert_eq!(cancelled.world().resource::<SavedChores>().floors, before);
    assert!(cancelled
        .world()
        .resource::<terri_core::grime::SavedGrime>()
        .patches
        .is_empty());
    sim.world_mut().remove_resource::<SavedChores>();
    add(&mut state.floors, cells[0], 100);
    for _ in 0..12 {
        work::advance(sim.world_mut(), &mut state);
        sim.world_mut().insert_resource(state);
        let snapshot = sim.save_snapshot_v5();
        let mut loaded = crate::Sim::new_from_shipped_lot();
        loaded.load_snapshot_v5(snapshot.clone()).unwrap();
        assert_eq!(loaded.world_hash(), sim.world_hash());
        if snapshot
            .grime
            .as_ref()
            .is_some_and(|s| !s.patches.is_empty())
        {
            let mut invalid = snapshot.clone();
            invalid.grime.as_mut().unwrap().patches[0]
                .cells
                .push(u32::MAX);
            assert!(loaded.load_snapshot_v5(invalid).is_err());
            assert_eq!(loaded.world_hash(), sim.world_hash());
            let mut missing = snapshot;
            missing.grime = None;
            assert!(loaded.load_snapshot_v5(missing).is_err());
        }
        state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    }
    assert!(cells.iter().all(|cell| value(&state.floors, *cell) == 0));
}
