use terri_data::schema::ObjectsFile;

fn resolve(source: &str) -> Result<ObjectsFile, terri_data::ContentError> {
    terri_data::hierarchy::resolve(toml::from_str(source).unwrap())
}

const SHOWER: &str = r#"
[[action_template]]
id = "washing"
[action_template.properties]
label = { set = "Wash" }
duration_ticks = { set = 9.0 }
slots = { set = 1.0 }
advertises = { set = { hygiene = 11.0, energy = -3.0 } }
tags = { set = ["washing"] }
sound_action = { set = "shower_water" }
[[category]]
id = "hygiene"
label = "Hygiene"
[category.properties]
price = { set = 40.0 }
rooms = { set = ["bathroom"] }
[[category.action]]
id = "wash"
template = "washing"
[[category.action]]
id = "rinse"
template = "washing"
[[object_type]]
id = "shower"
label = "Shower"
category = "hygiene"
[object_type.properties]
price = { scale = 2.0 }
rooms = { extend = ["utility"] }
[[object_type.action]]
id = "wash"
[object_type.action.properties]
duration_ticks = { scale = 0.5 }
tags = { extend = ["private"] }
[[model]]
id = "rain"
object_type = "shower"
[model.properties]
name = { set = "Rain" }
sprite = { set = "offlineShower" }
price = { scale = 1.5 }
[[model.action]]
id = "wash"
[model.action.properties]
duration_ticks = { scale = 0.5 }
label = { set = "Take a shower" }
sound_action = { remove = true }
advertises = { scale = 2.0 }
[[model.action]]
id = "quick_rinse"
template = "washing"
[model.action.properties]
duration_ticks = { set = 1.0 }
advertises = { replace = { hygiene = 4.0 } }
tags = { replace = ["quick"] }
"#;

#[test]
fn hygiene_shower_model_resolves_values_order_and_final_duration_rounding() {
    let resolved = resolve(SHOWER).unwrap();
    let object = &resolved.object[0];
    assert_eq!(object.id, "rain");
    assert_eq!(object.price, Some(120));
    assert_eq!(
        object.metadata.as_ref().unwrap().rooms,
        ["bathroom", "utility"]
    );
    assert_eq!(object.metadata.as_ref().unwrap().type_label, "Shower");
    assert_eq!(
        object
            .interaction
            .iter()
            .map(|a| a.id.as_str())
            .collect::<Vec<_>>(),
        ["wash", "rinse", "quick_rinse"]
    );
    let wash = &object.interaction[0];
    assert_eq!(
        wash.duration_ticks, 2,
        "9 * 0.5 * 0.5 rounds once; layer rounding would produce 3"
    );
    assert_eq!(wash.label.as_deref(), Some("Take a shower"));
    assert_eq!(wash.sound_action, None);
    assert_eq!(wash.tags, ["washing", "private"]);
    assert_eq!(wash.advertises["hygiene"], 22.0);
    assert_eq!(wash.advertises["energy"], -6.0);
    assert_eq!(object.interaction[1].duration_ticks, 9);
    assert_eq!(object.interaction[2].duration_ticks, 1);
    assert_eq!(object.interaction[2].tags, ["quick"]);
    assert_eq!(object.interaction[2].advertises.len(), 1);
}

#[test]
fn template_durations_are_not_rounded_or_range_checked_before_inheritance() {
    let source = SHOWER
        .replace("duration_ticks = { set = 9.0 }", "duration_ticks = { set = 0.4 }")
        .replace("duration_ticks = { scale = 0.5 }", "duration_ticks = { scale = 10.0 }")
        .replace("id = \"rinse\"\ntemplate = \"washing\"", "id = \"rinse\"\ntemplate = \"washing\"\n[category.action.properties]\nduration_ticks = { scale = 10.0 }");
    let resolved = resolve(&source).unwrap();
    assert_eq!(resolved.object[0].interaction[0].duration_ticks, 40);
    assert_eq!(resolved.object[0].interaction[1].duration_ticks, 4);
}

