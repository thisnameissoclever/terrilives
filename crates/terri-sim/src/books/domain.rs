//! Pure book operations. No command queues, movement, RNG draws, or need writes.

use bevy_ecs::prelude::Resource;
use std::collections::BTreeSet;
use terri_core::books::{
    BookCopy, BookCopyId, BookLocation, BookPurchaseQuote, BookSaleQuote, BookShelfId,
    SavedBookLibrary, ShelfSlot, TitleMemory,
};
use terri_core::{Funds, SimId};
use terri_data::{BookDefinition, ReadingTuning};

pub const MIGRATION_STARTER_TITLES: [&str; 5] = [
    "the_locked_laundry",
    "a_second_cup",
    "the_quiet_moon",
    "the_minor_dragon",
    "the_winter_of_three_mayors",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShelfCapacity {
    pub id: BookShelfId,
    pub slots: u16,
}

/// Historical people remain known after death; only living people may hold claims.
pub struct BookWorld<'a> {
    pub books: &'a [BookDefinition],
    pub tuning: &'a ReadingTuning,
    pub shelves: &'a [ShelfCapacity],
    pub known_sims: &'a [SimId],
    pub living_sims: &'a [SimId],
    pub lot_width: u32,
    pub lot_height: u32,
    pub now: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BookError {
    UnknownTitle(String),
    UnknownCopy(BookCopyId),
    UnknownShelf(BookShelfId),
    UnknownSim(SimId),
    ShelfFull(BookShelfId),
    InsufficientFunds,
    CopyIdsExhausted,
    Borrowed(BookCopyId),
    AlreadyBorrowing(SimId),
    NotBorrower,
    NotReadable,
    NoShelfSpace,
    NoSaleCopy,
    StaleQuote,
    InvalidState(&'static str),
}

impl std::fmt::Display for BookError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for BookError {}

impl BookError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnknownTitle(_) => "unknown_title",
            Self::UnknownCopy(_) => "unknown_copy",
            Self::UnknownShelf(_) => "unknown_shelf",
            Self::UnknownSim(_) => "unknown_person",
            Self::ShelfFull(_) => "shelf_full",
            Self::InsufficientFunds => "insufficient_funds",
            Self::CopyIdsExhausted => "copy_ids_exhausted",
            Self::Borrowed(_) => "borrowed",
            Self::AlreadyBorrowing(_) => "already_borrowing",
            Self::NotBorrower => "not_borrower",
            Self::NotReadable => "not_readable",
            Self::NoShelfSpace => "no_shelf_space",
            Self::NoSaleCopy => "no_sale_copy",
            Self::StaleQuote => "stale_quote",
            Self::InvalidState(_) => "invalid_state",
        }
    }
}

mod commerce;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReadingWork {
    pub consumed_ticks: u32,
    pub consumed_work: f32,
    pub novelty: f32,
    /// Fraction of a fresh reference hour of work, before taste, seat effects or traits.
    pub reward_factor: f32,
    pub fun: f32,
    pub satisfaction: f32,
    pub completed: bool,
}

#[derive(Resource, Debug, Clone, PartialEq)]
pub struct BookLibrary {
    saved: SavedBookLibrary,
}

impl BookLibrary {
    pub fn new(taste_seed: u64) -> Self {
        Self {
            saved: SavedBookLibrary {
                next_copy_id: 0,
                migration_granted: false,
                taste_seed,
                copies: Vec::new(),
                memories: Vec::new(),
            },
        }
    }

    pub fn state(&self) -> &SavedBookLibrary {
        &self.saved
    }

    pub fn from_saved(saved: SavedBookLibrary, world: &BookWorld<'_>) -> Result<Self, BookError> {
        validate_saved(&saved, world)?;
        Ok(Self { saved })
    }

    pub fn copy(&self, id: BookCopyId) -> Option<&BookCopy> {
        self.saved.copies.iter().find(|copy| copy.id == id)
    }

    pub fn memory(&self, person: SimId, title: &str) -> Option<&TitleMemory> {
        self.saved
            .memories
            .iter()
            .find(|memory| memory.sim_id == person && memory.title_id == title)
    }
}

