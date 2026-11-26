//! The pool clocks are shared by the simulation and the player guide.

pub const ENTER_TICKS: u32 = 20;
pub const SWIM_TICKS: u32 = 60;
pub const EXIT_TICKS: u32 = 40;
pub const RETURN_TICKS: u32 = 8;

pub fn capacity(model: &str) -> u8 {
    match model {
        "pool_above_ground_3x4" => 2,
        "pool_in_ground_5x7" => 4,
        _ => 1,
    }
}

pub fn swim_ticks(model: &str) -> u32 {
    if model == "pool_in_ground_5x7" {
        100
    } else {
        SWIM_TICKS
    }
}

impl crate::CompiledInteraction {
    pub fn duration_for_model(&self, model: &str) -> u32 {
        if !self.tags.iter().any(|tag| tag == "pool_swimming") {
            return self.duration_ticks;
        }
        let return_ticks = if capacity(model) > 1 { RETURN_TICKS } else { 0 };
        ENTER_TICKS + swim_ticks(model) + return_ticks + EXIT_TICKS
    }
}
