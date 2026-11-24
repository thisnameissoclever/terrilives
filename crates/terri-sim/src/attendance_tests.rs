//! Public-command attendance continuations and hostile-save regressions.
use super::*;
use crate::Sim;
use terri_core::{
    CommandQueue, IntentQueue, Personality, Relationships, Satisfaction, SimCommand,
    SimIdAllocator, SmartObject,
};

fn full_fixture(start: u32, duration: u32, day: u32) -> (Sim, Entity, Entity) {
    let mut pack = terri_data::pack().clone();
    pack.decay_per_tick = [0.0; 7];
    pack.tuning.day_ticks = day;
    pack.tuning.neglect_bleed_per_tick = 0.0;
    pack.tuning.satisfaction_mood_per_tick = 0.0;
    pack.tuning.career_search_chance = 0.0;
    pack.tuning.career_review_noise = 0.0;
    pack.tuning.career_fire_base = 0.0;
    pack.tuning.career_demote_base = 0.0;
    pack.tuning.career_promote_base = 0.0;
    pack.tuning.career_raise_base = 0.0;
    pack.careers[0].shift_start = start;
    pack.careers[0].shift_ticks = duration;
    pack.careers[0].working_days = 0b1111111;
    let hold = terri_core::ObjectDefId(pack.objects.len() as u32);
    pack.objects.push(crate::test_content::object(
        "attendance_hold",
        &[(NeedId::Fun, 10.0)],
        900,
    ));
    let content = Content(Box::leak(Box::new(pack)));
    let mut sim = Sim::new_with_lot_and_content(20, 20, content);
    // Ordinary grass around the floor keeps inbound travel observable.
    {
        let mut surfaces = sim
            .world_mut()
            .resource_mut::<crate::world_geometry::WorldSurfaces>();
        for y in 0..20 {
            for x in 0..20 {
                if x == 0 || y == 0 || x == 19 || y == 19 {
                    surfaces.tiles[y * 20 + x] = 1;
                }
            }
        }
    }
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let actor = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Career(0),
            Position { x: 2.0, y: 4.0 },
            Needs::all_at(100.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
        ))
        .id();
    let object = sim.spawn_object(Position { x: 4.0, y: 4.0 }, hold);
    issue(
        &mut sim,
        SimCommand::SetCareerAutonomy {
            change: false,
            search: false,
        },
    );
    (sim, actor, object)
}

fn start_swimming(sim: &mut Sim, actor: Entity) -> Entity {
    let pool = sim.spawn_object(
        Position { x: 8., y: 8. },
        terri_data::pack().find("pool").unwrap(),
    );
    for y in 8..10 {
        for x in 8..10 {
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(x, y, true);
        }
    }
    sim.world_mut()
        .entity_mut(actor)
        .insert(Position { x: 7., y: 8. });
    sim.world_mut()
        .get_mut::<Needs>(actor)
        .unwrap()
        .set(NeedId::Fun, 0.);
    until(sim, "autonomous swimming", 35, |s| {
        s.world()
            .get::<crate::pool::PoolEpisode>(actor)
            .is_some_and(|e| e.phase == 2)
    });
    pool
}

#[test]
fn pool_autonomous_swimmer_keeps_ownership_until_scheduled_work_can_depart() {
    let (mut sim, actor, _) = full_fixture(40, 120, 240);
    let pool = start_swimming(&mut sim, actor);
    assert!(!crate::player_actions::has_player_work(sim.world(), actor));
    until(&mut sim, "controlled exit for scheduled work", 30, |s| {
        s.world()
            .get::<crate::pool::PoolEpisode>(actor)
            .is_some_and(|e| e.interrupted)
    });
    assert!(sim.world().get::<Commuting>(actor).is_none());
    assert!(sim.world().get::<terri_core::Reserved>(pool).is_some());
    continue_roundtrip(&mut sim, 3);
    while sim.world().get::<crate::pool::PoolEpisode>(actor).is_some() {
        assert!(sim.world().get::<Commuting>(actor).is_none());
        assert!(sim.world().get::<terri_core::Target>(actor).is_some());
        sim.tick();
    }
    assert!(sim.world().get::<terri_core::Reserved>(pool).is_none());
    until(&mut sim, "departure after pool release", 3, |s| {
        s.world().get::<Commuting>(actor).is_some()
    });
    continue_roundtrip(&mut sim, 3);
}
#[test]
fn go_to_work_from_the_pool_resumes_across_both_sides_of_the_ladder_exit() {
    use crate::careers::{CareerRefusal, WorkStatus};

    let (mut sim, actor, _) = full_fixture(40, 120, 240);
    start_swimming(&mut sim, actor);
    sim.world_mut().resource_mut::<SimClock>().tick = 39;
    sim.world_mut()
        .get_mut::<Needs>(actor)
        .unwrap()
        .set(NeedId::Hunger, 0.0);

    let agent = actor.index_u32();
    let sim_id = identity(sim.world(), actor).0;
    let command = SimCommand::GoToWork { agent };
    issue(&mut sim, command.clone());
    assert_eq!(sim.go_to_work_status(agent), Some(WorkStatus::Outbound));
    assert_eq!(sim.save_snapshot_v28().manual_work_trips, [(sim_id, 40)]);
    assert_eq!(sim.world().get::<Commuting>(actor), None);

    let accepted = sim.save_snapshot_v28();
    issue(&mut sim, command);
    assert_eq!(
        sim.world().resource::<Careers>().last_result.unwrap().reason,
        Some(CareerRefusal::AtWork)
    );
    assert_eq!(sim.save_snapshot_v28().pools, accepted.pools);
    assert_eq!(sim.save_snapshot_v28().manual_work_trips, accepted.manual_work_trips);
    let commands = sim.career_command_count();

    continue_roundtrip(&mut sim, 3);
    until(&mut sim, "ladder released", 40, |s| {
        s.world().get::<crate::pool::PoolEpisode>(actor).is_none()
    });
    assert!(manual_work_trip(sim.world(), actor));
    continue_roundtrip(&mut sim, 1);
    assert_eq!(sim.world().get::<Commuting>(actor), Some(&Commuting::Outbound));
    assert!(manual_work_trip(sim.world(), actor));
    assert_eq!(sim.career_command_count(), commands);
    assert_eq!(sim.world().get::<Needs>(actor).unwrap().get(NeedId::Hunger), 0.0);
}

#[derive(Clone, Copy)]
enum WorkReview {
    NoChange,
    Promote,
    Raise,
}

fn swimmer_leaving_at_week_boundary(review: WorkReview) -> (Sim, Entity, Entity, u64) {
    let (mut sim, actor, object) = full_fixture(15, 120, 240);
    let mut pack = sim.world().resource::<Content>().0.clone();
    let next = pack.career_paths[pack.careers[0].path as usize].levels[1] as usize;
    if matches!(review, WorkReview::Promote) {
        pack.tuning.career_promote_base = 1.0;
    }
    if matches!(review, WorkReview::Raise) {
        pack.tuning.career_raise_base = 1.0;
    }
    let old = &mut pack.careers[0];
    old.standard_kind = terri_data::SHIFT_NIGHT;
    old.social_demand = 0.875;
    old.trait_fit = vec![(0, -0.75)];
    old.shifts.clear();
    let new = &mut pack.careers[next];
    new.shift_start = 15;
    new.shift_ticks = 75;
    new.working_days = 0b111_1111;
    new.standard_kind = terri_data::SHIFT_DAY;
    new.social_demand = 0.125;
    new.trait_fit = vec![(0, 0.25)];
    new.shifts.clear();
    sim.world_mut().insert_resource(Content(Box::leak(Box::new(pack))));
    sim.world_mut().resource_mut::<SimClock>().tick = 50;
    start_swimming(&mut sim, actor);
    let boundary = 2 * 7 * 240;
    sim.world_mut().resource_mut::<SimClock>().tick = boundary - 1;
    let id = identity(sim.world(), actor);
    let job = &sim.world().resource::<Content>().0.careers[0];
    let mut record = crate::careers::Record::new(job);
    record.consecutive_good = job.advance_weeks;
    record.shifts.push(if matches!(review, WorkReview::NoChange) { 60.0 } else { 100.0 });
    sim.world_mut().resource_mut::<Careers>().records.insert(id, record);

    let agent = actor.index_u32();
    issue(&mut sim, SimCommand::GoToWork { agent });
    sim.tick();
    assert_eq!(
        sim.world().resource::<Careers>().record(id).unwrap().review_due,
        Some(1)
    );
    (sim, actor, object, boundary)
}

#[test]
fn pool_departure_across_week_boundary_keeps_the_shift_until_the_promotion() {
    let (mut sim, actor, _, boundary) = swimmer_leaving_at_week_boundary(WorkReview::Promote);
    let id = identity(sim.world(), actor);
    let pack = sim.world().resource::<Content>().0;
    let next = pack.career_paths[pack.careers[0].path as usize].levels[1];
    let registered = open_shift(sim.world(), actor).unwrap().clone();
    assert_eq!(registered.start_tick, boundary + 15);
    assert_eq!(registered.career, 0);
    continue_roundtrip(&mut sim, 3);

    until(&mut sim, "arrival at the accepted shift", 100, |s| {
        s.world().get::<AtWork>(actor).is_some()
    });
    assert_eq!(sim.world().get::<Career>(actor), Some(&Career(registered.career)));
    assert_eq!(open_shift(sim.world(), actor).unwrap().pay_cents, registered.pay_cents);
    assert_eq!(sim.world().resource::<Careers>().record(id).unwrap().review_due, Some(1));
    continue_roundtrip(&mut sim, 1);
    until(&mut sim, "shift settlement", 120, |s| {
        s.world().resource::<Attendance>().outcomes.len() == 1
    });
    let payout = &sim.world().resource::<Attendance>().outcomes[0];
    assert_eq!(payout.career, registered.career);
    assert_eq!(payout.start_tick, registered.start_tick);
    assert_eq!(payout.end_tick, registered.end_tick);
    assert!(payout.worked_minutes > 0.0);
    let (pay, _, _) = settlement(
        registered.pay_cents,
        registered.end_tick - registered.start_tick,
        payout.worked_minutes as u64,
        payout.base_score,
        pack.tuning.day_ticks,
    );
    assert_eq!(payout.pay_cents, pay);
    assert_eq!(sim.world().get::<Career>(actor), Some(&Career(next)));
    let record = sim.world().resource::<Careers>().record(id).unwrap();
    assert_eq!(record.review_due, None);
    assert_eq!(record.history.last().unwrap().week, 1);
    assert_eq!(record.history.last().unwrap().performance, 100.0);
    assert_eq!(record.shifts, [payout.score]);
    assert_eq!(record.shift_inputs.len(), 1);
    assert_eq!(record.last_shift.unwrap().missed_minutes, payout.missed_minutes);
    let old_base = pack.careers[0].pay;
    assert_eq!(registered.pay_cents, pack.tuning.shift_pay_cents(old_base, terri_data::SHIFT_NIGHT));
    assert_eq!(record.current_input_sources[&0], crate::careers::ShiftSource { career: 0, base_pay: Some(old_base) });
    let current = sim.save_snapshot_v28();
    assert!(current.previous.career_inputs[0].current.is_empty());
    assert_eq!(current.career_input_sources[0].current.as_ref().unwrap().inputs.len(), 1);
    let mut wrong_source = current.clone();
    wrong_source.career_input_sources[0].current.as_mut().unwrap().sources[0].input_index = 1;
    let before = sim.world_hash();
    assert_eq!(sim.load_snapshot_v28(wrong_source), Err(crate::SaveError::InvalidValue));
    assert_eq!(sim.world_hash(), before);
    let mut duplicate = current.clone();
    duplicate.previous.career_inputs[0].current = duplicate.career_input_sources[0].current.as_ref().unwrap().inputs.clone();
    assert_eq!(sim.load_snapshot_v28(duplicate), Err(crate::SaveError::InvalidValue));
    continue_roundtrip(&mut sim, 1);

    until(&mut sim, "two more shifts under the new job", 600, |s| {
        s.world().resource::<Attendance>().outcomes.len() == 3
    });
    until(&mut sim, "home after the third shift", 60, |s| !physically_away(s.world(), actor));
    assert_eq!(sim.world().resource::<Careers>().record(id).unwrap().shift_inputs.len(), 3);
    continue_roundtrip(&mut sim, 1);
    sim.world_mut().resource_mut::<SimClock>().tick = 3 * 7 * 240 - 1;
    sim.tick();

    let week = sim.career_input_history(actor.index_u32());
    assert_eq!(week.len(), 14);
    let old = &pack.careers[0];
    let new = &pack.careers[next as usize];
    assert_eq!(&week[..6], &[2.0, next as f32, new.path as f32, new.level as f32, 3.0, 3.0]);
    assert_eq!(week[9], (old.social_demand + new.social_demand + new.social_demand) / 3.0);
    let base = week[13] as u32;
    let sources = sim.career_input_sources(actor.index_u32());
    assert_eq!(sources, [
        2.0, f64::from(old.path), f64::from(old.level), f64::from(old_base),
        2.0, f64::from(new.path), f64::from(new.level), f64::from(base),
        2.0, f64::from(new.path), f64::from(new.level), f64::from(base),
    ]);
    let current = sim.save_snapshot_v28();
    let reviewed = &current.career_input_sources[0].weeks[0];
    assert_eq!(reviewed.inputs.week, 2);
    assert_eq!(reviewed.sources.len(), 1);
    assert!(current.previous.career_inputs[0].weeks.is_empty());
    let mut duplicate = current.clone();
    duplicate.previous.career_inputs[0].weeks.push(reviewed.inputs);
    assert_eq!(sim.load_snapshot_v28(duplicate), Err(crate::SaveError::InvalidValue));
    continue_roundtrip(&mut sim, 1);
}

#[test]
fn confirming_an_order_during_a_pool_departure_releases_the_deferred_review() {
    let (mut sim, actor, object, boundary) = swimmer_leaving_at_week_boundary(WorkReview::NoChange);
    let id = identity(sim.world(), actor);
    let agent = actor.index_u32();
    let saved = sim.save_snapshot_v28();
    assert_eq!(saved.manual_work_trips, [(id.0, boundary + 15)]);
    sim.load_snapshot_v28(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v28(), saved);

    let mut wrong_week = sim.current_v17_view();
    wrong_week.legacy.legacy.legacy.careers.records[0].review_due = Some(0);
    assert_eq!(sim.load_current_v17_view(wrong_week), Err(crate::SaveError::InvalidValue));
    let mut wrong_shift = saved.clone();
    wrong_shift.manual_work_trips[0].1 += 1;
    assert_eq!(sim.load_snapshot_v28(wrong_shift), Err(crate::SaveError::InvalidValue));

    let order = SimCommand::UseObject { agent, object: object.index_u32(), interaction: 0 }
        .into_player_order()
        .unwrap();
    let conflict = work_conflicts(sim.world(), &[agent]);
    assert_eq!(conflict.conflicts[0].phase, 2);
    issue(&mut sim, SimCommand::ConfirmedOrder {
        fingerprint: conflict.fingerprint ^ 1,
        command: order.clone(),
    });
    assert!(manual_work_trip(sim.world(), actor));

    issue(&mut sim, SimCommand::ConfirmedOrder {
        fingerprint: conflict.fingerprint,
        command: order,
    });
    assert!(!manual_work_trip(sim.world(), actor));
    assert_ne!(work_conflicts(sim.world(), &[agent]).fingerprint, conflict.fingerprint);
    assert!(open_shift(sim.world(), actor).is_some());
    let record = sim.world().resource::<Careers>().record(id).unwrap();
    assert_eq!(record.review_due, None);
    assert_eq!(record.history.last().unwrap().week, 1);
    assert_eq!(record.history.last().unwrap().performance, 60.0);
    assert!(record.shifts.is_empty());
    let mut contradictory = sim.save_snapshot_v28();
    contradictory.manual_work_trips = saved.editable.manual_work_trips;
    let hash = sim.world_hash();
    assert_eq!(sim.load_snapshot_v28(contradictory), Err(crate::SaveError::InvalidValue));
    assert_eq!(sim.world_hash(), hash);
    continue_roundtrip(&mut sim, 1);
}

