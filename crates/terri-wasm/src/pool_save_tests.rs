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
            .save_snapshot_v30()
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
fn pool_save_v33_keeps_a_published_v31_single_swimmer_loadable() {
    let mut handle = exiting_pool();
    let current = handle.save_bytes();
    let mut older = SAVE_MAGIC.to_vec();
    older.extend(31u16.to_le_bytes());
    let historical = handle.sim.try_save_snapshot_v31().unwrap();
    older.extend(postcard::to_allocvec(&historical).unwrap());
    assert!(handle.load_bytes(&older));
    assert_eq!(handle.save_bytes(), current);
}

#[test]
fn shared_pool_save_keeps_both_slots_and_refuses_impossible_claims() {
    let mut handle = SimHandle::new(15, 15);
    let definition = handle
        .sim
        .world()
        .resource::<Content>()
        .0
        .find("pool_above_ground_3x4")
        .unwrap();
    let pool = handle
        .sim
        .spawn_object(Position { x: 6., y: 6. }, definition);
    for y in 6..9 {
        for x in 6..10 {
            handle
                .sim
                .world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(x, y, true);
        }
    }
    for y in [7., 8.] {
        let actor = handle.sim.spawn_agent(Position { x: 4., y }, 50.);
        handle
            .sim
            .world_mut()
            .entity_mut(actor)
            .insert(Needs::all_at(50.));
        command(
            &mut handle,
            SimCommand::UseObjectFirst {
                agent: actor.index_u32(),
                object: pool.index_u32(),
                interaction: 0,
            },
        );
    }
    for _ in 0..150 {
        handle.tick();
        let snapshot = handle.sim.save_snapshot_v33();
        if snapshot.pools.len() == 2 && snapshot.pools.iter().all(|e| e.phase % 8 == 2) {
            break;
        }
    }

    let baseline = handle.sim.current_v5_view();
    assert_eq!(baseline.0.pools.len(), 2);
    let mut phases: Vec<_> = baseline.0.pools.iter().map(|row| row.phase).collect();
    phases.sort_unstable();
    assert_eq!(phases, [10, 18]);
    assert!(handle.sim.try_save_snapshot_v31().is_err());
    assert!(handle.sim.try_save_snapshot_v30().is_err());
    roundtrip_pool(&mut handle, "two active Lodge swimmers");

    let baseline = handle.sim.current_v5_view();
    let current = handle.save_bytes();
    let mut older = SAVE_MAGIC.to_vec();
    older.extend(32u16.to_le_bytes());
    older.extend(postcard::to_allocvec(&baseline.0.previous.previous).unwrap());
    assert!(
        handle.load_bytes(&older),
        "published V32 supports shared pools"
    );
    assert_eq!(handle.save_bytes(), current);

    let mut private = older.clone();
    private.extend(postcard::to_allocvec(&baseline.0.hobby_mood).unwrap());
    assert!(
        !handle.load_bytes(&private),
        "private V32 uses exclusive pools"
    );
    older[SAVE_MAGIC.len()..SAVE_HEADER_BYTES].copy_from_slice(&31u16.to_le_bytes());
    assert!(!handle.load_bytes(&older));
    let mut duplicate = baseline.clone();
    duplicate.0.pools[1].phase = duplicate.0.pools[0].phase;
    assert!(!handle.load_bytes(&bytes(&duplicate)));
    let mut excess = baseline.clone();
    excess.0.pools[1].phase = 26;
    assert!(!handle.load_bytes(&bytes(&excess)));

    let mut ladder_overlap = baseline.clone();
    for row in &mut ladder_overlap.0.pools {
        row.phase = row.phase / 8 * 8 + 7;
        row.elapsed = 0;
        row.exit_origin = 0;
    }
    let actors: Vec<_> = ladder_overlap.0.pools.iter().map(|row| row.actor).collect();
    for actor in &mut ladder_overlap.world.entities {
        if actors.contains(&actor.index) {
            actor.eating.as_mut().unwrap().remaining_ticks = 48;
        }
    }
    assert!(!handle.load_bytes(&bytes(&ladder_overlap)));
    assert_eq!(handle.sim.current_v5_view(), baseline);
}