#[test]
fn inherited_action_removal_and_model_only_action_keep_survivor_order() {
    let source = SHOWER.replace(
        "[[model.action]]\nid = \"quick_rinse\"",
        "[[model.action]]\nid = \"rinse\"\nremove = true\n[[model.action]]\nid = \"quick_rinse\"",
    );
    let resolved = resolve(&source).unwrap();
    assert_eq!(
        resolved.object[0]
            .interaction
            .iter()
            .map(|a| a.id.as_str())
            .collect::<Vec<_>>(),
        ["wash", "quick_rinse"]
    );
}

#[test]
fn review_optional_satisfaction_can_remove_an_inherited_reward() {
    let source = SHOWER
        .replace(
            "label = { set = \"Wash\" }",
            "label = { set = \"Wash\" }\nsatisfaction = { set = 3.5 }",
        )
        .replace(
            "label = { set = \"Take a shower\" }",
            "label = { set = \"Take a shower\" }\nsatisfaction = { remove = true }",
        );
    let resolved = resolve(&source).expect("an optional reward can be removed");
    assert_eq!(resolved.object[0].interaction[0].satisfaction, 0.0);
    assert_eq!(resolved.object[0].interaction[1].satisfaction, 3.5);
    let required = source
        .replace(
            "satisfaction = { remove = true }",
            "advertises = { remove = true }",
        )
        .replace("advertises = { scale = 2.0 }", "");
    assert!(resolve(&required)
        .unwrap_err()
        .to_string()
        .contains("required advertises"));
}

#[test]
fn review_legacy_objects_cannot_author_resolved_classification_metadata() {
    let object = "[[object]]\nid = \"legacy\"\nname = \"Legacy\"\nsprite = \"offlineShower\"\n";
    let legacy: ObjectsFile = toml::from_str(object).unwrap();
    assert!(legacy.object[0].metadata.is_none());
    for metadata in [
        "{ category_id = \"missing\", category_label = \"\", type_id = \"missing\", type_label = \"\", rooms = [\"Office\", \"Office\"] }",
        "{ category_id = \"hygiene\", category_label = \"Hygiene\", type_id = \"shower\", type_label = \"Shower\", rooms = [\"bathroom\"] }",
    ] {
        let source = format!("{object}metadata = {metadata}\n");
        let error = toml::from_str::<ObjectsFile>(&source).expect_err("classification must come from the resolver");
        assert!(error.to_string().contains("unknown field `metadata`"));
    }
}

#[test]
fn review_unused_action_layers_reject_unknown_semantic_references() {
    let baseline = include_str!("../../../content/objects.toml");
    let headers = [
        "[[action_template]]\nid = \"unused\"\n[action_template.properties]\n",
        "[[category]]\nid = \"unused\"\nlabel = \"Unused\"\n[[category.action]]\nid = \"partial\"\n[category.action.properties]\n",
        "[[category]]\nid = \"unused_family\"\nlabel = \"Unused family\"\n[[object_type]]\nid = \"unused\"\nlabel = \"Unused\"\ncategory = \"unused_family\"\n[[object_type.action]]\nid = \"partial\"\n[object_type.action.properties]\n",
    ];
    for header in headers {
        for (property, unknown) in [
            (
                "advertises = { set = { unknown_need = 1.0 } }",
                "unknown_need",
            ),
            (
                "advertises = { extend = { unknown_need = 1.0 } }",
                "unknown_need",
            ),
            (
                "advertises = { replace = { unknown_need = 1.0 } }",
                "unknown_need",
            ),
            ("sound_action = { set = \"not_a_sound\" }", "not_a_sound"),
            (
                "completion_sound = { set = \"not_a_completion\" }",
                "not_a_completion",
            ),
            (
                "activity = { set = \"not_an_activity\" }",
                "not_an_activity",
            ),
            (
                "visual = { set = { action = \"not_a_pose\" } }",
                "not_a_pose",
            ),
            (
                "visual = { set = { anchor = \"not_an_anchor\" } }",
                "not_an_anchor",
            ),
            (
                "visual = { set = { facing = \"not_a_facing\" } }",
                "not_a_facing",
            ),
        ] {
            let source = format!("{baseline}\n{header}{property}\n");
            let result = compile_objects(toml::from_str(&source).unwrap());
            let error = match result {
                Err(error) => error.to_string(),
                Ok(_) => panic!("unused definitions must reject {property}"),
            };
            assert!(error.contains(unknown), "{error}");
            assert!(
                error.contains("unused"),
                "error must identify its authored owner: {error}"
            );
        }
    }
}

