use super::*;
use terri_core::{
    layout::{EdgeAxis, SavedFloors, WallState},
    CommandQueue, SimCommand,
};

fn issue(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
    sim.flush_commands();
}
fn pave(sim: &mut Sim, value: u8) {
    issue(
        sim,
        SimCommand::SetFloor {
            x: 17,
            y: 13,
            covering: value,
        },
    );
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_floor_result
        .unwrap()
        .reason
        .is_none());
}
fn confirm(sim: &mut Sim) -> BuildReview {
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    sim.commit_build(review.token).unwrap();
    review
}
fn wall_refusal(sim: &mut Sim, axis: EdgeAxis, x: u32, y: u32, state: WallState) -> Option<crate::placement::PlacementRefusal> {
    issue(sim, SimCommand::SetWallEdge { axis, x, y, state });
    sim.world()
        .resource::<crate::placement::LotEditState>()
        .last_wall_result
        .unwrap()
        .reason
}

/// Fits a window, then walls in one floor tile beside a piece of furniture.
/// Returns the line between the sealed tile and the furniture.
fn windowed_house_with_sealed_pocket(sim: &mut Sim) -> (EdgeAxis, u32, u32) {
    let windowed = sim
        .world()
        .resource::<terri_core::layout::SavedLayout>()
        .edges()
        .iter()
        .filter(|edge| !edge.doorway)
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .any(|edge| {
            issue(
                sim,
                SimCommand::FitWindow {
                    axis: edge.axis,
                    x: edge.x,
                    y: edge.y,
                    model: terri_core::windows::WindowModel::Sash,
                },
            );
            sim.world()
                .resource::<crate::placement::LotEditState>()
                .last_window_result
                .is_some_and(|r| r.reason.is_none())
        });
    assert!(windowed, "the shipped house takes a window somewhere");
    let content = sim.world().resource::<Content>().0;
    let objects: Vec<(u32, u32, u32)> = {
        let world = sim.world_mut();
        let mut query = world.query::<(
            &terri_core::Position,
            &terri_core::SmartObject,
            Option<&terri_core::ObjectFacing>,
        )>();
        query
            .iter(world)
            .map(|(p, object, facing)| {
                let footprint = crate::placed_footprint(content, object.0, facing);
                (p.x as u32, p.y as u32, footprint.depth)
            })
            .collect()
    };
    for (x, y, depth) in objects {
        let pocket = (x, y + depth);
        if !sim.world().resource::<terri_core::TileGrid>().is_walkable(pocket.0 as i32, pocket.1 as i32) {
            continue;
        }
        let sides = [
            (EdgeAxis::Horizontal, pocket.0, pocket.1),
            (EdgeAxis::Horizontal, pocket.0, pocket.1 + 1),
            (EdgeAxis::Vertical, pocket.0, pocket.1),
            (EdgeAxis::Vertical, pocket.0 + 1, pocket.1),
        ];
        if sides
            .iter()
            .all(|&(axis, x, y)| wall_refusal(sim, axis, x, y, WallState::Wall).is_none())
        {
            return sides[0];
        }
    }
    panic!("no furniture in the shipped house has a pocket to seal beside it");
}

/// A doorway between furniture and a sealed pocket of floor makes the pocket
/// an approach to the furniture that nobody can reach. A windowed house's
/// loader refuses that, so the doorway must be refused when it is made, not
/// at Confirm, where it left Build mode unable to confirm anything.
#[test]
fn a_doorway_into_a_sealed_pocket_beside_furniture_is_refused_before_confirm() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    let (axis, x, y) = windowed_house_with_sealed_pocket(&mut sim);
    let refusal = wall_refusal(&mut sim, axis, x, y, WallState::Doorway);
    if refusal.is_none() {
        let confirm = sim.prepare_build_commit(RoomChoices::default()).map(|_| ());
        panic!("the doorway at {x}, {y} was accepted, and Confirm gives {confirm:?}");
    }
    assert_eq!(
        refusal,
        Some(crate::placement::PlacementRefusal::InaccessibleInteraction)
    );
    confirm(&mut sim);
}

/// A house that will not load names the rule it breaks, not only the kind of
/// error, so the page can say what is in the way.
#[test]
fn build_entry_names_the_rule_a_house_that_will_not_load_breaks() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    let (axis, x, y) = windowed_house_with_sealed_pocket(&mut sim);
    confirm(&mut sim);
    sim.end_build().unwrap();
    // Forced past the wall tool, as a doorway from before its rule would be.
    let layout = sim.world().resource::<terri_core::layout::SavedLayout>();
    let mut edges = layout.edges().to_vec();
    let windows = layout.window_placements();
    let edge = edges
        .iter_mut()
        .find(|e| e.axis == axis && e.x == x && e.y == y)
        .unwrap();
    edge.doorway = true;
    let [a, b] = edge.cells();
    sim.world_mut()
        .insert_resource(terri_core::layout::SavedLayout::from_window_placements(edges, windows));
    sim.world_mut()
        .resource_mut::<terri_core::TileGrid>()
        .set_edge_blocked(a, b, false);
    assert_eq!(
        sim.begin_build(),
        Err(BuildCommitError::Validation(SaveError::InvalidGrid))
    );
    assert_eq!(
        sim.build_diagnosis(),
        Some(ValidationProblem::LotUsability(
            crate::placement::PlacementRefusal::InaccessibleInteraction
        ))
    );
    assert!(!sim.build_active());
}