#[test]
fn recalling_from_the_ladder_only_replaces_a_future_registration() {
    for offset in [-1, 0, 1] {
        let (mut sim, actor, object, boundary) = swimmer_leaving_at_week_boundary(WorkReview::Promote);
        let id = identity(sim.world(), actor);
        let start = boundary + 15;
        sim.world_mut().resource_mut::<SimClock>().tick = start.checked_add_signed(offset).unwrap();
        hold(&mut sim, actor, object);
        assert!(!manual_work_trip(sim.world(), actor));
        if offset < 0 {
            assert!(open_shift(sim.world(), actor).is_none());
            assert_ne!(sim.world().get::<Career>(actor), Some(&Career(0)));
        } else {
            assert_eq!(open_shift(sim.world(), actor).unwrap().start_tick, start);
            assert_eq!(sim.world().get::<Career>(actor), Some(&Career(0)));
            assert_eq!(sim.world().resource::<Careers>().record(id).unwrap().review_due, Some(1));
        }
        continue_roundtrip(&mut sim, 1);
    }
}

#[test]
fn recalling_before_start_keeps_a_night_shift_base_pay_after_a_raise() {
    let (mut sim, actor, object, _) = swimmer_leaving_at_week_boundary(WorkReview::Raise);
    let id = identity(sim.world(), actor);
    let shift = open_shift(sim.world(), actor).unwrap().clone();
    let base = sim.world().resource::<Content>().0.careers[0].pay;
    hold(&mut sim, actor, object);
    assert!(sim.world().resource::<Careers>().record(id).unwrap().pay > base);
    assert_eq!(open_shift(sim.world(), actor), Some(&shift));
    let saved = sim.save_snapshot_v28();
    assert_eq!(saved.open_shift_base_pay, [terri_core::save_v26::SavedOpenShiftBasePay {
        sim: id.0, start_tick: shift.start_tick, base_pay: Some(base),
    }]);
    let mut invalid = saved;
    invalid.open_shift_base_pay[0].base_pay = Some(1);
    assert_eq!(sim.load_snapshot_v28(invalid), Err(crate::SaveError::InvalidValue));
    continue_roundtrip(&mut sim, 1);
}

#[test]
fn ordinary_rollover_promotes_and_restores_the_exact_displaced_shift() {
    let (mut sim, actor, object) = full_fixture(15, 80, 240);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.career_promote_base = 1.0;
    let original = &pack.careers[0];
    let next = pack.career_paths[original.path as usize].levels[1];
    let advance = original.advance_weeks;
    sim.world_mut().insert_resource(Content(Box::leak(Box::new(pack))));

    let boundary = 2 * 7 * 240;
    sim.world_mut().resource_mut::<SimClock>().tick = boundary - 240 + 14;
    until(&mut sim, "prior shift settled", 90, |s| {
        s.world().resource::<Attendance>().outcomes.len() == 1
    });
    until(&mut sim, "home after prior shift", 60, |s| !physically_away(s.world(), actor));
    let id = identity(sim.world(), actor);
    let prior = sim.world().resource::<Attendance>().shifts[&id].clone();
    assert!(prior.settled);
    {
        let mut careers = sim.world_mut().resource_mut::<Careers>();
        let record = careers.records.get_mut(&id).unwrap();
        record.consecutive_good = advance;
        record.shifts = vec![100.0];
        record.shift_inputs.clear();
    }

    sim.world_mut().resource_mut::<SimClock>().tick = boundary - 40;
    issue(&mut sim, SimCommand::GoToWork { agent: actor.index_u32() });
    assert_eq!(sim.save_snapshot_v28().previous.replaced_shifts, [prior.clone()]);
    hold(&mut sim, actor, object);
    until(&mut sim, "home before weekly rollover", 20, |s| !physically_away(s.world(), actor));
    assert!(sim.world().resource::<SimClock>().tick < boundary);
    assert_eq!(open_shift(sim.world(), actor).unwrap().start_tick, boundary + 15);

    sim.world_mut().resource_mut::<SimClock>().tick = boundary - 1;
    sim.tick();
    assert_eq!(sim.world().get::<Career>(actor), Some(&Career(next)));
    assert_eq!(sim.world().resource::<Attendance>().shifts[&id], prior);
    assert!(sim.save_snapshot_v28().previous.replaced_shifts.is_empty());
    continue_roundtrip(&mut sim, 1);
}

#[test]
fn overnight_pay_keeps_known_night_base_after_the_identical_day_shift_is_held() {
    let (mut sim, actor, object) = full_fixture(220, 120, 240);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.night_shift_premium_percent = 15;
    let job = &mut pack.careers[0];
    job.pay = 120;
    job.standard_kind = terri_data::SHIFT_NIGHT;
    job.shifts = vec![terri_data::CompiledShift {
        id: "same-daylight-hours".into(),
        kind: terri_data::SHIFT_DAY,
        shift_start: 220,
        shift_ticks: 120,
        working_days: 0b111_1111,
        weight: 1,
    }];
    let record = crate::careers::Record::new(job);
    sim.world_mut().insert_resource(Content(Box::leak(Box::new(pack))));
    let id = identity(sim.world(), actor);
    sim.world_mut().resource_mut::<Careers>().records.insert(id, record);
    hold(&mut sim, actor, object);

    sim.world_mut().resource_mut::<SimClock>().tick = 219;
    issue(&mut sim, SimCommand::ChangeShift { agent: actor.index_u32(), shift: 1 });
    sim.tick();
    let shift = open_shift(sim.world(), actor).unwrap().clone();
    assert_eq!(shift.pay_cents, 13_800);
    assert_eq!(sim.world().resource::<Careers>().record(id).unwrap().shift, 1);
    for _ in 220..240 {
        sim.tick();
    }
    assert!(crate::careers::shift_changes_today(sim.world()).is_empty());
    assert_eq!(recorded_base_pay(sim.world(), actor, &shift), Some(120));
    let current = sim.save_snapshot_v28();
    assert!(current.open_shift_base_pay.is_empty());
    let historical = sim.save_snapshot_v24();
    let hash = sim.world_hash();
    sim.load_snapshot_v28(current).unwrap();
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(recorded_base_pay(sim.world(), actor, &shift), Some(120));

    sim.world_mut().resource_mut::<Careers>().records.get_mut(&id).unwrap().pay = 138;
    let mut malformed = sim.save_snapshot_v28();
    assert_eq!(malformed.open_shift_base_pay[0].base_pay, Some(120));
    malformed.open_shift_base_pay[0].base_pay = Some(140);
    assert_eq!(sim.load_snapshot_v28(malformed), Err(crate::SaveError::InvalidValue));
    continue_roundtrip(&mut sim, 0);

    sim.load_snapshot_v24(historical).unwrap();
    assert_eq!(open_shift(sim.world(), actor).unwrap().pay_cents, 13_800);
    assert_eq!(recorded_base_pay(sim.world(), actor, &shift), None);
    assert_eq!(sim.save_snapshot_v28().open_shift_base_pay[0].base_pay, None);
    continue_roundtrip(&mut sim, 1);
}

#[test]
fn night_shift_source_uses_migration_and_registration_proof_before_arithmetic() {
    #[derive(Clone, Copy, Debug)]
    enum Producer {
        Migrated,
        Ambiguous,
        Future,
        Current,
    }
    for (producer, expected_base) in [
        (Producer::Migrated, Some(138)),
        (Producer::Ambiguous, None),
        (Producer::Future, Some(120)),
        (Producer::Current, Some(120)),
    ] {
        let (mut sim, actor, object) = full_fixture(40, 120, 240);
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.night_shift_premium_percent = 15;
        let job = &mut pack.careers[0];
        job.standard_kind = terri_data::SHIFT_NIGHT;
        job.shifts.clear();
        job.pay = 120;
        let record = crate::careers::Record::new(job);
        sim.world_mut().insert_resource(Content(Box::leak(Box::new(pack))));
        let id = identity(sim.world(), actor);
        sim.world_mut().resource_mut::<Careers>().records.insert(id, record);
        hold(&mut sim, actor, object);
        sim.world_mut().resource_mut::<SimClock>().tick = 39;
        if matches!(producer, Producer::Future) {
            issue(&mut sim, SimCommand::GoToWork { agent: actor.index_u32() });
        } else {
            sim.tick();
        }
        let pay = open_shift(sim.world(), actor).unwrap().pay_cents;
        assert_eq!(pay, 13_800);
        match producer {
            Producer::Migrated => {
                let mut historical = sim.save_snapshot_v21();
                let attendance = &mut historical.legacy.legacy.legacy.legacy;
                attendance.attendance.shifts[0].pay_cents = 9_200;
                let careers = &mut attendance.legacy.legacy.legacy.careers;
                assert_eq!(careers.records[0].sim, id.0);
                careers.records[0].pay = 92;
                sim.load_snapshot_v21(historical).unwrap();
            }
            Producer::Ambiguous | Producer::Future => {
                sim.world_mut().resource_mut::<Careers>().records.get_mut(&id).unwrap().pay = 138;
                sim.load_snapshot_v24(sim.save_snapshot_v24()).unwrap();
            }
            Producer::Current => {
                let original = sim.save_snapshot_v28();
                assert!(original.open_shift_base_pay.is_empty());
                sim.load_snapshot_v28(original).unwrap();
                sim.world_mut().resource_mut::<Careers>().records.get_mut(&id).unwrap().pay = 138;
            }
        }
        let shift = open_shift(sim.world(), actor).unwrap().clone();
        assert_eq!(shift.pay_cents, pay, "{producer:?}");
        assert_eq!(registered_pay_kinds(sim.world(), actor, &shift), [false, true]);
        assert_eq!(recorded_base_pay(sim.world(), actor, &shift), expected_base, "{producer:?}");
        let current = sim.save_snapshot_v28();
        if matches!(producer, Producer::Migrated) {
            assert!(current.open_shift_base_pay.is_empty());
        } else {
            assert_eq!(current.open_shift_base_pay[0].base_pay, expected_base, "{producer:?}");
        }
        sim.load_snapshot_v28(current).unwrap();
        sim.world_mut().resource_mut::<Careers>().records.get_mut(&id).unwrap().pay = 139;
        let current = sim.save_snapshot_v28();
        assert_eq!(current.open_shift_base_pay[0].base_pay, expected_base, "{producer:?}");
        sim.load_snapshot_v28(current).unwrap();
        assert_eq!(recorded_base_pay(sim.world(), actor, &shift), expected_base, "{producer:?}");
    }
}

#[test]
fn confirmed_recall_after_a_started_manual_commute_or_work_round_trips() {
    for office in [false, true] {
        let (mut sim, actor, object, _) = swimmer_leaving_at_week_boundary(WorkReview::Promote);
        let id = identity(sim.world(), actor);
        let shift = open_shift(sim.world(), actor).unwrap().clone();
        until(&mut sim, "specified phase of the manual trip", 100, |s| {
            if office {
                s.world().get::<AtWork>(actor).is_some()
            } else {
                s.world().get::<Commuting>(actor) == Some(&Commuting::Outbound)
            }
        });
        assert!(manual_work_trip(sim.world(), actor));
        continue_roundtrip(&mut sim, 0);
        hold(&mut sim, actor, object);
        assert!(!manual_work_trip(sim.world(), actor));
        until(&mut sim, "home after recall", 60, |s| !physically_away(s.world(), actor));
        assert_eq!(open_shift(sim.world(), actor).unwrap().start_tick, shift.start_tick);
        assert_eq!(sim.world().resource::<Careers>().record(id).unwrap().review_due, Some(1));
        continue_roundtrip(&mut sim, 1);
        until(&mut sim, "old obligation settled once", 120, |s| {
            s.world().resource::<Attendance>().outcomes.len() == 1
        });
        assert_eq!(sim.world().resource::<Attendance>().outcomes[0].career, 0);
        assert_ne!(sim.world().get::<Career>(actor), Some(&Career(0)));
        continue_roundtrip(&mut sim, 1);
    }
}

#[test]
fn acknowledged_build_obstruction_ends_a_manual_trip_but_keeps_its_shift() {
    use crate::build_transaction::BuildCommitError;
    use terri_core::layout::{EdgeAxis, SavedLayout, WallState};

    let (mut sim, actor, object) = full_fixture(40, 120, 240);
    let fixture_position = *sim.world().get::<Position>(object).unwrap();
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(
        fixture_position.x as usize,
        fixture_position.y as usize,
        true,
    );
    sim.world_mut().insert_resource(SavedLayout::EdgeWallsV1 { edges: Vec::new() });
    crate::rooms::initialize(sim.world_mut()).expect("the fixture has coherent room geometry");
    crate::placement::lot_usable_for_tests(sim.world()).expect("the fixture supports wall edits");
    sim.world_mut().entity_mut(actor).insert(Position { x: 1.0, y: 4.0 });
    let wall = |sim: &mut Sim, axis, x, y| {
        issue(sim, SimCommand::SetWallEdge { axis, x, y, state: WallState::Wall });
        let receipt = sim.world().resource::<crate::placement::LotEditState>().last_wall_result.unwrap();
        assert_eq!(receipt.reason, None, "{axis:?} {x} {y}");
    };

    // Isolate two tiles with a single open edge directly to ordinary street access.
    sim.begin_build().unwrap();
    for (axis, x, y) in [
        (EdgeAxis::Vertical, 2, 4),
        (EdgeAxis::Horizontal, 0, 4),
        (EdgeAxis::Horizontal, 1, 4),
        (EdgeAxis::Horizontal, 0, 5),
        (EdgeAxis::Horizontal, 1, 5),
    ] {
        wall(&mut sim, axis, x, y);
    }
    let setup = sim.prepare_build_commit(crate::rooms::RoomChoices::default()).unwrap();
    sim.commit_build_with_access_ack(setup.token).unwrap();
    sim.end_build().unwrap();

    sim.world_mut().resource_mut::<SimClock>().tick = 39;
    issue(&mut sim, SimCommand::GoToWork { agent: actor.index_u32() });
    let registered = open_shift(sim.world(), actor).unwrap().clone();
    assert!(manual_work_trip(sim.world(), actor));
    assert_eq!(sim.world().get::<Commuting>(actor), Some(&Commuting::Outbound));
    assert_eq!(sim.world().get::<Path>(actor).unwrap().steps.last(), Some(&(0, 4)));

    sim.begin_build().unwrap();
    wall(&mut sim, EdgeAxis::Vertical, 0, 4);
    let build = sim.prepare_build_commit(crate::rooms::RoomChoices::default()).unwrap();
    assert!(build.access.requires_acknowledgment());
    assert!(build.access.regions.iter().any(|region| {
        region.tiles == [(0, 4), (1, 4)]
            && region.people.contains(&actor.index_u32())
            && !region.external_access
    }));
    assert_eq!(sim.commit_build(build.token), Err(BuildCommitError::AccessAcknowledgmentRequired));
    sim.commit_build_with_access_ack(build.token).unwrap();
    sim.end_build().unwrap();
    assert!(!manual_work_trip(sim.world(), actor));
    assert_eq!(open_shift(sim.world(), actor), Some(&registered));
    continue_roundtrip(&mut sim, 1);
}

