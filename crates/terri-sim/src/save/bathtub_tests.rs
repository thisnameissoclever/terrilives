use super::*;

fn destination() -> &'static ContentPack {
    let mut pack = terri_data::pack().clone();
    let id = pack.find("bathtub").unwrap();
    pack.objects[id.0 as usize].footprint = terri_data::Footprint { width: 1, depth: 2 };
    Box::leak(Box::new(pack))
}

fn restore_without_portals(
    snapshot: SaveSnapshotV1,
    content: &'static ContentPack,
) -> Result<Sim, SaveError> {
    restore(snapshot, content, None)
}

pub(super) fn old_snapshot() -> SaveSnapshotV1 {
    let mut snapshot = Sim::new_from_shipped_lot().save_snapshot();
    snapshot.content_fingerprint = 0xa020_602a_6acd_3a90;
    let width = snapshot.grid_width as usize;
    snapshot.blocked_tiles[9 * width + 15] = true;
    snapshot.blocked_tiles[10 * width + 14] = false;
    snapshot
}

fn agent(snapshot: &mut SaveSnapshotV1) -> &mut SavedEntity {
    snapshot.entities.iter_mut().find(|e| e.agent).unwrap()
}

#[test]
fn bathtub_rotation_changes_only_collision_and_resaves_idempotently() {
    let before = old_snapshot();
    let pack = destination();
    let migrated = restore_without_portals(before.clone(), pack)
        .expect("reviewed old footprint migrates")
        .save_snapshot();
    let mut expected = before;
    let width = expected.grid_width as usize;
    expected.blocked_tiles[9 * width + 15] = false;
    expected.blocked_tiles[10 * width + 14] = true;
    expected.content_fingerprint = terri_data::content_fingerprint(pack);
    assert_eq!(migrated, expected);
    assert!(migrated.blocked_tiles[9 * width + 14]);
    assert_eq!(
        restore_without_portals(migrated.clone(), pack)
            .unwrap()
            .save_snapshot(),
        migrated
    );
}

#[test]
fn public_bathtub_and_portal_migrations_keep_their_distinct_source_shapes() {
    let before_bathtub = old_snapshot();
    assert_eq!(before_bathtub.content_fingerprint, 0xa020_602a_6acd_3a90);
    let pack = destination();
    let after_bathtub = restore_without_portals(before_bathtub, pack)
        .expect("the exact public pre-bathtub source migrates")
        .save_snapshot();
    let mut before_portal = after_bathtub.clone();
    before_portal.content_fingerprint = 0xbcdd_476e_1e23_8ab0;
    let after_portal = restore_without_portals(before_portal, pack)
        .expect("the exact public pre-portal source migrates")
        .save_snapshot();

    assert_eq!(after_bathtub, after_portal);
    assert_eq!(
        after_portal.content_fingerprint,
        terri_data::content_fingerprint(pack)
    );

    let mut unpublished = old_snapshot();
    unpublished.content_fingerprint = 0xd1c8_9f68_9f73_2f30;
    assert!(matches!(
        restore_without_portals(unpublished, pack),
        Err(SaveError::IncompatibleContent)
    ));
}

#[test]
fn bathtub_rotation_relocates_newly_blocked_agent_and_repairs_walking_route() {
    for position in [(14.0, 10.0), (13.0, 10.0), (13.6, 10.0)] {
        let mut before = old_snapshot();
        let a = agent(&mut before);
        a.position = Some(SavedPosition {
            x: position.0,
            y: position.1,
        });
        a.path = Some(SavedPath {
            steps: vec![(14, 10), (15, 10), (15, 11)],
            cursor: 0,
        });
        let after = restore_without_portals(before.clone(), destination())
            .unwrap()
            .save_snapshot();
        let a = after.entities.iter().find(|e| e.agent).unwrap();
        let p = a.position.unwrap();
        assert!(!after.blocked_tiles[p.y as usize * after.grid_width as usize + p.x as usize]);
        assert!(!a.path.as_ref().unwrap().steps.contains(&(14, 10)));
        assert_eq!(a.path.as_ref().unwrap().steps.last(), Some(&(15, 11)));
        let mut expected = before.entities.iter().find(|e| e.agent).unwrap().clone();
        expected.position = a.position;
        expected.path = a.path.clone();
        assert_eq!(*a, expected);
    }
}