/// Every wall, doorway, opening, window and room the tools accept must
/// confirm, with housemates walking, working and talking around the edits,
/// and Build mode must open again after play. It found the sealed-pocket
/// doorway, a reserved guest taking supper, and a walker passing a window
/// beside their target being refused at load. Run with
/// `cargo test -p terri-sim --release --lib accepted_architecture_edits_always_confirm -- --ignored`;
/// `BUILD_FUZZ_FROM` and `BUILD_FUZZ_TO` choose the seeds.
#[test]
#[ignore = "a seeded search that takes several seconds a seed; run it after changing lot-edit or load rules"]
fn accepted_architecture_edits_always_confirm() {
    let seed_env = |name: &str, default: u64| {
        std::env::var(name).ok().and_then(|s| s.parse().ok()).unwrap_or(default)
    };
    for seed in seed_env("BUILD_FUZZ_FROM", 1)..=seed_env("BUILD_FUZZ_TO", 24) {
        let mut sim = Sim::new_from_shipped_lot_with_seed(seed);
        let mut rng = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
        let mut next = move |n: u64| {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            rng % n
        };
        for _ in 0..(200 + next(20000)) {
            sim.tick();
        }
        if let Err(e) = sim.begin_build() {
            panic!("seed {seed}: Build entry refused {e:?}, {:?}", sim.build_diagnosis());
        }
        let grid = sim.world().resource::<terri_core::TileGrid>();
        let (w, h) = (grid.width() as u64, grid.height() as u64);
        let mut accepted = 0;
        for step in 0..60 {
            let axis = if next(2) == 0 { EdgeAxis::Vertical } else { EdgeAxis::Horizontal };
            let mut spots: Vec<(u32, u32)> = vec![];
            {
                let world = sim.world_mut();
                let mut q = world.query::<(&terri_core::Position, Option<&terri_core::Path>)>();
                for (p, path) in q.iter(world) {
                    spots.push((p.x.round().max(0.0) as u32, p.y.round().max(0.0) as u32));
                    if let Some(path) = path {
                        for &(x, y) in path.steps.iter().skip(path.cursor) {
                            spots.push((x.max(0) as u32, y.max(0) as u32));
                        }
                    }
                }
            }
            let (x, y) = if !spots.is_empty() && next(4) != 0 {
                let (sx, sy) = spots[next(spots.len() as u64) as usize];
                (sx + next(2) as u32, sy + next(2) as u32)
            } else {
                (next(w + 1) as u32, next(h + 1) as u32)
            };
            let command = match next(6) {
                4 | 5 => {
                    let (x1, y1) = (x + 1 + next(4) as u32, y + 1 + next(4) as u32);
                    let doorway = (next(3) != 0).then(|| terri_core::layout::WallLine {
                        axis: EdgeAxis::Horizontal,
                        x: x + next((x1 - x) as u64 + 1) as u32,
                        y: if next(2) == 0 { y } else { y1 + 1 },
                    });
                    SimCommand::BuildRoom { x0: x, y0: y, x1, y1, doorway }
                }
                0 => SimCommand::SetWallEdge { axis, x, y, state: WallState::Wall },
                1 => SimCommand::SetWallEdge { axis, x, y, state: WallState::Doorway },
                2 => SimCommand::SetWallEdge { axis, x, y, state: WallState::Open },
                _ => SimCommand::FitWindow { axis, x, y, model: terri_core::windows::WindowModel::Sash },
            };
            {
                let mut state = sim.world_mut().resource_mut::<crate::placement::LotEditState>();
                state.last_wall_result = None;
                state.last_window_result = None;
                state.last_room_result = None;
            }
            issue(&mut sim, command.clone());
            let state = sim.world().resource::<crate::placement::LotEditState>();
            let ok = match command {
                SimCommand::FitWindow { .. } => state.last_window_result.is_some_and(|r| r.reason.is_none()),
                SimCommand::BuildRoom { .. } => state.last_room_result.as_ref().is_some_and(|r| r.reason.is_none()),
                _ => state.last_wall_result.is_some_and(|r| r.reason.is_none()),
            };
            if !ok {
                continue;
            }
            accepted += 1;
            match sim.prepare_build_commit(RoomChoices::default()) {
                Err(e) => panic!(
                    "seed {seed} step {step}, after {accepted} accepted edits, {command:?}: \
                     {e:?}, {:?}",
                    sim.build_diagnosis()
                ),
                Ok(review) if next(5) == 0 => {
                    sim.commit_build(review.token).unwrap();
                    sim.end_build().unwrap();
                    for _ in 0..(50 + next(1500)) {
                        sim.tick();
                    }
                    if let Err(e) = sim.begin_build() {
                        panic!("seed {seed}: Build re-entry refused {e:?}, {:?}", sim.build_diagnosis());
                    }
                }
                Ok(_) => {}
            }
        }
        eprintln!("seed {seed}: {accepted} accepted edits confirmed");
    }
}

#[test]
fn dirty_query_is_semantic_pure_and_preserves_prepared_tokens() {
    let mut sim = Sim::new_from_shipped_lot();
    assert!(!sim.build_dirty());
    sim.begin_build().unwrap();
    let baseline = sim.save_snapshot_v16();
    let outside = baseline.rooms.outside_name.clone();
    let token = sim
        .prepare_build_commit(RoomChoices::default())
        .unwrap()
        .token;
    let revision = sim.rooms_revision();
    let hash = sim.world_hash();
    for _ in 0..3 {
        assert!(!sim.build_dirty());
        assert_eq!(sim.rooms_revision(), revision);
        assert_eq!(sim.world_hash(), hash);
        assert_eq!(sim.validate_build_token(token), Ok(()));
    }
    sim.stage_room_name(RoomSelection::Outside, " Garden ".into())
        .unwrap();
    assert!(sim.build_dirty());
    sim.stage_room_name(RoomSelection::Outside, outside)
        .unwrap();
    assert!(!sim.build_dirty(), "A-B-A normalized names are clean");
    pave(&mut sim, 4);
    assert!(sim.build_dirty());
    pave(&mut sim, 0);
    assert!(
        !sim.build_dirty(),
        "an accepted journal can return to its baseline"
    );
    assert_eq!(sim.save_snapshot_v16(), baseline);
    sim.world
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetFloor {
            x: 17,
            y: 13,
            covering: 4,
        });
    let pending = save::v17::capture(&sim);
    assert!(sim.build_dirty());
    assert_eq!(
        save::v17::capture(&sim),
        pending,
        "query cannot settle queued input"
    );
    sim.cancel_build().unwrap();
    assert!(!sim.build_dirty());
    assert!(sim.build_active());
}

