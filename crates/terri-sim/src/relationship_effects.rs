//! Directional opinion changes and observations of the last simulation tick.
//! Diagnostics are excluded from behavioral state.
use crate::activity_log::ActivityLog;
use bevy_ecs::prelude::*;
use terri_core::{Relationships, SimClock, SimId};
use terri_data::ContentPack;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RelationshipCause {
    Conversation,
    LowNeedInterruption,
    CriticalNeedInterruption,
    PrivacyEntry,
    PrivacyStart,
    Proximity,
    SharedActivity,
    Incompatibility,
    Decay,
    HouseholdMess,
    ChoreFulfilled,
    ChoreNeglected,
    /// Another person using something the affected person hates - [OA-use].
    Nuisance,
    /// A finished fight, felt by both sides (fights, issue 248).
    Fight,
    /// Someone else's dirty dishes left at the place a diner sat down to.
    DirtySetting,
    /// A completed portion of another person's cooked meal.
    MealShared,
}

impl RelationshipCause {
    pub const ALL: [Self; 16] = [
        Self::Conversation,
        Self::LowNeedInterruption,
        Self::CriticalNeedInterruption,
        Self::PrivacyEntry,
        Self::PrivacyStart,
        Self::Proximity,
        Self::SharedActivity,
        Self::Incompatibility,
        Self::Decay,
        Self::HouseholdMess,
        Self::ChoreFulfilled,
        Self::ChoreNeglected,
        Self::Nuisance,
        Self::Fight,
        Self::DirtySetting,
        Self::MealShared,
    ];