#[test]
fn review_partial_templates_keep_model_dependent_socket_validation_at_final_resolution() {
    let baseline = include_str!("../../../content/objects.toml");
    let template = r#"
[[action_template]]
id = "partial_seated_read"
[action_template.properties]
visual = { set = { action = "read", anchor = "object_socket", facing = "socket", socket = "later_seat" } }
"#;
    let unused = format!("{baseline}{template}");
    compile_objects(toml::from_str(&unused).unwrap())
        .expect("unused templates need no duration, slots, adverts, or model-owned socket");
    let model = r#"
[[category]]
id = "test_seating"
label = "Test seating"
[[object_type]]
id = "test_chair"
label = "Test chair"
category = "test_seating"
[[object_type.action]]
id = "test_read"
template = "partial_seated_read"
[object_type.action.properties]
duration_ticks = { set = 30.0 }
slots = { set = 1.0 }
advertises = { set = { fun = 10.0 } }
[[model]]
id = "test_chair_model"
object_type = "test_chair"
[model.properties]
name = { set = "Test chair model" }
sprite = { set = "offlineChair" }
action_socket = { set = [{ id = "later_seat", x = 0.0, y = 0.0, facing = "SE" }] }
"#;
    let source = format!("{unused}{model}");
    let compiled = compile_objects(toml::from_str(&source).unwrap())
        .expect("the model supplies its socket and final required action fields");
    let chair = compiled.object(compiled.find("test_chair_model").unwrap());
    assert_eq!(
        chair.interactions[0].visual.as_ref().unwrap().socket,
        Some(0)
    );
    let invalid = source.replace("id = \"later_seat\", x", "id = \"different_seat\", x");
    assert!(matches!(
        compile_objects(toml::from_str(&invalid).unwrap()),
        Err(terri_data::ContentError::UnknownVisualSocket { .. })
    ));
}

#[test]
fn unrelated_types_share_templates_without_sharing_categories() {
    let extra = r#"
[[category]]
id = "other"
label = "Other"
[[object_type]]
id = "hose"
label = "Hose"
category = "other"
[[object_type.action]]
id = "water"
template = "washing"
[[model]]
id = "hose_model"
object_type = "hose"
[model.properties]
name = { set = "Hose model" }
sprite = { set = "hose_art" }
rooms = { set = ["office", "garden"] }
"#;
    let resolved = resolve(&format!("{SHOWER}{extra}")).unwrap();
    let hose = &resolved.object[1];
    assert_eq!(hose.metadata.as_ref().unwrap().category_id, "other");
    assert_eq!(hose.metadata.as_ref().unwrap().rooms, ["garden", "office"]);
    assert_eq!(hose.interaction.len(), 1);
    assert_eq!(hose.interaction[0].duration_ticks, 9);
    assert_eq!(hose.interaction[0].tags, ["washing"]);
}

#[test]
fn malformed_layers_are_rejected_with_author_context() {
    for (from, to, reason) in [
        (
            "object_type = \"shower\"",
            "object_type = \"missing\"",
            "unknown object type",
        ),
        (
            "category = \"hygiene\"",
            "category = \"missing\"",
            "unknown category",
        ),
        (
            "template = \"washing\"",
            "template = \"missing\"",
            "unknown action template",
        ),
        (
            "price = { scale = 1.5 }",
            "price = { scale = 1.5, set = 30.0 }",
            "conflicting operations",
        ),
        (
            "price = { scale = 1.5 }",
            "price = { scale = inf }",
            "finite",
        ),
        (
            "price = { scale = 1.5 }",
            "price = { scale = -1.0 }",
            "non-negative",
        ),
        (
            "price = { scale = 1.5 }",
            "price = { set = 1.5 }",
            "integer",
        ),
        (
            "name = { set = \"Rain\" }",
            "",
            "missing required field 'name'",
        ),
        (
            "name = { set = \"Rain\" }",
            "name = { remove = true }",
            "required field",
        ),
        (
            "sound_action = { remove = true }",
            "visual = { remove = true }",
            "absent field",
        ),
        (
            "duration_ticks = { set = 1.0 }",
            "duration_ticks = { set = 0.0 }",
            "duration_ticks",
        ),
        ("slots = { set = 1.0 }", "slots = { set = 256.0 }", "slots"),
        (
            "rooms = { extend = [\"utility\"] }",
            "rooms = { extend = [\"bathroom\"] }",
            "unique",
        ),
        (
            "rooms = { extend = [\"utility\"] }",
            "rooms = { extend = [\"Office\"] }",
            "lowercase",
        ),
    ] {
        let source = SHOWER.replace(from, to);
        let error = resolve(&source).unwrap_err().to_string();
        assert!(error.contains(reason), "expected {reason:?}, got {error:?}");
    }
}

