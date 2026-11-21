//! The admin panel's drain entry (issue 312, [AP-cmd-drain] in
//! `docs/specs/2026-11-20-admin-panel.md`).
//!
//! An admin change applies only inside an admin session. Its outcome is
//! reported in [`AdminState`], which is neither saved nor hashed, like
//! `Careers.last_result`; it never touches the career or lot edit results,
//! so the Career tab and Edit Sims pending loops cannot mistake an admin
//! change for their own. Admin edits draw from no random stream.

use bevy_ecs::prelude::*;
use terri_core::admin::AdminChange;

/// Why the drain refused a change ([AP-cmd-refusals]). The discriminant is
/// the code the shell words.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AdminRefusal {
    /// The panel is not open.
    NoSession = 1,
    /// The named sim is not a living member of the household.
    NotAPerson = 2,
    /// A value outside its content range.
    OutOfRange = 3,
    /// An unknown object row, affinity kind, skill, trait, career row or
    /// shift.
    UnknownContent = 4,
    /// No such repetition entry, running timer or bill.
    NotFound = 5,
    /// A job or shift change while at work or commuting.
    AtWork = 6,
    /// Adding a trait past `housemate_max_traits`.
    TooManyTraits = 7,
    /// Adding a trait already worn.
    AlreadyWorn = 8,
    /// Changing or removing a trait not worn.
    NotWorn = 9,
    /// Setting a disposition's state.
    NoValue = 10,
    /// A feeling or fight toward oneself.
    SamePerson = 11,
    /// Adding or moving a bill onto a due day and kind already used.
    BillExists = 12,
    /// Editing, moving or paying a paid bill.
    BillPaid = 13,
    /// A due day that is not a billing month start, or is after today.
    BadDueDay = 14,
    /// A nonzero late fee before the bill's grace days end.
    LateFeeTooEarly = 15,
    /// A late fee above the bill's cap.
    LateFeeTooHigh = 16,
    /// Pay from funds with funds below the bill and its fee.
    CannotAfford = 17,
    /// A fight while either person is at work or commuting.
    Busy = 18,
    /// The post-condition failed: a bug report, never expected.
    WouldNotLoad = 99,
}

impl AdminRefusal {
    pub fn code(self) -> u8 {
        self as u8
    }
}

/// The outcome of one drained admin change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdminResult {
    /// Counts every drained admin change, so the shell can tell this
    /// outcome from the previous one.
    pub sequence: u64,
    /// The index of the refused edit and why, or `None` when the change
    /// applied.
    pub refusal: Option<(u32, AdminRefusal)>,
}

/// Reporting only: not saved and not hashed.
#[derive(Resource, Debug, Default, Clone)]
pub struct AdminState {
    pub last: Option<AdminResult>,
}

fn report(world: &mut World, refusal: Option<(u32, AdminRefusal)>) {
    let mut state = world.get_resource_or_insert_with(AdminState::default);
    let sequence = state.last.map_or(0, |last| last.sequence.wrapping_add(1));
    state.last = Some(AdminResult { sequence, refusal });
}

/// [AP-cmd-drain]: apply one admin change at the drain. Until the session
/// exists every change is refused with [`AdminRefusal::NoSession`].
pub(crate) fn drain(world: &mut World, change: &AdminChange) {
    let _ = change;
    report(world, Some((0, AdminRefusal::NoSession)));
}

/// The outcome of the last drained admin change, if any has drained.
pub fn last_result(world: &World) -> Option<AdminResult> {
    world
        .get_resource::<AdminState>()
        .and_then(|state| state.last)
}
