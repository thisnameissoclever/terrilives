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

/// An object that advertises an interaction. See [D6]. M0 supports a
/// single need; the full version advertises a map of need deltas loaded
/// from content files.
#[derive(Component, Debug, Clone, Copy)]
pub struct SmartObject {
    pub hunger_delta: f32,
    pub duration_ticks: u32,
    pub slots: u8,
}

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

/// The smart object this agent is currently travelling to.
#[derive(Component, Debug, Clone, Copy)]
pub struct Target(pub Entity);

/// An in-progress eating interaction.
#[derive(Component, Debug, Clone, Copy)]
pub struct Eating {
    pub remaining_ticks: u32,
    pub delta_per_tick: f32,
}
