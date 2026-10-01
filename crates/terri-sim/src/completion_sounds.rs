use bevy_ecs::prelude::*;

pub const MAX_COMPLETION_SOUNDS: usize = 64;
pub const TOILET_FLUSH: u32 = 1;

/// Unsaved presentation events, packed as action/source pairs.
#[derive(Resource)]
pub struct CompletionSounds(pub(crate) Vec<u32>);

impl Default for CompletionSounds {
    fn default() -> Self {
        Self(Vec::with_capacity(MAX_COMPLETION_SOUNDS * 2))
    }
}

impl CompletionSounds {
    pub fn push(&mut self, action: u32, source: u32) {
        if self.0.len() >= MAX_COMPLETION_SOUNDS * 2
            || self
                .0
                .chunks_exact(2)
                .any(|event| event == [action, source])
        {
            return;
        }
        self.0.extend_from_slice(&[action, source]);
    }
}
