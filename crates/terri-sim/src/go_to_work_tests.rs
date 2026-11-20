//! Go to work: issues 311 and 317, `docs/specs/2026-11-19-career-tab.md`,
//! [CT-command]. The command's behavior is [CT-work]; these tests hold the
//! plumbing around it: its place in the drain, its count and result, its
//! queue hash and the way older save writers leave it out.
use crate::careers::{CareerRefusal, CareerResult, Careers};
use crate::Sim;
use bevy_ecs::prelude::*;
use terri_core::{Agent, CommandQueue, SimCommand, SimId};

/// Every living person with their id, in id order.
fn household(sim: &mut Sim) -> Vec<(SimId, Entity)> {
    let mut people: Vec<(SimId, Entity)> = sim
        .world_mut()
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(sim.world())
        .map(|(entity, id)| (*id, entity))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    people
}

fn push(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
}

fn issue(sim: &mut Sim, command: SimCommand) {
    push(sim, command);
    sim.flush_commands();
}

/// [CT-command] items 3 and 4: the drain applies `GoToWork` as a career
/// command, so each one handled adds one to the count and sets the result,
/// whatever its outcome. Until the behavior lands, a person who is not due
/// is refused as `NotDue`, and the refusal changes nothing else.
#[test]
fn go_to_work_is_counted_and_reported_like_a_career_command() {
    let mut sim = Sim::new_from_shipped_lot();
    let (_, entity) = household(&mut sim)[0];
    let agent = entity.index_u32();
    let commands = sim.world().resource::<Careers>().commands;
    issue(&mut sim, SimCommand::GoToWork { agent });
    let careers = sim.world().resource::<Careers>();
    assert_eq!(careers.commands, commands + 1);
    assert_eq!(
        careers.last_result,
        Some(CareerResult {
            agent,
            reason: Some(CareerRefusal::NotDue)
        })
    );
    // A refusal changes nothing else: the world hashes as it does after a
    // career command refused for naming no one.
    let mut twin = Sim::new_from_shipped_lot();
    issue(&mut twin, SimCommand::QuitCareer { agent: 99_999 });
    assert_eq!(sim.world_hash(), twin.world_hash());
    assert!(
        sim.world().resource::<CommandQueue>().is_empty(),
        "the drain consumed the command"
    );
    issue(&mut sim, SimCommand::GoToWork { agent });
    assert_eq!(sim.world().resource::<Careers>().commands, commands + 2);
}

/// [CT-command] item 4: the two new refusals are numbered 7 and 8 for the
/// shell, after the six that exist.
#[test]
fn the_new_refusals_are_numbered_for_the_shell() {
    assert_eq!(CareerRefusal::NotDue as u8, 7);
    assert_eq!(CareerRefusal::NoRoute as u8, 8);
    assert_eq!(CareerRefusal::SameShift as u8, 6);
}

/// [CT-command] item 2: a queued `GoToWork` is part of the world hash
/// (`queued-commands-v1`), by its code and by the person it names, and no
/// other career command's hash collides with it.
#[test]
fn a_queued_go_to_work_moves_the_hash_by_code_and_person() {
    let hash_with = |command: Option<SimCommand>| {
        let mut sim = Sim::new_from_shipped_lot();
        if let Some(command) = command {
            push(&mut sim, command);
        }
        sim.world_hash()
    };
    let empty = hash_with(None);
    let three = hash_with(Some(SimCommand::GoToWork { agent: 3 }));
    let four = hash_with(Some(SimCommand::GoToWork { agent: 4 }));
    assert_ne!(three, empty, "a queued command is hashed");
    assert_ne!(three, four, "the person is hashed");
    assert_ne!(
        three,
        hash_with(Some(SimCommand::QuitCareer { agent: 3 })),
        "the code is hashed"
    );
    assert_eq!(
        three,
        hash_with(Some(SimCommand::GoToWork { agent: 3 })),
        "the same queue hashes the same"
    );
}

/// [CT-command] item 5: until schema 24 carries it, every writer leaves a
/// queued `GoToWork` out, with the positions it would count, so the rest of
/// the queue saves exactly as it does without it and loads in order.
#[test]
fn older_writers_leave_a_queued_go_to_work_out() {
    let mut with = Sim::new_from_shipped_lot();
    let mut without = Sim::new_from_shipped_lot();
    let agent = household(&mut with)[0].1.index_u32();
    let ordinary = [
        SimCommand::SetSpeed(2),
        SimCommand::SetJobSearch {
            agent,
            search: false,
        },
        SimCommand::ChangeShift { agent, shift: 1 },
        SimCommand::SetSpeed(1),
    ];
    for command in ordinary.iter().cloned() {
        push(&mut without, command);
    }
    for command in [
        ordinary[0].clone(),
        SimCommand::GoToWork { agent },
        ordinary[1].clone(),
        ordinary[2].clone(),
        SimCommand::GoToWork { agent },
        ordinary[3].clone(),
    ] {
        push(&mut with, command);
    }
    assert_eq!(with.save_snapshot_v14(), without.save_snapshot_v14());
    assert_eq!(with.save_snapshot_v15(), without.save_snapshot_v15());
    assert_eq!(with.save_snapshot_v16(), without.save_snapshot_v16());
    assert_eq!(with.save_snapshot_v17(), without.save_snapshot_v17());
    assert_eq!(with.save_snapshot_v18(), without.save_snapshot_v18());
    assert_eq!(with.save_snapshot_v19(), without.save_snapshot_v19());
    assert_eq!(with.save_snapshot_v20(), without.save_snapshot_v20());
    assert_eq!(with.save_snapshot_v21(), without.save_snapshot_v21());
    assert_eq!(with.save_snapshot_v22(), without.save_snapshot_v22());
    assert_eq!(with.save_snapshot_v23(), without.save_snapshot_v23());
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v23(with.save_snapshot_v23())
        .expect("loads");
    assert_eq!(
        loaded.world().resource::<CommandQueue>().as_slice(),
        ordinary.as_slice()
    );
}
