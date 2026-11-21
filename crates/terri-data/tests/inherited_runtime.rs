use terri_data::{compile, schema::*};

mod filtered_postcard;

fn fixture(extra: &str) -> Result<terri_data::ContentPack, terri_data::ContentError> {
    let source = format!(
        "{}\n{}\n{extra}",
        include_str!("../../../content/objects.toml"),
        include_str!("fixtures/inherited-runtime.toml")
    );
    let mut tuning: TuningFile =
        toml::from_str(include_str!("../../../content/tuning.toml")).unwrap();
    tuning.duration_variance = 0.0;
    let pack = terri_data::pack();
    let mut result = compile(
        toml::from_str(include_str!("../../../content/needs.toml")).unwrap(),
        toml::from_str(&source).unwrap(),
        toml::from_str(include_str!("../../../content/lot.toml")).unwrap(),
        toml::from_str(include_str!("../../../assets/sprites/atlas.toml")).unwrap(),
        tuning,
        toml::from_str(include_str!("../../../content/personalities.toml")).unwrap(),
        toml::from_str(include_str!("../../../content/household.toml")).unwrap(),
        toml::from_str(include_str!("../../../content/social.toml")).unwrap(),
        toml::from_str(include_str!("../../../content/traits.toml")).unwrap(),
        toml::from_str(include_str!("../../../content/careers.toml")).unwrap(),
        toml::from_str(include_str!("../../../content/chains.toml")).unwrap(),
        toml::from_str(include_str!("../../../content/voice.toml")).unwrap(),
        pack.voice_clips.iter().map(|v| v.duration_ticks).collect(),
        toml::from_str(include_str!("../../../content/skills.toml")).unwrap(),
    )?;
    // Keep this retained runtime pack on its published balance. Live balance
    // has separate content and delivery regressions.
    assert_eq!(
        result.decay_per_tick,
        [0.031, 0.0255, 0.036, 0.051, 0.013, 0.024, 0.016]
    );
    result.decay_per_tick = [0.062, 0.051, 0.072, 0.102, 0.026, 0.048, 0.032];
    assert_eq!(result.tuning.relationship_gain_per_talk, 0.34);
    result.tuning.relationship_gain_per_talk = 0.17;
    result.tuning.fight_rules = terri_data::FightRules::Published;
    result.tuning.fight_chance_per_tick = terri_data::Tuning::SHIPPED_FIGHT_CHANCE_PER_TICK;
    for action in &mut result.social {
        if action.id == "chat" {
            let social = action
                .advertises
                .iter_mut()
                .find(|(need, _)| *need == 4)
                .unwrap();
            assert_eq!(social.1, 100.5, "live Chat Social changed");
            social.1 = 50.25;
        }
    }
    for object in &mut result.objects {
        for action in &mut object.interactions {
            if action.id == "attend_correspondence" {
                let social = action.advertises.iter().find(|(need, _)| *need == 4);
                assert_eq!(social.map(|(_, amount)| *amount), Some(24.0));
                action.advertises.retain(|(need, _)| *need != 4);
            }
        }
    }
    result.books = pack.books.clone();
    Ok(result)
}

#[test]
fn inherited_runtime_fixture_compiles_real_model_actions_and_rounding() {
    let pack = fixture("").unwrap();
    let fridge = pack.object(pack.find("fixture_fridge").unwrap());
    assert_eq!(
        fridge
            .interactions
            .iter()
            .map(|a| a.id.as_str())
            .collect::<Vec<_>>(),
        ["grab_snack", "cook_dinner"]
    );
    assert_eq!(
        fridge.interactions[0].recipe.as_ref().unwrap().steps,
        [21, 32, 38]
    );
    assert_eq!(fridge.interactions[0].duration_ticks, 91);
    assert_eq!(
        fridge.interactions[1]
            .recipe
            .as_ref()
            .unwrap()
            .steps
            .iter()
            .sum::<u32>(),
        503
    );
    assert_eq!(
        pack.object(pack.find("fridge").unwrap()).interactions[0]
            .recipe
            .as_ref()
            .unwrap()
            .steps,
        [20, 30, 35]
    );
    assert!(pack
        .object(pack.find("fixture_station").unwrap())
        .interactions
        .is_empty());
    assert_eq!(
        pack.object(pack.find("fixture_tv").unwrap()).interactions[0].media,
        Some(terri_data::MediaBehavior::Television)
    );
    assert_eq!(
        pack.object(pack.find("fixture_radio").unwrap())
            .interactions[0]
            .media,
        Some(terri_data::MediaBehavior::Radio)
    );
    assert!(pack
        .object(pack.find("fixture_label_tv").unwrap())
        .interactions[0]
        .media
        .is_none());
    assert_eq!(
        pack.object(pack.find("fixture_hob").unwrap()).cooking_front,
        Some((1, 0))
    );
    let cleanup = pack.object(pack.find("fixture_sink").unwrap()).interactions[1]
        .recipe
        .as_ref()
        .unwrap();
    assert_eq!(cleanup.selected_step, 1);
    assert_eq!(cleanup.steps, [27, 26]);
    let encoded = postcard::to_allocvec(&pack).unwrap();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/inherited-runtime.pack");
    if std::env::var_os("TERRI_WRITE_RUNTIME_FIXTURE").is_some()
        || std::env::var_os("TERRI_PROVE_RUNTIME_FIXTURE").is_some()
    {
        let old_bytes = std::fs::read(&path).unwrap();
        if old_bytes != encoded {
            // Issues 311 and 317 (the Career tab): two integers appended to
            // `Tuning`, after the presence fade of issue 344. The proof
            // always runs against the fixture as it was on main before them
            // (26150 bytes, SHA-256
            // 79a1b54c6319feb6da4f23bbf58f8c063f4b1ddac4b396e6e5eeebc2ffc0e98a,
            // main at e31afe285): restore that file before regenerating.
            assert_eq!(
                previous_without_career_tab_knobs(&pack),
                old_bytes,
                "only the fields issues 311 and 317 appended may change the current fixture"
            );
            eprintln!(
                "Career tab fixture proof: leaving out the fields issues 311 and 317 appended recovers every byte of the previous fixture"
            );
        }
        if std::env::var_os("TERRI_PROVE_RUNTIME_FIXTURE").is_some() {
            return;
        }
        let staged = path.with_extension("pack.staged");
        std::fs::write(&staged, &encoded).unwrap();
        std::fs::rename(&staged, &path)
            .expect("publish the generated fixture without truncating mapped input");
    } else {
        assert!(
            std::fs::read(path).unwrap() == encoded,
            "regenerate the compiled runtime fixture through this test"
        );
    }
}

