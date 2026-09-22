use super::*;
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};

fn edges() -> Vec<WallEdge> {
    let mut edges = Vec::new();
    for (axis, fixed, range, doors) in [
        (EdgeAxis::Vertical, 8, 0..6, vec![2]),
        (EdgeAxis::Horizontal, 6, 0..16, vec![3, 13]),
        (EdgeAxis::Vertical, 6, 6..12, vec![9]),
        (EdgeAxis::Vertical, 12, 6..12, vec![8]),
    ] {
        for varying in range {
            let (x, y) = match axis {
                EdgeAxis::Vertical => (fixed, varying),
                EdgeAxis::Horizontal => (varying, fixed),
            };
            edges.push(WallEdge {
                axis,
                x,
                y,
                doorway: doors.contains(&varying),
            });
        }
    }
    edges
}

fn destination() -> &'static ContentPack {
    let mut pack = terri_data::pack().clone();
    pack.lot.walls.clear();
    pack.lot.wall_edges = edges();
    Box::leak(Box::new(pack))
}

/// The cell-wall house, on the lot as it stood before the yard ([OS-grow]).
fn source_sim() -> Sim {
    let mut pack = terri_data::pack().clone();
    (pack.lot.width, pack.lot.height) = pack.lot.house;
    pack.lot.wall_edges.clear();
    pack.lot.walls = bathtub::source_layout::WALLS
        .iter()
        .map(|&(x, y)| (x as u32, y as u32))
        .collect();
    let pack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_from_lot(&pack.lot, &pack.objects);
    sim.world.insert_resource(Content(pack));
    sim.spawn_household(&pack.personalities, &pack.household, &pack.traits);
    sim
}

fn expected_after(mut before: SaveSnapshotV1) -> SaveSnapshotV1 {
    for (x, y) in bathtub::source_layout::WALLS {
        before.blocked_tiles[y * before.grid_width as usize + x] = false;
    }
    before
}

#[test]
fn wall_migration_releases_only_frozen_wall_cells_and_preserves_every_other_field() {
    let before = source_sim().save_snapshot();
    let pack = destination();
    let after = restore(before.clone(), pack, None).unwrap();
    assert_eq!(
        after.save_snapshot_v2().layout,
        SavedLayout::EdgeWallsV1 { edges: edges() }
    );
    assert_eq!(after.save_snapshot(), expected_after(before));
    assert_eq!(
        after.world.resource::<TileGrid>().blocked_edges().count(),
        29
    );
    let saved = after.save_snapshot_v2();
    let twice = architecture::restore(saved.clone(), pack, None).unwrap();
    assert_eq!(twice.save_snapshot_v2(), saved);
}

/// Review finding [F3] on the doors branch: a V1 save of the cell-wall house
/// moves to edge walls as it loads, after the restore synced the render
/// buffer, so the house drew its doorways doorless until the next tick.
#[test]
fn a_migrated_v1_house_shows_its_doors_before_the_first_tick() {
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot(source_sim().save_snapshot()).unwrap();
    assert!(matches!(
        loaded.save_snapshot_v2().layout,
        SavedLayout::EdgeWallsV1 { .. }
    ));
    assert_eq!(
        loaded.portal_buffer().states.len(),
        4,
        "the front door and a door in each of the three vertical doorways"
    );
}

#[test]
fn wall_migration_preserves_entity_holes_reservations_and_queued_commands() {
    let mut before = source_sim().save_snapshot();
    for entity in &mut before.entities {
        entity.index += 2;
    }
    before.entities[0].index = 3;
    before.entities[1].index = 2;
    before.entities.sort_by_key(|e| e.index);
    before
        .entities
        .iter_mut()
        .find(|e| e.smart_object.as_deref() == Some("bathtub"))
        .unwrap()
        .reserved = true;
    before.tick = 123;
    before.funds = 9876;
    let agent = before.entities.iter().find(|e| e.agent).unwrap().index;
    before.queued_commands = vec![SavedCommand::Select(Some(agent)), SavedCommand::SetSpeed(3)];
    before.sleep_pressure = vec![(agent, 47)];
    let after = restore(before.clone(), destination(), None).unwrap();
    assert_eq!(after.save_snapshot(), expected_after(before));
    assert!(matches!(
        after.save_snapshot_v2().layout,
        SavedLayout::EdgeWallsV1 { .. }
    ));
}

