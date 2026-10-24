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

/// A housemate held to wait for someone walking over to talk or argue does not
/// start their duty until released: the loader refuses a reserved recipient
/// with work of their own, so Build mode would not open.
#[test]
fn a_reserved_owner_starts_their_duty_only_when_released() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    episode.decision = Some(true);
    let owner = episode.owner;
    let person = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .find(|(_, id)| id.0 == owner)
        .unwrap()
        .0;
    sim.world_mut()
        .entity_mut(person)
        .insert(terri_core::Reserved);
    board::tick(sim.world_mut(), &mut state);
    assert!(state.tasks.iter().all(|t| t.person != person.index_u32()));
    sim.world_mut()
        .entity_mut(person)
        .remove::<terri_core::Reserved>();
    board::tick(sim.world_mut(), &mut state);
    assert!(state.tasks.iter().any(|t| t.person == person.index_u32()));
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
        .effects()
        .len();
    board::credit(sim.world_mut(), &mut state, person.index_u32(), key, 0, 1);
    assert_eq!(
        sim.world()
            .resource::<crate::relationship_effects::RelationshipDiagnostics>()
            .effects()
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
    loaded
        .load_current_v19_view(sim.current_v19_view())
        .unwrap();
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
    crate::neglect::refresh_in(sim.world_mut(), &state);
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
    completed(
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
    loaded
        .load_current_v19_view(sim.current_v19_view())
        .unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

#[test]
fn balance_household_grace_fresh_work_at_2359_has_no_midnight_resentment() {
    let (mut sim, mut state, key) = fixture();
    let day_ticks = u64::from(sim.world().resource::<crate::Content>().0.tuning.day_ticks);
    sim.world_mut().resource_mut::<SimClock>().tick = day_ticks - 1;
    board::reconcile(sim.world(), &mut state);
    let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    episode.needed = true;
    episode.decision = Some(false);
    episode.outcome = DutyOutcome::Skipped;
    let owner = episode.owner;
    let history = state
        .profiles
        .iter()
        .find(|p| p.sim_id == owner)
        .unwrap()
        .commitment;
    let effects = sim
        .world()
        .resource::<crate::relationship_effects::RelationshipDiagnostics>()
        .effects()
        .len();
    board::tick(sim.world_mut(), &mut state);
    sim.world_mut().resource_mut::<SimClock>().tick = day_ticks;
    board::tick(sim.world_mut(), &mut state);
    assert_eq!(
        state
            .profiles
            .iter()
            .find(|p| p.sim_id == owner)
            .unwrap()
            .commitment,
        history
    );
    assert_eq!(
        sim.world()
            .resource::<crate::relationship_effects::RelationshipDiagnostics>()
            .effects()
            .len(),
        effects
    );
}

#[test]
fn balance_household_grace_helper_resentment_uses_the_same_boundary() {
    for elapsed in [119, 120] {
        let (mut sim, mut state, key) = fixture();
        board::reconcile(sim.world(), &mut state);
        let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
        episode.needed = true;
        episode.decision = Some(false);
        episode.outcome = DutyOutcome::Skipped;
        let owner = episode.owner;
        let helper = sim
            .world_mut()
            .query::<(Entity, &SimId)>()
            .iter(sim.world())
            .find(|(_, id)| id.0 != owner)
            .unwrap()
            .0;
        crate::neglect::refresh_in(sim.world_mut(), &state);
        sim.world_mut().resource_mut::<SimClock>().tick += elapsed;
        crate::neglect::refresh_in(sim.world_mut(), &state);
        // Normal work clears physical dirt before completion credit is awarded.
        state.surfaces.clear();
        completed(
            sim.world_mut(),
            &mut state,
            helper.index_u32(),
            key,
            0,
            1000,
        );
        assert_eq!(
            sim.relationship_effects().iter().any(|effect| effect.cause
                == crate::relationship_effects::RelationshipCause::ChoreNeglected),
            elapsed == 120
        );
        assert!(sim
            .relationship_effects()
            .iter()
            .any(|effect| effect.cause
                == crate::relationship_effects::RelationshipCause::ChoreFulfilled));
    }
}

#[test]
fn balance_household_grace_real_gradual_wipe_retains_its_admitted_boundary() {
    for elapsed in [119, 120] {
        let (mut sim, mut state, key) = fixture();
        board::reconcile(sim.world(), &mut state);
        let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
        episode.needed = true;
        episode.decision = Some(false);
        episode.outcome = DutyOutcome::Skipped;
        let owner = episode.owner;
        let helper = sim
            .world_mut()
            .query::<(Entity, &SimId)>()
            .iter(sim.world())
            .find(|(_, id)| id.0 != owner)
            .unwrap()
            .0;
        crate::neglect::refresh_in(sim.world_mut(), &state);
        sim.world_mut().resource_mut::<SimClock>().tick += elapsed;
        let counter = state.surfaces[0].0;
        let object_entity = crate::dining::entity(sim.world(), counter).unwrap();
        let pos = *sim
            .world()
            .get::<terri_core::Position>(object_entity)
            .unwrap();
        let pack = sim.world().resource::<crate::Content>().0;
        let object = sim.world().get::<SmartObject>(object_entity).unwrap();
        let footprint = crate::placed_footprint(
            pack,
            object.0,
            sim.world().get::<terri_core::ObjectFacing>(object_entity),
        );
        let from = *sim.world().get::<terri_core::Position>(helper).unwrap();
        let path = sim
            .world()
            .resource::<terri_core::TileGrid>()
            .find_path_adjacent(
                (from.x.round() as i32, from.y.round() as i32),
                (pos.x.round() as i32, pos.y.round() as i32),
                footprint,
            )
            .unwrap();
        let endpoint = path
            .last()
            .copied()
            .unwrap_or((from.x.round() as i32, from.y.round() as i32));
        sim.world_mut()
            .entity_mut(helper)
            .insert(terri_core::Position {
                x: endpoint.0 as f32,
                y: endpoint.1 as f32,
            });
        assert!(work::start(sim.world_mut(), &mut state, helper, key, true));
        let mut ticks = 0;
        while !state.tasks.is_empty() && ticks < 100 {
            crate::neglect::refresh_in(sim.world_mut(), &state);
            work::advance(sim.world_mut(), &mut state);
            crate::neglect::refresh_in(sim.world_mut(), &state);
            sim.world_mut().resource_mut::<SimClock>().tick += 1;
            ticks += 1;
            if ticks == 20 {
                sim.world_mut().insert_resource(state.clone());
                let saved = sim.current_v19_view();
                assert_eq!(!saved.neglect.matured_episodes.is_empty(), elapsed == 120);
                let mut loaded =
                    crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
                loaded.load_current_v19_view(saved.clone()).expect(
                    "gradual cleaning must preserve its observed episode through a current save",
                );
                assert_eq!(loaded.current_v19_view(), saved);
                assert_eq!(loaded.world_hash(), sim.world_hash());
                if elapsed == 120 {
                    let mut changed = saved.clone();
                    changed.neglect.matured_episodes.clear();
                    loaded.load_current_v19_view(changed).unwrap();
                    assert_ne!(
                        loaded.world_hash(),
                        sim.world_hash(),
                        "observed overdue episodes affect future coverage reactions"
                    );
                }
                sim.world_mut().remove_resource::<SavedChores>();
            }
        }
        assert_eq!(ticks, 45, "the actual wiping work must fade over 45 ticks");
        assert!(state.surfaces.is_empty());
        assert_eq!(
            sim.relationship_effects().iter().any(|effect| effect.cause
                == crate::relationship_effects::RelationshipCause::ChoreNeglected),
            elapsed == 120
        );
    }
}

#[test]
fn balance_household_grace_removed_dirty_member_does_not_age_reused_duty() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let episode = state
        .episodes
        .iter_mut()
        .find(|episode| episode.key == key)
        .unwrap();
    episode.needed = true;
    episode.decision = Some(false);
    episode.outcome = DutyOutcome::Skipped;
    let episode_id = episode.id;
    crate::neglect::refresh_in(sim.world_mut(), &state);
    sim.world_mut().resource_mut::<SimClock>().tick += 120;
    crate::neglect::refresh_in(sim.world_mut(), &state);
    assert!(crate::neglect::episode_matured(sim.world(), episode_id));
    let dirty = state.surfaces[0].0;
    let object = crate::dining::entity(sim.world(), dirty).unwrap();
    assert!(sim.world_mut().despawn(object));
    state.surfaces.clear();
    board::refresh_grouped_need(sim.world(), &mut state);
    crate::neglect::refresh_in(sim.world_mut(), &state);
    assert!(!crate::neglect::episode_matured(sim.world(), episode_id));
    let remaining = groups::members(sim.world(), key)[0];
    add(&mut state.surfaces, remaining, 1000);
    state
        .episodes
        .iter_mut()
        .find(|episode| episode.id == episode_id)
        .unwrap()
        .needed = true;
    crate::neglect::refresh_in(sim.world_mut(), &state);
    assert!(
        !crate::neglect::episode_matured(sim.world(), episode_id),
        "fresh work on the same daily duty gets fresh grace"
    );
}

#[test]
fn balance_household_grace_cancel_below_tolerance_clears_prior_maturity() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let episode = state
        .episodes
        .iter_mut()
        .find(|episode| episode.key == key)
        .unwrap();
    episode.needed = true;
    episode.decision = Some(false);
    episode.outcome = DutyOutcome::Skipped;
    let (owner, episode_id) = (episode.owner, episode.id);
    let helper = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .find(|(_, id)| id.0 != owner)
        .unwrap()
        .0;
    crate::neglect::refresh_in(sim.world_mut(), &state);
    sim.world_mut().resource_mut::<SimClock>().tick += 120;
    crate::neglect::refresh_in(sim.world_mut(), &state);
    assert!(work::start(sim.world_mut(), &mut state, helper, key, true));
    work::advance(sim.world_mut(), &mut state);
    let endpoint = state.tasks[0].endpoint.unwrap();
    let width = sim.world().resource::<terri_core::TileGrid>().width() as u32;
    sim.world_mut()
        .entity_mut(helper)
        .remove::<terri_core::Path>()
        .insert(terri_core::Position {
            x: (endpoint % width) as f32,
            y: (endpoint / width) as f32,
        });
    for _ in 0..43 {
        work::advance(sim.world_mut(), &mut state);
        crate::neglect::refresh_in(sim.world_mut(), &state);
        sim.world_mut().resource_mut::<SimClock>().tick += 1;
    }
    assert!(!board::work_needed(sim.world(), &state, key, owner));
    assert!(
        crate::neglect::episode_matured(sim.world(), episode_id),
        "genuine unfinished cleaning retains its observed episode"
    );
    sim.world_mut().insert_resource(state);
    cancel(sim.world_mut(), helper);
    crate::neglect::refresh(sim.world_mut());
    assert!(!crate::neglect::episode_matured(sim.world(), episode_id));
    let mut invalid = sim.current_v19_view();
    invalid.neglect.matured_episodes.push(episode_id);
    assert!(
        sim.load_current_v19_view(invalid).is_err(),
        "load rejects maturity after the work was discharged"
    );
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    let surface = state.surfaces[0].0;
    add(&mut state.surfaces, surface, 1000);
    crate::neglect::refresh_in(sim.world_mut(), &state);
    assert!(!crate::neglect::episode_matured(sim.world(), episode_id));
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

/// [AL-sources]: within a week, a change to the available duties logs a new
/// Chores this week line only for the owners whose own duties changed; a
/// new week logs every owner.
#[test]
fn a_mid_week_duty_change_logs_only_the_owners_it_changed() {
    let (mut sim, mut state, _) = fixture();
    let duty = |kind: ChoreKind, target: u32, owner: u32| terri_core::chores::ChoreAssignment {
        key: ChoreKey { kind, target },
        owner,
        week: 3,
    };
    let before = vec![duty(ChoreKind::Dishes, 0, 1), duty(ChoreKind::Floors, 4, 2)];
    state.week = Some(3);
    state.assignments = vec![
        duty(ChoreKind::Dishes, 0, 1),
        duty(ChoreKind::Floors, 4, 2),
        duty(ChoreKind::Bins, 0, 1),
    ];
    crate::activity_log_tests::drain(&mut sim);
    let headers = |sim: &mut Sim| -> Vec<u32> {
        settled_records(sim)
            .iter()
            .filter(|r| r.kind() == Some(LogKind::ChoresThisWeek))
            .map(|r| r.actor())
            .collect()
    };
    board::log_week(
        sim.world_mut(),
        &state,
        &board::WeekChange {
            previous_week: Some(3),
            previous: before.clone(),
        },
    );
    assert_eq!(
        headers(&mut sim),
        vec![1],
        "only the owner who gained a duty"
    );
    board::log_week(
        sim.world_mut(),
        &state,
        &board::WeekChange {
            previous_week: Some(2),
            previous: before,
        },
    );
    assert_eq!(headers(&mut sim), vec![1, 2], "a new week logs everyone");
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
    let episode_id = episode.id;
    // The declined duty has been neglected past its grace, so covering it
    // earns the helper's resentment.
    crate::neglect::refresh_in(sim.world_mut(), &state);
    sim.world_mut().resource_mut::<SimClock>().tick += 120;
    crate::neglect::refresh_in(sim.world_mut(), &state);
    assert!(crate::neglect::episode_matured(sim.world(), episode_id));
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

/// [AL-sources]: a chore missed at the day rollover, once its grace has
/// passed, is one Missed line for its owner, carrying every other
/// housemate's resentment as children.
#[test]
fn missed_chore_logs_neglect_feelings() {
    let (mut sim, mut state, key) = fixture();
    board::reconcile(sim.world(), &mut state);
    let e = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
    e.needed = true;
    e.decision = Some(false);
    e.outcome = DutyOutcome::Skipped;
    let owner = e.owner;
    // The duty's neglect timer starts now, so it is due by the rollover.
    crate::neglect::refresh_in(sim.world_mut(), &state);
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
