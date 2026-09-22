//! Deterministic presentation projection for authored lot portals.

use bevy_ecs::prelude::*;
use terri_core::{Agent, AtWork, Career, Commuting, Path, Position, TileGrid};

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
    /// The tile across each row's line, `[x, y]` pairs: the renderer lights a
    /// portal from the brighter of its own tile and this one, as it lights the
    /// walls around it. Off the lot for a front door on the lot's edge, the
    /// yard tile beyond it for one on the house's wall ([OS-door]).
    pub far_sides: Vec<f32>,
}

/// Rebuilds the complete portal presentation projection from simulation state.
pub fn sync_portals(world: &mut World, buffer: &mut PortalBuffer) {
    buffer.positions.clear();
    buffer.depth_offsets.clear();
    buffer.frames.clear();
    buffer.leaves.clear();
    buffer.reduced_leaves.clear();
    buffer.states.clear();
    buffer.far_sides.clear();

    let Some(portals) = world.get_resource::<ActivePortals>().map(|active| active.0) else {
        return;
    };
    let content: &'static terri_data::ContentPack = world.resource::<Content>().0;
    let doors = interior_door_lines(world);
    let width = lot_width(world);

    let mut people = world.query_filtered::<(
        &Position,
        Option<&Path>,
        Has<Commuting>,
        Option<&AtWork>,
        Option<&Career>,
    ), With<Agent>>();

    for portal in portals {
        // [OS-door]: a door with a yard beyond it swings for a sim walking
        // through its line, as an interior door does, as well as for a
        // commuter; the more open of the two wins.
        let line = door_line(portal, width);
        let state = strongest(people.iter(world).map(
            |(position, path, commuting, at_work, career)| {
                let commute = project_person(
                    position,
                    path,
                    commuting,
                    at_work,
                    career.and_then(|career| content.careers.get(career.0 as usize)),
                    portal.position,
                    portal.inward,
                );
                let through = line.map_or(CLOSED, |line| project_through(position, path, line));
                strongest([commute, through].into_iter())
            },
        ));

        buffer
            .positions
            .extend([portal.position.0 as f32, portal.position.1 as f32]);
        let (outward_x, outward_y) = outward_delta(portal.facing);
        buffer.depth_offsets.push(0.5 * (outward_x + outward_y));
        buffer.far_sides.extend([
            portal.position.0 as f32 + outward_x,
            portal.position.1 as f32 + outward_y,
        ]);
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

    // [DR-derived]: a hinged door in every vertical doorway, drawn with the
    // front door's art, after the front door so its row keeps index 0.
    let Some(art) = door_art(portals) else {
        return;
    };
    for (x, y) in doors {
        let state = strongest(
            people
                .iter(world)
                .map(|(position, path, ..)| project_through(position, path, (x, y))),
        );
        // The door stands on the +X edge of the tile left of its line, where
        // the front door's art stands on its own tile.
        buffer.positions.extend([(x - 1) as f32, y as f32]);
        buffer.depth_offsets.push(0.5);
        buffer.far_sides.extend([x as f32, y as f32]);
        buffer.frames.push(art.frame_sprite);
        buffer.leaves.push(match state {
            CLOSED => art.closed_sprite,
            OPEN => art.open_sprite,
            OPENING | CLOSING => art.ajar_sprite,
            _ => unreachable!("door state is produced locally"),
        });
        buffer.reduced_leaves.push(if state == CLOSED {
            art.closed_sprite
        } else {
            art.open_sprite
        });
        buffer.states.push(state);
    }
}

/// The width of the lot this world loaded, or 0 when it has no grid.
fn lot_width(world: &World) -> u32 {
    world
        .get_resource::<TileGrid>()
        .map_or(0, |grid| grid.width() as u32)
}

/// [OS-door] in `docs/specs/2026-09-22-the-outside.md`: the vertical line a
/// front door facing +X stands on, as `(x, y)`, when the tile across it is on
/// the lot, as it is where a yard lies beyond the door. A door on the lot's
/// edge, or facing any other way, has no line on the lot.
fn door_line(portal: &terri_data::CompiledPortal, width: u32) -> Option<(u32, u32)> {
    let (x, y) = portal.position;
    (portal.facing == terri_data::CompiledSocketFacing::PositiveX && x + 1 < width)
        .then_some((x + 1, y))
}

/// The front door's line on the lot ([OS-door]), read from the content the
/// world was built with and matched to its portal as the loader and the
/// other door rules match it, never from the presentation-only
/// [`ActivePortals`], so a world built without the door's art keeps the same
/// rules and replays alike. The Walls and Room tools keep a wall off it, a lot
/// edit keeps the tile beyond it open, and no interior door is derived on it.
pub fn front_door_lines(world: &World) -> Vec<(u32, u32)> {
    let width = lot_width(world);
    world
        .get_resource::<Content>()
        .and_then(|content| front_door_line(content.0, width))
        .into_iter()
        .collect()
}

/// The front door's line on a lot `width` tiles wide, from the content's
/// front door matched to its portal ([OS-door]), or `None` when the door has
/// no yard beyond it.
pub fn front_door_line(content: &terri_data::ContentPack, width: u32) -> Option<(u32, u32)> {
    content
        .lot
        .front_door
        .and_then(|door| {
            content
                .portals
                .iter()
                .find(|portal| portal.position == door)
        })
        .and_then(|portal| door_line(portal, width))
}

/// Whether `position` stands on `tile`, within the tolerance a walk's end is
/// measured by: a commute clocks in, and a saved worker at work is judged, by
/// this one test ([OS-street]).
pub fn on_tile(position: (f32, f32), tile: (u32, u32)) -> bool {
    (position.0 - tile.0 as f32).abs() <= 0.01 && (position.1 - tile.1 as f32).abs() <= 0.01
}

/// [OS-street] in `docs/specs/2026-09-22-the-outside.md`: where a commute
/// ends on a lot `width` tiles wide. The street is the lot's last column,
/// across the yard the front door faces, and its exit is the tile there in
/// the door's row. `None` when the door has no yard beyond it, where a
/// commute ends on the door's own tile.
pub fn street_exit(content: &terri_data::ContentPack, width: u32) -> Option<(u32, u32)> {
    front_door_line(content, width).map(|(_, y)| (width - 1, y))
}

/// The front door whose art fits a vertical line, the only art a door has:
/// it faces +X, standing on its tile's +X edge.
fn door_art(portals: &[terri_data::CompiledPortal]) -> Option<&terri_data::CompiledPortal> {
    portals
        .iter()
        .find(|portal| portal.facing == terri_data::CompiledSocketFacing::PositiveX)
}

/// The doorway lines that hold an interior door - [DR-derived]: every vertical
/// doorway of an edge-wall house, as `(x, y)`, sorted, when the lot's front
/// door has art for a vertical line. None for a horizontal doorway, which has
/// no art yet, none for a lot with no front door to take the art from, and
/// none on a front door's own line, which has its door ([OS-door]).
pub fn interior_door_lines(world: &World) -> Vec<(u32, u32)> {
    use terri_core::layout::{EdgeAxis, SavedLayout};
    let has_art = world
        .get_resource::<ActivePortals>()
        .is_some_and(|active| door_art(active.0).is_some());
    let Some(SavedLayout::EdgeWallsV1 { edges }) = world.get_resource::<SavedLayout>() else {
        return Vec::new();
    };
    if !has_art {
        return Vec::new();
    }
    let front = front_door_lines(world);
    let mut lines: Vec<(u32, u32)> = edges
        .iter()
        .filter(|edge| edge.doorway && edge.axis == EdgeAxis::Vertical)
        .map(|edge| (edge.x, edge.y))
        .filter(|line| !front.contains(line))
        .collect();
    lines.sort_unstable();
    lines
}

/// [DR-state]: how one sim moves the door on the vertical line `(x, y)`. The
/// doorway spans the gap between the centres of the tiles either side of the
/// line, `(x - 1, y)` and `(x, y)`, and a sim's walk is a run of one-tile steps
/// between tile centres, so the door reads the steps rather than a distance:
///
/// - open while the sim's body is inside that gap, which only the step across
///   the line passes through;
/// - opening while the step the sim is walking, or the one after it, crosses
///   the line;
/// - closing while the step the sim last finished crossed it;
/// - closed otherwise: standing beside the door, walking along its wall, or
///   walking up to it and turning away.
///
/// The door's state is never saved: it is worked out again each frame from
/// the sim's position and walk, which are saved, so a loaded house shows the
/// same door as the house that was saved.
///
/// The swing is cut short in two cases, both presentation only. A walk does
/// not keep the tile it set out from, so when its first step is the one
/// through the door the door can snap open or shut without its ajar frame. And
/// a walk that ends on the tile just past the door is removed on the next
/// tick, so the door swings shut in one tick rather than over the whole next
/// step.
fn project_through(position: &Position, path: Option<&Path>, (x, y): (u32, u32)) -> u32 {
    let (line_x, row) = (x as f32 - 0.5, y as f32);
    if (position.y - row).abs() < 0.5 && (position.x - line_x).abs() < 0.5 {
        return OPEN;
    }
    let Some(path) = path else {
        return CLOSED;
    };
    let (x, y) = (x as i32, y as i32);
    // A step crosses the line when both its ends are on the door's row, one
    // either side of the line.
    let crosses = |from: Option<(i32, i32)>, to: Option<(i32, i32)>| match (from, to) {
        (Some(a), Some(b)) => a.1 == y && b.1 == y && (a.0 < x) != (b.0 < x),
        _ => false,
    };
    let step = |index: usize| path.steps.get(index).copied();
    let here = Some((position.x.round() as i32, position.y.round() as i32));
    let cursor = path.cursor;
    if crosses(here, step(cursor)) || crosses(step(cursor), step(cursor + 1)) {
        return OPENING;
    }
    let behind = |back: usize| cursor.checked_sub(back).and_then(step);
    if crosses(behind(2), behind(1)) {
        return CLOSING;
    }
    CLOSED
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
            // The one step in from the door's tile closes the door. A walk
            // home from the street is longer, and swings the door by the
            // crossing rule as anyone's does, or leaves it shut when it comes
            // in by another doorway ([OS-street]).
            if endpoint == Some((inward.0 as i32, inward.1 as i32)) && path.steps.len() == 1 {
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

/// The state the strongest request wins, of every sim's request for one
/// portal: open over opening over closing over closed.
fn strongest(states: impl Iterator<Item = u32>) -> u32 {
    states
        .max_by_key(|&state| priority(state))
        .unwrap_or(CLOSED)
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
    // [OS-street]: through a door with a yard beyond it the sim really
    // walks, so only a door on the lot's edge takes the offset.
    let width = lot_width(world);
    let Some(portal) = portals.0.iter().find(|portal| {
        door_line(portal, width).is_none()
            && (endpoint == (portal.position.0 as i32, portal.position.1 as i32)
                || endpoint == (portal.inward.0 as i32, portal.inward.1 as i32))
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

    /// The portal pack's world with a vertical doorway at (3, 4) and one at
    /// (1, 2), a horizontal doorway at (2, 6), and a wall at (4, 4).
    fn doorway_world() -> World {
        use terri_core::layout::{EdgeAxis::*, SavedLayout, WallEdge};
        let mut world = world_with_active_portals(portal_pack());
        let edge = |axis, x, y, doorway| WallEdge {
            axis,
            x,
            y,
            doorway,
        };
        world.insert_resource(SavedLayout::EdgeWallsV1 {
            edges: vec![
                edge(Vertical, 3, 4, true),
                edge(Horizontal, 2, 6, true),
                edge(Vertical, 4, 4, false),
                edge(Vertical, 1, 2, true),
            ],
        });
        world
    }

    /// A sim at `(x, y)` partway through a walk: the walk's steps, none for
    /// standing still, and how many of them it has finished.
    type Walker = (f32, f32, Vec<(i32, i32)>, usize);

    fn doors_with(sims: &[Walker]) -> PortalBuffer {
        let mut world = doorway_world();
        for (x, y, steps, cursor) in sims.iter().cloned() {
            let mut person = world.spawn((Agent, Position { x, y }));
            if !steps.is_empty() {
                person.insert(Path { steps, cursor });
            }
        }
        let mut buffer = PortalBuffer::default();
        sync_portals(&mut world, &mut buffer);
        buffer
    }

    /// The door on the line x = 3 at row 4, which spans the gap between the
    /// centres of tiles (2, 4) and (3, 4), with one sim in the house.
    fn door(x: f32, y: f32, steps: &[(i32, i32)], cursor: usize) -> u32 {
        doors_with(&[(x, y, steps.to_vec(), cursor)]).states[2]
    }

    #[test]
    fn every_vertical_doorway_gets_a_door_after_the_front_door() {
        let world = doorway_world();
        assert_eq!(interior_door_lines(&world), [(1, 2), (3, 4)]);
        let buffer = doors_with(&[]);
        // The front door, then the two doors, each on the +X edge of the
        // tile left of its line, with the front door's art.
        assert_eq!(buffer.positions, [5.0, 2.0, 0.0, 2.0, 2.0, 4.0]);
        // Across each line: outside the front door, and the tile right of
        // each door's line.
        assert_eq!(buffer.far_sides, [6.0, 2.0, 1.0, 2.0, 3.0, 4.0]);
        assert_eq!(buffer.depth_offsets, [0.5, 0.5, 0.5]);
        assert_eq!(buffer.frames, [41, 41, 41]);
        assert_eq!(buffer.states, [CLOSED, CLOSED, CLOSED]);
        assert_eq!(buffer.leaves, [42, 42, 42]);
    }

    #[test]
    fn no_door_without_art_for_a_vertical_line_or_without_edge_walls() {
        use terri_core::layout::SavedLayout;
        let mut world = doorway_world();
        world.insert_resource(SavedLayout::LegacyCells { walls: vec![] });
        assert!(interior_door_lines(&world).is_empty());

        let mut pack = portal_pack().clone();
        pack.portals[0].facing = CompiledSocketFacing::PositiveY;
        let pack: &'static ContentPack = Box::leak(Box::new(pack));
        let mut world = doorway_world();
        world.insert_resource(Content(pack));
        world.insert_resource(ActivePortals::from_content(pack));
        assert!(interior_door_lines(&world).is_empty());
        let mut buffer = PortalBuffer::default();
        sync_portals(&mut world, &mut buffer);
        assert_eq!(buffer.states.len(), 1, "only the front door");
    }

    /// [DR-state], walking left to right through the door on the line x = 3.
    #[test]
    fn a_door_opens_for_a_sim_walking_through_and_closes_behind_it() {
        let walk = [(2, 4), (3, 4), (4, 4)];
        // Two tiles off, its next step is the one across the line.
        assert_eq!(door(1.0, 4.0, &walk, 0), OPENING);
        // On the tile beside the door, about to step through.
        assert_eq!(door(2.0, 4.0, &walk, 1), OPENING);
        // Its body in the doorway, either side of the line.
        assert_eq!(door(2.2, 4.0, &walk, 1), OPEN);
        assert_eq!(door(2.8, 4.0, &walk, 1), OPEN);
        // Through: on the far tile, then on its way to the next one.
        assert_eq!(door(3.0, 4.0, &walk, 2), CLOSING);
        assert_eq!(door(3.6, 4.0, &walk, 2), CLOSING);
        // A tile further on, the step it last finished did not cross.
        assert_eq!(door(4.0, 4.0, &walk, 3), CLOSED);
    }

    /// Review finding [F2] on the doors branch: the old distance rule read a
    /// crossing from right to left differently from one left to right.
    #[test]
    fn a_door_opens_the_same_way_for_a_sim_coming_the_other_way() {
        let walk = [(4, 4), (3, 4), (2, 4), (1, 4)];
        assert_eq!(door(5.0, 4.0, &walk, 0), CLOSED, "three tiles off");
        assert_eq!(door(4.0, 4.0, &walk, 1), OPENING);
        assert_eq!(door(3.0, 4.0, &walk, 2), OPENING);
        assert_eq!(door(2.5, 4.0, &walk, 2), OPEN);
        assert_eq!(door(2.0, 4.0, &walk, 3), CLOSING);
        assert_eq!(door(1.0, 4.0, &walk, 4), CLOSED);
    }

    /// Review findings [F1] and [F2] on the doors branch: the old distance
    /// rule swung the door for a sim that stood beside it, walked along its
    /// wall, or walked up to it and turned away.
    #[test]
    fn a_door_stays_shut_for_a_sim_that_does_not_walk_through_it() {
        // Standing on either tile beside it, or half a row off its middle.
        assert_eq!(door(2.0, 4.0, &[], 0), CLOSED);
        assert_eq!(door(3.0, 4.0, &[], 0), CLOSED);
        assert_eq!(door(2.5, 4.5, &[], 0), CLOSED);
        // Standing in it, as a sim whose walk stopped midway does.
        assert_eq!(door(2.5, 4.0, &[], 0), OPEN);
        assert_eq!(door(2.5, 4.45, &[], 0), OPEN);
        // Walking up to it, then turning away along its wall.
        let turn = [(2, 4), (2, 3)];
        assert_eq!(door(1.0, 4.0, &turn, 0), CLOSED);
        assert_eq!(door(2.0, 4.0, &turn, 1), CLOSED);
        // Walking along its wall, past it.
        let along = [(2, 4), (2, 5)];
        assert_eq!(door(2.0, 3.0, &along, 0), CLOSED);
        assert_eq!(door(2.0, 4.0, &along, 1), CLOSED);
        // Crossing the same line on another row, where there is no door.
        let past = [(2, 5), (3, 5)];
        assert_eq!(door(1.0, 5.0, &past, 0), CLOSED);
        assert_eq!(door(2.5, 5.0, &past, 1), CLOSED);
        // Close by and walking away, having never come through.
        assert_eq!(door(2.0, 3.0, &[(2, 2)], 0), CLOSED);
        // A diagonal step onto or off the door's row, which no walk takes,
        // is not a crossing: both ends of a crossing step are on the row.
        assert_eq!(door(2.0, 5.0, &[(3, 4)], 0), CLOSED);
        assert_eq!(door(2.0, 4.0, &[(3, 5)], 0), CLOSED);
        // Far off.
        assert_eq!(door(0.0, 0.0, &[(1, 0)], 0), CLOSED);
        // A sim in this doorway does not move the other doors.
        assert_eq!(doors_with(&[(2.5, 4.0, vec![], 0)]).states[1], CLOSED);
    }

    #[test]
    fn a_door_follows_whichever_sim_needs_it_most_open() {
        let closing = (3.0, 4.0, vec![(2, 4), (3, 4), (4, 4)], 2);
        let opening = (1.0, 4.0, vec![(2, 4), (3, 4)], 0);
        let open = (2.5, 4.0, vec![], 0);
        // The stronger request wins whether it comes second or first.
        assert_eq!(doors_with(&[closing.clone(), opening]).states[2], OPENING);
        assert_eq!(doors_with(&[open, closing.clone()]).states[2], OPEN);
        // Review finding [F9] on the doors branch: closing outranks closed,
        // even when a sim far off, walking the same kind of walk, comes after.
        let bystander = (0.0, 0.0, vec![(1, 0)], 0);
        assert_eq!(doors_with(&[closing, bystander]).states[2], CLOSING);
    }

    /// Found by the portal bridge test, and then by review for the V2 loader:
    /// each synced the render buffer before it put the saved walls in, so a
    /// loaded house drew its doorways doorless until the next tick. The V1
    /// case, a cell-wall house moving to edge walls as it loads, is
    /// `a_migrated_v1_house_shows_its_doors_before_the_first_tick`.
    #[test]
    fn a_loaded_house_shows_its_doors_before_the_first_tick() {
        let sim = Sim::new_from_shipped_lot();
        assert_eq!(interior_door_lines(sim.world()).len(), 3);
        let rows = |sim: &Sim| sim.portal_buffer().states.len();
        let mut loaded = Sim::new_from_shipped_lot();
        loaded.load_snapshot_v3(sim.save_snapshot_v3()).unwrap();
        assert_eq!(rows(&loaded), 4, "the front door and three doors");
        let mut loaded = Sim::new_from_shipped_lot();
        loaded.load_snapshot_v2(sim.save_snapshot_v2()).unwrap();
        assert_eq!(rows(&loaded), 4, "after a V2 load");
    }

    /// [OS-door] in `docs/specs/2026-09-22-the-outside.md`: with a yard beyond
    /// it, the front door swings for a sim walking out through its line, as
    /// an interior door does. On the lot's edge, or turned along its wall, it
    /// has no line on the lot to walk through.
    #[test]
    fn the_front_door_swings_for_a_sim_walking_out_into_the_yard() {
        let door = |content: &'static ContentPack, width: usize, height: usize| {
            let mut world = world_with_active_portals(content);
            world.insert_resource(TileGrid::new(width, height));
            world.spawn((
                Agent,
                Position { x: 15.0, y: 2.0 },
                Path {
                    steps: vec![(16, 2)],
                    cursor: 0,
                },
            ));
            let mut buffer = PortalBuffer::default();
            sync_portals(&mut world, &mut buffer);
            (front_door_lines(&world), buffer.states[0])
        };
        let shipped = terri_data::pack();
        assert_eq!(door(shipped, 20, 16), (vec![(16, 2)], OPENING));
        assert_eq!(door(shipped, 17, 12), (vec![(16, 2)], OPENING));
        assert_eq!(door(shipped, 16, 12), (vec![], CLOSED));
        let mut turned = shipped.clone();
        turned.portals[0].facing = terri_data::CompiledSocketFacing::PositiveY;
        let turned: &'static ContentPack = Box::leak(Box::new(turned));
        assert_eq!(door(turned, 20, 16), (vec![], CLOSED));
    }

    /// [OS-street] in `docs/specs/2026-09-22-the-outside.md`: the street's
    /// exit is the last column's tile in the door's row, and there is none
    /// where the door has no yard beyond it.
    #[test]
    fn the_street_exit_is_across_the_yard_from_the_door() {
        let shipped = terri_data::pack();
        assert_eq!(street_exit(shipped, 20), Some((19, 2)));
        assert_eq!(street_exit(shipped, 18), Some((17, 2)));
        assert_eq!(street_exit(shipped, 16), None);
    }

    /// [OS-street] and review finding [S2]: the one step in from the door's
    /// tile closes the door. A longer walk home leaves it shut unless it
    /// crosses the door's line, as when it comes in by another doorway.
    #[test]
    fn a_commuter_walking_home_closes_the_door_only_on_the_step_from_it() {
        let door = |x: f32, y: f32, steps: Vec<(i32, i32)>| {
            let mut world = world_with_active_portals(terri_data::pack());
            world.insert_resource(TileGrid::new(20, 16));
            world.spawn((
                Agent,
                Position { x, y },
                Commuting,
                Path { steps, cursor: 0 },
            ));
            let mut buffer = PortalBuffer::default();
            sync_portals(&mut world, &mut buffer);
            buffer.states[0]
        };
        assert_eq!(
            door(18.0, 2.0, vec![(17, 2), (16, 2), (15, 2), (15, 3)]),
            CLOSED
        );
        assert_eq!(door(16.0, 3.0, vec![(16, 3), (15, 3)]), CLOSED);
        assert_eq!(door(15.0, 2.9, vec![(15, 3)]), CLOSING);
        assert_eq!(door(15.0, 2.0, vec![(15, 3)]), OPEN);
    }

    /// [OS-street]: a sim walking through a door with a yard beyond it is
    /// drawn where it is; the half-tile offset belongs to a door on the lot's
    /// edge, where the walk ends on the door's tile.
    #[test]
    fn only_a_door_on_the_lots_edge_draws_the_crossing_offset() {
        let drawn = |width: usize| {
            let mut world = world_with_active_portals(terri_data::pack());
            world.insert_resource(TileGrid::new(width, 16));
            let sim = world
                .spawn((
                    Agent,
                    Position { x: 15.0, y: 2.5 },
                    Commuting,
                    Path {
                        steps: vec![(15, 3)],
                        cursor: 0,
                    },
                ))
                .id();
            let position = crossing_position(&world, sim, Position { x: 15.0, y: 2.5 });
            (position.x, position.y)
        };
        assert_eq!(drawn(20), (15.0, 2.5));
        assert_eq!(drawn(16), (15.25, 2.5));
    }

    #[test]
    fn a_door_row_draws_the_art_for_its_state() {
        let open = doors_with(&[(2.5, 4.0, vec![], 0)]);
        assert_eq!((open.leaves[2], open.reduced_leaves[2]), (44, 44));
        let opening = doors_with(&[(1.0, 4.0, vec![(2, 4), (3, 4)], 0)]);
        assert_eq!((opening.leaves[2], opening.reduced_leaves[2]), (43, 44));
        let closing = doors_with(&[(3.0, 4.0, vec![(2, 4), (3, 4), (4, 4)], 2)]);
        assert_eq!((closing.leaves[2], closing.reduced_leaves[2]), (43, 44));
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
    fn a_commuter_two_tiles_from_the_door_keeps_its_world_position() {
        let mut world = world_with_active_portals(portal_pack());
        let outbound = world
            .spawn((
                Commuting,
                Path {
                    steps: vec![(5, 2)],
                    cursor: 0,
                },
            ))
            .id();
        let approaching = Position { x: 3.0, y: 2.0 };

        assert_eq!(
            crossing_position(&world, outbound, approaching),
            approaching,
            "projection starts only inside the final one-tile approach"
        );
    }

    #[test]
    fn an_at_work_body_exactly_on_the_door_tolerance_still_opens_it() {
        let position = Position { x: 0.01, y: 0.0 };
        let work = terri_core::AtWork { remaining_ticks: 1 };
        let pack = portal_career_pack();

        assert_eq!(distance_from(&position, (0, 0)), 0.01);
        assert_eq!(
            project_person(
                &position,
                None,
                false,
                Some(&work),
                Some(&pack.careers[0]),
                (0, 0),
                (0, 1),
            ),
            OPEN,
            "the tolerance boundary matches body projection and stays inclusive"
        );
    }

    #[test]
    fn every_facing_projects_the_boundary_and_depth_along_its_signed_normal() {
        for (facing, expected_depth, expected_position, far_side) in [
            (
                CompiledSocketFacing::PositiveX,
                0.5,
                Position { x: 5.5, y: 2.0 },
                [6.0, 2.0],
            ),
            (
                CompiledSocketFacing::NegativeX,
                -0.5,
                Position { x: 4.5, y: 2.0 },
                [4.0, 2.0],
            ),
            (
                CompiledSocketFacing::PositiveY,
                0.5,
                Position { x: 5.0, y: 2.5 },
                [5.0, 3.0],
            ),
            (
                CompiledSocketFacing::NegativeY,
                -0.5,
                Position { x: 5.0, y: 1.5 },
                [5.0, 1.0],
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
            assert_eq!(buffer.far_sides, far_side, "{facing:?}");
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
