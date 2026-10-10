use super::*;

const TITLE_DOMAIN: u64 = 0x626f6f6b7469746c;
const SHELF_DOMAIN: u64 = 0x626f6f6b7368656c;
const SLOT_DOMAIN: u64 = 0x626f6f6b736c6f74;

/// Fixed integer mixing keeps previews reproducible without a random-state write.
fn mix(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
    value ^ (value >> 31)
}

impl BookLibrary {
    pub fn reading_priority(
        &self,
        person: SimId,
        title: &str,
        world: &BookWorld<'_>,
    ) -> Result<(u8, u64, f32), BookError> {
        let book = world.title(title)?;
        let Some(memory) = self.memory(person, title) else {
            return Ok((1, 0, 0.0));
        };
        validate_memory(memory, book, world)?;
        if memory.progress_ticks > 0 || memory.progress_fraction > 0.0 {
            Ok((0, u64::MAX - memory.last_read_tick, 0.0))
        } else if memory.completed_passes == 0 {
            Ok((1, 0, 0.0))
        } else {
            Ok((2, memory.last_read_tick, 1.0 - novelty(Some(memory), world)))
        }
    }
    /// Validate request identities and prices; execution can still refuse stale eligibility.
    pub fn validate_commerce_command(
        &self,
        command: &terri_core::command::BookCommand,
        world: &BookWorld<'_>,
        fraction: f32,
    ) -> Result<(), BookError> {
        use terri_core::command::BookCommand;
        match command {
            BookCommand::AutoPurchase { quote } => {
                let title = world.title(&quote.title)?;
                if quote.price != title.price
                    || quote.next_copy_id == u32::MAX
                    || quote.home.slot >= world.capacity(quote.home.shelf)?
                {
                    return Err(BookError::InvalidState("invalid purchase quote"));
                }
            }
            BookCommand::Sell { quote } => {
                world.capacity(quote.shelf)?;
                let copy = self
                    .copy(quote.copy)
                    .ok_or(BookError::UnknownCopy(quote.copy))?;
                let price = crate::placement::sale::sale_value(
                    world.title(&copy.title_id)?.price,
                    fraction,
                );
                if quote.price != price {
                    return Err(BookError::InvalidState("invalid sale quote"));
                }
            }
            BookCommand::Recover { copy } => {
                self.copy(BookCopyId(*copy))
                    .ok_or(BookError::UnknownCopy(BookCopyId(*copy)))?;
            }
            _ => {}
        }
        Ok(())
    }
    fn choice(&self, copy: BookCopyId, domain: u64, length: usize) -> usize {
        (mix(self.saved.taste_seed ^ mix(u64::from(copy.0)) ^ domain) % length as u64) as usize
    }

    pub(super) fn automatic_home(
        &self,
        copy: BookCopyId,
        world: &BookWorld<'_>,
    ) -> Option<ShelfSlot> {
        let mut shelves: Vec<_> = world
            .shelves
            .iter()
            .filter_map(|shelf| {
                let used: BTreeSet<_> = self
                    .saved
                    .copies
                    .iter()
                    .filter_map(|book| {
                        book.home
                            .filter(|home| home.shelf == shelf.id)
                            .map(|home| home.slot)
                    })
                    .collect();
                let free: Vec<_> = (0..shelf.slots)
                    .filter(|slot| !used.contains(slot))
                    .collect();
                (!free.is_empty()).then_some((used.len(), shelf.id, free))
            })
            .collect();
        shelves.sort_by_key(|(count, id, _)| (*count, *id));
        let least = shelves.first()?.0;
        let tied = shelves.iter().take_while(|row| row.0 == least).count();
        let (_, shelf, slots) = &shelves[self.choice(copy, SHELF_DOMAIN, tied)];
        Some(ShelfSlot {
            shelf: *shelf,
            slot: slots[self.choice(copy, SLOT_DOMAIN ^ shelf.0, slots.len())],
        })
    }

    pub fn quote_purchase(
        &self,
        funds: Funds,
        world: &BookWorld<'_>,
    ) -> Result<BookPurchaseQuote, BookError> {
        validate_saved(&self.saved, world)?;
        if self.saved.next_copy_id == u32::MAX {
            return Err(BookError::CopyIdsExhausted);
        }
        let copy = BookCopyId(self.saved.next_copy_id);
        let home = self
            .automatic_home(copy, world)
            .ok_or(BookError::NoShelfSpace)?;
        let (title, price) = self.purchase_selection(funds, world)?;
        Ok(BookPurchaseQuote {
            title,
            price,
            home,
            next_copy_id: copy.0,
        })
    }

    /// Pricing remains visible even when no shelf can accept the purchase.
    pub fn purchase_selection(
        &self,
        funds: Funds,
        world: &BookWorld<'_>,
    ) -> Result<(String, u32), BookError> {
        validate_saved(&self.saved, world)?;
        let copy = BookCopyId(self.saved.next_copy_id);
        let mut candidates: Vec<_> = world
            .books
            .iter()
            .filter(|title| {
                !self
                    .saved
                    .copies
                    .iter()
                    .any(|owned| owned.title_id == title.id)
            })
            .collect();
        if candidates.is_empty() {
            candidates.extend(world.books);
        }
        candidates.sort_by(|a, b| a.id.cmp(&b.id));
        if candidates.is_empty() {
            return Err(BookError::NotReadable);
        }
        let affordable: Vec<_> = candidates
            .iter()
            .copied()
            .filter(|title| i64::from(title.price) <= funds.0)
            .collect();
        let pool = if affordable.is_empty() {
            &candidates
        } else {
            &affordable
        };
        let title = pool[self.choice(copy, TITLE_DOMAIN, pool.len())];
        Ok((title.id.clone(), title.price))
    }