#[test]
fn bathtub_rotation_repairs_a_fractional_segment_even_when_its_waypoint_is_clear() {
    let mut before = old_snapshot();
    let partner = before
        .entities
        .iter_mut()
        .find(|e| e.sim_id == Some(1))
        .unwrap();
    partner.position = Some(SavedPosition { x: 15.0, y: 11.0 });
    partner.reserved = true;
    let partner_index = partner.index;
    let a = agent(&mut before);
    a.position = Some(SavedPosition { x: 13.7, y: 10.0 });
    a.path = Some(SavedPath {
        steps: vec![(15, 10)],
        cursor: 0,
    });
    a.target = Some(SavedTarget {
        object: partner_index,
        interaction: 0,
    });
    let after = restore_without_portals(before.clone(), destination())
        .unwrap()
        .save_snapshot();
    let a = after.entities.iter().find(|e| e.agent).unwrap();
    assert_eq!(a.path.as_ref().unwrap().steps.first(), Some(&(13, 10)));
    assert!(!a.path.as_ref().unwrap().steps.contains(&(14, 10)));
    let mut expected = before.entities.iter().find(|e| e.agent).unwrap().clone();
    expected.path = a.path.clone();
    assert_eq!(*a, expected);
}

#[test]
fn bathtub_rotation_keeps_a_fractional_segment_that_misses_the_new_cell() {
    let mut before = old_snapshot();
    let partner = before
        .entities
        .iter_mut()
        .find(|e| e.sim_id == Some(1))
        .unwrap();
    partner.position = Some(SavedPosition { x: 15.0, y: 10.0 });
    partner.reserved = true;
    let partner_index = partner.index;
    let a = agent(&mut before);
    a.position = Some(SavedPosition { x: 13.7, y: 11.0 });
    a.path = Some(SavedPath {
        steps: vec![(15, 11)],
        cursor: 0,
    });
    a.target = Some(SavedTarget {
        object: partner_index,
        interaction: 0,
    });
    let after = restore_without_portals(before.clone(), destination())
        .unwrap()
        .save_snapshot();
    assert_eq!(after.entities, before.entities);
}

#[test]
fn bathtub_rotation_preserves_active_bath_timers_and_only_moves_nonadjacent_users() {
    for (position, must_move) in [
        ((15.0, 9.0), false),
        ((15.0, 10.0), false),
        ((15.0, 8.0), true),
    ] {
        let mut before = old_snapshot();
        let tub = before
            .entities
            .iter_mut()
            .find(|e| e.smart_object.as_deref() == Some("bathtub"))
            .unwrap();
        tub.reserved = true;
        let tub_index = tub.index;
        let a = agent(&mut before);
        a.position = Some(SavedPosition {
            x: position.0,
            y: position.1,
        });
        a.target = Some(SavedTarget {
            object: tub_index,
            interaction: 0,
        });
        a.eating = Some(SavedEating {
            object: "bathtub".into(),
            interaction: 0,
            remaining_ticks: 47,
        });
        let after = restore_without_portals(before.clone(), destination())
            .unwrap()
            .save_snapshot();
        let a = after.entities.iter().find(|e| e.agent).unwrap();
        assert_eq!(a.position != agent(&mut before).position, must_move);
        let mut expected = agent(&mut before).clone();
        expected.position = a.position;
        assert_eq!(*a, expected);
        assert!(
            after
                .entities
                .iter()
                .find(|e| e.index == tub_index)
                .unwrap()
                .reserved
        );
    }
}

