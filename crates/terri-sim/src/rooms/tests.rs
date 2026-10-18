use super::*;
use std::collections::BTreeSet;
use terri_core::{
    layout::{EdgeAxis, SavedLayout, WallEdge, WallLine, LEGACY_WALL_TILES},
    TileGrid,
};

fn world(width: usize, height: usize) -> World {
    let mut world = World::new();
    world.insert_resource(TileGrid::new(width, height));
    world.insert_resource(SavedLayout::EdgeWallsV1 { edges: vec![] });
    world
}

fn rectangle(x: u32, y: u32, width: u32, height: u32) -> BTreeSet<(u32, u32)> {
    (y..y + height)
        .flat_map(|y| (x..x + width).map(move |x| (x, y)))
        .collect()
}

fn outline(tiles: &BTreeSet<(u32, u32)>) -> Vec<WallEdge> {
    let mut edges = vec![];
    for &(x, y) in tiles {
        for (axis, bx, by, neighbour) in [
            (EdgeAxis::Vertical, x, y, x.checked_sub(1).map(|nx| (nx, y))),
            (EdgeAxis::Vertical, x + 1, y, Some((x + 1, y))),
            (
                EdgeAxis::Horizontal,
                x,
                y,
                y.checked_sub(1).map(|ny| (x, ny)),
            ),
            (EdgeAxis::Horizontal, x, y + 1, Some((x, y + 1))),
        ] {
            if !neighbour.is_some_and(|tile| tiles.contains(&tile)) {
                edges.push(WallEdge {
                    axis,
                    x: bx,
                    y: by,
                    doorway: false,
                });
            }
        }
    }
    edges
}

fn enclosed(topology: &RoomTopology, tile: (u32, u32)) -> u32 {
    match topology.at(tile) {
        Some(TopologyCell::Enclosed(index)) => index,
        other => panic!("expected enclosed floor at {tile:?}, got {other:?}"),
    }
}

#[test]
fn implicit_legacy_geometry_is_clipped_but_explicit_bad_coordinates_refuse() {
    for (width, height) in [(3, 4), (8, 8), (9, 7)] {
        let mut world = world(width, height);
        world.insert_resource(SavedLayout::LegacyAuthoredV1);
        let topology = RoomTopology::from_world(&world).unwrap();
        for y in 0..height as u32 {
            for x in 0..width as u32 {
                assert_eq!(
                    topology.at((x, y)) == Some(TopologyCell::NotFloor),
                    LEGACY_WALL_TILES.contains(&(x, y))
                );
            }
        }
        if width == 9 {
            assert_ne!(
                enclosed(&topology, (3, 5)),
                enclosed(&topology, (3, 6)),
                "the in-bounds frozen doorway still separates rooms"
            );
        }
        world.insert_resource(SavedLayout::LegacyCells {
            walls: vec![(width as u32, 0)],
        });
        assert_eq!(
            RoomTopology::from_world(&world),
            Err(RoomError::InvalidArchitecture)
        );
    }
}

#[test]
fn irregular_rooms_and_three_sided_yard() {
    let mut world = world(20, 16);
    let mut shapes = vec![
        rectangle(1, 1, 1, 1),
        rectangle(4, 1, 2, 1),
        rectangle(8, 1, 3, 1),
        rectangle(13, 1, 2, 2),
        rectangle(1, 5, 3, 2),
        rectangle(6, 5, 4, 2),
    ];
    let mut open_plan = rectangle(12, 5, 4, 2);
    open_plan.extend(rectangle(12, 7, 2, 2));
    shapes.push(open_plan);
    let mut edges: Vec<_> = shapes.iter().flat_map(outline).collect();
    edges.extend(
        outline(&rectangle(1, 10, 4, 4))
            .into_iter()
            .filter(|edge| !(edge.axis == EdgeAxis::Horizontal && edge.y == 14)),
    );
    world.insert_resource(SavedLayout::EdgeWallsV1 { edges });
    let topology = RoomTopology::from_world(&world).unwrap();
    assert_eq!(
        (topology.width, topology.height, topology.cells.len()),
        (20, 16, 320)
    );
    assert_eq!(topology.components.len(), 7);
    for (index, room) in topology.components.iter().enumerate() {
        assert_eq!(room.anchor, (room.cells[0] % 20, room.cells[0] / 20));
        assert!(room.cells.windows(2).all(|pair| pair[0] < pair[1]));
        for &cell in &room.cells {
            assert_eq!(
                topology.cells[cell as usize],
                TopologyCell::Enclosed(index as u32)
            );
        }
    }
    let mut sizes: Vec<_> = topology.components.iter().map(|r| r.cells.len()).collect();
    sizes.sort_unstable();
    assert_eq!(sizes, [1, 2, 3, 4, 6, 8, 12]);
    for shape in shapes {
        let component = enclosed(&topology, *shape.first().unwrap());
        assert!(shape
            .into_iter()
            .all(|tile| enclosed(&topology, tile) == component));
    }
    for tile in [(0, 0), (19, 0), (0, 15), (19, 15), (2, 11), (2, 14)] {
        assert_eq!(topology.at(tile), Some(TopologyCell::Outside), "{tile:?}");
    }
    assert_eq!(topology.at((20, 0)), None);
    assert_eq!(topology.at((0, 16)), None);
}

