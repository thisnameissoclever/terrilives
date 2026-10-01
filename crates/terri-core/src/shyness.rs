//! A bounded personal stat; its initial value is reproducible from saved identity.
use crate::{SimId, SimRng};
use bevy_ecs::prelude::Component;

#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shyness(u8);

impl Shyness {
    pub fn new(value: u8) -> Option<Self> {
        (1..=100).contains(&value).then_some(Self(value))
    }
    pub fn value(self) -> u8 {
        self.0
    }
    pub fn initial(id: SimId) -> Self {
        // A separate generator avoids spending the world's decision draws.
        Self(1 + SimRng::from_seed(0x5348_594E_4553 ^ u64::from(id.0)).range(100) as u8)
    }
    pub fn annoyance_scale(self, strength: f32) -> f32 {
        1.0 + strength / 50.0 * (f32::from(self.0) - 50.0)
    }
    pub fn avoidance_cost(self, base: f32) -> f32 {
        base + base / 100.0 * (f32::from(self.0) - 50.0)
    }
    pub fn wander_reconsider_chance(self, base: f32, strength: f32) -> f32 {
        base + strength / 100.0 * f32::from(self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shyness_bounds_and_modest_boundary_response_are_pinned() {
        assert!(Shyness::new(0).is_none());
        assert!(Shyness::new(101).is_none());
        let bold = Shyness::new(1).unwrap();
        let neutral = Shyness::new(50).unwrap();
        let shy = Shyness::new(100).unwrap();
        assert!((bold.annoyance_scale(0.25) - 0.755).abs() < 0.00001);
        assert_eq!(neutral.annoyance_scale(0.25), 1.0);
        assert_eq!(shy.annoyance_scale(0.25), 1.25);
        assert!((bold.avoidance_cost(0.01) - 0.0051).abs() < 0.00001);
        assert_eq!(neutral.avoidance_cost(0.01), 0.01);
        assert_eq!(shy.avoidance_cost(0.01), 0.015);
        assert!((bold.wander_reconsider_chance(0.10, 0.15) - 0.1015).abs() < 0.00001);
        assert_eq!(shy.wander_reconsider_chance(0.10, 0.15), 0.25);
    }
    #[test]
    fn shyness_initial_values_are_stable_varied_and_bounded() {
        let values: Vec<_> = (0..100)
            .map(|id| Shyness::initial(SimId(id)).value())
            .collect();
        assert!(values.iter().all(|v| (1..=100).contains(v)));
        assert!(values.windows(2).any(|p| p[0] != p[1]));
        assert_eq!(&values[..8], &[89, 22, 30, 54, 100, 4, 97, 27]);
    }
}