#[test]
fn bathtub_rotation_rejects_source_corruption_and_unreviewed_destination() {
    let mut bad = old_snapshot();
    agent(&mut bad).needs = Some([f32::NAN; terri_core::NEED_COUNT]);
    assert!(matches!(
        restore_without_portals(bad, destination()),
        Err(SaveError::InvalidValue)
    ));
    let mut changed = destination().clone();
    changed.objects[0].footprint.width += 1;
    assert!(matches!(
        restore_without_portals(old_snapshot(), Box::leak(Box::new(changed))),
        Err(SaveError::IncompatibleContent)
    ));
}

#[test]
fn bathtub_rotation_rejects_collision_conflicts_without_changing_live_world() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.world.insert_resource(Content(destination()));
    let live = sim.save_snapshot();
    let mut source = old_snapshot();
    source.blocked_tiles[10 * source.grid_width as usize + 14] = true;
    assert_eq!(sim.load_snapshot(source), Err(SaveError::InvalidGrid));
    assert_eq!(sim.save_snapshot(), live);
}

#[test]
fn bathtub_rotation_repairs_a_targeted_walk_to_the_old_far_edge() {
    let mut before = old_snapshot();
    let tub = before
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("bathtub"))
        .unwrap()
        .index;
    let a = agent(&mut before);
    a.position = Some(SavedPosition { x: 15.0, y: 8.0 });
    a.path = Some(SavedPath {
        steps: vec![],
        cursor: 0,
    });
    a.target = Some(SavedTarget {
        object: tub,
        interaction: 0,
    });
    let after = restore_without_portals(before, destination())
        .unwrap()
        .save_snapshot();
    let a = after.entities.iter().find(|e| e.agent).unwrap();
    assert!(matches!(
        a.path.as_ref().unwrap().steps.last(),
        Some(&(14, 8)) | Some(&(15, 9))
    ));
    assert_eq!(
        a.target,
        Some(SavedTarget {
            object: tub,
            interaction: 0
        })
    );
    assert_eq!(a.position, Some(SavedPosition { x: 15.0, y: 8.0 }));
}

#[test]
fn bathtub_rotation_rejects_additional_or_out_of_bounds_instances_transactionally() {
    let mut before = old_snapshot();
    let mut second = before
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("bathtub"))
        .unwrap()
        .clone();
    second.index = before.entities.last().unwrap().index + 1;
    second.position = Some(SavedPosition { x: 1.0, y: 1.0 });
    before.entities.push(second);
    let width = before.grid_width as usize;
    before.blocked_tiles[width + 1] = true;
    before.blocked_tiles[width + 2] = true;
    before.blocked_tiles[2 * width + 1] = false;
    assert_layout_rejected(before.clone());
    before.entities.last_mut().unwrap().position = Some(SavedPosition {
        x: 1.0,
        y: (before.grid_height - 1) as f32,
    });
    assert_layout_rejected(before);
}

#[test]
fn bathtub_rotation_rejects_fractional_custom_furniture_transactionally() {
    let mut before = old_snapshot();
    for entity in before
        .entities
        .iter_mut()
        .filter(|e| e.smart_object.is_some())
    {
        let p = entity.position.as_mut().unwrap();
        p.x += 0.25;
        p.y += 0.125;
    }
    assert_layout_rejected(before);
}

#[test]
fn bathtub_rotation_leaves_a_still_valid_bath_walk_unchanged() {
    let mut before = old_snapshot();
    let tub = before
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("bathtub"))
        .unwrap()
        .index;
    let a = agent(&mut before);
    a.position = Some(SavedPosition { x: 14.0, y: 11.0 });
    a.target = Some(SavedTarget {
        object: tub,
        interaction: 0,
    });
    a.path = Some(SavedPath {
        steps: vec![(14, 11), (15, 11), (15, 10)],
        cursor: 1,
    });
    let after = restore_without_portals(before.clone(), destination())
        .unwrap()
        .save_snapshot();
    assert_eq!(after.entities, before.entities);
}

#[test]
fn bathtub_rotation_rejects_a_malformed_source_path_instead_of_repairing_it() {
    for steps in [
        vec![(-1, 10), (14, 10), (15, 10)],
        vec![(13, 8), (14, 10), (15, 10)],
    ] {
        let mut source = old_snapshot();
        let a = agent(&mut source);
        a.position = Some(SavedPosition { x: 13.0, y: 10.0 });
        a.path = Some(SavedPath { steps, cursor: 0 });
        assert!(matches!(
            restore_without_portals(source, destination()),
            Err(SaveError::InvalidGrid)
        ));
    }
}

