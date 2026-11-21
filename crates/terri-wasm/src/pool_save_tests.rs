use super::*;
use crate::current_test_snapshot::{CurrentSnapshotViews, CurrentV5View};
use terri_core::{CommandQueue, Needs, Position, TileGrid};

fn exiting_pool() -> SimHandle {
    let mut handle = SimHandle::new(12, 12);
    let definition = handle
        .sim
        .world()
        .resource::<Content>()
        .0
        .find("pool")
        .unwrap();
    let pool = handle
        .sim
        .spawn_object(Position { x: 4., y: 4. }, definition);
    for y in 4..6 {
        for x in 4..6 {
            handle
                .sim
                .world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(x, y, true);
        }
    }
    let actor = handle.sim.spawn_agent(Position { x: 3., y: 4. }, 50.);
    handle
        .sim
        .world_mut()
        .entity_mut(actor)
        .insert(Needs::all_at(50.));
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: pool.index_u32(),
            interaction: 0,
        });
    handle.sim.flush_commands();
    for _ in 0..150 {
        handle.sim.tick();
        if handle
            .sim
            .save_snapshot_v26()
            .pools
            .first()
            .is_some_and(|episode| episode.phase == 3)
        {
            return handle;
        }
    }
    panic!("Ordinary Hop in order never reached its natural exit");
}

fn bytes(snapshot: &CurrentV5View) -> Vec<u8> {
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend(terri_core::SAVE_SCHEMA_VERSION.to_le_bytes());
    bytes.extend(postcard::to_allocvec(&snapshot.0).unwrap());
    bytes
}

#[test]
fn pool_codec_rejects_an_uninterrupted_exit_from_an_impossible_origin() {
    let mut handle = exiting_pool();
    let before = handle.save_bytes();
    assert!(handle.load_bytes(&before));
    let mut snapshot = handle.sim.current_v5_view();
    assert!(!snapshot.0.pools[0].interrupted);
    assert_eq!(snapshot.0.pools[0].exit_origin, 60);
    snapshot.0.pools[0].exit_origin = 17;
    assert!(!handle.load_bytes(&bytes(&snapshot)));
    assert_eq!(handle.save_bytes(), before);
}

#[test]
fn pool_codec_rejects_a_countdown_that_disagrees_with_native_phase_time() {
    let mut handle = exiting_pool();
    let before = handle.save_bytes();
    let mut snapshot = handle.sim.current_v5_view();
    let actor = snapshot.0.pools[0].actor;
    let eating = snapshot
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.index == actor)
        .unwrap()
        .eating
        .as_mut()
        .unwrap();
    assert_eq!(eating.remaining_ticks, 20);
    eating.remaining_ticks = 19;
    assert!(!handle.load_bytes(&bytes(&snapshot)));
    assert_eq!(handle.save_bytes(), before);
}

#[test]
fn pool_codec_rejects_an_occupied_action_from_a_different_object_definition() {
    let mut handle = exiting_pool();
    assert!(handle.spawn_object(8., 8., "toilet"));
    let before = handle.save_bytes();
    let mut snapshot = handle.sim.current_v5_view();
    let actor = snapshot.0.pools[0].actor;
    let eating = snapshot
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.index == actor)
        .unwrap()
        .eating
        .as_mut()
        .unwrap();
    eating.object = "toilet".into();
    eating.interaction = 0;
    assert!(!handle.load_bytes(&bytes(&snapshot)));
    assert_eq!(handle.save_bytes(), before);
}

#[test]
fn pool_codec_rejects_a_missing_physical_reservation() {
    let mut handle = exiting_pool();
    let before = handle.save_bytes();
    let mut snapshot = handle.sim.current_v5_view();
    let pool = snapshot.0.pools[0].pool;
    let object = snapshot
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.index == pool)
        .unwrap();
    assert!(object.reserved);
    object.reserved = false;
    assert!(!handle.load_bytes(&bytes(&snapshot)));
    assert_eq!(handle.save_bytes(), before);
}

