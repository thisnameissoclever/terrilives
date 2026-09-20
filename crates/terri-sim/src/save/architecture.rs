//! V2 architecture validation. Historical world migration is a separate step.

use super::{SaveError, Sim};
use crate::portals::ActivePortals;
use std::collections::BTreeSet;
use terri_core::{layout::SavedLayout, SaveSnapshotV2, TileGrid};
use terri_data::ContentPack;

pub(crate) fn restore(
    snapshot: SaveSnapshotV2,
    content: &'static ContentPack,
    active_portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    // V2 is complete and current: do not apply V1's optional-tail repair or
    // reinterpret a saved layout from whatever lot content now happens to be.
    super::validate_snapshot(&snapshot.world, content)?;
    let mut candidate = super::restore_legacy(snapshot.world, content, active_portals)?;
    let grid = candidate.world.resource_mut::<TileGrid>();
    apply_layout(grid.into_inner(), &snapshot.layout)?;
    super::validate_portal_returns(
        &candidate.save_snapshot(),
        candidate.world.resource::<TileGrid>(),
        content,
    )?;
    if matches!(snapshot.layout, SavedLayout::EdgeWallsV1 { .. }) {
        validate_edge_world(
            &candidate.save_snapshot(),
            candidate.world.resource::<TileGrid>(),
            content,
        )?;
    }
    candidate.world.insert_resource(snapshot.layout);
    Ok(candidate)
}

fn validate_edge_world(
    snapshot: &terri_core::SaveSnapshotV1,
    grid: &TileGrid,
    content: &ContentPack,
) -> Result<(), SaveError> {
    for entity in &snapshot.entities {
        let Some(position) = entity.position else {
            continue;
        };
        let tile = (position.x.round() as i32, position.y.round() as i32);
        if let Some(id) = &entity.smart_object {
            let footprint = content
                .object(content.find(id).ok_or(SaveError::InvalidContentReference)?)
                .footprint;
            let origin = (position.x.floor() as i32, position.y.floor() as i32);
            for (a, b) in grid.blocked_edges() {
                let inside = |p: (i32, i32)| {
                    p.0 >= origin.0
                        && p.1 >= origin.1
                        && p.0 < origin.0 + footprint.width as i32
                        && p.1 < origin.1 + footprint.depth as i32
                };
                if inside(a) && inside(b) {
                    return Err(SaveError::InvalidGrid);
                }
            }
        }
        if !entity.agent {
            continue;
        }
        if !grid.is_walkable(tile.0, tile.1) {
            return Err(SaveError::InvalidGrid);
        }
        if let Some(path) = &entity.path {
            let remaining = &path.steps[path.cursor as usize..];
            let mut previous = (position.x, position.y);
            for &(x, y) in remaining {
                let next = (x as f32, y as f32);
                if !grid.is_walkable(x, y) || !grid.segment_can_cross(previous, next) {
                    return Err(SaveError::InvalidGrid);
                }
                previous = next;
            }
            if remaining
                .windows(2)
                .any(|pair| pair[0] != pair[1] && !grid.can_step(pair[0], pair[1]))
            {
                return Err(SaveError::InvalidGrid);
            }
            if let Some(target) = entity.target {
                let target_entity = snapshot
                    .entities
                    .binary_search_by_key(&target.object, |e| e.index)
                    .ok()
                    .map(|i| &snapshot.entities[i])
                    .ok_or(SaveError::InvalidEntityReference)?;
                // Furniture stays put. A person may have been redirected while
                // this agent approached; that stale social route is checked at
                // arrival rather than rejecting a legitimate running save.
                if let Some(id) = &target_entity.smart_object {
                    let at = target_entity.position.ok_or(SaveError::InvalidGrid)?;
                    let footprint = content
                        .object(content.find(id).ok_or(SaveError::InvalidContentReference)?)
                        .footprint;
                    let endpoint = remaining.last().copied().unwrap_or(tile);
                    if !valid_contact(grid, endpoint, at, footprint) {
                        return Err(SaveError::InvalidGrid);
                    }
                }
            }
        }
        let contact = if let Some(talk) = entity.socialising {
            Some(talk.partner)
        } else if entity.path.is_none()
            && (entity.eating.is_some() || entity.step_work_ticks.is_some())
        {
            entity.target.map(|t| t.object)
        } else {
            None
        };
        if let Some(index) = contact {
            let target = snapshot
                .entities
                .binary_search_by_key(&index, |e| e.index)
                .ok()
                .map(|i| &snapshot.entities[i])
                .ok_or(SaveError::InvalidEntityReference)?;
            let at = target.position.ok_or(SaveError::InvalidGrid)?;
            let footprint = target
                .smart_object
                .as_deref()
                .and_then(|id| content.find(id))
                .map(|id| content.object(id).footprint)
                .unwrap_or(terri_core::Footprint::SINGLE);
            if !valid_contact(grid, tile, at, footprint) {
                return Err(SaveError::InvalidGrid);
            }
        }
    }
    Ok(())
}

