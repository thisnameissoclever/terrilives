use super::*;
use crate::Sim;
use terri_core::command::BookCommand;

#[test]
fn reading_render_projection_tracks_active_seat_and_canonical_reach() {
    let (mut sim, person, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, person, seat, &title, false);
    sim.flush_commands();
    let mut observed = std::collections::BTreeSet::new();
    for _ in 0..600 {
        let journey = sim.world().get::<ReadingJourney>(person).cloned();
        let before = sim.world_hash();
        sim.sync_render_buffer_after_commands();
        assert_eq!(
            sim.world_hash(),
            before,
            "presentation must not change play"
        );
        let render = sim.render_buffer();
        let row = render
            .ids
            .iter()
            .position(|id| *id == person.index_u32())
            .unwrap();
        for length in [
            render.seated_furniture.len(),
            render.seated_places.len(),
            render.seated_whole.len(),
            render.reading_copies.len(),
            render.reading_home_shelves.len(),
            render.reading_home_slots.len(),
            render.reading_reach_remaining.len(),
            render.reading_reach_totals.len(),
        ] {
            assert_eq!(length, render.count);
        }
        if let Some(journey) = journey {
            assert_eq!(render.reading_copies[row], journey.copy.0);
            observed.insert(render.reading_stages[row]);
            assert_eq!(render.reading_home_shelves[row], shelf.index_u32());
            assert_eq!(render.reading_home_slots[row], 0);
            if journey.stage == ReadingStage::Read {
                assert_eq!(render.seated_furniture[row], seat.index_u32());
                assert_eq!(render.seated_places[row], 0);
                assert_eq!(render.seated_whole[row], 0);
            } else {
                assert_eq!(
                    render.seated_furniture[row],
                    u32::MAX,
                    "a lease is not a seated body"
                );
                assert_eq!(render.seated_places[row], u32::MAX);
            }
            if matches!(journey.stage, ReadingStage::Pickup | ReadingStage::Shelve) {
                assert!(render.reading_reach_totals[row] > 0);
                assert_eq!(render.reading_reach_remaining[row], journey.reach_remaining);
                assert!(render.reading_reach_remaining[row] <= render.reading_reach_totals[row]);
            } else {
                assert_eq!(render.reading_reach_totals[row], 0);
                assert_eq!(render.reading_reach_remaining[row], 0);
            }
        } else {
            assert_eq!(render.reading_copies[row], u32::MAX);
            assert_eq!(render.reading_home_shelves[row], u32::MAX);
            assert_eq!(render.reading_home_slots[row], u32::MAX);
            assert_eq!(render.seated_furniture[row], u32::MAX);
            if observed.contains(&7) {
                break;
            }
        }
        sim.tick();
    }
    for expected in [1, 2, 3, 4, 6, 7] {
        assert!(
            observed.contains(&expected),
            "missing journey stage {expected}"
        );
    }
}

fn fixture(model: &str) -> (Sim, Entity, Entity, Entity, String) {
    let mut pack = terri_data::pack().clone();
    pack.decay_per_tick = [0.0; 7];
    pack.tuning.neglect_bleed_per_tick = 0.0;
    pack.tuning.satisfaction_mood_per_tick = 0.0;
    pack.lot.front_door = None;
    pack.portals.clear();
    let content = Content(Box::leak(Box::new(pack)));
    let mut sim = Sim::new_with_lot_and_content(20, 20, content);
    sim.world_mut().insert_resource(Funds(10000));
    let shelf = sim.spawn_object(
        Position { x: 3.0, y: 3.0 },
        content.0.find("bookshelf").unwrap(),
    );
    let seat = sim.spawn_object(Position { x: 9.0, y: 5.0 }, content.0.find(model).unwrap());
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let person = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 1.0, y: 1.0 },
            Needs::all_at(80.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
        ))
        .id();
    let title = content
        .0
        .books
        .iter()
        .find(|b| b.reading_minutes == 180)
        .unwrap()
        .id
        .clone();
    (sim, person, shelf, seat, title)
}
fn issue(sim: &mut Sim, c: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(c);
}
fn purchase(sim: &mut Sim, shelf: Option<Entity>, title: &str) {
    issue(
        sim,
        SimCommand::Book(BookCommand::Purchase {
            title: title.into(),
            shelf: shelf.map(|e| e.index_u32()),
        }),
    );
    sim.flush_commands();
    let results = sim.take_book_results();
    assert!(
        results.last().is_some_and(|r| r.refusal.is_none()),
        "purchase must succeed: {results:?}"
    );
}
fn read(sim: &mut Sim, person: Entity, object: Entity, title: &str, front: bool) {
    let action = sim
        .world()
        .resource::<Content>()
        .0
        .object(sim.world().get::<SmartObject>(object).unwrap().0)
        .interactions
        .iter()
        .find(|a| a.book_reading)
        .unwrap()
        .id
        .clone();
    issue(
        sim,
        SimCommand::Book(BookCommand::Read {
            agent: person.index_u32(),
            object: object.index_u32(),
            action,
            title: title.into(),
            front,
        }),
    );
}
fn stage(sim: &Sim, person: Entity) -> Option<ReadingStage> {
    sim.world().get::<ReadingJourney>(person).map(|j| j.stage)
}
fn until(sim: &mut Sim, person: Entity, want: ReadingStage) {
    for _ in 0..500 {
        if stage(sim, person) == Some(want) {
            return;
        }
        sim.tick();
    }
    panic!("did not reach {want:?}; got {:?}", stage(sim, person));
}
fn finish_order(sim: &mut Sim, person: Entity, id: u64) {
    for _ in 0..600 {
        if sim
            .world()
            .get::<IntentQueue>(person)
            .unwrap()
            .order(id)
            .is_none()
            && sim.world().get::<ReadingJourney>(person).is_none()
        {
            return;
        }
        sim.tick();
    }
    panic!("order did not return");
}

