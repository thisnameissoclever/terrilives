//! Explicit historical logical states complement the frozen old-producer byte controls.
use super::*;
use crate::{save, SaveError, Sim};
use terri_core::{Reserved, SimRng, TileGrid};

fn old_endpoint(facing: terri_core::Facing) -> (i32, i32) {
    let offset = match facing {
        terri_core::Facing::SouthEast => (-1, 0),
        terri_core::Facing::SouthWest => (0, 2),
        terri_core::Facing::NorthWest => (2, 1),
        terri_core::Facing::NorthEast => (1, -1),
    };
    (4 + offset.0, 4 + offset.1)
}

fn current_square_endpoint(facing: terri_core::Facing) -> (i32, i32) {
    [(3, 5), (4, 3), (6, 4), (5, 6)][usize::from(facing.code())]
}

fn fixture(
    facing: terri_core::Facing,
    phase: u8,
    elapsed: u32,
    interrupted: bool,
) -> (Sim, Entity, Entity) {
    let mut sim = Sim::new_with_lot(12, 12);
    let definition = terri_data::pack().find("pool").unwrap();
    let pool = sim.spawn_object(Position { x: 4., y: 4. }, definition);
    sim.world_mut()
        .entity_mut(pool)
        .insert((ObjectFacing(facing), Reserved));
    for y in 4..6 {
        for x in 4..6 {
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(x, y, true);
        }
    }
    let end = old_endpoint(facing);
    let at = if phase == 0 {
        Position { x: 1.25, y: 2. }
    } else {
        Position {
            x: end.0 as f32,
            y: end.1 as f32,
        }
    };
    let actor = sim.spawn_agent(at, 50.);
    let episode = PoolEpisode {
        pool,
        phase,
        elapsed,
        exit_origin: if phase == 3 {
            if interrupted {
                23
            } else {
                60
            }
        } else {
            0
        },
        interrupted,
        approach: end,
    };
    sim.world_mut().entity_mut(actor).insert((
        Target {
            object: pool,
            interaction: 0,
        },
        episode.clone(),
    ));
    if phase == 0 {
        let route = crate::beds::navigation::Route::Exact(end);
        let grid = sim.world().resource::<TileGrid>();
        let steps = route
            .path(grid, (at.x.round() as i32, at.y.round() as i32))
            .and_then(|steps| route.bind_path(grid, (at.x, at.y), steps))
            .unwrap();
        sim.world_mut()
            .entity_mut(actor)
            .insert(Path { steps, cursor: 0 });
    } else {
        sim.world_mut().entity_mut(actor).insert(Eating {
            object: definition,
            interaction: 0,
            remaining_ticks: countdown(phase, elapsed, LEGACY_EXIT_TICKS).unwrap(),
        });
    }
    (sim, actor, pool)
}

fn snapshot(source: &Sim) -> terri_core::LegacyEditableWorldSnapshotV22 {
    save::editable_v22::capture_current_layer(source)
}
fn assert_old_source(source: &Sim, snapshot: &terri_core::LegacyEditableWorldSnapshotV22) {
    let mut restored = save::editable_v21::restore(
        snapshot.previous.clone(),
        source.world().resource::<Content>().0,
        save::Carried::for_load(source.world()),
    )
    .expect("historical base must be independently valid");
    restore_historical_v22(restored.world_mut(), snapshot.pools.clone())
        .expect("historical endpoint contract must admit the source");
}
fn restored(source: &Sim, snapshot: terri_core::LegacyEditableWorldSnapshotV22) -> Result<Sim, SaveError> {
    save::editable_v22::restore(
        snapshot,
        source.world().resource::<Content>().0,
        save::Carried::for_load(source.world()),
    )
}
fn source_entity(sim: &Sim, index: u32) -> Entity {
    crate::dining::entity(sim.world(), index).unwrap()
}

