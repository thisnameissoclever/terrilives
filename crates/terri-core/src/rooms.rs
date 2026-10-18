//! Saved room identities. Zero belongs to the single shared Outside selection.
use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const MAX_ROOM_NAME_SCALARS: usize = 48;
pub const MAX_ROOM_RECORDS: usize = 1_048_576;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "u32", into = "u32")]
pub struct RoomId(u32);

impl RoomId {
    pub const fn new(value: u32) -> Option<Self> {
        if value == 0 {
            None
        } else {
            Some(Self(value))
        }
    }

    pub const fn get(self) -> u32 {
        self.0
    }
}

impl TryFrom<u32> for RoomId {
    type Error = &'static str;
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        Self::new(value).ok_or("room ID zero is reserved for Outside")
    }
}

impl From<RoomId> for u32 {
    fn from(id: RoomId) -> Self {
        id.get()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RoomSelection {
    Outside,
    Room(RoomId),
}

impl RoomSelection {
    pub const fn key(self) -> u32 {
        match self {
            Self::Outside => 0,
            Self::Room(id) => id.get(),
        }
    }
    pub const fn from_key(key: u32) -> Self {
        match RoomId::new(key) {
            Some(id) => Self::Room(id),
            None => Self::Outside,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomRecord {
    pub id: RoomId,
    pub name: String,
    /// Canonical row-order anchor for a live room; absent for retained history.
    pub anchor: Option<(u32, u32)>,
}

#[derive(Clone, Debug, PartialEq, Eq, Resource, Serialize, Deserialize)]
pub struct SavedRooms {
    pub outside_name: String,
    /// Next unused identity, greater than every retained live or retired ID.
    pub next_id: u32,
    pub next_default_name: u32,
    pub records: Vec<RoomRecord>,
}

impl Default for SavedRooms {
    fn default() -> Self {
        Self {
            outside_name: "Outside".into(),
            next_id: 1,
            next_default_name: 1,
            records: vec![],
        }
    }
}

impl SavedRooms {
    pub fn record(&self, id: RoomId) -> Option<&RoomRecord> {
        self.records.iter().find(|record| record.id == id)
    }
    /// Keep retired identities only while the adopted household refers to them.
    pub fn retain_history(&mut self, referenced: &BTreeSet<RoomId>) {
        self.records
            .retain(|record| record.anchor.is_some() || referenced.contains(&record.id));
    }

    /// Validates saved values without needing architecture. Current loads must
    /// additionally resolve every live canonical anchor against room topology.
    pub fn validate(&self) -> Result<(), RoomRegistryError> {
        if self.records.len() > MAX_ROOM_RECORDS {
            return Err(RoomRegistryError::TooManyRecords);
        }
        if self.next_id == 0 || self.next_default_name == 0 {
            return Err(RoomRegistryError::InvalidAllocator);
        }
        let valid_name = |name: &str| validate_room_name(name).is_ok_and(|trimmed| trimmed == name);
        if !valid_name(&self.outside_name) {
            return Err(RoomRegistryError::InvalidName);
        }
        let mut ids = BTreeSet::new();
        let mut anchors = BTreeSet::new();
        for record in &self.records {
            if record.id.get() >= self.next_id || !ids.insert(record.id) {
                return Err(RoomRegistryError::InvalidId);
            }
            if !valid_name(&record.name) {
                return Err(RoomRegistryError::InvalidName);
            }
            if record.anchor.is_some_and(|anchor| !anchors.insert(anchor)) {
                return Err(RoomRegistryError::DuplicateAnchor);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoomNameError {
    Blank,
    TooLong,
    ControlCharacter,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoomRegistryError {
    TooManyRecords,
    InvalidAllocator,
    InvalidName,
    InvalidId,
    DuplicateAnchor,
}

pub fn validate_room_name(name: &str) -> Result<String, RoomNameError> {
    if name.chars().any(char::is_control) {
        return Err(RoomNameError::ControlCharacter);
    }
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(RoomNameError::Blank);
    }
    if trimmed.chars().count() > MAX_ROOM_NAME_SCALARS {
        return Err(RoomNameError::TooLong);
    }
    Ok(trimmed.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rooms_wire_ids_refuse_zero_and_preserve_the_full_integer() {
        let zero = postcard::to_allocvec(&0u32).unwrap();
        assert!(postcard::from_bytes::<RoomId>(&zero).is_err());
        for value in [1, 128, 90_001, u32::MAX] {
            let bytes = postcard::to_allocvec(&RoomId::new(value).unwrap()).unwrap();
            assert_eq!(postcard::from_bytes::<u32>(&bytes).unwrap(), value);
            assert_eq!(postcard::from_bytes::<RoomId>(&bytes).unwrap().get(), value);
        }
    }

    #[test]
    fn rooms_registry_refuses_ambiguous_anchors_ids_and_noncanonical_names() {
        let id = RoomId::new(9).unwrap();
        let mut saved = SavedRooms {
            next_id: 10,
            records: vec![RoomRecord {
                id,
                name: "Office".into(),
                anchor: Some((2, 3)),
            }],
            ..Default::default()
        };
        assert_eq!(saved.validate(), Ok(()));
        let bytes = postcard::to_allocvec(&saved).unwrap();
        assert_eq!(postcard::from_bytes::<SavedRooms>(&bytes).unwrap(), saved);
        saved.next_id = 9;
        assert_eq!(saved.validate(), Err(RoomRegistryError::InvalidId));
        saved.next_id = 10;
        saved.outside_name = " Outside ".into();
        assert_eq!(saved.validate(), Err(RoomRegistryError::InvalidName));
        saved.outside_name = "Outside".into();
        saved.records.push(RoomRecord {
            id: RoomId::new(8).unwrap(),
            name: "Office".into(),
            anchor: Some((2, 3)),
        });
        assert_eq!(saved.validate(), Err(RoomRegistryError::DuplicateAnchor));
        saved.records[1].anchor = None;
        assert_eq!(saved.validate(), Ok(()));
        saved.records[1].id = id;
        assert_eq!(saved.validate(), Err(RoomRegistryError::InvalidId));
    }
}
