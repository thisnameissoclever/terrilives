use super::*;
use crate::Sim;
use terri_core::{save::SavedDomestic, Agent, Needs, Position, SimId, SimRng, TileGrid};

fn room(width: usize, clean: f32) -> (Sim, Entity, Vec<u32>) {
    let mut sim = Sim::new_with_lot(width, 3);
    sim.world_mut()
        .insert_resource(terri_core::layout::SavedLayout::LegacyCells { walls: vec![] });
    let person = sim
        .world_mut()
        .spawn((
            Agent,
            SimId(0),
            Needs::all_at(60.0),
            Position { x: 0.0, y: 1.0 },
        ))
        .id();
    sim.world_mut().insert_resource(SavedDomestic {
        cleanliness: vec![(person.index_u32(), clean)],
        ..Default::default()
    });
    let counter = sim
        .world()
        .resource::<crate::Content>()
        .0
        .find("counter")
        .unwrap();
    let surfaces = [0.0, 1.0]
        .into_iter()
        .map(|x| {
            sim.spawn_object(Position { x, y: 0.0 }, counter)
                .index_u32()
        })
        .collect();
    ensure(sim.world_mut());
    (sim, person, surfaces)
}

fn score(sim: &Sim, person: Entity, label: &str) -> f32 {
    moodlets(sim.world(), person)
        .into_iter()
        .find(|m| m.label == label)
        .map_or(0.0, |m| m.score)
}

#[test]
fn cleanliness_room_mood_thresholds_each_source_before_averaging() {
    for width in [3, 7] {
        for (clean, threshold) in [(0.0, 400), (0.5, 225), (1.0, 50)] {
            let (mut sim, person, surfaces) = room(width, clean);
            let grid = sim.world().resource::<TileGrid>();
            let cells: Vec<_> = (0..width * 3)
                .filter(|cell| grid.is_walkable((cell % width) as i32, (cell / width) as i32))
                .map(|cell| cell as u32)
                .collect();
            for amount in [threshold - 1, threshold] {
                let mut state = sim.world_mut().resource_mut::<SavedChores>();
                state.floors = cells.iter().map(|cell| (*cell, amount)).collect();
                state.surfaces = surfaces.iter().map(|surface| (*surface, amount)).collect();
                assert_eq!(score(&sim, person, "Grimy floor"), 0.0);
                assert_eq!(score(&sim, person, "Grimy surfaces"), 0.0);
            }
            {
                let mut state = sim.world_mut().resource_mut::<SavedChores>();
                state.floors = vec![(cells[0], 1000)];
                state.surfaces = vec![(surfaces[0], 1000)];
            }
            assert!(
                (score(&sim, person, "Grimy floor") + (0.3 + clean) / cells.len() as f32).abs()
                    < 0.000001
            );
            assert!((score(&sim, person, "Grimy surfaces") + (0.3 + clean) / 2.0).abs() < 0.000001);
            {
                let mut state = sim.world_mut().resource_mut::<SavedChores>();
                state.floors = cells.iter().map(|cell| (*cell, 1000)).collect();
                state.surfaces = surfaces.iter().map(|surface| (*surface, 1000)).collect();
            }
            assert!((score(&sim, person, "Grimy floor") + 0.3 + clean).abs() < 0.000001);
            assert!((score(&sim, person, "Grimy surfaces") + 0.3 + clean).abs() < 0.000001);
        }
    }
}