#[test]
fn reading_journey_actual_command_three_sessions_retain_first_pass_novelty() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    for pass in 0..3 {
        read(&mut sim, p, seat, &title, false);
        sim.tick();
        let id = sim
            .world()
            .get::<ReadingJourney>(p)
            .expect("owned admission")
            .order
            .unwrap();
        assert!(sim
            .world()
            .get::<crate::seating::PhysicalClaim>(p)
            .is_some());
        assert_eq!(
            sim.book_copies()[0].borrower,
            sim.world().get::<SimId>(p).copied()
        );
        until(&mut sim, p, ReadingStage::Read);
        sim.world_mut()
            .entity_mut(p)
            .insert(Needs::with(NeedId::Fun, 10.0));
        let before = sim.world().get::<Needs>(p).unwrap().get(NeedId::Fun);
        sim.tick();
        assert!(sim.world().get::<Needs>(p).unwrap().get(NeedId::Fun) > before);
        until(&mut sim, p, ReadingStage::Return);
        assert_eq!(sim.world().get::<ReadingJourney>(p).unwrap().elapsed, 60);
        let memory = sim.reading_progress(p.index_u32(), &title).unwrap();
        assert_eq!(memory.completed_passes, if pass == 2 { 1 } else { 0 });
        assert_eq!(
            memory.progress_ticks,
            if pass == 2 { 0 } else { (pass + 1) * 60 }
        );
        if pass < 2 {
            assert_eq!(memory.pass_novelty, Some(1.0));
        }
        finish_order(&mut sim, p, id);
        assert!(matches!(
            sim.book_copies()[0].location,
            BookLocation::Shelf(_)
        ));
        assert_eq!(sim.book_copies()[0].borrower, None);
    }
}
#[test]
fn reading_journey_each_stage_roundtrips_and_bad_state_rolls_back() {
    let (mut sim, p, shelf, seat, title) = fixture("reading_chair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    sim.tick();
    for stage in [
        ReadingStage::Fetch,
        ReadingStage::Pickup,
        ReadingStage::Travel,
        ReadingStage::Read,
        ReadingStage::Return,
        ReadingStage::Shelve,
    ] {
        until(&mut sim, p, stage);
        let saved = sim.save_snapshot_v6();
        let hash = sim.world_hash();
        sim.load_snapshot_v6(saved.clone())
            .unwrap_or_else(|e| panic!("{stage:?}: {e:?}"));
        assert_eq!(sim.save_snapshot_v6(), saved);
        assert_eq!(sim.world_hash(), hash);
        let mut bad = saved.clone();
        bad.reading[0].copy = BookCopyId(999);
        assert!(sim.load_snapshot_v6(bad).is_err());
        assert_eq!(sim.save_snapshot_v6(), saved);
        assert_eq!(sim.world_hash(), hash);
        let mut unearned = saved.clone();
        unearned.reading[0].earned_satisfaction = 10.0;
        assert!(sim.load_snapshot_v6(unearned).is_err());
        assert_eq!(sim.save_snapshot_v6(), saved);
        let mut bad = saved.clone();
        bad.reading.clear();
        assert!(sim.load_snapshot_v6(bad).is_err());
        assert_eq!(sim.save_snapshot_v6(), saved);
    }
}
#[test]
fn reading_journey_no_owned_or_inventory_copy_cannot_start() {
    let (mut sim, p, _, seat, title) = fixture("armchair");
    read(&mut sim, p, seat, &title, false);
    sim.tick();
    assert!(stage(&sim, p).is_none());
    purchase(&mut sim, None, &title);
    for _ in 0..10 {
        sim.tick();
    }
    assert!(stage(&sim, p).is_none());
    assert!(sim.world().get::<Blocked>(p).is_some());
}
#[test]
fn reading_journey_cancel_before_pickup_releases_and_after_pickup_returns() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    sim.tick();
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: p.index_u32(),
        },
    );
    sim.flush_commands();
    assert!(stage(&sim, p).is_none());
    assert!(sim.book_copies()[0].borrower.is_none());
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    for _ in 0..7 {
        sim.tick();
    }
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: p.index_u32(),
        },
    );
    sim.flush_commands();
    assert_eq!(stage(&sim, p), Some(ReadingStage::Return));
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Carried(_)
    ));
    let memory = sim.reading_progress(p.index_u32(), &title).unwrap();
    assert_eq!(memory.progress_ticks, 7);
    for _ in 0..100 {
        if stage(&sim, p).is_none() {
            break;
        }
        sim.tick();
    }
    assert!(stage(&sim, p).is_none());
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Shelf(_)
    ));
}
#[test]
fn reading_journey_same_shelf_serializes_fetches_then_shares_reading() {
    let (mut sim, p, shelf, sofa, title) = fixture("long_sofa");
    purchase(&mut sim, Some(shelf), &title);
    purchase(&mut sim, Some(shelf), &title);
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let second = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 1.0, y: 2.0 },
            Needs::all_at(80.0),
            IntentQueue::default(),
        ))
        .id();
    read(&mut sim, p, sofa, &title, false);
    read(&mut sim, second, sofa, &title, false);
    sim.tick();
    assert!(sim.world().get::<ReadingJourney>(second).is_none());
    assert_eq!(sim.world().get::<IntentQueue>(second).unwrap().len(), 1);
    until(&mut sim, second, ReadingStage::Read);
    assert_eq!(stage(&sim, p), Some(ReadingStage::Read));
    let first = sim.world().get::<ReadingJourney>(p).unwrap();
    let other = sim.world().get::<ReadingJourney>(second).unwrap();
    assert_ne!(first.copy, other.copy);
    assert_ne!(first.seat, other.seat);
    assert!(sim.world().get::<Reserved>(shelf).is_none());
}
#[test]
fn reading_journey_all_seating_models_and_repeated_browsing_are_rng_neutral() {
    for model in [
        "chair",
        "sofa",
        "desk_chair",
        "long_sofa",
        "armchair",
        "reading_chair",
    ] {
        for facing in Facing::ALL {
            let (mut sim, p, shelf, seat, title) = fixture(model);
            let pack = sim.world().resource::<Content>().0;
            let def = pack.object(sim.world().get::<SmartObject>(seat).unwrap().0);
            let at = *sim.world().get::<Position>(seat).unwrap();
            crate::apply_object_placement(sim.world_mut(), seat, def, at, facing);
            purchase(&mut sim, Some(shelf), &title);
            let object = sim.world().get::<SmartObject>(seat).unwrap().0;
            let row = sim
                .world()
                .resource::<Content>()
                .0
                .object(object)
                .interactions
                .iter()
                .position(|a| a.book_reading)
                .unwrap() as u32;
            let before = sim.world_hash();
            for _ in 0..5 {
                assert!(!plans(
                    sim.world_mut(),
                    p,
                    Target {
                        object: seat,
                        interaction: row
                    },
                    Some(&title)
                )
                .is_empty());
            }
            assert_eq!(sim.world_hash(), before, "{model}");
            read(&mut sim, p, seat, &title, false);
            until(&mut sim, p, ReadingStage::Read);
            sim.sync_render_buffer();
            assert_eq!(
                sim.render_buffer().reading_stages[sim
                    .render_buffer()
                    .ids
                    .iter()
                    .position(|e| *e == p.index_u32())
                    .unwrap()],
                3
            );
        }
    }
}

