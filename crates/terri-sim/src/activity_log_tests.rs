//! The activity log's bounds, link pass, lifecycle and its proof that it
//! never changes the simulation ([AL-tests]).
use crate::activity_log::{
    ActivityLog, LogKind, LogRecord, ACTIONS, CHORES, NONE, OUTCOME_COVERED, OUTCOME_MISSED,
    SOCIAL, STAGING_CAPACITY,
};
use crate::rooms::RoomChoices;
use crate::{Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::{Agent, Eating, Position, SimRng};

fn record(kind: LogKind, tick: u64, actor: u32) -> LogRecord {
    LogRecord::new(kind, 0, tick, actor)
}

fn stage(sim: &mut Sim, record: LogRecord) -> u32 {
    sim.world_mut().resource_mut::<ActivityLog>().push(record)
}

fn staged(sim: &Sim) -> Vec<LogRecord> {
    sim.activity_log().records().copied().collect()
}

#[test]
fn staging_ring_overwrites_oldest_and_counts_drops() {
    let mut log = ActivityLog::default();
    for tick in 0..300 {
        log.push(record(LogKind::ActionDone, tick, 0));
    }
    assert_eq!(log.len(), STAGING_CAPACITY);
    assert_eq!(log.dropped(), 44);
    let seqs: Vec<u32> = log.records().map(LogRecord::seq).collect();
    assert_eq!(seqs, (45..=300).collect::<Vec<u32>>(), "oldest first");
    let ticks: Vec<u32> = log.records().map(LogRecord::tick).collect();
    assert_eq!(ticks, (44..300).collect::<Vec<u32>>());

    let mut out = Vec::new();
    assert_eq!(log.take_into(&mut out), 256);
    assert_eq!(out.len(), 256 * 12);
    assert_eq!(out[0], 45, "the first word of the oldest record is its seq");
    assert!(log.is_empty());
    assert_eq!(log.push(record(LogKind::ActionDone, 300, 0)), 301);
}

#[test]
fn a_disabled_log_stages_nothing() {
    let mut log = ActivityLog::default();
    log.set_enabled(false);
    assert_eq!(log.push(record(LogKind::Death, 1, 0)), 0);
    assert!(log.is_empty());
    assert_eq!(log.next_seq(), 1);
}

#[test]
fn link_pass_attaches_children_in_the_same_tick() {
    let mut sim = Sim::new_with_lot(4, 4);
    // Parent first.
    let action = stage(&mut sim, record(LogKind::ActionDone, 1, 7));
    let level = stage(&mut sim, record(LogKind::SkillLevel, 1, 7));
    // Children first: a chore outcome covered by person 5 for owner 6, an
    // appreciation of the performer and a neglect of the owner, then the
    // action that performed the chore.
    let feeling_for_performer = stage(&mut sim, record(LogKind::Feeling, 1, 9).with_other(5));
    let feeling_for_owner = stage(&mut sim, record(LogKind::Feeling, 1, 5).with_other(6));
    let outcome = stage(
        &mut sim,
        record(LogKind::ChoreOutcome, 1, 5)
            .with_other(6)
            .with_value(0, OUTCOME_COVERED)
            .with_triggers(CHORES),
    );
    let performing = stage(&mut sim, record(LogKind::ActionDone, 1, 5));
    let week = stage(&mut sim, record(LogKind::ChoresThisWeek, 1, 3));
    let duty = stage(&mut sim, record(LogKind::Duty, 1, 3));
    // A missed chore never belongs to an action the owner happens to finish.
    let busy = stage(&mut sim, record(LogKind::ActionDone, 1, 4));
    let missed = stage(
        &mut sim,
        record(LogKind::ChoreOutcome, 1, 4).with_value(0, OUTCOME_MISSED),
    );
    // A chat adopts a level-up of either participant.
    let chat = stage(&mut sim, record(LogKind::ChatDone, 1, 10).with_other(11));
    let listener_level = stage(&mut sim, record(LogKind::SkillLevel, 1, 11));
    let orphan = stage(&mut sim, record(LogKind::SkillLevel, 1, 8));
    sim.flush_commands();
    // The next tick's child never reaches back to an earlier parent.
    let late = stage(&mut sim, record(LogKind::SkillLevel, 2, 7));
    sim.flush_commands();

    let parent_of = |seq: u32| {
        staged(&sim)
            .into_iter()
            .find(|r| r.seq() == seq)
            .unwrap()
            .parent()
    };
    assert_eq!(parent_of(level), action);
    assert_eq!(parent_of(outcome), performing);
    assert_eq!(parent_of(feeling_for_performer), outcome);
    assert_eq!(parent_of(feeling_for_owner), outcome);
    assert_eq!(parent_of(duty), week);
    assert_eq!(parent_of(listener_level), chat);
    for parent in [action, performing, week, busy, missed, chat, orphan, late] {
        assert_eq!(parent_of(parent), 0, "seq {parent} has no parent");
    }
    let triggers = |seq: u32| {
        staged(&sim)
            .into_iter()
            .find(|r| r.seq() == seq)
            .unwrap()
            .triggers()
    };
    assert_eq!(
        triggers(feeling_for_performer),
        SOCIAL,
        "a feeling about a chore shows under Social"
    );
    assert_eq!(triggers(outcome), CHORES);
}

#[test]
fn records_carry_their_fields() {
    let mut log = ActivityLog::default();
    log.push(
        LogRecord::new(LogKind::ChatDone, ACTIONS | SOCIAL, 1_441, 2)
            .with_other(3)
            .with_label(4)
            .with_label2(5)
            .with_value(0, crate::activity_log::pack_pair(-48, 90))
            .with_value(2, -170),
    );
    let mut out = Vec::new();
    log.take_into(&mut out);
    assert_eq!(
        out,
        [
            1,
            1_441,
            2 | (ACTIONS | SOCIAL) << 8,
            2,
            3,
            4,
            5,
            0,
            crate::activity_log::pack_pair(-48, 90) as u32,
            0,
            (-170i32) as u32,
            0
        ]
    );
    assert_eq!(
        crate::activity_log::unpack_pair(crate::activity_log::pack_pair(-48, 90)),
        (-48, 90)
    );
    let empty = LogRecord::new(LogKind::Death, 0, 0, 0);
    assert_eq!(
        (empty.other(), empty.label(), empty.label2()),
        (NONE, NONE, NONE)
    );
}

#[test]
fn load_starts_an_empty_log() {
    let mut sim = Sim::new_from_shipped_lot();
    let saved = sim.save_snapshot_v16();
    for tick in 0..3 {
        stage(&mut sim, record(LogKind::Death, tick, 0));
    }
    sim.load_snapshot_v16(saved.clone()).unwrap();
    assert!(sim.activity_log().is_empty());
    assert_eq!(sim.activity_log().next_seq(), 1);
    assert!(sim.activity_log().enabled());

    // The disabled baseline is a page setting, not part of the game, so a
    // Load keeps it.
    sim.set_activity_log_enabled(false);
    sim.load_snapshot_v16(saved).unwrap();
    assert!(!sim.activity_log().enabled());
}

fn staged_sim() -> (Sim, Vec<LogRecord>) {
    let mut sim = Sim::new_from_shipped_lot();
    for tick in 0..3 {
        stage(&mut sim, record(LogKind::Death, tick, tick as u32));
    }
    sim.flush_commands();
    let records = staged(&sim);
    assert_eq!(records.len(), 3);
    (sim, records)
}

#[test]
fn build_transaction_carries_staged_records() {
    // Confirmed.
    let (mut sim, records) = staged_sim();
    sim.begin_build().unwrap();
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    sim.commit_build(review.token).unwrap();
    sim.end_build().unwrap();
    assert_eq!(staged(&sim), records, "a confirmed build keeps them once");

    // Canceled.
    let (mut sim, records) = staged_sim();
    sim.begin_build().unwrap();
    sim.cancel_build().unwrap();
    assert_eq!(staged(&sim), records, "a canceled build keeps them once");
    sim.end_build().unwrap();
    assert_eq!(staged(&sim), records);

    // Drained between the review and the confirmation, as the shell does
    // every frame: the confirmation must not hand them over again.
    let (mut sim, records) = staged_sim();
    sim.begin_build().unwrap();
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    let mut out = Vec::new();
    assert_eq!(sim.take_activity_log(&mut out), 3);
    sim.commit_build(review.token).unwrap();
    sim.end_build().unwrap();
    assert!(staged(&sim).is_empty());
    assert_eq!(sim.activity_log().next_seq(), records.len() as u32 + 1);
}

#[test]
fn label_table_covers_every_action_and_chain_label() {
    let sim = Sim::new_from_shipped_lot();
    let pack = sim.world().resource::<Content>().0;
    let labels = sim.activity_log_labels();
    let has = |text: &str| labels.iter().any(|label| label == text);
    let day = pack.tuning.day_ticks;
    for (model, object) in pack.objects.iter().enumerate() {
        let model = terri_core::ObjectDefId(model as u32);
        for row in crate::action_rows::rows(pack, model) {
            for minute in (0..day).step_by(60) {
                let label = row.label(u64::from(minute), day);
                assert!(has(label), "{} row {} names {label}", object.id, row.row);
            }
        }
    }
    for chain in &pack.chains {
        assert!(has(&chain.label), "chain {}", chain.id);
    }
    for social in &pack.social {
        assert!(has(&social.label), "social {}", social.id);
    }
    for skill in &pack.skills {
        assert!(has(&skill.label));
    }
    for career in &pack.careers {
        assert!(has(&career.label));
    }
    for kind in terri_core::chores::ChoreKind::ALL {
        assert!(has(kind.label()));
    }
    for (tag, _) in crate::social_episode::TOPIC_CODES {
        assert!(has(tag));
    }
    assert!(has("smalltalk"));
    for cause in crate::relationship_effects::RelationshipCause::ALL {
        assert!(has(cause.log_label()));
    }
    let mut unique = labels.to_vec();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), labels.len(), "each label once");
    assert_eq!(sim.activity_log().label(pack, "not a label anywhere"), NONE);
}

