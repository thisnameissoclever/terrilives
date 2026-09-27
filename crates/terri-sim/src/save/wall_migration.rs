//! The frozen shipped cell-wall house's opt-in transition to interior edges.

use super::{bathtub, capture, Sim};
use std::collections::BTreeSet;
use terri_core::{
    layout::{EdgeAxis, SavedLayout, WallEdge},
    TileGrid,
};
use terri_data::ContentPack;

pub(super) fn upgrade(mut candidate: Sim, content: &ContentPack) -> Sim {
    // The inverse bathtub digest pins the complete reviewed footprint set.
    // A matching digest alone does not prove where objects or walls stood.
    if !reviewed_destination(content)
        || bathtub::reviewed_source(content).is_none()
        || bathtub::source_layout::validate(&capture(&candidate), content).is_err()
    {
        return candidate;
    }

    let mut grid = candidate.world.resource_mut::<TileGrid>();
    for (x, y) in bathtub::source_layout::WALLS {
        grid.set_blocked(x, y, false);
    }
    for edge in house_edges(content) {
        let [from, to] = edge.cells();
        grid.set_edge_blocked(from, to, !edge.doorway);
    }
    candidate.world.insert_resource(SavedLayout::EdgeWallsV1 {
        edges: house_edges(content).copied().collect(),
    });
    candidate
}

/// The walls inside the house ([OS-grow]). A V1 save holds the house alone,
/// whose edge was then the lot's, so the walls on its outside lines join it
/// when it grows into the yard ([OS-migrate]), not here.
fn house_edges(content: &ContentPack) -> impl Iterator<Item = &WallEdge> {
    let (width, height) = content.lot.house;
    content
        .lot
        .wall_edges
        .iter()
        .filter(move |edge| edge.in_bounds(width, height))
}

fn reviewed_destination(content: &ContentPack) -> bool {
    if content.lot.house != (16, 12)
        || !content.lot.walls.is_empty()
        || house_edges(content).count() != 34
    {
        return false;
    }
    let mut seen = BTreeSet::new();
    house_edges(content).all(|edge| {
        let doorway = match (edge.axis, edge.x, edge.y) {
            (EdgeAxis::Vertical, 8, 0..=5) => edge.y == 2,
            (EdgeAxis::Horizontal, 0..=15, 6) => edge.x == 3 || edge.x == 13,
            (EdgeAxis::Vertical, 6, 6..=11) => edge.y == 9,
            (EdgeAxis::Vertical, 12, 6..=11) => edge.y == 8,
            _ => return false,
        };
        edge.doorway == doorway && seen.insert((edge.axis, edge.x, edge.y))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reviewed_destination_requires_each_frozen_dimension_independently() {
        let original = terri_data::pack();
        assert!(reviewed_destination(original));
        // A house of another size, with only the 34 reviewed walls, so its
        // size is the one thing that differs ([OS-grow]).
        for (width, height) in [(0, 12), (15, 12), (17, 12), (16, 0), (16, 11), (16, 13)] {
            let mut changed = original.clone();
            changed.lot.house = (width, height);
            changed.lot.wall_edges.retain(|edge| edge.in_bounds(16, 12));
            assert!(changed.lot.walls.is_empty());
            assert_eq!(changed.lot.wall_edges.len(), 34);
            assert!(
                !reviewed_destination(&changed),
                "unexpected {width}x{height} destination"
            );
        }
        assert!(reviewed_destination(original));
    }

    /// [OS-grow]: the reviewed house is judged by its own walls, whatever
    /// the lot around it holds, and a V1 house takes only those walls.
    #[test]
    fn the_reviewed_destination_is_the_house_not_the_lot() {
        let original = terri_data::pack();
        assert_eq!(original.lot.wall_edges.len(), 34 + 28);
        assert_eq!(house_edges(original).count(), 34);
        let mut house_only = original.clone();
        house_only.lot.width = 16;
        house_only.lot.height = 12;
        house_only
            .lot
            .wall_edges
            .retain(|edge| edge.in_bounds(16, 12));
        assert!(reviewed_destination(&house_only));
    }
}
