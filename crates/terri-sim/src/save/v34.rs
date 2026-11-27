use std::collections::BTreeMap;

use bevy_ecs::prelude::World;
use terri_core::{save_v34::SavedWalkStep, Agent, Entity, Position, SaveSnapshotV34};

use super::{v33, Carried, SaveError, MAX_ENTITIES};
use crate::{portals, walk_steps::WalkSteps, Sim};

fn rows(sim: &Sim) -> Vec<SavedWalkStep> {
    sim.world().resource::<WalkSteps>().rows.clone()
}

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV34 {
    SaveSnapshotV34 {
        previous: v33::capture(sim),
        walk_steps: rows(sim),
    }
}

pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV34 {
    SaveSnapshotV34 {
        previous: v33::capture_without_commands(sim),
        walk_steps: rows(sim),
    }
}

fn validate_shape(rows: &[SavedWalkStep]) -> Result<(), SaveError> {
    if rows.len() > MAX_ENTITIES
        || rows.windows(2).any(|pair| pair[0].person >= pair[1].person)
        || rows
            .iter()
            .any(|step| !step.x.is_finite() || !step.y.is_finite())
    {
        return Err(SaveError::InvalidValue);
    }
    Ok(())
}

fn validate_live(world: &World, rows: &[SavedWalkStep]) -> Result<(), SaveError> {
    if rows.is_empty() {
        return Ok(());
    }
    let mut query = world
        .try_query::<(Entity, &Agent, &Position)>()
        .ok_or(SaveError::InvalidEntityReference)?;
    let agents: BTreeMap<u32, (Entity, Position)> = query
        .iter(world)
        .map(|(entity, _, position)| (entity.index_u32(), (entity, *position)))
        .collect();
    for step in rows {
        let Some((entity, position)) = agents.get(&step.person) else {
            return Err(SaveError::InvalidEntityReference);
        };
        let shown = portals::crossing_position(world, *entity, *position);
        if step.x == shown.x && step.y == shown.y {
            return Err(SaveError::InvalidValue);
        }
    }
    Ok(())
}

pub(crate) fn restore(
    snapshot: SaveSnapshotV34,
    content: &'static terri_data::ContentPack,
    carried: Carried,
) -> Result<Sim, SaveError> {
    let SaveSnapshotV34 {
        previous,
        walk_steps,
    } = snapshot;
    validate_shape(&walk_steps)?;
    let mut candidate = v33::restore(previous, content, carried)?;
    validate_live(&candidate.world, &walk_steps)?;
    candidate
        .world
        .insert_resource(WalkSteps { rows: walk_steps });
    // The load that adopts this sim syncs again. Syncing here leaves a
    // candidate that is already facing along the saved step.
    candidate.sync_render_buffer_after_commands();
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;
    use terri_core::{Agent, Path, Position};

    fn corner_snapshot() -> (Sim, SaveSnapshotV34) {
        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut().spawn((
            Agent,
            Position { x: 2.0, y: 2.0 },
            Path {
                steps: vec![(3, 2), (3, 3)],
                cursor: 0,
            },
        ));
        sim.sync_render_buffer();
        for _ in 0..4 {
            sim.tick();
            sim.sync_render_buffer();
        }
        let snapshot = sim.save_snapshot_v34();
        assert!(!snapshot.walk_steps.is_empty());
        (sim, snapshot)
    }

    fn rejects(snapshot: SaveSnapshotV34) {
        let (live, _) = corner_snapshot();
        let hash = live.world_hash();
        let before = live.save_snapshot_v34();
        let mut target = live;
        assert!(target.load_snapshot_v34(snapshot).is_err());
        assert_eq!(target.world_hash(), hash);
        assert_eq!(target.save_snapshot_v34(), before);
    }

    #[test]
    fn malformed_walk_steps_leave_the_running_game_unchanged() {
        let (_, snapshot) = corner_snapshot();
        let step = snapshot.walk_steps[0];

        let mut duplicate = snapshot.clone();
        duplicate.walk_steps.push(step);
        rejects(duplicate);

        let mut descending = snapshot.clone();
        descending.walk_steps.insert(
            0,
            SavedWalkStep {
                person: step.person.saturating_add(1),
                x: 0.0,
                y: 0.0,
            },
        );
        rejects(descending);

        let mut infinite = snapshot.clone();
        infinite.walk_steps[0].x = f32::NAN;
        rejects(infinite);

        let mut missing = snapshot.clone();
        missing.walk_steps[0].person = 999_999;
        rejects(missing);

        let mut coincident = snapshot.clone();
        coincident.walk_steps[0].x = 3.0;
        coincident.walk_steps[0].y = 2.0;
        rejects(coincident);
    }
}
