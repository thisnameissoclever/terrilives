use super::*;
use terri_core::{Agent, CommandQueue, SimClock, SimCommand};

fn issue(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
}
fn floor(covering: u8) -> SimCommand {
    SimCommand::SetFloor {
        x: 17,
        y: 13,
        covering,
    }
}
fn bed_feedback(sim: &Sim) -> (u64, Option<crate::beds::AssignmentResult>) {
    let feedback = sim.world().resource::<crate::beds::AssignmentFeedback>();
    (feedback.sequence, feedback.last)
}

#[test]
fn construction_preserves_exact_player_ownership_and_session_history() {
    use terri_core::SmartObject;
    let mut sim = Sim::new_from_shipped_lot();
    let actor = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    let pack = sim.world().resource::<crate::Content>().0;
    let object = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| pack.object(object.0).id == "fridge")
        .map(|(entity, _)| entity)
        .unwrap();
    issue(
        &mut sim,
        SimCommand::UseObject {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        },
    );
    issue(&mut sim, floor(4));
    sim.flush_commands();
    let accepted = sim.action_events_since(0);
    assert_eq!(accepted.events.len(), 1);
    assert_eq!(accepted.events[0].phase, "accepted");
    assert_eq!(accepted.events[0].actor, actor.index_u32());
    let order_id = accepted.events[0].order_id;
    let current_actor = crate::dining::entity(sim.world(), actor.index_u32()).unwrap();
    assert_eq!(
        sim.world()
            .get::<terri_core::IntentQueue>(current_actor)
            .unwrap()
            .entries()[0]
            .id,
        order_id
    );
    for construction in [floor(4), floor(5)] {
        issue(&mut sim, construction);
        sim.flush_commands();
        let history = sim.action_events_since(0);
        assert_eq!(history.next_cursor, accepted.next_cursor);
        assert_eq!(history.events.len(), 1);
        assert_eq!(history.events[0].order_id, order_id);
    }
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: actor.index_u32(),
        },
    );
    sim.flush_commands();
    let history = sim.action_events_since(0);
    assert_eq!(history.events.len(), 2);
    assert_eq!(history.events[1].phase, "canceled");
    assert_eq!(history.events[1].order_id, order_id);
    assert!(history.events[1].sequence > accepted.next_cursor);
}

#[test]
fn ordinary_runtime_keeps_prior_bed_receipt_after_accepted_construction() {
    let mut sim = Sim::new_from_shipped_lot();
    let person = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    issue(
        &mut sim,
        SimCommand::SetBedAssignment {
            agent: person.index_u32(),
            place: None,
        },
    );
    sim.flush_commands();
    let before = bed_feedback(&sim);
    assert!(before.0 > 0);
    assert!(before.1.unwrap().refusal.is_none());
    issue(&mut sim, floor(4));
    sim.flush_commands();
    assert_eq!(bed_feedback(&sim), before);
}

#[test]
fn ordinary_runtime_returns_new_bed_refusal_with_noop_or_refused_construction() {
    for construction in [
        floor(0),
        SimCommand::SetFloor {
            x: u32::MAX,
            y: 0,
            covering: 4,
        },
    ] {
        let mut sim = Sim::new_from_shipped_lot();
        sim.flush_commands();
        let before = sim.save_snapshot_v17();
        let sequence = bed_feedback(&sim).0;
        issue(
            &mut sim,
            SimCommand::SetBedAssignment {
                agent: u32::MAX,
                place: None,
            },
        );
        issue(&mut sim, construction);
        sim.flush_commands();
        assert_eq!(sim.save_snapshot_v17(), before);
        assert_eq!(
            bed_feedback(&sim),
            (
                sequence + 1,
                Some(crate::beds::AssignmentResult {
                    agent: u32::MAX,
                    place: None,
                    refusal: Some(crate::beds::AssignmentRefusal::UnknownSim)
                })
            )
        );
    }
}

