use super::*;
use terri_core::{Facing, ObjectFacing, Position};

#[test]
fn every_authored_object_keeps_the_pre_builder_release_render_geometry() {
    // Captured from the preceding release WASM, before this implementation.
    let expected: &[(u32, f32, f32, u32, u32, u32, u32)] = &[
        (0, 0.0, 0.0, 1, 1, 1091, 4294967295),
        (1, 1.0, 0.0, 1, 1, 1099, 4294967295),
        (2, 2.0, 0.0, 1, 1, 1095, 4294967295),
        (3, 3.0, 0.0, 1, 1, 1099, 4294967295),
        (4, 4.0, 0.0, 1, 1, 1103, 4294967295),
        (5, 5.0, 0.0, 1, 1, 1099, 4294967295),
        (6, 6.0, 0.0, 1, 1, 18, 4294967295),
        (7, 2.5, 3.0, 2, 1, 16, 4294967295),
        (8, 1.0, 3.0, 1, 1, 258, 4294967295),
        (9, 4.0, 3.0, 1, 1, 256, 4294967295),
        (10, 8.0, 0.0, 1, 1, 8, 4294967295),
        (11, 10.5, 0.0, 2, 1, 19, 4294967295),
        (12, 13.0, 0.0, 1, 1, 20, 360),
        (13, 15.0, 0.0, 1, 1, 23, 4294967295),
        (14, 15.0, 1.0, 1, 1, 26, 4294967295),
        (15, 14.0, 2.0, 1, 1, 25, 4294967295),
        (16, 8.0, 3.0, 1, 1, 22, 4294967295),
        (17, 10.0, 3.0, 1, 1, 10, 4294967295),
        (18, 12.0, 3.0, 1, 1, 9, 4294967295),
        (19, 0.5, 6.5, 2, 2, 1133, 4294967295),
        (20, 2.0, 6.0, 1, 1, 1127, 4294967295),
        (21, 0.0, 10.0, 1, 1, 1129, 4294967295),
        (22, 4.0, 11.0, 1, 1, 849, 4294967295),
        (23, 6.5, 6.0, 2, 1, 1215, 4294967295),
        (24, 6.0, 7.0, 1, 1, 299, 4294967295),
        (25, 9.5, 6.0, 2, 1, 1137, 4294967295),
        (26, 9.0, 9.0, 1, 1, 853, 4294967295),
        (27, 6.0, 10.0, 1, 1, 32, 4294967295),
        (28, 10.0, 11.0, 1, 1, 23, 4294967295),
        (29, 12.0, 6.0, 1, 1, 1109, 4294967295),
        (30, 14.0, 6.0, 1, 1, 1113, 4294967295),
        (31, 14.0, 9.5, 1, 2, 1123, 4294967295),
        (32, 12.0, 10.0, 1, 1, 1105, 4294967295),
        (33, 12.0, 11.0, 1, 1, 1117, 4294967295),
    ];
    assert_eq!(expected.len(), 34);
    let mut sim = Sim::new_from_shipped_lot();
    sim.sync_render_buffer();
    let render = sim.render_buffer();
    for &(id, x, y, width, depth, sprite, foreground) in expected {
        let row = render.ids.iter().position(|&value| value == id).unwrap();
        assert_eq!(
            (render.positions[row * 2], render.positions[row * 2 + 1]),
            (x, y)
        );
        assert_eq!(
            (render.footprint_widths[row], render.footprint_depths[row]),
            (width, depth)
        );
        assert_eq!(
            (render.sprites[row], render.foreground_sprites[row]),
            (sprite, foreground)
        );
    }
}