#[test]
fn reading_journey_duplicate_orders_return_before_new_exact_order() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    sim.tick();
    let old = sim.world().get::<ReadingJourney>(p).unwrap().order.unwrap();
    read(&mut sim, p, seat, &title, true);
    sim.flush_commands();
    let new = sim.world().get::<IntentQueue>(p).unwrap().entries()[0].id;
    assert_ne!(old, new);
    assert_eq!(stage(&sim, p), Some(ReadingStage::Return));
    assert_eq!(
        sim.world().get::<ReadingJourney>(p).unwrap().order,
        Some(old)
    );
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
    for _ in 0..300 {
        sim.tick();
        if sim
            .world()
            .get::<ReadingJourney>(p)
            .is_some_and(|j| j.order == Some(new))
        {
            break;
        }
    }
    assert!(sim
        .world()
        .get::<IntentQueue>(p)
        .unwrap()
        .order(old)
        .is_none());
    assert_eq!(
        sim.world().get::<ReadingJourney>(p).unwrap().order,
        Some(new)
    );
}
#[test]
fn reading_journey_fractional_work_survives_interruption_and_load() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    let mut pack = sim.world().resource::<Content>().0.clone();
    let def = pack.find("armchair").unwrap();
    pack.objects[def.0 as usize]
        .interactions
        .iter_mut()
        .find(|a| a.book_reading)
        .unwrap()
        .duration_ticks = 80;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    sim.tick();
    let m = sim.reading_progress(p.index_u32(), &title).unwrap();
    assert_eq!(m.progress_ticks, 0);
    assert_eq!(m.progress_fraction, 0.75);
    assert_eq!(m.pass_novelty, Some(1.0));
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: p.index_u32(),
        },
    );
    sim.flush_commands();
    assert_eq!(
        sim.reading_progress(p.index_u32(), &title)
            .unwrap()
            .progress_fraction,
        0.75
    );
}
#[test]
fn reading_journey_specialist_reward_and_comfort_ratios() {
    let mut gains = vec![];
    for model in ["armchair", "reading_chair"] {
        let (mut sim, p, shelf, seat, title) = fixture(model);
        purchase(&mut sim, Some(shelf), &title);
        read(&mut sim, p, seat, &title, false);
        until(&mut sim, p, ReadingStage::Read);
        sim.world_mut().entity_mut(p).insert(Needs::all_at(50.0));
        let before = *sim.world().get::<Needs>(p).unwrap();
        sim.tick();
        let after = *sim.world().get::<Needs>(p).unwrap();
        gains.push((
            after.get(NeedId::Fun) - before.get(NeedId::Fun),
            after.get(NeedId::Comfort) - before.get(NeedId::Comfort),
            sim.reading_progress(p.index_u32(), &title)
                .unwrap()
                .progress_ticks,
        ));
    }
    assert!((gains[1].0 / gains[0].0 - 1.25).abs() < 0.0001);
    assert!((gains[1].1 / gains[0].1 - 1.25).abs() < 0.0001);
    assert_eq!(gains[0].2, gains[1].2);
    let pack = terri_data::pack();
    let sit = |model: &str| {
        let action = pack
            .object(pack.find(model).unwrap())
            .interactions
            .iter()
            .find(|a| !a.book_reading)
            .unwrap();
        (
            action.advertises.clone(),
            action.duration_ticks,
            action.satisfaction,
        )
    };
    assert_eq!(
        sit("armchair"),
        sit("reading_chair"),
        "specialization must not alter ordinary sitting"
    );
    eprintln!("SPECIALIST actual reading gains (Fun, Comfort, progress): {gains:?}; ordinary sitting equal");
}
#[test]
fn reading_journey_blocked_return_keeps_copy_and_recovers() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    sim.tick();
    let home = *sim.world().get::<Position>(shelf).unwrap();
    for tile in [(2, 3), (4, 3), (3, 2), (3, 4)] {
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(tile.0, tile.1, true);
    }
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: p.index_u32(),
        },
    );
    sim.flush_commands();
    assert_eq!(stage(&sim, p), Some(ReadingStage::WaitingReturn));
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Carried(_)
    ));
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
    for _ in 0..3 {
        sim.tick();
        assert_eq!(stage(&sim, p), Some(ReadingStage::WaitingReturn));
    }
    assert_eq!(sim.world().get::<Position>(shelf), Some(&home));
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(4, 3, false);
    for _ in 0..200 {
        sim.tick();
        if stage(&sim, p).is_none() {
            break;
        }
    }
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Shelf(_)
    ));
    assert!(stage(&sim, p).is_none());
}
#[test]
fn reading_journey_death_preserves_copy_for_transfer_recovery() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    sim.tick();
    sim.world_mut()
        .entity_mut(p)
        .insert((SimName("Reader".into()), Needs::with(NeedId::Hunger, 0.0)));
    let threshold = sim.world().resource::<Content>().0.tuning.death_after_ticks;
    sim.world_mut()
        .resource_mut::<terri_core::save::SavedMortality>()
        .counts = vec![(p.index_u32(), threshold - 1)];
    sim.tick();
    assert!(sim.world().get_entity(p).is_err());
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Lot { .. }
    ));
    assert!(sim.book_copies()[0].borrower.is_none());
    issue(
        &mut sim,
        SimCommand::Book(BookCommand::Transfer {
            copy: 0,
            shelf: Some(shelf.index_u32()),
        }),
    );
    sim.flush_commands();
    assert_eq!(sim.book_copies().len(), 1);
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Shelf(_)
    ));
}