    pub fn purchase_quoted(
        &mut self,
        quote: &BookPurchaseQuote,
        funds: &mut Funds,
        world: &BookWorld<'_>,
    ) -> Result<BookCopyId, BookError> {
        if self.quote_purchase(*funds, world)? != *quote {
            return Err(BookError::StaleQuote);
        }
        if funds.0 < i64::from(quote.price) {
            return Err(BookError::InsufficientFunds);
        }
        let id = self.add_copy(&quote.title, Some(quote.home));
        funds.0 -= i64::from(quote.price);
        Ok(id)
    }

    pub fn quote_sale(
        &self,
        shelf: BookShelfId,
        world: &BookWorld<'_>,
        resale_fraction: f32,
    ) -> Result<BookSaleQuote, BookError> {
        validate_saved(&self.saved, world)?;
        world.capacity(shelf)?;
        if !resale_fraction.is_finite() || !(0.0..=1.0).contains(&resale_fraction) {
            return Err(BookError::InvalidState("invalid resale fraction"));
        }
        let copy = self
            .saved
            .copies
            .iter()
            .filter(|copy| {
                copy.borrower.is_none()
                    && matches!(copy.location, BookLocation::Shelf(home) if home.shelf == shelf)
            })
            .min_by_key(|copy| {
                let duplicate = self
                    .saved
                    .copies
                    .iter()
                    .filter(|other| other.title_id == copy.title_id)
                    .count()
                    > 1;
                let unfinished = self.saved.memories.iter().any(|memory| {
                    memory.title_id == copy.title_id
                        && world.living_sims.contains(&memory.sim_id)
                        && (memory.progress_ticks > 0 || memory.progress_fraction > 0.0)
                });
                (!duplicate, unfinished, copy.id)
            })
            .ok_or(BookError::NoSaleCopy)?;
        let title = world.title(&copy.title_id)?;
        Ok(BookSaleQuote {
            copy: copy.id,
            shelf,
            price: crate::placement::sale::sale_value(title.price, resale_fraction),
        })
    }

    pub fn sell_quoted(
        &mut self,
        quote: &BookSaleQuote,
        funds: &mut Funds,
        world: &BookWorld<'_>,
        resale_fraction: f32,
    ) -> Result<BookCopyId, BookError> {
        if self.quote_sale(quote.shelf, world, resale_fraction)? != *quote {
            return Err(BookError::StaleQuote);
        }
        let balance = funds
            .0
            .checked_add(i64::from(quote.price))
            .ok_or(BookError::InvalidState("funds overflow"))?;
        self.remove_copy(quote.copy, world)?;
        funds.0 = balance;
        Ok(quote.copy)
    }

    pub fn shelve_inventory(
        &mut self,
        world: &BookWorld<'_>,
    ) -> Result<Vec<BookCopyId>, BookError> {
        validate_saved(&self.saved, world)?;
        let mut arrivals: Vec<_> = self
            .saved
            .copies
            .iter()
            .filter(|copy| copy.borrower.is_none() && copy.location == BookLocation::Inventory)
            .map(|copy| copy.id)
            .collect();
        arrivals.sort();
        let mut placed = Vec::new();
        for copy in arrivals {
            let Some(home) = self.automatic_home(copy, world) else {
                break;
            };
            let index = self.index(copy)?;
            self.saved.copies[index].home = Some(home);
            self.saved.copies[index].location = BookLocation::Shelf(home);
            placed.push(copy);
        }
        Ok(placed)
    }

    pub fn recover_automatically(
        &mut self,
        copy: BookCopyId,
        world: &BookWorld<'_>,
    ) -> Result<BookCopyId, BookError> {
        validate_saved(&self.saved, world)?;
        let index = self.index(copy)?;
        let book = &self.saved.copies[index];
        if book.borrower.is_some() {
            return Err(BookError::Borrowed(copy));
        }
        if !matches!(book.location, BookLocation::Lot { .. }) {
            return Err(BookError::NotReadable);
        }
        let home = book
            .home
            .or_else(|| self.automatic_home(copy, world))
            .ok_or(BookError::NoShelfSpace)?;
        self.saved.copies[index].home = Some(home);
        self.saved.copies[index].location = BookLocation::Shelf(home);
        Ok(copy)
    }

    pub fn grant_new_household_starters(
        &mut self,
        world: &BookWorld<'_>,
    ) -> Result<Vec<BookCopyId>, BookError> {
        validate_saved(&self.saved, world)?;
        if self.saved.next_copy_id != 0 || !self.saved.copies.is_empty() {
            return Err(BookError::InvalidState("starter library is not fresh"));
        }
        for title in &MIGRATION_STARTER_TITLES[..3] {
            world.title(title)?;
        }
        let mut copies = Vec::new();
        for title in &MIGRATION_STARTER_TITLES[..3] {
            let home = self.automatic_home(BookCopyId(self.saved.next_copy_id), world);
            copies.push(self.add_copy(title, home));
        }
        Ok(copies)
    }
}