#[test]
fn unknown_operations_and_multiple_parent_fields_are_parse_errors() {
    for source in [
        SHOWER.replace("scale = 1.5", "multiply = 1.5"),
        SHOWER.replace(
            "category = \"hygiene\"",
            "category = \"hygiene\"\nextends = [\"other\"]",
        ),
        SHOWER.replace(
            "sprite = { set = \"offlineShower\" }",
            "spite = { set = \"offlineShower\" }",
        ),
    ] {
        assert!(toml::from_str::<ObjectsFile>(&source).is_err());
    }
}

#[test]
fn invalid_unused_definitions_cannot_hide_until_a_model_uses_them() {
    let source = format!("{SHOWER}\n[[object_type]]\nid = \"broken\"\nlabel = \"Broken\"\ncategory = \"hygiene\"\n[[object_type.action]]\nid = \"oops\"\ntemplate = \"missing\"\n");
    assert!(resolve(&source).is_err());
}

fn compile_objects(
    source: ObjectsFile,
) -> Result<terri_data::ContentPack, terri_data::ContentError> {
    macro_rules! content {
        ($file:literal) => {
            toml::from_str(include_str!(concat!("../../../content/", $file, ".toml"))).unwrap()
        };
    }
    terri_data::compile(
        content!("needs"),
        source,
        content!("lot"),
        toml::from_str(include_str!("../../../assets/sprites/atlas.toml")).unwrap(),
        content!("tuning"),
        content!("personalities"),
        content!("household"),
        content!("social"),
        content!("traits"),
        content!("careers"),
        content!("chains"),
        content!("voice"),
        terri_data::pack()
            .voice_clips
            .iter()
            .map(|clip| clip.duration_ticks)
            .collect(),
        content!("skills"),
    )
}