#[test]
fn cleanliness_daily_floor_and_surface_work_waits_for_owner_threshold_without_a_draw() {
    for (clean, threshold) in [(0.0, 400), (0.5, 225), (1.0, 50)] {
        for kind in [ChoreKind::Floors, ChoreKind::CounterSurfaces] {
            let (mut sim, person, surfaces) = room(4, clean);
            let key = ChoreKey { kind, target: 0 };
            let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
            board::reconcile(sim.world(), &mut state);
            let initial_rng = state.rng.clone();
            for amount in [threshold - 1, threshold] {
                if kind == ChoreKind::Floors {
                    state.floors = vec![(4, amount)];
                } else {
                    state.surfaces = vec![(surfaces[0], amount)];
                }
                board::tick(sim.world_mut(), &mut state);
                let episode = state.episodes.iter().find(|e| e.key == key).unwrap();
                assert!(!episode.needed, "c={clean} amount={amount} kind={kind:?}");
                assert_eq!(episode.decision, None);
                assert_eq!(state.rng, initial_rng);
            }
            sim.world_mut()
                .entity_mut(person)
                .insert(terri_core::AtWork {
                    remaining_ticks: 100,
                });
            if kind == ChoreKind::Floors {
                state.floors[0].1 = threshold + 1;
            } else {
                state.surfaces[0].1 = threshold + 1;
            }
            board::tick(sim.world_mut(), &mut state);
            let episode = state.episodes.iter().find(|e| e.key == key).unwrap();
            assert!(episode.needed);
            assert_eq!(episode.decision, None, "busy owner retains the opportunity");
            assert_eq!(state.rng, initial_rng);
            sim.world_mut()
                .entity_mut(person)
                .remove::<terri_core::AtWork>();
            let seed = (0..1000)
                .find(|seed| SimRng::from_seed(*seed).next_f32() > 0.99)
                .unwrap();
            let mut expected = SimRng::from_seed(seed);
            expected.next_f32();
            state.rng = Some(SimRng::from_seed(seed));
            board::tick(sim.world_mut(), &mut state);
            let episode = state.episodes.iter().find(|e| e.key == key).unwrap();
            assert_eq!(episode.decision, Some(false));
            assert_eq!(state.rng, Some(expected.clone()));
            sim.world_mut().resource_mut::<SavedDomestic>().cleanliness[0].1 = 0.0;
            board::tick(sim.world_mut(), &mut state);
            sim.world_mut().resource_mut::<SavedDomestic>().cleanliness[0].1 = 1.0;
            board::tick(sim.world_mut(), &mut state);
            assert_eq!(
                state
                    .episodes
                    .iter()
                    .find(|e| e.key == key)
                    .unwrap()
                    .decision,
                Some(false)
            );
            assert_eq!(state.rng, Some(expected));
        }
    }
}

#[test]
fn cleanliness_daily_dishes_wait_for_the_same_load_and_urgent_needs_preserve_the_draw() {
    for (clean, quiet, active) in [(0.0, 2, 3), (0.5, 1, 2), (1.0, 0, 1)] {
        let (mut sim, person, surfaces) = room(4, clean);
        let key = ChoreKey {
            kind: ChoreKind::Dishes,
            target: 0,
        };
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        board::reconcile(sim.world(), &mut state);
        let before = state.rng.clone();
        if quiet > 0 {
            sim.world_mut().resource_mut::<SavedDomestic>().dishes.push(
                terri_core::save::SavedDishes {
                    id: 0,
                    surface: surfaces[0],
                    owner: 0,
                    units: quiet,
                },
            );
        }
        board::tick(sim.world_mut(), &mut state);
        assert!(!state.episodes.iter().find(|e| e.key == key).unwrap().needed);
        assert_eq!(state.rng, before);
        sim.world_mut().resource_mut::<SavedDomestic>().dishes =
            vec![terri_core::save::SavedDishes {
                id: 0,
                surface: surfaces[0],
                owner: 0,
                units: active,
            }];
        sim.world_mut()
            .get_mut::<Needs>(person)
            .unwrap()
            .set(terri_core::NeedId::Energy, 0.0);
        board::tick(sim.world_mut(), &mut state);
        let episode = state.episodes.iter().find(|e| e.key == key).unwrap();
        assert!(episode.needed);
        assert_eq!(episode.decision, None);
        assert_eq!(state.rng, before);
    }
}

#[test]
fn cleanliness_does_not_change_bin_threshold_or_explicit_small_cleanup_orders() {
    for clean in [0.0, 0.5, 1.0] {
        let (mut sim, person, _) = room(4, clean);
        let bin = sim
            .world()
            .resource::<crate::Content>()
            .0
            .find("trashcan")
            .unwrap();
        let bin = sim.spawn_object(Position { x: 2.0, y: 0.0 }, bin);
        let key = ChoreKey {
            kind: ChoreKind::Bins,
            target: bin.index_u32(),
        };
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        board::reconcile(sim.world(), &mut state);
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::AtWork {
                remaining_ticks: 100,
            });
        for (amount, needed) in [(599, false), (600, true)] {
            state.bins = vec![(key.target, amount)];
            board::tick(sim.world_mut(), &mut state);
            assert_eq!(
                state.episodes.iter().find(|e| e.key == key).unwrap().needed,
                needed
            );
        }
    }
    for kind in [ChoreKind::Floors, ChoreKind::Surfaces] {
        let (mut sim, person, surfaces) = room(4, 0.0);
        let key = ChoreKey {
            kind,
            target: if kind == ChoreKind::Floors {
                0
            } else {
                surfaces[0]
            },
        };
        {
            let mut state = sim.world_mut().resource_mut::<SavedChores>();
            state.board_enabled = false;
            state.floors = vec![(4, 1)];
            state.surfaces = vec![(surfaces[0], 1)];
        }
        sim.world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::CleanChoreFirst {
                agent: person.index_u32(),
                key,
            });
        sim.flush_commands();
        sim.tick();
        let task = sim
            .world()
            .resource::<SavedChores>()
            .tasks
            .iter()
            .find(|t| t.person == person.index_u32())
            .unwrap();
        assert_eq!(task.key, key);
        assert!(task.directed);
    }
}

