//! Previous render positions for walkers, kept out of the world hash.
//!
//! A load makes both interpolation samples equal because the save does not
//! store the previous sample. The drawing then falls back to the facing the
//! simulation exports. On a path corner that facing already points along the
//! next leg, while live play is still showing the leg just walked. These rows
//! are that previous position. They are applied only when the two samples are
//! equal, so a live corner still turns when the body reaches it.

use bevy_ecs::prelude::Resource;
use terri_core::save_v34::SavedWalkStep;

use crate::render_buffer::{visual_action, RenderBuffer};

#[derive(Resource, Debug, Clone, Default, PartialEq)]
pub(crate) struct WalkSteps {
    pub rows: Vec<SavedWalkStep>,
}

/// Walkers whose previous and current samples differ, in person-index order.
pub(crate) fn record(buffer: &RenderBuffer) -> Vec<SavedWalkStep> {
    let mut rows = Vec::new();
    for index in 0..buffer.count {
        if buffer.visual_actions.get(index).copied() != Some(visual_action::WALK) {
            continue;
        }
        let Some(&[previous_x, previous_y]) = buffer.prev_positions.get(index * 2..index * 2 + 2)
        else {
            continue;
        };
        let Some(&[x, y]) = buffer.positions.get(index * 2..index * 2 + 2) else {
            continue;
        };
        if previous_x == x && previous_y == y {
            continue;
        }
        let Some(&person) = buffer.ids.get(index) else {
            continue;
        };
        rows.push(SavedWalkStep {
            person,
            x: previous_x,
            y: previous_y,
        });
    }
    rows.sort_by_key(|step| step.person);
    rows
}

