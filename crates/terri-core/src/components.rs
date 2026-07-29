use crate::ids::ObjectDefId;
use bevy_ecs::prelude::{Component, Entity};

/// World-space position in tiles. Not screen space; the renderer
/// applies the isometric projection.
#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct Position {
    pub x: f32,
    pub y: f32,
}

/// Marks an entity as a simulated person.
#[derive(Component, Debug, Clone, Copy)]
pub struct Agent;

/// A placed object. See [D6] and [D-1]. The advertised interactions live
/// in the content pack, not here, which is what lets an advert be a
/// variable-length list of need deltas rather than one named field.
///
/// The id indexes the pack the simulation was built with. Nothing
/// persists one - it is not stable across content edits - so a save file
/// must store the object's string id and resolve it with
/// `ContentPack::find` on load.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct SmartObject(pub ObjectDefId);

/// Marks a smart object as claimed. Reservation is serialized and
/// ordered by entity id so two agents never claim one slot.
#[derive(Component, Debug, Clone, Copy)]
pub struct Reserved;

/// A tile path being followed. `steps` excludes the origin tile.
#[derive(Component, Debug, Clone)]
pub struct Path {
    pub steps: Vec<(i32, i32)>,
    pub cursor: usize,
}

impl Path {
    /// The tile to walk to next, or `None` once the path is exhausted.
    ///
    /// There is deliberately no `is_complete`. `follow_path` asks the same
    /// question as `next_step().is_none()`, and two ways to ask one
    /// question is a future divergence: an off-by-one fixed in one and not
    /// the other would leave an agent that both has a step to take and is
    /// finished. The `None` case is the completion signal.
    pub fn next_step(&self) -> Option<(i32, i32)> {
        self.steps.get(self.cursor).copied()
    }
}

/// The smart object this agent is currently travelling to, and which of
/// that object's advertised interactions it chose.
///
/// The interaction index is carried rather than re-derived on arrival.
/// Selection scores every (object, interaction) pair against the agent's
/// deficits at the moment of choosing; by the time the agent has walked
/// there those deficits have moved, so re-deriving the choice could pick
/// a different interaction than the one that actually won.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Target {
    pub object: Entity,
    /// Index into the target object's `interactions` in the content pack.
    pub interaction: u32,
}

/// Marks an agent for which **nothing at all is worth doing** - every
/// candidate it can reach scored at or below `idle_threshold`.
///
/// It is not the same as "took no action". An agent whose best option
/// scores between `idle_threshold` and `action_threshold` also takes no
/// action, and it deliberately does NOT get this marker: something is
/// mildly worth doing, so the sim stays put rather than strolling away
/// from it. That band is the whole reason the two knobs are separate,
/// per [D-5], and collapsing them would delete it.
///
/// `select_action` is the only writer, because it is the only system
/// that scores. `idle::wander` is the only reader. Keeping the marker
/// rather than re-scoring in the wander system is what stops the same
/// A*-per-candidate sweep running twice a tick, and what stops the two
/// copies of the scoring rule drifting apart.
#[derive(Component, Debug, Clone, Copy)]
pub struct Restless;

/// How long an idle agent waits before strolling somewhere new.
///
/// Counted down only while the agent is standing still, since the wander
/// system skips anything that still has a `Path`. So the value is the
/// gap BETWEEN wanders rather than a cooldown that expires mid-walk,
/// which is what stops a sim pacing every single tick.
///
/// Owned entirely by `idle::wander`. It persists across an interruption,
/// so a sim that gets hungry mid-pause keeps its remaining count, which
/// costs nothing and avoids a second component whose only job would be to
/// forget.
#[derive(Component, Debug, Clone, Copy)]
pub struct Wander {
    pub pause_ticks: u32,
}

/// An in-progress interaction: a reference into the content pack plus how
/// much of it is left.
///
/// It names the object DEFINITION rather than the object entity, so the
/// deltas being delivered stay resolvable for the whole interaction even
/// if the entity changes underneath it. `Target` is what still names the
/// entity, because releasing the reservation needs one.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Eating {
    pub object: ObjectDefId,
    /// Index into that object's `interactions` in the content pack.
    pub interaction: u32,
    pub remaining_ticks: u32,
}