#[test]
fn reading_journey_pending_career_restores_and_pays_full_shift() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.lot.front_door = Some((0, 0));
    let career = pack.careers[0].clone();
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    sim.world_mut().entity_mut(p).insert(Career(0));
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    sim.tick();
    let object = sim.world().get::<SmartObject>(seat).unwrap().0;
    let sit = sim
        .world()
        .resource::<Content>()
        .0
        .object(object)
        .interactions
        .iter()
        .position(|a| !a.book_reading)
        .unwrap() as u32;
    issue(
        &mut sim,
        SimCommand::UseObject {
            agent: p.index_u32(),
            object: seat.index_u32(),
            interaction: sit,
        },
    );
    sim.flush_commands();
    sim.world_mut().resource_mut::<SimClock>().tick = u64::from(career.shift_start) - 1;
    sim.tick();
    assert_eq!(stage(&sim, p), Some(ReadingStage::Return));
    assert!(sim.world().get::<PendingShift>(p).is_some());
    assert!(sim.world().get::<Commuting>(p).is_none());
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
    for _ in 0..500 {
        if sim.world().get::<AtWork>(p).is_some() {
            break;
        }
        sim.tick();
    }
    assert_eq!(
        sim.world().get::<AtWork>(p).unwrap().remaining_ticks,
        career.shift_ticks
    );
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Shelf(_)
    ));
    assert!(sim.world().get::<PendingShift>(p).is_none());
    assert!(!sim.world().get::<IntentQueue>(p).unwrap().is_empty());
    let funds = sim.world().resource::<Funds>().0;
    for _ in 0..career.shift_ticks {
        sim.tick();
    }
    assert_eq!(
        sim.world().resource::<Funds>().0,
        funds + i64::from(career.pay)
    );
}
#[test]
fn reading_journey_queued_read_lets_existing_food_chain_finish() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    let pack = sim.world().resource::<Content>().0;
    let fridge = sim.spawn_object(Position { x: 5.0, y: 8.0 }, pack.find("fridge").unwrap());
    sim.spawn_object(Position { x: 7.0, y: 8.0 }, pack.find("counter").unwrap());
    let snack = pack
        .object(pack.find("fridge").unwrap())
        .interactions
        .iter()
        .position(|a| a.id == "grab_snack")
        .unwrap() as u32;
    issue(
        &mut sim,
        SimCommand::UseObject {
            agent: p.index_u32(),
            object: fridge.index_u32(),
            interaction: snack,
        },
    );
    for _ in 0..300 {
        sim.tick();
        if sim.world().get::<Carrying>(p).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<Carrying>(p).is_some());
    read(&mut sim, p, seat, &title, true);
    sim.flush_commands();
    sim.tick();
    assert!(sim.world().get::<ReadingJourney>(p).is_none());
    assert!(sim.world().get::<ChainState>(p).is_some());
    until(&mut sim, p, ReadingStage::Read);
    assert!(sim.world().get::<Carrying>(p).is_none());
    assert!(sim.world().get::<ChainState>(p).is_none());
}
#[test]
fn reading_journey_bookcase_standing_fallback_and_shelf_move() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    sim.world_mut().entity_mut(seat).insert(Reserved);
    read(&mut sim, p, shelf, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    assert!(sim.world().get::<ReadingJourney>(p).unwrap().seat.is_none());
    sim.world_mut()
        .entity_mut(shelf)
        .insert(Position { x: 7.0, y: 7.0 });
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: p.index_u32(),
        },
    );
    sim.flush_commands();
    let end = sim
        .world()
        .get::<Path>(p)
        .unwrap()
        .steps
        .last()
        .copied()
        .unwrap();
    assert!((end.0 - 7).abs() + (end.1 - 7).abs() == 1);
    for _ in 0..150 {
        sim.tick();
        if stage(&sim, p).is_none() {
            break;
        }
    }
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Shelf(_)
    ));
}
#[test]
fn reading_journey_statistical_specialist_preference_can_be_outweighed() {
    let (mut sim, p, shelf, standard, title) = fixture("armchair");
    sim.world_mut()
        .entity_mut(standard)
        .insert(Position { x: 5.0, y: 5.0 });
    let pack = sim.world().resource::<Content>().0;
    let specialist = sim.spawn_object(
        Position { x: 5.0, y: 1.0 },
        pack.find("reading_chair").unwrap(),
    );
    purchase(&mut sim, Some(shelf), &title);
    sim.world_mut()
        .entity_mut(p)
        .insert(Needs::with(NeedId::Fun, 0.0));
    let origin = Target {
        object: shelf,
        interaction: 0,
    };
    let choices = plans(sim.world_mut(), p, origin, Some(&title));
    let occupancy = crate::seating::occupancy(sim.world_mut());
    let mut specialist_count = 0;
    for seed in 0..2000 {
        let plan = choose_plan(
            &choices,
            p,
            Some(&title),
            &occupancy,
            &Default::default(),
            &mut SimRng::from_seed(seed),
            pack,
        )
        .unwrap();
        if plan.target.object == specialist {
            specialist_count += 1;
        }
    }
    assert!(
        (1001..1950).contains(&specialist_count),
        "specialist picked {specialist_count}/2000"
    );
    let ordinary_plan = choices
        .iter()
        .find(|plan| plan.target.object == standard)
        .unwrap();
    let special_plan = choices
        .iter()
        .find(|plan| plan.target.object == specialist)
        .unwrap();
    assert_eq!(
        ordinary_plan.route_steps, special_plan.route_steps,
        "preference comparison requires equal routes"
    );
    let mut neutral_pack = pack.clone();
    let specialist_id = neutral_pack.find("reading_chair").unwrap();
    let read = neutral_pack.objects[specialist_id.0 as usize]
        .interactions
        .iter_mut()
        .find(|a| a.book_reading)
        .unwrap();
    for (need, value) in &mut read.advertises {
        if *need == NeedId::Fun as u8 {
            *value = 30.0;
        }
        if *need == NeedId::Comfort as u8 {
            *value = 15.0;
        }
    }
    let neutral_pack = Box::leak(Box::new(neutral_pack));
    sim.world_mut().insert_resource(Content(neutral_pack));
    let neutral = plans(sim.world_mut(), p, origin, Some(&title));
    let score = |object| {
        neutral
            .iter()
            .find(|plan| plan.target.object == object)
            .unwrap()
            .score
    };
    assert!(
        (score(standard) - score(specialist)).abs() < 0.000001,
        "removing both bonuses removes the preference under equal routes"
    );
    let neutral_count = (0..2000)
        .filter(|seed| {
            choose_plan(
                &neutral,
                p,
                Some(&title),
                &occupancy,
                &Default::default(),
                &mut SimRng::from_seed(*seed),
                neutral_pack,
            )
            .unwrap()
            .target
            .object
                == specialist
        })
        .count();
    assert!((900..1100).contains(&neutral_count));
    assert!(specialist_count > neutral_count);
    sim.world_mut().insert_resource(Content(pack));
    sim.world_mut()
        .entity_mut(specialist)
        .insert(Position { x: 18.0, y: 18.0 });
    let far = plans(sim.world_mut(), p, origin, Some(&title));
    let mut far_count = 0;
    for seed in 0..2000 {
        if choose_plan(
            &far,
            p,
            Some(&title),
            &occupancy,
            &Default::default(),
            &mut SimRng::from_seed(seed),
            pack,
        )
        .unwrap()
        .target
        .object
            == specialist
        {
            far_count += 1;
        }
    }
    assert!(
        far_count < specialist_count,
        "distance must change choice: {far_count} >= {specialist_count}"
    );
    let personality = Personality::with_dispositions(
        [1.0; 7],
        [1.0; 7],
        vec![(pack.find("reading_chair").unwrap(), 0, 0.1)],
    );
    sim.world_mut().entity_mut(p).insert(personality);
    let disliked = plans(sim.world_mut(), p, origin, Some(&title));
    let spec = disliked
        .iter()
        .find(|p| p.target.object == specialist)
        .unwrap()
        .score;
    let ordinary = disliked
        .iter()
        .find(|p| p.target.object == standard)
        .unwrap()
        .score;
    assert!(spec < ordinary);
    eprintln!("SPECIALIST choices/2000: equal-route boosted {specialist_count}, bonuses disabled {neutral_count}, farther {far_count}; disliked specialist score {spec}, alternative {ordinary}");
}
#[test]
fn reading_journey_clear_unrelated_orders_preserves_autonomous_reader() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    let target = Target {
        object: seat,
        interaction: 1,
    };
    let plan = plans(sim.world_mut(), p, target, Some(&title)).remove(0);
    assert!(commit_plan(sim.world_mut(), p, target, None, plan));
    until(&mut sim, p, ReadingStage::Read);
    let before = sim.world().get::<ReadingJourney>(p).cloned().unwrap();
    issue(
        &mut sim,
        SimCommand::UseObject {
            agent: p.index_u32(),
            object: seat.index_u32(),
            interaction: 1,
        },
    );
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: p.index_u32(),
        },
    );
    sim.flush_commands();
    assert_eq!(sim.world().get::<ReadingJourney>(p), Some(&before));
}
#[test]
fn reading_journey_batches_actual_satisfaction_and_preserves_nondefault_fun_baseline() {
    let mut results = vec![];
    for familiar in [false, true] {
        let (mut sim, p, shelf, seat, title) = fixture("reading_chair");
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.reading.as_mut().unwrap().fun_per_session = 40.0;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        purchase(&mut sim, Some(shelf), &title);
        if familiar {
            let mut library = sim.world().resource::<BookLibrary>().clone();
            let id = *sim.world().get::<SimId>(p).unwrap();
            with_book_world(sim.world(), |c| {
                library.reserve(BookCopyId(0), id, c)?;
                library.pick_up(BookCopyId(0), id, c)?;
                for _ in 0..3 {
                    library.read_work(BookCopyId(0), id, 60, c)?;
                }
                library.return_copy(BookCopyId(0), id, c)
            })
            .unwrap();
            sim.world_mut().insert_resource(library);
        }
        sim.world_mut()
            .entity_mut(p)
            .insert(Satisfaction::from_value(50.0));
        read(&mut sim, p, seat, &title, false);
        until(&mut sim, p, ReadingStage::Read);
        sim.world_mut()
            .entity_mut(p)
            .insert(Needs::with(NeedId::Fun, 0.0));
        assert_eq!(
            sim.reading_action_benefits(seat.index_u32(), "settle_in")[0],
            50.0
        );
        for _ in 0..20 {
            sim.tick();
        }
        assert_eq!(
            sim.world().get::<Satisfaction>(p).unwrap().value(),
            50.0,
            "earned reward is retained until the transition"
        );
        assert!(
            sim.world()
                .get::<ReadingJourney>(p)
                .unwrap()
                .earned_satisfaction
                > 0.0
        );
        let saved = sim.save_snapshot_v6();
        sim.load_snapshot_v6(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v6(), saved);
        until(&mut sim, p, ReadingStage::Return);
        let gain = sim.world().get::<Satisfaction>(p).unwrap().value() - 50.0;
        let fun = sim.world().get::<Needs>(p).unwrap().get(NeedId::Fun);
        assert_eq!(
            sim.world()
                .get::<ReadingJourney>(p)
                .unwrap()
                .earned_satisfaction,
            0.0
        );
        for _ in 0..3 {
            request_return(sim.world_mut(), p);
        }
        assert_eq!(
            sim.world().get::<Satisfaction>(p).unwrap().value() - 50.0,
            gain
        );
        results.push((gain, fun));
    }
    assert!(
        (results[1].0 / results[0].0 - 0.2).abs() < 0.002,
        "actual meter gains: {results:?}"
    );
    assert!((results[1].1 / results[0].1 - 0.2).abs() < 0.0005);
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    sim.world_mut()
        .entity_mut(p)
        .insert(Satisfaction::from_value(50.0));
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    for _ in 0..10 {
        sim.tick();
    }
    let pending = sim
        .world()
        .get::<ReadingJourney>(p)
        .unwrap()
        .earned_satisfaction;
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: p.index_u32(),
        },
    );
    sim.flush_commands();
    assert!(
        (sim.world().get::<Satisfaction>(p).unwrap().value()
            - 50.0
            - pending * Satisfaction::REWARD_SCALE)
            .abs()
            < 0.000004
    );
}
fn block_furniture(sim: &mut Sim) {
    let pack = sim.world().resource::<Content>().0;
    let objects: Vec<_> = sim
        .world_mut()
        .query::<(&Position, &SmartObject, Option<&ObjectFacing>)>()
        .iter(sim.world())
        .map(|(p, o, f)| {
            (
                *p,
                pack.object(o.0)
                    .footprint_at(f.map_or(pack.object(o.0).base_facing, |f| f.0)),
            )
        })
        .collect();
    for (p, fp) in objects {
        for x in 0..fp.width {
            for y in 0..fp.depth {
                sim.world_mut().resource_mut::<TileGrid>().set_blocked(
                    p.x as usize + x as usize,
                    p.y as usize + y as usize,
                    true,
                );
            }
        }
    }
}
#[test]
fn reading_journey_front_access_rotations_and_solid_boundary() {
    for facing in Facing::ALL {
        let (mut sim, p, shelf, seat, title) = fixture("armchair");
        sim.world_mut()
            .entity_mut(shelf)
            .insert(ObjectFacing(facing));
        purchase(&mut sim, Some(shelf), &title);
        let origin = Target {
            object: seat,
            interaction: 1,
        };
        let choices = plans(sim.world_mut(), p, origin, Some(&title));
        assert!(!choices.is_empty());
        let contact = choices[0].transfer_contact;
        sim.world_mut().resource_mut::<TileGrid>().set_blocked(
            contact.0 as usize,
            contact.1 as usize,
            true,
        );
        assert!(
            plans(sim.world_mut(), p, origin, Some(&title)).is_empty(),
            "other sides cannot replace the authored front"
        );
        sim.world_mut().resource_mut::<TileGrid>().set_blocked(
            contact.0 as usize,
            contact.1 as usize,
            false,
        );
        assert!(legal_shelf_contact(
            sim.world(),
            sim.world().resource::<TileGrid>(),
            shelf,
            contact
        ));
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_edge_blocked(contact, (3, 3), true);
        assert!(!legal_shelf_contact(
            sim.world(),
            sim.world().resource::<TileGrid>(),
            shelf,
            contact
        ));
        assert!(plans(sim.world_mut(), p, origin, Some(&title)).is_empty());
    }
}
#[test]
fn reading_journey_reach_phases_preserve_location_and_cancel_pickup_safely() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Pickup);
    let before = sim.world().resource::<SimRng>().clone();
    let duration = sim
        .world()
        .resource::<Content>()
        .0
        .reading
        .unwrap()
        .pickup_ticks;
    assert_eq!(
        sim.world()
            .get::<ReadingJourney>(p)
            .unwrap()
            .reach_remaining,
        duration
    );
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Shelf(_)
    ));
    sim.tick();
    assert_eq!(
        sim.world()
            .get::<ReadingJourney>(p)
            .unwrap()
            .reach_remaining,
        duration - 1
    );
    assert_eq!(*sim.world().resource::<SimRng>(), before);
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: p.index_u32(),
        },
    );
    sim.flush_commands();
    assert!(stage(&sim, p).is_none());
    assert!(sim.book_copies()[0].borrower.is_none());
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Shelve);
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Carried(_)
    ));
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: p.index_u32(),
        },
    );
    sim.flush_commands();
    assert_eq!(stage(&sim, p), Some(ReadingStage::Shelve));
    let remaining = sim
        .world()
        .get::<ReadingJourney>(p)
        .unwrap()
        .reach_remaining;
    for _ in 0..remaining - 1 {
        sim.tick();
        assert!(matches!(
            sim.book_copies()[0].location,
            BookLocation::Carried(_)
        ));
    }
    sim.tick();
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Shelf(_)
    ));
}
#[test]
fn reading_journey_shelf_moves_commit_reroutes_atomically_at_every_transfer_stage() {
    for phase in [
        ReadingStage::Fetch,
        ReadingStage::Pickup,
        ReadingStage::Return,
        ReadingStage::Shelve,
    ] {
        let (mut sim, p, shelf, seat, title) = fixture("armchair");
        block_furniture(&mut sim);
        purchase(&mut sim, Some(shelf), &title);
        read(&mut sim, p, seat, &title, false);
        sim.tick();
        until(&mut sim, p, phase);
        let before = sim.save_snapshot_v6();
        let hash = sim.world_hash();
        let rng = sim.world().resource::<SimRng>().clone();
        for _ in 0..3 {
            assert!(crate::placement::validate_placement(
                sim.world(),
                shelf.index_u32(),
                (6, 8),
                Facing::SouthWest
            )
            .is_ok());
        }
        assert_eq!(sim.save_snapshot_v6(), before);
        assert_eq!(sim.world_hash(), hash);
        assert_eq!(*sim.world().resource::<SimRng>(), rng);
        let at = *sim.world().get::<Position>(p).unwrap();
        assert!(crate::placement::validate_placement(
            sim.world(),
            shelf.index_u32(),
            (at.x.floor() as u32, at.y.floor() as u32),
            Facing::SouthEast
        )
        .is_err());
        assert_eq!(sim.save_snapshot_v6(), before);
        let location = sim.book_copies()[0].location;
        issue(
            &mut sim,
            SimCommand::PlaceObject {
                object: shelf.index_u32(),
                x: 6,
                y: 8,
                facing: Facing::SouthWest,
            },
        );
        sim.flush_commands();
        assert_eq!(
            sim.world()
                .resource::<crate::placement::LotEditState>()
                .last_result
                .unwrap()
                .reason,
            None,
            "{phase:?}"
        );
        assert_eq!(sim.book_copies()[0].location, location);
        assert_eq!(*sim.world().resource::<SimRng>(), rng);
        let journey = sim.world().get::<ReadingJourney>(p).unwrap();
        assert_eq!(journey.shelf, shelf);
        assert_eq!(journey.transfer_contact, Some((6, 9)));
        assert_eq!(journey.reach_remaining, 0);
        assert_eq!(
            journey.stage,
            if matches!(phase, ReadingStage::Fetch | ReadingStage::Pickup) {
                ReadingStage::Fetch
            } else {
                ReadingStage::Return
            }
        );
        let saved = sim.save_snapshot_v6();
        sim.load_snapshot_v6(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v6(), saved);
        if matches!(phase, ReadingStage::Fetch | ReadingStage::Pickup) {
            until(&mut sim, p, ReadingStage::Read);
        } else {
            for _ in 0..150 {
                sim.tick();
                if stage(&sim, p).is_none() {
                    break;
                }
            }
            assert!(stage(&sim, p).is_none());
        }
    }
}
#[test]
fn reading_journey_transfer_claim_corruption_rejects_without_adopting() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Pickup);
    let saved = sim.save_snapshot_v6();
    let hash = sim.world_hash();
    for case in 0..4 {
        let mut bad = saved.clone();
        match case {
            0 => bad.reading[0].transfer_contact = None,
            1 => bad.reading[0].transfer_contact = Some((2, 3)),
            2 => bad.reading[0].reach_remaining = 0,
            _ => bad.reading[0].shelf = seat.index_u32(),
        };
        assert!(sim.load_snapshot_v6(bad).is_err());
        assert_eq!(sim.save_snapshot_v6(), saved);
        assert_eq!(sim.world_hash(), hash);
    }
}
#[test]
fn reading_journey_dropped_render_rows_keep_copy_identity_through_recovery() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    sim.world_mut()
        .entity_mut(p)
        .insert((SimName("Reader".into()), Needs::with(NeedId::Hunger, 0.0)));
    let threshold = sim.world().resource::<Content>().0.tuning.death_after_ticks;
    sim.world_mut()
        .resource_mut::<terri_core::save::SavedMortality>()
        .counts = vec![(p.index_u32(), threshold - 1)];
    sim.tick();
    sim.sync_render_buffer();
    let BookLocation::Lot { x, y } = sim.book_copies()[0].location else {
        panic!("physical dropped copy")
    };
    assert_eq!(sim.render_buffer().dropped_book_ids, vec![0]);
    assert_eq!(sim.render_buffer().dropped_book_positions, vec![x, y]);
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
    assert_eq!(sim.render_buffer().dropped_book_ids, vec![0]);
    issue(
        &mut sim,
        SimCommand::Book(BookCommand::Transfer {
            copy: 0,
            shelf: Some(shelf.index_u32()),
        }),
    );
    sim.flush_commands();
    sim.sync_render_buffer_after_commands();
    assert!(sim.render_buffer().dropped_book_ids.is_empty());
    assert_eq!(sim.render_buffer().shelf_book_masks, vec![1]);
}
#[test]
fn reading_journey_urgent_need_returns_before_other_activity_and_recline_waits() {
    let (mut sim, p, shelf, seat, title) = fixture("long_sofa");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    sim.tick();
    sim.world_mut()
        .get_mut::<Needs>(p)
        .unwrap()
        .set(NeedId::Bladder, 0.0);
    issue(
        &mut sim,
        SimCommand::UseObjectFirst {
            agent: p.index_u32(),
            object: seat.index_u32(),
            interaction: 0,
        },
    );
    sim.flush_commands();
    assert_eq!(stage(&sim, p), Some(ReadingStage::Return));
    for _ in 0..200 {
        sim.tick();
        if stage(&sim, p).is_none() {
            break;
        }
        assert!(sim.world().get::<Eating>(p).is_none());
    }
    assert!(matches!(
        sim.book_copies()[0].location,
        BookLocation::Shelf(_)
    ));
    sim.tick();
    assert_eq!(sim.world().get::<Target>(p).unwrap().object, seat);
    assert_eq!(sim.world().get::<Target>(p).unwrap().interaction, 0);
}
#[test]
fn reading_journey_preview_cost_and_neutrality_on_real_household() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut().insert_resource(Funds(1000));
    let pack = sim.world().resource::<Content>().0;
    let p = sim
        .world_mut()
        .query::<(Entity, &Agent, &SimId)>()
        .iter(sim.world())
        .find(|(_, _, id)| id.0 == 0)
        .unwrap()
        .0;
    let shelf = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| pack.object(o.0).shelf_capacity > 0)
        .unwrap()
        .0;
    let ordinary = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| pack.object(o.0).id == "potted_plant")
        .unwrap()
        .0;
    let title = pack.books[0].id.clone();
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, shelf, &title, false);
    sim.tick();
    assert!(sim.world().get::<ReadingJourney>(p).is_some());
    let saved = sim.save_snapshot_v6();
    let hash = sim.world_hash();
    let run = |object: Entity| {
        let at = *sim.world().get::<Position>(object).unwrap();
        let facing = sim.world().get::<ObjectFacing>(object).unwrap().0;
        let now = std::time::Instant::now();
        for _ in 0..10 {
            crate::placement::validate_placement(
                sim.world(),
                object.index_u32(),
                (at.x as u32, at.y as u32),
                facing,
            )
            .unwrap();
        }
        now.elapsed().as_micros()
    };
    let ordinary_us = run(ordinary);
    let shelf_us = run(shelf);
    eprintln!(
        "reading preview benchmark: 10 ordinary={ordinary_us}us; 10 committed-shelf={shelf_us}us"
    );
    assert_eq!(sim.save_snapshot_v6(), saved);
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.world().resource::<SimRng>(), &saved.legacy.world.rng);
}
#[test]
fn reading_journey_saved_transfer_cannot_overlap_a_reading_seat_endpoint() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    let pack = sim.world().resource::<Content>().0;
    crate::apply_object_placement(
        sim.world_mut(),
        seat,
        pack.object(pack.find("armchair").unwrap()),
        Position { x: 4.0, y: 2.0 },
        Facing::SouthEast,
    );
    purchase(&mut sim, Some(shelf), &title);
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    until(&mut sim, p, ReadingStage::Read);
    assert_eq!(
        sim.world().get::<ReadingJourney>(p).unwrap().destination,
        (4, 3),
        "the positive control must own the forged transfer endpoint"
    );
    let other_shelf =
        sim.spawn_object(Position { x: 7.0, y: 7.0 }, pack.find("bookshelf").unwrap());
    let other_seat = sim.spawn_object(Position { x: 10.0, y: 8.0 }, pack.find("armchair").unwrap());
    issue(
        &mut sim,
        SimCommand::Book(BookCommand::Transfer {
            copy: 1,
            shelf: Some(other_shelf.index_u32()),
        }),
    );
    sim.flush_commands();
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let other = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 1.0, y: 2.0 },
            Needs::all_at(80.0),
            IntentQueue::default(),
        ))
        .id();
    read(&mut sim, other, other_seat, &title, false);
    sim.tick();
    assert_eq!(stage(&sim, other), Some(ReadingStage::Fetch));
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    let hash = sim.world_hash();
    let mut bad = saved.clone();
    let journey = bad
        .reading
        .iter_mut()
        .find(|j| j.owner == other.index_u32())
        .unwrap();
    journey.shelf = shelf.index_u32();
    journey.transfer_contact = Some((4, 3));
    let home = terri_core::books::ShelfSlot {
        shelf: terri_core::books::BookShelfId(u64::from(shelf.index_u32())),
        slot: 1,
    };
    bad.books.copies[1].home = Some(home);
    bad.books.copies[1].location = BookLocation::Shelf(home);
    let pos = sim.world().get::<Position>(other).unwrap();
    let steps = sim
        .world()
        .resource::<TileGrid>()
        .find_path((pos.x.round() as i32, pos.y.round() as i32), (4, 3))
        .and_then(|s| {
            sim.world()
                .resource::<TileGrid>()
                .anchor_path((pos.x, pos.y), s)
        })
        .unwrap();
    bad.legacy
        .world
        .entities
        .iter_mut()
        .find(|e| e.index == other.index_u32())
        .unwrap()
        .path = Some(terri_core::SavedPath { steps, cursor: 0 });
    assert!(sim.load_snapshot_v6(bad).is_err());
    assert_eq!(sim.save_snapshot_v6(), saved);
    assert_eq!(sim.world_hash(), hash);
}