#[test]
fn facing_suffix_rejects_duplicate_non_object_missing_and_invalid_entries_without_a_swap() {
    let pack = terri_data::pack();
    let source = Sim::new_from_shipped_lot();
    let valid = source.save_snapshot_v3();
    let object = valid
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.is_some())
        .unwrap()
        .index;
    let agent = valid.world.entities.iter().find(|e| e.agent).unwrap().index;
    for entries in [
        vec![(object, 0), (object, 1)],
        vec![(agent, 0)],
        vec![(9999, 0)],
        vec![(object, 4)],
        vec![(object, 255)],
    ] {
        let mut snapshot = valid.clone();
        snapshot.object_facings = entries;
        let mut live = Sim::new_from_shipped_lot();
        live.tick();
        let before = live.save_snapshot_v3();
        assert!(live.load_snapshot_v3(snapshot).is_err());
        assert_eq!(live.save_snapshot_v3(), before);
    }
    let mut restricted = pack.clone();
    let id = restricted.find("fridge").unwrap();
    restricted.objects[id.0 as usize].facing_sprites.0[Facing::NorthEast.code() as usize] = None;
    let restricted = Box::leak(Box::new(restricted));
    let mut live = test_content::sim_with(16, 16, restricted);
    let before = live.save_snapshot_v3();
    let mut snapshot = valid;
    snapshot.object_facings = vec![(object, Facing::NorthEast.code())];
    assert_eq!(
        live.load_snapshot_v3(snapshot),
        Err(SaveError::InvalidValue)
    );
    assert_eq!(live.save_snapshot_v3(), before);
}

#[test]
fn facing_roundtrip_keeps_explicit_turn_and_rotated_socket() {
    let pack = terri_data::pack();
    let id = pack.find("reading_chair").unwrap();
    let mut sim = test_content::sim_with(16, 16, pack);
    let entity = sim.spawn_object(Position { x: 7.0, y: 7.0 }, id);
    apply_object_placement(
        sim.world_mut(),
        entity,
        pack.object(id),
        Position { x: 7.0, y: 7.0 },
        Facing::SouthWest,
    );
    let expected = sim
        .world()
        .get::<ResolvedActionSockets>(entity)
        .unwrap()
        .clone();
    assert_eq!(
        expected.0[0].facing,
        terri_data::CompiledSocketFacing::PositiveY
    );
    let snapshot = sim.save_snapshot_v3();
    let mut restored = test_content::sim_with(16, 16, pack);
    restored.load_snapshot_v3(snapshot).unwrap();
    assert_eq!(
        restored.world().get::<ObjectFacing>(entity),
        Some(&ObjectFacing(Facing::SouthWest))
    );
    assert_eq!(
        restored.world().get::<ResolvedActionSockets>(entity),
        Some(&expected)
    );
    for _ in 0..30 {
        sim.tick();
        restored.tick();
    }
    assert_eq!(sim.save_snapshot_v3(), restored.save_snapshot_v3());
}

#[test]
fn hash_observes_only_a_changed_object_direction() {
    let pack = terri_data::pack();
    let id = pack.find("reading_chair").unwrap();
    let mut sim = test_content::sim_with(16, 16, pack);
    let entity = sim.spawn_object(Position { x: 7.0, y: 7.0 }, id);
    let before = sim.world_hash();
    sim.world_mut()
        .entity_mut(entity)
        .insert(ObjectFacing(Facing::NorthWest));
    assert_ne!(sim.world_hash(), before);
    sim.world_mut()
        .entity_mut(entity)
        .insert(ObjectFacing(Facing::SouthEast));
    assert_eq!(sim.world_hash(), before);
}

#[test]
fn legacy_dynamic_desk_keeps_its_two_by_one_collision_with_the_new_base_art() {
    let pack = terri_data::pack();
    let id = pack.find("desk").unwrap();
    let mut source = test_content::sim_with(16, 16, pack);
    let entity = source.spawn_object(Position { x: 8.0, y: 8.0 }, id);
    for x in [8, 9] {
        source
            .world_mut()
            .resource_mut::<terri_core::TileGrid>()
            .set_blocked(x, 8, true);
    }
    let mut old = source.save_snapshot();
    old.content_fingerprint = 0xfdf5_87d9_437f_bfd0;
    let before = old.blocked_tiles.clone();
    let mut resumed = test_content::sim_with(16, 16, pack);
    resumed.load_snapshot(old).unwrap();
    assert_eq!(resumed.save_snapshot().blocked_tiles, before);
    assert_eq!(
        resumed.world().get::<ObjectFacing>(entity),
        Some(&ObjectFacing(Facing::SouthWest))
    );
    assert_eq!(
        placed_footprint(pack, id, resumed.world().get::<ObjectFacing>(entity)),
        terri_core::Footprint { width: 2, depth: 1 }
    );
}
