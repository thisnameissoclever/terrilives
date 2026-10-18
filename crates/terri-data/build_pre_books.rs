//! Compile frozen source through current structs, never deserialize an old pack layout.

use crate::{compile, pack, schema};
use serde::Deserialize;
use std::{fs, path::Path};

#[derive(Deserialize)]
struct Durations {
    clip: Vec<Duration>,
}
#[derive(Deserialize)]
struct Duration {
    id: String,
    ticks: u32,
}

pub fn compile(root: &Path) -> pack::ContentPack {
    let revision = fs::read_to_string(root.join("source-revision.txt")).ok();
    let need_era = revision
        .as_deref()
        .is_some_and(|revision| revision.starts_with("2f319c3b"));
    let newest = revision
        .as_deref()
        .is_some_and(|revision| revision.starts_with("89040f82"));
    let affinity_era = revision
        .as_deref()
        .is_some_and(|revision| revision.starts_with("f3cb7a1c"));
    let has_skills = root.join("skills.toml").exists();
    for (name, expected) in [
        (
            "atlas.toml",
            if need_era {
                0x8429ee5c4f22a5f2
            } else if newest {
                0x1524045b2ed57b45
            } else if affinity_era || has_skills {
                0x7deb5c00c8a1ec61
            } else {
                0x5a04_c592_0bd6_9bcc
            },
        ),
        ("voice-durations.toml", 0xf3ce_89d3_fe0f_855d),
    ] {
        let source = fs::read_to_string(root.join(name))
            .expect("frozen input exists")
            .replace("\r\n", "\n");
        let mut hash = terri_core::FnvHasher::default();
        hash.write_bytes(source.as_bytes());
        assert_eq!(hash.finish(), expected, "frozen {name} changed");
    }
    fn read<T: serde::de::DeserializeOwned>(root: &Path, name: &str) -> T {
        let path = root.join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        toml::from_str(&fs::read_to_string(&path).expect("frozen source exists"))
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
    }
    let voice: schema::VoiceFile = read(root, "voice.toml");
    let durations: Durations = read(root, "voice-durations.toml");
    assert_eq!(voice.clip.len(), durations.clip.len());
    let ticks = voice
        .clip
        .iter()
        .zip(durations.clip)
        .map(|(voice, duration)| {
            assert_eq!(voice.id, duration.id, "frozen voice order changed");
            duration.ticks
        })
        .collect();
    let mut tuning: toml::Value = read(root, "tuning.toml");
    if !has_skills {
        // The frozen pre-skills file stays byte-identical. These fields did
        // not exist in that schema; no old save can contain skill practice.
        for (name, value) in [
            ("skill_level_cost", 0.1),
            ("skill_level_growth", 1.0),
            ("habituation_max", 3.0),
            ("overdoing_threshold", 1.0),
            ("overdoing_penalty", 20.0),
            ("sick_threshold", 2.5),
            ("sick_penalty", 25.0),
        ] {
            tuning
                .as_table_mut()
                .expect("tuning table")
                .insert(name.into(), toml::Value::Float(value));
        }
    }
    for (name, value) in [
        ("first_weekday", toml::Value::Integer(0)),
        ("affinity_from_trait", toml::Value::Float(0.8)),
        ("affinity_presence_threshold", toml::Value::Float(0.2)),
        ("affinity_presence_points", toml::Value::Float(10.0)),
        ("affinity_presence_extra_points", toml::Value::Float(3.0)),
        ("affinity_presence_extra_cap", toml::Value::Integer(3)),
        ("affinity_use_points", toml::Value::Float(15.0)),
        ("affinity_use_feeling_per_hour", toml::Value::Float(0.03)),
        ("affinity_band_loves", toml::Value::Float(0.6)),
        ("affinity_band_likes", toml::Value::Float(0.2)),
        ("affinity_from_mild_trait", toml::Value::Float(0.4)),
        // Communal affinity (issue 257): the shipped value, which the
        // published-pack conversions reconstruct too.
        ("hated_communal_chance", toml::Value::Float(0.35)),
        // Historical content predates meal appreciation; preserve its behavior.
        ("meal_appreciation_gain", toml::Value::Float(0.0)),
        // Burnt meals (issue 243): the shipped values, reconstructed by the
        // published-pack conversions too.
        ("burn_chance_novice", toml::Value::Float(0.12)),
        ("burn_chance_master", toml::Value::Float(0.002)),
        ("burnt_meal_mood_penalty", toml::Value::Float(10.0)),
        ("burnt_meal_mood_ticks", toml::Value::Integer(240)),
        // Fights (issue 248): the shipped values, reconstructed by the
        // published-pack conversions too.
        ("fight_affinity_threshold", toml::Value::Float(-0.9)),
        ("fight_chance_per_tick", toml::Value::Float(0.01)),
        ("fight_relationship_loss", toml::Value::Float(0.1)),
        ("fight_mood_penalty", toml::Value::Float(12.0)),
        ("fight_mood_ticks", toml::Value::Integer(480)),
        // Land expansion (issue 254): the shipped values, reconstructed by
        // the published-pack conversions too.
        ("land_strip_depth", toml::Value::Integer(10)),
        ("land_price_cents", toml::Value::Integer(15_000)),
        ("land_price_step_cents", toml::Value::Integer(15)),
        // Careers (issue 249): the shipped values, reconstructed by the
        // published-pack conversions too.
        ("career_review_noise", toml::Value::Float(10.0)),
        ("career_poor_threshold", toml::Value::Float(40.0)),
        ("career_good_threshold", toml::Value::Float(65.0)),
        ("career_fire_base", toml::Value::Float(0.08)),
        ("career_demote_base", toml::Value::Float(0.15)),
        ("career_promote_base", toml::Value::Float(0.22)),
        ("career_raise_base", toml::Value::Float(0.18)),
        ("career_search_tick", toml::Value::Integer(540)),
        ("career_search_chance", toml::Value::Float(0.5)),
        ("career_change_fit", toml::Value::Float(-0.3)),
        ("career_change_gap", toml::Value::Float(0.5)),
        ("career_change_chance", toml::Value::Float(0.25)),
        ("career_satisfaction_rate", toml::Value::Float(4.0)),
        ("career_job_misery", toml::Value::Float(35.0)),
        ("career_job_joy", toml::Value::Float(65.0)),
        ("career_misery_satisfaction", toml::Value::Float(0.5)),
        ("career_mood_joy", toml::Value::Float(6.0)),
        ("career_mood_misery", toml::Value::Float(8.0)),
        ("career_mood_warned", toml::Value::Float(6.0)),
        ("career_mood_promoted", toml::Value::Float(12.0)),
        ("career_mood_raise", toml::Value::Float(8.0)),
        ("career_mood_demoted", toml::Value::Float(12.0)),
        ("career_mood_fired", toml::Value::Float(16.0)),
        ("career_mood_promoted_ticks", toml::Value::Integer(1440)),
        ("career_mood_demoted_ticks", toml::Value::Integer(2880)),
        ("career_mood_fired_ticks", toml::Value::Integer(5760)),
        // Seasons (issue 251): the shipped values, reconstructed by the
        // published-pack conversions too.
        ("days_per_season", toml::Value::Integer(7)),
        ("first_season", toml::Value::Integer(0)),
        // The looks are read from the same constant the conversions use,
        // rather than a third copy of twelve numbers, and written in the
        // authored shape: one table per season, keyed by name. Each f32
        // widens to an f64 that narrows back to itself when the tuning is
        // parsed.
        (
            "season_yard_looks",
            toml::Value::Table(
                schema::SEASON_KEYS
                    .iter()
                    .zip(pack::Tuning::SHIPPED_SEASON_YARD_LOOKS)
                    .map(|(season, row)| {
                        let look = schema::SEASON_LOOK_KEYS
                            .iter()
                            .zip(row)
                            .map(|(key, value)| {
                                (key.to_string(), toml::Value::Float(f64::from(value)))
                            })
                            .collect();
                        (season.to_string(), toml::Value::Table(look))
                    })
                    .collect(),
            ),
        ),
    ] {
        tuning
            .as_table_mut()
            .expect("tuning table")
            .entry(name.to_string())
            .or_insert(value);
    }
    let mut careers: toml::Value = read(root, "careers.toml");
    if let Some(rows) = careers
        .get_mut("career")
        .and_then(toml::Value::as_array_mut)
    {
        for row in rows {
            let table = row.as_table_mut().expect("career table");
            table.entry("working_days".to_string()).or_insert_with(|| {
                toml::Value::Array(
                    schema::WEEKDAY_NAMES
                        .iter()
                        .map(|day| toml::Value::String((*day).into()))
                        .collect(),
                )
            });
            // Careers (issue 249): a frozen career is one job; it becomes a
            // path of one level, titled as it was labeled and paying what it
            // paid, with the path named after the job.
            if !table.contains_key("level") {
                let mut level = table.clone();
                level.insert("title".to_string(), table["label"].clone());
                level.insert("pay_max".to_string(), table["pay"].clone());
                level.insert("advance_weeks".to_string(), toml::Value::Integer(1));
                let path_id = format!("{}_path", table["id"].as_str().expect("career id"));
                for key in [
                    "shift_start",
                    "shift_ticks",
                    "pay",
                    "energy_cost",
                    "satisfaction",
                    "working_days",
                ] {
                    table.remove(key);
                }
                table.insert("id".to_string(), toml::Value::String(path_id));
                table.insert(
                    "level".to_string(),
                    toml::Value::Array(vec![toml::Value::Table(level)]),
                );
            }
        }
    }
    let mut pack = compile::compile(
        read(root, "needs.toml"),
        read(root, "objects.toml"),
        read(root, "lot.toml"),
        read(root, "atlas.toml"),
        tuning.try_into().expect("frozen tuning schema"),
        read(root, "personalities.toml"),
        read(root, "household.toml"),
        read(root, "social.toml"),
        read(root, "traits.toml"),
        careers.try_into().expect("frozen careers schema"),
        read(root, "chains.toml"),
        voice,
        ticks,
        if has_skills {
            read(root, "skills.toml")
        } else {
            schema::SkillsFile::default()
        },
    )
    .expect("frozen pre-books content compiles");
    if !has_skills {
        pack.tuning.habituation_max = 1.0;
    }
    pack
}
