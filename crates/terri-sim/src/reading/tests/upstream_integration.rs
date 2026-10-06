use super::*;

fn edit(sim: &mut Sim, person: Entity, traits: Vec<u32>) {
    let id = sim.world().get::<SimId>(person).unwrap().0;
    issue(
        sim,
        SimCommand::EditHousemate {
            sim: id,
            name: "Edited reader".into(),
            personality: None,
            traits,
            ties: vec![],
        },
    );
    sim.flush_commands();
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_edit_result
        .unwrap()
        .reason
        .is_none());
}

#[test]
fn upstream_edit_active_reader_preserves_accrued_reward_and_book_identity() {
    let (mut sim, person, shelf, seat, title) = fixture("armchair");
    let pack = sim.world().resource::<Content>().0;
    let bookworm = pack.traits.iter().position(|t| t.id == "bookworm").unwrap() as u32;
    sim.world_mut()
        .entity_mut(person)
        .insert(Traits::from_entries(vec![(bookworm, 0.0)]));
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, person, seat, &title, false);
    until(&mut sim, person, ReadingStage::Read);
    for _ in 0..20 {
        sim.tick();
    }
    let before = sim.save_snapshot_v6();
    let satisfaction = sim.world().get::<Satisfaction>(person).unwrap().value();
    assert!(before.reading[0].earned_satisfaction > 0.0);
    edit(&mut sim, person, vec![]);
    let after = sim.save_snapshot_v6();
    assert_eq!(after.books, before.books);
    assert_eq!(after.seats, before.seats);
    assert_eq!(
        after.reading[0].earned_satisfaction,
        before.reading[0].earned_satisfaction
    );
    assert_eq!(
        sim.world().get::<Satisfaction>(person).unwrap().value(),
        satisfaction
    );
    sim.load_snapshot_v6(after.clone())
        .expect("trait edits cannot invalidate accrued reading rewards");
    assert_eq!(sim.save_snapshot_v6(), after);
}

#[test]
fn upstream_reading_practice_is_once_per_completed_session_not_return_or_reload() {
    let (mut sim, person, shelf, seat, title) = fixture("armchair");
    let pack = sim.world().resource::<Content>().0;
    let skill = pack.skills.iter().position(|s| s.tag == "reading").unwrap() as u32;
    let per_attempt = pack.skills[skill as usize].practice_per_attempt;
    let practice = |sim: &Sim| {
        sim.world()
            .get::<Skills>(person)
            .map_or(0.0, |s| s.practice(skill))
    };
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, person, seat, &title, false);
    until(&mut sim, person, ReadingStage::Read);
    for _ in 0..10 {
        sim.tick();
    }
    assert_eq!(practice(&sim), 0.0);
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved).unwrap();
    let order = sim
        .world()
        .get::<ReadingJourney>(person)
        .unwrap()
        .order
        .unwrap();
    finish_order(&mut sim, person, order);
    assert_eq!(practice(&sim), per_attempt);
    let model = sim.world().get::<SmartObject>(seat).unwrap().0;
    let row = pack
        .object(model)
        .interactions
        .iter()
        .position(|a| a.book_reading)
        .unwrap() as u32;
    assert!(
        sim.world()
            .get::<Habituation>(person)
            .unwrap()
            .get(model, row)
            > 0.2,
        "a completed reading session records repetition once"
    );
    let saved = sim.save_snapshot_v6();
    sim.load_snapshot_v6(saved).unwrap();
    assert_eq!(practice(&sim), per_attempt);
    read(&mut sim, person, seat, &title, false);
    until(&mut sim, person, ReadingStage::Read);
    sim.tick();
    request_return(sim.world_mut(), person);
    for _ in 0..100 {
        if stage(&sim, person).is_none() {
            break;
        }
        sim.tick();
    }
    assert_eq!(
        practice(&sim),
        per_attempt,
        "an interrupted session earns no practice"
    );
}

