//! The admin panel's session, drain entry and Undo (issue 312, [AP-command]
//! and [AP-undo] in `docs/specs/2026-11-20-admin-panel.md`).
//!
//! An admin change applies only inside an admin session, a resource that
//! exists while the panel is open. The session holds a baseline snapshot
//! taken at open and a journal of every change applied since, each with the
//! world hash it left. Undo rebuilds the world from the baseline and replays
//! the journal minus its last change, checking every replayed change's hash
//! against the one recorded live: the Build transaction's mechanism, exact
//! by construction, with no hand-written inverse per edit.
//!
//! The outcome of each drained change is reported in [`AdminState`], which
//! is neither saved nor hashed, like `Careers.last_result`; it never touches
//! the career or lot edit results, so the Career tab and Edit Sims pending
//! loops cannot mistake an admin change for their own. Admin edits draw from
//! no random stream, except that settling an open shift on a job or shift
//! change can run a career review, which draws; Undo replays that draw
//! exactly, because restoring the baseline restores the stream's state. The
//! session and the journal are not saved either: a
//! save taken while the panel is open holds the edits applied so far and no
//! session.

use crate::social_episode::requests::runtime::Runtime;
use crate::{save, SaveError, Sim};
use bevy_ecs::prelude::*;
use terri_core::admin::{AdminChange, AdminEdit, AdminStructureError};
use terri_core::{CommandQueue, SaveSnapshotV34, SimCommand};

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
    /// The change itself is malformed: empty, longer than
    /// `MAX_ADMIN_EDITS`, or two edits touching one unit. The shell never
    /// sends one; [AP-cmd-admit] refuses it before it is staged.
    Malformed = 19,
    /// The post-condition failed: a bug report, never expected.
    WouldNotLoad = 99,
}

impl AdminRefusal {
    pub fn code(self) -> u8 {
        self as u8
    }

    /// The refusal an admission failure is reported as, with the index of
    /// the edit it names (0 when it names none).
    pub fn of_structure(error: AdminStructureError) -> (u32, Self) {
        match error {
            AdminStructureError::Empty | AdminStructureError::TooManyEdits => (0, Self::Malformed),
            AdminStructureError::Overlap { edit } => (edit, Self::Malformed),
            AdminStructureError::NotFinite { edit } | AdminStructureError::OutOfRange { edit } => {
                (edit, Self::OutOfRange)
            }
            AdminStructureError::UnknownCode { edit } => (edit, Self::UnknownContent),
        }
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

/// One applied change and the world hash it left, after the whole flush
/// that applied it.
#[derive(Debug, Clone)]
pub(crate) struct AdminEntry {
    pub(crate) change: AdminChange,
    pub(crate) hash_after: u64,
}

/// [AP-undo-model]: the open panel's baseline and journal. Not saved and
/// not hashed, like Build mode's transaction.
#[derive(Resource, Clone)]
pub(crate) struct AdminSession {
    baseline: SaveSnapshotV34,
    baseline_hash: u64,
    request_runtime: Runtime,
    pub(crate) journal: Vec<AdminEntry>,
    /// A change failed its post-condition and the last good world could not
    /// be rebuilt: the live world holds edits that would not load, so every
    /// later edit, Undo and save is refused.
    broken: bool,
}

/// Left behind when a broken session closes: the world still holds edits
/// that would not load, so no save is written and the panel does not open
/// again until a load replaces the world. Not saved and not hashed.
#[derive(Resource)]
struct AdminBroken;

/// Whether admin edits have left a world that would not load: a broken
/// session, open or closed. [`Sim::try_save_snapshot_v28`] refuses every
/// save then.
pub(crate) fn world_broken(world: &World) -> bool {
    world.contains_resource::<AdminBroken>()
        || world
            .get_resource::<AdminSession>()
            .is_some_and(|session| session.broken)
}

/// Why the panel could not open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminOpenError {
    /// Build mode is open.
    BuildActive,
    /// The world as it stands would not reload, so it cannot be a baseline.
    WouldNotReload(SaveError),
    /// The panel is already open.
    AlreadyOpen,
}

/// A refused change: the index of the edit and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdminApplyRefusal {
    pub edit: u32,
    pub reason: AdminRefusal,
}

