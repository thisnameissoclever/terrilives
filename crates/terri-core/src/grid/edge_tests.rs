use super::*;

#[test]
fn legacy_off_lot_contact_preserves_adjacent_paths_without_solid_barriers() {
    let grid = TileGrid::new(4, 4);
    for (from, target, distance) in [
        ((3, 1), (4, 1), 2),
        ((0, 1), (-1, 1), 1),
        ((1, 3), (1, 4), 2),
        ((1, 0), (1, -1), 1),
    ] {
        assert_eq!(
            grid.find_path_adjacent(from, target, Footprint::SINGLE),
            Some(vec![])
        );
        assert!(grid.can_interact_with_rect(from, target, Footprint::SINGLE));
        assert_eq!(
            grid.find_path_adjacent((1, 1), target, Footprint::SINGLE)
                .unwrap()
                .len(),
            distance
        );
    }
}

#[test]
fn legacy_off_lot_contact_preserves_distance_fields_without_solid_barriers() {
    let grid = TileGrid::new(4, 4);
    let field = grid.distance_field((1, 1)).unwrap();
    for (target, distance) in [((4, 1), 2), ((-1, 1), 1), ((1, 4), 2), ((1, -1), 1)] {
        assert_eq!(
            field.distance_to_adjacent(target, Footprint::SINGLE),
            Some(distance)
        );
    }
}

#[test]
fn legacy_off_lot_contact_is_not_allowed_when_any_solid_barrier_exists() {
    let mut grid = TileGrid::new(4, 4);
    grid.set_edge_blocked((0, 0), (1, 0), true);
    let field = grid.distance_field((1, 1)).unwrap();
    for (from, target) in [
        ((3, 1), (4, 1)),
        ((0, 1), (-1, 1)),
        ((1, 3), (1, 4)),
        ((1, 0), (1, -1)),
    ] {
        assert!(!grid.can_interact_with_rect(from, target, Footprint::SINGLE));
        assert_eq!(
            grid.find_path_adjacent(from, target, Footprint::SINGLE),
            None
        );
        assert_eq!(field.distance_to_adjacent(target, Footprint::SINGLE), None);
    }
    grid.set_edge_blocked((0, 0), (1, 0), false);
    assert!(grid.can_interact_with_rect((3, 1), (4, 1), Footprint::SINGLE));
    assert_eq!(field.distance_to_adjacent((4, 1), Footprint::SINGLE), None);
}

#[test]
fn edge_barriers_are_symmetric_and_leave_both_cells_walkable() {
    let mut grid = TileGrid::new(4, 3);
    for (from, to) in [((1, 1), (2, 1)), ((1, 1), (1, 2))] {
        assert!(grid.can_cross(from, to));
        assert!(grid.can_cross(to, from));
        grid.set_edge_blocked(to, from, true);
        assert!(!grid.can_cross(from, to));
        assert!(!grid.can_cross(to, from));
        assert!(grid.is_walkable(from.0, from.1));
        assert!(grid.is_walkable(to.0, to.1));
        grid.set_edge_blocked(from, to, false);
        assert!(grid.can_cross(from, to));
        assert!(grid.can_cross(to, from));
    }
}

#[test]
fn crossings_ignore_occupancy_but_steps_and_interaction_approaches_do_not() {
    let mut grid = TileGrid::new(3, 3);
    grid.set_blocked(1, 1, true);
    assert!(grid.can_cross((0, 1), (1, 1)));
    assert!(grid.can_cross((1, 1), (0, 1)));
    assert!(!grid.can_step((0, 1), (1, 1)));
    assert!(!grid.can_step((1, 1), (0, 1)));
    assert!(grid.can_interact_with_rect((0, 1), (1, 1), Footprint::SINGLE));
    grid.set_edge_blocked((0, 1), (1, 1), true);
    assert!(!grid.can_interact_with_rect((0, 1), (1, 1), Footprint::SINGLE));
    grid.set_edge_blocked((0, 1), (1, 1), false);
    grid.set_blocked(0, 1, true);
    assert!(!grid.can_interact_with_rect((0, 1), (1, 1), Footprint::SINGLE));
    grid.set_blocked(0, 1, false);
    grid.set_blocked(1, 1, false);
    assert!(grid.can_step((0, 1), (1, 1)));
    assert!(!grid.can_interact_with_rect((0, 0), (1, 1), Footprint::SINGLE));
    assert!(!grid.can_interact_with_rect((1, 1), (1, 1), Footprint::SINGLE));
}

#[test]
fn invalid_boundary_pairs_are_not_crossable_and_cannot_be_set() {
    for (from, to) in [
        ((0, 0), (0, 0)),
        ((0, 0), (1, 1)),
        ((0, 0), (2, 0)),
        ((-1, 0), (0, 0)),
        ((2, 1), (3, 1)),
        ((1, 1), (1, 2)),
        ((i32::MIN, 0), (i32::MAX, 0)),
    ] {
        let mut grid = TileGrid::new(3, 2);
        assert!(!grid.can_cross(from, to));
        assert!(!grid.can_step(from, to));
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            grid.set_edge_blocked(from, to, true);
        }))
        .is_err());
        assert_eq!(grid.blocked_edges().count(), 0);
    }
}

#[test]
fn solid_dividers_seal_routes_and_an_open_door_restores_both_directions() {
    let mut grid = TileGrid::new(5, 4);
    for y in 0..4 {
        grid.set_edge_blocked((1, y), (2, y), true);
    }
    for (from, to) in [((0, 1), (4, 1)), ((4, 1), (0, 1))] {
        assert_eq!(grid.find_path(from, to), None);
        assert_eq!(grid.distance_field(from).unwrap().distance_at(to), u32::MAX);
        assert_eq!(grid.find_path_adjacent_to_tile(from, to), None);
    }
    grid.set_edge_blocked((2, 3), (1, 3), false);
    for (from, to) in [((0, 1), (4, 1)), ((4, 1), (0, 1))] {
        let path = grid.find_path(from, to).unwrap();
        assert_eq!(path.len(), 8);
        assert_eq!(path.last(), Some(&to));
        assert_eq!(grid.distance_field(from).unwrap().distance_at(to), 8);
        let mut previous = from;
        for next in path {
            assert!(grid.can_step(previous, next));
            previous = next;
        }
    }
}