#[test]
fn failed_review_projection_preserves_existing_preparation_and_runtime() {
    let mut sim = Sim::new_from_shipped_lot();
    let person = sim
        .world
        .query_filtered::<Entity, With<terri_core::Agent>>()
        .iter(&sim.world)
        .next()
        .unwrap();
    sim.world
        .resource_mut::<crate::social_episode::requests::ConversationRequests>()
        .delays
        .insert(person, Some(7));
    sim.begin_build().unwrap();
    pave(&mut sim, 4);
    sim.stage_room_name(RoomSelection::Outside, "Pending garden".into())
        .unwrap();
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    let baseline = sim.save_snapshot_v16();
    let draft = save::v17::capture(&sim);
    let names = sim.build_rooms().unwrap();
    let runtime = crate::social_episode::requests::runtime::capture(&sim.world);
    assert_ne!(runtime, Default::default());
    let revision = sim.rooms_revision();
    let preparation = sim.world.resource::<BuildTransaction>().preparation;
    let pending_names = sim.world.resource::<BuildTransaction>().names.clone();
    assert!(sim.world.resource::<CommandQueue>().is_empty());
    let failed: Result<(), BuildCommitError> = sim
        .prepare_build_commit_projected(RoomChoices::default(), |_| {
            Err(BuildCommitError::AllocationFailed)
        });
    assert_eq!(failed, Err(BuildCommitError::AllocationFailed));
    assert_eq!(sim.save_snapshot_v16(), baseline);
    assert_eq!(save::v17::capture(&sim), draft);
    assert_eq!(sim.build_rooms().unwrap(), names);
    assert_eq!(
        crate::social_episode::requests::runtime::capture(&sim.world),
        runtime
    );
    assert_eq!(sim.rooms_revision(), revision);
    assert_eq!(
        sim.world.resource::<BuildTransaction>().preparation,
        preparation
    );
    assert_eq!(
        sim.world.resource::<BuildTransaction>().names,
        pending_names
    );
    assert_eq!(sim.validate_build_token(review.token), Ok(()));
    sim.commit_build(review.token).unwrap();
}

#[test]
fn loaded_pending_commands_settle_before_the_fresh_build_baseline() {
    let mut source = Sim::new_from_shipped_lot();
    for command in [
        SimCommand::SetFloor {
            x: 17,
            y: 13,
            covering: 4,
        },
        SimCommand::SetDeathEnabled(false),
        SimCommand::SetFloor {
            x: 17,
            y: 13,
            covering: 2,
        },
    ] {
        source.world.resource_mut::<CommandQueue>().push(command);
    }
    let incoming = source.save_snapshot_v16();
    source.flush_commands();
    assert_eq!(source.take_build_error(), None);
    let expected = source.save_snapshot_v16();
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    pave(&mut sim, 1);
    let old = sim
        .prepare_build_commit(RoomChoices::default())
        .unwrap()
        .token;
    sim.load_snapshot_v16(incoming).unwrap();
    assert!(sim.build_active());
    assert!(
        sim.world.resource::<CommandQueue>().is_empty(),
        "loaded stream must settle before baseline"
    );
    assert_eq!(sim.save_snapshot_v16(), expected);
    assert!(sim.world.resource::<BuildTransaction>().journal.is_empty());
    assert_eq!(sim.build_revision(), Some(0));
    let review = confirm(&mut sim);
    assert_ne!(review.token.session, old.session);
    assert_eq!(
        sim.validate_build_token(old),
        Err(BuildCommitError::StaleToken)
    );
    assert_eq!(sim.save_snapshot_v16(), expected);
}

#[test]
fn preparation_reports_counter_settlement_failure_without_a_candidate() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    sim.world.resource_mut::<BuildTransaction>().revision = u64::MAX;
    let baseline = sim.save_snapshot_v16();
    let draft = save::v17::capture(&sim);
    let view = sim.rooms_revision();
    sim.world
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetFloor {
            x: 17,
            y: 13,
            covering: 4,
        });
    assert_eq!(
        sim.prepare_build_commit(RoomChoices::default()),
        Err(BuildCommitError::CounterExhausted)
    );
    assert_eq!(sim.save_snapshot_v16(), baseline);
    assert_eq!(save::v17::capture(&sim), draft);
    assert_eq!(sim.rooms_revision(), view);
    assert!(sim.world.resource::<BuildTransaction>().prepared.is_none());
    assert_eq!(
        sim.take_build_error(),
        Some(BuildCommitError::CounterExhausted)
    );
}

#[test]
fn preparation_reports_reservation_failure_and_invalidates_an_existing_review() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    let old = sim
        .prepare_build_commit(RoomChoices::default())
        .unwrap()
        .token;
    let baseline = sim.save_snapshot_v16();
    let draft = save::v17::capture(&sim);
    let revision = sim.rooms_revision();
    sim.world
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetFloor {
            x: 17,
            y: 13,
            covering: 4,
        });
    sim.world
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetDeathEnabled(false));
    commands::drain_reserving(&mut sim.world, |journal| {
        journal
            .try_reserve(usize::MAX)
            .map_err(|_| BuildCommitError::AllocationFailed)
    });
    assert_eq!(
        sim.prepare_build_commit(RoomChoices::default()),
        Err(BuildCommitError::AllocationFailed)
    );
    assert_eq!(sim.commit_build(old), Err(BuildCommitError::StaleToken));
    assert_eq!(save::v17::capture(&sim), draft);
    assert_eq!(sim.save_snapshot_v16(), baseline);
    assert_eq!(sim.rooms_revision(), revision);
    assert_eq!(
        sim.take_build_error(),
        Some(BuildCommitError::AllocationFailed)
    );
}

#[test]
fn failed_loaded_command_settlement_keeps_the_existing_build_and_queue() {
    let mut incoming = Sim::new_with_lot(10, 8);
    incoming.world.resource_mut::<SavedRooms>().next_id = u32::MAX;
    incoming
        .world
        .resource_mut::<CommandQueue>()
        .push(SimCommand::BuildRoom {
            x0: 1,
            y0: 1,
            x1: 3,
            y1: 3,
            doorway: Some(WallLine {
                axis: EdgeAxis::Vertical,
                x: 4,
                y: 2,
            }),
        });
    let payload = incoming.save_snapshot_v16();
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    pave(&mut sim, 4);
    let token = sim
        .prepare_build_commit(RoomChoices::default())
        .unwrap()
        .token;
    sim.world
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetFloor {
            x: 17,
            y: 13,
            covering: 2,
        });
    let draft = save::v17::capture(&sim);
    let baseline = sim.save_snapshot_v16();
    let revision = sim.rooms_revision();
    assert_eq!(sim.load_snapshot_v16(payload), Err(SaveError::InvalidValue));
    assert_eq!(save::v17::capture(&sim), draft);
    assert_eq!(sim.save_snapshot_v16(), baseline);
    assert_eq!(sim.rooms_revision(), revision);
    assert_eq!(
        sim.world
            .resource::<BuildTransaction>()
            .prepared
            .as_ref()
            .unwrap()
            .review
            .token,
        token
    );
}

