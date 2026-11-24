#[test]
fn pool_has_an_ordinary_single_occupant_hop_in_order() {
    let pack = terri_data::pack();
    let pool = pack.object(pack.find("pool").unwrap());
    let action = pool
        .interactions
        .iter()
        .find(|a| a.label == "Hop in")
        .expect("pool must advertise the ordinary Hop in action");
    assert_eq!(action.slots, 1);
    assert_eq!(action.duration_ticks, 120);
    assert_eq!(action.advertises, vec![(1, -5.), (5, 30.), (6, 10.)]);
}
use super::*;
use terri_core::{
    CommandQueue, Eating, IntentQueue, NeedId, Needs, ObjectFacing, Position, Reserved, SimCommand,
    Target, TileGrid,
};

fn fixture(facing: terri_core::Facing) -> (Sim, Entity, Entity) {
    let mut sim = Sim::new_with_lot(12, 12);
    let pool = sim.spawn_object(
        Position { x: 4., y: 4. },
        terri_data::pack().find("pool").unwrap(),
    );
    sim.world_mut()
        .entity_mut(pool)
        .insert(ObjectFacing(facing));
    for y in 4..6 {
        for x in 4..6 {
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(x, y, true);
        }
    }
    let (x, y) = pool::approach((4, 4), facing);
    let person = sim.spawn_agent(
        Position {
            x: x as f32,
            y: y as f32,
        },
        50.,
    );
    sim.world_mut()
        .entity_mut(person)
        .insert(Needs::all_at(50.));
    (sim, person, pool)
}
fn order(sim: &mut Sim, actor: Entity, object: Entity) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
}
fn entered(sim: &mut Sim, actor: Entity) {
    for _ in 0..100 {
        sim.tick();
        if sim
            .world()
            .get::<pool::PoolEpisode>(actor)
            .is_some_and(|e| e.phase == 1)
        {
            return;
        }
    }
    panic!("ordinary pool order did not enter");
}

#[test]
fn pool_phases_deliver_only_sixty_swim_minutes_and_release_after_exit() {
    let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
    order(&mut sim, actor, object);
    entered(&mut sim, actor);
    assert_eq!(sim.world().get::<Eating>(actor).unwrap().remaining_ticks, 120);
    let initial = sim.world().get::<Needs>(actor).unwrap().clone();
    for _ in 0..20 {
        pool::tick(sim.world_mut());
    }
    assert_eq!(
        sim.world().get::<pool::PoolEpisode>(actor).unwrap().phase,
        2
    );
    assert_eq!(sim.world().get::<Needs>(actor).unwrap(), &initial);
    for _ in 0..60 {
        pool::tick(sim.world_mut());
    }
    let after = sim.world().get::<Needs>(actor).unwrap().clone();
    for (need, delta) in [
        (NeedId::Fun, 30.),
        (NeedId::Comfort, 10.),
        (NeedId::Energy, -5.),
    ] {
        assert!((after.get(need) - initial.get(need) - delta).abs() < 0.001);
    }
    assert!(sim.world().get::<Reserved>(object).is_some());
    assert_eq!(sim.world().get::<Eating>(actor).unwrap().remaining_ticks, 40);
    for _ in 0..39 {
        pool::tick(sim.world_mut());
    }
    assert!(sim.world().get::<Reserved>(object).is_some());
    pool::tick(sim.world_mut());
    assert_eq!(sim.world().get::<Needs>(actor).unwrap(), &after);
    assert!(sim.world().get::<pool::PoolEpisode>(actor).is_none());
    assert!(sim.world().get::<Eating>(actor).is_none());
    assert!(sim.world().get::<Reserved>(object).is_none());
    assert!(sim.world().get::<IntentQueue>(actor).unwrap().is_empty());
}