    /// The cause's entry in the activity log's label table, which the shell
    /// turns into words. An identifier, never shown to the player.
    pub fn log_label(self) -> &'static str {
        match self {
            Self::Conversation => "cause:conversation",
            Self::LowNeedInterruption => "cause:low-need-interruption",
            Self::CriticalNeedInterruption => "cause:critical-need-interruption",
            Self::PrivacyEntry => "cause:privacy-entry",
            Self::PrivacyStart => "cause:privacy-start",
            Self::Proximity => "cause:proximity",
            Self::SharedActivity => "cause:shared-activity",
            Self::Incompatibility => "cause:incompatibility",
            Self::Decay => "cause:decay",
            Self::HouseholdMess => "cause:household-mess",
            Self::ChoreFulfilled => "cause:chore-fulfilled",
            Self::ChoreNeglected => "cause:chore-neglected",
            Self::Nuisance => "cause:nuisance",
            Self::Fight => "cause:fight",
            Self::DirtySetting => "cause:dirty-setting",
            Self::MealShared => "cause:meal-shared",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct RelationshipEffect {
    pub tick: u64,
    /// One privacy action shares this number across all its victims.
    pub event: u32,
    pub cause: RelationshipCause,
    pub responsible: SimId,
    pub affected: SimId,
    pub requested: f32,
    pub actual: f32,
    pub emergency: bool,
    pub directed: bool,
}

#[derive(Resource, Default, Clone)]
#[doc(hidden)]
pub struct RelationshipDiagnostics {
    pub(crate) effects: Vec<RelationshipEffect>,
    pub(crate) contacts: Vec<(SimId, SimId)>,
    pub(crate) waits: Vec<(SimId, bool, u64)>,
}

impl crate::Sim {
    /// Actor, whether private use is waiting to start, and elapsed blocked minutes.
    pub fn privacy_waits(&self) -> &[(SimId, bool, u64)] {
        &self.world().resource::<RelationshipDiagnostics>().waits
    }

    pub fn compatibility(&self, subject: SimId, other: SimId) -> Option<f32> {
        let world = self.world();
        let mut q = world.try_query::<(Entity, &SimId)>()?;
        let a = q.iter(world).find(|(_, id)| **id == subject)?.0;
        let b = q.iter(world).find(|(_, id)| **id == other)?.0;
        let profile = |e| {
            crate::compatibility::preferences(
                world.resource::<crate::Content>().0,
                world.get::<terri_core::Personality>(e),
                world.get::<terri_core::Traits>(e),
                world.get::<terri_core::Hobbies>(e),
            )
        };
        Some(crate::compatibility::between(&profile(a), &profile(b)))
    }
    pub fn relationship_effects(&self) -> &[RelationshipEffect] {
        &self.world().resource::<RelationshipDiagnostics>().effects
    }

    pub fn relationship_contacts(&self) -> &[(SimId, SimId)] {
        &self.world().resource::<RelationshipDiagnostics>().contacts
    }
}

/// Records one relationship effect: the per-tick diagnostic and, for a
/// discrete cause, the activity log ([AL-capture] item 1). Every effect
/// passes through here or through [`record_in`].
pub(crate) fn record(world: &mut World, effect: RelationshipEffect) {
    record_about(world, effect, None);
}

/// [`record`] for an effect about an object: the fixture of a privacy
/// incident, or the kind of a disliked object in use.
pub(crate) fn record_about(world: &mut World, effect: RelationshipEffect, object: Option<&str>) {
    world
        .resource_mut::<RelationshipDiagnostics>()
        .effects
        .push(effect);
    let pack = world.resource::<crate::Content>().0;
    if let Some(mut log) = world.get_resource_mut::<ActivityLog>() {
        forward(&mut log, pack, &effect, object);
    }
}

/// [`record`] for a system that holds both resources as parameters.
pub(crate) fn record_in(
    diagnostics: &mut RelationshipDiagnostics,
    log: Option<&mut ActivityLog>,
    pack: &'static ContentPack,
    effect: RelationshipEffect,
) {
    diagnostics.effects.push(effect);
    if let Some(log) = log {
        forward(log, pack, &effect, None);
    }
}

/// Where each cause goes in the activity log. The match has no wildcard arm
/// on purpose: a new cause does not compile until someone decides whether
/// the log shows it.
fn forward(
    log: &mut ActivityLog,
    pack: &'static ContentPack,
    effect: &RelationshipEffect,
    object: Option<&str>,
) {
    if !log.enabled() {
        return;
    }
    match effect.cause {
        RelationshipCause::HouseholdMess
        | RelationshipCause::DirtySetting
        | RelationshipCause::PrivacyEntry
        | RelationshipCause::PrivacyStart
        | RelationshipCause::LowNeedInterruption
        | RelationshipCause::CriticalNeedInterruption => log.annoyed(pack, effect, object),
        RelationshipCause::Nuisance => log.nuisance(pack, effect, object),
        // The chat or fight record carries both changes.
        RelationshipCause::Conversation | RelationshipCause::Fight => log.hold_feeling(effect),
        RelationshipCause::ChoreFulfilled | RelationshipCause::ChoreNeglected => {
            log.feeling(pack, effect)
        }
        // Summed into the shared activity it belongs to.
        RelationshipCause::SharedActivity => log.shared(effect),
        // Continuous: they move many pairs every tick ([AL-sources]).
        RelationshipCause::Proximity
        | RelationshipCause::Incompatibility
        | RelationshipCause::Decay => {}
        // Logged by the meal appreciation source in the next commit.
        RelationshipCause::MealShared => {}
    }
}

pub(crate) fn reset(world: &mut World) {
    let mut diagnostics = world.resource_mut::<RelationshipDiagnostics>();
    diagnostics.effects.clear();
    diagnostics.contacts.clear();
    diagnostics.waits.clear();
}

/// Apply one directional opinion change and record its clamped result.
pub(crate) fn record_opinion_change(
    world: &mut World,
    responsible: u32,
    affected: Entity,
    delta: f32,
    cause: RelationshipCause,
) {
    let Some(subject) = world.get::<SimId>(affected).copied() else {
        return;
    };
    if subject.0 == responsible {
        return;
    }
    if world.get::<Relationships>(affected).is_none() {
        world.entity_mut(affected).insert(Relationships::default());
    }
    let before = world
        .get::<Relationships>(affected)
        .unwrap()
        .feeling(SimId(responsible));
    world
        .get_mut::<Relationships>(affected)
        .unwrap()
        .bump(SimId(responsible), delta);
    let after = world
        .get::<Relationships>(affected)
        .unwrap()
        .feeling(SimId(responsible));
    let tick = world.resource::<SimClock>().tick;
    record(
        world,
        RelationshipEffect {
            tick,
            event: 0,
            cause,
            responsible: SimId(responsible),
            affected: subject,
            requested: delta,
            actual: after - before,
            emergency: false,
            directed: false,
        },
    );
}