#[test]
fn cancel_exit_back_and_consecutive_batches_keep_the_correct_baseline() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    let first = sim.save_snapshot_v16();
    pave(&mut sim, 4);
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    sim.discard_build_review().unwrap();
    assert_eq!(
        sim.commit_build(review.token),
        Err(BuildCommitError::StaleToken)
    );
    assert_eq!(sim.world().resource::<SavedFloors>().covering(17, 13), 4);
    sim.cancel_build().unwrap();
    assert!(sim.build_active());
    assert_eq!(sim.save_snapshot_v16(), first);
    pave(&mut sim, 4);
    confirm(&mut sim);
    let second = sim.save_snapshot_v16();
    assert_ne!(first, second);
    pave(&mut sim, 1);
    sim.cancel_build().unwrap();
    assert_eq!(sim.save_snapshot_v16(), second);
    pave(&mut sim, 2);
    sim.end_build().unwrap();
    assert!(!sim.build_active());
    assert_eq!(sim.save_snapshot_v16(), second);
}

#[test]
fn tokens_never_resurrect_after_load_cancel_exit_or_repeated_submit() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    for action in 0..4 {
        let token = sim
            .prepare_build_commit(RoomChoices::default())
            .unwrap()
            .token;
        match action {
            0 => sim.cancel_build().unwrap(),
            1 => {
                let s = sim.save_snapshot_v16();
                sim.load_snapshot_v16(s).unwrap();
            }
            2 => {
                sim.end_build().unwrap();
                sim.begin_build().unwrap();
            }
            _ => sim.commit_build(token).unwrap(),
        }
        let fresh = sim.prepare_build_commit(RoomChoices::default()).unwrap();
        assert_ne!(fresh.token, token);
        assert_eq!(sim.commit_build(token), Err(BuildCommitError::StaleToken));
    }
}

#[test]
fn a_token_from_another_sim_or_new_household_cannot_adopt_a_candidate() {
    let mut first = Sim::new_from_shipped_lot();
    first.begin_build().unwrap();
    let token = first
        .prepare_build_commit(RoomChoices::default())
        .unwrap()
        .token;
    let mut replacement = Sim::new_from_shipped_lot();
    replacement.begin_build().unwrap();
    let review = replacement
        .prepare_build_commit(RoomChoices::default())
        .unwrap();
    assert_ne!(review.token.session, token.session);
    assert_eq!(
        replacement.commit_build(token),
        Err(BuildCommitError::StaleToken)
    );
}

#[test]
fn failed_submit_does_not_drain_a_queued_accepted_edit() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetFloor {
            x: 17,
            y: 13,
            covering: 4,
        });
    let baseline = sim.save_snapshot_v16();
    let draft = save::v17::capture(&sim);
    let revision = sim.rooms_revision();
    let queue = sim.world().resource::<CommandQueue>().as_slice().to_vec();
    assert_eq!(
        sim.commit_build(review.token),
        Err(BuildCommitError::DraftMismatch)
    );
    assert_eq!(sim.save_snapshot_v16(), baseline);
    assert_eq!(save::v17::capture(&sim), draft);
    assert_eq!(sim.rooms_revision(), revision);
    assert_eq!(
        sim.world().resource::<CommandQueue>().as_slice(),
        queue.as_slice()
    );
    sim.discard_build_review().unwrap();
    sim.flush_commands();
    confirm(&mut sim);
    assert_eq!(sim.world().resource::<SavedFloors>().covering(17, 13), 4);
}

#[test]
fn rejected_load_replay_and_final_validation_keep_baseline_and_draft() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    pave(&mut sim, 4);
    let baseline = sim.save_snapshot_v16();
    let draft = save::v17::capture(&sim);
    let mut invalid = baseline.clone();
    invalid.rooms.next_id = 0;
    assert!(sim.load_snapshot_v16(invalid).is_err());
    assert_eq!(sim.save_snapshot_v16(), baseline);
    assert_eq!(save::v17::capture(&sim), draft);
    let journal = sim.world.resource::<BuildTransaction>().journal.clone();
    sim.world.resource_mut::<BuildTransaction>().journal[0].command = SimCommand::SetFloor {
        x: u32::MAX,
        y: 0,
        covering: 4,
    };
    assert!(matches!(
        sim.prepare_build_commit(RoomChoices::default()),
        Err(BuildCommitError::ReplayMismatch { entry: 0 })
    ));
    assert_eq!(sim.save_snapshot_v16(), baseline);
    assert_eq!(save::v17::capture(&sim), draft);
    sim.world.resource_mut::<BuildTransaction>().journal = journal;
    let revision = sim.rooms_revision();
    let refused = sim.prepare_build_commit_validated(RoomChoices::default(), |candidate| {
        assert_eq!(
            candidate.world().resource::<SavedFloors>().covering(17, 13),
            4
        );
        Err(SaveError::InvalidValue)
    });
    assert_eq!(
        refused,
        Err(BuildCommitError::Validation(SaveError::InvalidValue))
    );
    assert_eq!(sim.save_snapshot_v16(), baseline);
    assert_eq!(save::v17::capture(&sim), draft);
    assert_eq!(sim.rooms_revision(), revision);
    confirm(&mut sim);
}

#[test]
fn ordinary_construction_allocator_failure_is_atomic_and_reported() {
    let mut sim = Sim::new_with_lot(10, 8);
    sim.world_mut().resource_mut::<SavedRooms>().next_id = u32::MAX;
    let before = sim.save_snapshot_v16();
    let revision = sim.rooms_revision();
    sim.load_snapshot_v16(before.clone()).unwrap();
    let revision = sim.rooms_revision().max(revision);
    issue(
        &mut sim,
        SimCommand::BuildRoom {
            x0: 1,
            y0: 1,
            x1: 3,
            y1: 3,
            doorway: Some(WallLine {
                axis: EdgeAxis::Vertical,
                x: 4,
                y: 2,
            }),
        },
    );
    assert_eq!(
        sim.take_build_error(),
        Some(BuildCommitError::Room(RoomError::IdExhausted))
    );
    assert_eq!(sim.save_snapshot_v16(), before);
    assert_eq!(sim.rooms_revision(), revision);
}

