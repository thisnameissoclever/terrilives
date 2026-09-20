use super::*;

#[test]
fn collinear_segments_cannot_slide_along_the_upper_half_of_a_wall() {
    for transpose in [false, true] {
        let point = |(x, y)| if transpose { (y, x) } else { (x, y) };
        let tile = |(x, y)| if transpose { (y, x) } else { (x, y) };
        let mut grid = TileGrid::new(4, 4);
        grid.set_edge_blocked(tile((1, 1)), tile((2, 1)), true);
        for (from, to) in [
            ((1.5, 1.0), (1.5, 1.4)),
            ((1.5, 1.25), (1.5, 1.25)),
            ((1.5, 1.5), (1.5, 1.75)),
        ] {
            assert!(!grid.segment_can_cross(point(from), point(to)));
            assert!(!grid.segment_can_cross(point(to), point(from)));
        }
        for (from, to) in [((1.5, 0.0), (1.5, 0.4)), ((1.5, 1.6), (1.5, 2.0))] {
            assert!(grid.segment_can_cross(point(from), point(to)));
            assert!(grid.segment_can_cross(point(to), point(from)));
        }
    }
}

#[test]
fn fractional_replans_require_a_walkable_center_and_an_open_segment_independently() {
    for transpose in [false, true] {
        let point = |(x, y)| if transpose { (y, x) } else { (x, y) };
        let tile = |(x, y)| if transpose { (y, x) } else { (x, y) };
        let mut grid = TileGrid::new(4, 4);
        grid.set_edge_blocked(tile((1, 1)), tile((2, 1)), true);
        let blocked = tile((1, 0));
        grid.set_blocked(blocked.0 as usize, blocked.1 as usize, true);
        assert!(grid.segment_can_cross(point((1.0, 0.25)), point((1.0, 0.0))));
        assert_eq!(grid.anchor_path(point((1.0, 0.25)), vec![]), None);

        let clear = tile((2, 1));
        assert!(grid.is_walkable(clear.0, clear.1));
        assert!(!grid.segment_can_cross(point((1.5, 1.0)), point((2.0, 1.0))));
        assert_eq!(grid.anchor_path(point((1.5, 1.0)), vec![]), None);
        assert_eq!(grid.anchor_path(point((2.0, 1.0)), vec![]), Some(vec![]));
    }
}

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
