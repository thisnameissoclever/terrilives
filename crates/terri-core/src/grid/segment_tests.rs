use super::*;

#[test]
fn fractional_segments_cannot_cross_solid_edges_or_clip_their_endpoints() {
    let mut grid = TileGrid::new(5, 4);
    grid.set_edge_blocked((1, 1), (2, 1), true);
    for (a, b) in [
        ((1.2, 1.0), (2.0, 1.0)),
        ((1.0, 0.0), (2.0, 1.0)),
        ((1.5, 0.5), (1.5, 1.5)),
    ] {
        assert!(!grid.segment_can_cross(a, b));
        assert!(!grid.segment_can_cross(b, a));
    }
    assert!(grid.segment_can_cross((1.2, 0.0), (2.0, 0.0)));
    assert!(grid.segment_can_cross((1.0, 1.0), (1.0, 2.0)));
    grid.set_edge_blocked((1, 1), (2, 1), false);
    assert!(grid.segment_can_cross((1.2, 1.0), (2.0, 1.0)));
    grid.set_edge_blocked((2, 1), (2, 2), true);
    assert!(!grid.segment_can_cross((2.0, 1.2), (2.0, 2.0)));
    assert!(!grid.segment_can_cross((f32::NAN, 1.0), (2.0, 2.0)));
}

#[test]
fn a_fractional_replan_returns_to_its_grid_center_before_turning() {
    let mut grid = TileGrid::new(5, 4);
    grid.set_edge_blocked((1, 1), (2, 1), true);
    let steps = vec![(2, 0), (3, 0)];
    assert_eq!(
        grid.anchor_path((1.0, 0.4), steps.clone()),
        Some(vec![(1, 0), (2, 0), (3, 0)])
    );
    assert_eq!(
        grid.anchor_path((1.0, 0.0), steps.clone()),
        Some(steps.clone())
    );
    let legacy = TileGrid::new(5, 4);
    assert_eq!(legacy.anchor_path((1.0, 0.4), steps.clone()), Some(steps));
}