#[test]
fn incoming_order_that_becomes_front_recalls_ordinary_work_only() {
    for manual in [false, true] {
        let (mut sim, worker, object) = full_fixture(40, 120, 240);
        let mut pack = sim.world().resource::<Content>().0.clone();
        let hold_id = sim.world().get::<SmartObject>(object).unwrap().0;
        pack.tuning.duration_variance = 0.0;
        pack.objects[hold_id.0 as usize].interactions[0].duration_ticks = 65;
        sim.world_mut().insert_resource(Content(Box::leak(Box::new(pack))));
        let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        let requester = sim.world_mut().spawn((
            Agent, id, Position { x: 4.0, y: 5.0 }, Needs::all_at(100.0), IntentQueue::default(),
            Personality::default(), Relationships::default(), Satisfaction::from_value(0.0),
        )).id();
        hold(&mut sim, requester, object);
        issue(&mut sim, SimCommand::TalkTo {
            agent: requester.index_u32(), target: worker.index_u32(), interaction: 0,
        });
        until(&mut sim, "requester is using the first ordered object", 20, |s| {
            s.world().get::<terri_core::Eating>(requester).is_some()
                && s.world().get::<terri_core::Target>(requester).is_some_and(|t| t.object == object)
        });
        let remaining = sim.world().get::<terri_core::Eating>(requester).unwrap().remaining_ticks;
        assert!(remaining > 30);
        assert_eq!(sim.world().get::<IntentQueue>(requester).unwrap().len(), 2);
        sim.world_mut().resource_mut::<SimClock>().tick = 39;
        if manual {
            issue(&mut sim, SimCommand::GoToWork { agent: worker.index_u32() });
        }
        until(&mut sim, "office arrival while the first order still runs", 30, |s| {
            assert!(s.world().get::<terri_core::Eating>(requester).is_some());
            s.world().get::<AtWork>(worker).is_some()
        });
        until(&mut sim, "older Talk to is next", remaining as usize, |s| {
            s.world().get::<IntentQueue>(requester).and_then(|q| q.entries().first())
                .is_some_and(|entry| entry.intent.object == worker)
        });
        sim.tick();
        assert_eq!(sim.world().get::<AtWork>(worker).is_some(), manual);
        if manual {
            issue(&mut sim, SimCommand::TalkToFirst {
                agent: requester.index_u32(), target: worker.index_u32(), interaction: 0,
            });
            sim.tick();
            assert!(manual_work_trip(sim.world(), worker));
            assert!(sim.world().get::<AtWork>(worker).is_some());
        }
        continue_roundtrip(&mut sim, 1);
    }
}

#[test]
fn older_incoming_order_waits_while_only_later_confirmed_order_recalls_swimmer() {
    let (mut sim, worker, _) = full_fixture(40, 120, 240);
    start_swimming(&mut sim, worker);
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let requester = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 4.0, y: 6.0 },
            Needs::all_at(100.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
        ))
        .id();
    sim.world_mut().resource_mut::<SimClock>().tick = 39;
    let talk = SimCommand::TalkTo {
        agent: requester.index_u32(),
        target: worker.index_u32(),
        interaction: 0,
    };
    issue(&mut sim, talk.clone());
    assert!(crate::player_actions::has_player_work(sim.world(), worker));
    let participants = [requester.index_u32(), worker.index_u32()];
    let before_departure = work_conflicts(sim.world(), &participants).fingerprint;
    issue(&mut sim, SimCommand::GoToWork { agent: worker.index_u32() });
    assert!(manual_work_trip(sim.world(), worker));

    let order = talk.into_player_order().unwrap();
    issue(&mut sim, SimCommand::ConfirmedOrder {
        fingerprint: before_departure,
        command: order.clone(),
    });
    assert!(manual_work_trip(sim.world(), worker));
    let departure = sim.save_snapshot_v28();
    let current = work_conflicts(sim.world(), &participants).fingerprint;
    issue(&mut sim, SimCommand::ConfirmedOrder { fingerprint: current, command: order });
    assert!(!manual_work_trip(sim.world(), worker));

    sim.load_snapshot_v28(departure).unwrap();
    until(&mut sim, "worker gone despite the older Talk to order", 100, |s| {
        s.world().get::<AtWork>(worker).is_some()
    });
    sim.tick();
    assert!(sim.world().get::<AtWork>(worker).is_some());
    assert_eq!(sim.world().get::<IntentQueue>(requester).unwrap().len(), 1);
}

fn use_historical_blank_rooms(sim: &mut Sim) {
    assert_eq!(sim.world().resource::<SimClock>().tick, 0);
    sim.world_mut()
        .remove_resource::<terri_core::rooms::SavedRooms>();
    sim.world_mut().remove_resource::<crate::rooms::RoomMap>();
    sim.world_mut()
        .insert_resource(crate::rooms::RoomReferenceMode::Legacy);
    sim.world_mut()
        .insert_resource(terri_core::layout::SavedLayout::LegacyCells { walls: vec![] });
}

fn issue(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
    sim.flush_commands();
}
fn hold(sim: &mut Sim, actor: Entity, object: Entity) {
    issue(
        sim,
        SimCommand::UseObject {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        },
    );
}
fn until(sim: &mut Sim, description: &str, budget: usize, predicate: impl Fn(&Sim) -> bool) {
    for _ in 0..budget {
        if predicate(sim) {
            return;
        }
        sim.tick();
    }
    assert!(predicate(sim), "did not reach {description}");
}
fn continue_roundtrip(sim: &mut Sim, ticks: usize) {
    // The current save, which also carries each person's job search.
    let saved = sim.current_v19_view();
    let content = sim.world().resource::<Content>().0;
    let mut loaded = Sim::new_with_lot_and_content(20, 20, Content(content));
    loaded
        .load_current_v19_view(saved.clone())
        .expect("valid attendance continuation loads");
    assert_eq!(
        loaded.world_hash(),
        sim.world_hash(),
        "restoration preserves gameplay ownership"
    );
    assert_eq!(loaded.current_v19_view(), saved);
    for step in 0..ticks {
        sim.tick();
        loaded.tick();
        assert_eq!(
            loaded.world_hash(),
            sim.world_hash(),
            "continuation diverged at step {step}"
        );
        assert_eq!(
            loaded.save_snapshot_v17().attendance,
            sim.save_snapshot_v17().attendance
        );
    }
}

#[test]
fn attendance_work_care_refills_only_three_low_needs_on_actual_arrival() {
    for level in [0.0, 20.0, 20.001, 40.0, 40.001] {
        let (mut sim, actor, _) = full_fixture(1, 480, 1440);
        until(&mut sim, "outbound commute", 100, |s| {
            s.world().get::<Commuting>(actor) == Some(&Commuting::Outbound)
        });
        sim.world_mut()
            .entity_mut(actor)
            .insert(Needs::all_at(level));
        sim.tick();
        assert_eq!(
            sim.world().get::<Commuting>(actor),
            Some(&Commuting::Outbound)
        );
        for need in NeedId::ALL {
            assert_eq!(
                sim.world().get::<Needs>(actor).unwrap().get(need),
                level,
                "{need:?} must not refill during the outbound commute"
            );
        }
        until(&mut sim, "office arrival", 100, |s| {
            s.world().get::<AtWork>(actor).is_some()
        });
        for need in NeedId::ALL {
            let cared_for = matches!(need, NeedId::Hunger | NeedId::Bladder | NeedId::Social);
            assert_eq!(
                sim.world().get::<Needs>(actor).unwrap().get(need),
                if cared_for && level <= 40.0 {
                    50.0
                } else {
                    level
                },
                "{need:?} arriving at {level}"
            );
        }
    }
}

#[test]
fn attendance_work_care_preserves_decay_and_refills_before_critical() {
    let (mut sim, actor, _) = full_fixture(1, 480, 1440);
    until(&mut sim, "office arrival", 100, |s| {
        s.world().get::<AtWork>(actor).is_some()
    });
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.decay_per_tick = [1.0; 7];
    let scale = pack.tuning.at_work_decay_scale;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let mut personality = Personality::neutral();
    personality.drain[NeedId::Social.index()] = 2.0;
    sim.world_mut()
        .entity_mut(actor)
        .insert((Needs::all_at(20.75), personality));

    sim.tick();
    for need in NeedId::ALL {
        let expected = if need == NeedId::Social {
            50.0
        } else {
            20.75 - scale
        };
        assert!(
            (sim.world().get::<Needs>(actor).unwrap().get(need) - expected).abs() < 1e-5,
            "{need:?} should decay normally until crossing Critical"
        );
    }
    sim.tick();
    for need in NeedId::ALL {
        let expected = match need {
            NeedId::Hunger | NeedId::Bladder => 50.0,
            NeedId::Social => 50.0 - 2.0 * scale,
            _ => 20.75 - 2.0 * scale,
        };
        assert!(
            (sim.world().get::<Needs>(actor).unwrap().get(need) - expected).abs() < 1e-5,
            "{need:?} should refill only on its own crossing tick"
        );
    }
    sim.world_mut()
        .entity_mut(actor)
        .insert((Needs::all_at(20.0 + scale), Personality::neutral()));
    sim.tick();
    for need in NeedId::ALL {
        assert_eq!(
            sim.world().get::<Needs>(actor).unwrap().get(need),
            if matches!(need, NeedId::Hunger | NeedId::Bladder | NeedId::Social) {
                50.0
            } else {
                20.0
            },
            "{need:?} reaching the exact Critical boundary"
        );
    }
}

#[test]
fn attendance_work_care_recovers_an_already_critical_current_save_next_tick() {
    let (mut sim, actor, _) = full_fixture(1, 480, 1440);
    until(&mut sim, "office arrival", 100, |s| {
        s.world().get::<AtWork>(actor).is_some()
    });
    sim.world_mut()
        .entity_mut(actor)
        .insert(Needs::all_at(20.0));
    continue_roundtrip(&mut sim, 1);
    for need in NeedId::ALL {
        assert_eq!(
            sim.world().get::<Needs>(actor).unwrap().get(need),
            if matches!(need, NeedId::Hunger | NeedId::Bladder | NeedId::Social) {
                50.0
            } else {
                20.0
            },
            "{need:?} critical save recovery"
        );
    }
}

#[test]
fn attendance_short_day_still_uses_one_tick_per_minute() {
    let (mut sim, actor, _) = full_fixture(60, 180, 720);
    sim.world_mut().resource_mut::<SimClock>().tick = 60;
    start_tick(sim.world_mut());
    let quote = work_conflicts(sim.world(), &[actor.index_u32()]);
    assert_eq!(quote.conflicts[0].total_minutes, 180.0);
    assert_eq!(quote.conflicts[0].remaining_minutes, 180.0);
    let (_, deduction, score) = settlement(12000, 180, 90, 80.0, 720);
    assert_eq!(
        deduction, 0.0,
        "90 missed ticks are 90 minutes, within grace"
    );
    assert_eq!(score, 80.0);
}

#[test]
fn attendance_v17_roundtrips_outbound_working_early_return_and_settled_inbound() {
    for phase in ["outbound", "working", "early return", "settled inbound"] {
        let (mut sim, actor, object) = full_fixture(60, 180, 1440);
        until(&mut sim, "outbound commute", 100, |s| {
            s.world().get::<Commuting>(actor) == Some(&Commuting::Outbound)
        });
        if phase != "outbound" {
            until(&mut sim, "office arrival", 100, |s| {
                s.world().get::<AtWork>(actor).is_some()
            });
        }
        if phase == "early return" {
            hold(&mut sim, actor, object);
            assert_eq!(
                sim.world().get::<Commuting>(actor),
                Some(&Commuting::Inbound)
            );
        }
        if phase == "settled inbound" {
            until(&mut sim, "settled return", 220, |s| {
                s.world().get::<Commuting>(actor) == Some(&Commuting::Inbound)
                    && s.world()
                        .resource::<Attendance>()
                        .shifts
                        .values()
                        .any(|s| s.settled)
            });
        }
        continue_roundtrip(&mut sim, 260);
        assert_eq!(
            sim.world().resource::<Attendance>().outcomes.len(),
            1,
            "{phase} settles once"
        );
    }
}

#[test]
fn current_save_rejects_an_outbound_route_that_stops_inside_the_lot() {
    let (mut sim, actor, _) = full_fixture(60, 180, 1440);
    until(&mut sim, "outbound commute", 100, |s| {
        s.world().get::<Commuting>(actor) == Some(&Commuting::Outbound)
    });
    let original = sim.save_snapshot_v28();
    sim.load_snapshot_v28(original.clone()).unwrap();
    let path = sim.world().get::<Path>(actor).unwrap().clone();
    assert!(path.steps.len() > path.cursor + 1);
    sim.world_mut().get_mut::<Path>(actor).unwrap().steps.pop();
    let truncated = sim.save_snapshot_v28();
    sim.world_mut().entity_mut(actor).remove::<Path>();
    let missing = sim.save_snapshot_v28();
    sim.load_snapshot_v28(original.clone()).unwrap();
    for invalid in [truncated, missing] {
        assert!(sim.load_snapshot_v28(invalid).is_err());
        assert_eq!(sim.save_snapshot_v28(), original);
    }
    let (x, y) = *path.steps.last().unwrap();
    sim.world_mut().entity_mut(actor).insert((
        Position { x: x as f32, y: y as f32 },
        Path { steps: vec![], cursor: 0 },
    ));
    let at_exit = sim.save_snapshot_v28();
    sim.load_snapshot_v28(at_exit.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v28(), at_exit);
    sim.tick();
    assert!(sim.world().get::<AtWork>(actor).is_some());
}

#[test]
fn current_save_rejects_a_waiting_return_with_an_office_countdown() {
    let (mut sim, actor, _) = full_fixture(60, 180, 1440);
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(4, 4, true);
    until(&mut sim, "office arrival", 180, |s| {
        s.world().get::<AtWork>(actor).is_some()
    });
    assert!(sim.world().get::<AtWork>(actor).unwrap().remaining_ticks > 1);
    let working = sim.save_snapshot_v28();
    sim.load_snapshot_v28(working.clone()).unwrap();
    assert!(working.commutes.is_empty());

    let mut forged = working.clone();
    forged.commutes.push((actor.index_u32(), 2));
    assert_eq!(sim.load_snapshot_v28(forged), Err(crate::SaveError::InvalidValue));
    assert_eq!(sim.save_snapshot_v28(), working);
}

#[test]
fn current_save_rejects_an_inbound_path_that_ends_before_the_floor() {
    let (mut sim, actor, object) = full_fixture(60, 180, 1440);
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(4, 4, true);
    until(&mut sim, "office arrival", 180, |s| {
        s.world().get::<AtWork>(actor).is_some()
    });
    hold(&mut sim, actor, object);
    assert_eq!(sim.world().get::<Commuting>(actor), Some(&Commuting::Inbound));
    assert_eq!(sim.world().get::<Position>(actor), Some(&Position { x: 0., y: 1. }));
    assert_eq!(sim.world().get::<Path>(actor).unwrap().steps, [(1, 1)]);
    let original = sim.save_snapshot_v28();
    sim.load_snapshot_v28(original.clone()).unwrap();

    // This adjacent tile is walkable grass. The explicit path still has
    // to reach a home destination because the lot already contains floor.
    let mut invalid = crate::current_test_snapshot::CurrentV5View(original.clone());
    let saved_actor = invalid.world.entities.iter_mut()
        .find(|entity| entity.index == actor.index_u32())
        .unwrap();
    saved_actor.path.as_mut().unwrap().steps = vec![(0, 2)];
    assert_eq!(sim.load_snapshot_v28(invalid.0), Err(crate::SaveError::InvalidGrid));
    assert_eq!(sim.save_snapshot_v28(), original);
}

