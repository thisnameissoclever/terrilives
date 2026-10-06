//! Persistent household work and commitments, separate from floor coverings.
use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

#[derive(bevy_ecs::prelude::Component, Debug, Clone, Copy)]
pub struct ChoreWork;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ChoreKind {
    Dishes,
    Floors,
    Surfaces,
    Bins,
    CounterSurfaces,
    TableSurfaces,
}

impl ChoreKind {
    pub const ALL: [Self; 6] = [
        Self::Dishes,
        Self::Floors,
        Self::Surfaces,
        Self::Bins,
        Self::CounterSurfaces,
        Self::TableSurfaces,
    ];
    pub const fn index(self) -> usize {
        match self {
            Self::CounterSurfaces | Self::TableSurfaces => 2,
            _ => self as usize,
        }
    }
    pub const fn grouped(self) -> bool {
        matches!(self, Self::CounterSurfaces | Self::TableSurfaces)
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Dishes => "Do dishes",
            Self::Floors => "Clean floor",
            Self::Surfaces => "Wipe surface",
            Self::Bins => "Empty bin",
            Self::CounterSurfaces => "Wipe counter surfaces",
            Self::TableSurfaces => "Wipe table surfaces",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ChoreKey {
    pub kind: ChoreKind,
    pub target: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChoreProfile {
    pub sim_id: u32,
    pub responsibility: u8,
    pub commitment: u8,
    pub preferences: [i8; 4],
}

impl ChoreProfile {
    pub fn neutral(sim_id: u32) -> Self {
        Self {
            sim_id,
            responsibility: 50,
            commitment: 50,
            preferences: [0; 4],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChoreOrder {
    pub id: u32,
    pub person: u32,
    pub key: ChoreKey,
    pub queue_position: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChoreTask {
    pub person: u32,
    pub key: ChoreKey,
    pub cells: Vec<u32>,
    pub cursor: u32,
    pub endpoint: Option<u32>,
    pub remaining: u32,
    pub directed: bool,
    pub suspended: bool,
    pub started_day: u64,
    pub completed_units: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChoreAssignment {
    pub key: ChoreKey,
    pub owner: u32,
    pub week: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DutyOutcome {
    Pending,
    NoWork,
    WillDo,
    Skipped,
    Done,
    Covered,
    Missed,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChoreEpisode {
    pub id: u32,
    pub key: ChoreKey,
    pub owner: u32,
    pub day: u64,
    pub decision: Option<bool>,
    pub outcome: DutyOutcome,
    pub performer: Option<u32>,
    pub completed_at: Option<u64>,
    pub settled: bool,
    pub needed: bool,
    pub unavailable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChoreFeeling {
    pub person: u32,
    pub kind: ChoreKind,
    pub score: i16,
    pub expires: u64,
}

#[derive(Resource, Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedChores {
    pub floors: Vec<(u32, u16)>,
    pub surfaces: Vec<(u32, u16)>,
    pub bins: Vec<(u32, u16)>,
    pub unbinned: u32,
    pub profiles: Vec<ChoreProfile>,
    pub orders: Vec<ChoreOrder>,
    pub next_order: u32,
    pub tasks: Vec<ChoreTask>,
    pub assignments: Vec<ChoreAssignment>,
    pub episodes: Vec<ChoreEpisode>,
    pub next_episode: u32,
    pub week: Option<u64>,
    pub last_age_tick: u64,
    pub traffic: Vec<(u32, u32)>,
    pub feelings: Vec<ChoreFeeling>,
    pub rng: Option<crate::SimRng>,
    pub board_enabled: bool,
    pub roster: Vec<u32>,
    pub dish_started: Vec<(u32, u64)>,
    pub dish_contributions: Vec<(u32, u32, u32)>,
    pub disposed: u64,
}

impl SavedChores {
    pub fn hash_into(&self, hash: &mut crate::FnvHasher) {
        hash.write_bytes(b"household-chores-v1");
        hash.write_u64(self.roster.len() as u64);
        for id in &self.roster {
            hash.write_u64(*id as u64);
        }
        for rows in [&self.dish_started] {
            hash.write_u64(rows.len() as u64);
            for (id, day) in rows {
                hash.write_u64(*id as u64);
                hash.write_u64(*day);
            }
        }
        hash.write_u64(self.dish_contributions.len() as u64);
        for (episode, person, units) in &self.dish_contributions {
            hash.write_u64(*episode as u64);
            hash.write_u64(*person as u64);
            hash.write_u64(*units as u64);
        }
        hash.write_u64(self.disposed);
        for rows in [&self.floors, &self.surfaces, &self.bins] {
            hash.write_u64(rows.len() as u64);
            for (key, value) in rows {
                hash.write_u64(*key as u64);
                hash.write_u64(*value as u64);
            }
        }
        for value in [
            self.unbinned as u64,
            self.next_order as u64,
            self.next_episode as u64,
            self.week.unwrap_or(u64::MAX),
            self.last_age_tick,
            u64::from(self.board_enabled),
        ] {
            hash.write_u64(value);
        }
        hash.write_u64(self.profiles.len() as u64);
        for p in &self.profiles {
            for v in [
                p.sim_id as u64,
                p.responsibility as u64,
                p.commitment as u64,
            ] {
                hash.write_u64(v);
            }
            for v in p.preferences {
                hash.write_u64(v as i64 as u64);
            }
        }
        let key = |h: &mut crate::FnvHasher, k: ChoreKey| {
            h.write_u64(k.kind as u64);
            h.write_u64(k.target as u64);
        };
        hash.write_u64(self.orders.len() as u64);
        for o in &self.orders {
            key(hash, o.key);
            for v in [o.id, o.person, o.queue_position] {
                hash.write_u64(v as u64);
            }
        }
        hash.write_u64(self.tasks.len() as u64);
        for t in &self.tasks {
            key(hash, t.key);
            for v in [
                t.person as u64,
                t.cursor as u64,
                t.endpoint.map_or(u64::MAX, u64::from),
                t.remaining as u64,
                u64::from(t.directed),
                u64::from(t.suspended),
                t.started_day,
                t.completed_units as u64,
            ] {
                hash.write_u64(v);
            }
            hash.write_u64(t.cells.len() as u64);
            for cell in &t.cells {
                hash.write_u64(*cell as u64);
            }
        }
        hash.write_u64(self.assignments.len() as u64);
        for a in &self.assignments {
            key(hash, a.key);
            hash.write_u64(a.owner as u64);
            hash.write_u64(a.week);
        }
        hash.write_u64(self.episodes.len() as u64);
        for e in &self.episodes {
            key(hash, e.key);
            for v in [
                e.id as u64,
                e.owner as u64,
                e.day,
                e.decision.map_or(2, u64::from),
                e.outcome as u64,
                e.performer.map_or(u64::MAX, u64::from),
                e.completed_at.unwrap_or(u64::MAX),
                u64::from(e.settled),
                u64::from(e.needed),
                u64::from(e.unavailable),
            ] {
                hash.write_u64(v);
            }
        }
        hash.write_u64(self.traffic.len() as u64);
        for (person, tile) in &self.traffic {
            hash.write_u64(*person as u64);
            hash.write_u64(*tile as u64);
        }
        hash.write_u64(self.feelings.len() as u64);
        for f in &self.feelings {
            for v in [
                f.person as u64,
                f.kind as u64,
                f.score as i64 as u64,
                f.expires,
            ] {
                hash.write_u64(v);
            }
        }
        hash.write_u64(u64::from(self.rng.is_some()));
        if let Some(rng) = &self.rng {
            rng.hash_into(hash);
        }
    }
}
