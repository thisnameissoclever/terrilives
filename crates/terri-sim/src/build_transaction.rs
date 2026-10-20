//! Native ownership of the committed household and transient construction draft.
use crate::{
    chores::{DutyChangeReport, RoomChangeContext},
    rooms::*,
    save, Content, SaveError, Sim,
};
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use terri_core::{
    layout::WallLine,
    rooms::{validate_room_name, RoomId, RoomSelection, SavedRooms},
    SaveSnapshotV20,
};

#[cfg(test)]
mod cases;
mod commands;
mod ordinary;
#[cfg(test)]
mod ordinary_tests;
mod review;
pub(crate) use commands::drain;
pub use commands::{BuildJournalEntry, BuildReceipt};
pub(crate) use ordinary::{
    construction as native_construction, has_ordinary as native_has_ordinary,
};
pub(crate) use ordinary::{
    dispatch as dispatch_native, has_error, is_batch as native_batch, maintain_batch,
    needs_atomic_drain, record_error, run_atomic_drain, SkipCommandDrain,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BuildToken {
    pub session: u64,
    pub revision: u64,
    pub preparation: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BuildCommitError {
    NotActive,
    AlreadyActive,
    AllocationFailed,
    CounterExhausted,
    InvalidRoom,
    InvalidName,
    Room(RoomError),
    ReplayMismatch { entry: usize },
    DraftMismatch,
    Validation(SaveError),
    StaleToken,
    CommandNotAllowed,
}
/// Which load rule refused the draft when Build could not open or confirm.
/// `BuildCommitError::Validation` names only the kind of error; this names the
/// rule, so the player and the console can be told what is in the way.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValidationProblem {
    /// A windowed house is held to the usability proofs a lot edit passes.
    LotUsability(crate::placement::PlacementRefusal),
    /// A housemate, their walk, or their contact with what they use, against the walls.
    EdgeWorld,
    /// The front door, its landing, or a worker's way home from the street.
    PortalReturn,
    Seating,
    Reading,
}

/// The rules a draft that will not load is checked against, first failure wins.
/// `None` when the refusal lies outside these rules.
pub(crate) fn diagnose(world: &World) -> Option<ValidationProblem> {
    let grid = world.resource::<terri_core::TileGrid>();
    // `candidate_grid_loads` reports a book problem as a walls problem; it is
    // not one, and none of these rules names it.
    if save::v6::validate_live_books(world).is_err() {
        return None;
    }
    if crate::seating::validate(world, grid).is_err() {
        return Some(ValidationProblem::Seating);
    }
    if crate::reading::persistence::validate(world, grid).is_err() {
        return Some(ValidationProblem::Reading);
    }
    match save::candidate_grid_loads(world, grid) {
        Err(save::LoadProblem::PortalReturn) => return Some(ValidationProblem::PortalReturn),
        Err(save::LoadProblem::EdgeWorld) => return Some(ValidationProblem::EdgeWorld),
        Ok(()) => {}
    }
    let windowed = matches!(
        world.get_resource::<terri_core::layout::SavedLayout>(),
        Some(terri_core::layout::SavedLayout::EdgeWallsV3 { .. })
    );
    if windowed {
        if let Err(refusal) = crate::placement::windows::validate_restored_windows(world) {
            return Some(ValidationProblem::LotUsability(refusal));
        }
    }
    None
}

#[derive(Resource, Default)]
struct BuildDiagnosis(Option<ValidationProblem>);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuildRoomReview {
    pub selection: RoomSelection,
    pub anchor: Option<(u32, u32)>,
    pub name: String,
    pub previous_name: Option<String>,
    pub previous_area: u32,
    pub area: u32,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuildGroupReview {
    pub change: RoomChangeGroup,
    /// Final-coordinate former footprint, including rooms that are now Outside.
    pub former_tiles: Vec<(u32, u32)>,
    /// Actual removed boundary segments touching this group's former rooms.
    pub openings: Vec<WallLine>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuildReview {
    pub token: BuildToken,
    pub groups: Vec<BuildGroupReview>,
    pub rooms: Vec<BuildRoomReview>,
    pub retired_names: Vec<(RoomId, String)>,
    pub duties: DutyChangeReport,
}
#[derive(Resource, Default)]
pub(crate) struct BuildEpoch(u64);
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
fn new_session() -> Result<u64, BuildCommitError> {
    NEXT_SESSION
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
            value.checked_add(1)
        })
        .map_err(|_| BuildCommitError::CounterExhausted)
}
/// Private replay mode cannot be selected by a saved payload.
#[derive(Resource)]
pub(crate) struct Replaying;
struct Prepared {
    review: BuildReview,
    candidate: Box<Sim>,
    draft: SaveSnapshotV20,
    overlaps: Vec<RoomOverlap>,
}
#[derive(Resource)]
pub struct BuildTransaction {
    baseline: SaveSnapshotV20,
    request_runtime: crate::social_episode::requests::runtime::Runtime,
    journal: Vec<BuildJournalEntry>,
    names: BTreeMap<RoomSelection, String>,
    session: u64,
    revision: u64,
    preparation: u64,
    prepared: Option<Prepared>,
    last_error: Option<BuildCommitError>,
}
impl BuildTransaction {
    pub(crate) fn new(
        baseline: SaveSnapshotV20,
        request_runtime: crate::social_episode::requests::runtime::Runtime,
        session: u64,
    ) -> Self {
        Self {
            baseline,
            request_runtime,
            session,
            journal: vec![],
            names: BTreeMap::new(),
            revision: 0,
            preparation: 0,
            prepared: None,
            last_error: None,
        }
    }
    fn invalidate(&mut self) -> Result<(), BuildCommitError> {
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(BuildCommitError::CounterExhausted)?;
        self.prepared = None;
        Ok(())
    }
}
impl From<RoomError> for BuildCommitError {
    fn from(e: RoomError) -> Self {
        Self::Room(e)
    }
}
impl From<SaveError> for BuildCommitError {
    fn from(e: SaveError) -> Self {
        Self::Validation(e)
    }
}
pub(crate) fn deferred(world: &World) -> bool {
    world.contains_resource::<BuildTransaction>()
        || world.contains_resource::<Replaying>()
        || ordinary::is_batch(world)
}
pub(crate) fn next_epoch(world: &World) -> Result<u64, SaveError> {
    world
        .get_resource::<BuildEpoch>()
        .map_or(0, |epoch| epoch.0)
        .checked_add(1)
        .ok_or(SaveError::InvalidValue)
}
pub(crate) fn advance_view(world: &mut World) -> Result<(), SaveError> {
    let next = next_epoch(world)?;
    world.insert_resource(BuildEpoch(next));
    Ok(())
}
pub(crate) fn carry_adoption(old: &World, restored: &mut Sim) -> Result<(), SaveError> {
    let epoch = next_epoch(old)?;
    if old.contains_resource::<BuildTransaction>() {
        // Loaded input belongs to the loaded household. Settle it privately by
        // the same entry boundary before making a new transaction baseline.
        restored.begin_build().map_err(|error| match error {
            BuildCommitError::Validation(error) => error,
            _ => SaveError::InvalidValue,
        })?;
    }
    restored.world.insert_resource(BuildEpoch(epoch));
    Ok(())
}
pub(crate) fn committed(world: &World) -> Option<&SaveSnapshotV20> {
    world
        .get_resource::<BuildTransaction>()
        .map(|b| &b.baseline)
}
impl Sim {
    pub fn build_active(&self) -> bool {
        self.world.contains_resource::<BuildTransaction>()
    }
    /// Read authored differences without settling input or preparing a review.
    pub fn build_dirty(&self) -> bool {
        let Some(build) = self.world.get_resource::<BuildTransaction>() else {
            return false;
        };
        self.world
            .resource::<terri_core::CommandQueue>()
            .as_slice()
            .iter()
            .any(ordinary::construction)
            || build.names.iter().any(|(selection, name)| match selection {
                RoomSelection::Outside => {
                    *name
                        != build
                            .baseline
                            .legacy
                            .legacy
                            .legacy
                            .legacy
                            .rooms
                            .outside_name
                }
                RoomSelection::Room(id) => build
                    .baseline
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .rooms
                    .record(*id)
                    .is_some_and(|room| room.name != *name),
            })
            || !same_authored(&build.baseline, &save::v20::capture(self))
    }
    /// Exact cache identity across edits, names, sessions and successful loads.
    pub fn rooms_revision(&self) -> u64 {
        self.world
            .get_resource::<BuildEpoch>()
            .map_or(0, |epoch| epoch.0)
    }
    pub fn build_revision(&self) -> Option<u64> {
        self.world
            .get_resource::<BuildTransaction>()
            .map(|b| b.revision)
    }
    pub fn take_build_error(&mut self) -> Option<BuildCommitError> {
        // A diagnosis belongs to the entry or preparation that failed, never to
        // a later command error.
        self.world.remove_resource::<BuildDiagnosis>();
        let active = self
            .world
            .get_resource_mut::<BuildTransaction>()
            .and_then(|mut b| b.last_error.take());
        active.or_else(|| {
            self.world
                .get_resource_mut::<ordinary::NativeFeedback>()
                .and_then(|mut f| f.error.take())
        })
    }
    /// The rule that refused the latest Build entry or preparation, if it was one
    /// of the rules [`diagnose`] reads. Cleared when either is tried again, when
    /// a build error is taken, and when Build commits, cancels or ends.
    pub fn build_diagnosis(&self) -> Option<ValidationProblem> {
        self.world
            .get_resource::<BuildDiagnosis>()
            .and_then(|d| d.0)
    }
    pub fn begin_build(&mut self) -> Result<(), BuildCommitError> {
        self.world.remove_resource::<BuildDiagnosis>();
        if self.build_active() {
            return Err(BuildCommitError::AlreadyActive);
        }
        if !self.world.resource::<terri_core::CommandQueue>().is_empty() {
            self.flush_commands();
            if let Some(error) = self.take_build_error() {
                return Err(error);
            }
        }
        let baseline = save::v20::capture(self);
        if let Err(error) = save::v20::restore(
            baseline.clone(),
            self.world.resource::<Content>().0,
            save::Carried::for_load(&self.world),
        ) {
            let problem = diagnose(&self.world);
            self.world.insert_resource(BuildDiagnosis(problem));
            return Err(error.into());
        }
        let epoch = next_epoch(&self.world).map_err(|_| BuildCommitError::CounterExhausted)?;
        let session = new_session()?;
        self.world.insert_resource(BuildEpoch(epoch));
        self.world.remove_resource::<ordinary::NativeFeedback>();
        let request_runtime = crate::social_episode::requests::runtime::capture(&self.world);
        self.world
            .insert_resource(BuildTransaction::new(baseline, request_runtime, session));
        Ok(())
    }
    pub fn stage_room_name(
        &mut self,
        selection: RoomSelection,
        name: String,
    ) -> Result<(), BuildCommitError> {
        let name = validate_room_name(&name).map_err(|_| BuildCommitError::InvalidName)?;
        let next = next_epoch(&self.world).map_err(|_| BuildCommitError::CounterExhausted)?;
        let mut b = self
            .world
            .get_resource_mut::<BuildTransaction>()
            .ok_or(BuildCommitError::NotActive)?;
        if let RoomSelection::Room(id) = selection {
            if b.baseline
                .legacy
                .legacy
                .legacy
                .legacy
                .rooms
                .record(id)
                .is_none_or(|r| r.anchor.is_none())
            {
                return Err(BuildCommitError::InvalidRoom);
            }
        }
        if b.names.get(&selection) == Some(&name) {
            return Ok(());
        }
        b.invalidate()?;
        b.names.insert(selection, name);
        self.world.insert_resource(BuildEpoch(next));
        Ok(())
    }
    /// Selection uses translated confirmed membership, never provisional identities.
    pub fn build_rooms(&self) -> Result<Vec<BuildRoomReview>, BuildCommitError> {
        let b = self
            .world
            .get_resource::<BuildTransaction>()
            .ok_or(BuildCommitError::NotActive)?;
        let map = self.world.resource::<RoomMap>();
        let mut rows = review::rooms(
            map,
            self.world.resource::<SavedRooms>(),
            map,
            &b.baseline.legacy.legacy.legacy.legacy.rooms,
        );
        for row in &mut rows {
            if let Some(name) = b.names.get(&row.selection) {
                row.name = name.clone();
            }
        }
        Ok(rows)
    }
    pub fn prepare_build_commit(
        &mut self,
        choices: RoomChoices,
    ) -> Result<BuildReview, BuildCommitError> {
        self.prepare_build_commit_projected(choices, |review| Ok(review.clone()))
    }

    /// Project a validated review before replacing the current preparation.
    /// Like ordinary preparation, this may settle newly queued input at entry.
    pub fn prepare_build_commit_projected<T>(
        &mut self,
        choices: RoomChoices,
        project: impl FnOnce(&BuildReview) -> Result<T, BuildCommitError>,
    ) -> Result<T, BuildCommitError> {
        self.prepare_build_commit_projected_validated(
            choices,
            |candidate| {
                save::v20::restore(
                    save::v20::capture(candidate),
                    candidate.world.resource::<Content>().0,
                    save::Carried::for_load(&candidate.world),
                )
                .map(|_| ())
            },
            project,
        )
    }

    /// Keep preparation atomic even when its final external-format validator refuses.
    #[cfg(test)]
    fn prepare_build_commit_validated(
        &mut self,
        choices: RoomChoices,
        validate: impl FnOnce(&Sim) -> Result<(), SaveError>,
    ) -> Result<BuildReview, BuildCommitError> {
        self.prepare_build_commit_projected_validated(
            choices,
            validate,
            |review| Ok(review.clone()),
        )
    }

    fn prepare_build_commit_projected_validated<T>(
        &mut self,
        choices: RoomChoices,
        validate: impl FnOnce(&Sim) -> Result<(), SaveError>,
        project: impl FnOnce(&BuildReview) -> Result<T, BuildCommitError>,
    ) -> Result<T, BuildCommitError> {
        self.world.remove_resource::<BuildDiagnosis>();
        if !self.build_active() {
            return Err(BuildCommitError::NotActive);
        }
        self.flush_commands();
        let b = self.world.resource::<BuildTransaction>();
        if let Some(
            error @ (BuildCommitError::CounterExhausted | BuildCommitError::AllocationFailed),
        ) = &b.last_error
        {
            return Err(error.clone());
        }
        let preparation = b
            .preparation
            .checked_add(1)
            .ok_or(BuildCommitError::CounterExhausted)?;
        let token = BuildToken {
            session: b.session,
            revision: b.revision,
            preparation,
        };
        let mut candidate = save::v20::restore(
            b.baseline.clone(),
            self.world.resource::<Content>().0,
            save::Carried::for_load(&self.world),
        )?;
        ordinary::runtime::copy_feedback(&self.world, &mut candidate.world);
        let context = RoomChangeContext::capture(&candidate.world)?;
        let old_layout = candidate
            .world
            .resource::<terri_core::layout::SavedLayout>()
            .clone();
        let origin = crate::lot_frame::origin(&candidate.world);
        candidate.world.insert_resource(Replaying);
        for (index, entry) in b.journal.iter().enumerate() {
            if commands::apply(&mut candidate.world, &entry.command).as_ref()
                != Some(&entry.expected)
            {
                return Err(BuildCommitError::ReplayMismatch { entry: index });
            }
            if entry.settle_inventory {
                crate::books::shelve_arrivals(&mut candidate.world);
            }
        }
        candidate.world.remove_resource::<Replaying>();
        let draft = save::v20::capture(self);
        if save::v20::capture(&candidate) != draft {
            return Err(BuildCommitError::DraftMismatch);
        }
        let no_net_change = same_authored(&b.baseline, &draft);
        if no_net_change {
            candidate = save::v20::restore(
                b.baseline.clone(),
                self.world.resource::<Content>().0,
                save::Carried::for_load(&self.world),
            )?;
            ordinary::runtime::copy_feedback(&self.world, &mut candidate.world);
        }
        let now = crate::lot_frame::origin(&candidate.world);
        let offset = (
            now.0 as i32 - origin.0 as i32,
            now.1 as i32 - origin.1 as i32,
        );
        let topology = RoomTopology::from_world(&candidate.world)?;
        let proposal = match_rooms(&context.map, &topology, offset);
        let mut saved = b.baseline.legacy.legacy.legacy.legacy.rooms.clone();
        for (selection, name) in &b.names {
            match selection {
                RoomSelection::Outside => saved.outside_name = name.clone(),
                RoomSelection::Room(id) => {
                    if let Some(r) = saved.records.iter_mut().find(|r| r.id == *id) {
                        r.name = name.clone();
                    }
                }
            }
        }
        let resolved = resolve_rooms(&proposal, &choices, &saved)?;
        let groups = review::groups(
            &proposal,
            &context.map,
            offset,
            &old_layout,
            candidate
                .world
                .resource::<terri_core::layout::SavedLayout>(),
        );
        let rooms = review::rooms(
            &resolved.map,
            &resolved.saved,
            &context.map,
            &b.baseline.legacy.legacy.legacy.legacy.rooms,
        );
        let retired_names = resolved
            .retired_ids
            .iter()
            .filter_map(|id| saved.record(*id).map(|r| (*id, r.name.clone())))
            .collect();
        let duties = if no_net_change && resolved.map == context.map {
            crate::rooms::install(&mut candidate.world, resolved.saved.clone())?;
            unchanged_duties(&candidate.world)
        } else {
            crate::chores::reconcile_committed_rooms(&mut candidate, &context, &resolved)?
        };
        if !no_net_change {
            final_maintenance(&mut candidate.world);
        }
        ordinary::runtime::refresh_derived(&mut candidate.world);
        if let Err(error) = validate(&candidate) {
            let problem = diagnose(&candidate.world);
            self.world.insert_resource(BuildDiagnosis(problem));
            return Err(error.into());
        }
        let review = BuildReview {
            token,
            groups,
            rooms,
            retired_names,
            duties,
        };
        let projected = project(&review)?;
        let mut b = self.world.resource_mut::<BuildTransaction>();
        b.preparation = preparation;
        b.prepared = Some(Prepared {
            review,
            candidate: Box::new(candidate),
            draft,
            overlaps: proposal.overlaps,
        });
        Ok(projected)
    }
    fn prepared_build(&self, token: BuildToken) -> Result<&Prepared, BuildCommitError> {
        let b = self
            .world
            .get_resource::<BuildTransaction>()
            .ok_or(BuildCommitError::NotActive)?;
        let prepared = b
            .prepared
            .as_ref()
            .filter(|p| {
                p.review.token == token
                    && token.session == b.session
                    && token.revision == b.revision
            })
            .ok_or(BuildCommitError::StaleToken)?;
        if save::v20::capture(self) != prepared.draft {
            return Err(BuildCommitError::DraftMismatch);
        }
        Ok(prepared)
    }
    pub fn validate_build_token(&self, token: BuildToken) -> Result<(), BuildCommitError> {
        self.prepared_build(token).map(|_| ())
    }
    /// Structural predecessor choices from the exact prepared overlap proposal.
    pub fn build_component_predecessors(
        &self,
        token: BuildToken,
        anchor: (u32, u32),
    ) -> Result<Vec<RoomId>, BuildCommitError> {
        let prepared = self.prepared_build(token)?;
        if !prepared
            .candidate
            .world
            .resource::<RoomMap>()
            .topology
            .components
            .iter()
            .any(|c| c.anchor == anchor)
        {
            return Err(BuildCommitError::InvalidRoom);
        }
        let count = prepared
            .overlaps
            .iter()
            .filter(|row| row.final_anchor == anchor)
            .count();
        let mut ids = Vec::new();
        ids.try_reserve_exact(count)
            .map_err(|_| BuildCommitError::AllocationFailed)?;
        ids.extend(
            prepared
                .overlaps
                .iter()
                .filter(|row| row.final_anchor == anchor)
                .map(|row| row.old_id),
        );
        Ok(ids)
    }
    pub fn build_component_tiles(
        &self,
        token: BuildToken,
        anchor: (u32, u32),
    ) -> Result<Vec<(u32, u32)>, BuildCommitError> {
        let map = self
            .prepared_build(token)?
            .candidate
            .world
            .resource::<RoomMap>();
        let component = map
            .topology
            .components
            .iter()
            .find(|c| c.anchor == anchor)
            .ok_or(BuildCommitError::InvalidRoom)?;
        Ok(component
            .cells
            .iter()
            .map(|c| (c % map.topology.width, c / map.topology.width))
            .collect())
    }
    pub fn commit_build(&mut self, token: BuildToken) -> Result<(), BuildCommitError> {
        self.world.remove_resource::<BuildDiagnosis>();
        if !self.build_active() {
            return Err(BuildCommitError::NotActive);
        }
        self.prepared_build(token)?;
        next_epoch(&self.world).map_err(|_| BuildCommitError::CounterExhausted)?;
        let session = new_session()?;
        let mut b = self.world.remove_resource::<BuildTransaction>().unwrap();
        let prepared = b.prepared.take().unwrap();
        let baseline = save::v20::capture(&prepared.candidate);
        let request_runtime =
            crate::social_episode::requests::runtime::capture(&prepared.candidate.world);
        match ordinary::runtime::install(self, *prepared.candidate) {
            Ok(()) => {
                self.world.insert_resource(BuildTransaction::new(
                    baseline,
                    request_runtime,
                    session,
                ));
                self.sync_render_buffer_after_commands();
                Ok(())
            }
            Err(e) => {
                self.world.insert_resource(b);
                Err(e.into())
            }
        }
    }
    pub fn discard_build_review(&mut self) -> Result<(), BuildCommitError> {
        let mut b = self
            .world
            .get_resource_mut::<BuildTransaction>()
            .ok_or(BuildCommitError::NotActive)?;
        b.preparation = b
            .preparation
            .checked_add(1)
            .ok_or(BuildCommitError::CounterExhausted)?;
        b.prepared = None;
        Ok(())
    }
    fn restore_build(&mut self, end: bool) -> Result<(), BuildCommitError> {
        self.world.remove_resource::<BuildDiagnosis>();
        let baseline = self
            .world
            .get_resource::<BuildTransaction>()
            .ok_or(BuildCommitError::NotActive)?
            .baseline
            .clone();
        let request_runtime = self
            .world
            .resource::<BuildTransaction>()
            .request_runtime
            .clone();
        let mut restored = save::v20::restore(
            baseline,
            self.world.resource::<Content>().0,
            save::Carried::for_load(&self.world),
        )?;
        ordinary::runtime::copy_feedback(&self.world, &mut restored.world);
        crate::social_episode::requests::runtime::restore(&request_runtime, &mut restored.world);
        ordinary::runtime::refresh_derived(&mut restored.world);
        ordinary::runtime::install(self, restored)?;
        if end {
            self.world.remove_resource::<BuildTransaction>();
        }
        self.sync_render_buffer_after_commands();
        Ok(())
    }
    pub fn cancel_build(&mut self) -> Result<(), BuildCommitError> {
        self.restore_build(false)
    }
    pub fn end_build(&mut self) -> Result<(), BuildCommitError> {
        self.restore_build(true)
    }
    pub(crate) fn committed_projection(&self) -> Option<Sim> {
        committed(&self.world).map(|snapshot| {
            save::v20::restore(
                snapshot.clone(),
                self.world.resource::<Content>().0,
                save::Carried::for_load(&self.world),
            )
            .expect("transaction baseline passed current validation")
        })
    }
}
pub(crate) fn final_maintenance(world: &mut World) {
    crate::reading::reconcile(world);
    crate::targeted_cleanup::prune(world);
    crate::seating::maintain(world);
    crate::privacy::maintain(world);
    crate::media::maintain(world);
    crate::social_episode::maintain(world);
    crate::neglect::refresh(world);
    crate::chore_repair::reconcile(world);
    crate::social_conflicts::tick(world);
}
fn unchanged_duties(world: &World) -> DutyChangeReport {
    let assignments = world
        .get_resource::<terri_core::chores::SavedChores>()
        .map(|s| s.assignments.as_slice())
        .unwrap_or(&[]);
    DutyChangeReport {
        duties: crate::chores::keys(world)
            .into_iter()
            .map(|key| crate::chores::DutyChange {
                key,
                previous: Some(key),
                owner: assignments.iter().find(|a| a.key == key).map(|a| a.owner),
                kind: crate::chores::DutyChangeKind::Unchanged,
            })
            .collect(),
        ..Default::default()
    }
}
/// Ignore wire representation and transient activity planning when architecture
/// and every authored purchase, identity, placement and material are unchanged.
fn same_authored(a: &SaveSnapshotV20, b: &SaveSnapshotV20) -> bool {
    let a = &a.legacy.legacy.legacy.legacy;
    let b = &b.legacy.legacy.legacy.legacy;
    let av = &a.legacy.legacy.legacy.legacy.legacy.legacy.legacy.legacy;
    let bv = &b.legacy.legacy.legacy.legacy.legacy.legacy.legacy.legacy;
    let edges = |layout: &terri_core::layout::SavedLayout| {
        let mut rows = layout.edges().to_vec();
        rows.sort_by_key(|e| (e.axis as u8, e.x, e.y, e.doorway));
        rows
    };
    let windows = |layout: &terri_core::layout::SavedLayout| {
        let mut rows = layout.window_placements();
        rows.sort_by_key(|w| (w.line.axis as u8, w.line.x, w.line.y));
        rows
    };
    let architecture = if av.layout.has_edges() && bv.layout.has_edges() {
        edges(&av.layout) == edges(&bv.layout) && windows(&av.layout) == windows(&bv.layout)
    } else {
        av.layout == bv.layout
    };
    let objects = |v: &terri_core::SaveSnapshotV5| {
        v.world
            .entities
            .iter()
            .filter(|e| e.smart_object.is_some())
            .map(|e| (e.index, e.smart_object.clone(), e.position))
            .collect::<Vec<_>>()
    };
    let ab = &a.legacy.legacy.legacy.legacy.legacy.legacy.legacy.books;
    let bb = &b.legacy.legacy.legacy.legacy.legacy.legacy.legacy.books;
    architecture
        && a.legacy.legacy.legacy.lot_frame == b.legacy.legacy.legacy.lot_frame
        && a.legacy.legacy.legacy.funds_cents == b.legacy.legacy.legacy.funds_cents
        && (av.world.grid_width, av.world.grid_height)
            == (bv.world.grid_width, bv.world.grid_height)
        && av.world.blocked_tiles == bv.world.blocked_tiles
        && objects(av) == objects(bv)
        && av.object_facings == bv.object_facings
        && av.object_colourways == bv.object_colourways
        && av.retired_indices == bv.retired_indices
        && av.floors == bv.floors
        && ab.next_copy_id == bb.next_copy_id
        && ab.copies.len() == bb.copies.len()
        && ab.copies.iter().zip(&bb.copies).all(|(a, b)| {
            a.id == b.id && a.title_id == b.title_id && a.home == b.home && a.location == b.location
        })
}
pub(crate) fn reconcile_ordinary(
    world: &mut World,
    before: &RoomChangeContext,
    origin: (u32, u32),
) -> Result<(), RoomError> {
    let now = crate::lot_frame::origin(world);
    let proposal = match_rooms(
        &before.map,
        &RoomTopology::from_world(world)?,
        (
            now.0 as i32 - origin.0 as i32,
            now.1 as i32 - origin.1 as i32,
        ),
    );
    let mut saved = world.resource::<SavedRooms>().clone();
    // Matching validates records against the captured pre-edit map. Land has
    // already translated the draft anchors, so restore only their input frame.
    let offset = (
        now.0
            .checked_sub(origin.0)
            .ok_or(RoomError::InvalidArchitecture)?,
        now.1
            .checked_sub(origin.1)
            .ok_or(RoomError::InvalidArchitecture)?,
    );
    for record in &mut saved.records {
        if let Some((x, y)) = record.anchor {
            record.anchor = Some((
                x.checked_sub(offset.0).ok_or(RoomError::InvalidRegistry)?,
                y.checked_sub(offset.1).ok_or(RoomError::InvalidRegistry)?,
            ));
        }
    }
    let resolved = resolve_rooms(&proposal, &RoomChoices::default(), &saved)?;
    crate::chores::reconcile_committed_world(world, before, &resolved)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::Sim;
    use terri_core::{CommandQueue, SimClock, SimCommand};

    #[test]
    fn build_transaction_freezes_native_ticks_and_committed_saves() {
        let mut sim = Sim::new_from_shipped_lot();
        sim.begin_build().unwrap();
        let before = sim.save_snapshot_v17();
        let tick = sim.world().resource::<SimClock>().tick;
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetFloor {
                x: 17,
                y: 13,
                covering: 4,
            });
        sim.flush_commands();
        assert_eq!(
            sim.save_snapshot_v17(),
            before,
            "persistence must retain the committed baseline"
        );
        sim.tick();
        assert_eq!(
            sim.world().resource::<SimClock>().tick,
            tick,
            "native tick must stay paused"
        );
    }
}