#[test]
fn a_player_order_can_leave_a_worker_waiting_to_return_during_an_open_shift() {
    use crate::world_geometry::{WaitingToReturn, WorldSurfaces};

    let (mut sim, actor, object) = full_fixture(60, 180, 1440);
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(4, 4, true);
    {
        let mut surfaces = sim.world_mut().resource_mut::<WorldSurfaces>();
        surfaces.tiles.fill(1);
        surfaces.tiles[21] = 0;
    }
    until(&mut sim, "office arrival", 180, |s| {
        s.world().get::<AtWork>(actor).is_some()
    });
    assert!(crate::household::arrival(sim.world()).is_ok());
    let review = enclose_inbound_destination(&mut sim);
    sim.commit_build_with_access_ack(review.token).unwrap();
    sim.end_build().unwrap();
    assert!(crate::household::arrival(sim.world()).is_err());

    hold(&mut sim, actor, object);
    assert!(crate::player_actions::has_player_work(sim.world(), actor));
    assert!(sim.world().get::<WaitingToReturn>(actor).is_some());
    assert_eq!(sim.world().get::<AtWork>(actor).unwrap().remaining_ticks, 1);
    let id = *sim.world().get::<SimId>(actor).unwrap();
    let shift = |s: &Sim| s.world().resource::<Attendance>().shifts[&id].clone();
    let before = shift(&sim);
    assert!(!before.settled);
    assert!(sim.world().resource::<SimClock>().tick < before.end_tick);

    let saved = sim.save_snapshot_v28();
    assert_eq!(saved.commutes, [(actor.index_u32(), 2)]);
    sim.load_snapshot_v28(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v28(), saved);
    sim.tick();
    assert!(sim.world().get::<WaitingToReturn>(actor).is_some());
    assert_eq!(shift(&sim).worked_ticks, before.worked_ticks);
    assert!(!shift(&sim).settled);
}

#[test]
fn build_reroutes_an_inbound_worker_from_their_visible_position() {
    let (mut sim, actor, object) = full_fixture(60, 180, 1440);
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(4, 4, true);
    until(&mut sim, "office arrival", 180, |s| {
        s.world().get::<AtWork>(actor).is_some()
    });
    hold(&mut sim, actor, object);
    let start = *sim.world().get::<Position>(actor).unwrap();
    assert_eq!(start, Position { x: 0., y: 1. });
    assert_eq!(sim.world().get::<Path>(actor).unwrap().steps, [(1, 1)]);
    let review = enclose_inbound_destination(&mut sim);
    assert!(review.access.requires_acknowledgment());
    sim.commit_build_with_access_ack(review.token).unwrap();
    sim.end_build().unwrap();
    assert_eq!(sim.world().get::<Position>(actor), Some(&start));
    assert!(sim.world().get::<AtWork>(actor).is_none());
    assert_eq!(sim.world().get::<Commuting>(actor), Some(&Commuting::Inbound));
    assert_eq!(sim.world().get::<Path>(actor).unwrap().steps, [(0, 2), (1, 2)]);
    continue_roundtrip(&mut sim, 5);
}

fn enclose_inbound_destination(sim: &mut Sim) -> crate::build_transaction::BuildReview {
    use terri_core::layout::{EdgeAxis, WallState};
    sim.begin_build().unwrap();
    for (axis, x, y) in [
        (EdgeAxis::Vertical, 1, 1), (EdgeAxis::Vertical, 2, 1),
        (EdgeAxis::Horizontal, 1, 1), (EdgeAxis::Horizontal, 1, 2),
    ] {
        issue(sim, SimCommand::SetWallEdge { axis, x, y, state: WallState::Wall });
        assert_eq!(
            sim.world().resource::<crate::placement::LotEditState>()
                .last_wall_result.unwrap().reason,
            None,
            "wall at {axis:?} {x},{y} must be staged"
        );
    }
    sim.prepare_build_commit(crate::rooms::RoomChoices::default()).unwrap()
}

#[test]
fn stranded_inbound_worker_can_confirm_build_and_settles_review_next_tick() {
    let (mut sim, actor, _) = full_fixture(60, 180, 1440);
    sim.world_mut().resource_mut::<TileGrid>().set_blocked(4, 4, true);
    let mut surfaces = sim.world_mut().resource_mut::<crate::world_geometry::WorldSurfaces>();
    surfaces.tiles.fill(1);
    surfaces.tiles[21] = 0;
    until(&mut sim, "office arrival", 180, |s| {
        s.world().get::<AtWork>(actor).is_some()
    });
    sim.world_mut().resource_mut::<SimClock>().tick = 240;
    account_and_settle(sim.world_mut());
    assert_eq!(sim.world().get::<Commuting>(actor), Some(&Commuting::Inbound));
    let start = *sim.world().get::<Position>(actor).unwrap();
    assert_eq!(start, Position { x: 0., y: 1. });
    let id = *sim.world().get::<SimId>(actor).unwrap();
    let record = |s: &Sim| s.world().resource::<Careers>().record(id).unwrap().clone();
    let tick = 7 * 1440;
    sim.world_mut().resource_mut::<SimClock>().tick = tick;
    crate::careers::review(sim.world_mut(), 0, tick);
    assert_eq!(record(&sim).review_due, Some(0));

    let review = enclose_inbound_destination(&mut sim);
    assert!(review.access.requires_acknowledgment());
    sim.commit_build_with_access_ack(review.token).unwrap();
    sim.end_build().unwrap();
    assert_eq!(sim.world().get::<Commuting>(actor), Some(&Commuting::Inbound));
    assert!(sim.world().get::<Path>(actor).is_none());
    let saved = sim.save_snapshot_v28();
    sim.load_snapshot_v28(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v28(), saved);
    assert_eq!(sim.world().get::<Position>(actor), Some(&start));
    assert!(sim.world().get::<AtWork>(actor).is_none());
    assert!(sim.world().get::<Path>(actor).is_none());
    assert_eq!(record(&sim).review_due, Some(0));
    sim.tick();
    assert!(sim.world().get::<Commuting>(actor).is_none());
    assert_eq!(sim.world().get::<Position>(actor), Some(&start));
    assert_eq!(record(&sim).review_due, None);
    assert_eq!(record(&sim).history.last().unwrap().week, 0);
}

#[test]
fn imported_private_commutes_resave_with_a_current_boundary_exit() {
    let (mut sim, actor, _) = full_fixture(60, 180, 1440);
    until(&mut sim, "outbound commute", 100, |s| {
        s.world().get::<Commuting>(actor) == Some(&Commuting::Outbound)
    });
    let original = sim.save_snapshot_v28();
    let exit = *sim.world().get::<Path>(actor).unwrap().steps.last().unwrap();
    for shortened in [false, true] {
        for version in [22, 23] {
            sim.load_snapshot_v28(original.clone()).unwrap();
            if shortened {
                sim.world_mut().get_mut::<Path>(actor).unwrap().steps.pop();
            }
            if version == 22 {
                sim.load_snapshot_editable_world_v22(sim.try_save_snapshot_editable_world_v22().unwrap()).unwrap();
            } else {
                sim.load_snapshot_editable_world_v23(sim.save_snapshot_editable_world_v23()).unwrap();
            }
            let current = sim.save_snapshot_v28();
            sim.load_snapshot_v28(current.clone()).unwrap();
            assert_eq!(sim.save_snapshot_v28(), current);
            assert_eq!(sim.world().get::<Path>(actor).unwrap().steps.last(), Some(&exit));
        }
    }
}

#[test]
fn attendance_v17_home_hold_crosses_midnight_and_scheduled_week() {
    let (mut sim, actor, object) = full_fixture(1380, 180, 1440);
    sim.world_mut().resource_mut::<SimClock>().tick = 6 * 1440 + 1378;
    hold(&mut sim, actor, object);
    until(&mut sim, "next week while home", 100, |s| {
        s.world().resource::<SimClock>().tick >= 7 * 1440 + 2
    });
    assert!(sim.world().get::<AtWork>(actor).is_none());
    assert!(sim
        .world()
        .resource::<Attendance>()
        .shifts
        .values()
        .any(|s| !s.settled));
    continue_roundtrip(&mut sim, 200);
    let outcome = &sim.world().resource::<Attendance>().outcomes[0];
    assert_eq!(outcome.worked_minutes, 0.0);
    let sim_id = *sim.world().get::<SimId>(actor).unwrap();
    let record = sim.world().resource::<Careers>().record(sim_id).unwrap();
    assert_eq!(record.history[0].week, 0);
}

#[test]
fn attendance_v17_rejects_flipped_settlement_and_mismatched_outcomes_transactionally() {
    let (mut sim, actor, object) = full_fixture(60, 180, 1440);
    until(&mut sim, "office arrival", 180, |s| {
        s.world().get::<AtWork>(actor).is_some()
    });
    for _ in 0..5 {
        sim.tick();
    }
    hold(&mut sim, actor, object);
    until(&mut sim, "returned home before quitting", 100, |s| {
        s.world().get::<Commuting>(actor).is_none()
    });
    issue(
        &mut sim,
        SimCommand::QuitCareer {
            agent: actor.index_u32(),
        },
    );
    issue(
        &mut sim,
        SimCommand::AssignCareer {
            agent: actor.index_u32(),
            path: 0,
        },
    );
    let saved = sim.save_snapshot_v17();
    assert!(saved.attendance.shifts[0].settled);
    let before = sim.world_hash();
    let mut mutations = Vec::new();
    let mut flipped = saved.clone();
    flipped.attendance.shifts[0].settled = false;
    mutations.push(flipped);
    let mut earned = saved.clone();
    let outcome = &mut earned.attendance.outcomes[0];
    outcome.worked_minutes += 1.0;
    outcome.missed_minutes -= 1.0;
    outcome.deduction = ((outcome.missed_minutes - 120.0).max(0.0) / 60.0) * 10.0;
    outcome.score = (outcome.base_score - outcome.deduction).max(0.0);
    mutations.push(earned);
    let mut pay = saved.clone();
    pay.attendance.outcomes[0].pay_cents += 1;
    mutations.push(pay);
    let mut career = saved.clone();
    career.attendance.outcomes[0].career = 1;
    mutations.push(career);
    for invalid in mutations {
        assert!(sim.load_snapshot_v17(invalid).is_err());
        assert_eq!(sim.world_hash(), before, "bad saves change nothing");
    }
}

#[test]
fn attendance_future_incoming_order_does_not_hold_recipient_home() {
    let (mut sim, recipient, object) = full_fixture(60, 180, 1440);
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let actor = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 3.0, y: 4.0 },
            Needs::all_at(100.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
        ))
        .id();
    hold(&mut sim, actor, object);
    issue(
        &mut sim,
        SimCommand::TalkTo {
            agent: actor.index_u32(),
            target: recipient.index_u32(),
            interaction: 0,
        },
    );
    until(&mut sim, "recipient departure", 100, |s| {
        s.world().get::<Commuting>(recipient) == Some(&Commuting::Outbound)
    });
    assert!(sim.world().get::<AtWork>(recipient).is_none());
    let orders = sim
        .world()
        .resource::<crate::player_actions::PlayerActions>();
    assert_eq!(
        orders
            .orders
            .iter()
            .filter(|((owner, _), _)| *owner == actor)
            .count(),
        2
    );
    assert!(orders
        .orders
        .iter()
        .any(|((owner, _), order)| *owner == actor
            && order.entry.intent.object == recipient
            && !order.active));
}

#[test]
fn attendance_v6_pending_reading_shift_migrates_and_survives_real_continuation() {
    use terri_core::{command::BookCommand, save_v6::ReadingStage};
    let (mut sim, actor, _) = full_fixture(60, 180, 1440);
    use_historical_blank_rooms(&mut sim);
    sim.world_mut().entity_mut(actor).remove::<Career>();
    sim.world_mut().insert_resource(Funds::from_dollars(10000));
    let content = sim.world().resource::<Content>().0;
    let shelf = sim.spawn_object(
        Position { x: 3.0, y: 3.0 },
        content.find("bookshelf").unwrap(),
    );
    let chair = sim.spawn_object(
        Position { x: 9.0, y: 5.0 },
        content.find("armchair").unwrap(),
    );
    let title = content
        .books
        .iter()
        .find(|b| b.reading_minutes == 180)
        .unwrap()
        .id
        .clone();
    issue(
        &mut sim,
        SimCommand::Book(BookCommand::Purchase {
            title: title.clone(),
            shelf: Some(shelf.index_u32()),
        }),
    );
    let model = sim.world().get::<SmartObject>(chair).unwrap().0;
    let action = content
        .object(model)
        .interactions
        .iter()
        .find(|a| a.book_reading)
        .unwrap()
        .id
        .clone();
    issue(
        &mut sim,
        SimCommand::Book(BookCommand::Read {
            agent: actor.index_u32(),
            object: chair.index_u32(),
            action,
            title,
            front: false,
        }),
    );
    until(&mut sim, "reading", 200, |s| {
        s.world()
            .get::<crate::reading::ReadingJourney>(actor)
            .is_some_and(|j| j.stage == ReadingStage::Read)
    });
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: actor.index_u32(),
        },
    );
    assert!(sim
        .world()
        .get::<crate::reading::ReadingJourney>(actor)
        .is_some());
    sim.world_mut().entity_mut(actor).insert((
        Career(0),
        crate::reading::PendingShift {
            scheduled_tick: 60,
            career: 0,
        },
    ));
    sim.world_mut().resource_mut::<SimClock>().tick =
        sim.world().resource::<SimClock>().tick.max(70);
    let historical = sim.save_snapshot_v6();
    let mut loaded = Sim::new_with_lot_and_content(20, 20, Content(content));
    loaded
        .load_snapshot_v6(historical)
        .expect("historical returning-copy shift loads");
    let obligation = loaded
        .world()
        .resource::<Attendance>()
        .shifts
        .values()
        .next()
        .expect("saved pending shift must migrate");
    assert_eq!(
        (
            obligation.start_tick,
            obligation.end_tick,
            obligation.worked_ticks
        ),
        (60, 240, 0)
    );
    continue_roundtrip(&mut loaded, 240);
    assert_eq!(loaded.world().resource::<Attendance>().outcomes.len(), 1);
}

fn public_score_shift(indoor: bool) -> (Sim, Entity, Entity) {
    let (mut sim, actor, object) = full_fixture(60, 180, 1440);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.careers[0].energy_cost = 12.0;
    let at = if indoor {
        (0, 4)
    } else {
        crate::portals::street_exit_at(&pack, (0, 0), 20).expect("fixture has a street exit")
    };
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    if indoor {
        crate::test_content::enclose(&mut sim);
        let layout = sim.world().resource::<terri_core::layout::SavedLayout>();
        let mut edges = layout.edges().to_vec();
        edges
            .iter_mut()
            .find(|edge| {
                edge.axis == terri_core::layout::EdgeAxis::Vertical && edge.x == 0 && edge.y == 4
            })
            .unwrap()
            .doorway = true;
        sim.world_mut()
            .insert_resource(terri_core::layout::SavedLayout::EdgeWallsV1 { edges });
        sim.world_mut()
            .resource_mut::<crate::world_geometry::WorldSurfaces>()
            .tiles[4 * 20] = 0;
    }
    sim.world_mut().entity_mut(actor).insert(Position {
        x: at.0 as f32,
        y: at.1 as f32,
    });
    sim.world_mut().resource_mut::<SimClock>().tick = 59;
    issue(
        &mut sim,
        SimCommand::AssignCareer {
            agent: actor.index_u32(),
            path: 0,
        },
    );
    sim.tick();
    assert_eq!(sim.world().resource::<SimClock>().tick, 60);
    assert_eq!(
        sim.world().get::<AtWork>(actor).unwrap().remaining_ticks,
        180,
        "the public assignment starts its full scheduled window without transit loss"
    );
    (sim, actor, object)
}