#[test]
fn additions_outside_original_house_are_enclosed_without_a_floor_covering() {
    let mut world = world(12, 8);
    let mut content = terri_data::pack().clone();
    content.lot.house = (3, 3);
    world.insert_resource(crate::Content(Box::leak(Box::new(content))));
    world.insert_resource(crate::LotFrame::default());
    world.insert_resource(SavedLayout::EdgeWallsV1 {
        edges: outline(&rectangle(7, 3, 3, 2)),
    });
    let topology = RoomTopology::from_world(&world).unwrap();
    assert_eq!(topology.components.len(), 1);
    assert_eq!(topology.components[0].cells.len(), 6);
    enclosed(&topology, (7, 3));
    assert_eq!(topology.at((1, 1)), Some(TopologyCell::Outside));
}

#[test]
fn doorways_windows_and_missing_segments_define_boundaries_on_both_axes() {
    use terri_core::windows::{WindowModel, WindowPlacement};
    for axis in [EdgeAxis::Vertical, EdgeAxis::Horizontal] {
        let mut world = world(8, 8);
        let mut edges = outline(&rectangle(1, 1, 6, 6));
        edges.extend((1..7).filter(|at| !(3..6).contains(at)).map(|at| WallEdge {
            axis,
            x: if axis == EdgeAxis::Vertical { 4 } else { at },
            y: if axis == EdgeAxis::Horizontal { 4 } else { at },
            doorway: at == 2,
        }));
        let window = WindowPlacement {
            line: WallLine {
                axis,
                x: if axis == EdgeAxis::Vertical { 4 } else { 3 },
                y: if axis == EdgeAxis::Horizontal { 4 } else { 3 },
            },
            model: WindowModel::Picture,
        };
        world.insert_resource(SavedLayout::EdgeWallsV3 {
            edges: edges.clone(),
            windows: vec![window],
        });
        let closed = RoomTopology::from_world(&world).unwrap();
        assert_eq!(closed.components.len(), 2);
        for at in 1..7 {
            let (a, b) = if axis == EdgeAxis::Vertical {
                ((3, at), (4, at))
            } else {
                ((at, 3), (at, 4))
            };
            assert_ne!(enclosed(&closed, a), enclosed(&closed, b));
        }
        edges.retain(|edge| !edge.doorway);
        world.insert_resource(SavedLayout::EdgeWallsV3 {
            edges,
            windows: vec![window],
        });
        assert_eq!(
            RoomTopology::from_world(&world).unwrap().components.len(),
            1
        );
    }
}