#[test]
fn pool_fractional_same_tile_arrival_reaches_exact_contact_and_roundtrips() {
    let mut handle = SimHandle::new(12, 12);
    assert!(handle.spawn_object(4., 4., "pool"));
    handle.spawn_agent(3.2, 4., 50.);
    let world = handle.sim.current_v5_view().world.clone();
    let actor = world
        .entities
        .iter()
        .find(|entity| entity.agent)
        .unwrap()
        .index;
    let pool = world
        .entities
        .iter()
        .find(|entity| entity.smart_object.as_deref() == Some("pool"))
        .unwrap()
        .index;
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor,
            object: pool,
            interaction: 0,
        });
    handle.flush_commands();
    for _ in 0..100 {
        handle.tick();
        if handle
            .sim
            .save_snapshot_v26()
            .pools
            .first()
            .is_some_and(|episode| episode.phase > 0)
        {
            break;
        }
    }
    assert_eq!(handle.sim.save_snapshot_v26().pools[0].phase, 1);
    let current = handle.sim.current_v5_view().world.clone();
    let position = current
        .entities
        .iter()
        .find(|entity| entity.index == actor)
        .unwrap()
        .position
        .unwrap();
    assert_eq!((position.x, position.y), (3., 5.));
    let bytes = handle.save_bytes();
    let mut twin = SimHandle::new(12, 12);
    assert!(twin.load_bytes(&bytes));
    assert_eq!(twin.save_bytes(), bytes);
    for _ in 0..5 {
        handle.tick();
        twin.tick();
        assert_eq!(handle.save_bytes(), twin.save_bytes());
    }
}

fn roundtrip_pool(handle: &mut SimHandle, label: &str) {
    let before = handle.save_bytes();
    let mut twin = SimHandle::new(12, 12);
    assert!(twin.load_bytes(&before), "{label}");
    assert_eq!(twin.save_bytes(), before, "{label}");
    for _ in 0..3 {
        handle.tick();
        twin.tick();
        assert_eq!(handle.save_bytes(), twin.save_bytes(), "{label}");
    }
}

#[test]
fn pool_codec_complete_physical_contract_negative_controls() {
    let mut handle = exiting_pool();
    let before = handle.save_bytes();
    let baseline = handle.sim.current_v5_view();
    let actor = baseline.0.pools[0].actor;
    let pool = baseline.0.pools[0].pool;
    let mut accepted = Vec::new();
    for label in [
        "missing needs",
        "missing episode",
        "missing reservation",
        "reverse at 20",
        "phase zero with occupation",
        "wrong approach",
        "duplicate episode",
        "active step work",
        "orphan reservation",
        "target without path or occupation",
    ] {
        let mut snapshot = baseline.clone();
        match label {
            "missing needs" => {
                snapshot
                    .world
                    .entities
                    .iter_mut()
                    .find(|e| e.index == actor)
                    .unwrap()
                    .needs = None
            }
            "missing episode" => snapshot.0.pools.clear(),
            "missing reservation" => {
                snapshot
                    .world
                    .entities
                    .iter_mut()
                    .find(|e| e.index == pool)
                    .unwrap()
                    .reserved = false
            }
            "reverse at 20" => {
                let e = &mut snapshot.0.pools[0];
                e.phase = 4;
                e.elapsed = 20;
                e.exit_origin = 0;
                e.interrupted = true;
            }
            "phase zero with occupation" => {
                let e = &mut snapshot.0.pools[0];
                e.phase = 0;
                e.elapsed = 0;
                e.exit_origin = 0;
                let actor = snapshot
                    .world
                    .entities
                    .iter_mut()
                    .find(|e| e.index == actor)
                    .unwrap();
                actor.path = Some(terri_core::SavedPath {
                    steps: vec![],
                    cursor: 0,
                });
            }
            "wrong approach" => snapshot.0.pools[0].approach = (3, 3),
            "duplicate episode" => {
                let duplicate = snapshot.0.pools[0].clone();
                snapshot.0.pools.push(duplicate);
            }
            "active step work" => {
                snapshot
                    .world
                    .entities
                    .iter_mut()
                    .find(|e| e.index == actor)
                    .unwrap()
                    .step_work_ticks = Some(3)
            }
            "orphan reservation" => {
                snapshot.0.pools.clear();
                let e = snapshot
                    .world
                    .entities
                    .iter_mut()
                    .find(|e| e.index == actor)
                    .unwrap();
                e.target = None;
                e.eating = None;
                e.intents = Some(vec![]);
                let mut orders = crate::current_test_snapshot::CurrentV17View(snapshot.0);
                orders.player_orders.orders.clear();
                snapshot = CurrentV5View(orders.0);
            }
            "target without path or occupation" => {
                snapshot.0.pools.clear();
                snapshot
                    .world
                    .entities
                    .iter_mut()
                    .find(|e| e.index == actor)
                    .unwrap()
                    .eating = None;
            }
            _ => unreachable!(),
        }
        if handle.load_bytes(&bytes(&snapshot)) {
            accepted.push(label);
        } else {
            assert_eq!(handle.save_bytes(), before, "atomic refusal: {label}");
        }
        assert!(handle.load_bytes(&before));
    }
    assert!(
        accepted.is_empty(),
        "contradictory continuations admitted: {accepted:?}"
    );
}