#[test]
fn wall_migration_never_reinterprets_an_explicit_v2_legacy_world() {
    let world = source_sim().save_snapshot();
    let snapshot = terri_core::SaveSnapshotV2 {
        world,
        layout: SavedLayout::LegacyAuthoredV1,
    };
    let after = architecture::restore(snapshot.clone(), destination(), None).unwrap();
    assert_eq!(after.save_snapshot_v2(), snapshot);
}

#[test]
fn wall_migration_keeps_custom_current_v1_worlds_byte_exact() {
    let original = source_sim().save_snapshot();
    let mut cases = Vec::new();
    let mut changed = original.clone();
    changed.blocked_tiles[8 * 16 + 8] = !changed.blocked_tiles[8 * 16 + 8];
    cases.push(changed);
    let mut changed = original.clone();
    changed
        .entities
        .iter_mut()
        .find(|e| e.smart_object.as_deref() == Some("radio"))
        .unwrap()
        .position
        .as_mut()
        .unwrap()
        .x += 0.25;
    cases.push(changed);
    let mut changed = original.clone();
    let index = changed
        .entities
        .iter()
        .position(|e| e.smart_object.as_deref() == Some("radio"))
        .unwrap();
    changed.entities.remove(index);
    cases.push(changed);
    let mut changed = original;
    let mut object = changed
        .entities
        .iter()
        .find(|e| e.smart_object.is_some())
        .unwrap()
        .clone();
    object.index = changed.entities.last().unwrap().index + 1;
    changed.entities.push(object);
    cases.push(changed);
    for before in cases {
        let after = restore(before.clone(), destination(), None).unwrap();
        assert_eq!(after.save_snapshot(), before);
        assert_eq!(
            after.save_snapshot_v2().layout,
            SavedLayout::LegacyAuthoredV1
        );
    }
}

#[test]
fn wall_migration_requires_the_reviewed_destination_geometry_and_footprints() {
    let original = source_sim().save_snapshot();
    let mut cases = Vec::new();
    let mut pack = destination().clone();
    pack.lot.wall_edges.clear();
    cases.push(pack);
    let mut pack = destination().clone();
    pack.lot.wall_edges[0].doorway = true;
    cases.push(pack);
    let mut pack = destination().clone();
    pack.lot.wall_edges.pop();
    cases.push(pack);
    // The house, not the lot around it, is what was reviewed ([OS-grow]).
    let mut pack = destination().clone();
    pack.lot.house.0 += 1;
    cases.push(pack);
    let mut pack = destination().clone();
    pack.objects[0].footprint.width += 1;
    cases.push(pack);
    for pack in cases {
        let mut before = original.clone();
        before.content_fingerprint = terri_data::content_fingerprint(&pack);
        let after = restore(before.clone(), Box::leak(Box::new(pack)), None).unwrap();
        assert_eq!(after.save_snapshot(), before);
        assert_eq!(
            after.save_snapshot_v2().layout,
            SavedLayout::LegacyAuthoredV1
        );
    }
}