/// Why Undo did nothing. In every case the live world and the journal are
/// exactly as they were.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminUndoError {
    /// The panel is not open.
    NotOpen,
    /// No change has applied since the panel opened.
    NothingToUndo,
    /// The baseline did not restore.
    Restore(SaveError),
    /// The rebuilt world did not match the hash recorded live: before any
    /// replay (`entry` of `None`), or after replaying journal entry
    /// `Some(index)`, which may also have been refused.
    Mismatch { entry: Option<usize> },
    /// The session is broken: a change failed its post-condition and the
    /// last good world could not be rebuilt.
    Broken,
}

fn report(world: &mut World, refusal: Option<(u32, AdminRefusal)>) {
    let mut state = world.get_resource_or_insert_with(AdminState::default);
    let sequence = state.last.map_or(0, |last| last.sequence.wrapping_add(1));
    state.last = Some(AdminResult { sequence, refusal });
}

/// [AP-cmd-drain]: apply one admin change at the drain. With no session the
/// change is refused as [`AdminRefusal::NoSession`]. Otherwise every edit is
/// validated against the world as it stands, the first refusal refuses the
/// whole change, and only then is every edit applied in order. The
/// post-condition decides whether the result could be saved and loaded;
/// a failure there is reported as [`AdminRefusal::WouldNotLoad`] and
/// [`Sim::admin_apply`] puts the last good world back.
pub(crate) fn drain(world: &mut World, change: &AdminChange) {
    if !world.contains_resource::<AdminSession>() {
        report(world, Some((0, AdminRefusal::NoSession)));
        return;
    }
    if let Err(error) = change.validate_structure() {
        report(world, Some(AdminRefusal::of_structure(error)));
        return;
    }
    for (index, edit) in change.edits.iter().enumerate() {
        if let Err(reason) = edits::validate(world, edit) {
            report(world, Some((index as u32, reason)));
            return;
        }
    }
    for edit in &change.edits {
        edits::apply(world, edit);
    }
    #[cfg(test)]
    if tests_stub::reports_nothing(change) {
        return;
    }
    if edits::post_condition(world, &change.edits).is_err() {
        report(world, Some((0, AdminRefusal::WouldNotLoad)));
        return;
    }
    report(world, None);
}

/// The outcome of the last drained admin change, if any has drained.
pub fn last_result(world: &World) -> Option<AdminResult> {
    world
        .get_resource::<AdminState>()
        .and_then(|state| state.last)
}

mod career;
mod edits;
mod household;
mod housemate;
pub mod reads;
mod relationships;

impl Sim {
    /// Whether admin edits have left a world that would not load: a change
    /// failed its post-condition and the last good world could not be
    /// rebuilt. Edits, Undo and saves are refused from then on, and the panel
    /// does not open again until a load replaces the world.
    pub fn admin_broken(&self) -> bool {
        world_broken(&self.world)
    }

    /// Whether the admin panel's session is open.
    pub fn admin_active(&self) -> bool {
        self.world.contains_resource::<AdminSession>()
    }

