//! Preserve one serialized stream across ordinary commands and atomic lot edits.
use bevy_ecs::{prelude::*, system::RunSystemOnce};
use terri_core::{CommandQueue, SimCommand};

pub fn drain_commands(world: &mut World) {
    if !world.contains_resource::<terri_core::save::SavedTargetedCleanup>() {
        world.insert_resource(terri_core::save::SavedTargetedCleanup::default());
    }
    let issued: Vec<_> = world.resource_mut::<CommandQueue>().drain().collect();
    if issued.iter().any(|c| {
        matches!(
            c,
            SimCommand::CleanChore { .. }
                | SimCommand::CleanChoreFirst { .. }
                | SimCommand::SetChoreProfile { .. }
                | SimCommand::SetChoreBoard { .. }
        )
    }) {
        crate::chores::ensure(world);
    }
    for command in issued {
        match command {
            SimCommand::SetChoreProfile {
                agent,
                responsibility,
                preferences,
            } => {
                flush_ordinary(world);
                crate::chores::set_profile(world, agent, responsibility, preferences);
            }
            SimCommand::SetChoreBoard { enabled } => {
                flush_ordinary(world);
                world
                    .resource_mut::<terri_core::chores::SavedChores>()
                    .board_enabled = enabled;
            }
            chore @ (SimCommand::CleanChore { key, .. }
            | SimCommand::CleanChoreFirst { key, .. }) => {
                flush_ordinary(world);
                if crate::chores::key_valid(world, key) {
                    world.resource_mut::<CommandQueue>().push(chore);
                    flush_ordinary(world);
                }
            }
            SimCommand::Book(command) => {
                flush_ordinary(world);
                crate::books::commit(world, command);
                crate::reading::reconcile(world);
            }
            SimCommand::SetDeathEnabled(enabled) => {
                flush_ordinary(world);
                world
                    .resource_mut::<terri_core::save::SavedMortality>()
                    .enabled = enabled;
            }
            SimCommand::PlaceObject {
                object,
                x,
                y,
                facing,
            } => {
                flush_ordinary(world);
                crate::placement::commit(world, object, (x, y), facing);
            }
            SimCommand::FitWindow { axis, x, y, model } => {
                flush_ordinary(world);
                crate::placement::windows::apply_window_edit(
                    world,
                    crate::placement::windows::WindowEdit::Fit(
                        terri_core::windows::WindowPlacement {
                            line: terri_core::layout::WallLine { axis, x, y },
                            model,
                        },
                    ),
                );
            }
            SimCommand::RemoveWindow { axis, x, y } => {
                flush_ordinary(world);
                crate::placement::windows::apply_window_edit(
                    world,
                    crate::placement::windows::WindowEdit::Remove(terri_core::layout::WallLine {
                        axis,
                        x,
                        y,
                    }),
                );
            }
            SimCommand::SetWallEdge { axis, x, y, state } => {
                flush_ordinary(world);
                crate::placement::walls::commit(
                    world,
                    crate::placement::walls::WallEdit { axis, x, y, state },
                );
            }
            SimCommand::SetFamilyTie { who, to, relation } => {
                flush_ordinary(world);
                crate::family::commit(world, who, to, relation);
            }
            SimCommand::SetBedAssignment { agent, place } => {
                flush_ordinary(world);
                crate::beds::commit(world, agent, place);
            }
            SimCommand::SetFloor { x, y, covering } => {
                flush_ordinary(world);
                crate::placement::floors::commit(
                    world,
                    crate::placement::floors::FloorEdit { x, y, covering },
                );
            }
            SimCommand::BuyObject {
                definition,
                x,
                y,
                facing,
            } => {
                flush_ordinary(world);
                crate::placement::purchase::commit(
                    world,
                    crate::placement::purchase::Purchase {
                        definition,
                        x,
                        y,
                        facing,
                    },
                );
            }
            SimCommand::SellObject { object } => {
                flush_ordinary(world);
                crate::placement::sale::commit(world, object);
            }
            SimCommand::AddHousemate {
                name,
                personality,
                traits,
            } => {
                flush_ordinary(world);
                crate::household::commit(world, &name, personality, &traits);
            }
            SimCommand::AddHousemateWithInstinct {
                name,
                personality,
                traits,
                instinct,
            } => {
                flush_ordinary(world);
                crate::household::commit_with_instinct(
                    world,
                    &name,
                    personality,
                    &traits,
                    Some(instinct),
                );
            }
            SimCommand::EditHousemate {
                sim,
                name,
                personality,
                traits,
                ties,
            } => {
                flush_ordinary(world);
                crate::edit::commit(
                    world,
                    &crate::edit::Edit {
                        sim,
                        name: &name,
                        personality,
                        traits: &traits,
                        ties: &ties,
                    },
                );
            }
            SimCommand::BuyObjectInColourway {
                definition,
                x,
                y,
                facing,
                colourway,
            } => {
                flush_ordinary(world);
                crate::placement::purchase::commit_in_colourway(
                    world,
                    crate::placement::purchase::Purchase {
                        definition,
                        x,
                        y,
                        facing,
                    },
                    colourway,
                );
            }
            SimCommand::SetColourway { object, colourway } => {
                flush_ordinary(world);
                crate::placement::colourway::commit(world, object, colourway);
            }
            SimCommand::BuildRoom {
                x0,
                y0,
                x1,
                y1,
                doorway,
            } => {
                flush_ordinary(world);
                crate::placement::rooms::commit(
                    world,
                    crate::placement::rooms::RoomEdit {
                        x0,
                        y0,
                        x1,
                        y1,
                        doorway,
                    },
                );
            }
            ordinary => world.resource_mut::<CommandQueue>().push(ordinary),
        }
    }
    flush_ordinary(world);
    crate::books::shelve_arrivals(world);
    crate::targeted_cleanup::prune(world);
    crate::chores::prune(world);
}

fn flush_ordinary(world: &mut World) {
    if !world.resource::<CommandQueue>().is_empty() {
        // System::run applies its deferred Commands before returning. A cached
        // registered system would allocate an entity and alter saved identities.
        world
            .run_system_once(super::command::drain_ordinary_commands)
            .expect("ordinary command parameters exist");
        crate::reading::reconcile(world);
    }
}
