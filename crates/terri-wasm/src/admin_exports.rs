//! The admin panel across the boundary (issue 312, [AP-wasm] in
//! `docs/specs/2026-11-20-admin-panel.md`).
//!
//! The panel's one write is [`SimHandle::admin_apply`], which stages a change
//! and drains it in the same call, so JavaScript can never run a save between
//! the two ([AP-save-queue]); the ordinary `enqueue_command` refuses admin
//! bytes. Every read names a person by `SimId` and copies its answer, so the
//! shell holds nothing across a later call ([L72]). The layouts are
//! documented on `terri_sim::admin::reads`, which builds them.
use super::*;
use terri_sim::admin::{reads, AdminOpenError, AdminRefusal, AdminUndoError};

/// The refusal reported for bytes that are not exactly one admin change: the
/// shell never sends them, and the code is the one an empty, oversized or
/// overlapping change gets.
const NOT_AN_ADMIN_CHANGE: u32 = AdminRefusal::Malformed as u32;

#[wasm_bindgen]
impl SimHandle {
    /// Opens the panel's session: 0 opened, 1 Build is open, 2 the world
    /// would not reload so it cannot be a baseline, 3 already open.
    pub fn admin_begin(&mut self) -> u32 {
        match self.sim.begin_admin() {
            Ok(()) => 0,
            Err(AdminOpenError::BuildActive) => 1,
            Err(AdminOpenError::WouldNotReload(_)) => 2,
            Err(AdminOpenError::AlreadyOpen) => 3,
        }
    }

    /// Closes the session. Every change applied stays in the world.
    pub fn admin_end(&mut self) {
        self.sim.end_admin();
    }

    /// Applies one change, as `[applied (1 or 0), index of the refused edit,
    /// refusal code (0 when applied), undo depth after]`. `bytes` is the
    /// postcard of `SimCommand::Admin` (wire code 41). Bytes that are
    /// anything else, or have trailing data, are refused as code 19 with
    /// nothing staged. The queue is empty when this returns.
    pub fn admin_apply(&mut self, bytes: &[u8]) -> Vec<u32> {
        let change = match postcard::take_from_bytes::<SimCommand>(bytes) {
            Ok((SimCommand::Admin(change), [])) => change,
            _ => {
                return vec![
                    0,
                    0,
                    NOT_AN_ADMIN_CHANGE,
                    self.sim.admin_undo_depth() as u32,
                ]
            }
        };
        match self.sim.admin_apply(*change) {
            Ok(depth) => vec![1, 0, 0, depth as u32],
            Err(refusal) => vec![
                0,
                refusal.edit,
                u32::from(refusal.reason.code()),
                self.sim.admin_undo_depth() as u32,
            ],
        }
    }

    /// Steps back one change: 0 undone, 1 nothing to undo (or the panel is
    /// closed), 2 failed, with the world and the journal left as they were.
    pub fn admin_undo(&mut self) -> u32 {
        match self.sim.admin_undo() {
            Ok(()) => 0,
            Err(AdminUndoError::NotOpen | AdminUndoError::NothingToUndo) => 1,
            Err(AdminUndoError::Restore(_) | AdminUndoError::Mismatch { .. }) => 2,
        }
    }

    /// How many changes Undo can step back through; 0 while closed.
    pub fn admin_undo_depth(&self) -> u32 {
        self.sim.admin_undo_depth() as u32
    }

    /// `[needs x7, satisfaction, career row or -1, shift, pay, job
    /// satisfaction, good weeks, poor weeks, job search on, advance_weeks,
    /// pay minimum, pay maximum]`; empty for anyone but a living housemate.
    pub fn admin_person(&self, sim: u32) -> Vec<f64> {
        reads::person(self.sim.world(), sim)
    }

    /// `[object, row, value, food]` per repetition entry; empty for none.
    pub fn admin_repetition(&self, sim: u32) -> Vec<f64> {
        reads::repetition(self.sim.world(), sim)
    }

    /// `[kind, arg, score, ends tick or -1]` per moodlet, in the order of
    /// `mood_summary_of` after its overall label. See
    /// `terri_sim::admin::reads::moodlets` for the kinds.
    pub fn admin_moodlets(&self, sim: u32) -> Vec<f64> {
        reads::moodlets(self.sim.world(), sim)
    }

    /// `[timer code, ends tick]` per running timed moodlet.
    pub fn admin_timers(&self, sim: u32) -> Vec<f64> {
        reads::timers(self.sim.world(), sim)
    }

    /// `[bill count n, n rows of [due day, kind, amount cents, late fee
    /// cents, paid day or -1, fee cap cents, overdue from day], then the due
    /// days a bill can take, newest first]`.
    pub fn admin_bills(&self) -> Vec<f64> {
        reads::bills(self.sim.world())
    }

    /// One affinity value per kind in pack order, -1 to 1; empty for anyone
    /// but a living housemate.
    pub fn admin_affinities(&self, sim: u32) -> Vec<f64> {
        reads::affinities(self.sim.world(), sim)
    }

    /// Per pack trait, the skill index a capability trains or -1.
    pub fn admin_trait_skills(&self) -> Vec<f64> {
        reads::trait_skills(self.sim.world())
    }

    /// `[path, level, career row]` per career level, in path then level order.
    pub fn admin_job_options(&self) -> Vec<f64> {
        reads::job_options(self.sim.world())
    }

    /// `[habituation_max, overdoing_threshold, sick_threshold,
    /// housemate_max_traits, most poor weeks]`; see `reads::limits`.
    pub fn admin_limits(&self) -> Vec<f64> {
        reads::limits(self.sim.world())
    }

    /// The practice that reads back as `level` whole levels and `fraction`
    /// of the next in skill `skill`, or -1 for an unknown skill, a level past
    /// the skill's top or a fraction outside `[0, 1)`.
    pub fn skill_practice_for(&self, skill: u32, level: u32, fraction: f32) -> f32 {
        reads::skill_practice_for(self.sim.world(), skill, level, fraction).unwrap_or(-1.0)
    }
}
