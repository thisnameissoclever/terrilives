use super::*;
use terri_core::layout::{SavedLayout, WallEdge, WallState};

pub(super) fn rooms(
    map: &RoomMap,
    saved: &SavedRooms,
    before: &RoomMap,
    old: &SavedRooms,
) -> Vec<BuildRoomReview> {
    let outside = |map: &RoomMap| {
        map.topology
            .cells
            .iter()
            .filter(|c| **c == TopologyCell::Outside)
            .count() as u32
    };
    let mut rows = vec![BuildRoomReview {
        selection: RoomSelection::Outside,
        anchor: None,
        name: saved.outside_name.clone(),
        previous_name: Some(old.outside_name.clone()),
        previous_area: outside(before),
        area: outside(map),
    }];
    for (component, id) in map.topology.components.iter().zip(&map.component_ids) {
        let previous = before.component_ids.iter().position(|old| old == id);
        rows.push(BuildRoomReview {
            selection: RoomSelection::Room(*id),
            anchor: Some(component.anchor),
            name: saved.record(*id).unwrap().name.clone(),
            previous_name: old.record(*id).map(|r| r.name.clone()),
            previous_area: previous.map_or(0, |i| before.topology.components[i].cells.len() as u32),
            area: component.cells.len() as u32,
        });
    }
    rows
}

pub(super) fn groups(
    proposal: &RoomMatchProposal,
    before: &RoomMap,
    offset: (i32, i32),
    old: &SavedLayout,
    final_layout: &SavedLayout,
) -> Vec<BuildGroupReview> {
    proposal
        .groups
        .iter()
        .map(|change| {
            let mut former_tiles = Vec::new();
            for id in &change.old_ids {
                if let Some(i) = before.component_ids.iter().position(|old| old == id) {
                    former_tiles.extend(before.topology.components[i].cells.iter().map(|cell| {
                        (
                            ((cell % before.topology.width) as i32 + offset.0) as u32,
                            ((cell / before.topology.width) as i32 + offset.1) as u32,
                        )
                    }));
                }
            }
            former_tiles.sort_unstable();
            former_tiles.dedup();
            let mut lines: Vec<_> = old
                .edges()
                .iter()
                .map(|edge| WallLine {
                    axis: edge.axis,
                    x: edge.x,
                    y: edge.y,
                })
                .collect();
            for window in old.window_placements() {
                if let Some(window_lines) = window.checked_lines() {
                    lines.extend(window_lines);
                }
            }
            let openings = lines
                .into_iter()
                .map(|line| WallLine {
                    axis: line.axis,
                    x: (line.x as i32 + offset.0) as u32,
                    y: (line.y as i32 + offset.1) as u32,
                })
                .filter(|line| {
                    final_layout.state_of(*line) == WallState::Open
                        && (WallEdge {
                            axis: line.axis,
                            x: line.x,
                            y: line.y,
                            doorway: false,
                        })
                        .cells()
                        .iter()
                        .any(|&(x, y)| {
                            x >= 0
                                && y >= 0
                                && former_tiles.binary_search(&(x as u32, y as u32)).is_ok()
                        })
                })
                .collect();
            BuildGroupReview {
                change: change.clone(),
                former_tiles,
                openings,
            }
        })
        .collect()
}
