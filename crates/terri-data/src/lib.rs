//! Content schema for the TOML files the simulation is authored in.
//!
//! Deliberately free of `bevy_ecs` and of anything web. This crate is
//! read by `build.rs` at build time and by the simulation at run time,
//! so it has to compile for the host and for `wasm32-unknown-unknown`.

pub mod error;
pub mod schema;

pub use error::ContentError;
pub use schema::{InteractionDef, NeedDef, NeedsFile, ObjectDef, ObjectsFile};
