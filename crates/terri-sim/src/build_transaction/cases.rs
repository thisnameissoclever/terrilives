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

#[test]
fn cancel_exit_back_and_consecutive_batches_keep_the_correct_baseline() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    let first = sim.save_snapshot_v15();
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
    assert_eq!(sim.save_snapshot_v15(), first);
    pave(&mut sim, 4);
    confirm(&mut sim);
    let second = sim.save_snapshot_v15();
    assert_ne!(first, second);
    pave(&mut sim, 1);
    sim.cancel_build().unwrap();
    assert_eq!(sim.save_snapshot_v15(), second);
    pave(&mut sim, 2);
    sim.end_build().unwrap();
    assert!(!sim.build_active());
    assert_eq!(sim.save_snapshot_v15(), second);
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
                let s = sim.save_snapshot_v15();
                sim.load_snapshot_v15(s).unwrap();
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
    let baseline = sim.save_snapshot_v15();
    let draft = save::v15::capture(&sim);
    let revision = sim.rooms_revision();
    let queue = sim.world().resource::<CommandQueue>().as_slice().to_vec();
    assert_eq!(
        sim.commit_build(review.token),
        Err(BuildCommitError::DraftMismatch)
    );
    assert_eq!(sim.save_snapshot_v15(), baseline);
    assert_eq!(save::v15::capture(&sim), draft);
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
    let baseline = sim.save_snapshot_v15();
    let draft = save::v15::capture(&sim);
    let mut invalid = baseline.clone();
    invalid.rooms.next_id = 0;
    assert!(sim.load_snapshot_v15(invalid).is_err());
    assert_eq!(sim.save_snapshot_v15(), baseline);
    assert_eq!(save::v15::capture(&sim), draft);
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
    assert_eq!(sim.save_snapshot_v15(), baseline);
    assert_eq!(save::v15::capture(&sim), draft);
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
    assert_eq!(sim.save_snapshot_v15(), baseline);
    assert_eq!(save::v15::capture(&sim), draft);
    assert_eq!(sim.rooms_revision(), revision);
    confirm(&mut sim);
}

#[test]
fn ordinary_construction_allocator_failure_is_atomic_and_reported() {
    let mut sim = Sim::new_with_lot(10, 8);
    sim.world_mut().resource_mut::<SavedRooms>().next_id = u32::MAX;
    let before = sim.save_snapshot_v15();
    let revision = sim.rooms_revision();
    sim.load_snapshot_v15(before.clone()).unwrap();
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
    assert_eq!(sim.save_snapshot_v15(), before);
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
    let v15 = sim.save_snapshot_v15();
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
    assert_eq!(sim.save_snapshot_v15(), v15);
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
    assert_eq!(sim.save_snapshot_v15().rooms.outside_name, "Patio");
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
    let original = sim.save_snapshot_v15();
    sim.load_snapshot_v15(original.clone()).unwrap();
    sim.begin_build().unwrap();
    confirm(&mut sim);
    assert_eq!(sim.save_snapshot_v15(), original);
}

#[test]
fn temporary_paving_removal_preserves_suspended_work() {
    let mut sim = crate::chores::build_transaction_fixture::suspended_floor(true);
    sim.begin_build().unwrap();
    let before = save::v15::capture(&sim);
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
            .chores
            .as_ref()
            .unwrap()
            .tasks,
        "temporary ineligibility must not prune suspended work"
    );
    pave(&mut sim, 4);
    confirm(&mut sim);
    assert_eq!(
        save::v15::capture(&sim),
        before,
        "remove and restore must preserve all work and random streams"
    );
}

#[test]
fn temporary_wall_removal_preserves_suspended_work() {
    let mut sim = crate::chores::build_transaction_fixture::suspended_floor(false);
    sim.begin_build().unwrap();
    let before = save::v15::capture(&sim);
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
    let after = save::v15::capture(&sim);
    assert_eq!(after.rooms, before.rooms);
    assert_eq!(
        after
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
            .domestic,
        before
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
        .layout = before
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
    let before = save::v15::capture(&sim);
    sim.begin_build().unwrap();
    assert_eq!(
        save::v15::capture(&sim),
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
    assert_eq!(save::v15::capture(&sim), before);
    confirm(&mut sim);
    assert_eq!(save::v15::capture(&sim), before);
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
    let saved = sim.save_snapshot_v15();
    sim.load_snapshot_v15(saved).unwrap();
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
    let saved = sim.save_snapshot_v15();
    sim.load_snapshot_v15(saved).unwrap();
    sim
}

#[test]
fn split_remerge_and_lost_review_use_final_token_bound_geometry() {
    let mut sim = enclosed_blank();
    sim.begin_build().unwrap();
    let original = sim.save_snapshot_v15();
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
    assert_eq!(sim.save_snapshot_v15().rooms, original.rooms);
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
    let rooms = sim.save_snapshot_v15().rooms;
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
    assert_eq!(sim.save_snapshot_v15().rooms, rooms);
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
    let baseline = sim.save_snapshot_v15();
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
    let before_reject = save::v15::capture(&sim);
    let journal_count = sim.world.resource::<BuildTransaction>().journal.len();
    let receipt_sequence = sim.world.resource::<crate::books::BookFeedback>().sequence;
    issue(
        &mut sim,
        SimCommand::Book(BookCommand::AutoPurchase { quote }),
    );
    assert_eq!(save::v15::capture(&sim), before_reject);
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
    let draft = save::v15::capture(&sim);
    assert_eq!(sim.save_snapshot_v15(), baseline);
    confirm(&mut sim);
    let after = sim.save_snapshot_v15();
    assert_eq!(
        after.legacy.legacy.funds_cents,
        draft.legacy.legacy.funds_cents
    );
    assert_eq!(after.legacy.legacy.lot_frame, draft.legacy.legacy.lot_frame);
    assert_eq!(
        after.legacy.legacy.legacy.legacy.legacy.legacy.books,
        draft.legacy.legacy.legacy.legacy.legacy.legacy.books
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
    sim.load_snapshot_v15(after.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v15(), after);
}

#[test]
fn paving_grass_reconciles_new_outside_duty_without_new_room_ids() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    let rooms = sim.save_snapshot_v15().rooms;
    let key = terri_core::chores::ChoreKey {
        kind: terri_core::chores::ChoreKind::Floors,
        target: 0,
    };
    assert!(!crate::chores::keys(sim.world()).contains(&key));
    pave(&mut sim, 4);
    let review = confirm(&mut sim);
    assert_eq!(sim.save_snapshot_v15().rooms, rooms);
    assert!(crate::chores::keys(sim.world()).contains(&key));
    assert!(review.duties.duties.iter().any(|d| d.key == key));
}