#[test]
fn every_public_snapshot_writer_reads_the_committed_baseline() {
    let mut sim = Sim::new_from_shipped_lot();
    let v1 = sim.save_snapshot();
    let v2 = sim.save_snapshot_v2();
    let v3 = sim.save_snapshot_v3();
    let v4 = sim.save_snapshot_v4();
    let v5 = sim.save_snapshot_v5();
    let v6 = sim.save_snapshot_v6();
    let v10 = sim.save_snapshot_v10();
    let v11 = sim.save_snapshot_v11();
    let v12 = sim.save_snapshot_v12();
    let v13 = sim.save_snapshot_v13();
    let v14 = sim.try_save_snapshot_v14();
    let v15 = sim
        .try_save_snapshot_v15()
        .expect("baseline is representable in V15");
    assert_eq!(sim.save_snapshot_v15(), v15);
    let v16 = sim.save_snapshot_v16();
    let v17 = sim.save_snapshot_v17();
    sim.begin_build().unwrap();
    pave(&mut sim, 4);
    assert_eq!(sim.save_snapshot(), v1);
    assert_eq!(sim.save_snapshot_v2(), v2);
    assert_eq!(sim.save_snapshot_v3(), v3);
    assert_eq!(sim.save_snapshot_v4(), v4);
    assert_eq!(sim.save_snapshot_v5(), v5);
    assert_eq!(sim.save_snapshot_v6(), v6);
    assert_eq!(sim.save_snapshot_v10(), v10);
    assert_eq!(sim.save_snapshot_v11(), v11);
    assert_eq!(sim.save_snapshot_v12(), v12);
    assert_eq!(sim.save_snapshot_v13(), v13);
    assert_eq!(sim.try_save_snapshot_v14(), v14);
    assert_eq!(sim.try_save_snapshot_v15(), Ok(v15.clone()));
    assert_eq!(sim.save_snapshot_v15(), v15);
    assert_eq!(sim.save_snapshot_v16(), v16);
    assert_eq!(sim.save_snapshot_v17(), v17);

    sim.cancel_build().unwrap();
    assert!(sim.build_active());
    assert_eq!(sim.try_save_snapshot_v15(), Ok(v15.clone()));
    assert_eq!(sim.save_snapshot_v15(), v15);
    assert_eq!(sim.save_snapshot_v16(), v16);
    assert_eq!(sim.save_snapshot_v17(), v17);

    // A no-op confirmation retains this admitted historical representation.
    // A changed Outside duty need not be representable by an older writer.
    confirm(&mut sim);
    assert!(sim.build_active());
    assert_eq!(sim.try_save_snapshot_v15(), Ok(v15.clone()));
    assert_eq!(sim.save_snapshot_v15(), v15);
    assert_eq!(sim.save_snapshot_v16(), v16);
    assert_eq!(sim.save_snapshot_v17(), v17);

    pave(&mut sim, 4);
    sim.cancel_build().unwrap();
    assert!(sim.build_active());
    assert_eq!(sim.try_save_snapshot_v15(), Ok(v15.clone()));
    assert_eq!(sim.save_snapshot_v15(), v15);
    assert_eq!(sim.save_snapshot_v16(), v16);
    assert_eq!(sim.save_snapshot_v17(), v17);
}

#[test]
fn preparations_invalidate_prior_choices_and_names_keep_one_outside_identity() {
    let mut sim = enclosed_blank();
    sim.begin_build().unwrap();
    sim.stage_room_name(RoomSelection::Outside, "  Garden  ".into())
        .unwrap();
    let first = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    assert_eq!(
        first
            .rooms
            .iter()
            .filter(|r| r.selection == RoomSelection::Outside)
            .count(),
        1
    );
    assert_eq!(first.rooms[0].name, "Garden");
    let second = sim
        .prepare_build_commit(RoomChoices {
            outside_name: Some("Patio".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        sim.validate_build_token(first.token),
        Err(BuildCommitError::StaleToken)
    );
    assert!(sim.validate_build_token(second.token).is_ok());
    sim.commit_build(second.token).unwrap();
    assert_eq!(sim.save_snapshot_v16().rooms.outside_name, "Patio");
}

#[test]
fn no_net_change_keeps_admitted_retired_registry_and_allocators_exact() {
    let mut sim = Sim::new_from_shipped_lot();
    {
        let mut rooms = sim.world_mut().resource_mut::<SavedRooms>();
        rooms.records.push(terri_core::rooms::RoomRecord {
            id: RoomId::new(9001).unwrap(),
            name: "Former study".into(),
            anchor: None,
        });
        rooms.next_id = 9002;
    }
    let original = sim.save_snapshot_v16();
    sim.load_snapshot_v16(original.clone()).unwrap();
    sim.begin_build().unwrap();
    confirm(&mut sim);
    assert_eq!(sim.save_snapshot_v16(), original);
}

#[test]
fn temporary_paving_removal_preserves_suspended_work() {
    let mut sim = crate::chores::build_transaction_fixture::suspended_floor(true);
    sim.begin_build().unwrap();
    let before = save::v17::capture(&sim);
    pave(&mut sim, 0);
    assert_eq!(
        sim.world()
            .resource::<terri_core::chores::SavedChores>()
            .tasks,
        before
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .chores
            .as_ref()
            .unwrap()
            .tasks,
        "temporary ineligibility must not prune suspended work"
    );
    pave(&mut sim, 4);
    confirm(&mut sim);
    assert_eq!(
        save::v17::capture(&sim),
        before,
        "remove and restore must preserve all work and random streams"
    );
}

#[test]
fn temporary_wall_removal_preserves_suspended_work() {
    let mut sim = crate::chores::build_transaction_fixture::suspended_floor(false);
    sim.begin_build().unwrap();
    let before = save::v17::capture(&sim);
    let edge = sim
        .world()
        .resource::<terri_core::layout::SavedLayout>()
        .edges()
        .iter()
        .copied()
        .find(|e| e.axis == EdgeAxis::Vertical && e.x == 8 && e.doorway)
        .expect("shipped kitchen doorway");
    issue(
        &mut sim,
        SimCommand::SetWallEdge {
            axis: edge.axis,
            x: edge.x,
            y: edge.y,
            state: WallState::Open,
        },
    );
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_wall_result
        .unwrap()
        .reason
        .is_none());
    issue(
        &mut sim,
        SimCommand::SetWallEdge {
            axis: edge.axis,
            x: edge.x,
            y: edge.y,
            state: WallState::Doorway,
        },
    );
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_wall_result
        .unwrap()
        .reason
        .is_none());
    confirm(&mut sim);
    let after = save::v17::capture(&sim);
    assert_eq!(after.legacy.rooms, before.legacy.rooms);
    assert_eq!(
        after
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .chores,
        before
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .chores
    );
    assert_eq!(
        after
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .domestic,
        before
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .domestic
    );
    let mut normalized = after;
    normalized
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .layout = before
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .layout
        .clone();
    assert_eq!(
        normalized, before,
        "all other saved state survives temporary construction"
    );
}