impl BookWorld<'_> {
    fn title(&self, id: &str) -> Result<&BookDefinition, BookError> {
        self.books
            .iter()
            .find(|book| book.id == id)
            .ok_or_else(|| BookError::UnknownTitle(id.into()))
    }

    fn capacity(&self, shelf: BookShelfId) -> Result<u16, BookError> {
        self.shelves
            .iter()
            .find(|row| row.id == shelf)
            .map(|row| row.slots)
            .ok_or(BookError::UnknownShelf(shelf))
    }

    fn living(&self, person: SimId) -> Result<(), BookError> {
        if self.living_sims.contains(&person) {
            Ok(())
        } else {
            Err(BookError::UnknownSim(person))
        }
    }

    fn position_valid(&self, x: f32, y: f32) -> bool {
        x.is_finite()
            && y.is_finite()
            && x >= 0.0
            && y >= 0.0
            && x < self.lot_width as f32
            && y < self.lot_height as f32
    }
}

/// Validate a candidate without touching the current world or library.
pub fn validate_saved(saved: &SavedBookLibrary, world: &BookWorld<'_>) -> Result<(), BookError> {
    let invalid = BookError::InvalidState;
    terri_data::books::validate_reading(world.tuning)
        .map_err(|_| invalid("invalid reading tuning"))?;
    let mut shelves = BTreeSet::new();
    if world
        .shelves
        .iter()
        .any(|shelf| shelf.slots == 0 || !shelves.insert(shelf.id))
    {
        return Err(invalid(
            "shelf identities must be unique with positive capacity",
        ));
    }
    let known: BTreeSet<_> = world.known_sims.iter().copied().collect();
    let living: BTreeSet<_> = world.living_sims.iter().copied().collect();
    if known.len() != world.known_sims.len()
        || living.len() != world.living_sims.len()
        || !living.is_subset(&known)
    {
        return Err(invalid("invalid person identities"));
    }
    let mut titles = BTreeSet::new();
    if world
        .books
        .iter()
        .any(|book| book.reading_minutes == 0 || book.price == 0 || !titles.insert(&book.id))
    {
        return Err(invalid("invalid title catalogue"));
    }
    let mut ids = BTreeSet::new();
    let mut homes = BTreeSet::new();
    let mut borrowers = BTreeSet::new();
    for copy in &saved.copies {
        if !ids.insert(copy.id) || copy.id.0 >= saved.next_copy_id {
            return Err(invalid("duplicate or unissued copy identity"));
        }
        world.title(&copy.title_id)?;
        if let Some(home) = copy.home {
            if home.slot >= world.capacity(home.shelf)? || !homes.insert(home) {
                return Err(invalid("duplicate or out-of-range home slot"));
            }
        }
        if let Some(person) = copy.borrower {
            world.living(person)?;
            if copy.home.is_none() {
                return Err(invalid("borrowed copy has no reserved home"));
            }
            if !borrowers.insert(person) {
                return Err(invalid("person has multiple borrowed copies"));
            }
        }
        match copy.location {
            BookLocation::Inventory if copy.home.is_some() || copy.borrower.is_some() => {
                return Err(invalid("inventory copy has a home or borrower"))
            }
            BookLocation::Shelf(slot) if copy.home != Some(slot) => {
                return Err(invalid("shelved copy differs from its home"))
            }
            BookLocation::Carried(person) if copy.borrower != Some(person) => {
                return Err(invalid("carried copy differs from its borrower"))
            }
            BookLocation::Lot { x, y } if !world.position_valid(x, y) => {
                return Err(invalid("recoverable copy is outside the lot"))
            }
            _ => (),
        }
    }
    let mut memories = BTreeSet::new();
    for memory in &saved.memories {
        let book = world.title(&memory.title_id)?;
        if !known.contains(&memory.sim_id) {
            return Err(BookError::UnknownSim(memory.sim_id));
        }
        if !memories.insert((memory.sim_id, &memory.title_id)) {
            return Err(invalid("duplicate person/title memory"));
        }
        validate_memory(memory, book, world)?;
    }
    Ok(())
}