#[test]
fn historical_all_facings_and_phases_preserve_progress_and_randomness() {
    for facing in terri_core::Facing::ALL {
        for (phase, elapsed, interrupted) in [
            (0, 0, false),
            (1, 7, false),
            (2, 19, false),
            (3, 8, false),
            (3, 5, true),
            (4, 6, true),
        ] {
            let (source, actor, _) = fixture(facing, phase, elapsed, interrupted);
            let old = snapshot(&source);
            assert_old_source(&source, &old);
            let before = source.world().get::<PoolEpisode>(actor).unwrap().clone();
            let point = *source.world().get::<Position>(actor).unwrap();
            let needs = source.world().get::<Needs>(actor).unwrap().clone();
            let random = source.world().resource::<SimRng>().clone();
            let current = restored(&source, old).unwrap();
            let actor = source_entity(&current, actor.index_u32());
            let episode = current.world().get::<PoolEpisode>(actor).unwrap();
            assert_eq!(
                (
                    episode.phase,
                    episode.elapsed,
                    episode.exit_origin,
                    episode.interrupted
                ),
                (
                    before.phase,
                    if phase == 3 { before.elapsed * 2 } else { before.elapsed },
                    before.exit_origin,
                    before.interrupted
                )
            );
            assert_eq!(episode.approach, current_square_endpoint(facing));
            assert_eq!(current.world().resource::<SimRng>(), &random);
            assert_eq!(current.world().get::<Needs>(actor).unwrap(), &needs);
            if phase == 0 {
                assert_eq!(*current.world().get::<Position>(actor).unwrap(), point);
                let path = current.world().get::<Path>(actor).unwrap();
                assert_eq!(path.cursor, 0);
                assert_eq!(path.steps.last().copied(), Some(episode.approach));
            } else {
                assert_eq!(
                    *current.world().get::<Position>(actor).unwrap(),
                    Position {
                        x: episode.approach.0 as f32,
                        y: episode.approach.1 as f32
                    }
                );
                assert_eq!(
                    current
                        .world()
                        .get::<Eating>(actor)
                        .unwrap()
                        .remaining_ticks,
                    remaining(episode)
                );
            }
        }
    }
}

#[test]
fn fractional_rounding_exhausted_paths_and_rowless_waiters_keep_their_positions() {
    for facing in terri_core::Facing::ALL {
        for kind in 0..4 {
            let (mut source, actor, _) = fixture(facing, 0, 0, false);
            let old = old_endpoint(facing);
            let new = current_square_endpoint(facing);
            let at = match kind {
                0 => Position {
                    x: old.0 as f32,
                    y: old.1 as f32,
                },
                1 => {
                    let direction = if new.0 < 4 {
                        (-1., 0.)
                    } else if new.0 >= 6 {
                        (1., 0.)
                    } else if new.1 < 4 {
                        (0., -1.)
                    } else {
                        (0., 1.)
                    };
                    Position {
                        x: new.0 as f32 + direction.0 * 0.125,
                        y: new.1 as f32 + direction.1 * 0.125,
                    }
                }
                _ => Position { x: 1.25, y: 2. },
            };
            source.world_mut().entity_mut(actor).insert(at);
            let route = crate::beds::navigation::Route::Exact(old);
            let grid = source.world().resource::<TileGrid>();
            let mut steps = route
                .path(grid, (at.x.round() as i32, at.y.round() as i32))
                .and_then(|steps| route.bind_path(grid, (at.x, at.y), steps))
                .unwrap();
            let mut cursor = 0;
            if kind == 2 {
                assert!(steps.len() > 1);
                cursor = 1;
                let p = Position {
                    x: (steps[0].0 + steps[1].0) as f32 / 2.,
                    y: (steps[0].1 + steps[1].1) as f32 / 2.,
                };
                source.world_mut().entity_mut(actor).insert(p);
            }
            if kind == 0 {
                steps.clear();
            }
            source
                .world_mut()
                .entity_mut(actor)
                .insert(Path { steps, cursor });
            if kind == 3 {
                source.world_mut().entity_mut(actor).remove::<PoolEpisode>();
            }
            let at = *source.world().get::<Position>(actor).unwrap();
            let old = snapshot(&source);
            assert_old_source(&source, &old);
            let current = restored(&source, old).unwrap();
            let actor = source_entity(&current, actor.index_u32());
            assert_eq!(*current.world().get::<Position>(actor).unwrap(), at);
            let path = current.world().get::<Path>(actor).unwrap();
            assert_eq!(path.cursor, 0);
            assert_eq!(path.steps.last().copied(), Some(new));
            assert_eq!(
                current.world().get::<PoolEpisode>(actor).is_none(),
                kind == 3
            );
        }
    }
}