#[test]
fn unchanged_drains_and_blocked_gameplay_do_not_mutate_draft() {
    let mut sim = Sim::new_from_shipped_lot();
    crate::chores::ensure(sim.world_mut());
    {
        let mut chores = sim
            .world_mut()
            .resource_mut::<terri_core::chores::SavedChores>();
        chores.assignments.clear();
        chores.episodes.clear();
        chores.week = None;
    }
    let before = save::v17::capture(&sim);
    sim.begin_build().unwrap();
    assert_eq!(
        save::v17::capture(&sim),
        before,
        "entering Build with an empty queue must not assign existing unowned duties"
    );
    for _ in 0..3 {
        sim.flush_commands();
        sim.tick();
    }
    issue(&mut sim, SimCommand::SetDeathEnabled(false));
    assert_eq!(
        sim.take_build_error(),
        Some(BuildCommitError::CommandNotAllowed)
    );
    assert_eq!(save::v17::capture(&sim), before);
    confirm(&mut sim);
    assert_eq!(save::v17::capture(&sim), before);
}

#[test]
fn view_revision_tracks_names_edits_and_adoption_without_failed_operation_churn() {
    let mut sim = Sim::new_from_shipped_lot();
    let mut previous = sim.rooms_revision();
    pave(&mut sim, 4);
    assert!(sim.rooms_revision() > previous);
    previous = sim.rooms_revision();
    sim.begin_build().unwrap();
    assert!(sim.rooms_revision() > previous);
    previous = sim.rooms_revision();
    sim.stage_room_name(RoomSelection::Outside, "Garden".into())
        .unwrap();
    assert!(sim.rooms_revision() > previous);
    previous = sim.rooms_revision();
    assert!(sim
        .stage_room_name(RoomSelection::Outside, "".into())
        .is_err());
    assert_eq!(sim.rooms_revision(), previous);
    issue(
        &mut sim,
        SimCommand::SetFloor {
            x: u32::MAX,
            y: 0,
            covering: 4,
        },
    );
    assert_eq!(sim.rooms_revision(), previous);
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    assert_eq!(sim.rooms_revision(), previous);
    sim.commit_build(review.token).unwrap();
    assert!(sim.rooms_revision() > previous);
    previous = sim.rooms_revision();
    sim.cancel_build().unwrap();
    assert!(sim.rooms_revision() > previous);
    previous = sim.rooms_revision();
    let saved = sim.save_snapshot_v16();
    sim.load_snapshot_v16(saved).unwrap();
    assert!(sim.rooms_revision() > previous);
    previous = sim.rooms_revision();
    sim.end_build().unwrap();
    assert!(sim.rooms_revision() > previous);
}

fn enclosed_blank() -> Sim {
    let mut sim = Sim::new_with_lot(10, 8);
    issue(
        &mut sim,
        SimCommand::BuildRoom {
            x0: 1,
            y0: 1,
            x1: 7,
            y1: 5,
            doorway: Some(WallLine {
                axis: EdgeAxis::Vertical,
                x: 8,
                y: 3,
            }),
        },
    );
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_room_result
        .unwrap()
        .reason
        .is_none());
    let saved = sim.save_snapshot_v16();
    sim.load_snapshot_v16(saved).unwrap();
    sim
}

#[test]
fn prepared_predecessors_preserve_sparse_overlap_and_refusal_atomicity() {
    let mut sim = enclosed_blank();
    let wall = |sim: &mut Sim, x, state| {
        for y in 1..=5 {
            issue(
                sim,
                SimCommand::SetWallEdge {
                    axis: EdgeAxis::Vertical,
                    x,
                    y,
                    state,
                },
            );
        }
    };
    wall(&mut sim, 4, WallState::Wall);
    let old = sim.world.resource::<RoomMap>().clone();
    let a = match old.selection_at((1, 1)).unwrap() {
        RoomSelection::Room(id) => id,
        _ => panic!("enclosed A"),
    };
    let b = match old.selection_at((7, 1)).unwrap() {
        RoomSelection::Room(id) => id,
        _ => panic!("enclosed B"),
    };
    assert_ne!(a, b);
    sim.begin_build().unwrap();
    wall(&mut sim, 4, WallState::Open);
    wall(&mut sim, 3, WallState::Wall);
    wall(&mut sim, 6, WallState::Wall);
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    assert_eq!(review.groups[0].change.kind, RoomChangeKind::Repartition);
    for (anchor, expected) in [((1, 1), vec![a]), ((3, 1), vec![a, b]), ((6, 1), vec![b])] {
        let mut actual = sim
            .build_component_predecessors(review.token, anchor)
            .unwrap();
        actual.sort();
        let mut expected = expected;
        expected.sort();
        assert_eq!(actual, expected);
    }
    let baseline = sim.save_snapshot_v16();
    let draft = save::v17::capture(&sim);
    let bad = RoomChoices {
        inheritance: BTreeMap::from([((1, 1), Some(b))]),
        ..Default::default()
    };
    assert_eq!(
        sim.prepare_build_commit(bad),
        Err(BuildCommitError::Room(RoomError::InvalidChoice))
    );
    assert_eq!(sim.save_snapshot_v16(), baseline);
    assert_eq!(save::v17::capture(&sim), draft);
    assert_eq!(sim.validate_build_token(review.token), Ok(()));
    assert_eq!(
        sim.build_component_predecessors(review.token, (0, 0)),
        Err(BuildCommitError::InvalidRoom)
    );
    sim.discard_build_review().unwrap();
    assert_eq!(
        sim.build_component_predecessors(review.token, (1, 1)),
        Err(BuildCommitError::StaleToken)
    );
}