fn assert_shift_base_uses_accumulated_need_mood(half: bool) {
    let (mut sim, actor, object) = public_score_shift(false);
    if half {
        until(&mut sim, "half of the scheduled office time", 100, |s| {
            s.world().resource::<SimClock>().tick == 150
        });
        hold(&mut sim, actor, object);
        assert_eq!(
            sim.world().get::<Commuting>(actor),
            Some(&Commuting::Inbound)
        );
    }
    until(
        &mut sim,
        "one minute before scheduled settlement",
        200,
        |s| s.world().resource::<SimClock>().tick == 239,
    );
    let pack = sim.world().resource::<Content>().0;
    let job = &pack.careers[0];
    let ratio = if half { 0.5 } else { 1.0 };
    let energy_before = pack.tuning.mood_critical_need_level + job.energy_cost * ratio / 2.0;
    sim.world_mut()
        .get_mut::<Needs>(actor)
        .unwrap()
        .set(NeedId::Energy, energy_before);
    let before_mood = sim.mood_of(actor.index_u32()).unwrap().overall_score;
    assert!(
        before_mood.abs() < 50.0,
        "the fixture must stay inside the career mood term's bounds"
    );
    let before_need_mood = *sim
        .world()
        .get::<crate::need_mood::NeedMood>(actor)
        .unwrap();
    let fit = crate::careers::fit(sim.world(), pack, job, actor);
    let mastery = crate::careers::mastery(sim.world(), pack, job, actor);
    let expected_base = crate::careers::shift_score(fit, mastery, before_mood / 50.0);
    sim.tick();
    let outcome = &sim.world().resource::<Attendance>().outcomes[0];
    assert_eq!(outcome.worked_minutes, if half { 90.0 } else { 180.0 });
    assert_eq!(
        outcome.deduction, 0.0,
        "both cases remain inside the missed-work grace period"
    );
    assert!(
        (outcome.base_score - expected_base).abs() < 0.0001,
        "settlement uses the mood accumulated through the previous minute"
    );
    assert!((outcome.score - expected_base).abs() < 0.0001);
    let sim_id = *sim.world().get::<SimId>(actor).unwrap();
    let recorded = sim
        .world()
        .resource::<crate::careers::Careers>()
        .record(sim_id)
        .unwrap()
        .last_shift
        .unwrap();
    assert_eq!(recorded.mood, before_mood / 50.0);
    assert_eq!(
        sim.world().get::<Needs>(actor).unwrap().get(NeedId::Energy),
        energy_before - job.energy_cost * ratio
    );
    assert_eq!(
        sim.world()
            .get::<crate::need_mood::NeedMood>(actor)
            .unwrap()
            .0,
        before_need_mood.0 + 12,
        "the end of the minute credits the six high needs"
    );
}

#[test]
fn attendance_full_shift_base_uses_accumulated_need_mood() {
    assert_shift_base_uses_accumulated_need_mood(false);
}

#[test]
fn attendance_half_shift_base_uses_accumulated_need_mood() {
    assert_shift_base_uses_accumulated_need_mood(true);
}

#[test]
fn attendance_shift_base_includes_returned_indoor_affinity_mood() {
    let (mut sim, actor, _) = public_score_shift(true);
    let pack = sim.world().resource::<Content>().0;
    // The aquarium model retains its historical persistence key.
    let aquarium = pack
        .find("reference_shelf")
        .expect("shipped aquarium model");
    let kind = pack
        .affinity_kind_of(aquarium.0)
        .expect("aquarium has an affinity kind");
    assert_eq!(pack.affinities[kind as usize].id, "aquarium");
    assert_eq!(
        pack.affinities[kind as usize].reach,
        terri_data::AffinityReach::Presence
    );
    let mut values = vec![0.0; pack.affinities.len()];
    values[kind as usize] = 1.0;
    sim.world_mut()
        .entity_mut(actor)
        .insert(terri_core::Affinities::from_values(values));
    sim.spawn_object(Position { x: 7.0, y: 4.0 }, aquarium);
    until(
        &mut sim,
        "one minute before the indoor shift ends",
        200,
        |s| s.world().resource::<SimClock>().tick == 239,
    );
    assert!(
        crate::affinity::presence_moodlets(sim.world(), pack, actor).is_empty(),
        "the worker is outside the room while AtWork remains set"
    );
    let before_mood = sim.mood_of(actor.index_u32()).unwrap().overall_score;
    let expected_mood = before_mood + pack.tuning.affinity_presence_points;
    let job = &pack.careers[0];
    let expected_base = crate::careers::shift_score(
        crate::careers::fit(sim.world(), pack, job, actor),
        crate::careers::mastery(sim.world(), pack, job, actor),
        expected_mood / 50.0,
    );
    sim.tick();
    assert!(sim.world().get::<AtWork>(actor).is_none());
    let returned = crate::affinity::presence_moodlets(sim.world(), pack, actor);
    assert_eq!(returned.len(), 1);
    assert_eq!(returned[0].score, pack.tuning.affinity_presence_points);
    let outcome = &sim.world().resource::<Attendance>().outcomes[0];
    assert_eq!(outcome.worked_minutes, 180.0);
    assert!(
        (outcome.base_score - expected_base).abs() < 0.0001,
        "base scoring uses the same returned-person context as the previous career settlement"
    );
}

#[test]
fn attendance_adoption_preserves_authoritative_v17_and_only_infers_older_formats() {
    let (mut source, actor, _) = full_fixture(60, 180, 1440);
    source.world_mut().resource_mut::<SimClock>().tick = 80;
    source.world_mut().entity_mut(actor).insert(AtWork {
        remaining_ticks: 100,
    });
    let modern = source.current_v17_view();
    assert!(modern.attendance.shifts.is_empty());
    assert!(modern.attendance.outcomes.is_empty());
    let source_hash = source.world_hash();
    let content = source.world().resource::<Content>().0;
    let mut current = Sim::new_with_lot_and_content(20, 20, Content(content));
    current
        .load_current_v17_view(modern.clone())
        .expect("modern explicit empty attendance loads");
    assert_eq!(
        current.current_v17_view(),
        modern,
        "modern attendance is authoritative, including an empty ledger"
    );
    assert_eq!(
        current.world_hash(),
        source_hash,
        "adoption must not add inferred gameplay after current-format validation"
    );

    let historical = source.save_snapshot_v14();
    let mut first = Sim::new_with_lot_and_content(20, 20, Content(content));
    let mut second = Sim::new_with_lot_and_content(20, 20, Content(content));
    first
        .load_snapshot_v14(historical.clone())
        .expect("older work state migrates");
    second
        .load_snapshot_v14(historical)
        .expect("older migration is repeatable");
    let inferred = first.save_snapshot_v17().attendance;
    assert_eq!(inferred, second.save_snapshot_v17().attendance);
    assert_eq!(
        first.world_hash(),
        second.world_hash(),
        "older inference remains deterministic"
    );
    assert_eq!(inferred.shifts.len(), 1);
    assert!(inferred.outcomes.is_empty());
    let shift = &inferred.shifts[0];
    assert_eq!(shift.sim, source.world().get::<SimId>(actor).unwrap().0);
    assert!(shift.legacy);
    assert!(!shift.settled);
    assert_eq!(
        (
            shift.start_tick,
            shift.end_tick,
            shift.worked_ticks,
            shift.accounted_tick
        ),
        (0, 180, 80, 80)
    );
    assert_eq!(
        first.world().get::<AtWork>(actor).unwrap().remaining_ticks,
        100,
        "legacy adoption preserves the saved remaining office time"
    );
}

#[test]
fn attendance_recalled_worker_serves_ordinary_chat_before_resuming_original_shift() {
    let (mut sim, tim, bill, fridge) = on_lot_recipe_chat_fixture();
    sim.world_mut()
        .entity_mut(tim)
        .insert(terri_core::SimName("Tim".into()));
    sim.world_mut()
        .entity_mut(bill)
        .insert(terri_core::SimName("Bill".into()));
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.careers[0].shift_start = 360;
    pack.careers[0].shift_ticks = 480;
    let snack = pack
        .chains
        .iter_mut()
        .find(|chain| chain.id == "prepare_snack")
        .unwrap();
    snack.steps[0].duration_ticks = 1000;
    let model = sim.world().get::<SmartObject>(fridge).unwrap().0;
    let action = pack.objects[model.0 as usize]
        .interactions
        .iter_mut()
        .find(|action| action.id == "grab_snack")
        .unwrap();
    let steps = &mut action.recipe.as_mut().unwrap().steps;
    steps[0] = 1000;
    action.duration_ticks = steps.iter().sum();
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    for actor in [tim, bill] {
        issue(
            &mut sim,
            SimCommand::AssignCareer {
                agent: actor.index_u32(),
                path: 0,
            },
        );
    }
    until(&mut sim, "the scheduled office departure", 400, |s| {
        s.world().resource::<SimClock>().tick == 359
    });
    assert!(
        sim.world().get::<terri_core::StepWork>(tim).is_some(),
        "the autonomous recipe is physically underway before work interrupts it"
    );
    sim.tick();
    assert_eq!(sim.world().resource::<SimClock>().tick, 360);
    let retained = sim
        .world()
        .get::<terri_core::ChainState>(tim)
        .cloned()
        .expect("the actual outgoing worker retains an autonomous snack recipe");
    assert_eq!(
        sim.world().resource::<Content>().0.chains[retained.chain as usize].id,
        "prepare_snack"
    );
    assert!(
        sim.world()
            .get::<crate::recipe_actions::RecipeOrder>(tim)
            .is_none(),
        "the retained recipe has no older player owner"
    );
    issue(&mut sim, SimCommand::Select(Some(tim.index_u32())));
    let before_cancel = sim.world_hash();
    let quote = work_conflicts(sim.world(), &[tim.index_u32(), bill.index_u32()]);
    assert_eq!(quote.conflicts.len(), 2);
    assert_eq!(
        sim.world_hash(),
        before_cancel,
        "canceling the read-only work warning changes nothing"
    );
    let chat = sim
        .world()
        .resource::<Content>()
        .0
        .social
        .iter()
        .position(|action| action.id == "chat")
        .expect("shipped Chat") as u32;
    issue(
        &mut sim,
        SimCommand::ConfirmedOrder {
            fingerprint: quote.fingerprint,
            command: SimCommand::TalkTo {
                agent: tim.index_u32(),
                target: bill.index_u32(),
                interaction: chat,
            }
            .into_player_order()
            .unwrap(),
        },
    );
    let order_id = sim
        .world()
        .get::<IntentQueue>(tim)
        .unwrap()
        .entries()
        .first()
        .unwrap()
        .id;
    assert_eq!(
        order_id, 0,
        "the browser scenario's first queued order keeps its identity"
    );
    let mut saw_running = false;
    let mut saw_completion = false;
    let mut resumed = [false; 2];
    while sim.world().resource::<SimClock>().tick < 920 {
        sim.tick();
        if sim
            .world()
            .get::<terri_core::Socialising>(tim)
            .is_some_and(|talk| talk.partner == bill)
        {
            saw_running = true;
            let held = sim
                .world()
                .get::<terri_core::ChainState>(tim)
                .expect("serving the order preserves suspended autonomous recipe progress");
            assert_eq!((held.chain, held.step), (retained.chain, retained.step));
        }
        if !saw_completion
            && sim.action_events_since(0).events.iter().any(|event| {
                event.actor == tim.index_u32()
                    && event.order_id == order_id
                    && event.phase == "completed"
            })
        {
            saw_completion = true;
            assert!(
                !sim.world()
                    .resource::<crate::social_episode::SocialEpisodes>()
                    .executions
                    .contains_key(&tim),
                "completion releases the exact conversation execution"
            );
            assert!(
                sim.world().get::<terri_core::Reserved>(bill).is_none(),
                "completion leaves no orphaned recipient claim"
            );
        }
        for (slot, actor) in [tim, bill].into_iter().enumerate() {
            if sim.world().get::<AtWork>(actor).is_some() {
                resumed[slot] = true;
                assert!(
                    saw_completion,
                    "the accepted conversation runs before either worker resumes work"
                );
            }
        }
    }
    let events = sim.action_events_since(0).events;
    let own: Vec<_> = events
        .iter()
        .filter(|event| event.actor == tim.index_u32() && event.order_id == order_id)
        .collect();
    assert!(saw_running && saw_completion, "the accepted ordinary Chat cannot deadlock behind a retained autonomous chain; chain={:?}; rows={:?}; events={own:?}", sim.world().get::<terri_core::ChainState>(tim), sim.action_queue_rows_of(tim.index_u32(), 5));
    assert_eq!(
        own.iter().filter(|event| event.phase == "accepted").count(),
        1
    );
    assert_eq!(
        own.iter().filter(|event| event.phase == "started").count(),
        1
    );
    assert_eq!(
        own.iter()
            .filter(|event| event.phase == "completed")
            .count(),
        1
    );
    assert!(!own
        .iter()
        .any(|event| event.phase == "failed" || event.phase == "canceled"));
    assert_eq!(
        resumed,
        [true, true],
        "both workers resume the remaining original shift"
    );
    let outcomes = &sim.world().resource::<Attendance>().outcomes;
    for person in [0, 1] {
        let shifts: Vec<_> = outcomes
            .iter()
            .filter(|outcome| outcome.sim == person)
            .collect();
        assert_eq!(shifts.len(), 1);
        assert_eq!((shifts[0].start_tick, shifts[0].end_tick), (360, 840));
        assert!(shifts[0].worked_minutes > 0.0);
    }
}

fn on_lot_recipe_chat_fixture() -> (Sim, Entity, Entity, Entity) {
    let (mut sim, actor, hold_object) = full_fixture(60, 180, 1440);
    let mut pack = sim.world().resource::<Content>().0.clone();
    let hold_model = sim.world().get::<SmartObject>(hold_object).unwrap().0;
    pack.objects[hold_model.0 as usize].interactions[0].duration_ticks = 180;
    pack.tuning.duration_variance = 0.0;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    issue(
        &mut sim,
        SimCommand::QuitCareer {
            agent: actor.index_u32(),
        },
    );
    sim.world_mut()
        .entity_mut(actor)
        .insert(Position { x: 1.0, y: 1.0 });
    sim.world_mut()
        .get_mut::<Needs>(actor)
        .unwrap()
        .set(NeedId::Hunger, 30.0);
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let recipient = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 3.0, y: 4.0 },
            Needs::all_at(100.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
        ))
        .id();
    let pack = sim.world().resource::<Content>().0;
    let fridge = sim.spawn_object(Position { x: 3.0, y: 1.0 }, pack.find("fridge").unwrap());
    sim.spawn_object(Position { x: 6.0, y: 1.0 }, pack.find("counter").unwrap());
    hold(&mut sim, recipient, hold_object);
    (sim, actor, recipient, fridge)
}

