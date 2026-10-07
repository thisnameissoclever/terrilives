//! Matched catalogue scenarios use real migration and purchase commands.
use terri_core::{command::BookCommand, CommandQueue, SimCommand, SmartObject};
use terri_sim::{Content, LegacySnapshot, Sim};

pub fn prepare(sim: &mut Sim, seed: u64, scenario: &str) {
    match scenario {
        "new" => (),
        "migrated" => {
            let old = Sim::new_household_with_content(Content::pre_books(), seed);
            sim.load_legacy_snapshot(LegacySnapshot::V5(Box::new(old.save_snapshot_v5())))
                .expect("published household migrates");
        }
        "purchased" => {
            let pack = terri_data::pack();
            let budget: i64 = terri_sim::books::MIGRATION_STARTER_TITLES
                .iter()
                .chain(terri_sim::books::MIGRATION_STARTER_TITLES[..2].iter())
                .map(|id| i64::from(pack.books.iter().find(|book| book.id == *id).unwrap().price))
                .sum();
            let mut earning_ticks = 0;
            while sim.funds() < budget && earning_ticks < 12_000 {
                sim.tick();
                earning_ticks += 1;
            }
            assert!(
                sim.funds() >= budget,
                "household did not earn the book budget"
            );
            println!("PURCHASE WARMUP {earning_ticks} ticks of ordinary play; earned Funds {}; book budget {budget}; no grants or sales", sim.funds());
            let shelf = sim
                .world_mut()
                .query::<(terri_core::Entity, &SmartObject)>()
                .iter(sim.world())
                .find(|(_, object)| pack.object(object.0).shelf_capacity > 0)
                .map(|(entity, _)| entity.index_u32())
                .expect("household bookcase");
            let before = sim.funds();
            for (index, title) in terri_sim::books::MIGRATION_STARTER_TITLES
                .iter()
                .chain(terri_sim::books::MIGRATION_STARTER_TITLES[..2].iter())
                .enumerate()
            {
                sim.world_mut()
                    .resource_mut::<CommandQueue>()
                    .push(SimCommand::Book(BookCommand::Purchase {
                        title: (*title).into(),
                        shelf: (index != 6).then_some(shelf),
                    }));
                sim.flush_commands();
                assert!(sim
                    .world()
                    .resource::<terri_sim::books::BookFeedback>()
                    .results
                    .last()
                    .unwrap()
                    .refusal
                    .is_none());
            }
            println!("BOOK PURCHASES spent {} for five titles, one shelved duplicate and one inventory duplicate", before - sim.funds());
        }
        other => panic!("unknown catalogue scenario {other}; use new, migrated or purchased"),
    }
    if scenario == "purchased" {
        let affordable: Vec<_> = terri_data::pack()
            .catalogue()
            .filter(|(_, _, price)| i64::from(*price) <= sim.funds())
            .map(|(_, model, price)| (model.id.as_str(), price))
            .collect();
        println!(
            "AFFORDABLE FURNISHING CHOICES after books: {affordable:?}; Funds {}",
            sim.funds()
        );
    }
    let saved = sim.save_snapshot_v6();
    println!(
        "CATALOGUE scenario {scenario}; initial Funds {}; owned copies {}; titles {}",
        sim.funds(),
        saved.books.copies.len(),
        saved
            .books
            .copies
            .iter()
            .map(|c| &c.title_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
    );
}

/// Export resolved values through the same model helpers used by the store.
pub fn print_catalogue(sim: &Sim) {
    let pack = terri_data::pack();
    for (_, model, price) in pack.catalogue() {
        println!(
            "MODEL {} | {} | {} | {} | {}x{} | metadata {:?} | description {:?}",
            model.id,
            model.display_name(),
            model.name,
            price,
            model.footprint.width,
            model.footprint.depth,
            model.metadata,
            model.presentation
        );
        for action in &model.interactions {
            println!("ACTION {}.{} | {} | capacity {:?} | minutes {} | needs {:?} | satisfaction points {} | reading {:?} | recipe {:?}", model.id, action.id, action.label, sim.model_action_capacity(&model.id, &action.id), action.duration_ticks, action.advertises, action.satisfaction * terri_core::Satisfaction::REWARD_SCALE, sim.reading_model_benefits(&model.id, &action.id), sim.model_interaction_chain(&model.id, &action.id));
        }
    }
    for book in &pack.books {
        println!("TITLE {book:?}");
    }
}

#[derive(Default)]
pub struct Summary {
    reading_ticks: u64,
    queued_orders: u64,
    walking_ticks: u64,
    previous: Option<terri_core::SaveSnapshotV6>,
    food: std::collections::BTreeMap<String, (u64, f64)>,
    food_started: std::collections::BTreeMap<String, u64>,
    critical_need_ticks: [u64; 7],
}
impl Summary {
    pub fn new(sim: &Sim) -> Self {
        Self {
            previous: Some(sim.save_snapshot_v6()),
            ..Default::default()
        }
    }
    pub fn observe(&mut self, sim: &mut Sim) -> std::collections::BTreeSet<u32> {
        let snapshot = sim.save_snapshot_v6();
        let readers: std::collections::BTreeSet<_> =
            snapshot.reading.iter().map(|r| r.owner).collect();
        if let Some(before) = &self.previous {
            let pack = sim.world().resource::<Content>().0;
            for entity in &snapshot.legacy.world.entities {
                if entity.agent {
                    if let Some(needs) = entity.needs {
                        for (i, level) in needs.iter().enumerate() {
                            self.critical_need_ticks[i] +=
                                u64::from(*level <= pack.tuning.mood_critical_need_level);
                        }
                    }
                }
                if let Some(chain) = &entity.chain {
                    if matches!(
                        chain.chain.as_str(),
                        "cook_dinner" | "prepare_snack" | "eat_shared_meal"
                    ) && before
                        .legacy
                        .world
                        .entities
                        .iter()
                        .find(|e| e.index == entity.index)
                        .and_then(|e| e.chain.as_ref())
                        .is_none_or(|prior| prior.chain != chain.chain)
                    {
                        *self.food_started.entry(chain.chain.clone()).or_default() += 1;
                    }
                }
            }
            for person in &before.legacy.world.entities {
                let Some(chain) = &person.chain else { continue };
                if !matches!(
                    chain.chain.as_str(),
                    "cook_dinner" | "prepare_snack" | "eat_shared_meal"
                ) {
                    continue;
                }
                let Some(after) = snapshot
                    .legacy
                    .world
                    .entities
                    .iter()
                    .find(|e| e.index == person.index)
                else {
                    continue;
                };
                let final_step = pack
                    .chains
                    .iter()
                    .find(|c| c.id == chain.chain)
                    .unwrap()
                    .steps
                    .len() as u32
                    - 1;
                if super::catalogue_meals::terminal_delivery(
                    person,
                    after,
                    &chain.chain,
                    final_step,
                    true,
                    false,
                ) {
                    assert!(person.at_work_ticks.is_none() && person.eating.is_none());
                    let drain = pack.decay_per_tick[0]
                        * person.personality.as_ref().map_or(1.0, |p| p.drain[0]);
                    let gain =
                        after.needs.unwrap()[0] - (person.needs.unwrap()[0] - drain).max(0.0);
                    if gain > 0.01 {
                        let row = self.food.entry(chain.chain.clone()).or_default();
                        row.0 += 1;
                        row.1 += f64::from(gain);
                    }
                }
            }
        }
        self.previous = Some(snapshot);
        let world = sim.world_mut();
        self.reading_ticks += readers.len() as u64;
        self.queued_orders += world
            .query::<&terri_core::IntentQueue>()
            .iter(world)
            .map(|q| q.entries().len() as u64)
            .sum::<u64>();
        self.walking_ticks += world.query::<&terri_core::Path>().iter(world).count() as u64;
        readers
    }
    pub fn print(&self, sim: &Sim) {
        let saved = sim.save_snapshot_v6();
        println!("FOOD recipe starts: {:?}", self.food_started);
        println!(
            "CRITICAL need person-ticks [Hunger,Energy,Hygiene,Bladder,Social,Fun,Comfort]: {:?}",
            self.critical_need_ticks
        );
        println!(
            "FOOD positive terminal Hunger deliveries (count, actual clamped gain): {:?}",
            self.food
        );
        println!("CATALOGUE reading journey person-ticks {}; all walking person-ticks {}; queued order-ticks {}", self.reading_ticks, self.walking_ticks, self.queued_orders);
        for memory in &saved.books.memories {
            println!(
                "BOOK Sim {} title {} progress {}+{:.3} familiarity {:.5} completed {}",
                memory.sim_id.0,
                memory.title_id,
                memory.progress_ticks,
                memory.progress_fraction,
                memory.familiarity,
                memory.completed_passes
            );
        }
        println!(
            "CATALOGUE final copies {} memories {}",
            saved.books.copies.len(),
            saved.books.memories.len()
        );
    }
}