#[test]
fn prepared_report_people_keep_raw_indices_across_sparse_reused_entity_slots() {
    use terri_core::{chores::SavedChores, Position, SimId, SimName};
    let mut sim = Sim::new_with_lot(10, 8);
    for x in [2, 3] {
        issue(
            &mut sim,
            SimCommand::SetFloor {
                x,
                y: 2,
                covering: 4,
            },
        );
    }
    let _retained = sim.world.spawn_empty().id();
    let hole = sim.world.spawn_empty().id();
    sim.world.despawn(hole);
    let person = sim.spawn_agent(Position { x: 1., y: 2. }, 80.);
    assert_eq!(person.index_u32(), hole.index_u32());
    let stable = sim.world.get::<SimId>(person).unwrap().0;
    assert_ne!(person.index_u32(), stable);
    sim.world
        .entity_mut(person)
        .insert(SimName("Index witness".into()));
    crate::chores::ensure(&mut sim.world);
    {
        let mut chores = sim.world.resource_mut::<SavedChores>();
        chores.board_enabled = false;
        chores.floors = vec![(22, 800), (23, 800)];
    }
    issue(
        &mut sim,
        SimCommand::CleanChore {
            agent: person.index_u32(),
            key: terri_core::chores::ChoreKey {
                kind: terri_core::chores::ChoreKind::Floors,
                target: 0,
            },
        },
    );
    for _ in 0..20 {
        if !sim.world.resource::<SavedChores>().tasks.is_empty() {
            break;
        }
        sim.tick();
    }
    assert_eq!(
        sim.world.resource::<SavedChores>().tasks[0].cells,
        vec![22, 23]
    );
    sim.begin_build().unwrap();
    issue(
        &mut sim,
        SimCommand::BuildRoom {
            x0: 3,
            y0: 1,
            x1: 5,
            y1: 3,
            doorway: Some(WallLine {
                axis: EdgeAxis::Vertical,
                x: 6,
                y: 2,
            }),
        },
    );
    assert!(sim
        .world
        .resource::<crate::placement::LotEditState>()
        .last_room_result
        .unwrap()
        .reason
        .is_none());
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    let people: Vec<_> = review
        .duties
        .replanned_people
        .iter()
        .chain(&review.duties.unavailable_people)
        .copied()
        .collect();
    assert_eq!(people, vec![person.index_u32()]);
    let prepared = sim
        .world
        .resource::<BuildTransaction>()
        .prepared
        .as_ref()
        .unwrap();
    let candidate = crate::dining::entity(&prepared.candidate.world, people[0]).unwrap();
    assert_ne!(
        person, candidate,
        "restoration need not preserve Entity generations"
    );
    assert_eq!(
        prepared.candidate.world.get::<SimId>(candidate).unwrap().0,
        stable
    );
    assert_eq!(
        prepared.candidate.world.get::<SimName>(candidate),
        sim.world.get::<SimName>(person)
    );
    assert_eq!(sim.validate_build_token(review.token), Ok(()));
}

#[test]
fn split_remerge_and_lost_review_use_final_token_bound_geometry() {
    let mut sim = enclosed_blank();
    sim.begin_build().unwrap();
    let original = sim.save_snapshot_v16();
    for y in 1..=5 {
        issue(
            &mut sim,
            SimCommand::SetWallEdge {
                axis: EdgeAxis::Vertical,
                x: 4,
                y,
                state: if y == 3 {
                    WallState::Doorway
                } else {
                    WallState::Wall
                },
            },
        );
        assert!(sim
            .world()
            .resource::<crate::placement::LotEditState>()
            .last_wall_result
            .unwrap()
            .reason
            .is_none());
    }
    let split = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    assert_eq!(split.groups.len(), 1);
    assert_eq!(split.groups[0].change.kind, RoomChangeKind::Split);
    for anchor in &split.groups[0].change.final_anchors {
        assert!(!sim
            .build_component_tiles(split.token, *anchor)
            .unwrap()
            .is_empty());
    }
    for y in 1..=5 {
        issue(
            &mut sim,
            SimCommand::SetWallEdge {
                axis: EdgeAxis::Vertical,
                x: 4,
                y,
                state: WallState::Open,
            },
        );
    }
    assert_eq!(
        sim.validate_build_token(split.token),
        Err(BuildCommitError::StaleToken)
    );
    confirm(&mut sim);
    assert_eq!(sim.save_snapshot_v16().rooms, original.rooms);
    issue(
        &mut sim,
        SimCommand::SetWallEdge {
            axis: EdgeAxis::Vertical,
            x: 8,
            y: 3,
            state: WallState::Open,
        },
    );
    let lost = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    assert_eq!(lost.groups[0].change.kind, RoomChangeKind::LostEnclosure);
    assert_eq!(lost.groups[0].former_tiles.len(), 35);
    assert!(lost.groups[0].openings.contains(&WallLine {
        axis: EdgeAxis::Vertical,
        x: 8,
        y: 3
    }));
    assert!(lost.groups[0].change.final_anchors.is_empty());
    sim.commit_build(lost.token).unwrap();
    assert!(sim.world().resource::<RoomMap>().component_ids.is_empty());
}

#[test]
fn unchanged_walls_with_moved_counter_reconcile_surface_membership() {
    let mut sim = Sim::new_from_shipped_lot();
    crate::chores::ensure(sim.world_mut());
    let object = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<Content>().0.object(o.0).id == "counter")
        .unwrap()
        .0;
    let at = *sim.world().get::<terri_core::Position>(object).unwrap();
    let old = sim
        .world()
        .resource::<RoomMap>()
        .selection_at((at.x as u32, at.y as u32))
        .unwrap();
    let facing = sim
        .world()
        .get::<terri_core::ObjectFacing>(object)
        .unwrap()
        .0;
    let destination = (0..16)
        .flat_map(|y| (0..19).map(move |x| (x, y)))
        .find(|tile| {
            sim.world()
                .resource::<RoomMap>()
                .selection_at(*tile)
                .is_some_and(|room| room != old)
                && crate::placement::validate_placement(
                    sim.world(),
                    object.index_u32(),
                    *tile,
                    facing,
                )
                .is_ok()
        })
        .unwrap();
    sim.begin_build().unwrap();
    let rooms = sim.save_snapshot_v16().rooms;
    issue(
        &mut sim,
        SimCommand::PlaceObject {
            object: object.index_u32(),
            x: destination.0,
            y: destination.1,
            facing,
        },
    );
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_result
        .unwrap()
        .reason
        .is_none());
    let review = confirm(&mut sim);
    assert_eq!(sim.save_snapshot_v16().rooms, rooms);
    let new = sim
        .world()
        .resource::<RoomMap>()
        .selection_at(destination)
        .unwrap();
    assert_ne!(new, old);
    assert!(review.duties.duties.iter().any(|d| d.key.kind
        == terri_core::chores::ChoreKind::CounterSurfaces
        && d.key.target == new.key()));
}