#[test]
fn a_new_anchor_blocked_by_furniture_or_a_physical_person_refuses_without_changing_live_state() {
    for kind in 0..2 {
        let facing = terri_core::Facing::SouthEast;
        let (mut source, _, _) = fixture(facing, 2, 11, false);
        let end = current_square_endpoint(facing);
        if kind == 0 {
            source.spawn_object(
                Position {
                    x: end.0 as f32,
                    y: end.1 as f32,
                },
                terri_data::pack().find("chair").unwrap(),
            );
            source.world_mut().resource_mut::<TileGrid>().set_blocked(
                end.0 as usize,
                end.1 as usize,
                true,
            );
        } else {
            source.spawn_agent(
                Position {
                    x: end.0 as f32,
                    y: end.1 as f32,
                },
                50.,
            );
        }
        let old = snapshot(&source);
        assert_old_source(&source, &old);
        let mut live = Sim::new_with_lot(12, 12);
        let before = live.save_snapshot_editable_world_v23();
        let hash = live.world_hash();
        assert!(live.load_snapshot_editable_world_v22(old).is_err());
        assert!(live.save_snapshot_editable_world_v23() == before);
        assert_eq!(live.world_hash(), hash);
    }
}

#[test]
fn approaching_a_temporarily_occupied_destination_keeps_a_waitable_route() {
    let facing = terri_core::Facing::SouthEast;
    let (mut source, actor, _) = fixture(facing, 0, 0, false);
    let end = current_square_endpoint(facing);
    source.spawn_agent(
        Position {
            x: end.0 as f32,
            y: end.1 as f32,
        },
        50.,
    );
    let at = *source.world().get::<Position>(actor).unwrap();
    let old = snapshot(&source);
    assert_old_source(&source, &old);
    let current = restored(&source, old).unwrap();
    let actor = source_entity(&current, actor.index_u32());
    assert_eq!(*current.world().get::<Position>(actor).unwrap(), at);
    assert_eq!(
        current
            .world()
            .get::<Path>(actor)
            .unwrap()
            .steps
            .last()
            .copied(),
        Some(end)
    );
}

#[test]
fn historical_projection_refuses_pool_activity_including_rowless_targets() {
    let mut idle = Sim::new_with_lot(12, 12);
    idle.spawn_object(
        Position { x: 4., y: 4. },
        terri_data::pack().find("pool").unwrap(),
    );
    assert!(idle.try_save_snapshot_editable_world_v22().is_ok());
    for phase in [0, 1, 2, 3, 4] {
        let (source, actor, _) = fixture(
            terri_core::Facing::SouthEast,
            phase,
            if phase == 0 { 0 } else { 7 },
            phase == 4,
        );
        let mut current = restored(&source, snapshot(&source)).unwrap();
        assert!(current.try_save_snapshot_editable_world_v22().is_err());
        if phase == 0 {
            let actor = source_entity(&current, actor.index_u32());
            current
                .world_mut()
                .entity_mut(actor)
                .remove::<PoolEpisode>();
            assert!(current.try_save_snapshot_editable_world_v22().is_err());
        }
    }
}