#[test]
fn upstream_reading_contexts_bound_work_and_survive_paused_edits() {
    let (mut sim, person, shelf, seat, title) = fixture("armchair");
    let pack = sim.world().resource::<Content>().0;
    let bookworm = pack.traits.iter().position(|t| t.id == "bookworm").unwrap() as u32;
    edit(&mut sim, person, vec![bookworm]);
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, person, seat, &title, false);
    until(&mut sim, person, ReadingStage::Read);
    for _ in 0..10 {
        sim.tick();
    }
    assert_eq!(sim.save_snapshot_v6().reading[0].reward_contexts.len(), 1);
    for _ in 0..20 {
        edit(&mut sim, person, vec![]);
        edit(&mut sim, person, vec![bookworm]);
    }
    assert_eq!(
        sim.save_snapshot_v6().reading[0].reward_contexts.len(),
        1,
        "paused edits record no work"
    );
    edit(&mut sim, person, vec![]);
    for _ in 0..3 {
        sim.tick();
    }
    let saved = sim.save_snapshot_v6();
    assert_eq!(saved.reading[0].reward_contexts.len(), 2);
    sim.load_snapshot_v6(saved.clone()).unwrap();
    let hash = sim.world_hash();
    for fault in 0..8 {
        let mut bad = saved.clone();
        match fault {
            0 => bad.reading[0].reward_contexts[0].end_tick += 1,
            1 => bad.reading[0].reward_contexts[1].start_work += 1.0,
            2 => bad.reading[0].reward_contexts[0].traits = vec!["unknown-trait".into()],
            3 => bad.reading[0].reward_contexts[0].disposition = f32::INFINITY,
            4 => bad.reading[0].reward_contexts[0].traits = vec!["slow_reader".into()],
            5 => bad.reading[0].earned_satisfaction *= 1.05,
            6 => {
                let duplicate = bad.reading[0].reward_contexts[0].clone();
                bad.reading[0].reward_contexts.push(duplicate);
            }
            7 => bad.reading[0].reward_contexts[0].end_work = f32::NAN,
            _ => unreachable!(),
        }
        assert!(sim.load_snapshot_v6(bad).is_err(), "context fault {fault}");
        assert_eq!(sim.save_snapshot_v6(), saved);
        assert_eq!(sim.world_hash(), hash);
    }
}

#[test]
fn upstream_reading_rolls_mastery_once_and_keeps_outcome_after_trait_removal() {
    for mastered in [false, true] {
        let (mut sim, person, shelf, seat, title) = fixture("armchair");
        let pack = sim.world().resource::<Content>().0;
        let slow = pack
            .traits
            .iter()
            .position(|t| t.id == "slow_reader")
            .unwrap() as u32;
        let skill = pack.skills.iter().position(|s| s.tag == "reading").unwrap() as u32;
        let mut skills = Skills::default();
        if mastered {
            skills.set_practice(
                skill,
                crate::skills::Ladder::from_tuning(&pack.tuning)
                    .max_practice(pack.skills[skill as usize].levels),
            );
        }
        // Deliberately disagree with mastery: the trait state is no longer the skill.
        sim.world_mut().entity_mut(person).insert((
            Traits::from_entries(vec![(slow, if mastered { 0.0 } else { 1.0 })]),
            skills,
        ));
        purchase(&mut sim, Some(shelf), &title);
        read(&mut sim, person, seat, &title, false);
        until(&mut sim, person, ReadingStage::Travel);
        assert_eq!(sim.save_snapshot_v6().reading[0].outcome, None);
        let mut expected_rng = sim.world().resource::<SimRng>().clone();
        expected_rng.next_f32();
        until(&mut sim, person, ReadingStage::Read);
        assert_eq!(
            *sim.world().resource::<SimRng>(),
            expected_rng,
            "one capability outcome draw on arrival"
        );
        let outcome = sim.save_snapshot_v6().reading[0].outcome;
        assert_eq!(matches!(outcome, Some(ReadingOutcome::Success)), mastered);
        for _ in 0..10 {
            sim.tick();
        }
        assert_eq!(
            *sim.world().resource::<SimRng>(),
            expected_rng,
            "reading work does not sample the outcome again"
        );
        edit(&mut sim, person, vec![]);
        assert_eq!(sim.save_snapshot_v6().reading[0].outcome, outcome);
        let saved = sim.save_snapshot_v6();
        let rng = saved.legacy.world.rng.clone();
        sim.load_snapshot_v6(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v6(), saved);
        assert_eq!(sim.save_snapshot_v6().legacy.world.rng, rng);
        let mut missing = saved.clone();
        missing.reading[0].outcome = None;
        assert!(sim.load_snapshot_v6(missing).is_err());
        let mut malformed = saved.clone();
        malformed.reading[0].outcome = Some(ReadingOutcome::Fumbled(f32::NAN));
        assert!(sim.load_snapshot_v6(malformed).is_err());
        let order = sim
            .world()
            .get::<ReadingJourney>(person)
            .unwrap()
            .order
            .unwrap();
        finish_order(&mut sim, person, order);
        if !mastered {
            assert_eq!(
                sim.world().get::<Satisfaction>(person).unwrap().value(),
                0.0,
                "a fumbled session pays no satisfaction"
            );
            assert_eq!(
                sim.world().get::<Skills>(person).unwrap().practice(skill),
                pack.skills[skill as usize].practice_per_attempt
            );
        }
    }
}

