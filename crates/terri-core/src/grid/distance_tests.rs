use super::*;

#[test]
fn exact_distance_rejects_blocked_unreachable_and_outside_tiles() {
    let mut grid = TileGrid::new(4, 3);
    for y in 0..3 {
        grid.set_blocked(2, y, true);
    }
    let field = grid.distance_field((1, 1)).unwrap();
    assert_eq!(field.distance_to_tile((1, 1)), Some(0));
    assert_eq!(field.distance_to_tile((0, 2)), Some(2));
    for tile in [(2, 1), (3, 1), (-1, 0), (4, 0), (0, 3)] {
        assert_eq!(field.distance_to_tile(tile), None, "{tile:?}");
    }
    grid.set_blocked(2, 1, false);
    assert_eq!(
        field.distance_to_tile((3, 1)),
        None,
        "The distance field retains its grid snapshot"
    );
    assert_eq!(
        grid.distance_field((1, 1))
            .unwrap()
            .distance_to_tile((3, 1)),
        Some(2)
    );
}