#[test]
fn a_door_remains_a_room_boundary_while_its_animation_is_open() {
    use crate::portals::{sync_portals, ActivePortals, PortalBuffer, CLOSED, OPEN};
    use terri_core::{Agent, Path, Position};
    let mut world = world(8, 8);
    let content = terri_data::pack();
    world.insert_resource(crate::Content(content));
    world.insert_resource(ActivePortals::from_content(content));
    let mut edges = outline(&rectangle(1, 1, 6, 6));
    edges.extend((1..7).map(|y| WallEdge {
        axis: EdgeAxis::Vertical,
        x: 4,
        y,
        doorway: y == 3,
    }));
    world.insert_resource(SavedLayout::EdgeWallsV1 { edges });
    let closed = RoomTopology::from_world(&world).unwrap();
    let mut presentation = PortalBuffer::default();
    sync_portals(&mut world, &mut presentation);
    assert_eq!(presentation.states.last(), Some(&CLOSED));
    world.spawn((
        Agent,
        Position { x: 3.5, y: 3.0 },
        Path {
            steps: vec![(4, 3), (5, 3)],
            cursor: 0,
        },
    ));
    sync_portals(&mut world, &mut presentation);
    assert_eq!(presentation.states.last(), Some(&OPEN));
    assert_eq!(RoomTopology::from_world(&world).unwrap(), closed);
    assert_eq!(closed.components.len(), 2);
}

#[test]
fn furniture_and_movement_barriers_never_cut_architectural_floor() {
    let mut world = world(6, 6);
    world.insert_resource(SavedLayout::EdgeWallsV1 {
        edges: outline(&rectangle(1, 1, 4, 4)),
    });
    let before = RoomTopology::from_world(&world).unwrap();
    for y in 1..5 {
        world.resource_mut::<TileGrid>().set_blocked(3, y, true);
        world
            .resource_mut::<TileGrid>()
            .set_edge_blocked((2, y as i32), (3, y as i32), true);
    }
    assert_eq!(RoomTopology::from_world(&world).unwrap(), before);
    assert_eq!(before.components[0].cells.len(), 16);
}

#[test]
fn explicit_perimeter_walls_and_implicit_rear_shell_seal_physical_space() {
    let mut world = world(8, 7);
    let mut content = terri_data::pack().clone();
    content.lot.house = (3, 3);
    world.insert_resource(crate::Content(Box::leak(Box::new(content))));
    world.insert_resource(crate::LotFrame {
        origin: (2, 2),
        purchased_area: 0,
    });
    let mut edges: Vec<_> = outline(&rectangle(2, 2, 3, 3))
        .into_iter()
        .filter(|e| {
            !(e.axis == EdgeAxis::Vertical && e.x == 2
                || e.axis == EdgeAxis::Horizontal && e.y == 2)
        })
        .collect();
    edges.extend(outline(&rectangle(6, 0, 2, 2)));
    world.insert_resource(SavedLayout::EdgeWallsV1 { edges });
    let topology = RoomTopology::from_world(&world).unwrap();
    assert_eq!(topology.components.len(), 2);
    enclosed(&topology, (2, 2));
    enclosed(&topology, (7, 0));
    assert_eq!(topology.at((1, 2)), Some(TopologyCell::Outside));
    assert_eq!(topology.at((2, 1)), Some(TopologyCell::Outside));
    let layout = world.resource_mut::<SavedLayout>().into_inner();
    let mut edges = layout.edges().to_vec();
    edges.retain(|e| !(e.axis == EdgeAxis::Vertical && e.x == 8 && e.y == 0));
    *layout = SavedLayout::EdgeWallsV1 { edges };
    assert_eq!(
        RoomTopology::from_world(&world).unwrap().at((7, 0)),
        Some(TopologyCell::Outside)
    );
}

#[test]
fn legacy_wall_cells_and_frozen_doorways_preserve_physical_membership() {
    for layout in [
        SavedLayout::LegacyAuthoredV1,
        SavedLayout::LegacyCells {
            walls: LEGACY_WALL_TILES.iter().rev().copied().collect(),
        },
    ] {
        let mut world = world(16, 12);
        world.insert_resource(layout.clone());
        let topology = RoomTopology::from_world(&world).unwrap();
        for &tile in &LEGACY_WALL_TILES {
            assert_eq!(topology.at(tile), Some(TopologyCell::NotFloor));
        }
        let mut indices = [(1, 1), (9, 1), (1, 8), (8, 8), (14, 8)]
            .map(|tile| enclosed(&topology, tile))
            .to_vec();
        indices.sort_unstable();
        indices.dedup();
        assert_eq!(indices.len(), 5);
        assert_eq!(topology.components.len(), 5);
        for (before, after) in [
            ((7, 2), (8, 2)),
            ((3, 5), (3, 6)),
            ((13, 5), (13, 6)),
            ((5, 9), (6, 9)),
            ((11, 8), (12, 8)),
        ] {
            assert_ne!(topology.at(before), topology.at(after));
        }
        assert_eq!(world.resource::<SavedLayout>(), &layout);
    }
}

