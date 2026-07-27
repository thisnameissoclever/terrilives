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

/// A need level from 0.0 (desperate) to 100.0 (fully satisfied).
#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct Hunger(pub f32);

pub const NEED_MAX: f32 = 100.0;
pub const NEED_MIN: f32 = 0.0;

impl Hunger {
    pub fn drain(&mut self, amount: f32) {
        self.0 = (self.0 - amount).clamp(NEED_MIN, NEED_MAX);
    }

    pub fn fill(&mut self, amount: f32) {
        self.0 = (self.0 + amount).clamp(NEED_MIN, NEED_MAX);
    }

    /// 0.0 when fully satisfied, 1.0 when desperate. Advertisement
    /// scoring in Task 5 weights this nonlinearly.
    pub fn deficit(&self) -> f32 {
        (NEED_MAX - self.0) / NEED_MAX
    }
}

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
    pub fn next_step(&self) -> Option<(i32, i32)> {
        self.steps.get(self.cursor).copied()
    }

    pub fn is_complete(&self) -> bool {
        self.cursor >= self.steps.len()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hunger_clamps_to_range() {
        let mut h = Hunger(100.0);
        h.drain(150.0);
        assert_eq!(h.0, 0.0);
        h.fill(500.0);
        assert_eq!(h.0, 100.0);
    }

    #[test]
    fn deficit_is_inverse_of_level() {
        assert_eq!(Hunger(100.0).deficit(), 0.0);
        assert_eq!(Hunger(0.0).deficit(), 1.0);
        assert_eq!(Hunger(50.0).deficit(), 0.5);
    }
}
