use terri_data::{compile, schema::*};

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
        [
            0.041333333,
            0.034,
            0.048,
            0.068,
            0.017333333,
            0.032,
            0.021333333
        ]
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
            // This mutable fixture retains its published balance. The current
            // compiled contract appends only the purposeful-fight tuning tail.
            // Removing that exact tail must recover every previous input byte.
            let prefix = postcard::to_allocvec(&(
                &pack.decay_per_tick,
                &pack.objects,
                pack.sim_sprite,
                &pack.lot,
                &pack.tuning,
            ))
            .unwrap();
            let mut tail = Vec::new();
            macro_rules! tail_field {
                ($field:ident) => {
                    tail.extend(postcard::to_allocvec(&pack.tuning.$field).unwrap());
                };
            }
            tail_field!(fight_grievance_ticks);
            tail_field!(fight_history_ticks);
            tail_field!(fight_repeat_grievance_ticks);
            tail_field!(fight_mood_bad_multiplier);
            tail_field!(fight_mood_good_multiplier);
            tail_field!(fight_opinion_strength);
            tail_field!(fight_severity_reference);
            tail_field!(chore_fight_response_base);
            tail_field!(chore_fight_response_ticks);
            tail_field!(chore_fight_response_cleanliness);
            tail_field!(chore_fight_response_responsibility);
            tail_field!(chore_fight_response_commitment);
            tail_field!(chore_fight_response_preference);
            tail_field!(chore_fight_response_affinity);
            tail_field!(chore_fight_response_mood);
            tail_field!(chore_repair_base);
            tail_field!(chore_repair_cleanliness);
            tail_field!(fight_rules);
            let mut previous = encoded.clone();
            previous.drain(prefix.len() - tail.len()..prefix.len());
            assert_eq!(
                previous, old_bytes,
                "only the appended fight tuning contract may change this fixture"
            );
            eprintln!("Purposeful-fight fixture proof: removing the compiled tail recovers every previous byte");
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