#[test]
fn pool_checked_legacy_writers_refuse_a_half_exit_step() {
    let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
    order(&mut sim, actor, object);
    entered(&mut sim, actor);
    for _ in 0..(20 + 60 + 38) {
        pool::tick(sim.world_mut());
    }
    assert_eq!(sim.try_save_snapshot_v28().unwrap().pools[0].elapsed, 19);
    assert_eq!(sim.try_save_snapshot_v29().unwrap().pools[0].elapsed, 19);

    pool::tick(sim.world_mut());
    let current = sim.try_save_snapshot_v30().unwrap();
    assert_eq!((current.pools[0].phase, current.pools[0].elapsed), (3, 39));
    assert_eq!(sim.world().get::<Eating>(actor).unwrap().remaining_ticks, 1);
    assert_eq!(sim.try_save_snapshot_v28(), Err(crate::SaveError::InvalidValue));
    assert_eq!(sim.try_save_snapshot_v29(), Err(crate::SaveError::InvalidValue));
    assert_eq!(sim.save_snapshot_v28().pools[0].elapsed, 19);
    assert_eq!(sim.save_snapshot_v29().pools[0].elapsed, 19);
    assert_eq!(sim.try_save_snapshot_v30().unwrap(), current);

    sim.load_snapshot_v30(current.clone()).unwrap();
    assert_eq!(sim.try_save_snapshot_v30().unwrap(), current);
    assert!(sim.world().get::<Reserved>(object).is_some());
    pool::tick(sim.world_mut());
    assert!(sim.world().get::<pool::PoolEpisode>(actor).is_none());
    assert!(sim.world().get::<Reserved>(object).is_none());
}

#[test]
fn pool_cancel_each_phase_keeps_pose_progress_and_physical_owner_but_clears_order_once() {
    for ticks in [7, 35, 85] {
        let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
        order(&mut sim, actor, object);
        entered(&mut sim, actor);
        for _ in 0..ticks {
            pool::tick(sim.world_mut());
        }
        let before = sim.world().get::<pool::PoolEpisode>(actor).unwrap().clone();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents {
                agent: actor.index_u32(),
            });
        sim.flush_commands();
        let after = sim.world().get::<pool::PoolEpisode>(actor).unwrap().clone();
        assert!(after.interrupted);
        if before.phase == 1 {
            assert_eq!(after.phase, 4);
            assert_eq!(after.elapsed, before.elapsed);
        }
        if before.phase == 2 {
            assert_eq!(after.phase, 3);
            assert_eq!(after.exit_origin, before.elapsed);
        }
        if before.phase == 3 {
            assert_eq!(after.elapsed, before.elapsed);
        }
        assert!(sim.world().get::<Reserved>(object).is_some());
        assert!(!crate::player_actions::has_player_work(sim.world(), actor));
        let levels = sim.world().get::<Needs>(actor).unwrap().clone();
        let saved = sim.save_snapshot_v30();
        sim.load_snapshot_v30(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v30(), saved);
        for _ in 0..40 {
            if sim.world().get::<pool::PoolEpisode>(actor).is_some() {
                pool::tick(sim.world_mut());
            }
        }
        assert!(sim.world().get::<pool::PoolEpisode>(actor).is_none());
        assert!(sim.world().get::<Reserved>(object).is_none());
        assert_eq!(sim.world().get::<Needs>(actor).unwrap(), &levels);
    }
}

