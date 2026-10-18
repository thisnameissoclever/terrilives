use super::*;
use crate::Sim;
use terri_core::{Relationships, SimClock, SimId, SmartObject};

fn fixture() -> (Sim, SavedChores, ChoreKey) {
    let mut sim = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    ensure(sim.world_mut());
    let counter = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "counter")
        .unwrap()
        .0;
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    state.board_enabled = true;
    let key = ChoreKey {
        kind: ChoreKind::CounterSurfaces,
        target: crate::room_regions::RoomRegions::from_world(sim.world())
            .at((1, 0))
            .unwrap(),
    };
    add(&mut state.surfaces, counter.index_u32(), 1000);
    (sim, state, key)
}

#[test]
fn active_dish_duty_crossing_midnight_settles_only_at_real_completion() {
    let (mut sim, mut state, _) = fixture();
    board::reconcile(sim.world(), &mut state);
    let key = ChoreKey {
        kind: ChoreKind::Dishes,
        target: 0,
    };
    let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    episode.needed = true;
    episode.decision = Some(true);
    episode.outcome = DutyOutcome::WillDo;
    let owner = episode.owner;
    let episode_id = episode.id;
    let person = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .find(|(_, id)| id.0 == owner)
        .unwrap()
        .0;
    state.dish_started.push((person.index_u32(), 0));
    sim.world_mut()
        .init_resource::<terri_core::save::SavedDomestic>();
    sim.world_mut()
        .resource_mut::<terri_core::save::SavedDomestic>()
        .cleanup
        .push(terri_core::save::SavedCleanup {
            person: person.index_u32(),
            dishes: vec![],
            collected: vec![],
            directed: false,
        });
    let history = state
        .profiles
        .iter()
        .find(|p| p.sim_id == owner)
        .unwrap()
        .commitment;
    sim.world_mut().resource_mut::<SimClock>().tick =
        u64::from(sim.world().resource::<crate::Content>().0.tuning.day_ticks);
    board::tick(sim.world_mut(), &mut state);
    assert!(
        !state
            .episodes
            .iter()
            .find(|e| e.id == episode_id)
            .unwrap()
            .settled
    );
    assert_eq!(
        state
            .profiles
            .iter()
            .find(|p| p.sim_id == owner)
            .unwrap()
            .commitment,
        history
    );
    board::credit(sim.world_mut(), &mut state, person.index_u32(), key, 0, 1);
    assert_eq!(
        state
            .episodes
            .iter()
            .find(|e| e.id == episode_id)
            .unwrap()
            .outcome,
        DutyOutcome::Done
    );
    let effects = sim
        .world()
        .resource::<crate::relationship_effects::RelationshipDiagnostics>()
        .effects
        .len();
    board::credit(sim.world_mut(), &mut state, person.index_u32(), key, 0, 1);
    assert_eq!(
        sim.world()
            .resource::<crate::relationship_effects::RelationshipDiagnostics>()
            .effects
            .len(),
        effects
    );
}

#[test]
fn missed_episode_cannot_be_rewarded_a_second_time() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let e = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    e.outcome = DutyOutcome::Missed;
    e.settled = true;
    e.needed = true;
    let owner = e.owner;
    let id = e.id;
    let person = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .find(|(_, p)| p.0 == owner)
        .unwrap()
        .0;
    let before = state.clone();
    board::credit(sim.world_mut(), &mut state, person.index_u32(), key, 0, 1);
    assert_eq!(state, before);
    assert_eq!(
        state.episodes.iter().find(|e| e.id == id).unwrap().outcome,
        DutyOutcome::Missed
    );
}

#[test]
fn daily_choices_are_saved_once_and_do_not_reroll_after_personality_edits_or_load() {
    let (mut sim, mut state, key) = fixture();
    board::tick(sim.world_mut(), &mut state);
    let episode = state
        .episodes
        .iter()
        .find(|e| e.key == key)
        .unwrap()
        .clone();
    assert!(episode.decision.is_some());
    let rng = state.rng.clone();
    for p in &mut state.profiles {
        p.responsibility = 100;
        p.preferences = [100; 4];
    }
    for _ in 0..20 {
        board::tick(sim.world_mut(), &mut state);
    }
    assert_eq!(
        state
            .episodes
            .iter()
            .find(|e| e.id == episode.id)
            .unwrap()
            .decision,
        episode.decision
    );
    assert_eq!(state.rng, rng);
    sim.world_mut().insert_resource(state);
    let before = sim.world_hash();
    let mut loaded = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), before);
}