fn validate_memory(
    memory: &TitleMemory,
    book: &BookDefinition,
    world: &BookWorld<'_>,
) -> Result<(), BookError> {
    if !memory.familiarity.is_finite()
        || !(0.0..=1.0).contains(&memory.familiarity)
        || !memory.progress_fraction.is_finite()
        || !(0.0..1.0).contains(&memory.progress_fraction)
        || memory.progress_ticks >= book.reading_minutes
        || memory.last_read_tick > world.now
        || (memory.progress_ticks == 0 && memory.progress_fraction == 0.0)
            != memory.pass_novelty.is_none()
        || (memory.progress_ticks == 0
            && memory.progress_fraction == 0.0
            && memory.completed_passes == 0)
        || memory.pass_novelty.is_some_and(|value| {
            !value.is_finite() || !(world.tuning.reread_floor..=1.0).contains(&value)
        })
    {
        return Err(BookError::InvalidState(
            "invalid progress, novelty, familiarity, or reading time",
        ));
    }
    Ok(())
}

impl BookLibrary {
    fn index(&self, id: BookCopyId) -> Result<usize, BookError> {
        self.saved
            .copies
            .iter()
            .position(|copy| copy.id == id)
            .ok_or(BookError::UnknownCopy(id))
    }

    fn free_slot(
        &self,
        shelf: BookShelfId,
        capacity: u16,
        excluding: Option<BookCopyId>,
    ) -> Option<ShelfSlot> {
        (0..capacity)
            .map(|slot| ShelfSlot { shelf, slot })
            .find(|slot| {
                !self
                    .saved
                    .copies
                    .iter()
                    .any(|copy| Some(copy.id) != excluding && copy.home == Some(*slot))
            })
    }

    fn add_copy(&mut self, title: &str, home: Option<ShelfSlot>) -> BookCopyId {
        let id = BookCopyId(self.saved.next_copy_id);
        self.saved.next_copy_id += 1;
        self.saved.copies.push(BookCopy {
            id,
            title_id: title.into(),
            location: home.map_or(BookLocation::Inventory, BookLocation::Shelf),
            home,
            borrower: None,
        });
        id
    }

    /// A missing target means inventory; an invalid target is a refused purchase.
    pub fn purchase(
        &mut self,
        title: &str,
        target: Option<BookShelfId>,
        funds: &mut Funds,
        world: &BookWorld<'_>,
    ) -> Result<BookCopyId, BookError> {
        validate_saved(&self.saved, world)?;
        let price = i64::from(world.title(title)?.price);
        let home = target
            .map(|shelf| {
                world
                    .capacity(shelf)
                    .map(|capacity| self.free_slot(shelf, capacity, None))
            })
            .transpose()?
            .flatten();
        if funds.0 < price {
            return Err(BookError::InsufficientFunds);
        }
        if self.saved.next_copy_id == u32::MAX {
            return Err(BookError::CopyIdsExhausted);
        }
        let id = self.add_copy(title, home);
        funds.0 -= price;
        Ok(id)
    }

    /// The save migrator calls this only when the old save has no book state.
    pub fn grant_migration_starters(
        &mut self,
        world: &BookWorld<'_>,
    ) -> Result<Vec<BookCopyId>, BookError> {
        validate_saved(&self.saved, world)?;
        if self.saved.migration_granted {
            return Ok(Vec::new());
        }
        for title in MIGRATION_STARTER_TITLES {
            world.title(title)?;
        }
        self.saved
            .next_copy_id
            .checked_add(5)
            .ok_or(BookError::CopyIdsExhausted)?;
        let mut ids = Vec::with_capacity(5);
        for title in MIGRATION_STARTER_TITLES {
            let home = self.automatic_home(BookCopyId(self.saved.next_copy_id), world);
            ids.push(self.add_copy(title, home));
        }
        self.saved.migration_granted = true;
        Ok(ids)
    }

    /// Visible shelf contents omit borrowed copies after pickup.
    pub fn shelf_slots(&self, shelf: BookShelfId, capacity: u16) -> Vec<Option<BookCopyId>> {
        let mut slots = vec![None; usize::from(capacity)];
        for copy in &self.saved.copies {
            if let BookLocation::Shelf(home) = copy.location {
                if home.shelf == shelf && home.slot < capacity {
                    slots[usize::from(home.slot)] = Some(copy.id);
                }
            }
        }
        slots
    }