#[test]
fn reading_journey_autonomy_owns_copy_and_duplicate_editions_do_not_bias_choices() {
    let (mut sim, p, shelf, _seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    sim.world_mut()
        .entity_mut(p)
        .insert(Needs::with(NeedId::Fun, 0.0));
    let one = sim.save_snapshot_v6();
    purchase(&mut sim, Some(shelf), &title);
    let two = sim.save_snapshot_v6();
    let mut reads = 0;
    for seed in 0..100 {
        let mut decisions = vec![];
        for saved in [&one, &two] {
            sim.load_snapshot_v6(saved.clone()).unwrap();
            sim.world_mut().insert_resource(SimRng::from_seed(seed));
            sim.tick();
            let j = sim.world().get::<ReadingJourney>(p);
            if let Some(j) = j {
                assert!(j.order.is_none());
                assert_eq!(
                    sim.world()
                        .resource::<BookLibrary>()
                        .copy(j.copy)
                        .unwrap()
                        .borrower,
                    sim.world().get::<SimId>(p).copied()
                );
            }
            decisions.push((j.is_some(), sim.world().get::<Target>(p).copied()));
        }
        assert_eq!(
            decisions[0], decisions[1],
            "duplicate copy changed choice for seed {seed}"
        );
        if decisions[0].0 {
            reads += 1;
        }
    }
    assert!(
        reads > 20,
        "real autonomous reads must be exercised, got {reads}"
    );
}
#[test]
fn reading_journey_two_standing_readers_leave_the_shelf_front_available() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    sim.world_mut().entity_mut(seat).insert(Reserved);
    purchase(&mut sim, Some(shelf), &title);
    purchase(&mut sim, Some(shelf), &title);
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let other = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 1.0, y: 2.0 },
            Needs::all_at(80.0),
            IntentQueue::default(),
        ))
        .id();
    read(&mut sim, p, shelf, &title, false);
    read(&mut sim, other, shelf, &title, false);
    until(&mut sim, other, ReadingStage::Read);
    assert_eq!(stage(&sim, p), Some(ReadingStage::Read));
    let first = sim.world().get::<ReadingJourney>(p).unwrap();
    let second = sim.world().get::<ReadingJourney>(other).unwrap();
    assert!(first.seat.is_none() && second.seat.is_none());
    assert_ne!(first.destination, second.destination);
    assert!(!shelf_contact_tile(sim.world(), first.destination));
    assert!(!shelf_contact_tile(sim.world(), second.destination));
    let occupancy = crate::seating::occupancy(sim.world_mut());
    assert!(occupancy.endpoint_available(crate::seating::EndpointUse {
        owner: Entity::PLACEHOLDER,
        endpoint: (4, 3),
        kind: crate::seating::UseKind::ShelfTransfer
    }));
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
}
#[test]
fn reading_journey_extreme_finite_shelf_coordinates_reject_without_panicking() {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, p, seat, &title, false);
    sim.tick();
    let saved = sim.save_snapshot_v6();
    let hash = sim.world_hash();
    let mut bad = saved.clone();
    bad.legacy
        .world
        .entities
        .iter_mut()
        .find(|e| e.index == shelf.index_u32())
        .unwrap()
        .position
        .as_mut()
        .unwrap()
        .x = f32::MAX;
    let result =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| sim.load_snapshot_v6(bad)));
    assert!(
        result.is_ok(),
        "malformed saved shelf coordinates must not panic"
    );
    assert!(result.unwrap().is_err());
    assert_eq!(sim.save_snapshot_v6(), saved);
    assert_eq!(sim.world_hash(), hash);
}

