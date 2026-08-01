pub mod action;
pub mod advertise;
// Declared in the same commit that creates `career.rs`, per [L2]: rustc
// does not compile a `.rs` file no `mod` declaration references, so a
// file added without this line has its tests reported as `0 filtered
// out` rather than as failures.
pub mod career;
// Declared in the same commit that creates `chain.rs`, per [L2]: rustc
// does not compile a `.rs` file no `mod` declaration references, so a
// file added without this line has its tests reported as `0 filtered
// out` rather than as failures.
pub mod chain;
// Declared in the same commit that creates `command.rs`, per [L2], for
// the same reason as `idle` below: a file no `mod` declaration references
// is never compiled, so its tests report `0 filtered out` rather than
// failing.
pub mod command;
// Declared in the same commit that creates `habituation.rs`, per [L2], for the
// same reason as the two above and below.
pub mod habituation;
// Declared in the same commit that creates `idle.rs`, per [L2]: rustc
// does not compile a `.rs` file no `mod` declaration references, so a
// file added without this line has its tests reported as `0 filtered
// out` rather than as failures.
pub mod idle;
pub mod interact;
pub mod movement;
pub mod needs;
// Declared in the same commit that creates `satisfaction.rs`, per [L2]:
// rustc does not compile a `.rs` file no `mod` declaration references,
// so a file added without this line has its tests reported as `0
// filtered out` rather than as failures.
pub mod satisfaction;
// Declared in the same commit that creates `trait_effects.rs`, per
// [L2]: rustc does not compile a `.rs` file no `mod` declaration
// references, so a file added without this line has its tests reported
// as `0 filtered out` rather than as failures.
pub mod trait_effects;
// Declared in the same commit that creates `social.rs`, per [L2]: rustc
// does not compile a `.rs` file no `mod` declaration references, so a
// file added without this line has its tests reported as `0 filtered
// out` rather than as failures.
pub mod social;
