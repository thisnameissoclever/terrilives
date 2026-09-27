//! [OS-migrate] in `docs/specs/2026-09-22-the-outside.md`: a house saved
//! before the yard grows into it on Load.

use super::Sim;
use terri_core::{
    layout::{SavedLayout, WallEdge},
    TileGrid,
};
use terri_data::ContentPack;

/// Grows `sim`, a restored world that passed every check, into the content's
/// lot when its grid is exactly the content's house and its walls are edges.
///
/// The grid takes the lot's size, with each saved blocked tile kept at its own
/// coordinates. The content's walls that are not inside the house, its
/// outside walls and any wall in the yard, join the saved walls, and every
/// edge barrier is rebuilt from that list, as a load builds them. The house's
/// outside lines were the lot's edge when it was saved, where no wall could
/// stand, so nothing saved is replaced. Any other world is left as it is: one
/// already at the lot's size, and one saved before edge walls, which keeps
/// its frozen layout.
pub(crate) fn grow(sim: &mut Sim, content: &ContentPack) {
    let lot = &content.lot;
    let (house_width, house_height) = lot.house;
    let grid = sim.world.resource::<TileGrid>();
    if (grid.width(), grid.height()) != (house_width as usize, house_height as usize) {
        return;
    }
    let Some(layout) = sim
        .world
        .get_resource::<SavedLayout>()
        .filter(|l| l.has_edges())
    else {
        return;
    };
    let mut grown = TileGrid::new(lot.width as usize, lot.height as usize);
    for y in 0..grid.height() {
        for x in 0..grid.width() {
            grown.set_blocked(x, y, !grid.is_walkable(x as i32, y as i32));
        }
    }
    let windows = layout.windows().to_vec();
    let edges: Vec<WallEdge> = layout
        .edges()
        .iter()
        .chain(
            lot.wall_edges
                .iter()
                .filter(|edge| !edge.in_bounds(house_width, house_height)),
        )
        .copied()
        .collect();
    for edge in &edges {
        let [from, to] = edge.cells();
        grown.set_edge_blocked(from, to, !edge.doorway);
    }
    // [WN-rules]: a grown house keeps its windows, and each still blocks.
    for window in &windows {
        let [from, to] = WallEdge {
            axis: window.axis,
            x: window.x,
            y: window.y,
            doorway: false,
        }
        .cells();
        grown.set_edge_blocked(from, to, true);
    }
    sim.world.insert_resource(grown);
    sim.world
        .insert_resource(SavedLayout::from_parts(edges, windows));
}

#[cfg(test)]
#[path = "yard_tests.rs"]
mod tests;