#[test]
fn ordinary_runtime_keeps_unchanged_door_interpolation() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.sync_render_buffer();
    for _ in 0..300 {
        sim.tick();
        sim.sync_render_buffer();
        if sim.portal_buffer().previous_openness != sim.portal_buffer().openness {
            break;
        }
    }
    let previous = sim.portal_buffer().previous_openness.clone();
    let current = sim.portal_buffer().openness.clone();
    let positions = sim.portal_buffer().positions.clone();
    assert_ne!(previous, current, "the test needs a real transition");
    issue(&mut sim, floor(4));
    sim.flush_commands();
    sim.sync_render_buffer_after_commands();
    assert_eq!(sim.portal_buffer().positions, positions);
    assert_eq!(sim.portal_buffer().openness, current);
    assert_eq!(sim.portal_buffer().previous_openness, previous);
}

#[test]
fn ordinary_runtime_failed_drain_consumes_requests_and_clears_old_sounds() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut().resource_mut::<SavedRooms>().next_id = u32::MAX;
    let before = sim.save_snapshot_v17();
    let revision = sim.rooms_revision();
    sim.world_mut()
        .resource_mut::<crate::completion_sounds::CompletionSounds>()
        .push(crate::completion_sounds::TOILET_FLUSH, 0);
    issue(
        &mut sim,
        SimCommand::BuildRoom {
            x0: 17,
            y0: 13,
            x1: 17,
            y1: 13,
            doorway: None,
        },
    );
    assert!(!sim.world().resource::<CommandQueue>().is_empty());
    assert!(!sim.completion_sounds().is_empty());
    sim.flush_commands();
    assert_eq!(
        sim.take_build_error(),
        Some(BuildCommitError::Room(RoomError::IdExhausted))
    );
    assert!(sim.world().resource::<CommandQueue>().is_empty());
    assert!(sim.completion_sounds().is_empty());
    assert_eq!(sim.save_snapshot_v17(), before);
    assert_eq!(sim.rooms_revision(), revision);
}

#[test]
fn ordinary_runtime_tick_and_explicit_flush_then_tick_have_identical_durable_results() {
    let mut ticked = Sim::new_from_shipped_lot();
    let initial = ticked.save_snapshot_v17();
    let mut flushed = Sim::new_from_shipped_lot();
    flushed.load_snapshot_v17(initial).unwrap();
    let time = ticked.world().resource::<SimClock>().tick;
    for sim in [&mut ticked, &mut flushed] {
        issue(sim, SimCommand::SetChoreBoard { enabled: true });
        issue(sim, floor(4));
        issue(
            sim,
            SimCommand::SetBedAssignment {
                agent: u32::MAX,
                place: None,
            },
        );
        issue(sim, SimCommand::BuyLand { side: u32::MAX });
    }
    ticked.tick();
    flushed.flush_commands();
    flushed.tick();
    assert_eq!(ticked.world().resource::<SimClock>().tick, time + 1);
    assert_eq!(ticked.save_snapshot_v17(), flushed.save_snapshot_v17());
    assert_eq!(bed_feedback(&ticked), bed_feedback(&flushed));
}

#[test]
fn empty_input_still_clears_sounds_and_refreshes_grouped_work() {
    let mut sim = Sim::new_from_shipped_lot();
    crate::chores::ensure(sim.world_mut());
    sim.flush_commands();
    let key = {
        let mut state = sim
            .world_mut()
            .resource_mut::<terri_core::chores::SavedChores>();
        let episode = state
            .episodes
            .iter_mut()
            .find(|e| e.key.kind.grouped())
            .unwrap();
        episode.needed = true;
        episode.decision = Some(false);
        episode.outcome = terri_core::chores::DutyOutcome::Skipped;
        episode.key
    };
    sim.world_mut()
        .resource_mut::<crate::completion_sounds::CompletionSounds>()
        .push(crate::completion_sounds::TOILET_FLUSH, 0);
    let time = sim.world().resource::<SimClock>().tick;
    assert!(sim.world().resource::<CommandQueue>().is_empty());
    sim.flush_commands();
    let state = sim.world().resource::<terri_core::chores::SavedChores>();
    let episode = state.episodes.iter().find(|e| e.key == key).unwrap();
    assert!(!episode.needed);
    assert_eq!(episode.outcome, terri_core::chores::DutyOutcome::NoWork);
    assert_eq!(episode.decision, Some(false));
    assert!(sim.completion_sounds().is_empty());
    assert_eq!(sim.world().resource::<SimClock>().tick, time);
}