/// Saved coordinates are untrusted even after the finite-number check. Bound
/// the rectangle before calling grid arithmetic that assumes authored inputs.
fn valid_contact(
    grid: &TileGrid,
    from: (i32, i32),
    at: terri_core::save::SavedPosition,
    footprint: terri_core::Footprint,
) -> bool {
    let (x, y) = (at.x.round() as i64, at.y.round() as i64);
    if x < 0 || y < 0 || x >= grid.width() as i64 || y >= grid.height() as i64 {
        return false;
    }
    if x + footprint.width as i64 > grid.width() as i64
        || y + footprint.depth as i64 > grid.height() as i64
    {
        return false;
    }
    grid.can_interact_with_rect(from, (x as i32, y as i32), footprint)
}

fn apply_layout(grid: &mut TileGrid, layout: &SavedLayout) -> Result<(), SaveError> {
    match layout {
        SavedLayout::LegacyAuthoredV1 => {}
        SavedLayout::LegacyCells { walls } => {
            let mut seen = BTreeSet::new();
            for &(x, y) in walls {
                if x as usize >= grid.width()
                    || y as usize >= grid.height()
                    || grid.is_walkable(x as i32, y as i32)
                    || !seen.insert((x, y))
                {
                    return Err(SaveError::InvalidGrid);
                }
            }
        }
        SavedLayout::EdgeWallsV1 { edges } => {
            let mut seen = BTreeSet::new();
            for &edge in edges {
                if !edge.in_bounds(grid.width() as u32, grid.height() as u32)
                    || !seen.insert((edge.axis, edge.x, edge.y))
                {
                    return Err(SaveError::InvalidGrid);
                }
                if !edge.doorway {
                    let [from, to] = edge.cells();
                    grid.set_edge_blocked(from, to, true);
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::layout::{EdgeAxis, WallEdge};

    fn edge(x: u32, doorway: bool) -> WallEdge {
        WallEdge {
            axis: EdgeAxis::Vertical,
            x,
            y: 1,
            doorway,
        }
    }

    fn shipped_worker(sim: &mut Sim) -> terri_core::Entity {
        let mut careers = sim
            .world_mut()
            .query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<terri_core::Career>>();
        careers
            .iter(sim.world())
            .next()
            .expect("the shipped household has a worker")
    }

    #[test]
    fn v2_load_preserves_the_callers_active_portal_scene() {
        let mut shipped = Sim::new_from_shipped_lot();
        let saved = shipped.save_snapshot_v2();

        shipped.load_snapshot_v2(saved.clone()).unwrap();
        assert!(shipped.world().contains_resource::<ActivePortals>());
        assert_eq!(shipped.portal_buffer().states.len(), 1);

        let mut blank = Sim::new();
        blank.load_snapshot_v2(saved).unwrap();
        assert!(!blank.world().contains_resource::<ActivePortals>());
        assert!(blank.portal_buffer().states.is_empty());
    }

    #[test]
    fn v2_rejects_a_future_portal_return_through_a_solid_saved_edge() {
        let mut source = Sim::new_from_shipped_lot();
        let worker = shipped_worker(&mut source);
        source.world_mut().entity_mut(worker).insert((
            terri_core::Position { x: 15.0, y: 2.0 },
            terri_core::AtWork { remaining_ticks: 1 },
        ));
        source
            .world_mut()
            .entity_mut(worker)
            .remove::<(terri_core::Commuting, terri_core::Path)>();
        let mut saved = source.save_snapshot_v2();
        let return_edge = WallEdge {
            axis: EdgeAxis::Horizontal,
            x: 15,
            y: 3,
            doorway: false,
        };
        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![return_edge],
        };

        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v2();
        assert_eq!(
            live.load_snapshot_v2(saved.clone()),
            Err(SaveError::InvalidGrid)
        );
        assert_eq!(live.save_snapshot_v2(), before);
        assert!(live.world().contains_resource::<ActivePortals>());

        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                doorway: true,
                ..return_edge
            }],
        };
        live.load_snapshot_v2(saved).unwrap();
        live.tick();
        let worker = live.world().entities().resolve_from_index(worker.index());
        assert_eq!(
            live.world()
                .get::<terri_core::Path>(worker)
                .and_then(|path| path.steps.last())
                .copied(),
            Some((15, 3)),
            "an open saved edge permits the authored return landing"
        );
    }

    #[test]
    fn v2_rejects_an_at_work_position_whose_return_segment_crosses_a_saved_edge() {
        let mut source = Sim::new_from_shipped_lot();
        let worker = shipped_worker(&mut source);
        source.world_mut().entity_mut(worker).insert((
            terri_core::Position { x: 13.0, y: 3.0 },
            terri_core::AtWork { remaining_ticks: 1 },
        ));
        source
            .world_mut()
            .entity_mut(worker)
            .remove::<(terri_core::Commuting, terri_core::Path)>();
        let mut saved = source.save_snapshot_v2();
        let crossed_edge = WallEdge {
            axis: EdgeAxis::Vertical,
            x: 14,
            y: 3,
            doorway: false,
        };
        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![crossed_edge],
        };

        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v2();
        assert_eq!(
            live.load_snapshot_v2(saved.clone()),
            Err(SaveError::InvalidGrid)
        );
        assert_eq!(live.save_snapshot_v2(), before);

        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                doorway: true,
                ..crossed_edge
            }],
        };
        live.load_snapshot_v2(saved).unwrap();
        live.tick();
        let worker = live.world().entities().resolve_from_index(worker.index());
        assert_eq!(
            live.world()
                .get::<terri_core::Path>(worker)
                .and_then(|path| path.steps.last())
                .copied(),
            Some((15, 3)),
            "an open saved edge permits the worker's actual return segment"
        );
    }

    #[test]
    fn v2_rejects_a_solid_future_portal_route_while_the_worker_is_home() {
        let source = Sim::new_from_shipped_lot();
        let mut saved = source.save_snapshot_v2();
        let return_edge = WallEdge {
            axis: EdgeAxis::Horizontal,
            x: 15,
            y: 3,
            doorway: false,
        };
        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![return_edge],
        };

        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v2();
        assert_eq!(
            live.load_snapshot_v2(saved.clone()),
            Err(SaveError::InvalidGrid)
        );
        assert_eq!(live.save_snapshot_v2(), before);

        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                doorway: true,
                ..return_edge
            }],
        };
        live.load_snapshot_v2(saved).unwrap();
    }

    #[test]
    fn v1_rejects_a_blocked_future_portal_landing_transactionally() {
        let source = Sim::new_from_shipped_lot();
        let open = source.save_snapshot();
        let mut blocked = open.clone();
        blocked.blocked_tiles[3 * blocked.grid_width as usize + 15] = true;

        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v2();
        assert_eq!(live.load_snapshot(blocked), Err(SaveError::InvalidGrid));
        assert_eq!(live.save_snapshot_v2(), before);
        assert!(live.world().contains_resource::<ActivePortals>());

        live.load_snapshot(open).unwrap();
        assert!(live.world().contains_resource::<ActivePortals>());
    }

    #[test]
    fn v2_restores_geometry_from_the_save_not_live_authored_content() {
        let mut live = Sim::new_with_lot(5, 4);
        let mut saved = live.save_snapshot_v2();
        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![edge(2, false), edge(3, true)],
        };
        live.load_snapshot_v2(saved.clone()).unwrap();
        assert_eq!(live.save_snapshot_v2(), saved);
        let grid = live.world.resource::<TileGrid>();
        assert!(!grid.can_step((1, 1), (2, 1)));
        assert!(!grid.can_step((2, 1), (1, 1)));
        assert!(grid.can_step((2, 1), (3, 1)));
        let mut resumed = Sim::new();
        resumed.load_snapshot_v2(saved).unwrap();
        for _ in 0..20 {
            live.tick();
            resumed.tick();
        }
        assert_eq!(resumed.save_snapshot_v2(), live.save_snapshot_v2());
    }

    #[test]
    fn invalid_v2_geometry_never_replaces_the_live_world() {
        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v2();
        for edges in [
            vec![edge(0, false)],
            vec![edge(2, false), edge(2, true)],
            vec![edge(u32::MAX, false)],
        ] {
            let mut invalid = before.clone();
            invalid.layout = SavedLayout::EdgeWallsV1 { edges };
            assert_eq!(live.load_snapshot_v2(invalid), Err(SaveError::InvalidGrid));
            assert_eq!(live.save_snapshot_v2(), before);
        }
    }

    #[test]
    fn custom_v1_collision_survives_v2_resave_without_inventing_architecture() {
        let mut custom = Sim::new_with_lot(3, 4);
        custom
            .world
            .resource_mut::<TileGrid>()
            .set_blocked(1, 2, true);
        let old = custom.save_snapshot();
        let mut live = Sim::new_from_shipped_lot();
        live.load_snapshot(old.clone()).unwrap();
        let v2 = live.save_snapshot_v2();
        assert_eq!(v2.world, old);
        assert_eq!(v2.layout, SavedLayout::LegacyAuthoredV1);
        let mut resumed = Sim::new();
        resumed.load_snapshot_v2(v2.clone()).unwrap();
        assert_eq!(resumed.save_snapshot_v2(), v2);
    }

    #[test]
    fn edge_world_rejects_a_saved_route_through_a_boundary() {
        let mut live = Sim::new_with_lot(5, 4);
        live.world.spawn((
            terri_core::Agent,
            terri_core::Position { x: 1.0, y: 1.0 },
            terri_core::Path {
                steps: vec![(2, 1)],
                cursor: 0,
            },
        ));
        let before = live.save_snapshot_v2();
        let mut impossible = before.clone();
        impossible.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![edge(2, false)],
        };
        assert_eq!(
            live.load_snapshot_v2(impossible),
            Err(SaveError::InvalidGrid)
        );
        assert_eq!(live.save_snapshot_v2(), before);
        let mut doorway = before;
        doorway.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![edge(2, true)],
        };
        live.load_snapshot_v2(doorway).unwrap();
    }

    #[test]
    fn static_target_paths_must_end_at_an_open_contact_even_when_exhausted() {
        use terri_core::{Agent, Path, Position, Reserved, Target};
        let mut live = Sim::new_with_lot(5, 4);
        let fridge = live
            .world
            .resource::<crate::Content>()
            .0
            .find("fridge")
            .unwrap();
        let object = live.spawn_object(Position { x: 3.0, y: 1.0 }, fridge);
        live.world.entity_mut(object).insert(Reserved);
        live.world
            .resource_mut::<TileGrid>()
            .set_blocked(3, 1, true);
        let agent = live
            .world
            .spawn((
                Agent,
                Position { x: 2.0, y: 1.0 },
                Target {
                    object,
                    interaction: 0,
                },
                Path {
                    steps: vec![],
                    cursor: 0,
                },
            ))
            .id();
        for steps in [vec![], vec![(2, 1)], vec![(2, 0), (2, 1)]] {
            live.world
                .entity_mut(agent)
                .insert(Path { steps, cursor: 0 });
            let mut snapshot = live.save_snapshot_v2();
            snapshot.layout = SavedLayout::EdgeWallsV1 {
                edges: vec![edge(3, false)],
            };
            assert_eq!(
                restore(snapshot.clone(), terri_data::pack(), None).err(),
                Some(SaveError::InvalidGrid)
            );
            snapshot.layout = SavedLayout::EdgeWallsV1 {
                edges: vec![edge(3, true)],
            };
            assert!(restore(snapshot, terri_data::pack(), None).is_ok());
        }
    }

    #[test]
    fn extreme_finite_contact_targets_reject_without_panicking_or_replacing_the_world() {
        use terri_core::{Agent, Path, Position, Reserved, Target};
        let mut live = Sim::new_with_lot(5, 4);
        let bed = terri_data::pack().find("bed").unwrap();
        let object = live.spawn_object(Position { x: 2.0, y: 2.0 }, bed);
        live.world.entity_mut(object).insert(Reserved);
        live.world.spawn((
            Agent,
            Position { x: 0.0, y: 2.0 },
            Target {
                object,
                interaction: 0,
            },
            Path {
                steps: vec![],
                cursor: 0,
            },
        ));
        let before = live.save_snapshot_v2();
        for (x, y) in [(f32::MAX, -f32::MAX), (-f32::MAX, 2.0), (f32::MAX, 2.0)] {
            for walking in [true, false] {
                let mut invalid = before.clone();
                invalid.layout = SavedLayout::EdgeWallsV1 {
                    edges: vec![edge(4, false)],
                };
                invalid
                    .world
                    .entities
                    .iter_mut()
                    .find(|e| e.index == object.index_u32())
                    .unwrap()
                    .position = Some(terri_core::save::SavedPosition { x, y });
                if !walking {
                    let agent = invalid.world.entities.iter_mut().find(|e| e.agent).unwrap();
                    agent.path = None;
                    agent.eating = Some(terri_core::save::SavedEating {
                        object: "bed".into(),
                        interaction: 0,
                        remaining_ticks: 1,
                    });
                }
                assert_eq!(live.load_snapshot_v2(invalid), Err(SaveError::InvalidGrid));
                assert_eq!(live.save_snapshot_v2(), before);
            }
        }
    }
}
