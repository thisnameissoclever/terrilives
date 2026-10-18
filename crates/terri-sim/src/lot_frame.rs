//! Where the content lot stands inside the owned land - land expansion,
//! issue 254 (`docs/specs/2026-10-17-land-expansion.md`, rule 3).
//!
//! The content describes one lot: a house in its north-west corner, a front
//! door, a yard east and south of the house. Bought land can lie west or
//! north of that lot, so the content's coordinates no longer start at the
//! grid's origin. The frame records where they start, and everything that
//! reads a content coordinate (the house rectangle, the front door and its
//! landing, the street exit) reads it through here. A world with no frame
//! (a test lot, or an old save whose grid is not the content lot's size)
//! keeps the older rule: the whole grid is house and the content's
//! coordinates are the grid's.
use bevy_ecs::prelude::*;
use terri_core::layout::{EdgeAxis, WallEdge, WallLine};
use terri_core::TileGrid;

use crate::Content;

/// The content lot's north-west corner on the grid, and how many squares of
/// land have been bought since the content lot. Saved in schema thirteen; in
/// the world hash.
#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LotFrame {
    pub origin: (u32, u32),
    pub purchased_area: u32,
}

/// The house's tiles: `x..x + width` by `y..y + height`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HouseRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl HouseRect {
    pub fn contains(&self, x: u32, y: u32) -> bool {
        (self.x..self.x + self.width).contains(&x) && (self.y..self.y + self.height).contains(&y)
    }

    /// The house's implicit north and west shell: the lines the content
    /// never records as walls because they were the lot's edge. With the
    /// house away from the grid's edge they are still walls.
    pub fn rear_lines(&self) -> impl Iterator<Item = WallLine> + '_ {
        let west = (self.y..self.y + self.height).map(|y| WallLine {
            axis: EdgeAxis::Vertical,
            x: self.x,
            y,
        });
        let north = (self.x..self.x + self.width).map(|x| WallLine {
            axis: EdgeAxis::Horizontal,
            x,
            y: self.y,
        });
        west.chain(north)
    }

    /// Whether `line` lies on the implicit shell.
    pub fn is_rear(&self, line: WallLine) -> bool {
        match line.axis {
            EdgeAxis::Vertical => {
                line.x == self.x && (self.y..self.y + self.height).contains(&line.y)
            }
            EdgeAxis::Horizontal => {
                line.y == self.y && (self.x..self.x + self.width).contains(&line.x)
            }
        }
    }
}

/// Blocks the house's implicit shell in `grid` wherever a shell line has
/// land on its outer side: at the grid's edge nothing can cross anyway,
/// but bought land beyond the shell could. A purchase, a lot edit and a
/// load each rebuild a movement grid, and each calls this, so they agree
/// on where the shell stands (rule 3).
pub fn block_shell(grid: &mut TileGrid, house: HouseRect) {
    for line in house.rear_lines() {
        let [outer, inner] = WallEdge {
            axis: line.axis,
            x: line.x,
            y: line.y,
            doorway: false,
        }
        .cells();
        if outer.0 >= 0 && outer.1 >= 0 {
            grid.set_edge_blocked(outer, inner, true);
        }
    }
}

/// The explicit current frame. Historical worlds without current rooms may
/// infer the content origin from matching dimensions.
pub fn frame(world: &World) -> Option<LotFrame> {
    if let Some(frame) = world.get_resource::<LotFrame>() {
        return Some(*frame);
    }
    // Current saves distinguish a blank lot from an authored lot explicitly.
    // Shape inference belongs only to frozen historical restoration.
    if crate::rooms::stable(world) || world.contains_resource::<terri_core::rooms::SavedRooms>() {
        return None;
    }
    let grid = world.get_resource::<TileGrid>()?;
    let lot = &world.get_resource::<Content>()?.0.lot;
    ((grid.width() as u32, grid.height() as u32) == (lot.width, lot.height))
        .then_some(LotFrame::default())
}

/// The content lot's origin on the grid; `(0, 0)` without a frame.
pub fn origin(world: &World) -> (u32, u32) {
    frame(world).map_or((0, 0), |f| f.origin)
}

/// The house, when the world has a frame; `None` means the whole grid.
pub fn house(world: &World) -> Option<HouseRect> {
    let frame = frame(world)?;
    let (width, height) = world.resource::<Content>().0.lot.house;
    Some(HouseRect {
        x: frame.origin.0,
        y: frame.origin.1,
        width,
        height,
    })
}

/// The house, or the whole grid where no frame says otherwise.
pub fn house_or_grid(world: &World) -> HouseRect {
    house(world).unwrap_or_else(|| {
        let (width, height) = world
            .get_resource::<TileGrid>()
            .map_or((0, 0), |grid| (grid.width() as u32, grid.height() as u32));
        HouseRect {
            x: 0,
            y: 0,
            width,
            height,
        }
    })
}

/// The content's front door tile where it now stands.
pub fn front_door(world: &World) -> Option<(u32, u32)> {
    if (crate::rooms::stable(world) || world.contains_resource::<terri_core::rooms::SavedRooms>())
        && frame(world).is_none()
    {
        return None;
    }
    let (ox, oy) = origin(world);
    world
        .resource::<Content>()
        .0
        .lot
        .front_door
        .map(|(x, y)| (x + ox, y + oy))
}

/// The content's portals where they now stand.
pub fn portals(world: &World) -> Vec<terri_data::CompiledPortal> {
    if (crate::rooms::stable(world) || world.contains_resource::<terri_core::rooms::SavedRooms>())
        && frame(world).is_none()
    {
        return vec![];
    }
    let (ox, oy) = origin(world);
    world
        .resource::<Content>()
        .0
        .portals
        .iter()
        .map(|portal| shift_portal(portal, (ox, oy)))
        .collect()
}

