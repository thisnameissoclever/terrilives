//! Ordinary Sim construction uses the same private final-state validation gate.
use super::*;
#[path = "ordinary_runtime.rs"]
pub(super) mod runtime;
use terri_core::{command::BookCommand, CommandQueue, SimCommand};

#[derive(Resource, Default)]
pub(super) struct NativeFeedback {
    pub error: Option<BuildCommitError>,
}
#[derive(Resource)]
struct NativeBatch {
    accepted: bool,
    ordinary: bool,
}
#[derive(Resource)]
pub(crate) struct SkipCommandDrain;
pub(crate) fn is_batch(world: &World) -> bool {
    world.contains_resource::<NativeBatch>()
}
pub(crate) fn maintain_batch(world: &World) -> bool {
    world
        .get_resource::<NativeBatch>()
        .is_none_or(|b| b.accepted || b.ordinary)
}
pub(crate) fn has_ordinary(world: &World) -> bool {
    world
        .get_resource::<NativeBatch>()
        .is_some_and(|b| b.ordinary)
}
pub(crate) fn dispatch(world: &mut World, command: &SimCommand) -> bool {
    if !is_batch(world) {
        return false;
    }
    let before = match RoomChangeContext::capture(world) {
        Ok(before) => before,
        Err(error) => {
            record_error(world, error.into());
            return true;
        }
    };
    let origin = crate::lot_frame::origin(world);
    let Some(receipt) = super::commands::apply(world, command) else {
        return false;
    };
    if receipt.accepted() {
        world.resource_mut::<NativeBatch>().accepted = true;
        if let Err(error) = reconcile_ordinary(world, &before, origin) {
            record_error(world, error.into());
        }
    }
    true
}

pub(crate) fn has_error(world: &World) -> bool {
    world
        .get_resource::<NativeFeedback>()
        .is_some_and(|f| f.error.is_some())
}
pub(crate) fn record_error(world: &mut World, error: BuildCommitError) {
    world.init_resource::<NativeFeedback>();
    world.resource_mut::<NativeFeedback>().error = Some(error);
}

pub(crate) fn construction(command: &SimCommand) -> bool {
    matches!(
        command,
        SimCommand::PlaceObject { .. }
            | SimCommand::SetWallEdge { .. }
            | SimCommand::FitWindow { .. }
            | SimCommand::RemoveWindow { .. }
            | SimCommand::SetFloor { .. }
            | SimCommand::BuildRoom { .. }
            | SimCommand::BuyObject { .. }
            | SimCommand::BuyObjectInColourway { .. }
            | SimCommand::SellObject { .. }
            | SimCommand::SetColourway { .. }
            | SimCommand::BuyLand { .. }
    ) || matches!(command,SimCommand::Book(book) if !matches!(book,BookCommand::Read { .. }))
}
pub(crate) fn needs_atomic_drain(world: &World) -> bool {
    !deferred(world)
        && !world.contains_resource::<NativeBatch>()
        && crate::rooms::stable(world)
        && world
            .resource::<CommandQueue>()
            .as_slice()
            .iter()
            .any(construction)
}
/// A completed ordinary drain consumes its request batch and clears old sounds,
/// including on typed refusal. Preparation itself never changes the live world.
pub(crate) fn run_atomic_drain(sim: &mut Sim) {
    let commands = sim.world.resource::<CommandQueue>().as_slice().to_vec();
    if commands
        .iter()
        .all(|command| super::commands::certainly_refused(&sim.world, command))
    {
        finish_drain(sim);
        for command in commands {
            let receipt = super::commands::apply(&mut sim.world, &command)
                .expect("checked construction refusal");
            debug_assert!(!receipt.accepted());
        }
        return;
    }
    let result = prepare(sim, commands);
    finish_drain(sim);
    match result {
        Ok(prepared) if prepared.changed => {
            if let Err(error) = runtime::install(sim, prepared.candidate) {
                record_error(&mut sim.world, error.into());
            }
        }
        Ok(prepared) => {
            if prepared.accepted {
                if let Err(error) = advance_view(&mut sim.world) {
                    record_error(&mut sim.world, error.into());
                    return;
                }
            }
            runtime::copy_feedback(&prepared.candidate.world, &mut sim.world);
        }
        Err(error) => record_error(&mut sim.world, error),
    }
}
fn finish_drain(sim: &mut Sim) {
    sim.world
        .resource_mut::<CommandQueue>()
        .drain()
        .for_each(drop);
    sim.clear_completion_sounds();
    sim.world.remove_resource::<NativeFeedback>();
}
struct PreparedOrdinary {
    candidate: Sim,
    changed: bool,
    accepted: bool,
}
fn prepare(sim: &Sim, commands: Vec<SimCommand>) -> Result<PreparedOrdinary, BuildCommitError> {
    next_epoch(&sim.world).map_err(|_| BuildCommitError::CounterExhausted)?;
    let baseline = save::v18::capture_without_commands(sim);
    let mut candidate = save::v18::restore(
        baseline.clone(),
        sim.world.resource::<Content>().0,
        save::Carried::for_load(&sim.world),
    )?;
    runtime::copy_feedback(&sim.world, &mut candidate.world);
    candidate.world.insert_resource(NativeBatch {
        accepted: false,
        ordinary: commands.iter().any(|command| !construction(command)),
    });
    for command in commands {
        candidate.world.resource_mut::<CommandQueue>().push(command);
    }
    candidate.flush_commands();
    if let Some(error) = candidate
        .world
        .remove_resource::<NativeFeedback>()
        .and_then(|f| f.error)
    {
        return Err(error);
    }
    if maintain_batch(&candidate.world) {
        final_maintenance(&mut candidate.world);
    }
    runtime::refresh_derived(&mut candidate.world);
    let accepted = candidate
        .world
        .remove_resource::<NativeBatch>()
        .unwrap()
        .accepted;
    let final_state = save::v18::capture(&candidate);
    save::v18::restore(
        final_state.clone(),
        sim.world.resource::<Content>().0,
        save::Carried::for_load(&sim.world),
    )?;
    Ok(PreparedOrdinary {
        candidate,
        changed: final_state != baseline,
        accepted,
    })
}