/// One world's run of the shipped household: its hash after every tick and
/// its generator at the end. `churn` builds a different archetype history
/// the way `hash_ignores_archetype_layout_and_entity_history` does, and
/// every 97th tick is followed by a paused-frame command drain, so the
/// end-of-tick pass also runs outside the schedule.
fn run_household(log: bool, churn: bool, ticks: usize) -> (Vec<u64>, SimRng, Vec<LogKind>) {
    let mut sim = Sim::new_from_shipped_lot();
    sim.set_activity_log_enabled(log);
    let bystander = churn.then(|| sim.world_mut().spawn(Position { x: 2.0, y: 2.0 }).id());
    if churn {
        let mut agents: Vec<Entity> = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .collect();
        agents.sort_by_key(|agent| agent.index());
        let pack = sim.world().resource::<Content>().0;
        let fridge = terri_core::ObjectDefId(
            pack.objects.iter().position(|o| o.id == "fridge").unwrap() as u32,
        );
        sim.world_mut().entity_mut(agents[0]).insert(Eating {
            object: fridge,
            interaction: 0,
            remaining_ticks: 1,
        });
        sim.world_mut().entity_mut(agents[0]).remove::<Eating>();
    }
    let mut hashes = Vec::with_capacity(ticks);
    let mut staged = Vec::new();
    let mut out = Vec::new();
    for tick in 0..ticks {
        sim.tick();
        if tick == 0 {
            if let Some(bystander) = bystander {
                assert!(sim.world_mut().despawn(bystander));
            }
        }
        if tick % 97 == 96 {
            sim.flush_commands();
        }
        sim.take_activity_log(&mut out);
        staged.extend(
            out.chunks_exact(12)
                .filter_map(|words| LogKind::from_code(words[2] as u8)),
        );
        out.clear();
        hashes.push(sim.world_hash());
    }
    (hashes, sim.world().resource::<SimRng>().clone(), staged)
}