#[test]
fn pool_cancel_at_takeoff_lands_before_exit_without_swim_rewards() {
    for elapsed in [11, 12, 13] {
        let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
        order(&mut sim, actor, object);
        entered(&mut sim, actor);
        for _ in 0..elapsed {
            pool::tick(sim.world_mut());
        }
        let entry = sim.save_snapshot_v30();
        sim.load_snapshot_v30(entry.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v30(), entry, "entry tick {elapsed}");

        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents {
                agent: actor.index_u32(),
            });
        sim.flush_commands();
        let landing = elapsed >= 12;
        let episode = sim.world().get::<pool::PoolEpisode>(actor).unwrap();
        assert_eq!(episode.phase, if landing { 5 } else { 4 });
        assert_eq!(episode.elapsed, elapsed);
        assert!(episode.interrupted);
        let remaining = if landing { 60 - elapsed } else { elapsed };
        assert_eq!(sim.world().get::<Eating>(actor).unwrap().remaining_ticks, remaining);

        order(&mut sim, actor, object);
        let levels = sim.world().get::<Needs>(actor).unwrap().clone();
        let queued = sim.world().get::<terri_core::IntentQueue>(actor).unwrap().entries().to_vec();
        let satisfaction = |sim: &Sim| {
            sim.world().get::<terri_core::Satisfaction>(actor).map(terri_core::Satisfaction::value)
        };
        let original_satisfaction = satisfaction(&sim);
        let saved = sim.save_snapshot_v30();
        sim.load_snapshot_v30(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v30(), saved, "paused cancellation at {elapsed}");
        if landing {
            let render = sim.render_buffer();
            let row = render.ids.iter().position(|&id| id == actor.index_u32()).unwrap();
            assert_eq!((render.pool_phases[row], render.pool_elapsed[row]), (1, elapsed));
            sim.begin_build().unwrap();
            sim.end_build().unwrap();
            assert_eq!(sim.save_snapshot_v30(), saved);
            sim.begin_admin().unwrap();
            sim.admin_apply(terri_core::admin::AdminChange {
                edits: vec![terri_core::admin::AdminEdit::AdjustFunds { cents: 500 }],
            }).unwrap();
            sim.admin_undo().unwrap();
            sim.end_admin();
            assert_eq!(sim.save_snapshot_v30(), saved);
        }
        for step in 1..=remaining {
            pool::tick(sim.world_mut());
            let episode = sim.world().get::<pool::PoolEpisode>(actor);
            assert_eq!(episode.is_some(), step < remaining);
            assert_eq!(sim.world().get::<Reserved>(object).is_some(), step < remaining);
            if let Some(episode) = episode {
                let total = elapsed + step;
                if !landing {
                    assert_eq!((episode.phase, episode.elapsed), (4, elapsed - step));
                } else if total < 20 {
                    assert_eq!((episode.phase, episode.elapsed), (5, total));
                } else {
                    assert_eq!((episode.phase, episode.elapsed, episode.exit_origin), (3, total - 20, 0));
                }
            }
            assert_eq!(sim.world().get::<Needs>(actor).unwrap(), &levels);
            assert_eq!(satisfaction(&sim), original_satisfaction);
            assert_eq!(sim.world().get::<terri_core::IntentQueue>(actor).unwrap().entries(), queued);
        }
    }
}

#[test]
fn pool_historical_writers_round_trip_a_canceled_landing() {
    let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
    order(&mut sim, actor, object);
    entered(&mut sim, actor);
    for _ in 0..13 {
        pool::tick(sim.world_mut());
    }
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: actor.index_u32(),
        });
    sim.flush_commands();
    order(&mut sim, actor, object);

    let current = sim.save_snapshot_v30();
    assert_eq!((current.pools[0].phase, current.pools[0].elapsed), (5, 13));
    assert_eq!(
        sim.try_save_snapshot_v28(),
        Err(crate::SaveError::InvalidValue)
    );
    for during_build in [false, true] {
        if during_build {
            sim.begin_build().unwrap();
        }
        let v23 = sim.save_snapshot_editable_world_v23();
        let v25 = sim.save_snapshot_v25();
        let v26 = sim.save_snapshot_v26();
        let v28 = sim.save_snapshot_v28();
        let v29 = sim.save_snapshot_v29();
        for rows in [&v23.previous.pools, &v25.pools, &v26.pools, &v28.pools] {
            let mut expected = current.pools.clone();
            expected[0].phase = 4;
            assert_eq!(rows, &expected);
        }
        assert_eq!(v29.pools, current.pools);
        assert_eq!(sim.try_save_snapshot_v29().unwrap(), v29);
        let expected_queue = sim
            .world()
            .get::<terri_core::IntentQueue>(actor)
            .unwrap()
            .entries();
        let assert_resumed = |restored: &Sim| {
            assert_eq!(restored.save_snapshot_v30().pools, current.pools);
            let actor = crate::dining::entity(restored.world(), actor.index_u32()).unwrap();
            let object = crate::dining::entity(restored.world(), object.index_u32()).unwrap();
            assert_eq!(
                restored.world().get::<Eating>(actor).unwrap().remaining_ticks,
                47
            );
            assert_eq!(
                restored.world().get::<terri_core::IntentQueue>(actor).unwrap().entries(),
                expected_queue
            );
            assert!(restored.world().get::<Reserved>(object).is_some());
        };
        let mut restored = Sim::new_with_lot(12, 12);
        restored.load_snapshot_editable_world_v23(v23).unwrap();
        assert_resumed(&restored);
        restored.load_snapshot_v25(v25).unwrap();
        assert_resumed(&restored);
        restored.load_snapshot_v26(v26).unwrap();
        assert_resumed(&restored);
        restored.load_snapshot_v28(v28).unwrap();
        assert_resumed(&restored);
        assert_eq!(restored.save_snapshot_v30(), current);
        restored.load_snapshot_v29(v29).unwrap();
        assert_resumed(&restored);
        assert_eq!(restored.save_snapshot_v30(), current);
        assert_eq!(sim.save_snapshot_v30(), current);
        if during_build {
            sim.end_build().unwrap();
        }
    }
}

