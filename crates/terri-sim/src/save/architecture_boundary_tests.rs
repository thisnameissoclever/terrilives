use super::*;
use terri_core::{layout::WallEdge, Agent, Footprint, Path, Position, Reserved, Target};

#[test]
fn furniture_rejects_internal_edges_and_accepts_its_outer_perimeter() {
    let mut source = Sim::new_with_lot(8, 8);
    let bed = terri_data::pack().find("double_bed").unwrap();
    assert_eq!(
        terri_data::pack().object(bed).footprint,
        Footprint { width: 2, depth: 2 }
    );
    source.spawn_object(Position { x: 3.0, y: 3.0 }, bed);
    for (from, to, internal) in [
        ((3, 3), (4, 3), true),
        ((3, 3), (3, 4), true),
        ((3, 2), (3, 3), false),
        ((3, 4), (3, 5), false),
        ((4, 3), (5, 3), false),
        ((3, 5), (4, 5), false),
    ] {
        let mut saved = source.save_snapshot_v2();
        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                axis: if from.0 == to.0 {
                    terri_core::layout::EdgeAxis::Horizontal
                } else {
                    terri_core::layout::EdgeAxis::Vertical
                },
                x: to.0 as u32,
                y: to.1 as u32,
                doorway: false,
            }],
        };
        let mut live = Sim::new_with_lot(2, 2);
        let before = live.save_snapshot_v2();
        let outcome = live.load_snapshot_v2(saved.clone());
        if internal {
            assert_eq!(
                outcome,
                Err(SaveError::InvalidGrid),
                "internal edge {from:?} -> {to:?}"
            );
            assert_eq!(live.save_snapshot_v2(), before);
        } else {
            assert_eq!(outcome, Ok(()), "perimeter edge {from:?} -> {to:?}");
            assert_eq!(live.save_snapshot_v2(), saved);
        }
    }
}

#[test]
fn repeated_path_tiles_are_valid_and_a_walking_target_need_not_be_in_contact_yet() {
    let mut source = Sim::new_with_lot(7, 5);
    let fridge = terri_data::pack().find("fridge").unwrap();
    let object = source.spawn_object(Position { x: 4.0, y: 2.0 }, fridge);
    source.world.entity_mut(object).insert(Reserved);
    source.world.spawn((
        Agent,
        Position { x: 1.0, y: 2.0 },
        Target {
            object,
            interaction: 0,
        },
        Path {
            steps: vec![(1, 2), (1, 2), (2, 2), (3, 2)],
            cursor: 0,
        },
    ));
    let mut saved = source.save_snapshot_v2();
    saved.layout = SavedLayout::EdgeWallsV1 { edges: vec![] };
    let mut live = Sim::new();
    live.load_snapshot_v2(saved.clone()).unwrap();
    assert_eq!(live.save_snapshot_v2(), saved);

    saved
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.agent)
        .unwrap()
        .path = None;
    live.load_snapshot_v2(saved.clone()).unwrap();
    assert_eq!(
        live.save_snapshot_v2(),
        saved,
        "an idle target is not an active contact"
    );
}

#[test]
fn legacy_wall_cells_must_be_unique_blocked_and_inside_each_grid_axis() {
    let mut grid = TileGrid::new(4, 3);
    grid.set_blocked(2, 1, true);
    assert_eq!(
        apply_layout(
            &mut grid,
            &SavedLayout::LegacyCells {
                walls: vec![(2, 1)]
            }
        ),
        Ok(())
    );
    for walls in [
        vec![(2, 1), (2, 1)],
        vec![(1, 1)],
        vec![(4, 1)],
        vec![(2, 3)],
    ] {
        assert_eq!(
            apply_layout(
                &mut grid,
                &SavedLayout::LegacyCells {
                    walls: walls.clone()
                }
            ),
            Err(SaveError::InvalidGrid),
            "walls {walls:?}"
        );
    }
}

#[test]
fn contact_rejects_each_outside_origin_even_without_solid_edges() {
    let grid = TileGrid::new(5, 5);
    for (from, x, y) in [
        ((0, 2), -1.0, 2.0),
        ((2, 0), 2.0, -1.0),
        ((4, 2), 5.0, 2.0),
        ((2, 4), 2.0, 5.0),
    ] {
        let at = terri_core::save::SavedPosition { x, y };
        assert!(
            !valid_contact(&grid, from, at, Footprint::SINGLE),
            "outside target {at:?}"
        );
    }
}

#[test]
fn contact_accepts_flush_rectangles_but_rejects_either_overhanging_extent() {
    let grid = TileGrid::new(7, 7);
    for (from, x, y, width, depth, expected) in [
        ((2, 3), 3.0, 3.0, 4, 2, true),
        ((3, 2), 3.0, 3.0, 2, 4, true),
        ((2, 3), 3.0, 3.0, 5, 2, false),
        ((3, 2), 3.0, 3.0, 2, 5, false),
        ((2, 3), 3.0, 3.0, 2, 2, true),
        ((3, 2), 3.0, 3.0, 2, 2, true),
    ] {
        let at = terri_core::save::SavedPosition { x, y };
        let footprint = Footprint { width, depth };
        assert_eq!(
            valid_contact(&grid, from, at, footprint),
            expected,
            "footprint {footprint:?}"
        );
    }
}