#[test]
fn attendance_on_lot_ordinary_chat_suspends_autonomous_recipe_and_roundtrips_each_social_phase() {
    let (mut sim, actor, recipient, fridge) = on_lot_recipe_chat_fixture();
    until(&mut sim, "autonomous recipe approach", 100, |s| {
        s.world().get::<terri_core::ChainState>(actor).is_some()
            && s.world()
                .get::<terri_core::Target>(actor)
                .is_some_and(|target| target.interaction == crate::systems::chain::CHAIN_STEP)
    });
    assert!(sim
        .world()
        .get::<crate::recipe_actions::RecipeOrder>(actor)
        .is_none());
    let held = sim
        .world()
        .get::<terri_core::ChainState>(actor)
        .cloned()
        .unwrap();
    let origin = sim
        .world()
        .get::<crate::recipe_actions::Origin>(actor)
        .cloned()
        .unwrap();
    issue(
        &mut sim,
        SimCommand::TalkTo {
            agent: actor.index_u32(),
            target: recipient.index_u32(),
            interaction: 0,
        },
    );
    let order = sim.world().get::<IntentQueue>(actor).unwrap().entries()[0].id;
    let mut saved = [false; 3];
    let mut completed = false;
    let mut resumed_recipe = false;
    for _ in 0..500 {
        let row = sim
            .action_queue_rows_of(actor.index_u32(), 5)
            .into_iter()
            .find(|row| row.order_id == Some(order));
        if let Some(row) = row {
            let phase = match row.phase.as_str() {
                "approaching" => Some(0),
                "waiting" => Some(1),
                "running" => Some(2),
                _ => None,
            };
            if let Some(phase) = phase.filter(|phase| !saved[*phase]) {
                assert!(sim
                    .world()
                    .get::<crate::recipe_actions::RecipeOrder>(actor)
                    .is_none());
                let retained = sim.world().get::<terri_core::ChainState>(actor).unwrap();
                assert_eq!((retained.chain, retained.step), (held.chain, held.step));
                assert_eq!(
                    sim.world().get::<crate::recipe_actions::Origin>(actor),
                    Some(&origin)
                );
                assert!(
                    sim.world().get::<terri_core::Reserved>(fridge).is_none(),
                    "suspension releases only the physical recipe station"
                );
                if phase < 2 {
                    assert!(
                        sim.world().get::<terri_core::Eating>(recipient).is_some(),
                        "incoming Chat waits for the recipient's current directed activity"
                    );
                }
                saved[phase] = true;
                continue_roundtrip(&mut sim, if phase == 2 { 60 } else { 1 });
            }
        }
        completed |= sim.action_events_since(0).events.iter().any(|event| {
            event.actor == actor.index_u32()
                && event.order_id == order
                && event.phase == "completed"
        });
        if completed
            && sim
                .world()
                .get::<terri_core::Target>(actor)
                .is_some_and(|target| target.interaction == crate::systems::chain::CHAIN_STEP)
        {
            resumed_recipe = true;
            break;
        }
        sim.tick();
    }
    assert_eq!(
        saved, [true; 3],
        "approach, busy-recipient waiting and running all persist with the autonomous recipe held"
    );
    assert!(
        completed && resumed_recipe,
        "ordinary player Chat finishes, then the original autonomous recipe resumes"
    );
    let events = sim.action_events_since(0).events;
    let own: Vec<_> = events
        .iter()
        .filter(|event| event.actor == actor.index_u32() && event.order_id == order)
        .collect();
    assert_eq!(
        own.iter().filter(|event| event.phase == "accepted").count(),
        1
    );
    assert_eq!(
        own.iter().filter(|event| event.phase == "started").count(),
        1
    );
    assert_eq!(
        own.iter()
            .filter(|event| event.phase == "completed")
            .count(),
        1
    );
    assert!(!own
        .iter()
        .any(|event| event.phase == "failed" || event.phase == "canceled"));
}

#[test]
fn attendance_chat_preserves_older_player_recipe_queue_and_explicit_front_controls() {
    for front in [false, true] {
        let (mut sim, actor, recipient, fridge) = on_lot_recipe_chat_fixture();
        let pack = sim.world().resource::<Content>().0;
        let row = pack
            .object(sim.world().get::<SmartObject>(fridge).unwrap().0)
            .interactions
            .iter()
            .position(|row| row.id == "grab_snack")
            .unwrap() as u32;
        issue(
            &mut sim,
            SimCommand::UseObject {
                agent: actor.index_u32(),
                object: fridge.index_u32(),
                interaction: row,
            },
        );
        until(&mut sim, "player recipe physical start", 100, |s| {
            s.world().get::<terri_core::StepWork>(actor).is_some()
        });
        let recipe = sim
            .world()
            .get::<crate::recipe_actions::RecipeOrder>(actor)
            .unwrap()
            .0;
        let chat = if front {
            SimCommand::TalkToFirst {
                agent: actor.index_u32(),
                target: recipient.index_u32(),
                interaction: 0,
            }
        } else {
            SimCommand::TalkTo {
                agent: actor.index_u32(),
                target: recipient.index_u32(),
                interaction: 0,
            }
        };
        issue(&mut sim, chat);
        let chat_id = sim
            .world()
            .get::<IntentQueue>(actor)
            .unwrap()
            .entries()
            .iter()
            .find(|entry| entry.intent.object == recipient)
            .unwrap()
            .id;
        for _ in 0..600 {
            let events = sim.action_events_since(0).events;
            let recipe_done = events.iter().any(|event| {
                event.actor == actor.index_u32()
                    && event.order_id == recipe
                    && event.phase == "completed"
            });
            let chat_done = events.iter().any(|event| {
                event.actor == actor.index_u32()
                    && event.order_id == chat_id
                    && event.phase == "completed"
            });
            if recipe_done && chat_done {
                break;
            }
            sim.tick();
        }
        let events = sim.action_events_since(0).events;
        let recipe_done = events
            .iter()
            .find(|event| {
                event.actor == actor.index_u32()
                    && event.order_id == recipe
                    && event.phase == "completed"
            })
            .expect("the original player recipe completes");
        let chat_start = events
            .iter()
            .find(|event| {
                event.actor == actor.index_u32()
                    && event.order_id == chat_id
                    && event.phase == "started"
            })
            .expect("the queued Chat starts");
        let chat_done = events
            .iter()
            .find(|event| {
                event.actor == actor.index_u32()
                    && event.order_id == chat_id
                    && event.phase == "completed"
            })
            .expect("the queued Chat completes");
        if front {
            assert!(
                chat_done.sequence < recipe_done.sequence,
                "explicit front suspends the older player recipe and resumes it later"
            );
        } else {
            assert!(
                recipe_done.sequence < chat_start.sequence,
                "ordinary Chat remains behind its older player recipe"
            );
        }
        for order in [recipe, chat_id] {
            assert_eq!(
                events
                    .iter()
                    .filter(|event| event.actor == actor.index_u32()
                        && event.order_id == order
                        && event.phase == "completed")
                    .count(),
                1
            );
        }
    }
}

fn reciprocal_autonomous_dinner_fixture() -> (Sim, Entity, Entity) {
    dinner_fixture_with_room_era(false)
}

fn dinner_fixture_with_room_era(historical: bool) -> (Sim, Entity, Entity) {
    let (mut sim, actor, _) = full_fixture(60, 180, 1440);
    if historical {
        use_historical_blank_rooms(&mut sim);
    }
    issue(
        &mut sim,
        SimCommand::QuitCareer {
            agent: actor.index_u32(),
        },
    );
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.duration_variance = 0.0;
    pack.tuning.burn_chance_novice = 0.0;
    pack.tuning.burn_chance_master = 0.0;
    pack.voice_clips.clear();
    let durations = [20, 8, 8, 8, 8, 20];
    let dinner = pack
        .chains
        .iter_mut()
        .find(|chain| chain.id == "cook_dinner")
        .unwrap();
    for (step, duration) in dinner.steps.iter_mut().zip(durations) {
        step.duration_ticks = duration;
    }
    let fridge = pack.find("fridge").unwrap();
    pack.objects[fridge.0 as usize]
        .interactions
        .retain(|action| action.id == "cook_dinner");
    let action = &mut pack.objects[fridge.0 as usize].interactions[0];
    action.duration_ticks = durations.iter().sum();
    action.recipe.as_mut().unwrap().steps = durations.to_vec();
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    sim.world_mut()
        .entity_mut(actor)
        .insert(Position { x: 1.0, y: 1.0 });
    sim.world_mut()
        .get_mut::<Needs>(actor)
        .unwrap()
        .set(NeedId::Hunger, 30.0);
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let recipient = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 8.0, y: 1.0 },
            Needs::with(NeedId::Hunger, 30.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
        ))
        .id();
    let pack = sim.world().resource::<Content>().0;
    for x in [3.0, 10.0] {
        sim.spawn_object(Position { x, y: 1.0 }, pack.find("fridge").unwrap());
        sim.spawn_object(Position { x, y: 4.0 }, pack.find("counter").unwrap());
        sim.spawn_object(Position { x, y: 7.0 }, pack.find("stove").unwrap());
    }
    until(
        &mut sim,
        "both autonomous dinners physically underway",
        150,
        |s| {
            [actor, recipient].into_iter().all(|person| {
                s.world().get::<terri_core::ChainState>(person).is_some()
                    && s.world().get::<terri_core::StepWork>(person).is_some()
                    && s.world()
                        .get::<crate::recipe_actions::RecipeOrder>(person)
                        .is_none()
            })
        },
    );
    (sim, actor, recipient)
}

#[test]
fn attendance_reciprocal_autonomous_dinners_finish_elected_recipient_activity_before_each_chat() {
    let (mut sim, a, b) = reciprocal_autonomous_dinner_fixture();
    for (actor, target) in [(a, b), (b, a)] {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkTo {
                agent: actor.index_u32(),
                target: target.index_u32(),
                interaction: 0,
            });
    }
    sim.flush_commands();
    let ids = [
        sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id,
        sim.world().get::<IntentQueue>(b).unwrap().entries()[0].id,
    ];
    let mut saw_dining = [false; 2];
    let mut reloaded = false;
    for _ in 0..1200 {
        for (slot, person) in [a, b].into_iter().enumerate() {
            saw_dining[slot] |= sim
                .world()
                .get::<terri_core::ChainState>(person)
                .is_some_and(|chain| chain.step == 5)
                && sim.world().get::<terri_core::StepWork>(person).is_some();
        }
        let waiting = sim
            .action_queue_rows_of(a.index_u32(), 5)
            .iter()
            .any(|row| row.order_id == Some(ids[0]) && row.phase == "waiting");
        if !reloaded
            && waiting
            && sim
                .world()
                .get::<terri_core::ChainState>(b)
                .is_some_and(|chain| chain.step > 0)
            && sim.world().get::<terri_core::StepWork>(b).is_some()
        {
            continue_roundtrip(&mut sim, 2);
            reloaded = true;
        }
        let events = sim.action_events_since(0).events;
        if [(a, ids[0]), (b, ids[1])].into_iter().all(|(actor, id)| {
            events.iter().any(|event| {
                event.actor == actor.index_u32()
                    && event.order_id == id
                    && event.phase == "completed"
            })
        }) && saw_dining == [true, true]
        {
            break;
        }
        sim.tick();
    }
    assert_eq!(
        saw_dining,
        [true, true],
        "whole foreground recipes reach managed dining despite each person's queued outgoing Chat"
    );
    assert!(reloaded,"an elected recipient's between-step continuation survives V15 restore while the initiator waits");
    let events = sim.action_events_since(0).events;
    let mut completions = Vec::new();
    for (actor, id) in [(a, ids[0]), (b, ids[1])] {
        let own: Vec<_> = events
            .iter()
            .filter(|event| event.actor == actor.index_u32() && event.order_id == id)
            .collect();
        assert_eq!(
            own.iter().filter(|event| event.phase == "accepted").count(),
            1
        );
        assert_eq!(
            own.iter().filter(|event| event.phase == "started").count(),
            1
        );
        let done: Vec<_> = own
            .iter()
            .filter(|event| event.phase == "completed")
            .collect();
        assert_eq!(
            done.len(),
            1,
            "both reciprocal requests finish independently; actor={actor:?}; rows={:?}; chain={:?}",
            sim.action_queue_rows_of(actor.index_u32(), 5),
            sim.world().get::<terri_core::ChainState>(actor)
        );
        completions.push(done[0].sequence);
        assert!(!own
            .iter()
            .any(|event| event.phase == "failed" || event.phase == "canceled"));
        assert!(sim.world().get::<terri_core::Reserved>(actor).is_none());
    }
    assert!(
        completions[0] < completions[1],
        "the oldest accepted conversation runs first without consuming the reciprocal order"
    );
}

#[test]
fn attendance_incoming_chat_follows_current_object_before_suspended_autonomous_recipe() {
    let (mut sim, recipient, actor, _) = on_lot_recipe_chat_fixture();
    until(&mut sim, "autonomous recipe to retain", 100, |s| {
        s.world().get::<terri_core::StepWork>(recipient).is_some()
    });
    let retained = sim
        .world()
        .get::<terri_core::ChainState>(recipient)
        .cloned()
        .unwrap();
    let pack = sim.world().resource::<Content>().0;
    let other = sim.spawn_object(
        Position { x: 10.0, y: 8.0 },
        pack.find("attendance_hold").unwrap(),
    );
    issue(
        &mut sim,
        SimCommand::UseObjectFirst {
            agent: recipient.index_u32(),
            object: other.index_u32(),
            interaction: 0,
        },
    );
    until(
        &mut sim,
        "the replacement object is the recipient's actual activity",
        150,
        |s| {
            s.world()
                .get::<terri_core::Target>(recipient)
                .is_some_and(|target| target.object == other)
                && s.world().get::<terri_core::Eating>(recipient).is_some()
        },
    );
    assert!(
        sim.world()
            .get::<terri_core::ChainState>(recipient)
            .is_some(),
        "the recipe is retained beneath the different current activity"
    );
    issue(
        &mut sim,
        SimCommand::TalkTo {
            agent: actor.index_u32(),
            target: recipient.index_u32(),
            interaction: 0,
        },
    );
    let id = sim
        .world()
        .get::<IntentQueue>(actor)
        .unwrap()
        .entries()
        .iter()
        .find(|entry| entry.intent.object == recipient)
        .unwrap()
        .id;
    let mut reloaded = false;
    let mut started = false;
    for _ in 0..700 {
        if !reloaded
            && sim
                .action_queue_rows_of(actor.index_u32(), 5)
                .iter()
                .any(|row| row.order_id == Some(id) && row.phase == "waiting")
            && sim.world().get::<terri_core::Eating>(recipient).is_some()
        {
            continue_roundtrip(&mut sim, 2);
            reloaded = true;
        }
        if sim
            .world()
            .get::<terri_core::Socialising>(actor)
            .is_some_and(|talk| talk.partner == recipient)
        {
            started = true;
            let chain = sim
                .world()
                .get::<terri_core::ChainState>(recipient)
                .expect("incoming work does not discard the background recipe");
            assert_eq!(
                (chain.chain, chain.step),
                (retained.chain, retained.step),
                "the suspended recipe must not resume before the incoming request"
            );
            assert!(sim
                .world()
                .get::<terri_core::Target>(recipient)
                .is_none_or(|target| target.object != other));
        }
        if sim.action_events_since(0).events.iter().any(|event| {
            event.actor == actor.index_u32() && event.order_id == id && event.phase == "completed"
        }) {
            break;
        }
        sim.tick();
    }
    assert!(reloaded&&started,"after the current object finishes, incoming Chat runs before the unrelated suspended recipe");
}

#[test]
fn attendance_recipe_activity_v17_rejects_contradictory_current_owners_atomically() {
    use terri_core::save_v17::SavedOrderActor;
    let (mut sim, actor, _, _) = on_lot_recipe_chat_fixture();
    until(&mut sim, "foreground recipe station", 100, |s| {
        s.world().get::<terri_core::StepWork>(actor).is_some()
    });
    let identity = SavedOrderActor::Sim(sim.world().get::<SimId>(actor).unwrap().0);
    let foreground = sim.current_v17_view();
    assert!(foreground.background_recipes.is_empty());
    let mut impossible_background = foreground.clone();
    impossible_background.background_recipes.push(identity);
    assert!(matches!(
        sim.load_current_v17_view(impossible_background),
        Err(crate::SaveError::InvalidValue)
    ));
    assert_eq!(sim.current_v17_view(), foreground);

    let pack = sim.world().resource::<Content>().0;
    let object = sim.spawn_object(
        Position { x: 10.0, y: 8.0 },
        pack.find("attendance_hold").unwrap(),
    );
    issue(
        &mut sim,
        SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        },
    );
    until(&mut sim, "foreign foreground object", 150, |s| {
        s.world()
            .get::<terri_core::Target>(actor)
            .is_some_and(|target| target.object == object)
            && s.world().get::<terri_core::Eating>(actor).is_some()
    });
    let suspended = sim.current_v17_view();
    assert_eq!(suspended.background_recipes, vec![identity]);
    let mut impossible_foreground = suspended.clone();
    impossible_foreground.background_recipes.clear();
    assert!(matches!(
        sim.load_current_v17_view(impossible_foreground),
        Err(crate::SaveError::InvalidValue)
    ));
    assert_eq!(sim.current_v17_view(), suspended);
    continue_roundtrip(&mut sim, 2);
}