#[test]
fn pool_all_facings_preserve_live_continuation_through_save_load_and_build_cancel() {
    for facing in terri_core::Facing::ALL {
        let (mut sim, actor, object) = fixture(facing);
        order(&mut sim, actor, object);
        entered(&mut sim, actor);
        for ticks in [5, 24, 52] {
            for _ in 0..ticks {
                pool::tick(sim.world_mut());
            }
            let before = sim.save_snapshot_v30();
            let hash = sim.world_hash();
            sim.load_snapshot_v30(before.clone()).unwrap();
            assert_eq!(sim.save_snapshot_v30(), before);
            assert_eq!(sim.world_hash(), hash);
        }
        let before = sim.save_snapshot_v30();
        sim.begin_build().unwrap();
        assert_eq!(sim.save_snapshot_v30(), before);
        sim.cancel_build().unwrap();
        assert_eq!(sim.save_snapshot_v30(), before);
    }
}

#[test]
fn pool_projection_keeps_native_previous_phase_through_paused_commands_and_resets_on_load() {
    let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
    order(&mut sim, actor, object);
    entered(&mut sim, actor);
    sim.sync_render_buffer();
    for _ in 0..7 {
        sim.tick();
        sim.sync_render_buffer();
    }
    let row = sim
        .render_buffer()
        .ids
        .iter()
        .position(|id| *id == actor.index_u32())
        .unwrap();
    let current = sim.render_buffer().pool_elapsed[row];
    assert_eq!(sim.render_buffer().prev_pool_phases[row], 1);
    assert_eq!(sim.render_buffer().prev_pool_elapsed[row] + 1, current);
    assert_eq!(
        sim.render_buffer().prev_pool_targets[row],
        object.index_u32()
    );
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: actor.index_u32(),
        });
    sim.flush_commands();
    sim.sync_render_buffer_after_commands();
    assert_eq!(sim.render_buffer().pool_phases[row], 4);
    assert_eq!(sim.render_buffer().pool_elapsed[row], current);
    assert_eq!(sim.render_buffer().prev_pool_phases[row], 1);
    assert_eq!(sim.render_buffer().prev_pool_elapsed[row] + 1, current);
    sim.flush_commands();
    sim.sync_render_buffer_after_commands();
    assert_eq!(sim.render_buffer().prev_pool_phases[row], 1);
    sim.tick();
    sim.sync_render_buffer();
    assert_eq!(sim.render_buffer().prev_pool_phases[row], 4);
    assert_eq!(sim.render_buffer().prev_pool_elapsed[row], current);
    assert_eq!(sim.render_buffer().pool_elapsed[row] + 1, current);
    let saved = sim.save_snapshot_v30();
    sim.load_snapshot_v30(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v30(), saved);
    let render = sim.render_buffer();
    assert_eq!(render.prev_pool_phases, render.pool_phases);
    assert_eq!(render.prev_pool_elapsed, render.pool_elapsed);
    assert_eq!(render.prev_pool_exit_origins, render.pool_exit_origins);
    assert_eq!(render.prev_pool_targets.len(), render.ids.len());
}

