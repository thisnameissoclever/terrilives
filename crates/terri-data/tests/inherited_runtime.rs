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
            // Issue 296 (shifts): the shift tuning appended to `Tuning`, the
            // shift fields appended to every `CompiledCareer`, and the new
            // career rows and paths. The proof always runs against the
            // fixture as it was before issue 296 (23012 bytes, SHA-256
            // 6ff17b687b515239ac1367b1ee0c01bf9f36317295a9bd315a6d7f6bb7a6cfa5):
            // restore that file before regenerating.
            assert_eq!(
                previous_without_shifts(&pack),
                old_bytes,
                "only the shift tuning, the shift fields and the new careers may change the current fixture"
            );
            eprintln!(
                "Shift fixture proof: removing the shift tuning, the career shift fields and the new careers recovers every byte of the previous fixture"
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

/// The fixture's bytes as they were before issue 296 (shifts), rebuilt
/// from the current pack: the five shift knobs left off the end of the
/// tuning, the three shift fields left off each career row, and only the
/// twelve rows and three paths that existed then. Postcard writes a struct
/// as its fields in order, so a tuple of the old fields encodes exactly as
/// the old struct did.
fn previous_without_shifts(pack: &terri_data::ContentPack) -> Vec<u8> {
    const SHIFT_TUNING_BYTES: usize = 10;
    const OLD_ROWS: usize = 12;
    const OLD_PATHS: usize = 3;
    let mut bytes = postcard::to_allocvec(&(
        &pack.decay_per_tick,
        &pack.objects,
        pack.sim_sprite,
        &pack.lot,
    ))
    .unwrap();
    let tuning = postcard::to_allocvec(&pack.tuning).unwrap();
    assert_eq!(
        &tuning[tuning.len() - SHIFT_TUNING_BYTES..],
        postcard::to_allocvec(&(
            pack.tuning.shift_sleep_offset_day,
            pack.tuning.shift_sleep_offset_early,
            pack.tuning.shift_sleep_offset_late,
            pack.tuning.shift_sleep_offset_night,
            pack.tuning.career_search_temperature,
        ))
        .unwrap(),
        "the shift knobs are the tuning's last bytes"
    );
    bytes.extend_from_slice(&tuning[..tuning.len() - SHIFT_TUNING_BYTES]);
    bytes.extend(
        postcard::to_allocvec(&(
            &pack.personalities,
            &pack.household,
            &pack.social,
            &pack.traits,
        ))
        .unwrap(),
    );
    let rows: Vec<_> = pack.careers[..OLD_ROWS]
        .iter()
        .map(|c| {
            (
                &c.id,
                &c.label,
                c.shift_start,
                c.shift_ticks,
                c.pay,
                c.energy_cost,
                c.satisfaction,
                c.working_days,
                c.path,
                c.level,
                c.pay_max,
                c.advance_weeks,
                c.social_demand,
                &c.skill_tag,
                &c.trait_fit,
            )
        })
        .collect();
    bytes.extend(postcard::to_allocvec(&rows).unwrap());
    bytes.extend(
        postcard::to_allocvec(&(
            &pack.roles,
            &pack.item_kinds,
            &pack.chains,
            &pack.circadian,
            &pack.sleep_tag,
            &pack.voice_clips,
            &pack.portals,
            &pack.colourways,
            &pack.coverings,
            &pack.skills,
            &pack.affinities,
            &pack.books,
            &pack.reading,
            &pack.career_paths[..OLD_PATHS],
        ))
        .unwrap(),
    );
    bytes
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
