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

/// The range every need level is held inside. Lives here rather than in
/// `needs.rs` because it bounds the whole notion of a need, not just the
/// component that stores them; `Needs` imports it.
pub const NEED_MAX: f32 = 100.0;
pub const NEED_MIN: f32 = 0.0;

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
