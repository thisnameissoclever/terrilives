use bevy_ecs::prelude::Component;

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