#[test]
fn neglected_duties_reduce_other_housemates_affinity_once_without_self_resentment() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let e = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    e.needed = true;
    e.decision = Some(false);
    e.outcome = DutyOutcome::Skipped;
    let owner = e.owner;
    let episode = e.id;
    let observer = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .find(|(_, id)| id.0 != owner)
        .unwrap()
        .0;
    let before = sim
        .world()
        .get::<Relationships>(observer)
        .map_or(0.0, |r| r.feeling(SimId(owner)));
    sim.world_mut().resource_mut::<SimClock>().tick =
        u64::from(sim.world().resource::<crate::Content>().0.tuning.day_ticks);
    board::tick(sim.world_mut(), &mut state);
    let after = sim
        .world()
        .get::<Relationships>(observer)
        .unwrap()
        .feeling(SimId(owner));
    assert!(after < before);
    assert_eq!(
        state
            .episodes
            .iter()
            .find(|e| e.id == episode)
            .unwrap()
            .outcome,
        DutyOutcome::Missed
    );
    board::tick(sim.world_mut(), &mut state);
    assert_eq!(
        sim.world()
            .get::<Relationships>(observer)
            .unwrap()
            .feeling(SimId(owner)),
        after
    );
    let owner_entity = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .find(|(_, id)| id.0 == owner)
        .unwrap()
        .0;
    assert_eq!(
        sim.world()
            .get::<Relationships>(owner_entity)
            .map_or(0.0, |r| r.feeling(SimId(owner))),
        0.0
    );
}

#[test]
fn helper_credit_identifies_the_actual_performer_and_cannot_reward_the_same_completion_twice() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let owner = state.episodes.iter().find(|e| e.key == key).unwrap().owner;
    let helper = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .find(|(_, id)| id.0 != owner)
        .unwrap()
        .0;
    let helper_id = sim.world().get::<SimId>(helper).unwrap().0;
    state.surfaces.retain(|r| r.0 != key.target);
    board::credit(
        sim.world_mut(),
        &mut state,
        helper.index_u32(),
        key,
        0,
        1000,
    );
    let e = state.episodes.iter().find(|e| e.key == key).unwrap();
    assert_eq!(e.outcome, DutyOutcome::Covered);
    assert_eq!(e.performer, Some(helper_id));
    let effects = sim.relationship_effects().len();
    assert!(effects > 0);
    board::credit(
        sim.world_mut(),
        &mut state,
        helper.index_u32(),
        key,
        0,
        1000,
    );
    assert_eq!(sim.relationship_effects().len(), effects);
}