#[test]
fn adjacent_astar_and_fields_reject_contact_through_a_solid_boundary() {
    let mut grid = TileGrid::new(3, 3);
    grid.set_blocked(1, 1, true);
    grid.set_edge_blocked((0, 1), (1, 1), true);
    let route = grid.find_path_adjacent_to_tile((0, 1), (1, 1)).unwrap();
    assert_eq!(route.len(), 2);
    assert!(grid.can_interact_with_rect(*route.last().unwrap(), (1, 1), Footprint::SINGLE));
    assert_eq!(
        grid.distance_field((0, 1))
            .unwrap()
            .distance_to_adjacent((1, 1), Footprint::SINGLE),
        Some(2)
    );
    for approach in [(1, 0), (2, 1), (1, 2)] {
        grid.set_edge_blocked(approach, (1, 1), true);
    }
    assert_eq!(grid.find_path_adjacent_to_tile((0, 1), (1, 1)), None);
    assert_eq!(
        grid.distance_field((0, 1))
            .unwrap()
            .distance_to_adjacent((1, 1), Footprint::SINGLE),
        None
    );
}

#[test]
fn rectangular_interactions_use_the_boundary_beside_the_contact_cell() {
    let mut grid = TileGrid::new(6, 5);
    let origin = (2, 1);
    let footprint = Footprint { width: 2, depth: 2 };
    for x in 2..=3 {
        for y in 1..=2 {
            grid.set_blocked(x, y, true);
        }
        grid.set_edge_blocked((x as i32, 0), (x as i32, 1), true);
        grid.set_edge_blocked((x as i32, 3), (x as i32, 2), true);
    }
    for y in 1..=2 {
        grid.set_edge_blocked((1, y), (2, y), true);
        grid.set_edge_blocked((4, y), (3, y), true);
    }
    grid.set_edge_blocked((4, 2), (3, 2), false);
    assert!(!grid.can_interact_with_rect((1, 1), origin, footprint));
    assert!(!grid.can_interact_with_rect((3, 3), origin, footprint));
    assert!(grid.can_interact_with_rect((4, 2), origin, footprint));
    let route = grid.find_path_adjacent((1, 1), origin, footprint).unwrap();
    assert_eq!(route.len(), 6);
    assert_eq!(route.last(), Some(&(4, 2)));
    assert_eq!(
        grid.distance_field((1, 1))
            .unwrap()
            .distance_to_adjacent(origin, footprint),
        Some(6)
    );
}

#[test]
fn edge_snapshots_are_canonical_and_distance_fields_retain_their_boundaries() {
    let mut grid = TileGrid::new(3, 3);
    grid.set_blocked(1, 1, true);
    let before = grid.distance_field((0, 1)).unwrap();
    grid.set_edge_blocked((1, 2), (1, 1), true);
    grid.set_edge_blocked((1, 1), (0, 1), true);
    assert_eq!(
        grid.blocked_edges().collect::<Vec<_>>(),
        vec![((0, 1), (1, 1)), ((1, 1), (1, 2))]
    );
    assert_eq!(
        before.distance_to_adjacent((1, 1), Footprint::SINGLE),
        Some(0)
    );
    assert_eq!(
        grid.distance_field((0, 1))
            .unwrap()
            .distance_to_adjacent((1, 1), Footprint::SINGLE),
        Some(2)
    );
    let mut restored = TileGrid::new(3, 3);
    for (from, to) in grid.blocked_edges() {
        restored.set_edge_blocked(from, to, true);
    }
    assert!(!restored.can_cross((1, 1), (0, 1)));
    assert!(!restored.can_cross((1, 2), (1, 1)));
    assert!(restored.can_cross((1, 1), (2, 1)));
}

#[test]
fn distance_fields_match_adjacent_astar_for_every_small_boundary_layout() {
    let edges = [
        ((0, 0), (1, 0)),
        ((1, 0), (2, 0)),
        ((0, 1), (1, 1)),
        ((1, 1), (2, 1)),
        ((0, 0), (0, 1)),
        ((1, 0), (1, 1)),
        ((2, 0), (2, 1)),
    ];
    let mut reachable = 0;
    let mut unreachable = 0;
    for mask in 0..128 {
        let mut grid = TileGrid::new(3, 2);
        for (bit, &(from, to)) in edges.iter().enumerate() {
            grid.set_edge_blocked(from, to, mask & (1 << bit) != 0);
        }
        for from_y in 0..2 {
            for from_x in 0..3 {
                let from = (from_x, from_y);
                let field = grid.distance_field(from).unwrap();
                for footprint in [Footprint::SINGLE, Footprint { width: 2, depth: 1 }] {
                    for y in 0..2 {
                        for x in 0..=(3 - footprint.width as i32) {
                            let origin = (x, y);
                            let route = grid.find_path_adjacent(from, origin, footprint);
                            let distance = route.as_ref().map(|path| path.len() as u32);
                            assert_eq!(
                                field.distance_to_adjacent(origin, footprint),
                                distance,
                                "mask {mask} source {from:?} object {origin:?} {footprint:?}"
                            );
                            if route.is_some() {
                                reachable += 1;
                            } else {
                                unreachable += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    assert!(reachable > 0 && unreachable > 0);
}