#[test]
fn upstream_reading_repetition_changes_appeal_and_mood_but_not_delivery() {
    let mut deliveries = Vec::new();
    let mut scores = Vec::new();
    for repeated in [false, true] {
        let (mut sim, person, shelf, seat, title) = fixture("armchair");
        let pack = sim.world().resource::<Content>().0;
        let model = sim.world().get::<SmartObject>(seat).unwrap().0;
        let row = pack
            .object(model)
            .interactions
            .iter()
            .position(|a| a.book_reading)
            .unwrap() as u32;
        if repeated {
            let mut history = Habituation::default();
            history.bump(
                model,
                row,
                pack.tuning.habituation_max,
                pack.tuning.habituation_max,
            );
            sim.world_mut().entity_mut(person).insert(history);
        }
        purchase(&mut sim, Some(shelf), &title);
        let options = plans(
            sim.world_mut(),
            person,
            Target {
                object: seat,
                interaction: row,
            },
            Some(&title),
        );
        scores.push(
            options
                .iter()
                .map(|p| p.score)
                .fold(f32::NEG_INFINITY, f32::max),
        );
        read(&mut sim, person, seat, &title, false);
        until(&mut sim, person, ReadingStage::Read);
        for _ in 0..5 {
            sim.tick();
        }
        let needs = sim.world().get::<Needs>(person).unwrap();
        deliveries.push((
            needs.get(NeedId::Fun),
            needs.get(NeedId::Comfort),
            sim.save_snapshot_v6().reading[0].earned_satisfaction,
        ));
        if repeated {
            let saved = sim.save_snapshot_v6();
            sim.load_snapshot_v6(saved.clone()).unwrap();
            assert_eq!(sim.save_snapshot_v6(), saved);
            let labels: Vec<_> = sim
                .mood_of(person.index_u32())
                .unwrap()
                .moodlets
                .into_iter()
                .map(|m| m.label)
                .collect();
            assert!(labels.iter().any(|label| label.starts_with("Overdoing ")));
            assert!(!labels.iter().any(|label| label == "Feeling sick"));
            let mut bad = saved.clone();
            bad.legacy
                .world
                .entities
                .iter_mut()
                .find(|e| e.index == person.index_u32())
                .unwrap()
                .habituation
                .as_mut()
                .unwrap()[0]
                .value = pack.tuning.habituation_max + 0.01;
            assert!(sim.load_snapshot_v6(bad).is_err());
            assert_eq!(sim.save_snapshot_v6(), saved);
        }
    }
    assert!(scores[1] < scores[0]);
    assert_eq!(
        deliveries[0], deliveries[1],
        "generic repetition is not a second book-delivery penalty"
    );
}

