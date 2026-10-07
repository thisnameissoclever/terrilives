use super::*;

#[derive(Debug)]
struct Totals {
    ticks: u32,
    sessions: u32,
    fun: f32,
    comfort: f32,
    satisfaction: f32,
}
fn complete_title(cap: u32, duration: u32) -> Totals {
    let (mut sim, p, shelf, seat, title) = fixture("armchair");
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading.as_mut().unwrap().session_ticks = cap;
    let def = pack.find("armchair").unwrap();
    pack.objects[def.0 as usize]
        .interactions
        .iter_mut()
        .find(|a| a.book_reading)
        .unwrap()
        .duration_ticks = duration;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    purchase(&mut sim, Some(shelf), &title);
    let mut totals = Totals {
        ticks: 0,
        sessions: 0,
        fun: 0.0,
        comfort: 0.0,
        satisfaction: 0.0,
    };
    while sim
        .reading_progress(p.index_u32(), &title)
        .is_none_or(|m| m.completed_passes == 0)
    {
        totals.sessions += 1;
        assert!(totals.sessions <= 400, "a title must finish");
        read(&mut sim, p, seat, &title, false);
        until(&mut sim, p, ReadingStage::Read);
        let order = sim.world().get::<ReadingJourney>(p).unwrap().order.unwrap();
        let mut elapsed = 0;
        while stage(&sim, p) == Some(ReadingStage::Read) {
            sim.world_mut().entity_mut(p).insert(Needs::all_at(40.0));
            sim.tick();
            elapsed += 1;
            totals.ticks += 1;
            let needs = sim.world().get::<Needs>(p).unwrap();
            totals.fun += needs.get(NeedId::Fun) - 40.0;
            totals.comfort += needs.get(NeedId::Comfort) - 40.0;
            let memory = sim.reading_progress(p.index_u32(), &title).unwrap();
            if memory.completed_passes == 0 {
                assert_eq!(memory.pass_novelty, Some(1.0));
            }
            if totals.sessions == 2 && elapsed == 3 {
                let saved = sim.save_snapshot_v6();
                let hash = sim.world_hash();
                sim.load_snapshot_v6(saved.clone()).unwrap();
                assert_eq!(sim.save_snapshot_v6(), saved);
                assert_eq!(sim.world_hash(), hash);
            }
        }
        assert!(elapsed <= cap);
        finish_order(&mut sim, p, order);
    }
    let memory = sim.reading_progress(p.index_u32(), &title).unwrap();
    assert_eq!(memory.progress_ticks, 0);
    assert_eq!(memory.progress_fraction, 0.0);
    assert_eq!(memory.completed_passes, 1);
    totals.satisfaction = sim.world().get::<Satisfaction>(p).unwrap().value();
    totals
}
#[test]
fn fix1_session_cap_changes_only_session_partition() {
    let hour = complete_title(60, 60);
    let half = complete_title(30, 60);
    assert_eq!((hour.ticks, hour.sessions), (180, 3));
    assert_eq!((half.ticks, half.sessions), (180, 6), "{half:?}");
    assert!(
        (hour.fun - half.fun).abs() < 0.001,
        "{hour:?} versus {half:?}"
    );
    assert!((hour.comfort - half.comfort).abs() < 0.001);
    assert!((hour.satisfaction - half.satisfaction).abs() < 0.000001);
    assert!((hour.comfort - 45.0).abs() < 0.001);
}
#[test]
fn fix1_fast_work_exceeds_short_cap_and_slow_fractional_work_survives() {
    let fast = complete_title(1, 1);
    assert_eq!((fast.ticks, fast.sessions), (3, 3), "{fast:?}");
    let slow = complete_title(7, 80);
    assert_eq!((slow.ticks, slow.sessions), (240, 35), "{slow:?}");
    let baseline = complete_title(60, 60);
    assert!((fast.fun - baseline.fun).abs() < 0.001);
    assert!((slow.fun - baseline.fun).abs() < 0.001);
    assert!((fast.satisfaction - baseline.satisfaction).abs() < 0.000001);
    assert!((slow.satisfaction - baseline.satisfaction).abs() < 0.000001);
    assert!((fast.comfort - 0.75).abs() < 0.001);
    assert!((slow.comfort - 60.0).abs() < 0.001);
}
#[test]
fn fix1_mid_session_reward_bound_allows_prior_healthy_condition_and_refuses_inflation() {
    for familiar in [false, true] {
        let (mut sim, p, shelf, seat, title) = fixture("armchair");
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.hobby_multiplier = 2.3;
        let bookworm = pack.traits.iter().position(|t| t.id == "bookworm").unwrap() as u32;
        let condition = pack
            .traits
            .iter()
            .position(|t| t.id == "low_spirits")
            .unwrap() as u32;
        let def = pack.find("armchair").unwrap();
        let row = pack
            .object(def)
            .interactions
            .iter()
            .position(|a| a.book_reading)
            .unwrap() as u32;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        sim.world_mut().entity_mut(p).insert((
            Hobbies(vec!["reading".into()]),
            Traits::from_entries(vec![(bookworm, 0.0), (condition, 0.0)]),
            Personality::with_dispositions([1.0; 7], [1.0; 7], vec![(def, row, 1.4)]),
        ));
        purchase(&mut sim, Some(shelf), &title);
        if familiar {
            for _ in 0..3 {
                read(&mut sim, p, seat, &title, false);
                until(&mut sim, p, ReadingStage::Read);
                let order = sim.world().get::<ReadingJourney>(p).unwrap().order.unwrap();
                finish_order(&mut sim, p, order);
            }
            assert_eq!(
                sim.reading_progress(p.index_u32(), &title)
                    .unwrap()
                    .completed_passes,
                1
            );
        }
        read(&mut sim, p, seat, &title, false);
        until(&mut sim, p, ReadingStage::Read);
        for _ in 0..5 {
            sim.tick();
        }
        let earned = sim
            .world()
            .get::<ReadingJourney>(p)
            .unwrap()
            .earned_satisfaction;
        assert!(earned > 0.0);
        sim.world_mut()
            .get_mut::<Traits>(p)
            .unwrap()
            .set_state(condition, 1.0);
        let saved = sim.save_snapshot_v6();
        let hash = sim.world_hash();
        let rng = sim.world().resource::<SimRng>().clone();
        sim.load_snapshot_v6(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v6(), saved);
        for inflated in [earned * 1.05, 1_000_000.0] {
            let mut bad = saved.clone();
            bad.reading[0].earned_satisfaction = inflated;
            assert!(
                sim.load_snapshot_v6(bad).is_err(),
                "accepted fabricated {inflated} after genuine {earned}"
            );
            assert_eq!(sim.save_snapshot_v6(), saved);
            assert_eq!(sim.world_hash(), hash);
            assert_eq!(*sim.world().resource::<SimRng>(), rng);
        }
        sim.tick();
        let added = sim
            .world()
            .get::<ReadingJourney>(p)
            .unwrap()
            .earned_satisfaction
            - earned;
        assert!(added > 0.0 && added < earned / 5.0);
        let earned = sim
            .world()
            .get::<ReadingJourney>(p)
            .unwrap()
            .earned_satisfaction;
        let before = sim.world().get::<Satisfaction>(p).unwrap().value();
        issue(
            &mut sim,
            SimCommand::CancelIntents {
                agent: p.index_u32(),
            },
        );
        sim.flush_commands();
        assert!(
            (sim.world().get::<Satisfaction>(p).unwrap().value()
                - before
                - earned * Satisfaction::REWARD_SCALE)
                .abs()
                < 0.000004
        );
        let after = sim.world().get::<Satisfaction>(p).unwrap().value();
        sim.flush_commands();
        assert_eq!(sim.world().get::<Satisfaction>(p).unwrap().value(), after);
    }
}
#[test]
fn fix1_requested_title_uses_nearest_copy_regardless_of_allocation_order() {
    for far_first in [true, false] {
        let (mut sim, p, far, seat, title) = fixture("armchair");
        sim.world_mut()
            .entity_mut(far)
            .insert(Position { x: 17.0, y: 17.0 });
        let pack = sim.world().resource::<Content>().0;
        let near = sim.spawn_object(Position { x: 3.0, y: 3.0 }, pack.find("bookshelf").unwrap());
        let order = if far_first { [far, near] } else { [near, far] };
        for shelf in order {
            purchase(&mut sim, Some(shelf), &title);
        }
        read(&mut sim, p, seat, &title, false);
        sim.tick();
        assert_eq!(
            sim.world().get::<ReadingJourney>(p).unwrap().shelf,
            near,
            "older allocation must not discard the near route"
        );
        let saved = sim.save_snapshot_v6();
        sim.load_snapshot_v6(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v6(), saved);
    }
}
#[test]
fn fix1_same_tick_reserved_near_contact_uses_far_copy_and_shelf_requests_stay_local() {
    let (mut sim, blocker, far, seat, title) = fixture("armchair");
    sim.world_mut()
        .entity_mut(far)
        .insert(Position { x: 17.0, y: 17.0 });
    let pack = sim.world().resource::<Content>().0;
    let near = sim.spawn_object(Position { x: 3.0, y: 3.0 }, pack.find("bookshelf").unwrap());
    let other_seat = sim.spawn_object(Position { x: 7.0, y: 2.0 }, pack.find("armchair").unwrap());
    purchase(&mut sim, Some(far), &title);
    purchase(&mut sim, Some(near), &title);
    let other_title = pack
        .books
        .iter()
        .find(|b| b.id != title)
        .unwrap()
        .id
        .clone();
    purchase(&mut sim, Some(near), &other_title);
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let p = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 1.0, y: 2.0 },
            Needs::all_at(80.0),
            IntentQueue::default(),
        ))
        .id();
    read(&mut sim, blocker, other_seat, &other_title, false);
    read(&mut sim, p, seat, &title, false);
    sim.tick();
    assert_eq!(
        sim.world().get::<ReadingJourney>(blocker).unwrap().shelf,
        near
    );
    assert_eq!(sim.world().get::<ReadingJourney>(p).unwrap().shelf, far);
    assert!(sim.book_copies()[1].borrower.is_none());
    let (mut local, p, far, _seat, title) = fixture("armchair");
    local
        .world_mut()
        .entity_mut(far)
        .insert(Position { x: 17.0, y: 17.0 });
    let near = local.spawn_object(Position { x: 3.0, y: 3.0 }, pack.find("bookshelf").unwrap());
    purchase(&mut local, Some(near), &title);
    purchase(&mut local, Some(far), &title);
    read(&mut local, p, far, &title, false);
    local.tick();
    assert_eq!(local.world().get::<ReadingJourney>(p).unwrap().shelf, far);
}
#[test]
fn fix1_equal_routes_use_stable_copy_ids_and_reserved_copy_falls_back() {
    for reverse in [false, true] {
        let (mut sim, p, a, seat, title) = fixture("armchair");
        let pack = sim.world().resource::<Content>().0;
        let b = sim.spawn_object(Position { x: 2.0, y: 4.0 }, pack.find("bookshelf").unwrap());
        let order = if reverse { [b, a] } else { [a, b] };
        for shelf in order {
            purchase(&mut sim, Some(shelf), &title);
        }
        let origin = Target {
            object: seat,
            interaction: 1,
        };
        let mut choices = plans(sim.world_mut(), p, origin, Some(&title));
        assert_eq!(choices[0].route_steps, choices[1].route_steps);
        assert_eq!(choices[0].score, choices[1].score);
        choices.reverse();
        let occupancy = crate::seating::occupancy(sim.world_mut());
        let selected = choose_plan(
            &choices,
            p,
            Some(&title),
            &occupancy,
            &Default::default(),
            &mut SimRng::from_seed(5),
            pack,
        )
        .unwrap();
        assert_eq!(selected.copy, BookCopyId(0));
        read(&mut sim, p, seat, &title, false);
        sim.tick();
        assert_eq!(
            sim.world().get::<ReadingJourney>(p).unwrap().copy,
            BookCopyId(0)
        );
        assert_eq!(
            sim.world().get::<ReadingJourney>(p).unwrap().shelf,
            order[0]
        );
    }
    let (mut sim, blocker, far, seat, title) = fixture("armchair");
    sim.world_mut()
        .entity_mut(far)
        .insert(Position { x: 17.0, y: 17.0 });
    let pack = sim.world().resource::<Content>().0;
    let near = sim.spawn_object(Position { x: 3.0, y: 3.0 }, pack.find("bookshelf").unwrap());
    let other_seat = sim.spawn_object(Position { x: 7.0, y: 2.0 }, pack.find("armchair").unwrap());
    purchase(&mut sim, Some(far), &title);
    purchase(&mut sim, Some(near), &title);
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let p = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 1.0, y: 2.0 },
            Needs::all_at(80.0),
            IntentQueue::default(),
        ))
        .id();
    read(&mut sim, blocker, other_seat, &title, false);
    read(&mut sim, p, seat, &title, false);
    sim.tick();
    assert_eq!(
        sim.world().get::<ReadingJourney>(blocker).unwrap().copy,
        BookCopyId(1)
    );
    assert_eq!(
        sim.world().get::<ReadingJourney>(p).unwrap().copy,
        BookCopyId(0)
    );
}