pub fn shift_portal(
    portal: &terri_data::CompiledPortal,
    (ox, oy): (u32, u32),
) -> terri_data::CompiledPortal {
    let mut moved = portal.clone();
    moved.position = (portal.position.0 + ox, portal.position.1 + oy);
    moved.inward = (portal.inward.0 + ox, portal.inward.1 + oy);
    moved
}

/// The front door matched to its portal, where it now stands.
pub fn front_portal(world: &World) -> Option<terri_data::CompiledPortal> {
    let door = front_door(world)?;
    portals(world).into_iter().find(|p| p.position == door)
}

/// The street's exit: the grid's last column on the front door's row, when
/// a yard lies beyond the door ([OS-street]).
pub fn street_exit(world: &World) -> Option<(u32, u32)> {
    let width = world.resource::<TileGrid>().width() as u32;
    let door = front_portal(world)?;
    (door.facing == terri_data::CompiledSocketFacing::PositiveX && door.position.0 + 1 < width)
        .then(|| (width - 1, door.position.1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_house_knows_its_tiles_and_its_implicit_shell() {
        let house = HouseRect {
            x: 10,
            y: 0,
            width: 16,
            height: 12,
        };
        assert!(house.contains(10, 0));
        assert!(house.contains(25, 11));
        assert!(!house.contains(9, 0));
        assert!(!house.contains(26, 0));
        assert!(!house.contains(10, 12));
        let lines: Vec<_> = house.rear_lines().collect();
        assert_eq!(lines.len(), 28);
        assert!(lines.iter().all(|line| house.is_rear(*line)));
        assert!(house.is_rear(WallLine {
            axis: EdgeAxis::Vertical,
            x: 10,
            y: 11
        }));
        assert!(!house.is_rear(WallLine {
            axis: EdgeAxis::Vertical,
            x: 10,
            y: 12
        }));
        assert!(!house.is_rear(WallLine {
            axis: EdgeAxis::Vertical,
            x: 11,
            y: 0
        }));
        assert!(house.is_rear(WallLine {
            axis: EdgeAxis::Horizontal,
            x: 25,
            y: 0
        }));
        assert!(!house.is_rear(WallLine {
            axis: EdgeAxis::Horizontal,
            x: 26,
            y: 0
        }));
    }

    /// Two frames that differ only in where the content lot sits hash
    /// differently, since a frame other than the default enters the world
    /// hash; a saved default frame hashes as a world with no saved frame.
    #[test]
    fn a_moved_frame_changes_the_world_hash() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        sim.world_mut().remove_resource::<LotFrame>();
        let without = sim.world_hash();
        let mut at = |origin| {
            sim.world_mut().insert_resource(LotFrame {
                origin,
                purchased_area: 0,
            });
            sim.world_hash()
        };
        let east = at((2, 0));
        let south = at((0, 3));
        assert_ne!(east, south);
        assert_ne!(east, without);
        assert_eq!(at((0, 0)), without);
    }

    /// Without a frame the content's coordinates are the grid's; with one
    /// they move with the origin, the street staying on the last column.
    #[test]
    fn content_coordinates_follow_the_frame() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        let content = sim.world().resource::<Content>().0;
        let door = content.lot.front_door.unwrap();
        let landing = content
            .portals
            .iter()
            .find(|p| p.position == door)
            .unwrap()
            .inward;
        assert_eq!(frame(sim.world()).map(|f| f.origin), Some((0, 0)));
        assert_eq!(front_door(sim.world()), Some(door));
        assert_eq!(street_exit(sim.world()), Some((19, door.1)));
        assert_eq!(
            house(sim.world()),
            Some(HouseRect {
                x: 0,
                y: 0,
                width: 16,
                height: 12
            })
        );
        // Two tiles east and three south: the door still has yard beyond it.
        sim.world_mut().insert_resource(LotFrame {
            origin: (2, 3),
            purchased_area: 0,
        });
        assert_eq!(front_door(sim.world()), Some((door.0 + 2, door.1 + 3)));
        assert_eq!(
            front_portal(sim.world()).map(|p| p.inward),
            Some((landing.0 + 2, landing.1 + 3))
        );
        assert_eq!(street_exit(sim.world()), Some((19, door.1 + 3)));
        assert_eq!(house(sim.world()).map(|h| (h.x, h.y)), Some((2, 3)));
        // Pushed against the street there is no yard beyond the door.
        sim.world_mut().insert_resource(LotFrame {
            origin: (4, 0),
            purchased_area: 0,
        });
        assert_eq!(street_exit(sim.world()), None);
        // Current blankness is explicit; only historical interpretation infers shape.
        sim.world_mut().remove_resource::<LotFrame>();
        assert_eq!(house(sim.world()), None);
        let mut historical = bevy_ecs::world::World::new();
        historical.insert_resource(Content(content));
        historical.insert_resource(TileGrid::new(
            content.lot.width as usize,
            content.lot.height as usize,
        ));
        assert_eq!(house(&historical).map(|h| (h.x, h.y)), Some((0, 0)));
        let mut custom = crate::Sim::new_with_lot(8, 8);
        assert_eq!(house(custom.world()), None);
        assert_eq!(house_or_grid(custom.world()).width, 8);
        custom.world_mut().insert_resource(LotFrame {
            origin: (1, 1),
            purchased_area: 0,
        });
        assert_eq!(house(custom.world()).map(|h| (h.x, h.y)), Some((1, 1)));
    }
}
