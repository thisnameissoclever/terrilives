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
        pack.portals.clear();
        pack.lot.front_door = Some((5, 4));
        (5, 4)
    } else {
        crate::portals::street_exit_at(&pack, (0, 0), 20).expect("fixture has a street exit")
    };
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    if indoor {
        crate::test_content::enclose(&mut sim);
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

fn assert_post_energy_shift_base(half: bool) {
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
    let energy_before = pack.tuning.mood_low_need_level + job.energy_cost * ratio / 2.0;
    sim.world_mut()
        .get_mut::<Needs>(actor)
        .unwrap()
        .set(NeedId::Energy, energy_before);
    let before_mood = sim.mood_of(actor.index_u32()).unwrap().overall_score;
    let expected_mood = before_mood - pack.tuning.mood_low_need_penalty;
    assert!(
        before_mood > -50.0 && expected_mood > -50.0,
        "the comparison must not saturate the career mood term"
    );
    let fit = crate::careers::fit(sim.world(), pack, job, actor);
    let mastery = crate::careers::mastery(sim.world(), pack, job, actor);
    let before_base = crate::careers::shift_score(fit, mastery, before_mood / 50.0);
    let expected_base = crate::careers::shift_score(fit, mastery, expected_mood / 50.0);
    assert!(
        (before_base - expected_base - 2.4).abs() < 0.0001,
        "the energy boundary must change the established base score"
    );
    sim.tick();
    let outcome = &sim.world().resource::<Attendance>().outcomes[0];
    assert_eq!(outcome.worked_minutes, if half { 90.0 } else { 180.0 });
    assert_eq!(
        outcome.deduction, 0.0,
        "both cases remain inside the missed-work grace period"
    );
    assert!(
        (outcome.base_score - expected_base).abs() < 0.0001,
        "shift base reads mood after its prorated energy bill"
    );
    assert!((outcome.score - expected_base).abs() < 0.0001);
    assert!(
        (sim.world().get::<Needs>(actor).unwrap().get(NeedId::Energy)
            - (energy_before - job.energy_cost * ratio))
            .abs()
            < 0.0001
    );
}

#[test]
fn attendance_full_shift_base_uses_post_energy_mood() {
    assert_post_energy_shift_base(false);
}

#[test]
fn attendance_half_shift_base_uses_post_prorated_energy_mood() {
    assert_post_energy_shift_base(true);
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
    assert!(
        100.0 - pack.careers[0].energy_cost >= pack.tuning.mood_needs_met_level,
        "energy must not cross a mood threshold in the affinity case"
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
    let modern = source.save_snapshot_v17();
    assert!(modern.attendance.shifts.is_empty());
    assert!(modern.attendance.outcomes.is_empty());
    let source_hash = source.world_hash();
    let content = source.world().resource::<Content>().0;
    let mut current = Sim::new_with_lot_and_content(20, 20, Content(content));
    current
        .load_snapshot_v17(modern.clone())
        .expect("modern explicit empty attendance loads");
    assert_eq!(
        current.save_snapshot_v17(),
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
        validate_saved(sim.world(), &to_saved(sim.world())),
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
    assert_eq!(validate_saved(sim.world(), &to_saved(sim.world())), Ok(()));

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
            validate_saved(sim.world(), &saved).is_ok(),
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

/// [WS-systems], the owner's ruling of 2026-10-23: a shift change at home
/// takes effect from the next day. The new shift's start later the same
/// day registers nothing, the old shift's next start registers nothing,
/// and the new shift starts on the next day it works.
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
    until(&mut sim, "the end of the day of the change", 1500, |sim| {
        sim.world().resource::<SimClock>().tick >= 1439
    });
    assert!(
        scheduled(&sim, actor).is_none(),
        "neither the new shift at 900 nor the old one at 60 starts on the day of the change"
    );
    until(&mut sim, "the late shift registers", 1000, |sim| {
        scheduled(sim, actor).is_some()
    });
    assert_eq!(sim.world().resource::<SimClock>().tick, 1440 + 900);
    assert_eq!(
        scheduled(&sim, actor).map(|s| (s.start_tick, s.end_tick)),
        Some((1440 + 900, 1440 + 1200))
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