#[test]
fn bathtub_rotation_preserves_an_active_conversation_and_stationary_partner() {
    for affected_initiator in [true, false] {
        for partner_x in [13.0, 15.0] {
            let mut before = old_snapshot();
            let indices: Vec<_> = before
                .entities
                .iter()
                .filter(|e| e.agent)
                .map(|e| e.index)
                .collect();
            let initiator = if affected_initiator {
                indices[0]
            } else {
                indices[1]
            };
            let passive = if affected_initiator {
                indices[1]
            } else {
                indices[0]
            };
            for (index, x) in [(indices[0], 14.0), (indices[1], partner_x)] {
                let e = before
                    .entities
                    .iter_mut()
                    .find(|e| e.index == index)
                    .unwrap();
                e.position = Some(SavedPosition { x, y: 10.0 });
                if index == initiator {
                    e.socialising = Some(SavedSocialising {
                        interaction: 0,
                        partner: passive,
                        remaining_ticks: 47,
                    });
                    e.conversation_voice = Some(SavedConversationVoice {
                        first: 0,
                        second: 1,
                    });
                    e.target = Some(SavedTarget {
                        object: passive,
                        interaction: 0,
                    });
                } else {
                    e.reserved = true;
                }
            }
            let mut after = restore_without_portals(before.clone(), destination())
                .unwrap()
                .save_snapshot();
            let moved = after
                .entities
                .iter_mut()
                .find(|e| e.index == indices[0])
                .unwrap();
            let p = moved.position.unwrap();
            assert_eq!((p.x - partner_x).abs() + (p.y - 10.0).abs(), 1.0);
            assert_ne!(p, SavedPosition { x: 14.0, y: 10.0 });
            moved.position = Some(SavedPosition { x: 14.0, y: 10.0 });
            assert_eq!(after.entities, before.entities);
        }
    }
}

#[test]
fn bathtub_rotation_rejects_a_custom_active_object_layout_transactionally() {
    let mut before = old_snapshot();
    let sink = before
        .entities
        .iter_mut()
        .find(|e| e.smart_object.as_deref() == Some("sink"))
        .unwrap();
    sink.position = Some(SavedPosition { x: 13.0, y: 10.0 });
    sink.reserved = true;
    let index = sink.index;
    let width = before.grid_width as usize;
    before.blocked_tiles[10 * width + 12] = false;
    before.blocked_tiles[10 * width + 13] = true;
    let a = agent(&mut before);
    a.position = Some(SavedPosition { x: 14.0, y: 10.0 });
    a.target = Some(SavedTarget {
        object: index,
        interaction: 0,
    });
    a.eating = Some(SavedEating {
        object: "sink".into(),
        interaction: 0,
        remaining_ticks: 39,
    });
    assert_layout_rejected(before);
}

#[test]
fn bathtub_rotation_loads_sampled_real_source_world_states() {
    let mut source_pack = destination().clone();
    let tub = source_pack.find("bathtub").unwrap();
    source_pack.objects[tub.0 as usize].footprint = terri_data::Footprint { width: 2, depth: 1 };
    source_pack.portals.clear();
    assert_eq!(
        terri_data::content_fingerprint(&source_pack),
        0xa020_602a_6acd_3a90
    );
    let source_pack = Box::leak(Box::new(source_pack));
    let mut source = Sim::new_from_lot(&source_pack.lot, &source_pack.objects);
    source.world.insert_resource(Content(source_pack));
    source.spawn_household(
        &source_pack.personalities,
        &source_pack.household,
        &source_pack.traits,
    );
    let pack = destination();
    let mut samples = 0;
    for tick in 0..2_000 {
        source.tick();
        if tick % 10 == 0 {
            let before = source.save_snapshot();
            let mut restored = restore_without_portals(before.clone(), pack)
                .unwrap_or_else(|error| panic!("source tick {tick}: {error:?}"));
            let mut after = restored.save_snapshot();
            for (current, previous) in after.entities.iter_mut().zip(&before.entities) {
                current.position = previous.position;
                current.path = previous.path.clone();
            }
            assert_eq!(after.entities, before.entities);
            assert_eq!(after.rng, before.rng);
            assert_eq!(after.tick, before.tick);
            assert_eq!(after.funds, before.funds);
            restored.tick();
            samples += 1;
        }
    }
    assert_eq!(samples, 200);
}

