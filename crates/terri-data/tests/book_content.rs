#[test]
fn reusable_actions_accept_explicit_book_and_seat_contracts() {
    let source = r#"
[[action_template]]
id = "reading"
[action_template.properties]
duration_ticks = { set = 60.0 }
slots = { set = 1.0 }
advertises = { set = { fun = 30.0 } }
book_reading = { set = true }
seat_use = { set = "one" }
[[category]]
id = "other"
label = "Other"
[[object_type]]
id = "unrelated"
label = "Unrelated"
category = "other"
[object_type.properties]
shelf_capacity = { set = 24.0 }
[[object_type.action]]
id = "read"
template = "reading"
[[model]]
id = "fixture"
object_type = "unrelated"
[model.properties]
name = { set = "Fixture" }
sprite = { set = "fixture" }
[[model.action]]
id = "read"
[model.action.properties]
seat_use = { set = "all" }
"#;
    let parsed = toml::from_str::<terri_data::schema::ObjectsFile>(source);
    assert!(
        parsed.is_ok(),
        "explicit book and seat properties must parse: {parsed:?}"
    );
    let resolved = terri_data::hierarchy::resolve(parsed.unwrap()).unwrap();
    assert_eq!(resolved.object[0].shelf_capacity, 24);
    assert!(resolved.object[0].interaction[0].book_reading);
    assert_eq!(
        resolved.object[0].interaction[0].seat_use,
        terri_data::SeatUse::All
    );
}

#[test]
fn shipped_catalogue_has_six_genres_and_eight_books_at_each_length_and_price() {
    let pack = terri_data::pack();
    assert_eq!(pack.books.len(), 24);
    assert_eq!(
        pack.books
            .iter()
            .map(|book| &book.genre)
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        6
    );
    for (length, price) in [(120, 6), (180, 10), (240, 14)] {
        assert_eq!(
            pack.books
                .iter()
                .filter(|book| book.reading_minutes == length && book.price == price)
                .count(),
            8
        );
    }
    let books = terri_data::compile_books(
        toml::from_str(include_str!("../../../content/books.toml")).unwrap(),
    )
    .unwrap();
    assert_eq!(pack.books, books);
    let decoded: terri_data::ContentPack =
        postcard::from_bytes(&postcard::to_allocvec(pack).unwrap()).unwrap();
    assert_eq!(decoded.books, books);
    assert_eq!(decoded.reading, pack.reading);
    assert_eq!(
        pack.object(pack.find("bookshelf").unwrap()).shelf_capacity,
        24
    );
    assert!(
        pack.objects
            .iter()
            .flat_map(|object| &object.interactions)
            .filter(|action| action.book_reading)
            .count()
            == 7
    );
}

#[test]
fn malformed_catalogue_rejects_duplicates_blank_copy_unknown_genres_and_zero_values() {
    let source = include_str!("../../../content/books.toml");
    let cases: Vec<fn(&mut terri_data::BooksFile)> = vec![
        |file| file.book.push(file.book[0].clone()),
        |file| file.genres.push(file.genres[0].clone()),
        |file| file.book[0].id = "not an id".into(),
        |file| file.book[0].title = " ".into(),
        |file| file.book[0].description = " ".into(),
        |file| file.book[0].genre = "missing".into(),
        |file| file.book[0].reading_minutes = 0,
        |file| file.book[0].price = 0,
    ];
    for mutate in cases {
        let mut raw: terri_data::BooksFile = toml::from_str(source).unwrap();
        mutate(&mut raw);
        assert!(terri_data::compile_books(raw).is_err());
    }
}

#[test]
fn reading_tuning_rejects_nonfinite_out_of_range_and_zero_inputs() {
    let valid = terri_data::pack().reading.unwrap();
    let cases: Vec<fn(&mut terri_data::ReadingTuning)> = vec![
        |t| t.session_ticks = 0,
        |t| t.pickup_ticks = 0,
        |t| t.shelve_ticks = 0,
        |t| t.session_ticks = 61,
        |t| t.recovery_ticks = 0,
        |t| t.reread_floor = 0.0,
        |t| t.reread_floor = 1.1,
        |t| t.reread_floor = f32::NAN,
        |t| t.action_fun_reference = 0.0,
        |t| t.action_fun_reference = -1.0,
        |t| t.action_fun_reference = f32::NAN,
        |t| t.fun_per_session = f32::INFINITY,
        |t| t.fun_per_session = -1.0,
        |t| t.satisfaction_per_session = 101.0,
    ];
    for mutate in cases {
        let mut bad = valid;
        mutate(&mut bad);
        assert!(terri_data::books::validate_reading(&bad).is_err());
    }
}

#[test]
fn legacy_objects_default_to_exclusive_actions_and_no_owned_book_requirement() {
    let source: terri_data::schema::ObjectsFile =
        toml::from_str(include_str!("fixtures/pre-hierarchy-objects.toml")).unwrap();
    for object in source.object {
        assert_eq!(object.shelf_capacity, 0);
        for action in object.interaction {
            assert!(!action.book_reading);
            assert_eq!(action.seat_use, terri_data::SeatUse::Exclusive);
        }
    }
}