/// Runs the shipped household for `days` game days twice, once with the
/// log on and a different archetype history, once with it off, and requires
/// identical world hashes after every tick and the same generator at the
/// end. Every emitter added to the simulation must keep both runs equal.
fn assert_log_never_changes_the_world(days: usize) -> Vec<LogKind> {
    let ticks = days
        * Sim::new_from_shipped_lot()
            .world()
            .resource::<Content>()
            .0
            .tuning
            .day_ticks as usize;
    let (on, on_rng, records) = run_household(true, true, ticks);
    let (off, off_rng, none) = run_household(false, false, ticks);
    assert!(none.is_empty(), "a disabled log stages nothing");
    if let Some(tick) = on.iter().zip(&off).position(|(a, b)| a != b) {
        panic!(
            "the world diverged at tick {tick} with {} records staged",
            records.len()
        );
    }
    assert_eq!(on_rng, off_rng);
    records
}

/// Two game days, which a debug build runs in under a minute. The
/// specification's twenty days are the ignored test below.
#[test]
fn activity_log_never_changes_the_world() {
    let records = assert_log_never_changes_the_world(2);
    // The emitters must have run for the comparison to prove anything.
    for kind in [LogKind::ActionDone, LogKind::ChatDone, LogKind::Annoyed] {
        assert!(records.contains(&kind), "no {kind:?} in two days");
    }
}

/// The full twenty game days of [AL-perf]. A debug build takes about
/// fifteen minutes, so it is opt-in:
/// `cargo test -p terri-sim activity_log -- --ignored --test-threads=1`.
#[test]
#[ignore = "twenty game days take about fifteen minutes in a debug build"]
fn activity_log_never_changes_the_world_over_twenty_days() {
    assert_log_never_changes_the_world(20);
}