#[test]
fn pool_codec_preserves_public_phase_and_paused_cancellation_boundaries() {
    let natural = exiting_pool();
    let origin = natural.sim.save_snapshot_v26().pools[0].clone();
    // Reproduce each checkpoint through full public ticks, not DTO fabrication.
    for (phase, elapsed, cancel) in [
        (1, 0, false),
        (1, 19, false),
        (2, 0, false),
        (2, 59, false),
        (3, 0, false),
        (1, 0, true),
        (1, 19, true),
        (2, 0, true),
        (2, 59, true),
        (3, 0, true),
    ] {
        let mut handle = SimHandle::new(12, 12);
        assert!(handle.spawn_object(4., 4., "pool"));
        handle.spawn_agent(3., 5., 50.);
        handle
            .sim
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObjectFirst {
                agent: origin.actor,
                object: origin.pool,
                interaction: 0,
            });
        handle.flush_commands();
        for _ in 0..150 {
            if handle
                .sim
                .save_snapshot_v26()
                .pools
                .first()
                .is_some_and(|e| e.phase == phase && e.elapsed == elapsed)
            {
                break;
            }
            handle.tick();
        }
        let current = handle.sim.save_snapshot_v26().pools[0].clone();
        assert_eq!((current.phase, current.elapsed), (phase, elapsed));
        if cancel {
            handle
                .sim
                .world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::CancelIntents {
                    agent: origin.actor,
                });
            handle.flush_commands();
        }
        roundtrip_pool(
            &mut handle,
            &format!("phase {phase}, elapsed {elapsed}, cancel {cancel}"),
        );
    }
}

fn public_pool(start: (f64, f64), facing: terri_core::Facing, directed: bool) -> SimHandle {
    let mut handle = SimHandle::new(12, 12);
    assert!(handle.spawn_object(4., 4., "pool"));
    let pool = terri_sim::placement::object_definition(handle.sim.world(), 0)
        .unwrap()
        .0;
    handle
        .sim
        .world_mut()
        .entity_mut(pool)
        .insert(terri_core::ObjectFacing(facing));
    assert_eq!(handle.object_facing(0.), Some(u32::from(facing.code())));
    handle.spawn_agent(start.0 as f32, start.1 as f32, 50.);
    if directed {
        command(
            &mut handle,
            SimCommand::UseObjectFirst {
                agent: 1,
                object: 0,
                interaction: 0,
            },
        );
    }
    handle
}

fn command(handle: &mut SimHandle, command: SimCommand) {
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(command);
    handle.flush_commands();
}

fn reach(handle: &mut SimHandle, phase: u8, elapsed: u32) {
    for _ in 0..200 {
        if handle
            .sim
            .save_snapshot_v26()
            .pools
            .iter()
            .any(|e| e.actor == 1 && e.phase == phase && e.elapsed == elapsed)
        {
            return;
        }
        handle.tick();
    }
    panic!("Public pool action did not reach phase {phase} at {elapsed}");
}

#[test]
fn pool_codec_exact_approaches_all_facings_and_queued_command_boundaries() {
    for (facing, endpoint) in
        terri_core::Facing::ALL
            .into_iter()
            .zip([(3., 5.), (4., 3.), (6., 4.), (5., 6.)])
    {
        for offset in [0., 0.2] {
            let mut handle = public_pool((endpoint.0 + offset, endpoint.1), facing, true);
            roundtrip_pool(&mut handle, "queued command boundary");
            reach(&mut handle, 1, 4);
            let state = handle.sim.current_v5_view();
            let position = state
                .world
                .entities
                .iter()
                .find(|e| e.agent)
                .unwrap()
                .position
                .unwrap();
            assert_eq!(
                (f64::from(position.x), f64::from(position.y)),
                endpoint,
                "{facing:?}"
            );
            roundtrip_pool(&mut handle, "exact approach");
        }
    }
    let mut approaching = public_pool((1., 1.), terri_core::Facing::SouthEast, true);
    reach(&mut approaching, 0, 0);
    roundtrip_pool(&mut approaching, "live approach");
}

