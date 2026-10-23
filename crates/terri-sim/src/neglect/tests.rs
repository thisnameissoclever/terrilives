use super::*;
use crate::Sim;

pub(crate) fn age(sim: &mut Sim) {
    refresh(sim.world_mut());
    let tick = now(sim.world()).max(UNFINISHED_WORK_GRACE_TICKS);
    sim.world_mut().resource_mut::<SimClock>().tick = tick;
    let mut saved = sim.world_mut().resource_mut::<SavedNeglect>();
    for timer in &mut saved.sources {
        timer.actionable_since = 0;
        timer.maximum_since = timer.maximum_since.map(|_| 0);
    }
    for timer in &mut saved.duties {
        timer.actionable_since = 0;
        timer.maximum_since = timer.maximum_since.map(|_| 0);
    }
}

fn dirty() -> (Sim, u32) {
    let mut sim = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    crate::chores::ensure(sim.world_mut());
    let counter = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "counter")
        .unwrap()
        .0
        .index_u32();
    sim.world_mut().resource_mut::<SavedChores>().surfaces = vec![(counter, 1000)];
    refresh(sim.world_mut());
    (sim, counter)
}

#[test]
fn balance_household_grace_maximum_boundary_and_partial_cleaning_reset() {
    let (mut sim, counter) = dirty();
    let source = NeglectSource::Surface(counter);
    let start = now(sim.world());
    sim.world_mut().resource_mut::<SimClock>().tick = start + 119;
    refresh(sim.world_mut());
    assert!(!source_due(sim.world(), source));
    sim.world_mut().resource_mut::<SimClock>().tick += 1;
    assert!(source_due(sim.world(), source));
    sim.world_mut().resource_mut::<SavedChores>().surfaces[0].1 = 900;
    refresh(sim.world_mut());
    assert!(!source_due(sim.world(), source));
    sim.world_mut().resource_mut::<SavedChores>().surfaces[0].1 = 1000;
    refresh(sim.world_mut());
    assert!(!source_due(sim.world(), source));
    sim.world_mut().resource_mut::<SimClock>().tick += 119;
    assert!(!source_due(sim.world(), source));
    sim.world_mut().resource_mut::<SimClock>().tick += 1;
    assert!(source_due(sim.world(), source));
    sim.world_mut()
        .resource_mut::<SavedChores>()
        .surfaces
        .clear();
    refresh(sim.world_mut());
    assert!(!source_due(sim.world(), source));
    assert!(snapshot(sim.world()).sources.is_empty());
}

#[test]
fn balance_household_grace_unfinished_work_requires_a_full_day() {
    let (mut sim, counter) = dirty();
    sim.world_mut().resource_mut::<SavedChores>().surfaces[0].1 = 500;
    refresh(sim.world_mut());
    let start = now(sim.world());
    sim.world_mut().resource_mut::<SimClock>().tick = start + 1439;
    assert!(!source_due(sim.world(), NeglectSource::Surface(counter)));
    sim.world_mut().resource_mut::<SimClock>().tick += 1;
    assert!(source_due(sim.world(), NeglectSource::Surface(counter)));
}

#[test]
fn balance_household_grace_save_continues_and_legacy_starts_fresh() {
    let (mut sim, counter) = dirty();
    sim.world_mut().resource_mut::<SimClock>().tick += 119;
    let saved = sim.current_v19_view();
    let hash = sim.world_hash();
    let mut loaded = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    loaded.load_current_v19_view(saved.clone()).unwrap();
    assert_eq!(loaded.current_v19_view(), saved);
    assert_eq!(loaded.world_hash(), hash);
    assert!(!source_due(loaded.world(), NeglectSource::Surface(counter)));
    loaded.world_mut().resource_mut::<SimClock>().tick += 1;
    assert!(source_due(loaded.world(), NeglectSource::Surface(counter)));
    loaded.load_snapshot_v18(saved.legacy.clone()).unwrap();
    assert!(!source_due(loaded.world(), NeglectSource::Surface(counter)));
}

#[test]
fn balance_household_grace_hash_validation_and_pause() {
    let (mut sim, _) = dirty();
    let hash = sim.world_hash();
    let saved = sim.current_v19_view();
    let mut invalid = saved.clone();
    invalid.neglect.sources[0].maximum_since = Some(now(sim.world()) + 1);
    assert!(sim.load_current_v19_view(invalid).is_err());
    assert_eq!(sim.world_hash(), hash);
    let mut changed = saved.clone();
    sim.world_mut().resource_mut::<SimClock>().tick += 1;
    changed.neglect.sources[0].maximum_since = Some(now(sim.world()));
    changed.legacy = sim.save_snapshot_v18();
    let unchanged_at_same_tick = sim.world_hash();
    sim.load_current_v19_view(changed).unwrap();
    assert_ne!(sim.world_hash(), unchanged_at_same_tick);
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::SetSpeed(0));
    sim.flush_commands();
    refresh(sim.world_mut());
    let paused = snapshot(sim.world());
    let tick = now(sim.world());
    for _ in 0..200 {
        sim.flush_commands();
        refresh(sim.world_mut());
    }
    assert_eq!(now(sim.world()), tick);
    assert_eq!(snapshot(sim.world()), paused);
}