#[test]
fn mixed_journal_replays_books_furniture_floor_money_and_land_exactly() {
    use terri_core::command::BookCommand;
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut()
        .insert_resource(terri_core::Funds::from_dollars(100000));
    sim.begin_build().unwrap();
    let baseline = sim.save_snapshot_v16();
    pave(&mut sim, 4);
    let pack = sim.world().resource::<Content>().0;
    let definition = pack.find("armchair").unwrap();
    let facing = pack.object(definition).base_facing;
    let placement = crate::placement::purchase::Purchase {
        definition: definition.0,
        x: 16,
        y: 13,
        facing,
    };
    assert!(crate::placement::purchase::validate_purchase(sim.world(), placement).is_ok());
    issue(
        &mut sim,
        SimCommand::BuyObjectInColourway {
            definition: definition.0,
            x: 16,
            y: 13,
            facing,
            colourway: 0,
        },
    );
    let bought = sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_purchase_result
        .unwrap()
        .object
        .unwrap();
    issue(
        &mut sim,
        SimCommand::SetColourway {
            object: bought,
            colourway: 1,
        },
    );
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_colourway_result
        .unwrap()
        .reason
        .is_none());
    issue(
        &mut sim,
        SimCommand::PlaceObject {
            object: bought,
            x: 17,
            y: 14,
            facing,
        },
    );
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_result
        .unwrap()
        .reason
        .is_none());
    let quote = sim.book_purchase_quote().unwrap();
    issue(
        &mut sim,
        SimCommand::Book(BookCommand::AutoPurchase {
            quote: quote.clone(),
        }),
    );
    let before_reject = save::v17::capture(&sim);
    let journal_count = sim.world.resource::<BuildTransaction>().journal.len();
    let receipt_sequence = sim.world.resource::<crate::books::BookFeedback>().sequence;
    issue(
        &mut sim,
        SimCommand::Book(BookCommand::AutoPurchase { quote }),
    );
    assert_eq!(save::v17::capture(&sim), before_reject);
    assert_eq!(
        sim.world.resource::<BuildTransaction>().journal.len(),
        journal_count
    );
    assert_eq!(
        sim.world.resource::<crate::books::BookFeedback>().sequence,
        receipt_sequence + 1,
        "refusal feedback is transient, not an identity allocation"
    );
    let copy = sim.take_book_results().iter().find_map(|r| r.copy).unwrap();
    issue(
        &mut sim,
        SimCommand::Book(BookCommand::Transfer { copy, shelf: None }),
    );
    let shelf = sim
        .book_copies()
        .iter()
        .find(|c| c.id.0 == copy)
        .unwrap()
        .home
        .unwrap()
        .shelf
        .0 as u32;
    let sale = sim.book_sale_quote(shelf).unwrap();
    issue(
        &mut sim,
        SimCommand::Book(BookCommand::Sell { quote: sale }),
    );
    issue(&mut sim, SimCommand::SellObject { object: bought });
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_sale_result
        .unwrap()
        .reason
        .is_none());
    issue(&mut sim, SimCommand::BuyLand { side: 0 });
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_land_result
        .unwrap()
        .reason
        .is_none());
    issue(&mut sim, SimCommand::BuyLand { side: 2 });
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_land_result
        .unwrap()
        .reason
        .is_none());
    let draft = save::v17::capture(&sim).legacy;
    assert_eq!(sim.save_snapshot_v16(), baseline);
    confirm(&mut sim);
    let after = sim.save_snapshot_v16();
    assert_eq!(
        after.legacy.legacy.legacy.funds_cents,
        draft.legacy.legacy.legacy.funds_cents
    );
    assert_eq!(
        after.legacy.legacy.legacy.lot_frame,
        draft.legacy.legacy.legacy.lot_frame
    );
    assert_eq!(
        after.legacy.legacy.legacy.legacy.legacy.legacy.legacy.books,
        draft.legacy.legacy.legacy.legacy.legacy.legacy.legacy.books
    );
    assert_eq!(
        after
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .world
            .entities,
        draft
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .world
            .entities
    );
    assert_eq!(
        after.rooms.records.iter().map(|r| r.id).collect::<Vec<_>>(),
        baseline
            .rooms
            .records
            .iter()
            .map(|r| r.id)
            .collect::<Vec<_>>()
    );
    sim.load_snapshot_v16(after.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v16(), after);
}

#[test]
fn paving_grass_reconciles_new_outside_duty_without_new_room_ids() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    let rooms = sim.save_snapshot_v16().rooms;
    let key = terri_core::chores::ChoreKey {
        kind: terri_core::chores::ChoreKind::Floors,
        target: 0,
    };
    assert!(!crate::chores::keys(sim.world()).contains(&key));
    pave(&mut sim, 4);
    let review = confirm(&mut sim);
    assert_eq!(sim.save_snapshot_v16().rooms, rooms);
    assert!(crate::chores::keys(sim.world()).contains(&key));
    assert!(review.duties.duties.iter().any(|d| d.key == key));
}

#[test]
fn no_net_and_rename_confirm_preserve_admitted_stale_group_need() {
    for rename in [false, true] {
        let mut sim = Sim::new_from_shipped_lot();
        crate::chores::ensure(sim.world_mut());
        sim.flush_commands();
        {
            let mut state = sim
                .world_mut()
                .resource_mut::<terri_core::chores::SavedChores>();
            assert!(state.surfaces.is_empty());
            assert!(state.tasks.is_empty());
            let episode = state
                .episodes
                .iter_mut()
                .find(|e| e.key.kind.grouped())
                .unwrap();
            assert!(!episode.settled);
            episode.needed = true;
            episode.decision = Some(false);
            episode.outcome = terri_core::chores::DutyOutcome::Skipped;
        }
        let baseline = sim.save_snapshot_v16();
        sim.load_snapshot_v16(baseline.clone())
            .expect("stale daily need is admitted current state");
        assert_eq!(sim.save_snapshot_v16(), baseline);
        let chores = sim
            .world()
            .resource::<terri_core::chores::SavedChores>()
            .clone();
        let rng = sim.world().resource::<terri_core::SimRng>().clone();
        sim.begin_build().unwrap();
        if rename {
            sim.stage_room_name(RoomSelection::Outside, "Garden".into())
                .unwrap();
        }
        confirm(&mut sim);
        assert_eq!(
            sim.world().resource::<terri_core::chores::SavedChores>(),
            &chores
        );
        assert_eq!(sim.world().resource::<terri_core::SimRng>(), &rng);
        if !rename {
            assert_eq!(sim.save_snapshot_v16(), baseline);
        }
    }
}