#[test]
fn pool_new_order_waits_for_controlled_exit_and_remains_cancelable() {
    let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
    let toilet = sim.spawn_object(
        Position { x: 8., y: 8. },
        terri_data::pack().find("toilet").unwrap(),
    );
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(8, 8, true);
    order(&mut sim, actor, object);
    entered(&mut sim, actor);
    for _ in 0..27 {
        pool::tick(sim.world_mut());
    }
    order(&mut sim, actor, toilet);
    sim.tick();
    assert_eq!(sim.world().get::<Target>(actor).unwrap().object, object);
    assert_eq!(
        sim.world().get::<pool::PoolEpisode>(actor).unwrap().phase,
        3
    );
    assert!(crate::player_actions::has_player_work(sim.world(), actor));
    for _ in 0..41 {
        sim.tick();
    }
    assert!(sim.world().get::<pool::PoolEpisode>(actor).is_none());
    assert_eq!(sim.world().get::<Target>(actor).unwrap().object, toilet);
}

#[test]
fn pool_corrupt_phase_or_owner_is_refused_atomically() {
    let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
    order(&mut sim, actor, object);
    entered(&mut sim, actor);
    let before = sim.save_snapshot_v30();
    for case in 0..6 {
        let mut invalid = before.clone();
        match case {
            0 => invalid.pools[0].phase = 9,
            1 => invalid.pools[0].elapsed = 99,
            2 => invalid.pools[0].pool = actor.index_u32(),
            3 => invalid.pools[0].approach = (0, 0),
            4 => {
                let duplicate = invalid.pools[0].clone();
                invalid.pools.push(duplicate);
            }
            _ => invalid.pools.clear(),
        }
        assert!(sim.load_snapshot_v30(invalid).is_err());
        assert_eq!(sim.save_snapshot_v30(), before);
    }
}

#[test]
fn pool_addition_preserves_pre_pool_v21_household_progress() {
    let mut old_pack = terri_data::pack().clone();
    let pool = old_pack.find("pool").unwrap();
    old_pack.objects[pool.0 as usize].interactions.clear();
    let old_pack = Box::leak(Box::new(old_pack));
    let mut previous = Sim::new_with_lot_and_content(12, 12, Content(old_pack));
    let person = previous.spawn_agent(Position { x: 3., y: 3. }, 37.);
    previous
        .world_mut()
        .entity_mut(person)
        .insert(terri_core::SimName("Pool migration witness".into()));
    let saved = previous.save_snapshot_v21();
    let mut current = Sim::new_with_lot(12, 12);
    current.load_snapshot_v21(saved).unwrap();
    assert_eq!(
        current
            .world()
            .get::<Needs>(person)
            .unwrap()
            .get(NeedId::Hunger),
        37.
    );
    assert_eq!(
        current
            .world()
            .get::<terri_core::SimName>(person)
            .unwrap()
            .0,
        "Pool migration witness"
    );
    let upgraded = current.save_snapshot_v30();
    assert!(upgraded.pools.is_empty());
    current.load_snapshot_v30(upgraded.clone()).unwrap();
    assert_eq!(current.save_snapshot_v30(), upgraded);
}

#[test]
fn pool_autonomy_uses_the_same_phases_and_ordinary_decay_continues() {
    let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
    sim.world_mut()
        .get_mut::<Needs>(actor)
        .unwrap()
        .set(NeedId::Fun, 0.);
    entered(&mut sim, actor);
    assert_eq!(sim.world().get::<Target>(actor).unwrap().object, object);
    assert!(!crate::player_actions::has_player_work(sim.world(), actor));
    let comfort = sim
        .world()
        .get::<Needs>(actor)
        .unwrap()
        .get(NeedId::Comfort);
    for _ in 0..19 {
        sim.tick();
    }
    assert!(
        sim.world()
            .get::<Needs>(actor)
            .unwrap()
            .get(NeedId::Comfort)
            < comfort
    );
    let elapsed = sim.world().get::<pool::PoolEpisode>(actor).unwrap().elapsed;
    sim.flush_commands();
    sim.flush_commands();
    assert_eq!(
        sim.world().get::<pool::PoolEpisode>(actor).unwrap().elapsed,
        elapsed
    );
}