    /// Reserved home slots include books carried by readers or awaiting recovery.
    pub fn reserved_slots(&self, shelf: BookShelfId, capacity: u16) -> Vec<Option<BookCopyId>> {
        let mut slots = vec![None; usize::from(capacity)];
        for copy in &self.saved.copies {
            if let Some(home) = copy.home {
                if home.shelf == shelf && home.slot < capacity {
                    slots[usize::from(home.slot)] = Some(copy.id);
                }
            }
        }
        slots
    }

    pub fn transfer(
        &mut self,
        id: BookCopyId,
        target: Option<BookShelfId>,
        world: &BookWorld<'_>,
    ) -> Result<(), BookError> {
        validate_saved(&self.saved, world)?;
        let index = self.index(id)?;
        if self.saved.copies[index].borrower.is_some() {
            return Err(BookError::Borrowed(id));
        }
        let home = target
            .map(|shelf| {
                let capacity = world.capacity(shelf)?;
                self.free_slot(shelf, capacity, Some(id))
                    .ok_or(BookError::ShelfFull(shelf))
            })
            .transpose()?;
        let copy = &mut self.saved.copies[index];
        copy.home = home;
        copy.location = home.map_or(BookLocation::Inventory, BookLocation::Shelf);
        Ok(())
    }

    pub fn reserve(
        &mut self,
        id: BookCopyId,
        person: SimId,
        world: &BookWorld<'_>,
    ) -> Result<(), BookError> {
        validate_saved(&self.saved, world)?;
        world.living(person)?;
        let index = self.index(id)?;
        if self.saved.copies[index].borrower.is_some() {
            return Err(BookError::Borrowed(id));
        }
        if self
            .saved
            .copies
            .iter()
            .any(|copy| copy.borrower == Some(person))
        {
            return Err(BookError::AlreadyBorrowing(person));
        }
        if self.saved.copies[index].home.is_none()
            || !matches!(
                self.saved.copies[index].location,
                BookLocation::Shelf(_) | BookLocation::Lot { .. }
            )
        {
            return Err(BookError::NotReadable);
        }
        self.saved.copies[index].borrower = Some(person);
        Ok(())
    }

    pub fn pick_up(
        &mut self,
        id: BookCopyId,
        person: SimId,
        world: &BookWorld<'_>,
    ) -> Result<(), BookError> {
        validate_saved(&self.saved, world)?;
        let index = self.index(id)?;
        let copy = &mut self.saved.copies[index];
        if copy.borrower != Some(person) {
            return Err(BookError::NotBorrower);
        }
        if !matches!(
            copy.location,
            BookLocation::Shelf(_) | BookLocation::Lot { .. }
        ) {
            return Err(BookError::NotReadable);
        }
        copy.location = BookLocation::Carried(person);
        Ok(())
    }

    /// Cancels a reservation before pickup. Carried books must complete a return.
    pub fn release_reservation(
        &mut self,
        id: BookCopyId,
        person: SimId,
        world: &BookWorld<'_>,
    ) -> Result<(), BookError> {
        validate_saved(&self.saved, world)?;
        let index = self.index(id)?;
        let copy = &mut self.saved.copies[index];
        if copy.borrower != Some(person) {
            return Err(BookError::NotBorrower);
        }
        if matches!(copy.location, BookLocation::Carried(_)) {
            return Err(BookError::Borrowed(id));
        }
        copy.borrower = None;
        Ok(())
    }

    /// Called only when runtime travel reaches the reserved home.
    pub fn return_copy(
        &mut self,
        id: BookCopyId,
        person: SimId,
        world: &BookWorld<'_>,
    ) -> Result<(), BookError> {
        validate_saved(&self.saved, world)?;
        let index = self.index(id)?;
        let copy = &mut self.saved.copies[index];
        if copy.borrower != Some(person) {
            return Err(BookError::NotBorrower);
        }
        if copy.location != BookLocation::Carried(person) {
            return Err(BookError::NotReadable);
        }
        let home = copy.home.ok_or(BookError::InvalidState(
            "borrowed copy has no reserved home",
        ))?;
        copy.location = BookLocation::Shelf(home);
        copy.borrower = None;
        Ok(())
    }