#[test]
fn upstream_reading_hash_observes_outcome_and_every_reward_context_field() {
    let (mut sim, person, shelf, seat, title) = fixture("armchair");
    purchase(&mut sim, Some(shelf), &title);
    read(&mut sim, person, seat, &title, false);
    until(&mut sim, person, ReadingStage::Read);
    for _ in 0..5 {
        sim.tick();
    }
    let original = sim.world().get::<ReadingJourney>(person).unwrap().clone();
    let hash = sim.world_hash();
    for field in 0..9 {
        let mut changed = original.clone();
        let context = &mut changed.reward_contexts[0];
        match field {
            0 => changed.outcome = Some(ReadingOutcome::Fumbled(0.5)),
            1 => context.start_tick += 1,
            2 => context.end_tick += 1,
            3 => context.start_work = context.start_work.next_up(),
            4 => context.end_work = context.end_work.next_up(),
            5 => context.disposition = context.disposition.next_up(),
            6 => context.traits.push("bookworm".into()),
            7 => changed.reward_contexts.clear(),
            8 => changed.outcome = None,
            _ => unreachable!(),
        }
        sim.world_mut().entity_mut(person).insert(changed);
        assert_ne!(
            sim.world_hash(),
            hash,
            "saved reading field {field} participates in deterministic hashing"
        );
        sim.world_mut().entity_mut(person).insert(original.clone());
        assert_eq!(sim.world_hash(), hash);
    }
}

#[test]
fn upstream_capacity_facts_follow_actual_media_admission_and_book_ownership() {
    for model in ["television", "radio"] {
        let mut sim = Sim::new_from_shipped_lot();
        let pack = sim.world().resource::<Content>().0;
        let definition = pack.find(model).unwrap();
        let action = &pack.object(definition).interactions[0];
        assert_eq!(
            action.slots, 2,
            "the old slot count is deliberately not the admitted count"
        );
        assert_eq!(sim.model_action_capacity(model, &action.id), Some(1));
        let saved = sim.save_snapshot_v6();
        let object = saved
            .legacy
            .world
            .entities
            .iter()
            .find(|e| e.smart_object.as_deref() == Some(model))
            .unwrap()
            .index;
        let people: Vec<_> = saved
            .legacy
            .world
            .entities
            .iter()
            .filter(|e| matches!(e.sim_name.as_deref(), Some("Bill" | "Casey")))
            .map(|e| e.index)
            .collect();
        for person in &people {
            issue(
                &mut sim,
                SimCommand::UseObject {
                    agent: *person,
                    object,
                    interaction: 0,
                },
            );
        }
        sim.flush_commands();
        sim.tick();
        let saved = sim.save_snapshot_v6();
        assert_eq!(
            saved
                .legacy
                .world
                .entities
                .iter()
                .filter(|e| e.target.is_some_and(|t| t.object == object))
                .count(),
            1
        );
        assert!(saved
            .legacy
            .world
            .entities
            .iter()
            .any(|e| people.contains(&e.index)
                && e.blocked
                && e.intents.iter().flatten().any(|i| i.object == object)));
    }
    let sim = Sim::new_from_shipped_lot();
    assert_eq!(sim.model_action_capacity("bookshelf", "read"), None);
    assert_eq!(sim.model_action_capacity("long_sofa", "read"), Some(3));
    assert_eq!(
        sim.model_action_capacity("long_sofa", "stretch_out"),
        Some(1)
    );
    assert_eq!(
        sim.model_action_capacity("double_bed", "sleep_properly"),
        Some(2)
    );
}
