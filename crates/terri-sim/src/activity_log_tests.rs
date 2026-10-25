//! The activity log's bounds, link pass, lifecycle and its proof that it
//! never changes the simulation ([AL-tests]).
use crate::activity_log::{
    ActivityLog, LogKind, LogRecord, ACTIONS, CHORES, NONE, OUTCOME_COVERED, OUTCOME_MISSED,
    RECORD_WORDS, SOCIAL, STAGING_CAPACITY,
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

/// A Build transaction clones the log into its candidate world; the clone
/// keeps an export buffer for a full ring, so its next take allocates
/// nothing.
#[test]
fn a_cloned_log_keeps_room_for_a_full_take() {
    let mut log = ActivityLog::default();
    log.push(record(LogKind::ActionDone, 1, 0));
    log.take_export();
    let mut clone = log.clone();
    let full = STAGING_CAPACITY * RECORD_WORDS;
    assert!(
        clone.export_capacity() >= full,
        "{}",
        clone.export_capacity()
    );
    let before = clone.export_capacity();
    for tick in 0..STAGING_CAPACITY as u64 {
        clone.push(record(LogKind::ActionDone, tick, 0));
    }
    clone.take_export();
    assert_eq!(
        clone.export_capacity(),
        before,
        "a full take reuses the buffer"
    );
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
    for reason in crate::fights::Reason::all() {
        let tag = crate::fights::Reason::tag(reason);
        assert!(has(tag), "fight reason {reason:?} names {tag}");
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

/// A privacy line names the fixture by its type, and the shell words a
/// missing fixture as the bathroom. Both hold only while every object that
/// starts private use is a bathroom fixture with a type label of its own,
/// never a model name.
#[test]
fn private_use_fixtures_are_named_bathroom_types() {
    let sim = Sim::new_from_shipped_lot();
    let pack = sim.world().resource::<Content>().0;
    let private: Vec<_> = pack
        .objects
        .iter()
        .filter(|object| {
            object.interactions.iter().any(|action| {
                action
                    .tags
                    .iter()
                    .any(|tag| tag == crate::systems::interpersonal::PRIVATE_USE_TAG)
            })
        })
        .collect();
    let mut types: Vec<&str> = private.iter().map(|object| object.display_name()).collect();
    types.sort_unstable();
    types.dedup();
    assert_eq!(types, ["Bathtub", "Shower", "Toilet"]);
    for object in private {
        let metadata = object.metadata.as_ref().expect("a typed object");
        assert_eq!(object.display_name(), metadata.type_label, "{}", object.id);
        assert_ne!(object.display_name(), object.name, "{}", object.id);
        assert!(
            metadata.rooms.iter().any(|room| room == "bathroom"),
            "{}",
            object.id
        );
        assert_ne!(sim.activity_log().label(pack, object.display_name()), NONE);
        assert_eq!(
            sim.activity_log().label(pack, &object.name),
            NONE,
            "{}",
            object.id
        );
    }
}

/// One world's run of the shipped household: its hash after every tick,
/// its generator at the end and every record it staged. `churn` builds a
/// different archetype history the way
/// `hash_ignores_archetype_layout_and_entity_history` does, and every 97th
/// tick is followed by a paused-frame command drain, so the end-of-tick
/// pass also runs outside the schedule.
/// The log's scratch sizes at the end of a run, as `ActivityLog::scratch_sizes` reports them.
type ScratchSizes = (usize, usize, usize);

fn run_household(
    log: bool,
    churn: bool,
    ticks: usize,
) -> (Vec<u64>, SimRng, Vec<LogRecord>, ScratchSizes) {
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
            out.chunks_exact(RECORD_WORDS)
                .map(|words| LogRecord(words.try_into().unwrap())),
        );
        out.clear();
        hashes.push(sim.world_hash());
    }
    let scratch = sim.activity_log().scratch_sizes();
    (
        hashes,
        sim.world().resource::<SimRng>().clone(),
        staged,
        scratch,
    )
}

/// FNV-1a over the per-tick world hashes, so one number stands for a whole
/// run.
fn fold(hashes: &[u64]) -> u64 {
    hashes.iter().fold(0xcbf2_9ce4_8422_2325, |fold, hash| {
        (fold ^ hash).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// Runs the shipped household for `days` game days twice, once with the
/// log on and a different archetype history, once with it off, and requires
/// identical world hashes after every tick and the same generator at the
/// end. Returns the log-off run's hashes and the records the log-on run
/// staged. Every emitter added to the simulation must keep both runs equal.
fn assert_log_never_changes_the_world(days: usize) -> (Vec<u64>, Vec<LogRecord>) {
    let ticks = days
        * Sim::new_from_shipped_lot()
            .world()
            .resource::<Content>()
            .0
            .tuning
            .day_ticks as usize;
    let (on, on_rng, records, _) = run_household(true, true, ticks);
    let (off, off_rng, none, off_scratch) = run_household(false, false, ticks);
    // A disabled log must hold nothing in its scratch area either: no Social
    // total, no open nuisance episode, no held feeling.
    assert_eq!(
        off_scratch,
        (0, 0, 0),
        "a disabled log's scratch area stays empty"
    );
    assert!(none.is_empty(), "a disabled log stages nothing");
    if let Some(tick) = on.iter().zip(&off).position(|(a, b)| a != b) {
        panic!(
            "the world diverged at tick {tick} with {} records staged",
            records.len()
        );
    }
    assert_eq!(on_rng, off_rng);
    (off, records)
}

/// The shipped household's two-day hash fold without the log. Measured
/// on 2026-10-23 by running the loop of `run_household(false, false, 2880)`
/// (a tick, a command drain after every 97th tick, then `world_hash`)
/// through `fold`. Comparing the log on with the log off cannot see code
/// that runs in both modes; this pin can. A deliberate change to simulated
/// behavior moves it: re-measure the same way and record the cause here.
/// Main at 6d92fc561 (pull request 337) measured 0xad59_d080_6ae0_b58e.
/// Issue 296 (shifts and more career paths) moved it on purpose: the
/// search now draws a path by chance and the hires hold drawn shifts, so
/// the household's days differ; measured on its branch after merging
/// d1ba84590, with the log off and on giving the same worlds.
const TWO_DAY_FOLD_WITHOUT_THE_LOG: u64 = 0x9545_3dc6_218e_c371;

/// The same fold over twenty game days, measured the same way. Main at
/// 6d92fc561 measured 0x8381_918c_1bdb_58be; issue 296 moved it for the
/// reason above, measured on its branch in a release build. The
/// twenty-day check is a manual release test, so this pin catches a change
/// running in both modes that only shows after the second day.
const TWENTY_DAY_FOLD_WITHOUT_THE_LOG: u64 = 0x4e18_0bcf_5070_0111;

/// Two game days, which a debug build runs in about a minute. The
/// specification's twenty days are the ignored test below.
#[test]
fn activity_log_never_changes_the_world() {
    let (hashes, records) = assert_log_never_changes_the_world(2);
    assert_every_line_can_show(&records);
    assert_eq!(
        fold(&hashes),
        TWO_DAY_FOLD_WITHOUT_THE_LOG,
        "the world differs from main without the log"
    );
    let pack = terri_data::pack();
    let labels = crate::activity_log::labels(pack);
    let recipes: Vec<u32> = pack
        .chains
        .iter()
        .map(|chain| labels.index(&chain.label))
        .chain([0, 12, 18].map(|hour| {
            let day = pack.tuning.day_ticks;
            labels.index(crate::domestic::meal_label(hour * u64::from(day) / 24, day))
        }))
        .collect();
    let cause =
        |cause: crate::relationship_effects::RelationshipCause| labels.index(cause.log_label());
    let seen = |name: &str, found: bool| assert!(found, "no {name} in two days");
    // The emitters must have run for the comparison to prove anything.
    for kind in [LogKind::ActionDone, LogKind::ChatDone, LogKind::Annoyed] {
        seen(
            &format!("{kind:?}"),
            records.iter().any(|r| r.kind() == Some(kind)),
        );
    }
    let action_labelled = |labels: &[u32]| {
        records
            .iter()
            .any(|r| r.kind() == Some(LogKind::ActionDone) && labels.contains(&r.label()))
    };
    let annoyed_by = |cause: u32| {
        records
            .iter()
            .any(|r| r.kind() == Some(LogKind::Annoyed) && r.label() == cause)
    };
    use crate::relationship_effects::RelationshipCause as Cause;
    seen("recipe", action_labelled(&recipes));
    seen("nuisance episode", annoyed_by(cause(Cause::Nuisance)));
    // Fights, dirty place settings, shared meals and mess annoyances, which
    // wait out a grace period before a pile counts, do not happen in the
    // shipped household's first two days; their own tests drive them.
}

/// The full twenty game days of [AL-perf]. This is a manual check, not a CI
/// one: `.github/workflows/ci.yml` runs only the debug `cargo test
/// --workspace`, where it takes about fifteen minutes, and has no release
/// test step to add it to. Run it in a release build, where it takes about
/// a minute, before merging a change to an emitter: `cargo test --release
/// -p terri-sim activity_log_never_changes_the_world_over_twenty_days --
/// --ignored --test-threads=1`.
#[test]
#[ignore = "manual check: twenty game days; run with --release and --ignored"]
fn activity_log_never_changes_the_world_over_twenty_days() {
    let (hashes, records) = assert_log_never_changes_the_world(20);
    assert_eq!(
        fold(&hashes),
        TWENTY_DAY_FOLD_WITHOUT_THE_LOG,
        "the world differs from main without the log"
    );
    assert_every_line_can_show(&records);
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
        Appreciation,
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
            Cause::MealShared => Expect::Appreciation,
            Cause::Proximity | Cause::SharedActivity | Cause::Incompatibility | Cause::Decay => {
                Expect::Excluded
            }
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
            Expect::Appreciation => {
                let records = staged(&sim);
                assert_eq!(records.len(), 1, "{cause:?}");
                assert_eq!(records[0].kind(), Some(LogKind::Feeling));
                assert_eq!(
                    (records[0].actor(), records[0].other(), records[0].label()),
                    (1, 2, label)
                );
                assert_eq!(
                    (records[0].value(2), records[0].triggers()),
                    (-123, SOCIAL),
                    "an appreciation shows under Social even without its meal"
                );
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

/// The first object interaction in the shipped pack that trains a skill,
/// with the skill's index.
pub(crate) fn skill_interaction(
    pack: &terri_data::ContentPack,
) -> (terri_core::ObjectDefId, u32, usize) {
    for (model, object) in pack.objects.iter().enumerate() {
        for (row, action) in object.interactions.iter().enumerate() {
            if action.book_reading || action.tags.is_empty() {
                continue;
            }
            if let Some(skill) = pack
                .skills
                .iter()
                .position(|s| action.tags.contains(&s.tag))
            {
                return (terri_core::ObjectDefId(model as u32), row as u32, skill);
            }
        }
    }
    panic!("the shipped pack trains a skill through an object");
}

/// A person standing at a skill-training object with nowhere left to walk,
/// so the next tick starts the interaction, with `practice` in its skill.
/// Returns the sim, the person, their id, the object model, the row and the
/// skill index.
pub(crate) fn about_to_train(
    practice: f32,
) -> (Sim, Entity, u32, terri_core::ObjectDefId, u32, usize) {
    let mut sim = Sim::new_with_lot(8, 8);
    let pack = sim.world().resource::<Content>().0;
    let (model, row, skill) = skill_interaction(pack);
    let object = sim.spawn_object(Position { x: 2.0, y: 2.0 }, model);
    let id = sim
        .world_mut()
        .resource_mut::<terri_core::SimIdAllocator>()
        .issue();
    let mut skills = terri_core::Skills::default();
    skills.set_practice(skill as u32, practice);
    let person = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 2.0, y: 3.0 },
            terri_core::Needs::all_at(50.0),
            skills,
            terri_core::Target {
                object,
                interaction: row,
            },
            terri_core::Path {
                steps: vec![],
                cursor: 0,
            },
        ))
        .id();
    (sim, person, id.0, model, row, skill)
}

/// Every record staged since the last call, oldest first.
pub(crate) fn drain(sim: &mut Sim) -> Vec<LogRecord> {
    let mut out = Vec::new();
    sim.take_activity_log(&mut out);
    out.chunks_exact(RECORD_WORDS)
        .map(|words| LogRecord(words.try_into().unwrap()))
        .collect()
}

/// Ticks until `person` has started and finished an interaction, collecting
/// every record.
pub(crate) fn train_to_completion(sim: &mut Sim, person: Entity) -> Vec<LogRecord> {
    let mut records = Vec::new();
    let mut started = false;
    for _ in 0..2_000 {
        sim.tick();
        records.extend(drain(sim));
        let busy = sim.world().get::<Eating>(person).is_some();
        if started && !busy {
            return records;
        }
        started |= busy;
    }
    panic!("the interaction never finished");
}

/// [AL-sources] and [AL-capture] item 4: an object interaction starts a
/// fresh Social total where it begins, so company left over from an
/// interrupted activity never reaches its line, and its completion records
/// the label the action menu shows at that tick and the skill it trained
/// with the level and progress after practice.
#[test]
fn interaction_start_resets_company_and_completion_logs_label_and_skill() {
    let (mut sim, person, id, model, row, skill) = about_to_train(0.0);
    let pack = sim.world().resource::<Content>().0;
    let day = pack.tuning.day_ticks;
    sim.world_mut().resource_mut::<terri_core::SimClock>().tick = u64::from(day) * 10 / 24;
    // An interrupted shared activity: Social and a companion, never closed.
    sim.world_mut()
        .resource_mut::<ActivityLog>()
        .social(id, 5.0, Some(99));
    let records = train_to_completion(&mut sim, person);
    let actions: Vec<_> = records
        .iter()
        .filter(|r| r.kind() == Some(LogKind::ActionDone) && r.actor() == id)
        .collect();
    assert_eq!(actions.len(), 1, "{records:?}");
    let record = actions[0];
    let labels = crate::activity_log::labels(pack);
    let shown = crate::action_rows::resolve(pack, model, row)
        .unwrap()
        .label(u64::from(record.tick()), day);
    assert_eq!(record.label(), labels.index(shown));
    assert_eq!(
        (record.other(), record.value(0), record.flags()),
        (NONE, 0, 0),
        "no leftover company and a total that started with the interaction"
    );
    assert_eq!(record.triggers(), ACTIONS);
    let definition = &pack.skills[skill];
    assert_eq!(record.label2(), labels.index(&definition.label));
    let practice = sim
        .world()
        .get::<terri_core::Skills>(person)
        .unwrap()
        .practice(skill as u32);
    assert!(practice > 0.0, "the interaction trained the skill");
    let standing = crate::skills::standing(
        &crate::skills::Ladder::from_tuning(&pack.tuning),
        definition.levels,
        practice,
    );
    assert_eq!(record.value(1), i32::from(standing.level));
    assert_eq!(record.value(2), (standing.progress * 100.0).floor() as i32);
}

/// [AL-record] kind 9: crossing a level stages one Skills record, a child
/// of the action that crossed it, and practice that does not cross a level
/// stages none.
#[test]
fn skill_level_up_is_logged_once_per_level() {
    let pack = terri_data::pack();
    let (_, _, skill) = skill_interaction(pack);
    let definition = &pack.skills[skill];
    let ladder = crate::skills::Ladder::from_tuning(&pack.tuning);
    // Half an attempt short of level 1.
    let practice = ladder.cumulative(1) - definition.practice_per_attempt * 0.5;
    let (mut sim, person, id, ..) = about_to_train(practice);
    let target = *sim.world().get::<terri_core::Target>(person).unwrap();
    let mut records = train_to_completion(&mut sim, person);
    // A second attempt practices without reaching level 2.
    assert!(practice + 2.0 * definition.practice_per_attempt < ladder.cumulative(2));
    sim.world_mut().entity_mut(person).insert((
        target,
        terri_core::Path {
            steps: vec![],
            cursor: 0,
        },
    ));
    records.extend(train_to_completion(&mut sim, person));
    let levels: Vec<_> = records
        .iter()
        .filter(|r| r.kind() == Some(LogKind::SkillLevel))
        .collect();
    assert_eq!(levels.len(), 1, "{records:?}");
    let level = levels[0];
    let labels = crate::activity_log::labels(pack);
    assert_eq!(
        (level.actor(), level.label(), level.value(1)),
        (id, labels.index(&definition.label), 1)
    );
    assert_eq!(level.triggers(), crate::activity_log::SKILLS);
    let parent = records
        .iter()
        .find(|r| r.seq() == level.parent())
        .expect("the level-up has a parent");
    assert_eq!(parent.kind(), Some(LogKind::ActionDone));
    assert_eq!((parent.actor(), parent.tick()), (id, level.tick()));
    assert_eq!(parent.value(1), 1, "the action line shows the new level");
}

/// Two chores missed by one owner at the same rollover: each outcome keeps
/// the feelings staged after it rather than the newest outcome taking all
/// of them.
/// A chore feeling that no chore outcome adopts, such as the appreciation
/// of each washed batch of dishes, still shows: it joins the line of the
/// appreciated person's own action in the same tick, under Social, and with
/// no such line it is its own line under Social.
#[test]
fn chore_feelings_without_an_outcome_still_show() {
    let mut sim = Sim::new_with_lot(4, 4);
    let washing = stage(&mut sim, record(LogKind::ActionDone, 1, 5));
    let thanks = stage(&mut sim, record(LogKind::Feeling, 1, 9).with_other(5));
    let lone = stage(&mut sim, record(LogKind::Feeling, 1, 9).with_other(6));
    sim.flush_commands();
    let find = |seq: u32| staged(&sim).into_iter().find(|r| r.seq() == seq).unwrap();
    assert_eq!(find(thanks).parent(), washing);
    assert_eq!(find(thanks).triggers(), SOCIAL);
    assert_eq!(find(lone).parent(), 0);
    assert_eq!(
        find(lone).triggers(),
        SOCIAL,
        "a feeling with no line is its own line"
    );
    assert_eq!(
        find(washing).triggers(),
        0,
        "the action's own filters are its own"
    );
}

/// Every record the panel can show as a line has a filter that shows it: a
/// record without a parent and without a trigger bit would never appear.
fn assert_every_line_can_show(records: &[LogRecord]) {
    let hidden: Vec<_> = records
        .iter()
        .filter(|r| r.parent() == 0 && r.triggers() == 0)
        .collect();
    assert!(hidden.is_empty(), "lines no filter shows: {hidden:?}");
}

#[test]
fn two_outcomes_in_one_tick_keep_their_own_feelings() {
    let mut sim = Sim::new_with_lot(4, 4);
    let missed = |sim: &mut Sim| {
        stage(
            sim,
            record(LogKind::ChoreOutcome, 1, 4).with_value(0, OUTCOME_MISSED),
        )
    };
    let first = missed(&mut sim);
    let first_feeling = stage(&mut sim, record(LogKind::Feeling, 1, 5).with_other(4));
    let second = missed(&mut sim);
    let second_feeling = stage(&mut sim, record(LogKind::Feeling, 1, 5).with_other(4));
    sim.flush_commands();
    let parent_of = |seq: u32| {
        staged(&sim)
            .iter()
            .find(|r| r.seq() == seq)
            .unwrap()
            .parent()
    };
    assert_eq!(parent_of(first_feeling), first);
    assert_eq!(parent_of(second_feeling), second);
}