#[test]
fn shared_pool_save_rejects_an_early_or_exhausted_ladder_claim() {
    let mut handle = SimHandle::new(12, 12);
    assert!(handle.spawn_object(4., 4., "pool_above_ground_3x4"));
    for y in 4..7 {
        for x in 4..8 {
            handle
                .sim
                .world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(x, y, true);
        }
    }
    handle.spawn_agent(2., 5., 70.);
    command(
        &mut handle,
        SimCommand::UseObjectFirst {
            agent: 1,
            object: 0,
            interaction: 0,
        },
    );
    reach(&mut handle, 0, 0);

    let baseline = handle.save_bytes();
    let mut saved = handle.sim.current_v5_view();
    assert_eq!(saved.0.pools[0].phase, 8);
    assert_eq!(saved.0.pools[0].approach, (3, 6));
    let actor = &mut saved.world.entities[1];
    let position = actor.position.as_mut().unwrap();
    position.x = 3.;
    position.y = 5.;
    let path = actor.path.as_mut().unwrap();
    path.steps = vec![(3, 5), (3, 6)];
    path.cursor = 1;

    // The ladder edit moves the body onto a stored walk sample. That sample
    // is presentation, so this pool check starts from an empty step list.
    saved.0.walk_steps.clear();
    let mut control = SimHandle::new(12, 12);
    assert!(control.load_bytes(&bytes(&saved)), "final ladder step");
    let mut arrived = saved.clone();
    let actor = &mut arrived.world.entities[1];
    actor.position.as_mut().unwrap().y = 6.;
    actor.path.as_mut().unwrap().cursor = 2;
    assert!(
        control.load_bytes(&bytes(&arrived)),
        "exhausted at the ladder"
    );

    for (cursor, reason) in [
        (0, "early ladder claim"),
        (2, "exhausted away from the ladder"),
    ] {
        saved.world.entities[1].path.as_mut().unwrap().cursor = cursor;
        assert!(!handle.load_bytes(&bytes(&saved)), "{reason}");
        assert_eq!(handle.save_bytes(), baseline, "{reason}");
    }

    let path = saved.world.entities[1].path.as_mut().unwrap();
    path.steps = vec![(3, 6), (3, 5), (3, 6)];
    path.cursor = 0;
    assert!(
        !handle.load_bytes(&bytes(&saved)),
        "loop before the final step"
    );
    assert_eq!(handle.save_bytes(), baseline);
}

#[test]
fn pool_codec_converts_a_legacy_late_retreat_and_keeps_current_hop_strict() {
    let mut handle = exiting_pool();
    let actor = handle.sim.save_snapshot_v30().pools[0].actor;
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents { agent: actor });
    handle.sim.flush_commands();
    let original = handle.save_bytes();
    let mut legacy = handle.sim.current_v5_view();
    let episode = &mut legacy.0.pools[0];
    episode.phase = 4;
    episode.elapsed = 13;
    episode.exit_origin = 0;
    assert!(episode.interrupted);
    legacy
        .world
        .entities
        .iter_mut()
        .find(|row| row.index == actor)
        .unwrap()
        .eating
        .as_mut()
        .unwrap()
        .remaining_ticks = 13;

    let mut old_bytes = bytes(&legacy);
    assert!(
        !handle.load_bytes(&old_bytes),
        "current saves cannot reverse an airborne hop"
    );
    assert_eq!(handle.save_bytes(), original);
    // A schema-28 save has the V30 layout, without remembered topics.
    old_bytes = SAVE_MAGIC.to_vec();
    old_bytes.extend(28u16.to_le_bytes());
    old_bytes.extend(postcard::to_allocvec(&legacy.0.current).unwrap());
    assert!(handle.load_bytes(&old_bytes));
    let migrated = handle.sim.current_v5_view();
    let episode = &migrated.0.pools[0];
    assert_eq!(
        (episode.phase, episode.elapsed, episode.exit_origin),
        (5, 13, 0)
    );
    assert!(episode.interrupted);
    assert_eq!(episode.approach, legacy.0.pools[0].approach);
    let actor = migrated
        .world
        .entities
        .iter()
        .find(|row| row.index == actor)
        .unwrap();
    assert_eq!(actor.eating.as_ref().unwrap().remaining_ticks, 47);

    let current = handle.save_bytes();
    assert!(handle.load_bytes(&current));
    assert_eq!(handle.save_bytes(), current);
    let mut mislabeled = current.clone();
    mislabeled[SAVE_MAGIC.len()..SAVE_HEADER_BYTES].copy_from_slice(&28u16.to_le_bytes());
    assert!(
        !handle.load_bytes(&mislabeled),
        "historical headers forbid the new phase"
    );
    assert_eq!(handle.save_bytes(), current);
}