/// The fixture's bytes as they were before issues 311 and 317 (the Career
/// tab), rebuilt from the current pack by writing it as postcard does while
/// leaving out the two fields those issues appended at the end of `Tuning`. Postcard writes a struct as its fields in order with no names,
/// so leaving a field out removes exactly its bytes. The unfiltered writer
/// must reproduce postcard byte for byte first, or the filtered bytes would
/// prove nothing.
fn previous_without_career_tab_knobs(pack: &terri_data::ContentPack) -> Vec<u8> {
    use filtered_postcard::Rule;
    assert_eq!(
        filtered_postcard::to_vec(pack, &|_, _| Rule::Keep),
        postcard::to_allocvec(pack).unwrap(),
        "the filtered writer reproduces postcard when it filters nothing"
    );
    filtered_postcard::to_vec(pack, &|owner, field| match (owner, field) {
        ("Tuning", "go_to_work_window_ticks" | "career_input_history_weeks") => Rule::Omit,
        _ => Rule::Keep,
    })
}

#[test]
fn inherited_runtime_rejects_unknown_unused_bindings_and_incompatible_models() {
    for extra in [
        "[[action_template]]\nid='unused'\n[action_template.properties]\nrecipe={set={id='missing',selected_step=0}}",
        "[[object_type]]\nid='unused'\ncategory='kitchen'\nlabel='Unused'\n[object_type.properties]\ncooking_front={set=[0,0]}",
        "[[model]]\nid='bad'\nobject_type='fridge'\n[model.properties]\nname={set='Bad'}\nsprite={set='offlineFridge'}",
        "[[model]]\nid='bad'\nobject_type='fridge'\n[model.properties]\nname={set='Bad'}\nsprite={set='offlineFridge'}\nroles={set=['cold_storage']}\n[[model.action]]\nid='grab_snack'\n[model.action.properties]\nduration_ticks={set=17}",
        "[[model]]\nid='bad'\nobject_type='fridge'\n[model.properties]\nname={set='Bad'}\nsprite={set='offlineFridge'}\nroles={set=['cold_storage']}\n[[model.action]]\nid='grab_snack'\n[model.action.properties]\nbook_reading={set=true}\nslots={remove=true}",
    ] {
        assert!(matches!(fixture(extra), Err(terri_data::ContentError::InvalidHierarchy { .. })), "invalid runtime content must reach hierarchy validation: {extra}");
    }
    // A book-reading recipe reaches the compiler's requirement check rather
    // than stopping at the resolver's bookcase-count rule.
    let extra = "[[model]]\nid='bad'\nobject_type='fridge'\n[model.properties]\nname={set='Bad'}\nsprite={set='offlineFridge'}\nroles={set=['cold_storage']}\n[[model.action]]\nid='grab_snack'\n[model.action.properties]\nbook_reading={set=true}\nslots={remove=true}";
    let error = fixture(extra).unwrap_err().to_string();
    assert!(error.contains("incompatible requirements"), "{error}");
}

#[test]
fn inherited_runtime_rejects_external_admission_stages_even_in_unused_templates() {
    for (recipe, selected_step, reason) in [
        ("clean_dishes", 0, "cleanup collection repeats"),
        ("cook_dinner", 5, "communal dining selects"),
        ("eat_shared_meal", 0, "require an invitation"),
    ] {
        let extra = format!("[[action_template]]\nid='unused'\n[action_template.properties]\nrecipe={{set={{id='{recipe}',selected_step={selected_step}}}}}");
        let error = fixture(&extra).unwrap_err().to_string();
        assert!(error.contains(reason), "{error}");
    }
}
