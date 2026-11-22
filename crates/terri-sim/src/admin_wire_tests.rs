//! The admin command's plumbing (issue 312, [AP-command] and
//! [AP-save-queue] in `docs/specs/2026-11-20-admin-panel.md`): its place in
//! the drain, its queue hash, the save boundary and Build mode.
use crate::admin::{AdminRefusal, AdminResult};
use crate::build_transaction::BuildCommitError;
use crate::{save, Sim};
use terri_core::admin::{AdminChange, AdminEdit};
use terri_core::{CommandQueue, SimCommand};

fn admin(edits: Vec<AdminEdit>) -> SimCommand {
    SimCommand::Admin(Box::new(AdminChange { edits }))
}

fn satisfaction(value: f32) -> SimCommand {
    admin(vec![AdminEdit::SetSatisfaction { sim: 0, value }])
}

fn push(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
}

/// [AP-cmd-wire] item 3: a queued admin command is part of the world hash by
/// its code, its edit count and every field, a float by its bits.
#[test]
fn a_queued_admin_command_moves_the_hash_by_every_field() {
    let hash_with = |command: Option<SimCommand>| {
        let mut sim = Sim::new_from_shipped_lot();
        if let Some(command) = command {
            push(&mut sim, command);
        }
        sim.world_hash()
    };
    let empty = hash_with(None);
    let half = hash_with(Some(satisfaction(50.0)));
    assert_ne!(half, empty, "a queued admin command is hashed");
    assert_eq!(half, hash_with(Some(satisfaction(50.0))));
    assert_ne!(
        half,
        hash_with(Some(satisfaction(f32::from_bits(50.0f32.to_bits() + 1)))),
        "the value is hashed by its bits"
    );
    assert_ne!(
        half,
        hash_with(Some(admin(vec![AdminEdit::SetSatisfaction {
            sim: 1,
            value: 50.0
        }]))),
        "the person is hashed"
    );
    assert_ne!(
        half,
        hash_with(Some(admin(vec![AdminEdit::SetJobSatisfaction {
            sim: 0,
            value: 50.0
        }]))),
        "the edit code is hashed"
    );
    assert_ne!(
        half,
        hash_with(Some(admin(vec![
            AdminEdit::SetSatisfaction {
                sim: 0,
                value: 50.0
            },
            AdminEdit::SetFunds { cents: 0 },
        ]))),
        "every edit is hashed"
    );
}

/// [AP-cmd-drain] item 1: with no session, the drain refuses the change as
/// `NoSession`, changes nothing the world hash sees, empties the queue and
/// leaves the career and lot edit results alone.
#[test]
fn the_drain_refuses_an_admin_change_without_a_session() {
    let mut sim = Sim::new_from_shipped_lot();
    let mut twin = Sim::new_from_shipped_lot();
    let careers = sim
        .world()
        .resource::<crate::careers::Careers>()
        .last_result;
    let lot = sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_edit_result;
    assert_eq!(crate::admin::last_result(sim.world()), None);
    push(&mut sim, satisfaction(12.0));
    sim.flush_commands();
    twin.flush_commands();
    assert!(sim.world().resource::<CommandQueue>().is_empty());
    assert_eq!(
        crate::admin::last_result(sim.world()),
        Some(AdminResult {
            sequence: 0,
            refusal: Some((0, AdminRefusal::NoSession)),
        })
    );
    assert_eq!(sim.world_hash(), twin.world_hash());
    assert_eq!(
        sim.world()
            .resource::<crate::careers::Careers>()
            .last_result,
        careers
    );
    assert_eq!(
        sim.world()
            .resource::<crate::placement::LotEditState>()
            .last_edit_result,
        lot
    );
    push(&mut sim, satisfaction(13.0));
    sim.flush_commands();
    assert_eq!(
        crate::admin::last_result(sim.world()).map(|result| result.sequence),
        Some(1),
        "each drained change has its own sequence"
    );
}

/// [AP-save-queue] item 3: a save that finds an admin command queued is
/// refused with `AdminCommandQueued` rather than panicking or writing a
/// save that leaves it out; an empty queue saves as before.
#[test]
fn a_save_refuses_a_queued_admin_command() {
    let mut sim = Sim::new_from_shipped_lot();
    assert_eq!(
        sim.try_save_snapshot_v27().as_ref().ok(),
        Some(&sim.save_snapshot_v27())
    );
    push(&mut sim, SimCommand::Select(None));
    assert!(sim.try_save_snapshot_v27().is_ok());
    push(&mut sim, satisfaction(12.0));
    assert_eq!(
        sim.try_save_snapshot_v27(),
        Err(save::SaveError::AdminCommandQueued)
    );
    sim.flush_commands();
    assert!(sim.try_save_snapshot_v27().is_ok());
}

/// [AP-cmd-wire] item 4: Build mode refuses an admin change as
/// `CommandNotAllowed` and its draft is unchanged.
#[test]
fn build_mode_refuses_an_admin_change() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.begin_build().unwrap();
    let before = save::v17::capture(&sim);
    push(&mut sim, satisfaction(12.0));
    sim.flush_commands();
    assert_eq!(
        sim.take_build_error(),
        Some(BuildCommitError::CommandNotAllowed)
    );
    assert_eq!(save::v17::capture(&sim), before);
    assert_eq!(crate::admin::last_result(sim.world()), None);
}

/// The core crate's bill kind count matches the bills it names.
#[test]
fn the_admin_bill_kinds_are_the_bill_kinds() {
    assert_eq!(
        terri_core::admin::ADMIN_BILL_KINDS,
        crate::bills::BILL_KINDS
    );
}

/// [AP-cmd-refusals]: the codes the shell words.
#[test]
fn the_refusal_codes_are_numbered_for_the_shell() {
    use AdminRefusal::*;
    let codes: Vec<u8> = [
        NoSession,
        NotAPerson,
        OutOfRange,
        UnknownContent,
        NotFound,
        AtWork,
        TooManyTraits,
        AlreadyWorn,
        NotWorn,
        NoValue,
        SamePerson,
        BillExists,
        BillPaid,
        BadDueDay,
        LateFeeTooEarly,
        LateFeeTooHigh,
        CannotAfford,
        Busy,
        WouldNotLoad,
    ]
    .into_iter()
    .map(AdminRefusal::code)
    .collect();
    assert_eq!(codes, (1..=18).chain([99]).collect::<Vec<u8>>());
}
