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
    loaded.load_snapshot_v19(sim.save_snapshot_v19()).unwrap();
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
    loaded.load_snapshot_v19(sim.save_snapshot_v19()).unwrap();
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
        .effects
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
            .effects
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
        board::credit(
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
                let saved = sim.save_snapshot_v19();
                assert_eq!(!saved.neglect.matured_episodes.is_empty(), elapsed == 120);
                let mut loaded =
                    crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
                loaded.load_snapshot_v19(saved.clone()).expect(
                    "gradual cleaning must preserve its observed episode through a current save",
                );
                assert_eq!(loaded.save_snapshot_v19(), saved);
                assert_eq!(loaded.world_hash(), sim.world_hash());
                if elapsed == 120 {
                    let mut changed = saved.clone();
                    changed.neglect.matured_episodes.clear();
                    loaded.load_snapshot_v19(changed).unwrap();
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
    let mut invalid = sim.save_snapshot_v19();
    invalid.neglect.matured_episodes.push(episode_id);
    assert!(
        sim.load_snapshot_v19(invalid).is_err(),
        "load rejects maturity after the work was discharged"
    );
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    let surface = state.surfaces[0].0;
    add(&mut state.surfaces, surface, 1000);
    crate::neglect::refresh_in(sim.world_mut(), &state);
    assert!(!crate::neglect::episode_matured(sim.world(), episode_id));
}
