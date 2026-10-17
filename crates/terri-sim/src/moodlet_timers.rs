//! One end tick per person: the shape a timed moodlet keeps between the
//! event that starts it and the tick it ends. Burnt meals (issue 243) and
//! fights (issue 248) each wrap one of these in their own resource.
use terri_core::{FnvHasher, SimId};

/// Who carries the moodlet and the tick it ends, sorted by person with one
/// entry each. Saved by the owning feature; hashed whenever non-empty.
#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct MoodletTimers(Vec<(SimId, u64)>);

impl MoodletTimers {
    /// Builds the list from saved rows, keeping one entry per person in
    /// id order; a later duplicate loses.
    pub fn from_entries(entries: Vec<(SimId, u64)>) -> Self {
        let mut list = Self::default();
        for (sim, until) in entries {
            if list.0.iter().all(|(id, _)| *id != sim) {
                list.record(sim, until);
            }
        }
        list
    }

    pub fn entries(&self) -> &[(SimId, u64)] {
        &self.0
    }

    /// A new event replaces the person's earlier one, so the moodlet
    /// restarts rather than stacking.
    pub fn record(&mut self, sim: SimId, until: u64) {
        self.0.retain(|(id, _)| *id != sim);
        let at = self.0.partition_point(|(id, _)| *id < sim);
        self.0.insert(at, (sim, until));
    }

    /// Whether the person's moodlet is still running at `now`.
    pub fn active(&self, sim: SimId, now: u64) -> bool {
        self.0.iter().any(|(id, until)| *id == sim && now < *until)
    }

    /// Drops the person's row, as death drops every other per-person record.
    pub fn forget(&mut self, sim: SimId) {
        self.0.retain(|(id, _)| *id != sim);
    }

    /// Drops every moodlet whose tick has passed.
    pub fn expire(&mut self, now: u64) {
        self.0.retain(|(_, until)| now < *until);
    }

    /// An empty list hashes nothing, so a household that never had the
    /// event hashes exactly as it did before the feature existed. `tag`
    /// keeps two features' lists from hashing alike.
    pub fn hash_into(&self, hash: &mut FnvHasher, tag: &[u8]) {
        if self.0.is_empty() {
            return;
        }
        hash.write_bytes(tag);
        hash.write_u64(self.0.len() as u64);
        for (id, until) in &self.0 {
            hash.write_u64(u64::from(id.0));
            hash.write_u64(*until);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_entry_per_person_and_a_new_event_restarts_the_moodlet() {
        let mut timers = MoodletTimers::default();
        timers.record(SimId(3), 100);
        timers.record(SimId(1), 50);
        timers.record(SimId(3), 120);
        assert_eq!(timers.entries(), &[(SimId(1), 50), (SimId(3), 120)]);
        assert!(timers.active(SimId(3), 119));
        assert!(
            !timers.active(SimId(3), 120),
            "the end tick is already over"
        );
        assert!(!timers.active(SimId(2), 0));
        timers.expire(50);
        assert_eq!(timers.entries(), &[(SimId(3), 120)]);
        timers.forget(SimId(3));
        assert!(timers.entries().is_empty());
        let rebuilt =
            MoodletTimers::from_entries(vec![(SimId(7), 9), (SimId(2), 4), (SimId(7), 1)]);
        assert_eq!(rebuilt.entries(), &[(SimId(2), 4), (SimId(7), 9)]);
    }

    /// The digest sees the list only when it holds something, sees every
    /// field of every entry, and tells two features' lists apart.
    #[test]
    fn hash_observes_entries_tag_and_ignores_an_empty_list() {
        let digest = |timers: &MoodletTimers, tag: &[u8]| {
            let mut hash = FnvHasher::default();
            timers.hash_into(&mut hash, tag);
            hash.finish()
        };
        let empty = digest(&MoodletTimers::default(), b"a");
        assert_eq!(empty, FnvHasher::default().finish());
        let mut one = MoodletTimers::default();
        one.record(SimId(1), 10);
        let base = digest(&one, b"a");
        assert_ne!(base, empty);
        assert_ne!(digest(&one, b"b"), base, "the tag is hashed");
        let mut later = one.clone();
        later.record(SimId(1), 11);
        assert_ne!(digest(&later, b"a"), base, "the end tick is hashed");
        let mut other = MoodletTimers::default();
        other.record(SimId(2), 10);
        assert_ne!(digest(&other, b"a"), base, "the person is hashed");
    }
}
