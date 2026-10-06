//! Draw only the physical work stage; queues and travel never hold cleaning tools.
use super::*;
use terri_core::{grime::SavedGrime, Position, TileGrid};

pub(crate) fn projection(
    world: &World,
    person: Entity,
) -> Option<(crate::SocketActionProjection, u32)> {
    world.get::<terri_core::Agent>(person)?;
    world.get::<terri_core::Needs>(person)?;
    world.get::<ChoreWork>(person)?;
    if world
        .try_query::<&terri_core::Socialising>()
        .is_some_and(|mut q| q.iter(world).any(|s| s.partner == person))
    {
        return None;
    }

    if world.get::<terri_core::Path>(person).is_some()
        || world.get::<terri_core::Target>(person).is_some()
        || world.get::<terri_core::Eating>(person).is_some()
        || world.get::<terri_core::StepWork>(person).is_some()
        || world.get::<terri_core::ChainState>(person).is_some()
        || world.get::<terri_core::AtWork>(person).is_some()
        || world.get::<terri_core::Commuting>(person).is_some()
        || world.get::<terri_core::Socialising>(person).is_some()
    {
        return None;
    }
    let task = world
        .get_resource::<SavedChores>()?
        .tasks
        .iter()
        .find(|t| t.person == person.index_u32())?;
    if task.suspended || task.remaining == 0 {
        return None;
    }
    let pos = world.get::<Position>(person)?;
    let width = world.resource::<TileGrid>().width() as u32;
    let endpoint = task
        .endpoint
        .or_else(|| task.cells.get(task.cursor as usize).copied())?;
    let at = ((endpoint % width) as f32, (endpoint / width) as f32);
    if (pos.x - at.0).abs() > 0.01 || (pos.y - at.1).abs() > 0.01 {
        return None;
    }
    let (action, activity, total, target, dx, dy, shift) = match task.key.kind {
        ChoreKind::Floors => {
            let legacy = world
                .get_resource::<SavedGrime>()
                .is_none_or(|s| s.legacy_floors.contains(&task.person));
            (
                14,
                24,
                if legacy { 12 } else { 24 },
                u32::MAX,
                1.0,
                0.0,
                0.0,
            )
        }
        ChoreKind::Surfaces
        | ChoreKind::CounterSurfaces
        | ChoreKind::TableSurfaces
        | ChoreKind::Bins => {
            let key = groups::current_key(task);
            if !work::contact_valid(world, key, endpoint) {
                return None;
            }
            let object = crate::dining::entity(world, key.target)?;
            let origin = world.get::<Position>(object)?;
            let definition = world.get::<terri_core::SmartObject>(object)?;
            let footprint = crate::placed_footprint(
                world.resource::<crate::Content>().0,
                definition.0,
                world.get::<terri_core::ObjectFacing>(object),
            );
            let (dx, dy) = if pos.x < origin.x {
                (1.0, 0.0)
            } else if pos.x >= origin.x + footprint.width as f32 {
                (-1.0, 0.0)
            } else if pos.y < origin.y {
                (0.0, 1.0)
            } else {
                (0.0, -1.0)
            };
            if key.kind == ChoreKind::Bins {
                (17, 26, 60, key.target, dx, dy, 0.35)
            } else {
                (
                    if groups::kind(world, object) == Some(ChoreKind::TableSurfaces) {
                        16
                    } else {
                        15
                    },
                    25,
                    45,
                    key.target,
                    dx,
                    dy,
                    0.15,
                )
            }
        }
        ChoreKind::Dishes => return None,
    };
    if task.remaining > total {
        return None;
    }
    let facing = if dx > 0.0 {
        1
    } else if dx < 0.0 {
        2
    } else if dy > 0.0 {
        3
    } else {
        4
    };
    Some((
        crate::SocketActionProjection {
            x: pos.x + dx * shift,
            y: pos.y + dy * shift,
            facing,
            target_entity: target,
            visual_action: action,
            activity,
        },
        (total - task.remaining) * 1000 / total,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surface_and_bin_work_faces_its_contact_and_shares_saved_progress() {
        for (name, action, kind, total) in [
            ("counter", 15, ChoreKind::Surfaces, 45),
            ("dining_table", 16, ChoreKind::Surfaces, 45),
            ("trashcan", 17, ChoreKind::Bins, 60),
        ] {
            let mut sim = crate::Sim::new_with_lot(16, 16);
            ensure(sim.world_mut());
            let pack = sim.world().resource::<crate::Content>().0;
            let definition = pack.objects.iter().position(|o| o.id == name).unwrap();
            let object = sim.spawn_object(
                Position { x: 6.0, y: 6.0 },
                terri_core::ObjectDefId(definition as u32),
            );
            let footprint = crate::placed_footprint(
                pack,
                terri_core::ObjectDefId(definition as u32),
                sim.world().get::<terri_core::ObjectFacing>(object),
            );
            let person = sim
                .world_mut()
                .spawn((
                    terri_core::Agent,
                    terri_core::Needs::all_at(80.0),
                    Position { x: 5.0, y: 6.0 },
                ))
                .id();
            let key = ChoreKey {
                kind,
                target: object.index_u32(),
            };
            for (x, y, facing) in [
                (5, 6, 1),
                (6 + footprint.width as u32, 6, 2),
                (6, 5, 3),
                (6, 6 + footprint.depth, 4),
            ] {
                sim.world_mut().entity_mut(person).insert(Position {
                    x: x as f32,
                    y: y as f32,
                });
                let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
                add(
                    if kind == ChoreKind::Bins {
                        &mut state.bins
                    } else {
                        &mut state.surfaces
                    },
                    key.target,
                    1000,
                );
                assert!(work::start(sim.world_mut(), &mut state, person, key, true));
                assert_eq!(state.tasks[0].endpoint, Some(y * 16 + x));
                state.tasks[0].remaining = total / 2;
                sim.world_mut().insert_resource(state);
                let (visual, progress) = projection(sim.world(), person).unwrap();
                assert_eq!(
                    (visual.visual_action, visual.facing, visual.target_entity),
                    (action, facing, object.index_u32())
                );
                assert_eq!(progress, (total - total / 2) * 1000 / total);
                let hash = sim.world_hash();
                sim.sync_render_buffer();
                assert_eq!(
                    sim.world_hash(),
                    hash,
                    "presentation must not change future work"
                );
                let buffer = sim.render_buffer();
                let row = buffer
                    .ids
                    .iter()
                    .position(|id| *id == person.index_u32())
                    .unwrap();
                assert_eq!(
                    (buffer.visual_actions[row], buffer.chore_progress[row]),
                    (action, progress)
                );
                if kind == ChoreKind::Bins {
                    let bin_row = buffer
                        .ids
                        .iter()
                        .position(|id| *id == object.index_u32())
                        .unwrap();
                    assert_eq!(buffer.chore_progress[bin_row], progress);
                }
                sim.world_mut()
                    .entity_mut(person)
                    .insert(Position { x: 1.0, y: 1.0 });
                assert!(
                    projection(sim.world(), person).is_none(),
                    "travel has no cleaning pose"
                );
                work::cancel(sim.world_mut(), person);
                assert!(projection(sim.world(), person).is_none());
            }
        }
    }
    #[test]
    fn active_floor_work_has_a_mop_and_saved_progress_but_suspension_hides_it() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        super::super::ensure(sim.world_mut());
        let person = sim
            .world_mut()
            .query_filtered::<Entity, With<terri_core::Agent>>()
            .iter(sim.world())
            .next()
            .unwrap();
        let width = sim.world().resource::<TileGrid>().width() as u32;
        let cell = 4 * width + 6;
        sim.world_mut()
            .entity_mut(person)
            .insert(Position { x: 6.0, y: 4.0 });
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        state.board_enabled = false;
        add(&mut state.floors, cell, 1000);
        assert!(work::start(
            sim.world_mut(),
            &mut state,
            person,
            ChoreKey {
                kind: ChoreKind::Floors,
                target: 0
            },
            true
        ));
        work::advance(sim.world_mut(), &mut state);
        sim.world_mut().insert_resource(state);
        let (visual, progress) = projection(sim.world(), person).unwrap();
        assert_eq!(visual.visual_action, 14);
        assert_eq!(progress, 41);
        sim.sync_render_buffer();
        let buffer = sim.render_buffer();
        let row = buffer
            .ids
            .iter()
            .position(|id| *id == person.index_u32())
            .unwrap();
        assert_eq!(buffer.visual_actions[row], 14);
        let hash = sim.world_hash();
        let mut loaded = crate::Sim::new_from_shipped_lot();
        loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
        assert_eq!(loaded.world_hash(), hash);
        assert_eq!(projection(loaded.world(), person).unwrap().1, progress);
        sim.world_mut().resource_mut::<SavedChores>().tasks[0].suspended = true;
        assert!(projection(sim.world(), person).is_none());
        work::cancel(sim.world_mut(), person);
        assert!(projection(sim.world(), person).is_none());
    }
}
