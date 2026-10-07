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
            row.as_table_mut()
                .expect("career table")
                .entry("working_days".to_string())
                .or_insert_with(|| {
                    toml::Value::Array(
                        schema::WEEKDAY_NAMES
                            .iter()
                            .map(|day| toml::Value::String((*day).into()))
                            .collect(),
                    )
                });
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
