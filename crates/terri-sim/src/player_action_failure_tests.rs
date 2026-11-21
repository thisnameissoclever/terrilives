use super::*;
use terri_core::{
    layout::{EdgeAxis, SavedLayout, WallEdge},
    CommandQueue, Position, SimCommand, TileGrid,
};

fn media_fixture() -> (crate::Sim, Entity, Entity) {
    let mut sim = crate::Sim::new_with_lot(8, 8);
    let radio = sim.spawn_object(
        Position { x: 4., y: 4. },
        terri_data::pack().find("radio").unwrap(),
    );
    let actor = sim.spawn_agent(Position { x: 3., y: 4. }, 50.);
    // The back of the radio is reachable. Its entire viewing side is behind a wall.
    let edges: Vec<_> = (0..8)
        .map(|y| WallEdge {
            axis: EdgeAxis::Vertical,
            x: 5,
            y,
            doorway: false,
        })
        .collect();
    {
        let mut grid = sim.world_mut().resource_mut::<TileGrid>();
        grid.set_blocked(4, 4, true);
        for edge in &edges {
            let [a, b] = edge.cells();
            grid.set_edge_blocked(a, b, true);
        }
    }
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges });
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: radio.index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
    (sim, actor, radio)
}

#[test]
fn real_media_plan_failure_owns_its_typed_cause_and_keeps_raw_event() {
    let (mut sim, actor, radio) = media_fixture();
    let accepted = sim.action_events_since(0);
    assert!(accepted
        .events
        .iter()
        .any(|event| event.phase == "accepted"));
    for _ in 0..4 {
        sim.tick();
        if sim
            .action_events_since(0)
            .events
            .iter()
            .any(|event| event.phase == "failed")
        {
            break;
        }
    }
    let batch = sim.action_events_since(0);
    let failed = batch
        .events
        .iter()
        .find(|event| event.phase == "failed")
        .expect("real unreachable media plan fails");
    assert_eq!(
        (failed.actor, failed.counterpart),
        (actor.index_u32(), Some(radio.index_u32()))
    );
    assert_eq!(
        failed.reason.as_deref(),
        Some("No reachable media position")
    );
    assert_eq!(
        sim.action_failure_cause(failed.sequence),
        Some(OrderFailureCause::NoReachableMediaPosition)
    );
    for event in batch
        .events
        .iter()
        .filter(|event| event.sequence != failed.sequence)
    {
        assert_eq!(sim.action_failure_cause(event.sequence), None);
    }
    assert!(!sim
        .action_queue_rows_of(actor.index_u32(), 100)
        .iter()
        .any(|row| row.order_id == Some(failed.order_id)));
    let before = (sim.world_hash(), sim.save_snapshot_v26());
    for _ in 0..3 {
        assert_eq!(
            sim.action_failure_cause(failed.sequence),
            Some(OrderFailureCause::NoReachableMediaPosition)
        );
    }
    assert_eq!((sim.world_hash(), sim.save_snapshot_v26()), before);
    sim.load_snapshot_v26(before.1).unwrap();
    assert!(sim.action_events_since(0).events.is_empty());
    assert_eq!(sim.action_failure_cause(failed.sequence), None);
    reject_submission(sim.world_mut(), actor.index_u32(), "unrelated rejection");
    assert!(sim.action_events_since(batch.next_cursor).next_cursor > batch.next_cursor);
}