mod review;
mod upstream_integration;

#[test]
fn reading_return_blocks_front_chore_and_board_until_book_is_home() {
    use terri_core::chores::{ChoreKey, ChoreKind, ChoreWork, SavedChores};
    let (mut sim, person, shelf, seat, title) = fixture("armchair");
    let pack = sim.world().resource::<Content>().0;
    let bin = sim.spawn_object(Position { x: 5.0, y: 12.0 }, pack.find("trashcan").unwrap());
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, person, seat, &title, false);
    until(&mut sim, person, ReadingStage::Read);
    sim.tick();
    for (x, y) in [(2, 3), (4, 3), (3, 2), (3, 4)] {
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(x, y, true);
    }
    sim.world_mut().resource_mut::<SavedChores>().bins = vec![(bin.index_u32(), 600)];
    issue(
        &mut sim,
        SimCommand::CleanChoreFirst {
            agent: person.index_u32(),
            key: ChoreKey {
                kind: ChoreKind::Bins,
                target: bin.index_u32(),
            },
        },
    );
    sim.flush_commands();
    until(&mut sim, person, ReadingStage::WaitingReturn);
    let order = sim.world().get::<IntentQueue>(person).unwrap().entries()[0].id;
    for _ in 0..10 {
        sim.tick();
        assert_eq!(stage(&sim, person), Some(ReadingStage::WaitingReturn));
        assert!(sim.world().get::<ChoreWork>(person).is_none());
        assert!(sim
            .world()
            .get::<IntentQueue>(person)
            .unwrap()
            .order(order)
            .is_some());
    }
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(4, 3, false);
    let mut worked = false;
    for _ in 0..500 {
        sim.tick();
        if sim.world().get::<ChoreWork>(person).is_some() {
            assert!(stage(&sim, person).is_none());
            assert!(matches!(
                sim.book_copies()[0].location,
                BookLocation::Shelf(_)
            ));
            worked = true;
            break;
        }
    }
    assert!(
        worked,
        "the waiting exact chore must start after returning the copy"
    );
}

