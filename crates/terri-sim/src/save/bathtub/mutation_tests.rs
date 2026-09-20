use super::*;

fn grid_with_blocked(width: usize, height: usize, blocked: Tile) -> TileGrid {
    let mut grid = TileGrid::new(width, height);
    grid.set_blocked(blocked.0 as usize, blocked.1 as usize, true);
    grid
}

#[test]
fn segment_clipping_observes_motion_half_open_edges_and_stationary_axes() {
    for (label, from, to, cell, expected) in [
        (
            "moving segment enters the destination cell",
            SavedPosition { x: 0.0, y: 0.5 },
            (2, 1),
            (2, 1),
            true,
        ),
        (
            "segment starts on the excluded high edge and moves away",
            SavedPosition { x: 0.0, y: 0.5 },
            (0, 1),
            (0, 0),
            false,
        ),
        (
            "stationary segment remains outside the cell",
            SavedPosition { x: 0.0, y: 0.0 },
            (0, 0),
            (0, 1),
            false,
        ),
    ] {
        assert_eq!(segment_crosses_cell(from, to, cell), expected, "{label}");
    }
}

#[test]
fn nearest_retained_tile_uses_row_stride_cardinal_steps_and_either_grid() {
    for (width, height, old_blocked, new_blocked, target) in [
        (3, 2, (2, 0), (1, 1), (2, 0)),
        (2, 3, (1, 0), (0, 1), (0, 2)),
        (3, 2, (1, 0), (0, 1), (0, 0)),
        (3, 2, (1, 0), (0, 1), (1, 1)),
    ] {
        let old = grid_with_blocked(width, height, old_blocked);
        let new = grid_with_blocked(width, height, new_blocked);

        assert_eq!(
            nearest_retained_tile(&old, &new, new_blocked, |candidate| candidate == target),
            Some(target),
            "{width}x{height}, old={old_blocked:?}, new={new_blocked:?}"
        );
    }
}

#[test]
fn frozen_source_dimensions_reject_each_wrong_axis_independently() {
    let snapshot = crate::save::bathtub_tests::old_snapshot();
    let mut destination = terri_data::pack().clone();
    destination.lot.wall_edges.clear();
    destination.lot.walls = terri_core::layout::LEGACY_WALL_TILES.to_vec();
    let bathtub = destination.find("bathtub").unwrap();
    destination.objects[bathtub.0 as usize].footprint = NEW;
    let source = reviewed_source(&destination).unwrap();
    assert_eq!(source_layout::validate(&snapshot, &source), Ok(()));

    let mut wrong_width = snapshot.clone();
    wrong_width.grid_width += 1;
    assert_eq!(
        source_layout::validate(&wrong_width, &source),
        Err(SaveError::InvalidGrid)
    );

    let mut wrong_height = snapshot;
    wrong_height.grid_height += 1;
    assert_eq!(
        source_layout::validate(&wrong_height, &source),
        Err(SaveError::InvalidGrid)
    );
}