#[test]
fn causes_share_ring_eviction_and_lookup_is_logarithmic() {
    let (mut sim, actor, _) = media_fixture();
    let state = sim
        .world()
        .resource::<PlayerActions>()
        .orders
        .values()
        .next()
        .unwrap()
        .clone();
    let before = (sim.world_hash(), sim.save_snapshot_v26());
    emit_with_cause(
        sim.world_mut(),
        actor,
        &state,
        "failed",
        Some("technical detail"),
        Some(OrderFailureCause::NoReachableMediaPosition),
    );
    let evicted = sim.action_events_since(0).next_cursor;
    for index in 0..4096 {
        if index % 2 == 0 {
            emit(sim.world_mut(), actor, &state, "waiting", None);
        } else {
            reject_submission(
                sim.world_mut(),
                actor.index_u32(),
                "No reachable media position",
            );
        }
    }
    assert_eq!(sim.action_failure_cause(evicted), None);
    emit_with_cause(
        sim.world_mut(),
        actor,
        &state,
        "failed",
        Some("different raw reason"),
        Some(OrderFailureCause::NoReachableMediaPosition),
    );
    let current = sim.action_events_since(0).next_cursor;
    let diagnostics = sim.world().resource::<ActionDiagnostics>();
    let mut inspected = 0;
    assert_eq!(
        diagnostics.lookup_failure_cause(current, || inspected += 1),
        Some(OrderFailureCause::NoReachableMediaPosition)
    );
    assert!(
        inspected <= 12,
        "full-ring lookup inspected {inspected} records"
    );
    assert_eq!(diagnostics.records.len(), 2048);
    assert_eq!(diagnostics.lookup_failure_cause(0, || {}), None);
    assert_eq!(diagnostics.lookup_failure_cause(current + 1, || {}), None);
    let copy = diagnostics.clone();
    assert_eq!(
        copy.lookup_failure_cause(current, || {}),
        Some(OrderFailureCause::NoReachableMediaPosition)
    );
    assert_eq!((sim.world_hash(), sim.save_snapshot_v26()), before);
}

#[test]
fn cause_lookup_handles_sparse_large_sequences_and_rejects_inverted_ranges() {
    let (mut sim, actor, _) = media_fixture();
    let state = sim
        .world()
        .resource::<PlayerActions>()
        .orders
        .values()
        .next()
        .unwrap()
        .clone();
    sim.world_mut().resource_mut::<ActionDiagnostics>().sequence = 9_007_199_254_740_991;
    emit_with_cause(
        sim.world_mut(),
        actor,
        &state,
        "failed",
        None,
        Some(OrderFailureCause::NoReachableMediaPosition),
    );
    let sequence = sim.action_events_since(0).next_cursor;
    assert_eq!(sequence, 9_007_199_254_740_992);
    assert_eq!(
        sim.action_failure_cause(sequence),
        Some(OrderFailureCause::NoReachableMediaPosition)
    );
    assert_eq!(sim.action_failure_cause(sequence - 1), None);
    let mut diagnostics = sim.world_mut().resource_mut::<ActionDiagnostics>();
    let last = diagnostics.records.len() - 1;
    diagnostics.records.swap(0, last);
    assert_eq!(diagnostics.lookup_failure_cause(sequence, || {}), None);
    diagnostics.records.back_mut().unwrap().event.sequence = 0;
    assert_eq!(diagnostics.lookup_failure_cause(0, || {}), None);
}

#[test]
fn the_same_actor_local_order_id_does_not_share_a_cause_between_people() {
    let (mut sim, actor, _) = media_fixture();
    let other = sim.spawn_agent(Position { x: 6., y: 6. }, 50.);
    let state = sim
        .world()
        .resource::<PlayerActions>()
        .orders
        .values()
        .next()
        .unwrap()
        .clone();
    emit_with_cause(
        sim.world_mut(),
        actor,
        &state,
        "failed",
        None,
        Some(OrderFailureCause::NoReachableMediaPosition),
    );
    let caused = sim.action_events_since(0).next_cursor;
    emit(
        sim.world_mut(),
        other,
        &state,
        "failed",
        Some("No reachable media position"),
    );
    let unrelated = sim.action_events_since(caused).events.pop().unwrap();
    assert_eq!(unrelated.order_id, state.entry.id);
    assert_eq!(unrelated.actor, other.index_u32());
    assert_eq!(sim.action_failure_cause(unrelated.sequence), None);
    assert_eq!(
        sim.action_failure_cause(caused),
        Some(OrderFailureCause::NoReachableMediaPosition)
    );
}