/// When both samples are equal, face along the saved step instead of the next path leg.
pub(crate) fn apply_equal_sample_facing(
    buffer: &mut RenderBuffer,
    steps: &[SavedWalkStep],
    facing_between: fn(f32, f32, f32, f32) -> Option<u32>,
) {
    if steps.is_empty() {
        return;
    }
    for index in 0..buffer.count {
        if buffer.visual_actions.get(index).copied() != Some(visual_action::WALK) {
            continue;
        }
        let Some(&[previous_x, previous_y]) = buffer.prev_positions.get(index * 2..index * 2 + 2)
        else {
            continue;
        };
        let Some(&[x, y]) = buffer.positions.get(index * 2..index * 2 + 2) else {
            continue;
        };
        if previous_x != x || previous_y != y {
            continue;
        }
        let Some(&person) = buffer.ids.get(index) else {
            continue;
        };
        let Ok(found) = steps.binary_search_by_key(&person, |step| step.person) else {
            continue;
        };
        let step = &steps[found];
        if let Some(direction) = facing_between(step.x, step.y, x, y) {
            if let Some(facing) = buffer.facings.get_mut(index) {
                *facing = direction;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render_buffer::{activity, facing, visual_action};
    use crate::Sim;
    use terri_core::{Agent, Needs, Path, Position, NEED_MAX};

    fn row(buffer: &RenderBuffer, entity: bevy_ecs::entity::Entity) -> usize {
        buffer
            .ids
            .iter()
            .position(|id| *id == entity.index_u32())
            .expect("walker row")
    }

    fn samples(
        buffer: &RenderBuffer,
        entity: bevy_ecs::entity::Entity,
    ) -> ((f32, f32), (f32, f32)) {
        let index = row(buffer, entity);
        (
            (
                buffer.prev_positions[index * 2],
                buffer.prev_positions[index * 2 + 1],
            ),
            (buffer.positions[index * 2], buffer.positions[index * 2 + 1]),
        )
    }

    fn projection(buffer: &RenderBuffer, entity: bevy_ecs::entity::Entity) -> (u32, u32, u32) {
        let index = row(buffer, entity);
        (
            buffer.visual_actions[index],
            buffer.facings[index],
            buffer.activities[index],
        )
    }

    fn walker(
        sim: &mut Sim,
        position: Position,
        steps: Vec<(i32, i32)>,
    ) -> bevy_ecs::entity::Entity {
        sim.world_mut()
            .spawn((
                Agent,
                position,
                Needs::all_at(NEED_MAX),
                Path { steps, cursor: 0 },
            ))
            .id()
    }

    fn walk(sim: &mut Sim, ticks: usize) {
        for _ in 0..ticks {
            sim.tick();
            sim.sync_render_buffer();
        }
    }

    fn assert_corner_load_keeps_the_incoming_direction(
        start: Position,
        steps: Vec<(i32, i32)>,
        ticks: usize,
    ) {
        let mut sim = Sim::new_with_lot(16, 16);
        let agent = walker(&mut sim, start, steps);
        sim.sync_render_buffer();
        walk(&mut sim, ticks);

        let (previous, current) = samples(sim.render_buffer(), agent);
        assert_ne!(
            previous, current,
            "the arrival frame still has a position delta"
        );
        let incoming = crate::facing_between(previous.0, previous.1, current.0, current.1)
            .expect("the arrival delta has a direction");
        let (action, exported, activity_code) = projection(sim.render_buffer(), agent);
        assert_eq!(
            (action, activity_code),
            (visual_action::WALK, activity::WALKING)
        );
        assert_ne!(
            exported, incoming,
            "the path cursor already points along the next leg"
        );

        let snapshot = sim.save_snapshot_v34();
        assert!(
            snapshot
                .walk_steps
                .iter()
                .any(|step| step.person == agent.index_u32() && (step.x, step.y) == previous),
            "the save records the position the walker just left"
        );
        let hash = sim.world_hash();
        let mut restored = Sim::new_with_lot(1, 1);
        restored
            .load_snapshot_v34(snapshot.clone())
            .expect("corner walk save");
        assert_eq!(restored.world_hash(), hash);
        assert_eq!(samples(restored.render_buffer(), agent), (current, current));
        assert_eq!(
            projection(restored.render_buffer(), agent),
            (visual_action::WALK, incoming, activity::WALKING),
            "a load on the corner keeps the direction just walked"
        );
        assert_eq!(restored.save_snapshot_v34(), snapshot);

        let mut older = Sim::new_with_lot(1, 1);
        older
            .load_snapshot_v33(sim.save_snapshot_v33())
            .expect("schema 33 still loads");
        assert!(older.save_snapshot_v34().walk_steps.is_empty());
        assert_eq!(
            projection(older.render_buffer(), agent),
            (visual_action::WALK, exported, activity::WALKING),
            "a save from before the step was recorded still uses the next leg"
        );
        // Saving again while both samples are still equal does not invent
        // the step. The incoming direction appears only after a later tick
        // sees the body move.
        let resaved = older.save_snapshot_v34();
        assert!(resaved.walk_steps.is_empty());
        let mut again = Sim::new_with_lot(1, 1);
        again
            .load_snapshot_v34(resaved)
            .expect("a resave of an older corner load");
        assert!(again.save_snapshot_v34().walk_steps.is_empty());
        assert_eq!(
            projection(again.render_buffer(), agent),
            (visual_action::WALK, exported, activity::WALKING),
            "saving while the housemate is still standing on the corner leaves the next leg"
        );
    }

    #[test]
    fn a_load_on_the_first_path_corner_keeps_the_incoming_direction() {
        // The path does not store the tile the walk started on, so the first
        // corner cannot be rebuilt from the route.
        assert_corner_load_keeps_the_incoming_direction(
            Position { x: 2.0, y: 2.0 },
            vec![(3, 2), (3, 3)],
            4,
        );
    }

    #[test]
    fn a_load_on_a_later_path_corner_keeps_the_incoming_direction() {
        assert_corner_load_keeps_the_incoming_direction(
            Position { x: 2.0, y: 2.0 },
            vec![(3, 2), (4, 2), (4, 3)],
            8,
        );
    }

    #[test]
    fn a_straight_tile_keeps_its_direction_and_a_held_walker_has_no_step() {
        let mut sim = Sim::new_with_lot(16, 16);
        let straight = walker(&mut sim, Position { x: 2.0, y: 2.0 }, vec![(3, 2), (4, 2)]);
        sim.sync_render_buffer();
        walk(&mut sim, 4);

        let (previous, current) = samples(sim.render_buffer(), straight);
        let incoming = crate::facing_between(previous.0, previous.1, current.0, current.1).unwrap();
        assert_eq!(projection(sim.render_buffer(), straight).1, incoming);
        let snapshot = sim.save_snapshot_v34();
        let mut restored = Sim::new_with_lot(1, 1);
        restored.load_snapshot_v34(snapshot).unwrap();
        assert_eq!(projection(restored.render_buffer(), straight).1, incoming);

        let mut held = Sim::new_with_lot(16, 16);
        let paused = walker(&mut held, Position { x: 8.0, y: 8.0 }, vec![(9, 8)]);
        held.sync_render_buffer();
        held.sync_render_buffer_after_commands();
        assert!(held.save_snapshot_v34().walk_steps.is_empty());
        assert_eq!(
            projection(held.render_buffer(), paused),
            (visual_action::WALK, facing::POSITIVE_X, activity::WALKING)
        );
        let held_snapshot = held.save_snapshot_v34();
        let mut loaded = Sim::new_with_lot(1, 1);
        loaded.load_snapshot_v34(held_snapshot).unwrap();
        assert_eq!(
            projection(loaded.render_buffer(), paused).1,
            facing::POSITIVE_X
        );
        assert_eq!(
            samples(loaded.render_buffer(), paused),
            ((8.0, 8.0), (8.0, 8.0))
        );
    }

    #[test]
    fn growing_the_lot_keeps_a_corner_walkers_incoming_direction() {
        // A rear purchase adds the strip to X and a right purchase adds it
        // to Y. Both go through `grow`. Left adds nothing, so it cannot
        // catch a step that stays on the old lot.
        for (dx, dy) in [(4u32, 0), (0, 4u32)] {
            let mut sim = Sim::new_with_lot(16, 16);
            let agent = walker(&mut sim, Position { x: 2.0, y: 2.0 }, vec![(2, 3), (3, 3)]);
            sim.sync_render_buffer();
            walk(&mut sim, 4);

            let (previous, current) = samples(sim.render_buffer(), agent);
            let incoming =
                crate::facing_between(previous.0, previous.1, current.0, current.1).unwrap();
            let exported = projection(sim.render_buffer(), agent).1;
            assert_eq!(incoming, facing::POSITIVE_Y);
            assert_eq!(exported, facing::POSITIVE_X);

            crate::land::grow(sim.world_mut(), (dx, dy), (dx, dy));
            sim.sync_render_buffer_after_commands();

            let shifted = (current.0 + dx as f32, current.1 + dy as f32);
            assert_eq!(samples(sim.render_buffer(), agent), (shifted, shifted));
            assert_eq!(projection(sim.render_buffer(), agent).1, incoming);
            let stored = sim
                .save_snapshot_v34()
                .walk_steps
                .into_iter()
                .find(|step| step.person == agent.index_u32())
                .map(|step| (step.x, step.y));
            assert_eq!(
                stored,
                Some((previous.0 + dx as f32, previous.1 + dy as f32))
            );

            let snapshot = sim.save_snapshot_v34();
            let hash = sim.world_hash();
            let mut loaded = Sim::new_with_lot(1, 1);
            loaded.load_snapshot_v34(snapshot).unwrap();
            assert_eq!(loaded.world_hash(), hash);
            assert_eq!(samples(loaded.render_buffer(), agent), (shifted, shifted));
            assert_eq!(projection(loaded.render_buffer(), agent).1, incoming);
        }
    }
}