#[test]
fn wall_migration_preserves_all_old_steps_and_object_approaches_and_opens_five_doors() {
    let source = source_sim();
    let before = source.save_snapshot();
    let destination = destination();
    let after = restore(before.clone(), destination, None).unwrap();
    let old = source.world.resource::<TileGrid>();
    let new = after.world.resource::<TileGrid>();
    let mut old_steps = 0;
    let mut old_approaches = 0;
    for y in 0..12 {
        for x in 0..16 {
            if old.is_walkable(x, y) {
                assert!(new.is_walkable(x, y));
            }
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let to = (x + dx, y + dy);
                if old.can_step((x, y), to) {
                    old_steps += 1;
                    assert!(
                        new.can_step((x, y), to),
                        "old legal step {:?} -> {to:?}",
                        (x, y)
                    );
                    // Old movement can retarget halfway through any cardinal
                    // step. Check both travel directions and every new first
                    // step from the rounded current cell, including turns.
                    for fraction in [0.0, 0.25, 0.5, 0.75, 1.0] {
                        let position = (
                            x as f32 + dx as f32 * fraction,
                            y as f32 + dy as f32 * fraction,
                        );
                        let center = (position.0.round() as i32, position.1.round() as i32);
                        for (next_dx, next_dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                            let next = (center.0 + next_dx, center.1 + next_dy);
                            if old.can_step(center, next) {
                                assert!(
                                    new.segment_can_cross(position, (next.0 as f32, next.1 as f32)),
                                    "legacy retarget {position:?} -> {next:?}"
                                );
                            }
                        }
                    }
                }
            }
            for object in before.entities.iter().filter(|e| e.smart_object.is_some()) {
                let pos = object.position.unwrap();
                let origin = (pos.x as i32, pos.y as i32);
                let fp = destination
                    .object(
                        destination
                            .find(object.smart_object.as_deref().unwrap())
                            .unwrap(),
                    )
                    .footprint;
                if old.can_interact_with_rect((x, y), origin, fp) {
                    old_approaches += 1;
                    assert!(new.can_interact_with_rect((x, y), origin, fp));
                }
            }
        }
    }
    assert!(old_steps > 100 && old_approaches > 50);
    for edge in edges() {
        let [a, b] = edge.cells();
        assert_eq!(new.can_cross(a, b), edge.doorway);
        assert_eq!(new.can_cross(b, a), edge.doorway);
        if edge.doorway {
            assert!(new.can_step(a, b) && new.can_step(b, a));
        }
    }
    // Kitchen, living, bathroom, study, bedroom, kitchen circulation loop.
    let rooms = [(6, 2), (9, 2), (13, 8), (10, 8), (4, 9), (6, 2)];
    for pair in rooms.windows(2) {
        assert!(new.find_path(pair[0], pair[1]).is_some(), "{pair:?}");
    }
}

#[test]
fn wall_migration_preserves_sampled_running_legacy_worlds_and_fractional_first_segments() {
    let mut source = source_sim();
    let pack = destination();
    let mut paths = 0;
    let mut fractional = 0;
    let mut active = 0;
    for tick in 0..1200 {
        source.tick();
        if tick % 7 != 0 {
            continue;
        }
        let before = source.save_snapshot();
        let after = restore(before.clone(), pack, None).unwrap();
        assert_eq!(
            after.save_snapshot(),
            expected_after(before.clone()),
            "tick {tick}"
        );
        assert!(matches!(
            after.save_snapshot_v2().layout,
            SavedLayout::EdgeWallsV1 { .. }
        ));
        let grid = after.world.resource::<TileGrid>();
        for entity in &before.entities {
            active += usize::from(
                entity.eating.is_some()
                    || entity.step_work_ticks.is_some()
                    || entity.socialising.is_some(),
            );
            if let (Some(position), Some(path)) = (entity.position, &entity.path) {
                if let Some(&next) = path.steps.get(path.cursor as usize) {
                    paths += 1;
                    fractional +=
                        usize::from(position.x.fract() != 0.0 || position.y.fract() != 0.0);
                    assert!(
                        grid.segment_can_cross(
                            (position.x, position.y),
                            (next.0 as f32, next.1 as f32)
                        ),
                        "tick {tick}, entity {}",
                        entity.index
                    );
                }
            }
        }
    }
    assert!(
        paths > 10 && fractional > 10 && active > 10,
        "paths={paths}, fractional={fractional}, active={active}"
    );
}
