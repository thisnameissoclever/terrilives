//! Title catalogue and reading rules compiled separately from physical objects.

use crate::error::ContentError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Work rewards use one baseline game hour, independently of the session cap.
/// At baseline speed one work unit is one game minute; comfort uses elapsed ticks.
pub const READING_REFERENCE_TICKS: f32 = terri_core::TICKS_PER_SIM_HOUR as f32;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BookDefinition {
    pub id: String,
    pub title: String,
    pub description: String,
    pub genre: String,
    pub reading_minutes: u32,
    pub price: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadingTuning {
    /// Maximum elapsed reading ticks in one visit, excluding transport and reach.
    pub session_ticks: u32,
    pub pickup_ticks: u32,
    pub shelve_ticks: u32,
    pub reread_floor: f32,
    pub recovery_ticks: u64,
    /// Entertainment per reference hour of baseline work, not per capped visit.
    pub fun_per_session: f32,
    /// Owned-reading action Fun values express seat multipliers relative to this baseline.
    pub action_fun_reference: f32,
    /// Satisfaction per reference hour of baseline work, before personal modifiers.
    pub satisfaction_per_session: f32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BooksFile {
    pub genres: Vec<String>,
    pub book: Vec<BookDefinition>,
}

fn invalid(context: impl Into<String>, reason: &str) -> ContentError {
    ContentError::InvalidBookContent {
        context: context.into(),
        reason: reason.into(),
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

pub fn validate_reading(tuning: &ReadingTuning) -> Result<(), ContentError> {
    if tuning.pickup_ticks == 0
        || tuning.shelve_ticks == 0
        || tuning.pickup_ticks as f32 > READING_REFERENCE_TICKS
        || tuning.shelve_ticks as f32 > READING_REFERENCE_TICKS
        || tuning.session_ticks == 0
        || tuning.session_ticks as f32 > READING_REFERENCE_TICKS
        || tuning.recovery_ticks == 0
        || !tuning.reread_floor.is_finite()
        || !(0.0..=1.0).contains(&tuning.reread_floor)
        || tuning.reread_floor == 0.0
        || !tuning.action_fun_reference.is_finite()
        || tuning.action_fun_reference <= 0.0
        || !tuning.fun_per_session.is_finite()
        || !(0.0..=100.0).contains(&tuning.fun_per_session)
        || tuning.fun_per_session == 0.0
        || !tuning.satisfaction_per_session.is_finite()
        || !(0.0..=100.0).contains(&tuning.satisfaction_per_session)
        || tuning.satisfaction_per_session == 0.0
    {
        return Err(invalid("reading", "ticks must be positive and a session at most one hour; reread floor must be in (0, 1]; rewards must be finite and in (0, 100]"));
    }
    Ok(())
}

/// No object compiler arguments or legacy fingerprints change when books are added.
pub fn compile_books(source: BooksFile) -> Result<Vec<BookDefinition>, ContentError> {
    let mut genres = BTreeSet::new();
    for genre in &source.genres {
        if !valid_id(genre) || !genres.insert(genre) {
            return Err(invalid(genre, "genre IDs must be valid and unique"));
        }
    }
    let mut ids = BTreeSet::new();
    for book in &source.book {
        if !valid_id(&book.id) || !ids.insert(&book.id) {
            return Err(invalid(&book.id, "title IDs must be valid and unique"));
        }
        if book.title.trim().is_empty() || book.description.trim().is_empty() {
            return Err(invalid(&book.id, "title and description must contain text"));
        }
        if !genres.contains(&book.genre) {
            return Err(invalid(&book.id, "unknown genre"));
        }
        if book.reading_minutes == 0 || book.price == 0 {
            return Err(invalid(&book.id, "reading time and price must be positive"));
        }
    }
    Ok(source.book)
}
