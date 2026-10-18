//! Runtime state has a different lifetime from an external save/load.
//! Durable state comes from V17. Receipts and last-tick observations survive
//! native transactions; geometry-dependent caches are rebuilt without ticking.
use crate::{SaveError, Sim};
use bevy_ecs::prelude::*;

fn copy_optional<T: Resource + Clone>(from: &World, to: &mut World) {
    if let Some(value) = from.get_resource::<T>() {
        to.insert_resource(value.clone());
    } else {
        to.remove_resource::<T>();
    }
}

/// The complete unsaved feedback/observation policy for both forks and no-op results.
pub(crate) fn copy_feedback(from: &World, to: &mut World) {
    let requests = crate::social_episode::requests::runtime::capture(from);
    crate::social_episode::requests::runtime::restore(&requests, to);
    copy_optional::<crate::player_actions::ActionDiagnostics>(from, to);
    copy_optional::<crate::completion_sounds::CompletionSounds>(from, to);
    copy_optional::<crate::systems::command::CommandFeedback>(from, to);
    copy_optional::<crate::books::BookFeedback>(from, to);
    copy_optional::<crate::beds::AssignmentFeedback>(from, to);
    copy_optional::<crate::character_draft::CharacterResults>(from, to);
    copy_optional::<crate::books::LegacyBookImportNotice>(from, to);
    copy_optional::<crate::relationship_effects::RelationshipDiagnostics>(from, to);
    copy_optional::<crate::systems::autonomy::DecisionTelemetry>(from, to);
    let mut lot = from.resource::<crate::placement::LotEditState>().clone();
    lot.discontinuities = lot
        .discontinuities
        .iter()
        .filter_map(|entity| crate::dining::entity(to, entity.index_u32()))
        .collect();
    to.insert_resource(lot);
    to.resource_mut::<crate::careers::Careers>().last_result =
        from.resource::<crate::careers::Careers>().last_result;
}

pub(crate) fn refresh_derived(world: &mut World) {
    crate::social_episode::requests::runtime::rebuild(world);
    crate::relationship_dynamics::refresh_profiles(world);
    crate::social_company::refresh(world);
    // Reading options and interpersonal phases belong to a single scheduled
    // phase. Their producers rebuild them before their next consumers run.
    world.remove_resource::<crate::reading::Options>();
    world.remove_resource::<crate::systems::interpersonal::InterpersonalPhase>();
}

/// Use existing discontinuity rules while retaining ordinary interpolation.
/// External Load starts a new action history; native installation retains it.
pub(crate) fn install(sim: &mut Sim, candidate: Sim) -> Result<(), SaveError> {
    // Adoption syncs the candidate's render buffer and consumes these markers.
    // The live interpolation history below still needs them on its next sync.
    let discontinuities = candidate
        .world
        .resource::<crate::placement::LotEditState>()
        .discontinuities
        .clone();
    let render = std::mem::take(&mut sim.render);
    let rows = std::mem::take(&mut sim.render_rows);
    let sockets = std::mem::take(&mut sim.socket_projected_entities);
    let portals = std::mem::take(&mut sim.portals);
    let diagnostics = candidate
        .world
        .get_resource::<crate::player_actions::ActionDiagnostics>()
        .cloned();
    let result = sim.adopt_current_with_saved_state(candidate);
    sim.render = render;
    sim.portals = portals;
    if result.is_ok() {
        if let Some(diagnostics) = diagnostics {
            sim.world.insert_resource(diagnostics);
        }
        let discontinuities = discontinuities
            .into_iter()
            .filter_map(|entity| crate::dining::entity(&sim.world, entity.index_u32()))
            .collect::<Vec<_>>();
        sim.world
            .resource_mut::<crate::placement::LotEditState>()
            .discontinuities
            .extend(discontinuities);
        sim.render_rows = rows
            .into_iter()
            .filter_map(|entity| crate::dining::entity(&sim.world, entity.index_u32()))
            .collect();
        sim.socket_projected_entities = sockets
            .into_iter()
            .filter_map(|entity| crate::dining::entity(&sim.world, entity.index_u32()))
            .collect();
        crate::portals::sync_portals(&mut sim.world, &mut sim.portals);
    } else {
        sim.render_rows = rows;
        sim.socket_projected_entities = sockets;
    }
    result
}
