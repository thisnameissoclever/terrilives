//! Preserve one serialized stream across ordinary commands and atomic lot edits.
use bevy_ecs::{prelude::*, system::RunSystemOnce};
use terri_core::{CommandQueue, SimCommand};

pub fn drain_commands(world: &mut World) {
    let issued: Vec<_> = world.resource_mut::<CommandQueue>().drain().collect();
    for command in issued {
        match command {
            SimCommand::PlaceObject {
                object,
                x,
                y,
                facing,
            } => {
                flush_ordinary(world);
                crate::placement::commit(world, object, (x, y), facing);
            }
            SimCommand::SetWallEdge { axis, x, y, state } => {
                flush_ordinary(world);
                crate::placement::walls::commit(
                    world,
                    crate::placement::walls::WallEdit { axis, x, y, state },
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
}

fn flush_ordinary(world: &mut World) {
    if !world.resource::<CommandQueue>().is_empty() {
        // System::run applies its deferred Commands before returning. A cached
        // registered system would allocate an entity and alter saved identities.
        world
            .run_system_once(super::command::drain_ordinary_commands)
            .expect("ordinary command parameters exist");
    }
}
