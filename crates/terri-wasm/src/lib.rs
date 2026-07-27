//! The ONLY crate that knows JavaScript exists.
//! Nothing in here may contain simulation logic.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn smoke_value() -> u32 {
    terri_core::smoke_value()
}
