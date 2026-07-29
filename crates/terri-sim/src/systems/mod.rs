pub mod action;
pub mod advertise;
// Declared in the same commit that creates `idle.rs`, per [L2]: rustc
// does not compile a `.rs` file no `mod` declaration references, so a
// file added without this line has its tests reported as `0 filtered
// out` rather than as failures.
pub mod idle;
pub mod interact;
pub mod movement;
pub mod needs;