#[test]
fn fix1_native_reference_facts_and_capped_plan_score_use_distinct_units() {
    let (mut sim, person, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    let target = Target {
        object: seat,
        interaction: 1,
    };
    let action_id = action(sim.world(), target).unwrap().id.clone();
    let baseline = sim.reading_action_benefits(seat.index_u32(), &action_id);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading.as_mut().unwrap().session_ticks = 30;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    assert_eq!(
        sim.reading_action_benefits(seat.index_u32(), &action_id),
        baseline
    );
    let plan = plans(sim.world_mut(), person, target, Some(&title)).remove(0);
    let pack = sim.world().resource::<Content>().0;
    let id = *sim.world().get::<SimId>(person).unwrap();
    let interest = with_book_world(sim.world(), |context| {
        sim.world()
            .resource::<BookLibrary>()
            .estimate_interest(id, &title, context)
    })
    .unwrap();
    let needs = sim.world().get::<Needs>(person).unwrap();
    let personality = sim
        .world()
        .get::<Personality>(person)
        .cloned()
        .unwrap_or_default();
    let instinct = sim
        .world()
        .get::<SelfPreservation>(person)
        .map_or(50, |s| s.0);
    let duration = 30
        + pack.reading.as_ref().unwrap().pickup_ticks
        + pack.reading.as_ref().unwrap().shelve_ticks;
    let expected = [
        (NeedId::Fun, baseline[0] * 0.5 * interest),
        (NeedId::Comfort, baseline[1] * 0.5),
    ]
    .into_iter()
    .map(|(need, delta)| {
        crate::systems::autonomy::need_score(
            needs,
            need,
            delta * personality.satisfaction[need as usize],
            duration,
            plan.route_steps as f32,
            instinct,
            &pack.tuning,
        )
    })
    .sum::<f32>()
        - plan.risk;
    assert!(
        (plan.score - expected).abs() < 0.00001,
        "{} versus {expected}",
        plan.score
    );
}
