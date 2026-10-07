//! Physical ownership and title memory. Movement and reward application live in runtime systems.

mod domain;
pub use domain::*;
mod context;
pub(crate) use context::{validate_borrower_positions, with_book_world};
mod lifecycle;
pub(crate) use lifecycle::{prepare_shelf_sale, recover_before_death};

#[cfg(test)]
mod tests;

mod commands;
pub(crate) use commands::{commit, taste_multiplier};
pub use commands::{BookCommandResult, BookFeedback, LegacyBookImportNotice};

#[cfg(test)]
mod command_tests;