    pub fn remove_copy(
        &mut self,
        id: BookCopyId,
        world: &BookWorld<'_>,
    ) -> Result<BookCopy, BookError> {
        validate_saved(&self.saved, world)?;
        let index = self.index(id)?;
        if self.saved.copies[index].borrower.is_some() {
            return Err(BookError::Borrowed(id));
        }
        Ok(self.saved.copies.remove(index))
    }

    /// Move a bookcase's contents to inventory before removing its furniture identity.
    pub fn evacuate_shelf(
        &mut self,
        shelf: BookShelfId,
        world: &BookWorld<'_>,
    ) -> Result<(), BookError> {
        validate_saved(&self.saved, world)?;
        world.capacity(shelf)?;
        let belongs = |copy: &BookCopy| copy.home.is_some_and(|home| home.shelf == shelf);
        if let Some(copy) = self
            .saved
            .copies
            .iter()
            .find(|copy| belongs(copy) && copy.borrower.is_some())
        {
            return Err(BookError::Borrowed(copy.id));
        }
        for copy in self.saved.copies.iter_mut().filter(|copy| belongs(copy)) {
            copy.home = None;
            copy.location = BookLocation::Inventory;
        }
        Ok(())
    }

    /// Release claims even when the person has already left the living roster.
    pub fn recover_on_death(
        &mut self,
        person: SimId,
        position: (f32, f32),
        world: &BookWorld<'_>,
    ) -> Result<(), BookError> {
        if !world.known_sims.contains(&person) {
            return Err(BookError::UnknownSim(person));
        }
        if !world.position_valid(position.0, position.1) {
            return Err(BookError::InvalidState(
                "recovery position is outside the lot",
            ));
        }
        let mut candidate = self.saved.clone();
        for copy in candidate
            .copies
            .iter_mut()
            .filter(|copy| copy.borrower == Some(person))
        {
            if copy.location == BookLocation::Carried(person) {
                copy.location = BookLocation::Lot {
                    x: position.0,
                    y: position.1,
                };
            }
            copy.borrower = None;
        }
        validate_saved(&candidate, world)?;
        self.saved = candidate;
        Ok(())
    }

    /// Browsing is a pure query, independent of the simulation random stream.
    /// Title and memory lookups are linear in their own lists. Only this request
    /// is validated; restoration and writes validate the complete library.
    pub fn estimate_interest(
        &self,
        person: SimId,
        title: &str,
        world: &BookWorld<'_>,
    ) -> Result<f32, BookError> {
        terri_data::books::validate_reading(world.tuning)
            .map_err(|_| BookError::InvalidState("invalid reading tuning"))?;
        world.living(person)?;
        if !world.known_sims.contains(&person) {
            return Err(BookError::UnknownSim(person));
        }
        let book = world.title(title)?;
        if book.reading_minutes == 0 || book.price == 0 {
            return Err(BookError::InvalidState("invalid title catalogue"));
        }
        let memory = self.memory(person, title);
        if let Some(memory) = memory {
            validate_memory(memory, book, world)?;
        }
        Ok(
            title_affinity(self.saved.taste_seed, person, &book.genre, title)
                * novelty(memory, world),
        )
    }

    /// Consume actual work, bounded by the title's remaining work. Runtime owns the elapsed session cap.
    /// Rewards use the fixed reference hour before taste, seat effects and traits.
    pub fn read_work(
        &mut self,
        id: BookCopyId,
        person: SimId,
        requested_ticks: u32,
        world: &BookWorld<'_>,
    ) -> Result<ReadingWork, BookError> {
        self.read_fractional_work(id, person, requested_ticks as f32, world)
    }