#[test]
fn shipped_migration_scopes_retirement_balance_and_seating_changes() {
    let legacy: ObjectsFile =
        toml::from_str(include_str!("fixtures/pre-hierarchy-objects.toml")).unwrap();
    let legacy = compile_objects(legacy).unwrap();
    let current = terri_data::pack();
    let published = terri_data::contextual_pre_books_pack();
    assert_eq!(
        terri_data::content_fingerprint(&legacy),
        0xcf78_7472_e9e8_38f5
    );
    assert_ne!(
        terri_data::content_fingerprint(current),
        terri_data::content_fingerprint(&legacy),
        "new sitting actions belong to V6, not the published positional shape"
    );
    assert_eq!(current.objects.len(), legacy.objects.len());
    for actual in &current.objects {
        let expected = published.object(
            published
                .find(&actual.id)
                .expect("published model retained"),
        );
        let mut actual = actual.clone();
        actual.name = expected.name.clone();
        actual.price = expected.price;
        actual.presentation = expected.presentation.clone();
        actual.metadata = None;
        actual.seats.clear();
        actual.shelf_access.clear();
        actual.shelf_capacity = expected.shelf_capacity;
        if actual.id == "stove" {
            assert_eq!(actual.cooking_front, Some((1, 0)));
        }
        actual.cooking_front = None;
        let roles: Vec<_> = actual
            .roles
            .iter()
            .map(|r| current.roles[*r as usize].as_str())
            .collect();
        for role in &expected.roles {
            assert!(roles.contains(&published.roles[*role as usize].as_str()));
        }
        assert!(roles
            .iter()
            .all(|role| published.roles.iter().any(|r| r == role)
                || matches!(*role, "dining_seat" | "turnable_seat")));
        actual.roles = expected.roles.clone();
        let changed_seating = matches!(
            actual.id.as_str(),
            "sofa"
                | "armchair"
                | "reading_chair"
                | "chair"
                | "desk_chair"
                | "long_sofa"
                | "bookshelf"
        );
        for prior in &expected.interactions {
            if actual.id == "dining_table" && prior.id == "sit_properly" {
                assert_eq!(
                    actual
                        .interactions
                        .iter()
                        .map(|action| action.id.as_str())
                        .collect::<Vec<_>>(),
                    ["sit_properly", "take_prepared_food"],
                    "published chair-backed sitting and prepared-food orders remain stable"
                );
                continue;
            }
            let action = actual
                .interactions
                .iter()
                .find(|a| a.id == prior.id)
                .expect("every legacy action keeps its stable ID");
            if !changed_seating {
                let mut comparable = action.clone();
                comparable.recipe = None;
                comparable.media = None;
                let mut intended = prior.clone();
                use terri_data::{
                    CompiledVisual, CompiledVisualAction, CompiledVisualAnchor,
                    CompiledVisualFacing,
                };
                match (actual.id.as_str(), prior.id.as_str()) {
                    ("sink", "wash_hands") | ("kitchen_sink", "wash_up") => {
                        intended.visual = Some(CompiledVisual {
                            action: CompiledVisualAction::Wash,
                            anchor: CompiledVisualAnchor::Object,
                            facing: CompiledVisualFacing::TowardAnchor,
                            socket: None,
                        });
                    }
                    ("bathtub", "soak") => {
                        intended.visual = Some(CompiledVisual {
                            action: CompiledVisualAction::Bathe,
                            anchor: CompiledVisualAnchor::ObjectSocket,
                            facing: CompiledVisualFacing::Socket,
                            socket: Some(0),
                        });
                    }
                    _ => (),
                }
                match actual.id.as_str() {
                    "sink" => intended.advertises = vec![(2, 22.0)],
                    "moving_box" => {
                        intended
                            .advertises
                            .iter_mut()
                            .find(|(need, _)| *need == 5)
                            .unwrap()
                            .1 = 32.0;
                        intended.duration_ticks = 75;
                        intended.satisfaction = 3.0;
                    }
                    "desk" => intended.label = "Handle correspondence".into(),
                    _ => (),
                }
                assert_eq!(comparable, intended);
            }
        }
        if changed_seating {
            assert!(actual.interactions.iter().all(|a| a.id == "sit"
                || a.id == "read"
                || expected.interactions.iter().any(|p| p.id == a.id)));
            actual.interactions = expected.interactions.clone();
        }
        if !changed_seating {
            assert!(actual.interactions.iter().all(|a| expected
                .interactions
                .iter()
                .any(|p| p.id == a.id)
                || matches!(
                    (actual.id.as_str(), a.id.as_str()),
                    ("fridge", "cook_dinner")
                        | ("kitchen_sink", "clean_dishes")
                        | ("dining_table", "take_prepared_food")
                )));
            actual.interactions = expected.interactions.clone();
        }
        if actual.id == "bathtub" {
            assert_eq!(actual.action_sockets.len(), 1);
            let basin = &actual.action_sockets[0];
            assert_eq!(basin.id, "basin");
            assert_eq!((basin.x, basin.y), (0.0, 0.0));
            assert_eq!(basin.facing, terri_data::CompiledSocketFacing::PositiveY);
            actual.action_sockets = expected.action_sockets.clone();
        }
        assert_eq!(
            &actual, expected,
            "unreviewed gameplay drift on {}",
            expected.id
        );
    }
}

#[test]
fn every_shipped_model_has_classification_and_physical_seats_are_separate_from_action_slots() {
    let pack = terri_data::pack();
    for object in &pack.objects {
        let metadata = object
            .metadata
            .as_ref()
            .expect("all shipped models are classified");
        assert!(
            !metadata.rooms.is_empty(),
            "{} has a store room association",
            object.id
        );
        assert!(metadata.rooms.windows(2).all(|pair| pair[0] < pair[1]));
    }
    for (id, type_id, type_label, seats) in [
        ("reading_chair", "armchair", "Armchair", 1),
        ("armchair", "armchair", "Armchair", 1),
        ("sofa", "ottoman", "Ottoman", 1),
        ("long_sofa", "sofa", "Sofa", 3),
        ("chair", "dining_chair", "Dining chair", 1),
        ("desk_chair", "office_chair", "Office chair", 1),
    ] {
        let object = pack.object(pack.find(id).unwrap());
        let metadata = object.metadata.as_ref().unwrap();
        assert_eq!(metadata.type_id, type_id);
        assert_eq!(metadata.type_label, type_label);
        assert_eq!(object.seats.len(), seats, "{id}");
        assert!(object.sleep_places.is_empty());
    }
    let ottoman = pack.object(pack.find("sofa").unwrap());
    assert_eq!(
        ottoman.interactions[0].slots, 2,
        "physical capacity must not rewrite the published action in this migration"
    );
}