    /// [AP-undo-model] item 1: open the session. Refused while Build is
    /// open or the session already is. Staged input is applied first, then
    /// the world is captured as the baseline and test-restored exactly as
    /// Build mode's entry does, so a world that would not reload cannot
    /// open the panel.
    pub fn begin_admin(&mut self) -> Result<(), AdminOpenError> {
        if self.build_active() {
            return Err(AdminOpenError::BuildActive);
        }
        if self.admin_active() {
            return Err(AdminOpenError::AlreadyOpen);
        }
        if self.admin_broken() {
            return Err(AdminOpenError::WouldNotReload(
                SaveError::AdminSessionBroken,
            ));
        }
        if !self.world.resource::<CommandQueue>().is_empty() {
            self.flush_commands();
        }
        let baseline = save::v34::capture(self);
        let request_runtime = crate::social_episode::requests::runtime::capture(&self.world);
        self.restore_session_baseline(baseline.clone(), &request_runtime)
            .map_err(AdminOpenError::WouldNotReload)?;
        let baseline_hash = self.world_hash();
        self.world.insert_resource(AdminSession {
            baseline,
            baseline_hash,
            request_runtime,
            journal: Vec::new(),
            broken: false,
        });
        Ok(())
    }

    /// [AP-undo-model] item 2: close the session. Every applied change stays.
    /// A broken session leaves [`AdminBroken`] behind, so saves stay refused.
    pub fn end_admin(&mut self) {
        let session = self.world.remove_resource::<AdminSession>();
        if session.is_some_and(|session| session.broken) {
            self.world.insert_resource(AdminBroken);
        }
    }

    /// How many changes Undo can step back through.
    pub fn admin_undo_depth(&self) -> usize {
        self.world
            .get_resource::<AdminSession>()
            .map_or(0, |session| session.journal.len())
    }

    /// [AP-save-queue] item 1: admit `change`, stage it and drain it in the
    /// same call, so it can never wait in a queue for a save. Admission
    /// ([AP-cmd-admit]) needs an open session and a well-formed change; the
    /// drain then checks it against the world. An applied change is
    /// journaled with the world hash after the whole flush; one that failed
    /// its post-condition is taken back by rebuilding the last good world.
    /// Returns the journal's new depth.
    pub fn admin_apply(&mut self, change: AdminChange) -> Result<usize, AdminApplyRefusal> {
        let refuse = |(edit, reason): (u32, AdminRefusal)| AdminApplyRefusal { edit, reason };
        if !self.admin_active() {
            return Err(refuse((0, AdminRefusal::NoSession)));
        }
        if self.admin_broken() {
            return Err(refuse((0, AdminRefusal::WouldNotLoad)));
        }
        change
            .validate_structure()
            .map_err(|error| refuse(AdminRefusal::of_structure(error)))?;
        let journaled = change.clone();
        let previous = last_result(&self.world).map(|result| result.sequence);
        self.world
            .resource_mut::<CommandQueue>()
            .push(SimCommand::Admin(Box::new(change)));
        self.flush_commands();
        debug_assert!(
            self.world.resource::<CommandQueue>().is_empty(),
            "the flush drains the admin change it staged"
        );
        // Only a result whose sequence moved is this change's. With none,
        // the drain's outcome is unknown: it is a refusal that changed
        // nothing, made true by putting back the last good world.
        let refusal = match last_result(&self.world) {
            Some(result) if Some(result.sequence) != previous => result.refusal,
            _ => Some((0, AdminRefusal::WouldNotLoad)),
        };
        match refusal {
            None => {
                let hash_after = self.world_hash();
                let mut session = self.world.resource_mut::<AdminSession>();
                session.journal.push(AdminEntry {
                    change: journaled,
                    hash_after,
                });
                Ok(session.journal.len())
            }
            Some((edit, AdminRefusal::WouldNotLoad)) => {
                // The edits were written before the post-condition refused
                // them, or may have been when no result came back. Put back
                // the world the journal describes; if even
                // that fails the live world holds edits that would not load,
                // so the session is marked broken and refuses every later
                // edit, Undo and save.
                let depth = self.admin_undo_depth();
                if self.rebuild_admin_world(depth).is_err() {
                    self.world.resource_mut::<AdminSession>().broken = true;
                }
                Err(refuse((edit, AdminRefusal::WouldNotLoad)))
            }
            Some(refusal) => Err(refuse(refusal)),
        }
    }