#[test]
fn cleanliness_group_credit_uses_the_duty_owner_and_keeps_active_dirt_needed() {
    let (mut sim, person, surfaces) = room(4, 1.0);
    let key = ChoreKey {
        kind: ChoreKind::CounterSurfaces,
        target: 0,
    };
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    board::reconcile(sim.world(), &mut state);
    state.surfaces = vec![(surfaces[1], 100)];
    let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    episode.needed = true;
    episode.decision = Some(false);
    board::reconcile(sim.world(), &mut state);
    assert!(state.episodes.iter().find(|e| e.key == key).unwrap().needed);
    completed(
        sim.world_mut(),
        &mut state,
        person.index_u32(),
        ChoreKey {
            kind: ChoreKind::Surfaces,
            target: surfaces[0],
        },
        0,
        1,
    );
    assert!(
        !state
            .episodes
            .iter()
            .find(|e| e.key == key)
            .unwrap()
            .settled
    );
    state.surfaces.clear();
    completed(
        sim.world_mut(),
        &mut state,
        person.index_u32(),
        ChoreKey {
            kind: ChoreKind::Surfaces,
            target: surfaces[1],
        },
        0,
        100,
    );
    assert!(
        state
            .episodes
            .iter()
            .find(|e| e.key == key)
            .unwrap()
            .settled
    );
}

fn group_credit_with_opposite_cleanliness(owner_clean: f32, helper_clean: f32, covered: bool) {
    let (mut sim, owner, surfaces) = room(4, owner_clean);
    let helper = sim
        .world_mut()
        .spawn((
            Agent,
            SimId(1),
            Needs::all_at(60.0),
            Position { x: 2.0, y: 1.0 },
        ))
        .id();
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .cleanliness
        .push((helper.index_u32(), helper_clean));
    ensure(sim.world_mut());
    let key = ChoreKey {
        kind: ChoreKind::CounterSurfaces,
        target: 0,
    };
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    board::reconcile(sim.world(), &mut state);
    state
        .assignments
        .iter_mut()
        .find(|a| a.key == key)
        .unwrap()
        .owner = 0;
    let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    episode.owner = 0;
    episode.needed = true;
    episode.decision = Some(false);
    episode.outcome = DutyOutcome::Skipped;
    let episode_id = episode.id;
    state.surfaces = vec![(surfaces[0], 500), (surfaces[1], 100)];
    board::reconcile(sim.world(), &mut state);
    assert_eq!(sim.world().get::<SimId>(owner), Some(&SimId(0)));
    assert_eq!(sim.world().get::<SimId>(helper), Some(&SimId(1)));

    // The helper finishes one surface; 100 dirt remains on another member.
    state.surfaces.remove(0);
    completed(
        sim.world_mut(),
        &mut state,
        helper.index_u32(),
        ChoreKey {
            kind: ChoreKind::Surfaces,
            target: surfaces[0],
        },
        0,
        500,
    );
    let episode = state.episodes.iter().find(|e| e.id == episode_id).unwrap();
    assert_eq!(episode.owner, 0);
    assert_eq!(episode.decision, Some(false));
    assert_eq!(
        episode.settled, covered,
        "owner={owner_clean}, helper={helper_clean}"
    );
    assert_eq!(episode.performer, covered.then_some(1));
    assert_eq!(
        episode.outcome,
        if covered {
            DutyOutcome::Covered
        } else {
            DutyOutcome::Skipped
        }
    );
    assert_eq!(state.surfaces, vec![(surfaces[1], 100)]);
}

#[test]
fn cleanliness_group_credit_waits_for_neat_owner_despite_tolerant_helper() {
    group_credit_with_opposite_cleanliness(1.0, 0.0, false);
}

#[test]
fn cleanliness_group_credit_covers_tolerant_owner_despite_neat_helper() {
    group_credit_with_opposite_cleanliness(0.0, 1.0, true);
}