#[test]
fn pool_shared_ladder_waits_and_separate_ladders_can_swim_together() {
    for shared in [true, false] {
        let (mut sim, actor, first) = fixture(terri_core::Facing::SouthEast);
        sim.world_mut().get_mut::<Position>(actor).unwrap().x = 1.;
        let (x, y, facing) = if shared {
            (2, 3, terri_core::Facing::NorthEast)
        } else {
            (8, 7, terri_core::Facing::SouthEast)
        };
        let second = sim.spawn_object(
            Position {
                x: x as f32,
                y: y as f32,
            },
            terri_data::pack().find("pool").unwrap(),
        );
        sim.world_mut()
            .entity_mut(second)
            .insert(ObjectFacing(facing));
        for by in y..y + 2 {
            for bx in x..x + 2 {
                sim.world_mut()
                    .resource_mut::<TileGrid>()
                    .set_blocked(bx, by, true);
            }
        }
        let other = sim.spawn_agent(Position { x: 7., y: 3. }, 50.);
        order(&mut sim, actor, first);
        order(&mut sim, other, second);
        entered(&mut sim, actor);
        let mut overlap = false;
        for _ in 0..90 {
            sim.tick();
            let a = sim
                .world()
                .get::<pool::PoolEpisode>(actor)
                .filter(|p| p.phase > 0);
            let b = sim
                .world()
                .get::<pool::PoolEpisode>(other)
                .filter(|p| p.phase > 0);
            if a.is_some() && b.is_some() {
                overlap = true;
            }
        }
        assert_eq!(overlap, !shared);
        assert!(sim.world().get::<Reserved>(second).is_some());
    }
}

#[test]
fn pool_current_outfit_edit_survives_exit_and_saved_phase() {
    let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
    let original = terri_core::appearance::CharacterAppearanceV1::default();
    sim.world_mut().entity_mut(actor).insert(original.clone());
    order(&mut sim, actor, object);
    entered(&mut sim, actor);
    for _ in 0..25 {
        pool::tick(sim.world_mut());
    }
    let mut edited = original;
    edited.colors.shirt = [183, 24, 92];
    edited.colors.trousers = [21, 80, 155];
    edited.top = "jacket".into();
    sim.world_mut().entity_mut(actor).insert(edited.clone());
    let saved = sim.save_snapshot_v30();
    sim.load_snapshot_v30(saved).unwrap();
    for _ in 0..95 {
        pool::tick(sim.world_mut());
    }
    assert!(sim.world().get::<pool::PoolEpisode>(actor).is_none());
    assert_eq!(
        sim.world()
            .get::<terri_core::appearance::CharacterAppearanceV1>(actor),
        Some(&edited)
    );
}

#[test]
fn pool_lifecycle_loss_releases_fixture_and_approach_without_panicking() {
    for case in 0..6 {
        let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
        order(&mut sim, actor, object);
        entered(&mut sim, actor);
        for _ in 0..25 {
            pool::tick(sim.world_mut());
        }
        sim.sync_render_buffer();
        match case {
            0 => crate::mortality::remove_person(sim.world_mut(), actor),
            1 => {
                sim.world_mut().entity_mut(actor).remove::<Needs>();
                crate::mortality::cleanup(sim.world_mut());
            }
            2 => {
                sim.world_mut().entity_mut(actor).remove::<Eating>();
            }
            3 => {
                sim.world_mut().entity_mut(actor).remove::<Target>();
            }
            4 => {
                sim.world_mut()
                    .entity_mut(object)
                    .remove::<terri_core::SmartObject>();
            }
            _ => {
                sim.world_mut().despawn(actor);
            }
        }
        pool::tick(sim.world_mut());
        sim.sync_render_buffer_after_commands();
        assert!(sim.world().get::<pool::PoolEpisode>(actor).is_none());
        assert!(sim.world().get::<Reserved>(object).is_none());
        if let Some(row) = sim
            .render_buffer()
            .ids
            .iter()
            .position(|id| *id == actor.index_u32())
        {
            assert_eq!(sim.render_buffer().pool_phases[row], 0);
            assert_eq!(
                sim.render_buffer().prev_pool_phases[row],
                0,
                "terminal lifecycle case {case} must snap"
            );
        }
    }
}

#[test]
fn pool_world_replacement_drops_old_episodes_and_projection() {
    let (mut sim, actor, object) = fixture(terri_core::Facing::SouthEast);
    let replacement = sim.save_snapshot_v30();
    order(&mut sim, actor, object);
    entered(&mut sim, actor);
    sim.load_snapshot_v30(replacement.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v30(), replacement);
    assert!(sim.render_buffer().pool_phases.iter().all(|p| *p == 0));
}