#[test]
fn weekly_assignments_persist_and_new_weeks_use_the_saved_chore_stream() {
    let (mut sim, mut state, _) = fixture();
    board::reconcile(sim.world(), &mut state);
    let original = state.assignments.clone();
    let stream = state.rng.clone();
    board::reconcile(sim.world(), &mut state);
    assert_eq!(state.assignments, original);
    assert_eq!(state.rng, stream);
    sim.world_mut().resource_mut::<SimClock>().tick =
        7 * u64::from(sim.world().resource::<crate::Content>().0.tuning.day_ticks);
    board::reconcile(sim.world(), &mut state);
    assert!(state.assignments.iter().all(|a| a.week == 1));
    assert_ne!(state.rng, stream);
    sim.world_mut().insert_resource(state);
    let mut loaded = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

// ---- The activity log ([AL-sources]) -----------------------------------

use crate::activity_log::{
    LogKind, LogRecord, CHORES, NONE, OUTCOME_COVERED, OUTCOME_DONE, OUTCOME_MISSED,
    OUTCOME_SKIPPED, SOCIAL,
};
use crate::relationship_effects::RelationshipCause;

/// Runs the end-of-tick pass the board's callers rely on, then takes every
/// staged record.
fn settled_records(sim: &mut Sim) -> Vec<LogRecord> {
    crate::activity_log::finish_tick(sim.world_mut());
    crate::activity_log_tests::drain(sim)
}

fn person(sim: &mut Sim, id: u32) -> Entity {
    sim.world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .find(|(_, p)| p.0 == id)
        .unwrap()
        .0
}

fn everyone(sim: &mut Sim) -> Vec<u32> {
    let mut ids: Vec<u32> = sim
        .world_mut()
        .query_filtered::<&SimId, With<terri_core::Agent>>()
        .iter(sim.world())
        .map(|id| id.0)
        .collect();
    ids.sort_unstable();
    ids
}

fn label(sim: &Sim, text: &str) -> u32 {
    crate::activity_log::labels(sim.world().resource::<crate::Content>().0).index(text)
}

/// Ticks the whole simulation until the episode of `key` begun on day 0
/// settles, collecting every record.
fn work_until_settled(sim: &mut Sim, key: ChoreKey) -> Vec<LogRecord> {
    let mut records = Vec::new();
    for _ in 0..3_000 {
        sim.tick();
        records.extend(crate::activity_log_tests::drain(sim));
        let settled = sim
            .world()
            .resource::<SavedChores>()
            .episodes
            .iter()
            .any(|e| e.key == key && e.day == 0 && e.settled);
        if settled {
            return records;
        }
    }
    panic!("the chore never settled");
}

fn feelings_of(records: &[LogRecord], parent: u32, cause: u32) -> Vec<LogRecord> {
    records
        .iter()
        .filter(|r| {
            r.kind() == Some(LogKind::Feeling) && r.parent() == parent && r.label() == cause
        })
        .copied()
        .collect()
}

/// [AL-sources]: new weekly duties are one Chores line per owner, with the
/// owner's duties as its children, and an unchanged week stages nothing.
#[test]
fn chore_week_logs_one_header_per_owner() {
    let (mut sim, mut state, _) = fixture();
    // A new week.
    state.week = None;
    board::tick(sim.world_mut(), &mut state);
    let records = settled_records(&mut sim);
    let headers: Vec<_> = records
        .iter()
        .filter(|r| r.kind() == Some(LogKind::ChoresThisWeek))
        .collect();
    let owners: std::collections::BTreeSet<u32> =
        state.assignments.iter().map(|a| a.owner).collect();
    assert!(!owners.is_empty());
    assert_eq!(
        headers.iter().map(|r| r.actor()).collect::<Vec<_>>(),
        owners.iter().copied().collect::<Vec<_>>()
    );
    for header in &headers {
        assert_eq!(header.triggers(), CHORES);
        assert_eq!(header.value(0), state.week.unwrap() as i32);
        let duties: Vec<_> = records
            .iter()
            .filter(|r| r.kind() == Some(LogKind::Duty) && r.parent() == header.seq())
            .collect();
        let mine: Vec<_> = state
            .assignments
            .iter()
            .filter(|a| a.owner == header.actor())
            .collect();
        assert_eq!(duties.len(), mine.len());
        for (duty, assignment) in duties.iter().zip(mine) {
            let kind = ChoreKind::ALL
                .iter()
                .position(|k| *k == assignment.key.kind)
                .unwrap();
            assert_eq!(duty.actor(), header.actor());
            assert_eq!(duty.label(), label(&sim, assignment.key.kind.label()));
            assert_eq!(
                (duty.value(0), duty.value(1)),
                (kind as i32, assignment.key.target as i32)
            );
            assert_eq!(duty.triggers(), 0);
        }
    }
    let duties = records
        .iter()
        .filter(|r| r.kind() == Some(LogKind::Duty))
        .count();
    assert_eq!(duties, state.assignments.len(), "every duty has its header");

    board::tick(sim.world_mut(), &mut state);
    assert!(
        settled_records(&mut sim).is_empty(),
        "the same week stages nothing new"
    );
}

/// [AL-record] kind 7: a finished chore is an action line of the performer
/// with the Done outcome as its child, and the household's appreciation as
/// children of the outcome under Social.
#[test]
fn chore_done_links_to_the_performing_action() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let owner = state.episodes.iter().find(|e| e.key == key).unwrap().owner;
    let worker = person(&mut sim, owner);
    assert!(work::start(sim.world_mut(), &mut state, worker, key, true));
    sim.world_mut().insert_resource(state);
    crate::activity_log_tests::drain(&mut sim);
    let records = work_until_settled(&mut sim, key);
    let outcomes: Vec<_> = records
        .iter()
        .filter(|r| r.kind() == Some(LogKind::ChoreOutcome))
        .collect();
    assert_eq!(outcomes.len(), 1, "{records:?}");
    let outcome = outcomes[0];
    assert_eq!(
        (outcome.actor(), outcome.other(), outcome.value(0)),
        (owner, NONE, OUTCOME_DONE)
    );
    assert_eq!(outcome.label(), label(&sim, key.kind.label()));
    assert_eq!(outcome.triggers(), CHORES);
    let action = records
        .iter()
        .find(|r| r.seq() == outcome.parent())
        .expect("the outcome belongs to the action that did it");
    assert_eq!(action.kind(), Some(LogKind::ActionDone));
    assert_eq!(
        (action.actor(), action.label(), action.tick()),
        (owner, label(&sim, key.kind.label()), outcome.tick())
    );
    let fulfilled = label(&sim, RelationshipCause::ChoreFulfilled.log_label());
    let thanks = feelings_of(&records, outcome.seq(), fulfilled);
    let others: Vec<u32> = everyone(&mut sim)
        .into_iter()
        .filter(|id| *id != owner)
        .collect();
    assert_eq!(thanks.iter().map(|r| r.actor()).collect::<Vec<_>>(), others);
    for feeling in thanks {
        assert_eq!((feeling.other(), feeling.triggers()), (owner, SOCIAL));
    }
}