/// Every cause reaches the activity log as the specification classifies it
/// ([AL-capture] item 1). The match below has no wildcard arm either, so a
/// new cause fails to compile here as it does in `relationship_effects`.
#[test]
fn every_relationship_cause_is_logged_or_excluded() {
    use crate::relationship_effects::{RelationshipCause as Cause, RelationshipEffect};
    enum Expect {
        Annoyed,
        Episode,
        Held,
        Feeling,
        Excluded,
    }
    for cause in Cause::ALL {
        let expect = match cause {
            Cause::HouseholdMess
            | Cause::DirtySetting
            | Cause::PrivacyEntry
            | Cause::PrivacyStart
            | Cause::LowNeedInterruption
            | Cause::CriticalNeedInterruption => Expect::Annoyed,
            Cause::Nuisance => Expect::Episode,
            Cause::Conversation | Cause::Fight => Expect::Held,
            Cause::ChoreFulfilled | Cause::ChoreNeglected => Expect::Feeling,
            Cause::Proximity
            | Cause::SharedActivity
            | Cause::Incompatibility
            | Cause::Decay
            | Cause::MealShared => Expect::Excluded,
        };
        let mut sim = Sim::new_with_lot(4, 4);
        let pack = sim.world().resource::<Content>().0;
        sim.world_mut().resource_mut::<terri_core::SimClock>().tick = 100;
        let effect = RelationshipEffect {
            tick: 100,
            event: 0,
            cause,
            responsible: terri_core::SimId(2),
            affected: terri_core::SimId(1),
            requested: -0.01,
            actual: -0.0123,
            emergency: false,
            directed: false,
        };
        crate::relationship_effects::record_about(sim.world_mut(), effect, Some("Fridge"));
        assert_eq!(
            sim.relationship_effects().last().map(|e| e.cause),
            Some(cause),
            "{cause:?} is still a diagnostic"
        );
        let label = sim.activity_log().label(pack, cause.log_label());
        let held = sim.activity_log().held_feelings().to_vec();
        match expect {
            Expect::Annoyed => {
                let records = staged(&sim);
                assert_eq!(records.len(), 1, "{cause:?}");
                let r = records[0];
                assert_eq!(r.kind(), Some(LogKind::Annoyed));
                assert_eq!((r.actor(), r.other(), r.label()), (1, 2, label));
                assert_eq!(r.label2(), sim.activity_log().label(pack, "Fridge"));
                assert_eq!((r.value(2), r.triggers(), r.tick()), (-123, SOCIAL, 100));
            }
            Expect::Episode => {
                assert!(staged(&sim).is_empty(), "an open episode stages nothing");
                sim.world_mut().resource_mut::<terri_core::SimClock>().tick = 101;
                sim.flush_commands();
                let records = staged(&sim);
                assert_eq!(records.len(), 1, "a whole tick without it closes it");
                assert_eq!(records[0].kind(), Some(LogKind::Annoyed));
                assert_eq!(
                    (records[0].label(), records[0].value(2), records[0].tick()),
                    (label, -123, 100)
                );
            }
            Expect::Held => {
                assert!(staged(&sim).is_empty(), "{cause:?}");
                assert_eq!(held.len(), 1);
                assert_eq!(
                    (held[0].affected, held[0].responsible, held[0].change),
                    (1, 2, -0.0123)
                );
                sim.flush_commands();
                assert!(sim.activity_log().held_feelings().is_empty());
            }
            Expect::Feeling => {
                let records = staged(&sim);
                assert_eq!(records.len(), 1, "{cause:?}");
                assert_eq!(records[0].kind(), Some(LogKind::Feeling));
                assert_eq!(
                    (records[0].actor(), records[0].other(), records[0].label()),
                    (1, 2, label)
                );
                assert_eq!((records[0].value(2), records[0].triggers()), (-123, 0));
            }
            Expect::Excluded => {
                assert!(staged(&sim).is_empty(), "{cause:?}");
                assert!(held.is_empty());
                sim.flush_commands();
                assert!(staged(&sim).is_empty());
            }
        }
    }
}

#[test]
fn a_nuisance_episode_closes_at_the_end_of_the_day() {
    use crate::relationship_effects::{RelationshipCause, RelationshipEffect};
    let mut sim = Sim::new_with_lot(4, 4);
    let day = sim.world().resource::<Content>().0.tuning.day_ticks;
    let last = u64::from(day) - 1;
    for tick in [last - 1, last] {
        sim.world_mut().resource_mut::<terri_core::SimClock>().tick = tick;
        crate::relationship_effects::record(
            sim.world_mut(),
            RelationshipEffect {
                tick,
                event: 0,
                cause: RelationshipCause::Nuisance,
                responsible: terri_core::SimId(2),
                affected: terri_core::SimId(1),
                requested: -0.0005,
                actual: -0.0005,
                emergency: false,
                directed: false,
            },
        );
        sim.flush_commands();
    }
    let records = staged(&sim);
    assert_eq!(
        records.len(),
        1,
        "the last pass of the day closes the episode"
    );
    assert_eq!((records[0].tick(), records[0].value(2)), (last as u32, -10));
}