#[test]
fn model_metadata_and_seats_survive_pack_serialization() {
    let pack = terri_data::pack();
    let bytes = postcard::to_allocvec(pack).unwrap();
    let decoded: terri_data::ContentPack = postcard::from_bytes(&bytes).unwrap();
    assert_eq!(&decoded, pack);
    let mut changed = decoded;
    changed.objects[0].metadata.as_mut().unwrap().type_label = "Edited label".into();
    let seat = changed.find("long_sofa").unwrap();
    changed.objects[seat.0 as usize].seats[0].x += 0.1;
    assert_eq!(
        terri_data::content_fingerprint(&changed),
        terri_data::content_fingerprint(pack),
        "V1 remains frozen; current seat geometry is checked by V6 claim validation"
    );
}

#[test]
fn hierarchy_results_still_pass_existing_action_validation() {
    let source = include_str!("../../../content/objects.toml");
    let extra = SHOWER
        .replace("id = \"hygiene\"", "id = \"test_hygiene\"")
        .replace("category = \"hygiene\"", "category = \"test_hygiene\"")
        .replace("id = \"shower\"", "id = \"test_shower\"")
        .replace("object_type = \"shower\"", "object_type = \"test_shower\"")
        .replace(
            "duration_ticks = { set = 9.0 }",
            "duration_ticks = { set = 96.0 }",
        )
        .replace(
            "duration_ticks = { set = 1.0 }",
            "duration_ticks = { set = 22.0 }",
        );
    let source = format!("{source}\n{extra}");
    let compiled = compile_objects(toml::from_str(&source).unwrap()).unwrap();
    let object = compiled.object(compiled.find("rain").unwrap());
    assert_eq!(object.interactions[0].duration_ticks, 24);
    assert_eq!(object.interactions[0].advertises, [(1, -6.0), (2, 22.0)]);
    let invalid = source.replace("hygiene = 11.0", "unknown_need = 11.0");
    assert!(matches!(
        compile_objects(toml::from_str(&invalid).unwrap()),
        Err(terri_data::ContentError::UnknownNeed { .. })
    ));
}

#[test]
fn malformed_physical_seats_fail_content_compilation() {
    let baseline = include_str!("../../../content/objects.toml");
    for (from, to) in [
        ("id = \"seat_2\"", "id = \"seat_1\""),
        ("x = 0.25", "x = -0.35"),
        ("x = 0.25", "x = inf"),
        ("x = 0.25", "x = 30.0"),
        ("approaches = [[1, 1]]", "approaches = [[0, 0]]"),
        ("approaches = [[1, 1]]", "approaches = []"),
        (
            "facing = \"SW\", approaches",
            "facing = \"west\", approaches",
        ),
    ] {
        assert!(baseline.contains(from));
        let source = baseline.replace(from, to);
        assert!(
            compile_objects(toml::from_str(&source).unwrap()).is_err(),
            "accepted {from} -> {to}"
        );
    }
}

