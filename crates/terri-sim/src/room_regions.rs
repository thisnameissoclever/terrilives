//! Rooms follow architecture, including doorways, rather than furniture occupancy.
use bevy_ecs::world::World;
use terri_core::layout::{EdgeAxis, SavedLayout, LEGACY_WALL_TILES};

pub(crate) struct RoomRegions {
    cells: Vec<Option<u32>>,
    width: usize,
}
impl RoomRegions {
    pub(crate) fn from_world(world: &World) -> Self {
        let grid = world.resource::<terri_core::TileGrid>();
        let layout = world.resource::<SavedLayout>();
        let lot = &world.resource::<crate::Content>().0.lot;
        let width = grid.width();
        let height = grid.height();
        let (house_width, house_height) =
            if (width, height) == (lot.width as usize, lot.height as usize) {
                (lot.house.0 as usize, lot.house.1 as usize)
            } else {
                (width, height)
            };
        let mut floor = vec![false; width * height];
        for y in 0..house_height.min(height) {
            for x in 0..house_width.min(width) {
                floor[y * width + x] = true;
            }
        }
        let walls = match layout {
            SavedLayout::LegacyAuthoredV1 => LEGACY_WALL_TILES.as_slice(),
            SavedLayout::LegacyCells { walls } => walls.as_slice(),
            _ => &[],
        };
        for &(x, y) in walls {
            if (x as usize) < width && (y as usize) < height {
                floor[y as usize * width + x as usize] = false;
            }
        }
        // Bit 1 is the east boundary, bit 2 the south boundary. Doorways
        // separate rooms even though the movement grid lets people through.
        let mut boundaries = vec![0u8; floor.len()];
        let mut block = |axis, x: u32, y: u32| {
            let (x, y) = (x as usize, y as usize);
            match axis {
                EdgeAxis::Vertical if x > 0 && x < width && y < height => {
                    boundaries[y * width + x - 1] |= 1
                }
                EdgeAxis::Horizontal if y > 0 && y < height && x < width => {
                    boundaries[(y - 1) * width + x] |= 2
                }
                _ => {}
            }
        };
        for edge in layout.edges() {
            block(edge.axis, edge.x, edge.y);
        }
        for window in layout.window_lines() {
            block(window.axis, window.x, window.y);
        }
        // The frozen cell-wall house has five known doorway gaps. Retained
        // legacy saves still use them even when migration is inapplicable.
        // Custom cell layouts have no doorway records; their gaps stay open.
        let frozen_legacy = matches!(layout, SavedLayout::LegacyAuthoredV1)
            || matches!(layout, SavedLayout::LegacyCells { walls }
                if walls.len() == LEGACY_WALL_TILES.len()
                && LEGACY_WALL_TILES.iter().all(|tile| walls.contains(tile)));
        if frozen_legacy {
            for (axis, x, y) in [
                (EdgeAxis::Vertical, 8, 2),
                (EdgeAxis::Horizontal, 3, 6),
                (EdgeAxis::Horizontal, 13, 6),
                (EdgeAxis::Vertical, 6, 9),
                (EdgeAxis::Vertical, 12, 8),
            ] {
                block(axis, x, y);
            }
        }
        let mut cells = vec![None; floor.len()];
        let mut queue = Vec::with_capacity(floor.len());
        for seed in 0..floor.len() {
            if !floor[seed] || cells[seed].is_some() {
                continue;
            }
            let region = seed as u32;
            cells[seed] = Some(region);
            queue.clear();
            queue.push(seed);
            let mut cursor = 0;
            // Each cell is marked before enqueueing; the bound also makes a
            // broken visited check fail rather than hanging mutation tests.
            while cursor < queue.len() {
                assert!(cursor < floor.len(), "room flood fill exceeded tile count");
                let cell = queue[cursor];
                cursor += 1;
                let x = cell % width;
                let y = cell / width;
                for next in [
                    (x + 1 < width && boundaries[cell] & 1 == 0).then_some(cell + 1),
                    (y + 1 < height && boundaries[cell] & 2 == 0).then_some(cell + width),
                    (x > 0)
                        .then(|| cell - 1)
                        .filter(|&n| boundaries[n] & 1 == 0),
                    (y > 0)
                        .then(|| cell - width)
                        .filter(|&n| boundaries[n] & 2 == 0),
                ]
                .into_iter()
                .flatten()
                {
                    if floor[next] && cells[next].is_none() {
                        cells[next] = Some(region);
                        queue.push(next);
                    }
                }
            }
        }
        Self { cells, width }
    }
    pub(crate) fn at(&self, tile: (i32, i32)) -> Option<u32> {
        if tile.0 < 0 || tile.1 < 0 || tile.0 as usize >= self.width {
            return None;
        }
        self.cells
            .get(tile.1 as usize * self.width + tile.0 as usize)
            .copied()
            .flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;
    use terri_core::{
        layout::{EdgeAxis, SavedLayout, WallEdge, WallLine},
        TileGrid,
    };

    #[test]
    fn retained_legacy_house_doorways_preserve_five_rooms_without_changing_layout() {
        for layout in [
            SavedLayout::LegacyAuthoredV1,
            SavedLayout::LegacyCells {
                walls: LEGACY_WALL_TILES.iter().rev().copied().collect(),
            },
        ] {
            let mut sim = Sim::new_with_lot(16, 12);
            sim.world_mut().insert_resource(layout.clone());
            let rooms = RoomRegions::from_world(sim.world());
            let mut ids = [(1, 1), (9, 1), (1, 8), (8, 8), (14, 8)]
                .map(|tile| rooms.at(tile).unwrap())
                .to_vec();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), 5);
            for (before, after) in [
                ((7, 2), (8, 2)),
                ((3, 5), (3, 6)),
                ((13, 5), (13, 6)),
                ((5, 9), (6, 9)),
                ((11, 8), (12, 8)),
            ] {
                assert_ne!(rooms.at(before), rooms.at(after));
            }
            assert_eq!(sim.world().resource::<SavedLayout>(), &layout);
        }
    }

    #[test]
    fn room_regions_exclude_yard_and_legacy_walls_but_not_occupied_floor() {
        let mut sim = Sim::new_with_lot(4, 4);
        let mut pack = terri_data::pack().clone();
        pack.lot.width = 4;
        pack.lot.height = 4;
        pack.lot.house = (2, 4);
        sim.world_mut()
            .insert_resource(crate::Content(Box::leak(Box::new(pack))));
        sim.world_mut().insert_resource(SavedLayout::LegacyCells {
            walls: vec![(1, 0)],
        });
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(0, 0, true);
        let rooms = RoomRegions::from_world(sim.world());
        assert!(rooms.at((0, 0)).is_some());
        assert_eq!(rooms.at((1, 0)), None);
        assert_eq!(rooms.at((2, 1)), None);
        assert_eq!(rooms.at((3, 3)), None);
    }

    #[test]
    fn room_regions_separate_doorways_and_windows_but_ignore_furniture() {
        let mut sim = Sim::new_with_lot(6, 4);
        let edges = (0..4)
            .filter(|&y| y != 2)
            .map(|y| WallEdge {
                axis: EdgeAxis::Vertical,
                x: 3,
                y,
                doorway: y == 1,
            })
            .collect();
        sim.world_mut().insert_resource(SavedLayout::from_parts(
            edges,
            vec![WallLine {
                axis: EdgeAxis::Vertical,
                x: 3,
                y: 2,
            }],
        ));
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(1, 1, true);
        let regions = RoomRegions::from_world(sim.world());
        assert_eq!(regions.at((0, 1)), regions.at((1, 1)));
        assert_ne!(regions.at((2, 1)), regions.at((3, 1)));
        assert_ne!(regions.at((2, 2)), regions.at((3, 2)));
        assert_eq!(regions.at((-1, 0)), None);
        assert_eq!(regions.at((6, 0)), None);
        assert_eq!(regions.at((0, 4)), None);
        sim.world_mut()
            .insert_resource(SavedLayout::EdgeWallsV1 { edges: vec![] });
        let open = RoomRegions::from_world(sim.world());
        assert_eq!(open.at((2, 1)), open.at((3, 1)));
    }
    #[test]
    fn typed_wide_windows_keep_rooms_separate_on_both_axes() {
        use terri_core::windows::{WindowModel, WindowPlacement};
        for axis in [EdgeAxis::Vertical, EdgeAxis::Horizontal] {
            let mut sim = Sim::new_with_lot(6, 6);
            let line = |at| WallLine { axis, x: if axis == EdgeAxis::Vertical { 3 } else { at },
                y: if axis == EdgeAxis::Horizontal { 3 } else { at } };
            let edges = (0..6).filter(|at| !(1..4).contains(at)).map(|at| {
                let line = line(at); WallEdge { axis, x: line.x, y: line.y, doorway: false }
            }).collect();
            let layout = SavedLayout::EdgeWallsV3 { edges,
                windows: vec![WindowPlacement { line: line(1), model: WindowModel::Picture }] };
            sim.world_mut().insert_resource(layout.clone());
            let rooms = RoomRegions::from_world(sim.world());
            for at in 1..4 {
                let (before, after) = if axis == EdgeAxis::Vertical { ((2, at), (3, at)) }
                    else { ((at, 2), (at, 3)) };
                assert_ne!(rooms.at(before), rooms.at(after));
            }
            assert_eq!(sim.world().resource::<SavedLayout>(), &layout);
            sim.world_mut().insert_resource(SavedLayout::EdgeWallsV1 { edges: vec![] });
            let open = RoomRegions::from_world(sim.world());
            assert_eq!(open.at((2, 2)), open.at((3, 3)));
        }
    }

}