#[test]
fn pool_codec_migrates_v29_exit_progress_and_rejects_crossed_clocks() {
    let mut handle = exiting_pool();
    for _ in 0..18 {
        handle.tick();
    }
    let current = handle.save_bytes();
    let before = handle.sim.current_v5_view();
    assert_eq!(
        (before.0.pools[0].phase, before.0.pools[0].elapsed),
        (3, 18)
    );
    let old = handle.sim.save_snapshot_v29();
    assert_eq!((old.pools[0].phase, old.pools[0].elapsed), (3, 9));
    let mut historical = SAVE_MAGIC.to_vec();
    historical.extend(29u16.to_le_bytes());
    historical.extend(postcard::to_allocvec(&old).unwrap());
    assert!(handle.load_bytes(&historical));
    assert_eq!(handle.save_bytes(), current);

    let mut mislabeled = current.clone();
    mislabeled[SAVE_MAGIC.len()..SAVE_HEADER_BYTES].copy_from_slice(&29u16.to_le_bytes());
    assert!(!handle.load_bytes(&mislabeled));
    historical[SAVE_MAGIC.len()..SAVE_HEADER_BYTES]
        .copy_from_slice(&SAVE_SCHEMA_VERSION.to_le_bytes());
    assert!(!handle.load_bytes(&historical));
    assert_eq!(handle.save_bytes(), current);
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
    assert_eq!(eating.remaining_ticks, 40);
    eating.remaining_ticks = 39;
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
            .save_snapshot_v30()
            .pools
            .first()
            .is_some_and(|episode| episode.phase > 0)
        {
            break;
        }
    }
    assert_eq!(handle.sim.save_snapshot_v30().pools[0].phase, 1);
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
    let origin = natural.sim.save_snapshot_v30().pools[0].clone();
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
                .save_snapshot_v30()
                .pools
                .first()
                .is_some_and(|e| e.phase == phase && e.elapsed == elapsed)
            {
                break;
            }
            handle.tick();
        }
        let current = handle.sim.save_snapshot_v30().pools[0].clone();
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
            .save_snapshot_v30()
            .pools
            .iter()
            .any(|e| e.actor == 1 && e.phase % 8 == phase && e.elapsed == elapsed)
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
fn rectangular_pool_buys_six_tiles_and_claims_its_ladder_in_every_facing() {
    assert_pool_build_and_swim(
        "pool_rectangular",
        1200,
        [
            (3, 2, (3, 5)),
            (2, 3, (4, 3)),
            (3, 2, (7, 4)),
            (2, 3, (5, 7)),
        ],
    );
}

#[test]
fn above_ground_pool_buys_twelve_tiles_and_claims_its_short_end_ladder_in_every_facing() {
    assert_pool_build_and_swim(
        "pool_above_ground_3x4",
        1500,
        [
            (4, 3, (3, 6)),
            (3, 4, (4, 3)),
            (4, 3, (8, 4)),
            (3, 4, (6, 8)),
        ],
    );
}

#[test]
fn in_ground_pool_buys_thirty_five_tiles_and_claims_its_short_end_ladder_in_every_facing() {
    assert_pool_build_and_swim(
        "pool_in_ground_5x7",
        2400,
        [
            (7, 5, (3, 6)),
            (5, 7, (6, 3)),
            (7, 5, (11, 6)),
            (5, 7, (6, 11)),
        ],
    );
}

fn assert_pool_build_and_swim(
    model_name: &str,
    price: i64,
    dimensions_and_ladder: [(i32, i32, (i32, i32)); 4],
) {
    for (facing, (width, depth, endpoint)) in terri_core::Facing::ALL
        .into_iter()
        .zip(dimensions_and_ladder)
    {
        let lot_side = 12;
        let mut handle = SimHandle::new(lot_side, lot_side);
        let pack = handle.sim.world().resource::<Content>().0;
        let model = pack.find(model_name).unwrap().0;
        handle
            .sim
            .world_mut()
            .insert_resource(terri_core::Funds::from_dollars(price));
        let facing_code = f64::from(facing.code());
        let out_of_bounds = f64::from(terri_sim::placement::PlacementRefusal::OutOfBounds as u32);
        for (x, y) in [
            (lot_side as i32 - width + 1, 4),
            (4, lot_side as i32 - depth + 1),
        ] {
            let outside =
                handle.purchase_preview(f64::from(model), f64::from(x), f64::from(y), facing_code);
            assert_eq!(
                outside[0], out_of_bounds,
                "{model_name} {facing:?} at {x},{y}"
            );
        }
        let preview = handle.purchase_preview(f64::from(model), 4., 4., facing_code);
        assert_eq!(preview[0], 0., "{facing:?}");
        assert_eq!(preview[4..6], [f64::from(width), f64::from(depth)]);
        assert!(handle.buy_object(f64::from(model), 4., 4., facing_code));
        handle.flush_commands();
        let result = handle.last_purchase_result();
        assert_eq!(result[4..], [0, 0], "{facing:?}");
        assert_eq!(handle.funds_cents(), 0.);

        let grid = handle.sim.world().resource::<terri_core::TileGrid>();
        for y in 3..lot_side as i32 {
            for x in 3..lot_side as i32 {
                let in_pool = (4..4 + width).contains(&x) && (4..4 + depth).contains(&y);
                assert_eq!(grid.is_walkable(x, y), !in_pool, "{facing:?} at {x},{y}");
            }
        }

        handle.spawn_agent(1., 1., 70.);
        command(
            &mut handle,
            SimCommand::UseObjectFirst {
                agent: 1,
                object: 0,
                interaction: 0,
            },
        );
        reach(&mut handle, 0, 0);
        let active = handle.sim.save_snapshot_v30();
        assert_eq!(active.pools[0].approach, endpoint, "{facing:?}");
        roundtrip_pool(&mut handle, "ladder approach");
        reach(&mut handle, 2, 3);
        let active = handle.sim.current_v5_view();
        let position = active.world.entities[1].position.unwrap();
        assert_eq!(
            (position.x, position.y),
            (endpoint.0 as f32, endpoint.1 as f32)
        );
        roundtrip_pool(&mut handle, "active swim");
    }
}