#[test]
fn complete_queue_roundtrip_preserves_book_cleanup_chore_ids_and_finite_cap() {
    use terri_core::{
        chores::{ChoreKey, ChoreKind, ChoreOrder, SavedChores},
        save::{SavedCleanupOrder, SavedTargetedCleanup},
    };
    let (mut sim, person, shelf, seat, title) = fixture("armchair");
    let pack = sim.world().resource::<Content>().0;
    let surface = sim.spawn_object(Position { x: 12.0, y: 10.0 }, pack.find("counter").unwrap());
    let bin = sim.spawn_object(Position { x: 5.0, y: 12.0 }, pack.find("trashcan").unwrap());
    purchase(&mut sim, Some(shelf), &title);
    sim.world_mut()
        .entity_mut(person)
        .insert(terri_core::AtWork {
            remaining_ticks: 1000,
        });
    sim.tick();
    let read_row = pack
        .object(pack.find("armchair").unwrap())
        .interactions
        .iter()
        .position(|action| action.book_reading)
        .unwrap() as u32;
    let mut queue = IntentQueue::default();
    queue.insert_order(
        terri_core::Intent {
            object: seat,
            interaction: 0,
            cleanup: None,
            chore: None,
        },
        None,
        false,
    );
    queue.insert_order(
        terri_core::Intent {
            object: seat,
            interaction: read_row,
            cleanup: None,
            chore: None,
        },
        Some(title),
        false,
    );
    queue.insert_order(
        terri_core::Intent {
            object: surface,
            interaction: 0,
            cleanup: Some(0),
            chore: None,
        },
        None,
        false,
    );
    queue.insert_order(
        terri_core::Intent {
            object: person,
            interaction: 0,
            cleanup: None,
            chore: Some(0),
        },
        None,
        false,
    );
    sim.world_mut().entity_mut(person).insert(queue);
    sim.world_mut().insert_resource(SavedTargetedCleanup {
        next_order: 1,
        orders: vec![SavedCleanupOrder {
            id: 0,
            person: person.index_u32(),
            surface: surface.index_u32(),
            dishes: None,
            queue_position: Some(2),
        }],
    });
    {
        let mut chores = sim.world_mut().resource_mut::<SavedChores>();
        chores.next_order = 1;
        chores.orders = vec![ChoreOrder {
            id: 0,
            person: person.index_u32(),
            key: ChoreKey {
                kind: ChoreKind::Bins,
                target: bin.index_u32(),
            },
            queue_position: 3,
        }];
    }
    let saved = sim.save_snapshot_v6();
    assert_eq!(
        saved
            .queues
            .iter()
            .find(|row| row.owner == person.index_u32())
            .unwrap()
            .orders
            .len(),
        4
    );
    sim.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v6(), saved);
    let before = sim.save_snapshot_v6();
    let mut limited = pack.clone();
    limited.tuning.max_queued_intents = 3;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(limited))));
    assert!(sim.load_snapshot_v6(saved).is_err());
    assert_eq!(sim.save_snapshot_v6(), before);
}
