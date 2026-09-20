//! The frozen shipped cell-wall house's opt-in transition to interior edges.

use super::{bathtub, capture, Sim};
use std::collections::BTreeSet;
use terri_core::{
    layout::{EdgeAxis, SavedLayout},
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
    for edge in &content.lot.wall_edges {
        let [from, to] = edge.cells();
        grid.set_edge_blocked(from, to, !edge.doorway);
    }
    candidate.world.insert_resource(SavedLayout::EdgeWallsV1 {
        edges: content.lot.wall_edges.clone(),
    });
    candidate
}

fn reviewed_destination(content: &ContentPack) -> bool {
    if content.lot.width != 16
        || content.lot.height != 12
        || !content.lot.walls.is_empty()
        || content.lot.wall_edges.len() != 34
    {
        return false;
    }
    let mut seen = BTreeSet::new();
    content.lot.wall_edges.iter().all(|edge| {
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
        for (width, height) in [(0, 12), (15, 12), (17, 12), (16, 0), (16, 11), (16, 13)] {
            let mut changed = original.clone();
            changed.lot.width = width;
            changed.lot.height = height;
            assert!(changed.lot.walls.is_empty());
            assert_eq!(changed.lot.wall_edges.len(), 34);
            assert!(
                !reviewed_destination(&changed),
                "unexpected {width}x{height} destination"
            );
        }
        assert!(reviewed_destination(original));
    }
}