#[test]
fn balance_household_grace_removed_sources_are_pruned() {
    let (mut sim, counter) = dirty();
    let object = crate::dining::entity(sim.world(), counter).unwrap();
    assert!(sim.world_mut().despawn(object));
    refresh(sim.world_mut());
    assert!(snapshot(sim.world()).sources.is_empty());
}

#[test]
fn balance_household_grace_neat_observer_not_suppressed_by_tolerant_owner() {
    let (mut sim, counter) = dirty();
    sim.world_mut().resource_mut::<SavedChores>().surfaces[0].1 = 100;
    let people: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &terri_core::SimId)>()
        .iter(sim.world())
        .map(|(e, id)| (e, id.0))
        .collect();
    let owner = people[0].0;
    let observer = people[1].0;
    let key = crate::chores::neglect_surface_key(sim.world(), counter).unwrap();
    sim.world_mut().resource_mut::<SavedChores>().assignments = vec![ChoreAssignment {
        key,
        owner: people[0].1,
        week: 0,
    }];
    sim.world_mut().init_resource::<SavedDomestic>();
    sim.world_mut().resource_mut::<SavedDomestic>().cleanliness =
        vec![(owner.index_u32(), 0.0), (observer.index_u32(), 1.0)];
    let position = *sim
        .world()
        .get::<terri_core::Position>(crate::dining::entity(sim.world(), counter).unwrap())
        .unwrap();
    sim.world_mut().entity_mut(observer).insert(position);
    refresh(sim.world_mut());
    let start = now(sim.world());
    sim.world_mut().resource_mut::<SimClock>().tick = start + UNFINISHED_WORK_GRACE_TICKS;
    assert!(source_due(sim.world(), NeglectSource::Surface(counter)));
    assert!(crate::chores::moodlets(sim.world(), observer)
        .iter()
        .any(|m| m.label == "Grimy surfaces" && m.score < 0.0));
    assert!(!crate::chores::moodlets(sim.world(), owner)
        .iter()
        .any(|m| m.label == "Grimy surfaces"));
}

#[test]
fn balance_household_grace_legal_combined_source_inventory_round_trips() {
    let mut old = Sim::new_with_lot(400, 400);
    let counter = old
        .world()
        .resource::<crate::Content>()
        .0
        .find("counter")
        .unwrap();
    let surface = old
        .spawn_object(terri_core::Position { x: 350.0, y: 350.0 }, counter)
        .index_u32();
    crate::chores::ensure(old.world_mut());
    old.world_mut().resource_mut::<SavedChores>().floors =
        (0..100_000).map(|cell| (cell, 100)).collect();
    old.world_mut().resource_mut::<SavedChores>().surfaces = vec![(surface, 100)];
    let mut sim = Sim::new_with_lot(1, 1);
    sim.load_snapshot_v18(old.save_snapshot_v18())
        .expect("the published source inventories are legal");
    refresh(sim.world_mut());
    assert_eq!(snapshot(sim.world()).sources.len(), 100_001);
    let saved = sim.current_v19_view();
    let mut loaded = Sim::new_with_lot(1, 1);
    loaded
        .load_current_v19_view(saved.clone())
        .expect("combined legal source inventories must not exceed an unrelated timing cap");
    assert_eq!(loaded.current_v19_view(), saved);
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

#[test]
fn balance_household_grace_episode_index_handles_the_saved_inventory_bound() {
    let key = ChoreKey {
        kind: ChoreKind::Dishes,
        target: 0,
    };
    let mut observation = Observation {
        sources: BTreeMap::new(),
        duties: BTreeSet::from([(key, 0)]),
        continuing: BTreeSet::new(),
        episodes: (0..100_000)
            .map(|id| ChoreEpisode {
                id,
                key,
                owner: 0,
                day: 0,
                decision: Some(false),
                outcome: DutyOutcome::Skipped,
                performer: None,
                completed_at: None,
                settled: false,
                needed: true,
                unavailable: false,
            })
            .collect(),
    };
    let ids = eligible_episodes(&observation);
    assert_eq!(ids.len(), 100_000);
    assert!(ids.contains(&99_999));
    assert!(!ids.contains(&100_000));
    for episode in observation.episodes.iter_mut().step_by(2) {
        episode.needed = false;
    }
    let retained = eligible_episodes(&observation);
    assert_eq!(retained.len(), 50_000);
    assert!(!retained.contains(&99_998));
    assert!(retained.contains(&99_999));
}
