//! Identifiers that reference the build-time content pack.
//!
//! These live in `terri-core` rather than `terri-data` because
//! `SmartObject` holds one and `terri-core` is the lowest layer; it must
//! not depend on the content crate. `terri-data` re-exports them.

use serde::{Deserialize, Serialize};

/// Index of an object in the content pack, assigned in declaration
/// order. Stable within a pack, NOT stable across content edits, which
/// is why nothing persists one; save files store the string id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ObjectDefId(pub u32);
