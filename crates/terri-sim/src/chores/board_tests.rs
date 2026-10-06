use super::*;
use crate::Sim;
use terri_core::{Relationships, SimClock, SimId, SmartObject};

fn fixture() -> (Sim, SavedChores, ChoreKey) {
    let mut sim = Sim::new_from_shipped_lot();
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
    let mut loaded = Sim::new_from_shipped_lot();
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
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
}