#[test]
fn custom_legacy_gaps_remain_open_and_disconnected_outside_is_shared() {
    let mut world = world(7, 5);
    world.insert_resource(SavedLayout::LegacyCells {
        walls: (0..5).filter(|&y| y != 2).map(|y| (3, y)).collect(),
    });
    let open = RoomTopology::from_world(&world).unwrap();
    assert!(open.components.is_empty());
    assert_eq!(open.at((3, 2)), Some(TopologyCell::Outside));
    world.insert_resource(SavedLayout::LegacyCells {
        walls: (0..5).map(|y| (3, y)).collect(),
    });
    let divided = RoomTopology::from_world(&world).unwrap();
    assert!(divided.components.is_empty());
    assert_eq!(divided.at((1, 2)), Some(TopologyCell::Outside));
    assert_eq!(divided.at((5, 2)), Some(TopologyCell::Outside));
}

#[test]
fn translated_frozen_legacy_cells_keep_five_rooms_without_sealing_custom_gaps() {
    let mut world = world(24, 20);
    let mut content = terri_data::pack().clone();
    content.lot.house = (16, 12);
    world.insert_resource(crate::Content(Box::leak(Box::new(content))));
    world.insert_resource(crate::LotFrame {
        origin: (4, 3),
        purchased_area: 0,
    });
    let mut walls: Vec<_> = LEGACY_WALL_TILES
        .iter()
        .rev()
        .map(|&(x, y)| (x + 4, y + 3))
        .collect();
    world.insert_resource(SavedLayout::LegacyCells {
        walls: walls.clone(),
    });
    let topology = RoomTopology::from_world(&world).unwrap();
    assert_eq!(topology.components.len(), 5);
    for tile in [(1, 1), (9, 1), (1, 8), (8, 8), (14, 8)] {
        enclosed(&topology, (tile.0 + 4, tile.1 + 3));
    }
    assert_eq!(topology.at((0, 0)), Some(TopologyCell::Outside));
    assert_eq!(topology.at((21, 18)), Some(TopologyCell::Outside));
    for &(x, y) in &LEGACY_WALL_TILES {
        assert_eq!(topology.at((x + 4, y + 3)), Some(TopologyCell::NotFloor));
    }
    walls.pop();
    world.insert_resource(SavedLayout::LegacyCells { walls });
    let custom = RoomTopology::from_world(&world).unwrap();
    assert_eq!(custom.at((18, 11)), Some(TopologyCell::Outside));
    assert!(custom.components.len() < 5);
}

#[test]
fn malformed_geometry_is_rejected_without_a_partial_map() {
    let mut empty = World::new();
    assert_eq!(
        RoomTopology::from_world(&empty),
        Err(RoomError::MissingGrid)
    );
    empty.insert_resource(TileGrid::new(2, 2));
    assert_eq!(
        RoomTopology::from_world(&empty),
        Err(RoomError::MissingLayout)
    );
    for (width, height) in [(0, 2), (2, 0)] {
        assert_eq!(
            RoomTopology::from_world(&world(width, height)),
            Err(RoomError::InvalidDimensions)
        );
    }
    let mut invalid = world(2, 2);
    invalid.insert_resource(SavedLayout::EdgeWallsV1 {
        edges: vec![WallEdge {
            axis: EdgeAxis::Vertical,
            x: 3,
            y: 0,
            doorway: false,
        }],
    });
    assert_eq!(
        RoomTopology::from_world(&invalid),
        Err(RoomError::InvalidArchitecture)
    );
    invalid.insert_resource(SavedLayout::LegacyCells {
        walls: vec![(2, 0)],
    });
    assert_eq!(
        RoomTopology::from_world(&invalid),
        Err(RoomError::InvalidArchitecture)
    );
}