/// [AL-capture] item 4: chore work is never company, so a finished chore's
/// action line carries no Social total, shared opinion or companion, even
/// when an activity interrupted before it left company behind.
#[test]
fn chore_line_carries_no_stale_company() {
    use crate::activity_log::{ActivityLog, ACTIONS};
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let owner = state.episodes.iter().find(|e| e.key == key).unwrap().owner;
    let worker = person(&mut sim, owner);
    assert!(work::start(sim.world_mut(), &mut state, worker, key, true));
    sim.world_mut().insert_resource(state);
    crate::activity_log_tests::drain(&mut sim);
    sim.world_mut()
        .resource_mut::<ActivityLog>()
        .social(owner, 5.0, Some(99));
    let records = work_until_settled(&mut sim, key);
    let action = records
        .iter()
        .find(|r| r.kind() == Some(LogKind::ActionDone) && r.actor() == owner)
        .expect("the chore's action line");
    assert_eq!(action.label(), label(&sim, key.kind.label()));
    assert_eq!(
        (
            action.other(),
            action.value(0),
            action.value(3),
            action.triggers()
        ),
        (NONE, 0, 0, ACTIONS),
        "{action:?}"
    );
}

/// [AL-group] rule 3: a helper covering a declined chore is one line: the
/// helper's action, the Covered outcome naming the owner, every other
/// housemate's appreciation of the helper and the helper's resentment of
/// the owner, all children of the outcome.
#[test]
fn chore_cover_and_appreciation_are_children() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    episode.needed = true;
    episode.decision = Some(false);
    episode.outcome = DutyOutcome::Skipped;
    let owner = episode.owner;
    let helper_id = *everyone(&mut sim).iter().find(|id| **id != owner).unwrap();
    let helper = person(&mut sim, helper_id);
    assert!(work::start(sim.world_mut(), &mut state, helper, key, true));
    sim.world_mut().insert_resource(state);
    crate::activity_log_tests::drain(&mut sim);
    let records = work_until_settled(&mut sim, key);
    let outcome = records
        .iter()
        .find(|r| r.kind() == Some(LogKind::ChoreOutcome))
        .expect("an outcome");
    assert_eq!(
        (outcome.actor(), outcome.other(), outcome.value(0)),
        (helper_id, owner, OUTCOME_COVERED)
    );
    let action = records
        .iter()
        .find(|r| r.seq() == outcome.parent())
        .expect("the outcome belongs to the helper's action");
    assert_eq!(
        (action.kind(), action.actor()),
        (Some(LogKind::ActionDone), helper_id)
    );
    let fulfilled = label(&sim, RelationshipCause::ChoreFulfilled.log_label());
    let thanks = feelings_of(&records, outcome.seq(), fulfilled);
    let others: Vec<u32> = everyone(&mut sim)
        .into_iter()
        .filter(|id| *id != helper_id)
        .collect();
    assert_eq!(thanks.iter().map(|r| r.actor()).collect::<Vec<_>>(), others);
    assert!(thanks.iter().all(|r| r.other() == helper_id));
    let neglected = label(&sim, RelationshipCause::ChoreNeglected.log_label());
    let resentment = feelings_of(&records, outcome.seq(), neglected);
    assert_eq!(resentment.len(), 1);
    assert_eq!(
        (
            resentment[0].actor(),
            resentment[0].other(),
            resentment[0].triggers()
        ),
        (helper_id, owner, SOCIAL)
    );
}