#[test]
fn hierarchy_sources_accept_models_without_legacy_objects() {
    let source = r#"
[[category]]
id = "hygiene"
label = "Hygiene"
[[object_type]]
id = "shower"
label = "Shower"
category = "hygiene"
[[model]]
id = "rain"
object_type = "shower"
[model.properties]
name = { set = "Rain" }
sprite = { set = "shower_art" }
"#;
    let parsed = toml::from_str::<ObjectsFile>(source);
    assert!(
        parsed.is_ok(),
        "a hierarchy is a complete content source: {parsed:?}"
    );
}
#[test]
fn shelf_access_is_inherited_validated_and_rotates_from_base_facing() {
    let source = include_str!("../../../content/objects.toml");
    let resolved = resolve(source).unwrap();
    let shelf = resolved
        .object
        .iter()
        .find(|o| o.id == "bookshelf")
        .unwrap();
    assert_eq!(shelf.shelf_access, vec![(1, 0)]);
    for offsets in [vec![], vec![(0, 0)], vec![(1, 1)], vec![(1, 0), (1, 0)]] {
        let mut authored: ObjectsFile = toml::from_str(source).unwrap();
        authored = terri_data::hierarchy::resolve(authored).unwrap();
        authored
            .object
            .iter_mut()
            .find(|o| o.id == "bookshelf")
            .unwrap()
            .shelf_access = offsets;
        assert!(compile_objects(authored).is_err());
    }
    let pack = terri_data::pack();
    let shelf = pack.object(pack.find("bookshelf").unwrap());
    for (facing, expected) in [
        (terri_core::Facing::SouthEast, (1, 0)),
        (terri_core::Facing::SouthWest, (0, 1)),
        (terri_core::Facing::NorthWest, (-1, 0)),
        (terri_core::Facing::NorthEast, (0, -1)),
    ] {
        assert_eq!(shelf.shelf_approaches_at(facing), vec![expected]);
    }
    let mut authored: ObjectsFile = toml::from_str(source).unwrap();
    authored
        .model
        .iter_mut()
        .find(|m| m.id == "bookshelf")
        .unwrap()
        .properties
        .shelf_access
        .extend = Some(vec![(0, 1)]);
    let resolved = terri_data::hierarchy::resolve(authored).unwrap();
    assert_eq!(
        resolved
            .object
            .iter()
            .find(|o| o.id == "bookshelf")
            .unwrap()
            .shelf_access,
        vec![(1, 0), (0, 1)]
    );
}

#[test]
fn canonical_type_is_the_only_hierarchical_presentation_authority() {
    let authored = SHOWER.replace(
        "sprite = { set = \"offlineShower\" }",
        "sprite = { set = \"offlineShower\" }\ndescription = { set = \"A plain corner unit.\" }",
    );
    let resolved = resolve(&authored).unwrap();
    let presentation = resolved.object[0].presentation.as_ref().unwrap();
    assert_eq!(presentation.object_type, "Shower");
    assert_eq!(presentation.description, "A plain corner unit.");
    let conflicting = authored.replace("description = { set = \"A plain corner unit.\" }", "presentation = { set = { object_type = \"Wrong\", description = \"A plain corner unit.\" } }");
    assert!(toml::from_str::<ObjectsFile>(&conflicting).is_err());
}

#[test]
fn seat_comfort_inherits_category_type_and_model_operations() {
    let source = SHOWER
        .replace(
            "price = { set = 40.0 }",
            "price = { set = 40.0 }\nseat_comfort_per_tick = { set = 0.2 }",
        )
        .replace(
            "price = { scale = 2.0 }",
            "price = { scale = 2.0 }\nseat_comfort_per_tick = { scale = 2.0 }",
        )
        .replace(
            "price = { scale = 1.5 }",
            "price = { scale = 1.5 }\nseat_comfort_per_tick = { scale = 1.5 }",
        );
    assert!((resolve(&source).unwrap().object[0].seat_comfort_per_tick - 0.6).abs() < 0.00001);
    let removed = source.replace(
        "seat_comfort_per_tick = { scale = 1.5 }",
        "seat_comfort_per_tick = { remove = true }",
    );
    assert_eq!(
        resolve(&removed).unwrap().object[0].seat_comfort_per_tick,
        0.
    );
}

#[test]
fn every_resolved_sitting_or_reclining_action_has_no_passive_fun() {
    let pack = terri_data::pack();
    for object in &pack.objects {
        for action in &object.interactions {
            if !action.book_reading
                && matches!(
                    action.activity,
                    Some(
                        terri_data::CompiledActivity::Sitting
                            | terri_data::CompiledActivity::Lounging
                    )
                )
            {
                assert!(
                    !action.advertises.iter().any(|(need, delta)| *need as usize
                        == terri_core::NeedId::Fun.index()
                        && *delta > 0.),
                    "{} {}",
                    object.id,
                    action.id
                );
            }
        }
    }
}