    /// [AP-undo-restore]: step back one change. Refused when nothing has
    /// applied since the panel opened. On any failure the live world and the
    /// journal are untouched.
    pub fn admin_undo(&mut self) -> Result<(), AdminUndoError> {
        let session = self
            .world
            .get_resource::<AdminSession>()
            .ok_or(AdminUndoError::NotOpen)?;
        if session.broken {
            return Err(AdminUndoError::Broken);
        }
        let depth = session.journal.len();
        if depth == 0 {
            return Err(AdminUndoError::NothingToUndo);
        }
        self.rebuild_admin_world(depth - 1)
    }

    /// Rebuild the world from the baseline with the first `keep` journal
    /// entries replayed, each through the candidate's own stage-and-flush
    /// path so maintenance runs exactly as it ran live, and install it only
    /// when every hash matches the one recorded live.
    fn rebuild_admin_world(&mut self, keep: usize) -> Result<(), AdminUndoError> {
        let session = self
            .world
            .get_resource::<AdminSession>()
            .ok_or(AdminUndoError::NotOpen)?
            .clone();
        let mut candidate = self
            .restore_session_baseline(session.baseline.clone(), &session.request_runtime)
            .map_err(AdminUndoError::Restore)?;
        if candidate.world_hash() != session.baseline_hash {
            return Err(AdminUndoError::Mismatch { entry: None });
        }
        candidate.world.insert_resource(AdminSession {
            journal: Vec::new(),
            ..session.clone()
        });
        for (index, entry) in session.journal.iter().take(keep).enumerate() {
            let replayed = candidate.admin_apply(entry.change.clone());
            let matched = replayed.is_ok()
                && candidate
                    .world
                    .resource::<AdminSession>()
                    .journal
                    .last()
                    .is_some_and(|replayed| replayed.hash_after == entry.hash_after);
            if !matched {
                return Err(AdminUndoError::Mismatch { entry: Some(index) });
            }
        }
        // The replay reported its own outcomes; keep the live ones.
        match self.world.get_resource::<AdminState>().cloned() {
            Some(state) => candidate.world.insert_resource(state),
            None => {
                candidate.world.remove_resource::<AdminState>();
            }
        }
        self.install_session_world(candidate)
            .map_err(AdminUndoError::Restore)
    }
}

/// [T3]'s test hooks, the ones the real edits cannot offer: the baseline's
/// recorded hash can be made wrong, as a restore that was not exact would;
/// an `AdjustFunds` of exactly 13 cents fails the post-condition after it
/// applies, to prove the `WouldNotLoad` path; and one of exactly 17 cents
/// applies and reports nothing, to prove a stale result is never read.
#[cfg(test)]
pub(crate) mod tests_stub {
    use super::*;

    pub(crate) const FAILS_POST_CONDITION: i64 = 13;

    /// An `AdjustFunds` of exactly 17 cents applies at the drain and reports
    /// nothing, as a drain that lost its result would.
    pub(crate) const REPORTS_NOTHING: i64 = 17;

    pub(super) fn reports_nothing(change: &AdminChange) -> bool {
        change.edits.iter().any(|edit| {
            matches!(
                edit,
                AdminEdit::AdjustFunds {
                    cents: REPORTS_NOTHING
                }
            )
        })
    }

    /// Make the session's recorded baseline hash wrong, as a restore that
    /// was not exact would.
    pub(crate) fn corrupt_baseline_hash(world: &mut World) {
        world.resource_mut::<AdminSession>().baseline_hash ^= 1;
    }

    pub(super) fn post_condition(_: &World, edits: &[AdminEdit]) -> Result<(), ()> {
        if edits.iter().any(|edit| {
            matches!(
                edit,
                AdminEdit::AdjustFunds {
                    cents: FAILS_POST_CONDITION
                }
            )
        }) {
            Err(())
        } else {
            Ok(())
        }
    }
}