#[test]
fn pool_codec_waiting_shared_approach_survives_the_blocker_completion_tick() {
    let mut handle = public_pool((3., 5.), terri_core::Facing::SouthEast, true);
    assert!(handle.spawn_object(1., 5., "pool"));
    let pool = terri_sim::placement::object_definition(handle.sim.world(), 2)
        .unwrap()
        .0;
    handle
        .sim
        .world_mut()
        .entity_mut(pool)
        .insert(terri_core::ObjectFacing(terri_core::Facing::NorthWest));
    assert_eq!(
        handle.object_facing(2.),
        Some(u32::from(terri_core::Facing::NorthWest.code()))
    );
    handle.spawn_agent(3., 5., 50.);
    command(
        &mut handle,
        SimCommand::UseObjectFirst {
            agent: 3,
            object: 2,
            interaction: 0,
        },
    );
    reach(&mut handle, 1, 0);
    let waiting = handle.sim.current_v5_view();
    assert_eq!(waiting.0.pools.len(), 1);
    let actor = waiting
        .world
        .entities
        .iter()
        .find(|e| e.index == 3)
        .unwrap();
    assert_eq!(actor.target.unwrap().object, 2);
    assert!(actor.path.is_some() && actor.eating.is_none());
    roundtrip_pool(&mut handle, "waiting for another pool's ladder");
    for _ in 0..110 {
        handle.tick();
        if handle.sim.save_snapshot_v26().pools.is_empty() {
            break;
        }
    }
    assert!(handle.sim.save_snapshot_v26().pools.is_empty());
    let waiting = handle.sim.current_v5_view();
    let actor = waiting
        .world
        .entities
        .iter()
        .find(|e| e.index == 3)
        .unwrap();
    assert!(actor.path.is_some() && actor.target.is_some() && actor.eating.is_none());
    roundtrip_pool(&mut handle, "waiting on the exact blocker completion tick");
}

#[test]
fn pool_codec_preserves_exact_orders_without_adopting_a_later_repeated_order() {
    for autonomous in [false, true] {
        let mut handle = public_pool((3., 5.), terri_core::Facing::SouthEast, !autonomous);
        reach(&mut handle, 2, 17);
        command(
            &mut handle,
            SimCommand::UseObjectFirst {
                agent: 1,
                object: 0,
                interaction: 0,
            },
        );
        let paused = handle.save_bytes();
        assert!(handle.load_bytes(&paused));
        assert_eq!(handle.save_bytes(), paused);
        if autonomous {
            assert!(handle
                .sim
                .current_v17_view()
                .player_orders
                .orders
                .iter()
                .all(|o| !o.served));
        }
        handle.tick();
        assert!(handle.sim.save_snapshot_v26().pools[0].interrupted);
        assert!(handle
            .sim
            .current_v17_view()
            .player_orders
            .orders
            .iter()
            .all(|o| !o.served));
        roundtrip_pool(
            &mut handle,
            "new same-pool order waiting behind physical exit",
        );
        let before = handle.save_bytes();
        let mut forged = handle.sim.current_v17_view();
        let order = forged.player_orders.orders.last_mut().unwrap();
        order.served = true;
        order.phase = 3;
        order.active = true;
        order.started = true;
        assert!(
            !handle.load_bytes(&bytes(&CurrentV5View(forged.0))),
            "new order cannot own interrupted exit"
        );
        assert_eq!(handle.save_bytes(), before);
        command(&mut handle, SimCommand::CancelIntents { agent: 1 });
        assert!(handle
            .sim
            .current_v17_view()
            .player_orders
            .orders
            .is_empty());
        roundtrip_pool(
            &mut handle,
            "cancel new waiting order while physical exit continues",
        );
    }
}

#[test]
fn pool_codec_rejects_a_genuine_orphan_reservation() {
    let mut handle = SimHandle::new(12, 12);
    assert!(handle.spawn_object(4., 4., "pool"));
    let before = handle.save_bytes();
    let mut snapshot = handle.sim.current_v5_view();
    snapshot
        .world
        .entities
        .iter_mut()
        .find(|e| e.smart_object.as_deref() == Some("pool"))
        .unwrap()
        .reserved = true;
    assert!(!handle.load_bytes(&bytes(&snapshot)));
    assert_eq!(handle.save_bytes(), before);
}

#[test]
fn pool_codec_rejects_conflicting_active_work_after_owning_generic_validation() {
    let mut handle = exiting_pool();
    handle.spawn_agent(2., 4., 50.);
    let before = handle.save_bytes();
    let baseline = handle.sim.current_v5_view();
    let actor = baseline.0.pools[0].actor;
    let mut accepted = Vec::new();
    for label in ["commuting", "at work", "conversation"] {
        let mut snapshot = baseline.clone();
        let row = snapshot
            .world
            .entities
            .iter_mut()
            .find(|e| e.index == actor)
            .unwrap();
        match label {
            "commuting" => {
                row.commuting = true;
                snapshot.0.commutes = vec![(actor, 0)];
            }
            "at work" => row.at_work_ticks = Some(3),
            "conversation" => {
                row.socialising = Some(terri_core::SavedSocialising {
                    interaction: 0,
                    partner: 2,
                    remaining_ticks: 3,
                })
            }
            _ => unreachable!(),
        }
        if handle.load_bytes(&bytes(&snapshot)) {
            accepted.push(label);
        } else {
            assert_eq!(handle.save_bytes(), before, "{label}");
        }
        assert!(handle.load_bytes(&before));
    }
    assert!(
        accepted.is_empty(),
        "conflicting active work admitted: {accepted:?}"
    );
}