#[test]
fn attendance_foreground_managed_dining_survives_current_and_legacy_save_adoption() {
    for historical in [false, true] {
        let (mut sim, actor, _) = dinner_fixture_with_room_era(historical);
        until(&mut sim, "actual managed recipe dining", 700, |s| {
            crate::dining::terminal(s.world(), actor)
                && s.world()
                    .get::<terri_core::Target>(actor)
                    .is_some_and(|target| target.interaction == crate::systems::chain::CHAIN_STEP)
                && s.world().get::<terri_core::StepWork>(actor).is_some()
        });
        assert!(crate::recipe_actions::foreground(sim.world(), actor));
        if historical {
            let chain = *sim.world().get::<terri_core::ChainState>(actor).unwrap();
            let origin = sim
                .world()
                .get::<crate::recipe_actions::Origin>(actor)
                .cloned()
                .unwrap();
            let target = sim.world().get::<terri_core::Target>(actor).copied();
            let remaining = sim
                .world()
                .get::<terri_core::StepWork>(actor)
                .unwrap()
                .remaining_ticks;
            let tick = sim.world().resource::<SimClock>().tick;
            let content = sim.world().resource::<Content>().0;
            let mut loaded = Sim::new_with_lot_and_content(20, 20, Content(content));
            loaded
                .load_snapshot_v14(sim.save_snapshot_v14())
                .expect("historical managed dining loads through the frozen reader");
            let restored = loaded.world().get::<terri_core::ChainState>(actor).unwrap();
            assert_eq!(
                (restored.chain, restored.step, restored.fumble_scale),
                (chain.chain, chain.step, chain.fumble_scale)
            );
            assert_eq!(
                loaded.world().get::<crate::recipe_actions::Origin>(actor),
                Some(&origin)
            );
            assert_eq!(
                loaded.world().get::<terri_core::Target>(actor).copied(),
                target
            );
            assert_eq!(
                loaded
                    .world()
                    .get::<terri_core::StepWork>(actor)
                    .unwrap()
                    .remaining_ticks,
                remaining
            );
            assert_eq!(loaded.world().resource::<SimClock>().tick, tick);
            sim = loaded;
        }
        assert!(crate::recipe_actions::foreground(sim.world(), actor));
        assert!(sim.save_snapshot_v17().background_recipes.is_empty());
        continue_roundtrip(&mut sim, 2);
    }
}

#[test]
fn attendance_background_recipe_boundary_roundtrips_before_incoming_chat_arrives() {
    let (mut sim, recipient, actor, _) = on_lot_recipe_chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    let hold = pack.find("attendance_hold").unwrap();
    pack.objects[hold.0 as usize].interactions[0].duration_ticks = 1000;
    let other_model = terri_core::ObjectDefId(pack.objects.len() as u32);
    pack.objects.push(crate::test_content::object(
        "boundary_hold",
        &[(NeedId::Fun, 10.0)],
        180,
    ));
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    until(
        &mut sim,
        "autonomous recipe physically underway",
        100,
        |s| s.world().get::<terri_core::StepWork>(recipient).is_some(),
    );
    let retained = sim
        .world()
        .get::<terri_core::ChainState>(recipient)
        .cloned()
        .unwrap();
    let other = sim.spawn_object(Position { x: 10.0, y: 8.0 }, other_model);
    issue(
        &mut sim,
        SimCommand::UseObjectFirst {
            agent: recipient.index_u32(),
            object: other.index_u32(),
            interaction: 0,
        },
    );
    until(&mut sim, "intervening object nearly complete", 400, |s| {
        s.world()
            .get::<terri_core::Eating>(recipient)
            .is_some_and(|work| work.remaining_ticks == 2)
    });
    assert!(
        sim.world().get::<terri_core::Eating>(actor).is_some(),
        "the initiator has stayed at its distant object"
    );
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: actor.index_u32(),
        },
    );
    issue(
        &mut sim,
        SimCommand::TalkTo {
            agent: actor.index_u32(),
            target: recipient.index_u32(),
            interaction: 0,
        },
    );
    let id = sim.world().get::<IntentQueue>(actor).unwrap().entries()[0].id;
    let mut boundary_seen = false;
    let mut completed = false;
    let mut continuation: Option<Sim> = None;
    for tick in 0..300 {
        let done = sim.action_events_since(0).events.iter().any(|event| {
            event.actor == actor.index_u32() && event.order_id == id && event.phase == "completed"
        });
        if done {
            completed = true;
            break;
        }
        let chain = sim
            .world()
            .get::<terri_core::ChainState>(recipient)
            .expect("the suspended recipe remains until Chat finishes");
        assert_eq!((chain.chain, chain.step), (retained.chain, retained.step));
        assert!(!crate::recipe_actions::foreground(sim.world(), recipient));
        assert!(!sim
            .world()
            .get::<terri_core::Target>(recipient)
            .is_some_and(|target| { target.interaction == crate::systems::chain::CHAIN_STEP }));
        let quiet_recipient = sim.world().get::<terri_core::Target>(recipient).is_none()
            && sim.world().get::<terri_core::Eating>(recipient).is_none()
            && sim
                .world()
                .get::<crate::player_actions::ServedOrder>(recipient)
                .is_none()
            && sim.world().get::<terri_core::StepWork>(recipient).is_none()
            && sim.world().get::<terri_core::Path>(recipient).is_none()
            && sim
                .world()
                .get::<terri_core::Socialising>(recipient)
                .is_none();
        let incoming_approaches = sim
            .world()
            .resource::<crate::social_episode::SocialEpisodes>()
            .executions
            .get(&actor)
            .is_some_and(|execution| {
                execution.recipient == recipient
                    && execution.admitted
                    && execution.phase == crate::social_episode::ExecutionPhase::Approaching
            });
        if !boundary_seen && quiet_recipient && incoming_approaches {
            assert!(!crate::recipe_actions::foreground(sim.world(), recipient));
            let identity = terri_core::save_v17::SavedOrderActor::Sim(
                sim.world().get::<SimId>(recipient).unwrap().0,
            );
            assert!(sim
                .save_snapshot_v17()
                .background_recipes
                .contains(&identity));
            let saved = sim.current_v19_view();
            let content = sim.world().resource::<Content>().0;
            let mut restored = Sim::new_with_lot_and_content(20, 20, Content(content));
            restored
                .load_current_v19_view(saved.clone())
                .expect("the targetless suspended counter loads with authoritative activity state");
            assert_eq!(restored.current_v19_view(), saved);
            assert_eq!(restored.world_hash(), sim.world_hash());
            continuation = Some(restored);
            boundary_seen = true;
        }
        sim.tick();
        if let Some(restored) = continuation.as_mut() {
            restored.tick();
            assert_eq!(
                restored.world_hash(),
                sim.world_hash(),
                "boundary continuation diverged at tick {tick}"
            );
        }
    }
    assert!(boundary_seen, "save the targetless held recipe after the foreign object completes and before incoming Chat physically starts");
    assert!(
        completed,
        "the incoming Chat finishes before recipe resumption"
    );
    assert_eq!(
        continuation
            .expect("the quiet boundary was restored")
            .action_events_since(0)
            .events
            .iter()
            .filter(|event| {
                event.actor == actor.index_u32()
                    && event.order_id == id
                    && event.phase == "completed"
            })
            .count(),
        1
    );
}

#[test]
fn attendance_arriving_chat_waits_for_the_recipients_foreground_recipe() {
    let (mut sim, recipient, actor, _) = on_lot_recipe_chat_fixture();
    until(
        &mut sim,
        "foreground recipe physically underway",
        100,
        |s| s.world().get::<terri_core::StepWork>(recipient).is_some(),
    );
    issue(
        &mut sim,
        SimCommand::CancelIntents {
            agent: actor.index_u32(),
        },
    );
    issue(
        &mut sim,
        SimCommand::TalkTo {
            agent: actor.index_u32(),
            target: recipient.index_u32(),
            interaction: 0,
        },
    );
    let id = sim.world().get::<IntentQueue>(actor).unwrap().entries()[0].id;
    let mut blocked_at_contact = false;
    let mut started = false;
    let mut completed = false;
    for _ in 0..600 {
        if sim
            .world()
            .get::<terri_core::ChainState>(recipient)
            .is_some()
        {
            assert!(crate::recipe_actions::foreground(sim.world(), recipient));
            assert!(
                sim.world().get::<terri_core::Socialising>(actor).is_none(),
                "a foreground whole recipe remains the recipient's current activity"
            );
            let from = sim.world().get::<Position>(actor).unwrap();
            let to = sim.world().get::<Position>(recipient).unwrap();
            blocked_at_contact |= sim.world().resource::<TileGrid>().can_interact_with_rect(
                (from.x.round() as i32, from.y.round() as i32),
                (to.x.round() as i32, to.y.round() as i32),
                terri_core::Footprint::SINGLE,
            ) && sim.world().get::<terri_core::Blocked>(actor).is_some();
        }
        if sim.world().get::<terri_core::Socialising>(actor).is_some() {
            started = true;
            assert!(
                sim.world()
                    .get::<terri_core::ChainState>(recipient)
                    .is_none(),
                "physical Chat starts after the foreground recipe finishes"
            );
        }
        if sim.action_events_since(0).events.iter().any(|event| {
            event.actor == actor.index_u32() && event.order_id == id && event.phase == "completed"
        }) {
            completed = true;
            break;
        }
        sim.tick();
    }
    assert!(
        blocked_at_contact,
        "actual social arrival waits at contact for the foreground recipe"
    );
    assert!(started && completed);
}

// Issue 296, [WS-systems] in `docs/specs/2026-10-18-shifts-and-careers.md`:
// every reader of a job's hours reads the person's held shift.

/// `full_fixture`'s job, standard from 60 for 480 ticks every day, with a
/// second shift `late` from `late_start` for `late_ticks` on `late_days`,
/// and the person holding shift index `held` (0 standard, 1 late).
fn held_fixture(late_start: u32, late_ticks: u32, late_days: u8, held: u32) -> (Sim, Entity) {
    let (mut sim, actor, _) = full_fixture(60, 480, 1440);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.careers[0].standard_weight = 1;
    pack.careers[0].shifts = vec![terri_data::CompiledShift {
        id: "late".to_string(),
        kind: terri_data::SHIFT_LATE,
        shift_start: late_start,
        shift_ticks: late_ticks,
        working_days: late_days,
        weight: 1,
    }];
    let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let sim_id = *sim.world().get::<SimId>(actor).expect("an id");
    sim.world_mut().resource_mut::<Careers>().records.insert(
        sim_id,
        crate::careers::Record {
            shift: held,
            ..crate::careers::Record::new(&pack.careers[0])
        },
    );
    (sim, actor)
}

fn scheduled(sim: &Sim, actor: Entity) -> Option<SavedScheduledShift> {
    let sim_id = *sim.world().get::<SimId>(actor).expect("an id");
    sim.world()
        .resource::<Attendance>()
        .shifts
        .get(&sim_id)
        .cloned()
}

/// [WS-systems] item 1: a held late shift registers at its own start, runs
/// its own length and settles at its own end; the standard shift's start
/// at 60 registers nothing.
#[test]
fn a_held_late_shift_starts_registers_and_ends_on_its_own_times() {
    let (mut sim, actor) = held_fixture(600, 540, 0b1111111, 1);
    until(&mut sim, "the late shift registers", 700, |sim| {
        scheduled(sim, actor).is_some()
    });
    assert_eq!(sim.world().resource::<SimClock>().tick, 600);
    let shift = scheduled(&sim, actor).expect("registered");
    assert_eq!((shift.start_tick, shift.end_tick), (600, 1140));
    until(&mut sim, "the late shift settles", 700, |sim| {
        !sim.world().resource::<Attendance>().outcomes.is_empty()
    });
    let outcome = sim.world().resource::<Attendance>().outcomes[0].clone();
    assert_eq!(
        (
            outcome.start_tick,
            outcome.end_tick,
            outcome.scheduled_minutes
        ),
        (600, 1140, 540.0)
    );
    assert!(outcome.worked_minutes > 0.0, "the worker went to work");
    assert_eq!(
        validate_saved(sim.world(), &to_saved(sim.world()), true),
        Ok(()),
        "an outcome longer than the standard shift validates"
    );
}

/// [WS-systems] item 2: the Proceed and Cancel preflight reports the held
/// shift's start and hours, and nothing at the standard shift's start.
#[test]
fn the_preflight_reports_the_held_shifts_hours() {
    let (mut sim, actor) = held_fixture(600, 540, 0b1111111, 1);
    let agent = actor.index_u32();
    sim.world_mut().resource_mut::<SimClock>().tick = 60;
    assert!(work_conflicts(sim.world(), &[agent]).conflicts.is_empty());
    sim.world_mut().resource_mut::<SimClock>().tick = 600;
    let preflight = work_conflicts(sim.world(), &[agent]);
    let conflict = preflight.conflicts.first().expect("due now");
    assert_eq!(
        (
            conflict.phase,
            conflict.start_tick,
            conflict.end_tick,
            conflict.remaining_minutes,
            conflict.total_minutes
        ),
        (1, 600, 1140, 540.0, 540.0)
    );
}

/// [WS-systems] item 3: a scheduled shift recorded under the standard shift
/// still validates after the person changes to the late shift, and a
/// scheduled shift validates when its start, weekday and length match one
/// shift the row lists, never a mix of two.
#[test]
fn a_saved_scheduled_shift_under_a_previous_shift_still_validates() {
    // The late shift runs Monday to Friday; the standard every day.
    let (mut sim, actor) = held_fixture(600, 540, 0b0011111, 0);
    until(&mut sim, "the standard shift settles", 700, |sim| {
        !sim.world().resource::<Attendance>().outcomes.is_empty()
    });
    until(&mut sim, "the worker is home", 200, |sim| {
        sim.world().get::<Commuting>(actor).is_none() && sim.world().get::<AtWork>(actor).is_none()
    });
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: actor.index_u32(),
            shift: 1,
        },
    );
    let sim_id = *sim.world().get::<SimId>(actor).expect("an id");
    assert_eq!(
        sim.world()
            .resource::<Careers>()
            .record(sim_id)
            .map(|r| r.shift),
        Some(1)
    );
    let shift = scheduled(&sim, actor).expect("the standard shift stays recorded");
    assert_eq!((shift.start_tick, shift.settled), (60, true));
    assert_eq!(validate_saved(sim.world(), &to_saved(sim.world()), true), Ok(()));

    // Open scheduled shifts written by hand, each checked alone at the
    // tick before it ends.
    let pay =
        i64::from(sim.world().resource::<Content>().0.careers[0].pay) * Funds::CENTS_PER_DOLLAR;
    let saturday: u64 = 5 * 1440;
    for (start, ticks, valid) in [
        (600, 540, true),
        (60, 480, true),
        (saturday + 60, 480, true),
        (600, 480, false),
        (60, 540, false),
        (61, 480, false),
        (saturday + 600, 540, false),
    ] {
        let start: u64 = start;
        sim.world_mut().resource_mut::<SimClock>().tick = start + ticks - 1;
        let saved = SavedAttendance {
            shifts: vec![SavedScheduledShift {
                sim: sim_id.0,
                career: 0,
                start_tick: start,
                end_tick: start + ticks,
                worked_ticks: 0,
                accounted_tick: start,
                pay_cents: pay,
                settled: false,
                legacy: false,
            }],
            outcomes: Vec::new(),
        };
        assert_eq!(
            validate_saved(sim.world(), &saved, true).is_ok(),
            valid,
            "start {start}, {ticks} ticks"
        );
    }
}

