//! The ONLY crate that knows JavaScript exists.
//! Nothing in here may contain simulation logic.

use terri_core::{Agent, Hunger, Position, SmartObject};
use terri_sim::Sim;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct SimHandle {
    sim: Sim,
}

#[wasm_bindgen]
impl SimHandle {
    #[wasm_bindgen(constructor)]
    pub fn new(width: usize, height: usize) -> SimHandle {
        SimHandle {
            sim: Sim::new_with_lot(width, height),
        }
    }

    /// Advances one fixed tick and refreshes the render buffer.
    pub fn tick(&mut self) {
        self.sim.tick();
        self.sim.sync_render_buffer();
    }

    pub fn spawn_agent(&mut self, x: f32, y: f32, hunger: f32) {
        self.sim
            .world_mut()
            .spawn((Agent, Position { x, y }, Hunger(hunger)));
        self.sim.sync_render_buffer();
    }

    pub fn spawn_object(&mut self, x: f32, y: f32) {
        self.sim.world_mut().spawn((
            Position { x, y },
            SmartObject {
                hunger_delta: 40.0,
                duration_ticks: 15,
                slots: 1,
            },
        ));
        self.sim.sync_render_buffer();
    }

    pub fn entity_count(&self) -> usize {
        self.sim.render_buffer().count
    }

    /// Pointer into WASM linear memory. See the detachment warning in
    /// web/src/bridge.ts: these must be re-read after anything that can
    /// grow memory.
    pub fn positions_ptr(&self) -> *const f32 {
        self.sim.render_buffer().positions.as_ptr()
    }

    pub fn prev_positions_ptr(&self) -> *const f32 {
        self.sim.render_buffer().prev_positions.as_ptr()
    }

    pub fn kinds_ptr(&self) -> *const u32 {
        self.sim.render_buffer().kinds.as_ptr()
    }

    pub fn world_hash(&self) -> u64 {
        self.sim.world_hash()
    }
}