/// [AL-sources]: a chore missed at the day rollover is one Missed line for
/// its owner, carrying every other housemate's resentment as children.
#[test]
fn missed_chore_logs_neglect_feelings() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let e = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    e.needed = true;
    e.decision = Some(false);
    e.outcome = DutyOutcome::Skipped;
    let owner = e.owner;
    sim.world_mut().resource_mut::<SimClock>().tick =
        u64::from(sim.world().resource::<crate::Content>().0.tuning.day_ticks);
    crate::activity_log_tests::drain(&mut sim);
    board::tick(sim.world_mut(), &mut state);
    let records = settled_records(&mut sim);
    let missed: Vec<_> = records
        .iter()
        .filter(|r| r.kind() == Some(LogKind::ChoreOutcome) && r.value(0) == OUTCOME_MISSED)
        .collect();
    assert_eq!(missed.len(), 1, "{records:?}");
    let outcome = missed[0];
    assert_eq!(
        (outcome.actor(), outcome.other(), outcome.parent()),
        (owner, NONE, 0)
    );
    assert_eq!(outcome.label(), label(&sim, key.kind.label()));
    assert_eq!(outcome.triggers(), CHORES);
    let neglected = label(&sim, RelationshipCause::ChoreNeglected.log_label());
    let resentment = feelings_of(&records, outcome.seq(), neglected);
    let others: Vec<u32> = everyone(&mut sim)
        .into_iter()
        .filter(|id| *id != owner)
        .collect();
    assert_eq!(
        resentment.iter().map(|r| r.actor()).collect::<Vec<_>>(),
        others
    );
    assert!(resentment
        .iter()
        .all(|r| r.other() == owner && r.triggers() == SOCIAL));
}

/// [AL-sources]: a failed willingness roll is one Skipped line for the
/// owner, and only the roll logs it.
#[test]
fn skipped_chore_is_logged() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let owner = state.episodes.iter().find(|e| e.key == key).unwrap().owner;
    // The least willing owner there can be.
    let profile = state
        .profiles
        .iter_mut()
        .find(|p| p.sim_id == owner)
        .unwrap();
    profile.responsibility = 0;
    profile.commitment = 0;
    profile.preferences = [i8::MIN; 4];
    crate::activity_log_tests::drain(&mut sim);
    board::tick(sim.world_mut(), &mut state);
    let episode = state.episodes.iter().find(|e| e.key == key).unwrap();
    assert_eq!(episode.decision, Some(false), "the roll declined");
    let records = settled_records(&mut sim);
    let skipped: Vec<_> = records
        .iter()
        .filter(|r| r.kind() == Some(LogKind::ChoreOutcome))
        .collect();
    assert_eq!(skipped.len(), 1, "{records:?}");
    assert_eq!(
        (skipped[0].actor(), skipped[0].other(), skipped[0].value(0)),
        (owner, NONE, OUTCOME_SKIPPED)
    );
    assert_eq!(skipped[0].label(), label(&sim, key.kind.label()));
    // Later ticks re-derive the same decision and log nothing more.
    for _ in 0..5 {
        board::tick(sim.world_mut(), &mut state);
    }
    assert!(settled_records(&mut sim)
        .iter()
        .all(|r| r.kind() != Some(LogKind::ChoreOutcome)));
}