/// [WS-systems] and careers rule 6: a night shift starting late on Sunday
/// belongs to the week it starts in; the week's review waits while the
/// person works it and runs when it settles.
#[test]
fn a_sunday_night_shift_counts_in_the_ending_week_and_its_review_waits() {
    let sunday: u64 = 6 * 1440;
    let (mut sim, actor) = held_fixture(1320, 480, 0b1000000, 1);
    let sim_id = *sim.world().get::<SimId>(actor).expect("an id");
    sim.world_mut().resource_mut::<SimClock>().tick = sunday + 1260;
    until(&mut sim, "the night shift registers", 120, |sim| {
        scheduled(sim, actor).is_some()
    });
    let shift = scheduled(&sim, actor).expect("registered");
    assert_eq!(
        (shift.start_tick, shift.end_tick),
        (sunday + 1320, sunday + 1800)
    );
    until(&mut sim, "the week ends", 200, |sim| {
        sim.world().resource::<SimClock>().tick > 7 * 1440
    });
    let record = |sim: &Sim| {
        sim.world()
            .resource::<Careers>()
            .record(sim_id)
            .cloned()
            .expect("a record")
    };
    assert_eq!(record(&sim).review_due, Some(0), "the review waits");
    assert!(record(&sim).history.is_empty());
    until(&mut sim, "the night shift settles", 600, |sim| {
        !sim.world().resource::<Attendance>().outcomes.is_empty()
    });
    let outcome = sim.world().resource::<Attendance>().outcomes[0].clone();
    assert_eq!(
        crate::careers::week_of(outcome.start_tick, 1440),
        0,
        "attributed to the week it started in"
    );
    let record = record(&sim);
    assert_eq!(record.review_due, None);
    assert_eq!(
        record
            .history
            .iter()
            .map(|week| week.week)
            .collect::<Vec<_>>(),
        vec![0],
        "the ending week's review ran on the return"
    );
}

/// [WS-systems], the owner's rulings of 2026-10-23 and 2026-10-24: a shift
/// change at home takes effect from the next day, and the old schedule
/// still runs on the day of the change. Changed at 00:30, before the
/// standard shift's 01:00 start, the person still works that shift; the
/// new shift's start later that day registers nothing, and the next day
/// the new shift starts and the old one does not.
#[test]
fn a_shift_change_takes_effect_from_the_next_day() {
    let (mut sim, actor) = held_fixture(900, 300, 0b1111111, 0);
    for _ in 0..30 {
        sim.tick();
    }
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: actor.index_u32(),
            shift: 1,
        },
    );
    assert_eq!(
        sim.world()
            .resource::<Careers>()
            .last_result
            .map(|r| r.reason),
        Some(None)
    );
    until(&mut sim, "the old shift registers", 100, |sim| {
        scheduled(sim, actor).is_some()
    });
    assert_eq!(
        scheduled(&sim, actor).map(|s| (s.start_tick, s.end_tick)),
        Some((60, 540)),
        "the old schedule still runs on the day of the change"
    );
    until(&mut sim, "the end of the day of the change", 1500, |sim| {
        sim.world().resource::<SimClock>().tick >= 1439
    });
    assert_eq!(
        scheduled(&sim, actor).map(|s| s.start_tick),
        Some(60),
        "the new shift's start at 900 registers nothing that day"
    );
    until(&mut sim, "the late shift registers", 1000, |sim| {
        scheduled(sim, actor).is_some_and(|s| s.start_tick != 60)
    });
    assert_eq!(sim.world().resource::<SimClock>().tick, 1440 + 900);
    assert_eq!(
        scheduled(&sim, actor).map(|s| (s.start_tick, s.end_tick)),
        Some((1440 + 900, 1440 + 1200)),
        "the next day the new shift starts and the old one at 1500 did not"
    );
}

/// Several changes on one day keep the schedule held when the day began:
/// changed to the late shift, back to the standard one and to the late one
/// again before 01:00, the person still works the standard shift that day
/// and the late shift starts the next day.
#[test]
fn a_second_change_the_same_day_keeps_the_days_schedule() {
    let (mut sim, actor) = held_fixture(900, 300, 0b1111111, 0);
    let agent = actor.index_u32();
    sim.world_mut().resource_mut::<SimClock>().tick = 20;
    for (tick, shift) in [(20, 1), (30, 0), (40, 1)] {
        sim.world_mut().resource_mut::<SimClock>().tick = tick;
        issue(&mut sim, SimCommand::ChangeShift { agent, shift });
        assert_eq!(
            sim.world()
                .resource::<Careers>()
                .last_result
                .map(|r| r.reason),
            Some(None),
            "the change at {tick} applies"
        );
        assert_eq!(
            sim.world()
                .resource::<Careers>()
                .shift_changed
                .values()
                .map(|change| change.from)
                .collect::<Vec<_>>(),
            vec![0],
            "the day began on the standard shift"
        );
    }
    until(&mut sim, "the standard shift registers", 100, |sim| {
        scheduled(sim, actor).is_some()
    });
    assert_eq!(scheduled(&sim, actor).map(|s| s.start_tick), Some(60));
    until(
        &mut sim,
        "the late shift registers the next day",
        2500,
        |sim| scheduled(sim, actor).is_some_and(|s| s.start_tick != 60),
    );
    assert_eq!(
        scheduled(&sim, actor).map(|s| s.start_tick),
        Some(1440 + 900)
    );
}

/// The order preflight agrees with the register on the day of a change: at
/// the old shift's start it reports the old shift's hours, at the new
/// shift's start that day it reports nothing, and the next day it reports
/// the new shift at its own start.
#[test]
fn the_preflight_on_the_day_of_a_change_reports_the_old_schedule() {
    let (mut sim, actor) = held_fixture(900, 300, 0b1111111, 0);
    let agent = actor.index_u32();
    sim.world_mut().resource_mut::<SimClock>().tick = 30;
    issue(&mut sim, SimCommand::ChangeShift { agent, shift: 1 });
    assert_eq!(
        sim.world()
            .resource::<Careers>()
            .last_result
            .map(|r| r.reason),
        Some(None)
    );
    let at = |sim: &mut Sim, tick: u64| {
        sim.world_mut().resource_mut::<SimClock>().tick = tick;
        work_conflicts(sim.world(), &[agent])
            .conflicts
            .first()
            .map(|c| (c.start_tick, c.end_tick, c.total_minutes))
    };
    assert_eq!(
        at(&mut sim, 60),
        Some((60, 540, 480.0)),
        "the old shift is due"
    );
    assert_eq!(
        at(&mut sim, 900),
        None,
        "the new shift does not start today"
    );
    assert_eq!(
        at(&mut sim, 1440 + 60),
        None,
        "the old shift does not start tomorrow"
    );
    assert_eq!(
        at(&mut sim, 1440 + 900),
        Some((1440 + 900, 1440 + 1200, 300.0)),
        "the new shift is due tomorrow"
    );
}

/// The double pay the review of 2026-10-23 found: a person who worked a
/// shift today and then changed to a shift starting later the same day was
/// paid for both. With the change taking effect from the next day, the
/// day's only pay is the shift worked before the change.
#[test]
fn a_shift_worked_before_a_change_is_the_days_only_pay() {
    // Standard 01:00 to 09:00 every day; the late shift 20:00 to 22:00.
    let (mut sim, actor) = held_fixture(1200, 120, 0b1111111, 0);
    until(&mut sim, "the standard shift settles", 700, |sim| {
        !sim.world().resource::<Attendance>().outcomes.is_empty()
    });
    until(&mut sim, "the worker is home", 300, |sim| {
        sim.world().get::<AtWork>(actor).is_none() && sim.world().get::<Commuting>(actor).is_none()
    });
    let changed_at = sim.world().resource::<SimClock>().tick;
    assert!(
        changed_at < 1200,
        "the change comes before the late start, at {changed_at}"
    );
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: actor.index_u32(),
            shift: 1,
        },
    );
    assert_eq!(
        sim.world()
            .resource::<Careers>()
            .last_result
            .map(|r| r.reason),
        Some(None),
        "the change is accepted at home"
    );
    until(&mut sim, "the end of the first day", 1500, |sim| {
        sim.world().resource::<SimClock>().tick >= 1439
    });
    let outcomes = &sim.world().resource::<Attendance>().outcomes;
    assert_eq!(
        outcomes.iter().map(|o| o.start_tick).collect::<Vec<_>>(),
        vec![60],
        "one shift paid on the day of the change"
    );
}

/// [WS-systems]: a hand-built commuter with no scheduled shift, the case
/// `finish_tick` keeps for worlds that never registered one, arrives for
/// the held shift's length.
#[test]
fn a_commuter_without_a_scheduled_shift_arrives_for_the_held_length() {
    let (mut sim, actor) = held_fixture(600, 540, 0b1111111, 1);
    sim.world_mut()
        .entity_mut(actor)
        .insert(Commuting::Outbound);
    assert!(scheduled(&sim, actor).is_none());
    finish_tick(sim.world_mut());
    assert_eq!(
        sim.world()
            .get::<AtWork>(actor)
            .map(|work| work.remaining_ticks),
        Some(540)
    );
}

/// [WS-systems]: adopting an older world's unscheduled commute registers
/// a legacy shift as long as the held shift.
#[test]
fn legacy_adoption_registers_the_held_shifts_length() {
    let (mut sim, actor) = held_fixture(600, 540, 0b1111111, 1);
    sim.world_mut()
        .entity_mut(actor)
        .insert(Commuting::Outbound);
    migrate_legacy(sim.world_mut());
    let shift = scheduled(&sim, actor).expect("adoption registers the commute");
    assert!(shift.legacy);
    assert_eq!(shift.end_tick - shift.start_tick, 540);
}

/// `full_fixture`'s worker, 06:00 shifts of 480 ticks every day, on the
/// shipped night watch guard's row (pay $105) with its standard shift of
/// kind `kind` (issue 298, [WB-wages]).
fn premium_fixture(kind: u8) -> (Sim, Entity, Entity) {
    let (mut sim, actor, object) = full_fixture(60, 480, 1440);
    let mut pack = sim.world().resource::<Content>().0.clone();
    let guard = pack
        .careers
        .iter()
        .position(|job| job.id == "night_watch_guard")
        .expect("shipped");
    let row = terri_data::CompiledCareer {
        shift_start: 60,
        shift_ticks: 480,
        working_days: 0b1111111,
        standard_kind: kind,
        shifts: Vec::new(),
        ..pack.careers[guard].clone()
    };
    pack.careers[0] = row;
    let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    (sim, actor, object)
}

/// [WB-wages]: a night shift registers its pay with the 15 percent premium:
/// the night watch guard's $105 shift records 12075 cents, and the order
/// preflight quotes the same.
#[test]
fn a_night_shift_records_the_premium_in_cents() {
    let (mut sim, actor, _) = premium_fixture(terri_data::SHIFT_NIGHT);
    assert_eq!(
        sim.world().resource::<Content>().0.careers[0].pay,
        105,
        "the raised guard's pay"
    );
    sim.world_mut().resource_mut::<SimClock>().tick = 60;
    let quote = work_conflicts(sim.world(), &[actor.index_u32()]);
    assert_eq!(quote.conflicts[0].pay_cents, 12_075);
    start_tick(sim.world_mut());
    assert_eq!(scheduled(&sim, actor).map(|s| s.pay_cents), Some(12_075));
    assert_eq!(
        validate_saved(sim.world(), &to_saved(sim.world()), true),
        Ok(()),
        "a premium shift validates"
    );
}

/// [WB-wages]: day, early and late shifts record the plain pay.
#[test]
fn day_early_and_late_shifts_record_no_premium() {
    for kind in [
        terri_data::SHIFT_DAY,
        terri_data::SHIFT_EARLY,
        terri_data::SHIFT_LATE,
    ] {
        let (mut sim, actor, _) = premium_fixture(kind);
        sim.world_mut().resource_mut::<SimClock>().tick = 60;
        start_tick(sim.world_mut());
        assert_eq!(
            scheduled(&sim, actor).map(|s| s.pay_cents),
            Some(10_500),
            "kind {kind}"
        );
    }
}

/// [WB-wages]: proration by minutes worked acts on the premium pay: a night
/// shift cut short pays its share of 12075 cents, with the settlement's one
/// rounding step, and Funds rise by exactly that.
#[test]
fn a_prorated_night_shift_pays_its_share_of_the_premium() {
    let (mut sim, actor, object) = premium_fixture(terri_data::SHIFT_NIGHT);
    until(&mut sim, "the worker at work", 200, |sim| {
        sim.world().get::<AtWork>(actor).is_some()
    });
    for _ in 0..100 {
        sim.tick();
    }
    hold(&mut sim, actor, object);
    let before = sim.world().resource::<Funds>().0;
    until(&mut sim, "the shift settles", 600, |sim| {
        !sim.world().resource::<Attendance>().outcomes.is_empty()
    });
    let outcome = sim.world().resource::<Attendance>().outcomes[0].clone();
    let worked = outcome.worked_minutes as i64;
    assert!(worked > 0 && worked < 480, "cut short: {worked}");
    assert_eq!(outcome.pay_cents, 12_075 * worked / 480);
    assert_eq!(
        sim.world().resource::<Funds>().0 - before,
        outcome.pay_cents
    );
}

/// [WB-wages]: on the day of a shift change the shift worked that day is
/// the one held when the day began, and its kind decides the premium: a
/// night worker who changes to the day shift is paid that day's night shift
/// with the premium, and the first day shift without it.
#[test]
fn the_premium_follows_the_shift_worked_on_a_change_day() {
    let (mut sim, actor, _) = premium_fixture(terri_data::SHIFT_NIGHT);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.careers[0].standard_weight = 1;
    pack.careers[0].shifts = vec![terri_data::CompiledShift {
        id: "days".to_string(),
        kind: terri_data::SHIFT_DAY,
        shift_start: 900,
        shift_ticks: 300,
        working_days: 0b1111111,
        weight: 1,
    }];
    let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let sim_id = *sim.world().get::<SimId>(actor).expect("an id");
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .insert(sim_id, crate::careers::Record::new(&pack.careers[0]));
    for _ in 0..30 {
        sim.tick();
    }
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: actor.index_u32(),
            shift: 1,
        },
    );
    until(&mut sim, "the day's old shift registers", 100, |sim| {
        scheduled(sim, actor).is_some()
    });
    assert_eq!(
        scheduled(&sim, actor).map(|s| (s.start_tick, s.pay_cents)),
        Some((60, 12_075)),
        "the night schedule still runs, at the night rate"
    );
    until(&mut sim, "the day shift registers", 3_000, |sim| {
        scheduled(sim, actor).is_some_and(|s| s.start_tick != 60)
    });
    assert_eq!(
        scheduled(&sim, actor).map(|s| (s.start_tick, s.pay_cents)),
        Some((1440 + 900, 10_500)),
        "the first day shift pays the plain rate"
    );
}

/// [WB-wages]: the saved-attendance validator accepts an open shift's pay
/// up to the level's maximum with the premium when the shift is a night
/// shift, and refuses a cent more; a day shift's ceiling is the plain
/// maximum.
#[test]
fn the_open_shift_validator_accepts_the_premium_range_and_refuses_above_it() {
    // The guard's pay maximum is $128: 14720 cents with the premium, 12800
    // without.
    for (kind, ceiling) in [
        (terri_data::SHIFT_NIGHT, 14_720),
        (terri_data::SHIFT_DAY, 12_800),
    ] {
        let (mut sim, _, _) = premium_fixture(kind);
        assert_eq!(sim.world().resource::<Content>().0.careers[0].pay_max, 128);
        sim.world_mut().resource_mut::<SimClock>().tick = 60;
        start_tick(sim.world_mut());
        let mut saved = to_saved(sim.world());
        saved.shifts[0].pay_cents = ceiling;
        assert_eq!(
            validate_saved(sim.world(), &saved, true),
            Ok(()),
            "kind {kind} at its ceiling"
        );
        saved.shifts[0].pay_cents = ceiling + 1;
        assert!(
            validate_saved(sim.world(), &saved, true).is_err(),
            "kind {kind} above it"
        );
        saved.shifts[0].pay_cents = 10_499;
        assert!(
            validate_saved(sim.world(), &saved, true).is_err(),
            "below the starting pay"
        );
    }
}
