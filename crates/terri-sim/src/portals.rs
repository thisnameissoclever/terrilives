//! Deterministic presentation projection for authored lot portals.

use bevy_ecs::prelude::*;
use terri_core::{Agent, AtWork, Career, Commuting, Path, Position};

use crate::Content;

/// Stable renderer state codes. Keep these aligned with the TypeScript shell.
pub const CLOSED: u32 = 0;
pub const OPENING: u32 = 1;
pub const OPEN: u32 = 2;
pub const CLOSING: u32 = 3;

/// The portal rows belonging to the lot this world actually loaded.
///
/// [`Content`] is a catalog and exists even in placeholder and custom-room
/// simulations. Keeping the active slice separate prevents those worlds from
/// drawing the shipped lot's front door merely because they share its object
/// and tuning catalog. This resource is presentation-only. Career routing
/// reads the fingerprinted [`Content`] portal rows so replay cannot depend on
/// unpersisted runtime presentation state.
#[derive(Resource, Debug, Clone, Copy)]
pub struct ActivePortals(pub &'static [terri_data::CompiledPortal]);

impl ActivePortals {
    pub fn from_content(content: &'static terri_data::ContentPack) -> Self {
        Self(&content.portals)
    }
}

/// Structure-of-arrays portal presentation consumed by the renderer.
#[derive(Debug, Default)]
pub struct PortalBuffer {
    pub positions: Vec<f32>,
    pub depth_offsets: Vec<f32>,
    pub frames: Vec<u32>,
    pub leaves: Vec<u32>,
    pub reduced_leaves: Vec<u32>,
    pub states: Vec<u32>,
}

/// Rebuilds the complete portal presentation projection from simulation state.
pub fn sync_portals(world: &mut World, buffer: &mut PortalBuffer) {
    buffer.positions.clear();
    buffer.depth_offsets.clear();
    buffer.frames.clear();
    buffer.leaves.clear();
    buffer.reduced_leaves.clear();
    buffer.states.clear();

    let Some(portals) = world.get_resource::<ActivePortals>().map(|active| active.0) else {
        return;
    };
    let content: &'static terri_data::ContentPack = world.resource::<Content>().0;

    let mut people = world.query_filtered::<(
        &Position,
        Option<&Path>,
        Has<Commuting>,
        Option<&AtWork>,
        Option<&Career>,
    ), With<Agent>>();

    for portal in portals {
        let mut state = CLOSED;
        for (position, path, commuting, at_work, career) in people.iter(world) {
            let candidate = project_person(
                position,
                path,
                commuting,
                at_work,
                career.and_then(|career| content.careers.get(career.0 as usize)),
                portal.position,
                portal.inward,
            );
            if priority(candidate) > priority(state) {
                state = candidate;
            }
        }

        buffer
            .positions
            .extend([portal.position.0 as f32, portal.position.1 as f32]);
        let (outward_x, outward_y) = outward_delta(portal.facing);
        buffer.depth_offsets.push(0.5 * (outward_x + outward_y));
        buffer.frames.push(portal.frame_sprite);
        buffer.leaves.push(match state {
            CLOSED => portal.closed_sprite,
            OPEN => portal.open_sprite,
            OPENING | CLOSING => portal.ajar_sprite,
            _ => unreachable!("portal state is produced locally"),
        });
        buffer.reduced_leaves.push(if state == CLOSED {
            portal.closed_sprite
        } else {
            portal.open_sprite
        });
        buffer.states.push(state);
    }
}

fn project_person(
    position: &Position,
    path: Option<&Path>,
    commuting: bool,
    at_work: Option<&AtWork>,
    career: Option<&terri_data::CompiledCareer>,
    door: (u32, u32),
    inward: (u32, u32),
) -> u32 {
    if commuting {
        if let Some(path) = path {
            let endpoint = path.steps.last().copied();
            let distance = distance_from(position, door);
            if endpoint == Some((door.0 as i32, door.1 as i32)) {
                return if distance <= 0.5 {
                    OPEN
                } else if distance <= 1.5 {
                    OPENING
                } else {
                    CLOSED
                };
            }
            if endpoint == Some((inward.0 as i32, inward.1 as i32)) {
                return if distance <= 0.5 { OPEN } else { CLOSING };
            }
        }
    }

    let (Some(at_work), Some(career)) = (at_work, career) else {
        return CLOSED;
    };
    if distance_from(position, door) > 0.01 {
        return CLOSED;
    }
    let remaining = at_work.remaining_ticks;
    let shift = career.shift_ticks;

    // The opening and closing windows are deliberately expressed in work
    // ticks. They therefore pause, save and load with the same countdown as
    // the shift instead of depending on wall time in the browser.
    if remaining >= shift.saturating_sub(1) || remaining <= 2 {
        OPEN
    } else if remaining <= 5 {
        OPENING
    } else if remaining >= shift.saturating_sub(4) {
        CLOSING
    } else {
        CLOSED
    }
}

fn distance_from(position: &Position, tile: (u32, u32)) -> f32 {
    let dx = position.x - tile.0 as f32;
    let dy = position.y - tile.1 as f32;
    (dx * dx + dy * dy).sqrt()
}

fn priority(state: u32) -> u8 {
    match state {
        OPEN => 3,
        OPENING => 2,
        CLOSING => 1,
        _ => 0,
    }
}

fn outward_delta(facing: terri_data::CompiledSocketFacing) -> (f32, f32) {
    use terri_data::CompiledSocketFacing::{NegativeX, NegativeY, PositiveX, PositiveY};

    match facing {
        PositiveX => (1.0, 0.0),
        NegativeX => (-1.0, 0.0),
        PositiveY => (0.0, 1.0),
        NegativeY => (0.0, -1.0),
    }
}

/// Projects a commuter across the visual boundary without changing path or save state.
///
/// The route endpoint is the walkable door tile, while the authored leaf sits half a
/// tile farther out. This render-only offset lets the body cross that boundary plane
/// on departure and return. Ordinary movement remains exactly where the simulation
/// put it.
pub fn crossing_position(world: &World, entity: Entity, position: Position) -> Position {
    let Some(portals) = world.get_resource::<ActivePortals>() else {
        return position;
    };

    if world.get::<AtWork>(entity).is_some() {
        let Some(portal) = portals
            .0
            .iter()
            .find(|portal| distance_from(&position, portal.position) <= 0.01)
        else {
            return position;
        };
        return project_outward(position, portal.facing, 0.5);
    }

    if world.get::<Commuting>(entity).is_none() {
        return position;
    }
    let Some(path) = world.get::<Path>(entity) else {
        return position;
    };
    let Some(endpoint) = path.steps.last().copied() else {
        return position;
    };
    let Some(portal) = portals.0.iter().find(|portal| {
        endpoint == (portal.position.0 as i32, portal.position.1 as i32)
            || endpoint == (portal.inward.0 as i32, portal.inward.1 as i32)
    }) else {
        return position;
    };

    let distance = distance_from(&position, portal.position);
    if distance > 1.0 {
        return position;
    }
    let scale = 0.5 * (1.0 - distance);
    project_outward(position, portal.facing, scale)
}

fn project_outward(
    position: Position,
    facing: terri_data::CompiledSocketFacing,
    scale: f32,
) -> Position {
    let (outward_x, outward_y) = outward_delta(facing);
    Position {
        x: position.x + outward_x * scale,
        y: position.y + outward_y * scale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{test_content, Content, Sim};
    use terri_core::{Agent, Commuting, Path, Position};
    use terri_data::{CompiledPortal, CompiledPortalHinge, CompiledSocketFacing, ContentPack};

    fn portal_pack() -> &'static ContentPack {
        let base = test_content::pack(vec![]);
        Box::leak(Box::new(ContentPack {
            portals: vec![CompiledPortal {
                position: (5, 2),
                inward: (5, 3),
                facing: CompiledSocketFacing::PositiveX,
                hinge: CompiledPortalHinge::Left,
                frame_sprite: 41,
                closed_sprite: 42,
                ajar_sprite: 43,
                open_sprite: 44,
            }],
            ..base.clone()
        }))
    }

    fn portal_career_pack() -> &'static ContentPack {
        let base = portal_pack();
        Box::leak(Box::new(ContentPack {
            careers: vec![terri_data::CompiledCareer {
                id: "door_test".to_string(),
                label: "Door test".to_string(),
                shift_start: 0,
                shift_ticks: 10,
                pay: 1,
                energy_cost: 1.0,
                satisfaction: 0.0,
            }],
            ..base.clone()
        }))
    }

    fn world_with_active_portals(content: &'static ContentPack) -> World {
        let mut world = World::new();
        world.insert_resource(Content(content));
        world.insert_resource(ActivePortals::from_content(content));
        world
    }

    fn project_at(x: f32, y: f32) -> PortalBuffer {
        let mut world = world_with_active_portals(portal_pack());
        world.spawn((
            Agent,
            Position { x, y },
            Commuting,
            Path {
                steps: vec![(5, 2)],
                cursor: 0,
            },
        ));
        let mut buffer = PortalBuffer::default();
        sync_portals(&mut world, &mut buffer);
        buffer
    }

    #[test]
    fn outbound_approach_opens_the_authored_portal_and_projects_its_sprites() {
        let opening = project_at(5.0, 3.25);
        assert_eq!(opening.positions, vec![5.0, 2.0]);
        assert_eq!(opening.depth_offsets, vec![0.5]);
        assert_eq!(opening.frames, vec![41]);
        assert_eq!(opening.states, vec![OPENING]);
        assert_eq!(opening.leaves, vec![43]);
        assert_eq!(opening.reduced_leaves, vec![44]);

        let open = project_at(5.0, 2.25);
        assert_eq!(open.states, vec![OPEN]);
        assert_eq!(open.leaves, vec![44]);

        let closed = project_at(5.0, 4.0);
        assert_eq!(closed.states, vec![CLOSED]);
        assert_eq!(closed.leaves, vec![42]);
        assert_eq!(closed.reduced_leaves, vec![42]);
    }

    #[test]
    fn only_a_commuter_crosses_the_visual_boundary_plane() {
        let mut world = world_with_active_portals(portal_pack());
        let ordinary = world.spawn_empty().id();
        let at_door = Position { x: 5.0, y: 2.0 };
        assert_eq!(crossing_position(&world, ordinary, at_door), at_door);

        let outbound = world
            .spawn((
                Commuting,
                Path {
                    steps: vec![(5, 2)],
                    cursor: 1,
                },
            ))
            .id();
        assert_eq!(
            crossing_position(&world, outbound, at_door),
            Position { x: 5.5, y: 2.0 },
            "the route tile projects to the door plane"
        );

        let inbound = world
            .spawn((
                Commuting,
                Path {
                    steps: vec![(5, 3)],
                    cursor: 0,
                },
            ))
            .id();
        assert_eq!(
            crossing_position(&world, inbound, at_door),
            Position { x: 5.5, y: 2.0 },
            "the return begins on the same boundary plane"
        );
        let inside = Position { x: 5.0, y: 3.0 };
        assert_eq!(
            crossing_position(&world, inbound, inside),
            inside,
            "the offset decays to zero one tile inside"
        );
    }

    #[test]
    fn every_facing_projects_the_boundary_and_depth_along_its_signed_normal() {
        for (facing, expected_depth, expected_position) in [
            (
                CompiledSocketFacing::PositiveX,
                0.5,
                Position { x: 5.5, y: 2.0 },
            ),
            (
                CompiledSocketFacing::NegativeX,
                -0.5,
                Position { x: 4.5, y: 2.0 },
            ),
            (
                CompiledSocketFacing::PositiveY,
                0.5,
                Position { x: 5.0, y: 2.5 },
            ),
            (
                CompiledSocketFacing::NegativeY,
                -0.5,
                Position { x: 5.0, y: 1.5 },
            ),
        ] {
            let base = test_content::pack(vec![]);
            let content = Box::leak(Box::new(ContentPack {
                portals: vec![CompiledPortal {
                    position: (5, 2),
                    inward: (5, 3),
                    facing,
                    hinge: CompiledPortalHinge::Left,
                    frame_sprite: 41,
                    closed_sprite: 42,
                    ajar_sprite: 43,
                    open_sprite: 44,
                }],
                ..base.clone()
            }));
            let mut world = world_with_active_portals(content);
            let commuter = world
                .spawn((
                    Commuting,
                    Path {
                        steps: vec![(5, 2)],
                        cursor: 0,
                    },
                ))
                .id();
            let at_door = Position { x: 5.0, y: 2.0 };
            let mut buffer = PortalBuffer::default();

            sync_portals(&mut world, &mut buffer);

            assert_eq!(buffer.depth_offsets, vec![expected_depth], "{facing:?}");
            assert_eq!(
                crossing_position(&world, commuter, at_door),
                expected_position,
                "{facing:?}"
            );
        }
    }

    #[test]
    fn the_work_countdown_drives_complete_open_and_close_windows() {
        for (remaining, expected) in [
            (10, OPEN),
            (9, OPEN),
            (8, CLOSING),
            (6, CLOSING),
            (5, OPENING),
            (3, OPENING),
            (2, OPEN),
            (1, OPEN),
        ] {
            let mut world = world_with_active_portals(portal_career_pack());
            world.spawn((
                Agent,
                Position { x: 5.0, y: 2.0 },
                terri_core::Career(0),
                terri_core::AtWork {
                    remaining_ticks: remaining,
                },
            ));
            let mut buffer = PortalBuffer::default();
            sync_portals(&mut world, &mut buffer);
            assert_eq!(
                buffer.states,
                vec![expected],
                "remaining work ticks {remaining}"
            );
        }
    }

    #[test]
    fn an_inbound_crossing_closes_after_the_worker_clears_the_leaf() {
        for (y, expected) in [(2.25, OPEN), (2.75, CLOSING)] {
            let mut world = world_with_active_portals(portal_pack());
            world.spawn((
                Agent,
                Position { x: 5.0, y },
                Commuting,
                Path {
                    steps: vec![(5, 3)],
                    cursor: 0,
                },
            ));
            let mut buffer = PortalBuffer::default();
            sync_portals(&mut world, &mut buffer);
            assert_eq!(buffer.states, vec![expected]);
        }
    }

    #[test]
    fn an_open_crossing_outranks_another_workers_closing_request() {
        let mut world = world_with_active_portals(portal_career_pack());
        world.spawn((
            Agent,
            Position { x: 5.0, y: 2.0 },
            terri_core::Career(0),
            terri_core::AtWork { remaining_ticks: 8 },
        ));
        world.spawn((
            Agent,
            Position { x: 5.0, y: 2.25 },
            Commuting,
            Path {
                steps: vec![(5, 3)],
                cursor: 0,
            },
        ));
        let mut buffer = PortalBuffer::default();
        sync_portals(&mut world, &mut buffer);
        assert_eq!(buffer.states, vec![OPEN]);
        assert_eq!(buffer.leaves, vec![44]);
    }

    #[test]
    fn a_worker_at_another_position_does_not_animate_this_portal() {
        let mut world = world_with_active_portals(portal_career_pack());
        world.spawn((
            Agent,
            Position { x: 2.0, y: 2.0 },
            terri_core::Career(0),
            terri_core::AtWork {
                remaining_ticks: 10,
            },
        ));
        let mut buffer = PortalBuffer::default();
        sync_portals(&mut world, &mut buffer);
        assert_eq!(buffer.states, vec![CLOSED]);
    }

    #[test]
    fn an_empty_custom_lot_does_not_project_the_shipped_portal_catalog() {
        let mut sim = Sim::new_with_lot(8, 8);
        sim.sync_render_buffer();
        assert_eq!(sim.portal_buffer().states.len(), 0);
        assert_eq!(sim.portal_buffer().positions.len(), 0);

        let snapshot = sim.save_snapshot();
        sim.load_snapshot(snapshot).expect("blank lot save reloads");
        assert_eq!(sim.portal_buffer().states.len(), 0);
        assert_eq!(sim.portal_buffer().positions.len(), 0);
    }
}
