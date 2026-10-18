use super::*;

#[test]
fn player_order_reachability_reading_across_a_wall_fails_once_and_keeps_later_orders() {
    let (mut sim, person, shelf, seat, title) = fixture("reading_chair");
    purchase(&mut sim, Some(shelf), &title);
    // The book is reachable, but the specifically ordered chair is not.
    sim.world_mut().entity_mut(seat).insert(Reserved);
    for y in 0..20 {
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_edge_blocked((6, y), (7, y), true);
    }
    read(&mut sim, person, seat, &title, false);
    read(&mut sim, person, shelf, &title, false);
    read(&mut sim, person, seat, &title, false);
    sim.flush_commands();
    let ids: Vec<_> = sim
        .world()
        .get::<IntentQueue>(person)
        .unwrap()
        .entries()
        .iter()
        .map(|e| e.id)
        .collect();
    assert_eq!(ids.len(), 3);
    sim.tick();
    let events = sim.action_events_since(0).events;
    let failed: Vec<_> = events
        .iter()
        .filter(|e| e.order_id == ids[0] && e.phase == "failed")
        .collect();
    assert_eq!(
        failed.len(),
        1,
        "the unreachable accepted reading order must fail"
    );
    assert_eq!(
        failed[0].reason.as_deref(),
        Some("No reachable reading destination")
    );
    assert_eq!(
        sim.world()
            .get::<IntentQueue>(person)
            .unwrap()
            .entries()
            .iter()
            .map(|e| e.id)
            .collect::<Vec<_>>(),
        ids[1..]
    );
    assert!(sim.world().get::<ReadingJourney>(person).is_none());
    assert!(sim.world().get::<Blocked>(person).is_none());
    assert!(
        sim.world().get::<Reserved>(seat).is_some(),
        "failure does not release another resource claim"
    );
    assert!(sim
        .world()
        .resource::<BookLibrary>()
        .state()
        .copies
        .iter()
        .all(|copy| copy.borrower.is_none()));
    sim.tick();
    assert_eq!(
        sim.world().get::<ReadingJourney>(person).unwrap().order,
        Some(ids[1])
    );
    assert_eq!(
        sim.action_events_since(0)
            .events
            .iter()
            .filter(|e| e.order_id == ids[0]
                && matches!(e.phase.as_str(), "failed" | "completed" | "canceled"))
            .count(),
        1
    );
    assert!(sim
        .world()
        .get::<IntentQueue>(person)
        .unwrap()
        .order(ids[2])
        .is_some());
}

#[test]
fn player_order_reachability_reserved_reading_chair_waits_and_then_starts() {
    let (mut sim, person, shelf, seat, title) = fixture("reading_chair");
    purchase(&mut sim, Some(shelf), &title);
    sim.world_mut().entity_mut(seat).insert(Reserved);
    read(&mut sim, person, seat, &title, false);
    sim.flush_commands();
    let id = sim.world().get::<IntentQueue>(person).unwrap().entries()[0].id;
    for _ in 0..30 {
        sim.tick();
    }
    assert!(sim
        .world()
        .get::<IntentQueue>(person)
        .unwrap()
        .order(id)
        .is_some());
    assert!(sim.world().get::<Blocked>(person).is_some());
    assert!(sim.world().get::<ReadingJourney>(person).is_none());
    assert!(!sim
        .action_events_since(0)
        .events
        .iter()
        .any(|e| e.order_id == id && e.phase == "failed"));
    sim.world_mut().entity_mut(seat).remove::<Reserved>();
    sim.tick();
    assert_eq!(
        sim.world().get::<ReadingJourney>(person).unwrap().order,
        Some(id)
    );
}

#[test]
fn player_order_reachability_borrowed_reachable_book_waits_for_its_return() {
    let (mut sim, reader, shelf, seat, title) = fixture("reading_chair");
    purchase(&mut sim, Some(shelf), &title);
    let pack = sim.world().resource::<Content>().0;
    let other_seat = sim.spawn_object(
        Position { x: 12., y: 5. },
        pack.find("reading_chair").unwrap(),
    );
    let identity = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let waiting = sim
        .world_mut()
        .spawn((
            Agent,
            identity,
            Position { x: 1., y: 2. },
            Needs::all_at(80.),
            IntentQueue::default(),
            Personality::neutral(),
            Relationships::default(),
        ))
        .id();
    read(&mut sim, reader, seat, &title, false);
    until(&mut sim, reader, ReadingStage::Read);
    read(&mut sim, waiting, other_seat, &title, false);
    sim.flush_commands();
    let id = sim.world().get::<IntentQueue>(waiting).unwrap().entries()[0].id;
    for _ in 0..10 {
        sim.tick();
    }
    assert!(sim.world().get::<Blocked>(waiting).is_some());
    assert!(sim
        .world()
        .get::<IntentQueue>(waiting)
        .unwrap()
        .order(id)
        .is_some());
    assert!(!sim
        .action_events_since(0)
        .events
        .iter()
        .any(|e| e.actor == waiting.index_u32() && e.order_id == id && e.phase == "failed"));
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: reader.index_u32(),
        },
    );
    for _ in 0..500 {
        sim.tick();
        if let Some(journey) = sim.world().get::<ReadingJourney>(waiting) {
            assert_eq!(journey.order, Some(id));
            return;
        }
    }
    panic!("the original waiting reading order did not start after the copy returned");
}
