use super::*;

#[test]
fn raw_chore_profiles_preserve_loadable_paused_saves_at_the_numeric_boundary() {
    let mut handle = SimHandle::from_lot();
    let agent = handle
        .sim
        .save_snapshot_v5()
        .world
        .entities
        .iter()
        .find(|e| e.agent)
        .unwrap()
        .index;
    let before = handle.save_bytes();
    let hash = handle.world_hash();
    for (responsibility, preferences) in [
        (101, [0; 4]),
        (255, [0; 4]),
        (50, [-101, 0, 0, 0]),
        (50, [0, 101, 0, 0]),
    ] {
        let bytes = postcard::to_allocvec(&SimCommand::SetChoreProfile {
            agent,
            responsibility,
            preferences,
        })
        .unwrap();
        assert!(!handle.enqueue_command(&bytes));
        assert_eq!(handle.save_bytes(), before);
        assert_eq!(handle.world_hash(), hash);
    }
    for responsibility in [0, 100] {
        let mut accepted = SimHandle::from_lot();
        let bytes = postcard::to_allocvec(&SimCommand::SetChoreProfile {
            agent,
            responsibility,
            preferences: [-100, 100, 0, 0],
        })
        .unwrap();
        assert!(accepted.enqueue_command(&bytes));
        let saved = accepted.save_bytes();
        let mut restored = SimHandle::from_lot();
        assert!(restored.load_bytes(&saved));
        assert_eq!(restored.save_bytes(), saved);
        assert_eq!(restored.world_hash(), accepted.world_hash());
    }
}

#[test]
fn chore_boundary_rejects_invalid_numbers_without_mutating_saved_state() {
    let mut handle = SimHandle::from_lot();
    let before = handle.save_bytes();
    for bad in [f64::NAN, f64::INFINITY, -1.0, 0.5, u32::MAX as f64 + 1.0] {
        assert!(!handle.clean_chore(bad, 1.0, 0.0, true));
        assert!(!handle.clean_chore(34.0, bad, 0.0, false));
        assert!(!handle.clean_chore(34.0, 1.0, bad, true));
        assert!(!handle.set_chore_profile(34.0, &[bad, 0.0, 0.0, 0.0, 0.0]));
        assert_eq!(handle.save_bytes(), before);
    }
    assert!(!handle.clean_chore(34.0, 6.0, 0.0, true));
    assert!(!handle.set_chore_profile(34.0, &[50.0, 0.0]));
    assert!(!handle.set_chore_profile(34.0, &[50.0, 101.0, 0.0, 0.0, 0.0]));
    assert_eq!(handle.save_bytes(), before);
}

#[test]
fn chores_optional_tail_rejects_each_interior_cut_transactionally() {
    let mut handle = SimHandle::from_lot();
    handle.tick();
    let full = handle.save_bytes();
    let tail = postcard::to_allocvec(&handle.sim.save_snapshot_v5().chores)
        .unwrap()
        .len();
    let end = full.len()
        - postcard::to_allocvec(&handle.sim.save_snapshot_v5().grime)
            .unwrap()
            .len();
    let prefix = end - tail;
    for end in prefix + 1..end {
        let before = handle.save_bytes();
        assert!(
            !handle.load_bytes(&full[..end]),
            "chore tail cut at {end} was accepted"
        );
        assert_eq!(handle.save_bytes(), before);
    }
    assert!(
        handle.load_bytes(&full[..prefix]),
        "published prefix without chores remains valid"
    );
}

#[test]
fn scoped_cleanup_invalid_semantics_cannot_break_a_paused_save() {
    let mut handle = SimHandle::from_lot();
    let saved = handle.sim.save_snapshot_v5();
    let agent = saved.world.entities.iter().find(|e| e.agent).unwrap().index;
    let counter = saved
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("counter"))
        .unwrap()
        .index;
    let fridge = saved
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    for (surface, dishes) in [(fridge, None), (counter, Some(vec![999.0]))] {
        let before = handle.save_bytes();
        assert!(handle.clean_dishes(agent.into(), surface.into(), dishes, false));
        handle.flush_commands();
        assert_eq!(
            handle.save_bytes(),
            before,
            "invalid semantic scope must be refused at the paused drain"
        );
        let mut loaded = SimHandle::from_lot();
        assert!(loaded.load_bytes(&handle.save_bytes()));
    }
}

#[test]
fn scoped_cleanup_boundary_rejects_invalid_numbers_and_noncanonical_selections() {
    let mut handle = SimHandle::from_lot();
    let before = handle.save_bytes();
    for bad in [f64::NAN, f64::INFINITY, -1.0, 0.5, u32::MAX as f64 + 1.0] {
        assert!(!handle.clean_dishes(bad, 1.0, None, true));
        assert!(!handle.clean_dishes(34.0, bad, None, true));
        assert!(!handle.clean_dishes(34.0, 1.0, Some(vec![bad]), true));
        assert_eq!(handle.save_bytes(), before);
    }
    for ids in [vec![], vec![1.0, 1.0], vec![2.0, 1.0]] {
        assert!(!handle.clean_dishes(34.0, 1.0, Some(ids), true));
        assert_eq!(handle.save_bytes(), before);
    }
}

#[test]
fn scoped_cleanup_optional_tail_rejects_every_interior_cut_transactionally() {
    let mut handle = SimHandle::from_lot();
    let saved = handle.sim.save_snapshot_v5();
    let agent = saved.world.entities.iter().find(|e| e.agent).unwrap().index;
    let surface = saved
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("counter"))
        .unwrap()
        .index;
    assert!(handle.clean_dishes(agent.into(), surface.into(), None, false));
    handle.flush_commands();
    let saved = handle.sim.save_snapshot_v5();
    assert!(saved.targeted_cleanup.is_some());
    let tail = postcard::to_allocvec(&saved.targeted_cleanup).unwrap();
    let bytes = handle.save_bytes();
    let suffix = postcard::to_allocvec(&saved.chores).unwrap().len()
        + postcard::to_allocvec(&saved.grime).unwrap().len();
    let end = bytes.len() - suffix;
    let start = end - tail.len();
    let before = handle.save_bytes();
    for cut in start + 1..end {
        assert!(
            !handle.load_bytes(&bytes[..cut]),
            "accepted scoped cleanup cut {}",
            cut - start
        );
        assert_eq!(handle.save_bytes(), before);
    }
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(handle.world_hash(), loaded.world_hash());
}

#[test]
fn grime_optional_tail_rejects_every_interior_cut_transactionally() {
    let mut handle = SimHandle::from_lot();
    handle.tick();
    let full = handle.save_bytes();
    let size = postcard::to_allocvec(&handle.sim.save_snapshot_v5().grime)
        .unwrap()
        .len();
    let prefix = full.len() - size;
    for cut in prefix + 1..full.len() {
        assert!(!handle.load_bytes(&full[..cut]), "grime cut {cut}");
        assert_eq!(handle.save_bytes(), full);
    }
    assert!(handle.load_bytes(&full[..prefix]));
}
