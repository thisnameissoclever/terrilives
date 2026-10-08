//! Read-only browser facts. Positional postcard tuples have native byte witnesses.
use super::*;

pub(super) type ModelActionRow = (
    String,
    String,
    u32,
    Option<u32>,
    bool,
    Vec<(u8, f32)>,
    f32,
    Vec<f32>,
    Vec<String>,
    String,
    Vec<String>,
    // Appended: free seats in view admit viewers beyond `capacity`, which
    // then counts standing viewers only.
    bool,
);
pub(super) type ModelFactRow = (
    u32,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    Vec<String>,
    u32,
    u32,
    u32,
    u32,
    u32,
    Vec<ModelActionRow>,
    Vec<String>,
);

#[wasm_bindgen]
impl SimHandle {
    #[wasm_bindgen(js_name = readingStatusOf)]
    pub fn reading_status_of(&self, entity: f64) -> String {
        placement_u32(entity)
            .and_then(|entity| self.sim.reading_status_of(entity))
            .unwrap_or_default()
    }
    /// All compiled models, including objects outside the priced catalogue.
    #[wasm_bindgen(js_name = modelMetadata)]
    pub fn model_metadata(&self) -> Vec<u8> {
        let pack = self.sim.world().resource::<terri_sim::Content>().0;
        let rows: Vec<ModelFactRow> = pack
            .objects
            .iter()
            .enumerate()
            .map(|(index, object)| {
                let metadata = object.metadata.as_ref();
                let mut actions: Vec<ModelActionRow> = object
                    .interactions
                    .iter()
                    .map(|action| {
                        let capacity = self.sim.model_action_capacity(&object.id, &action.id);
                        let mut benefits = self.sim.reading_model_benefits(&object.id, &action.id);
                        if let Some(satisfaction) = benefits.get_mut(2) {
                            *satisfaction *= terri_core::Satisfaction::REWARD_SCALE;
                        }
                        let program = self.sim.model_interaction_chain(&object.id, &action.id);
                        let mut optional_requirements = Vec::new();
                        let mut requirements = if action.book_reading {
                            vec!["Available shelved book".to_string()]
                        } else {
                            vec![]
                        };
                        if let Some(count) =
                            terri_sim::beds::all_seats_required(pack, object, action)
                        {
                            requirements.push(format!("All {count} seats"));
                        }
                        if let Some(program) = program {
                            let (required, optional) =
                                terri_sim::recipe_buying_requirements(pack, program);
                            requirements.extend(required);
                            optional_requirements = optional;
                            requirements.sort();
                            requirements.dedup();
                        }
                        if action.is_handwashing() {
                            optional_requirements.push(format!(
                                "Handwashing raises Hygiene only up to {}",
                                pack.tuning.need_interactions.handwashing_hygiene_ceiling
                            ));
                        }
                        if action.media.is_some() {
                            optional_requirements
                                .push("Social requires liked company using the same device".into());
                            optional_requirements
                                .push("Comfort depends on the seat actually used".into());
                        }
                        if action.shared_activity.is_some() {
                            optional_requirements.push(
                                "Social requires liked company sharing this activity nearby".into(),
                            );
                        }
                        if program.is_some()
                            && action.advertises.iter().any(|(n, d)| {
                                *n as usize == terri_core::NeedId::Social.index() && *d > 0.
                            })
                        {
                            optional_requirements.push(
                                "Social requires liked company seated at the meal table".into(),
                            );
                        }
                        (
                            action.id.clone(),
                            action.label.clone(),
                            action.duration_ticks,
                            capacity,
                            action.book_reading,
                            action.advertises.clone(),
                            action.satisfaction * terri_core::Satisfaction::REWARD_SCALE,
                            benefits,
                            requirements,
                            self.sim
                                .model_action_work_kind(&object.id, &action.id)
                                .to_string(),
                            optional_requirements,
                            action.media.is_some(),
                        )
                    })
                    .collect();
                for chain in self.sim.model_visible_chains(&object.id) {
                    let (requirements, optional_requirements) =
                        terri_sim::recipe_buying_requirements(pack, chain);
                    actions.push((
                        chain.id.clone(),
                        chain.label.clone(),
                        chain.steps.iter().map(|step| step.duration_ticks).sum(),
                        Some(1),
                        false,
                        chain.advertises.clone(),
                        chain.satisfaction * terri_core::Satisfaction::REWARD_SCALE,
                        vec![],
                        requirements,
                        if chain.id == "clean_dishes" {
                            "dish_cleanup"
                        } else {
                            "recipe"
                        }
                        .to_string(),
                        optional_requirements,
                        false,
                    ));
                }
                (
                    index as u32,
                    object.id.clone(),
                    object.display_name().to_string(),
                    object.name.clone(),
                    object
                        .presentation
                        .as_ref()
                        .map_or(String::new(), |p| p.description.clone()),
                    metadata.map_or(String::new(), |m| m.type_id.clone()),
                    metadata.map_or(String::new(), |m| m.category_id.clone()),
                    metadata.map_or(String::new(), |m| m.category_label.clone()),
                    metadata.map_or_else(Vec::new, |m| m.rooms.clone()),
                    object.footprint.width,
                    object.footprint.depth,
                    u32::from(object.shelf_capacity),
                    object.shelf_access.len() as u32,
                    pack.reading.map_or(0, |r| r.session_ticks),
                    actions,
                    object
                        .roles
                        .iter()
                        .filter(|&&role| terri_sim::usable_buying_role(pack, object, role))
                        .map(|&role| pack.roles[role as usize].clone())
                        .collect(),
                )
            })
            .collect();
        postcard::to_allocvec(&rows).expect("model facts serialize")
    }
    #[wasm_bindgen(js_name = objectModelId)]
    pub fn object_model_id(&self, entity: f64) -> String {
        placement_u32(entity)
            .and_then(|entity| self.sim.object_definition_of(entity))
            .map_or(String::new(), |object| object.id.clone())
    }
    /// Restored commands predate every request recorded by a new browser controller.
    #[wasm_bindgen(js_name = pendingBookCommands)]
    pub fn pending_book_commands(&self) -> u32 {
        self.sim
            .world()
            .resource::<terri_core::CommandQueue>()
            .as_slice()
            .iter()
            .filter(|command| matches!(command, terri_core::SimCommand::Book(_)))
            .count() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_recipe_station_facts_use_admission_without_changing_saved_roles() {
        let handle = SimHandle::from_lot();
        let before = handle.save_bytes();
        let facts: Vec<ModelFactRow> = postcard::from_bytes(&handle.model_metadata()).unwrap();
        let counter = facts.iter().find(|row| row.1 == "counter").unwrap();
        let sink = facts.iter().find(|row| row.1 == "kitchen_sink").unwrap();
        let desk = facts.iter().find(|row| row.1 == "desk").unwrap();
        assert!(desk.15.is_empty());
        let fridge = facts.iter().find(|row| row.1 == "fridge").unwrap();
        let dinner = fridge.14.iter().find(|row| row.0 == "cook_dinner").unwrap();
        assert_eq!(dinner.8, ["cold_storage", "hob", "prep_surface"]);
        assert_eq!(
            dinner.10,
            [
                "dining_seat",
                "meal_table",
                "Social requires liked company seated at the meal table"
            ]
        );
        assert_eq!(counter.15, vec!["prep_surface"]);
        assert_eq!(sink.15, vec!["dish_sink"]);
        let catalogue = handle.catalogue();
        let sink_row = catalogue
            .chunks_exact(4)
            .position(|row| row[0] == sink.0)
            .unwrap();
        assert_eq!(
            handle.catalogue_needs()[sink_row],
            1 << terri_core::NeedId::Hygiene.index()
        );
        assert_eq!(
            sink.14.iter().map(|row| row.0.as_str()).collect::<Vec<_>>(),
            vec!["wash_up", "clean_dishes"]
        );
        let pack = handle.sim.world().resource::<terri_sim::Content>().0;
        let raw = pack.object(pack.find("kitchen_sink").unwrap());
        assert!(raw
            .roles
            .iter()
            .any(|&r| pack.roles[r as usize] == "prep_surface"));
        assert_eq!(handle.save_bytes(), before);
    }
    #[test]
    fn browser_books_death_capture_preserves_copy_for_living_household_recovery() {
        let mut handle = SimHandle::from_lot();
        handle
            .sim
            .world_mut()
            .insert_resource(terri_core::Funds(1000));
        let person = handle
            .sim
            .world_mut()
            .query::<(terri_core::Entity, &Agent)>()
            .iter(handle.sim.world())
            .next()
            .unwrap()
            .0;
        let stable = *handle.sim.world().get::<terri_core::SimId>(person).unwrap();
        let title = handle.sim.book_titles()[0].id.clone();
        assert!(handle.buy_book(title.clone(), Some(10.0)));
        handle.flush_commands();
        assert!(handle.read_book(
            f64::from(person.index_u32()),
            12.0,
            "read".into(),
            title.clone(),
            true
        ));
        handle.flush_commands();
        for _ in 0..200 {
            handle.tick();
            if handle
                .sim
                .reading_status_of(person.index_u32())
                .is_some_and(|status| status.starts_with("Reading:"))
            {
                break;
            }
        }
        let borrowed = handle.sim.book_copies()[0].clone();
        assert_eq!(borrowed.borrower, Some(stable));
        assert_eq!(
            borrowed.location,
            terri_core::books::BookLocation::Carried(stable)
        );
        assert!(borrowed.home.is_some());
        handle
            .sim
            .world_mut()
            .entity_mut(person)
            .insert(Needs::with(NeedId::Hunger, 0.0));
        let threshold = handle
            .sim
            .world()
            .resource::<Content>()
            .0
            .tuning
            .death_after_ticks;
        handle
            .sim
            .world_mut()
            .resource_mut::<terri_core::save::SavedMortality>()
            .counts = vec![(person.index_u32(), threshold - 1)];
        handle.tick();
        assert!(handle.sim.world().get_entity(person).is_err());
        let dropped = handle.sim.book_copies()[0].clone();
        assert_eq!(
            (dropped.id, &dropped.title_id),
            (borrowed.id, &borrowed.title_id)
        );
        assert!(matches!(
            dropped.location,
            terri_core::books::BookLocation::Lot { .. }
        ));
        assert_eq!(dropped.home, borrowed.home);
        assert!(dropped.borrower.is_none());
        assert_eq!(
            handle
                .sim
                .world_mut()
                .query::<&Agent>()
                .iter(handle.sim.world())
                .count(),
            2
        );
        let bytes = handle.save_bytes();
        assert!(handle.load_bytes(&bytes));
        assert_eq!(handle.save_bytes(), bytes);
        if let Ok(directory) = std::env::var("TERRI_BROWSER_FIXTURE_DIR") {
            std::fs::write(
                std::path::Path::new(&directory).join("owned-reading-dropped.sav"),
                &bytes,
            )
            .unwrap();
        }
        assert!(handle.transfer_book(f64::from(dropped.id.0), Some(10.0)));
        handle.flush_commands();
        assert_eq!(handle.sim.book_copies()[0].id, dropped.id);
        assert!(matches!(
            handle.sim.book_copies()[0].location,
            terri_core::books::BookLocation::Shelf(_)
        ));
    }
    #[test]
    fn browser_books_owned_reading_projection_fixtures() {
        for (model, filename) in [
            ("reading_chair", "owned-reading-seated.sav"),
            ("bookshelf", "owned-reading-standing.sav"),
        ] {
            let mut handle = SimHandle::new(64, 64);
            assert!(handle.spawn_object(11.5, 13.25, model));
            handle.spawn_agent(10.0, 13.0, 80.0);
            let person = handle
                .sim
                .world_mut()
                .query::<(terri_core::Entity, &Agent)>()
                .iter(handle.sim.world())
                .next()
                .unwrap()
                .0;
            let id = handle
                .sim
                .world_mut()
                .resource_mut::<terri_core::SimIdAllocator>()
                .issue();
            handle.sim.world_mut().entity_mut(person).insert((
                id,
                terri_core::IntentQueue::default(),
                terri_core::Personality::default(),
                terri_core::Relationships::default(),
                terri_core::Satisfaction::default(),
            ));
            handle
                .sim
                .world_mut()
                .insert_resource(terri_core::Funds(1000));
            let shelf = if model == "bookshelf" {
                0
            } else {
                assert!(handle.spawn_object(5.0, 5.0, "bookshelf"));
                2
            };
            let title = handle.sim.book_titles()[0].id.clone();
            assert!(handle.buy_book(title.clone(), Some(f64::from(shelf))));
            handle.flush_commands();
            assert!(handle.read_book(1.0, 0.0, "read".into(), title, true));
            handle.flush_commands();
            for _ in 0..200 {
                handle.tick();
                if handle.sim.render_buffer().visual_actions[1]
                    == if model == "reading_chair" { 3 } else { 4 }
                {
                    break;
                }
            }
            assert_eq!(
                handle.sim.render_buffer().visual_actions[1],
                if model == "reading_chair" { 3 } else { 4 }
            );
            let render = handle.sim.render_buffer();
            let (position, facing) = if model == "reading_chair" {
                ([11.5, 13.25], 1)
            } else {
                ([14.0, 13.0], 2)
            };
            assert_eq!(&render.positions[2..4], &position);
            assert_eq!(render.facings[1], facing);
            let bytes = handle.save_bytes();
            assert!(handle.load_bytes(&bytes));
            assert_eq!(handle.save_bytes(), bytes);
            if let Ok(directory) = std::env::var("TERRI_BROWSER_FIXTURE_DIR") {
                std::fs::write(std::path::Path::new(&directory).join(filename), bytes).unwrap();
            }
        }
    }
    #[test]
    fn browser_books_facts_and_shared_unplaced_benefits_are_read_only() {
        let handle = SimHandle::from_lot();
        let pack = handle.sim.world().resource::<terri_sim::Content>().0;
        let bytes = handle.save_bytes();
        let hash = handle.sim.world_hash();
        assert!(!handle.model_metadata().is_empty());
        for object in &pack.objects {
            for action in object
                .interactions
                .iter()
                .filter(|action| action.book_reading)
            {
                let expected = handle.sim.reading_model_benefits(&object.id, &action.id);
                assert_eq!(expected.len(), 4);
                for entity in handle.sim.render_buffer().ids.iter() {
                    if handle
                        .sim
                        .object_definition_of(*entity)
                        .is_some_and(|placed| placed.id == object.id)
                    {
                        assert_eq!(
                            handle.reading_action_benefits(f64::from(*entity), &action.id),
                            expected
                        );
                    }
                }
            }
        }
        assert_eq!(handle.save_bytes(), bytes);
        assert_eq!(handle.sim.world_hash(), hash);
    }
    #[test]
    fn browser_books_postcard_witnesses() {
        use terri_core::{books::*, SimId};
        let titles = vec![("t", "Café 📖", "\u{feff}A", "g", 128u32, 16384u32)];
        let dropped = vec![BookCopy {
            id: BookCopyId(16384),
            title_id: "t".into(),
            location: BookLocation::Lot { x: 1.25, y: 2.5 },
            home: Some(ShelfSlot {
                shelf: BookShelfId(47),
                slot: 23,
            }),
            borrower: None,
        }];
        assert_eq!(
            postcard::to_allocvec(&dropped).unwrap(),
            [1, 128, 128, 1, 1, 116, 3, 0, 0, 160, 63, 0, 0, 32, 64, 1, 47, 23, 0]
        );
        let copies = vec![
            BookCopy {
                id: BookCopyId(127),
                title_id: "t".into(),
                location: BookLocation::Inventory,
                home: None,
                borrower: None,
            },
            BookCopy {
                id: BookCopyId(128),
                title_id: "t".into(),
                location: BookLocation::Shelf(ShelfSlot {
                    shelf: BookShelfId(47),
                    slot: 23,
                }),
                home: Some(ShelfSlot {
                    shelf: BookShelfId(47),
                    slot: 23,
                }),
                borrower: Some(SimId(16384)),
            },
            BookCopy {
                id: BookCopyId(16383),
                title_id: "t".into(),
                location: BookLocation::Carried(SimId(16384)),
                home: Some(ShelfSlot {
                    shelf: BookShelfId(9007199254740993),
                    slot: 65535,
                }),
                borrower: Some(SimId(16384)),
            },
            BookCopy {
                id: BookCopyId(0xfffffffe),
                title_id: "t".into(),
                location: BookLocation::Lot { x: 2.5, y: -3.25 },
                home: None,
                borrower: None,
            },
        ];
        let memory = Some(TitleMemory {
            sim_id: SimId(16384),
            title_id: "t".into(),
            progress_ticks: 128,
            progress_fraction: 0.25,
            pass_novelty: Some(0.5),
            familiarity: 0.75,
            last_read_tick: 9007199254740993,
            completed_passes: 2,
        });
        assert_eq!(
            postcard::to_allocvec(&titles).unwrap(),
            [
                1, 1, 116, 10, 67, 97, 102, 195, 169, 32, 240, 159, 147, 150, 4, 239, 187, 191, 65,
                1, 103, 128, 1, 128, 128, 1
            ]
        );
        assert_eq!(
            postcard::to_allocvec(&copies).unwrap(),
            [
                4, 127, 1, 116, 0, 0, 0, 128, 1, 1, 116, 1, 47, 23, 1, 47, 23, 1, 128, 128, 1, 255,
                127, 1, 116, 2, 128, 128, 1, 1, 129, 128, 128, 128, 128, 128, 128, 16, 255, 255, 3,
                1, 128, 128, 1, 254, 255, 255, 255, 15, 1, 116, 3, 0, 0, 32, 64, 0, 0, 80, 192, 0,
                0
            ]
        );
        assert_eq!(
            postcard::to_allocvec(&memory).unwrap(),
            [
                1, 128, 128, 1, 1, 116, 128, 1, 0, 0, 128, 62, 1, 0, 0, 0, 63, 0, 0, 64, 63, 129,
                128, 128, 128, 128, 128, 128, 16, 2
            ]
        );
    }
    #[test]
    fn browser_books_restored_pending_commands_have_an_explicit_barrier() {
        let mut handle = SimHandle::from_lot();
        let title = handle.sim.book_titles()[0].id.clone();
        assert!(handle.buy_book(title, None));
        assert_eq!(handle.pending_book_commands(), 1);
        let save = handle.save_bytes();
        assert!(handle.load_bytes(&save));
        assert_eq!(handle.pending_book_commands(), 1);
        handle.flush_commands();
        assert_eq!(handle.pending_book_commands(), 0);
        assert_eq!(handle.take_book_results().len(), 4);
    }
    #[test]
    fn browser_books_capacity_postcard_witness() {
        let rows: Vec<ModelFactRow> = vec![(
            0,
            "s".into(),
            "Bookcase".into(),
            "Shelf".into(),
            "Shelf.".into(),
            "bookcase".into(),
            "storage".into(),
            "Storage".into(),
            vec!["living_room".into()],
            1,
            1,
            24,
            1,
            60,
            vec![
                (
                    "read".into(),
                    "Read a book".into(),
                    60,
                    None,
                    true,
                    vec![],
                    0.003,
                    vec![30.0, 0.0, 0.003, 1.0],
                    vec!["Available shelved book".into()],
                    "ordinary".into(),
                    vec![],
                    false,
                ),
                (
                    "inspect".into(),
                    "Inspect".into(),
                    1,
                    Some(1),
                    false,
                    vec![],
                    0.0,
                    vec![],
                    vec![],
                    "ordinary".into(),
                    vec!["meal_table".into()],
                    true,
                ),
            ],
            vec!["prep_surface".into()],
        )];
        assert_eq!(
            postcard::to_allocvec(&rows).unwrap(),
            vec![
                1, 0, 1, 115, 8, 66, 111, 111, 107, 99, 97, 115, 101, 5, 83, 104, 101, 108, 102, 6,
                83, 104, 101, 108, 102, 46, 8, 98, 111, 111, 107, 99, 97, 115, 101, 7, 115, 116,
                111, 114, 97, 103, 101, 7, 83, 116, 111, 114, 97, 103, 101, 1, 11, 108, 105, 118,
                105, 110, 103, 95, 114, 111, 111, 109, 1, 1, 24, 1, 60, 2, 4, 114, 101, 97, 100,
                11, 82, 101, 97, 100, 32, 97, 32, 98, 111, 111, 107, 60, 0, 1, 0, 166, 155, 68, 59,
                4, 0, 0, 240, 65, 0, 0, 0, 0, 166, 155, 68, 59, 0, 0, 128, 63, 1, 22, 65, 118, 97,
                105, 108, 97, 98, 108, 101, 32, 115, 104, 101, 108, 118, 101, 100, 32, 98, 111,
                111, 107, 8, 111, 114, 100, 105, 110, 97, 114, 121, 0, 0, 7, 105, 110, 115, 112,
                101, 99, 116, 7, 73, 110, 115, 112, 101, 99, 116, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
                8, 111, 114, 100, 105, 110, 97, 114, 121, 1, 10, 109, 101, 97, 108, 95, 116, 97,
                98, 108, 101, 1, 1, 12, 112, 114, 101, 112, 95, 115, 117, 114, 102, 97, 99, 101,
            ]
        );
        let handle = SimHandle::from_lot();
        let facts: Vec<ModelFactRow> = postcard::from_bytes(&handle.model_metadata()).unwrap();
        let shelf = facts.iter().find(|r| r.1 == "bookshelf").unwrap();
        assert_eq!((shelf.11, shelf.12), (24, 1));
        assert_eq!(shelf.14.iter().find(|a| a.0 == "read").unwrap().3, None);
        for id in ["television", "radio"] {
            let action = &facts.iter().find(|r| r.1 == id).unwrap().14[0];
            assert_eq!(action.3, Some(2));
            assert!(action.11, "free seats in view admit more {id} users");
        }
        assert!(!shelf.14.iter().find(|a| a.0 == "read").unwrap().11);
    }
}