#[test]
fn bathtub_rotation_rejects_both_shared_wall_and_open_custom_layouts() {
    let mut source = old_snapshot();
    let mut tub = source
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("bathtub"))
        .unwrap()
        .clone();
    tub.index = source.entities.last().unwrap().index + 1;
    tub.position = Some(SavedPosition { x: 4.0, y: 5.0 });
    source.entities.push(tub);
    assert_layout_rejected(source.clone());

    // Matching dimensions cannot establish the old bitmap's ownership.
    let width = source.grid_width as usize;
    for &(x, y) in &terri_data::pack().lot.walls {
        source.blocked_tiles[y as usize * width + x as usize] = false;
    }
    source.blocked_tiles[5 * width + 4] = true;
    source.blocked_tiles[5 * width + 5] = true;
    assert_layout_rejected(source);
}

fn assert_layout_rejected(snapshot: SaveSnapshotV1) {
    let mut live = Sim::new_from_shipped_lot();
    live.world.insert_resource(Content(destination()));
    let before = live.save_snapshot();
    assert_eq!(live.load_snapshot(snapshot), Err(SaveError::InvalidGrid));
    assert_eq!(live.save_snapshot(), before);
}

#[test]
fn bathtub_rotation_rejects_even_one_unreviewed_collision_bit() {
    let mut source = old_snapshot();
    let width = source.grid_width as usize;
    source.blocked_tiles[8 * width + 8] = !source.blocked_tiles[8 * width + 8];
    assert_layout_rejected(source);
}

#[test]
fn bathtub_rotation_source_layout_is_frozen_independently_of_destination_lot() {
    let source = old_snapshot();
    let mut changed = destination().clone();
    changed.lot.walls.clear();
    changed.lot.placements.clear();
    let after = restore_without_portals(source.clone(), Box::leak(Box::new(changed)))
        .unwrap()
        .save_snapshot();
    assert_eq!(after.entities, source.entities);
    let width = after.grid_width as usize;
    assert!(
        after.blocked_tiles[5 * width + 5],
        "saved original wall survives changed destination lot"
    );
    assert!(!after.blocked_tiles[9 * width + 15]);
    assert!(after.blocked_tiles[10 * width + 14]);
}

#[test]
fn bathtub_rotation_preserves_permuted_entity_slots_holes_and_reservations() {
    let mut source = old_snapshot();
    for entity in &mut source.entities {
        entity.index += 2;
    }
    source.entities[0].index = 3;
    source.entities[1].index = 2;
    source.entities.sort_by_key(|entity| entity.index);
    source
        .entities
        .iter_mut()
        .find(|e| e.smart_object.as_deref() == Some("bathtub"))
        .unwrap()
        .reserved = true;
    let after = restore_without_portals(source.clone(), destination())
        .unwrap()
        .save_snapshot();
    assert_eq!(after.entities, source.entities);
    assert_eq!(after.issued_sim_ids, source.issued_sim_ids);
}

#[test]
fn current_digest_custom_layouts_do_not_enter_bathtub_migration() {
    let mut source = Sim::new_from_shipped_lot().save_snapshot();
    let radio = source
        .entities
        .iter_mut()
        .find(|e| e.smart_object.as_deref() == Some("radio"))
        .unwrap();
    radio.position.as_mut().unwrap().x += 0.25;
    source.blocked_tiles[8 * source.grid_width as usize + 8] = true;
    assert_eq!(
        restore_without_portals(source.clone(), destination())
            .unwrap()
            .save_snapshot(),
        source
    );
}