    pub fn read_fractional_work(
        &mut self,
        id: BookCopyId,
        person: SimId,
        requested: f32,
        world: &BookWorld<'_>,
    ) -> Result<ReadingWork, BookError> {
        if !requested.is_finite() || requested < 0.0 {
            return Err(BookError::InvalidState("invalid reading work"));
        }
        validate_saved(&self.saved, world)?;
        let copy = &self.saved.copies[self.index(id)?];
        if copy.borrower != Some(person) {
            return Err(BookError::NotBorrower);
        }
        if copy.location != BookLocation::Carried(person) {
            return Err(BookError::NotReadable);
        }
        let book = world.title(&copy.title_id)?;
        let previous = self.memory(person, &book.id);
        let progress = previous.map_or(0.0, |memory| {
            memory.progress_ticks as f32 + memory.progress_fraction
        });
        let captured_novelty = novelty(previous, world);
        let consumed = requested.min(book.reading_minutes as f32 - progress);
        let completed = consumed > 0.0 && progress + consumed >= book.reading_minutes as f32;
        let reward_factor =
            consumed / terri_data::books::READING_REFERENCE_TICKS * captured_novelty;
        let result = ReadingWork {
            consumed_ticks: consumed as u32,
            consumed_work: consumed,
            novelty: captured_novelty,
            reward_factor,
            fun: world.tuning.fun_per_session * reward_factor,
            satisfaction: world.tuning.satisfaction_per_session * reward_factor,
            completed,
        };
        if consumed == 0.0 {
            return Ok(result);
        }
        let mut memory = previous.cloned().unwrap_or(TitleMemory {
            sim_id: person,
            title_id: book.id.clone(),
            progress_ticks: 0,
            progress_fraction: 0.0,
            pass_novelty: None,
            familiarity: 0.0,
            last_read_tick: world.now,
            completed_passes: 0,
        });
        memory.familiarity =
            (decayed_familiarity(&memory, world) + consumed / book.reading_minutes as f32).min(1.0);
        memory.last_read_tick = world.now;
        if completed {
            memory.completed_passes = memory
                .completed_passes
                .checked_add(1)
                .ok_or(BookError::InvalidState("completed-pass count exhausted"))?;
            memory.progress_ticks = 0;
            memory.progress_fraction = 0.0;
            memory.pass_novelty = None;
            memory.familiarity = 1.0;
        } else {
            memory.progress_ticks = (progress + consumed) as u32;
            memory.progress_fraction = progress + consumed - memory.progress_ticks as f32;
            memory.pass_novelty = Some(captured_novelty);
        }
        if let Some(index) = self
            .saved
            .memories
            .iter()
            .position(|row| row.sim_id == person && row.title_id == book.id)
        {
            self.saved.memories[index] = memory;
        } else {
            self.saved.memories.push(memory);
        }
        Ok(result)
    }
}

fn decayed_familiarity(memory: &TitleMemory, world: &BookWorld<'_>) -> f32 {
    let elapsed = world.now.saturating_sub(memory.last_read_tick);
    (f64::from(memory.familiarity) - elapsed as f64 / world.tuning.recovery_ticks as f64).max(0.0)
        as f32
}

fn novelty(memory: Option<&TitleMemory>, world: &BookWorld<'_>) -> f32 {
    memory.map_or(1.0, |memory| {
        memory.pass_novelty.unwrap_or_else(|| {
            // Interpolate from the floor to avoid rounding an immediate reread below it.
            world.tuning.reread_floor
                + (1.0 - world.tuning.reread_floor) * (1.0 - decayed_familiarity(memory, world))
        })
    })
}

/// Fixed FNV-1a domains and length-prefixed IDs keep old tastes stable as content grows.
pub fn title_affinity(seed: u64, person: SimId, genre: &str, title: &str) -> f32 {
    fn unit(seed: u64, person: SimId, parts: &[&str]) -> f32 {
        let mut hash = 0xcbf29ce484222325u64;
        for byte in seed.to_le_bytes().into_iter().chain(person.0.to_le_bytes()) {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
        }
        for part in parts {
            for byte in (part.len() as u64)
                .to_le_bytes()
                .into_iter()
                .chain(part.bytes())
            {
                hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
            }
        }
        (hash >> 40) as f32 / 16_777_215.0
    }
    let genre_preference = 0.65 + 0.7 * unit(seed, person, &["book_genre_v1", genre]);
    let title_variation = 0.85 + 0.3 * unit(seed, person, &["book_title_v1", genre, title]);
    genre_preference * title_variation
}