#[test]
fn a_pre_rectangle_save_keeps_its_square_pool_and_active_order() {
    let bytes = include_bytes!("../tests/fixtures/pool-v28/square-pool-active-swim.sav");
    assert_eq!(&bytes[8..10], &28u16.to_le_bytes());
    let (source, tail) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV28>(&bytes[SAVE_HEADER_BYTES..])
            .unwrap();
    assert!(tail.is_empty());
    let source = CurrentV5View(terri_core::SaveSnapshotV34 {
        previous: terri_core::SaveSnapshotV33 {
            previous: terri_core::SaveSnapshotV31 {
                current: source,
                topic_memory: vec![],
            },
            hobby_mood: vec![],
        },
        walk_steps: vec![],
    });
    let mut handle = SimHandle::new(12, 12);
    assert!(handle.load_bytes(bytes));

    let active = handle.sim.current_v5_view();
    assert_eq!(active.0.pools, source.0.pools);
    assert_eq!(active.0.pools[0].approach, (3, 5));
    assert_eq!(active.0.pools[0].phase, 2);
    assert_eq!(active.0.pools[0].elapsed, 17);
    assert_eq!(
        active.world.entities[0].smart_object.as_deref(),
        Some("pool")
    );
    assert!(active.world.entities[0].reserved);
    assert_eq!(
        active.world.entities[1].intents,
        source.world.entities[1].intents
    );
    assert_eq!(active.world.blocked_tiles, source.world.blocked_tiles);
    roundtrip_pool(&mut handle, "migrated square pool swim");
}

#[test]
fn queued_legacy_pool_purchases_keep_their_original_model_and_resale_value() {
    for (model_name, width) in [("pool", 2), ("pool_rectangular", 3)] {
        let mut source = SimHandle::new(12, 12);
        let mut previous = source.sim.world().resource::<Content>().0.clone();
        let lodge = previous.find("pool_above_ground_3x4").unwrap();
        previous.objects.truncate(lodge.0 as usize);
        if model_name == "pool" {
            assert_eq!(previous.objects.pop().unwrap().id, "pool_rectangular");
        }
        let previous = &*Box::leak(Box::new(previous));
        let model = previous.find(model_name).unwrap().0;
        assert!(previous.catalogue().any(|(id, _, _)| id.0 == model));
        source.sim = terri_sim::Sim::new_with_lot_and_content(12, 12, Content(previous));
        source
            .sim
            .world_mut()
            .insert_resource(terri_core::Funds::from_dollars(1200));
        assert!(source.buy_object(f64::from(model), 4., 4., 0.));

        let saved = if model_name == "pool" {
            let mut historical = SAVE_MAGIC.to_vec();
            historical.extend(30u16.to_le_bytes());
            historical.extend(postcard::to_allocvec(&source.sim.save_snapshot_v30()).unwrap());
            historical
        } else {
            source.save_bytes()
        };
        let mut handle = SimHandle::new(12, 12);
        assert!(handle.load_bytes(&saved), "queued {model_name}");
        handle.flush_commands();
        assert_eq!(handle.last_purchase_result()[4..], [0, 0]);
        assert_eq!(handle.funds_cents(), 0.);

        let active = handle.sim.current_v5_view();
        assert_eq!(
            active.world.entities[0].smart_object.as_deref(),
            Some(model_name)
        );
        let grid = handle.sim.world().resource::<terri_core::TileGrid>();
        for y in 4..6 {
            for x in 4..4 + width {
                assert!(!grid.is_walkable(x, y));
            }
            assert!(grid.is_walkable(4 + width, y));
        }
        let sale = handle.sale_preview(0.);
        assert_eq!(sale, [0, 600]);
        assert!(handle.sell_object(0.));
        handle.flush_commands();
        assert_eq!(handle.funds_cents(), 60_000.);
    }
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
    for _ in 0..130 {
        handle.tick();
        if handle.sim.save_snapshot_v30().pools.is_empty() {
            break;
        }
    }
    assert!(handle.sim.save_snapshot_v30().pools.is_empty());
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
        assert!(handle.sim.save_snapshot_v30().pools[0].interrupted);
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
