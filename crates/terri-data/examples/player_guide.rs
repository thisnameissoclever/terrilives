//! Export resolved gameplay values for the player guide without a second balance table.
use std::collections::BTreeMap;
use terri_core::NeedId;
use toml::Value;

fn quote(value: &str) -> String {
    let mut out = String::from("\"");
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c < ' ' => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn json(value: &Value) -> String {
    match value {
        Value::String(v) => quote(v),
        Value::Integer(v) => v.to_string(),
        Value::Float(v) => {
            assert!(v.is_finite(), "reference values must be finite");
            v.to_string()
        }
        Value::Boolean(v) => v.to_string(),
        Value::Datetime(v) => quote(&v.to_string()),
        Value::Array(values) => format!(
            "[{}]",
            values.iter().map(json).collect::<Vec<_>>().join(",")
        ),
        Value::Table(values) => format!(
            "{{{}}}",
            values
                .iter()
                .map(|(k, v)| format!("{}:{}", quote(k), json(v)))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

fn value<T: serde::Serialize>(v: &T) -> Value {
    Value::try_from(v).expect("resolved player reference serializes")
}

fn table(entries: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    Value::Table(entries.into_iter().map(|(k, v)| (k.into(), v)).collect())
}

fn deltas(values: &[(u8, f32)]) -> Value {
    Value::Table(
        values
            .iter()
            .map(|(need, delta)| (NeedId::ALL[*need as usize].as_str().into(), value(delta)))
            .collect(),
    )
}

fn action(id: String, object: &str, a: &terri_data::CompiledInteraction) -> Value {
    let mut fields = vec![
        ("id", value(&id)),
        ("object_id", value(&object)),
        ("action_id", value(&a.id)),
        ("label", value(&a.label)),
        ("duration_ticks", value(&a.duration_ticks)),
        ("need_deltas", deltas(&a.advertises)),
        ("satisfaction", value(&a.satisfaction)),
        ("tags", value(&a.tags)),
        ("book_reading", value(&a.book_reading)),
        (
            "shared_activity",
            value(&a.shared_activity.clone().unwrap_or_default()),
        ),
        ("seat_use", value(&a.seat_use)),
    ];
    if let Some(recipe) = &a.recipe {
        fields.push(("recipe", value(recipe)));
        fields.push(("chain_id", value(&format!("chain:{}", recipe.recipe))));
    }
    table(fields)
}

fn reference() -> Value {
    let pack = terri_data::pack();
    let mut actions = Vec::new();
    for object in &pack.objects {
        for a in &object.interactions {
            actions.push(action(
                format!("object:{}/{}", object.id, a.id),
                &object.id,
                a,
            ));
        }
    }
    for a in &pack.social {
        actions.push(action(format!("social:{}", a.id), "", a));
    }
    for chain in &pack.chains {
        actions.push(table([
            ("id", value(&format!("chain:{}", chain.id))),
            (
                "object_id",
                value(&pack.objects[chain.advertised_by.0 as usize].id),
            ),
            ("action_id", value(&chain.id)),
            ("label", value(&chain.label)),
            (
                "duration_ticks",
                value(&chain.steps.iter().map(|s| s.duration_ticks).sum::<u32>()),
            ),
            ("need_deltas", deltas(&chain.advertises)),
            ("satisfaction", value(&chain.satisfaction)),
            (
                "steps",
                Value::Array(
                    chain
                        .steps
                        .iter()
                        .map(|s| {
                            table([
                                ("role", value(&pack.roles[s.role as usize])),
                                ("label", value(&s.label)),
                                ("duration_ticks", value(&s.duration_ticks)),
                                ("tags", value(&s.tags)),
                            ])
                        })
                        .collect(),
                ),
            ),
        ]));
    }
    actions.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    let needs: BTreeMap<_, _> = NeedId::ALL
        .into_iter()
        .map(|need| {
            (
                need.as_str(),
                table([
                    ("decay_per_tick", value(&pack.decay_per_tick[need.index()])),
                    ("minimum", value(&terri_core::needs::NEED_MIN)),
                    ("maximum", value(&terri_core::needs::NEED_MAX)),
                ]),
            )
        })
        .collect();
    let mut fields = vec![
        ("schema_version", value(&1)),
        ("ticks_per_sim_hour", value(&terri_core::TICKS_PER_SIM_HOUR)),
        ("needs", value(&needs)),
        ("actions", Value::Array(actions)),
        ("tuning", value(&pack.tuning)),
        (
            "objects",
            Value::Array(
                pack.objects
                    .iter()
                    .map(|o| {
                        table([
                            ("id", value(&o.id)),
                            ("name", value(&o.name)),
                            ("type", value(&o.display_name())),
                            ("seat_comfort_per_tick", value(&o.seat_comfort_per_tick)),
                        ])
                    })
                    .collect(),
            ),
        ),
        ("personalities", value(&pack.personalities)),
        ("traits", value(&pack.traits)),
        ("affinities", value(&pack.affinities)),
        ("careers", value(&pack.careers)),
        ("skills", value(&pack.skills)),
        (
            "reading_reference_ticks",
            value(&terri_data::books::READING_REFERENCE_TICKS),
        ),
    ];
    if let Some(reading) = &pack.reading {
        fields.push(("reading", value(reading)));
    }
    table(fields)
}

fn main() {
    println!("{}", json(&reference()));
}

#[cfg(test)]
mod tests {
    #[test]
    fn json_strings_escape_controls_quotes_and_backslashes() {
        assert_eq!(
            super::quote("a\"\\\n\t\u{0001}é"),
            "\"a\\\"\\\\\\n\\t\\u0001é\""
        );
    }

    #[test]
    fn reference_covers_resolved_actions_needs_and_personal_modifiers() {
        let reference = super::reference();
        let pack = terri_data::pack();
        let actions = reference["actions"].as_array().unwrap();
        assert_eq!(
            actions.len(),
            pack.objects
                .iter()
                .map(|o| o.interactions.len())
                .sum::<usize>()
                + pack.social.len()
                + pack.chains.len()
        );
        let ids: std::collections::BTreeSet<_> =
            actions.iter().map(|a| a["id"].as_str().unwrap()).collect();
        assert_eq!(ids.len(), actions.len());
        for need in terri_core::NeedId::ALL {
            assert_eq!(
                reference["needs"][need.as_str()]["decay_per_tick"]
                    .as_float()
                    .unwrap(),
                pack.decay_per_tick[need.index()] as f64
            );
        }
        assert_eq!(
            reference["traits"].as_array().unwrap().len(),
            pack.traits.len()
        );
        assert_eq!(
            reference["tuning"]["need_interactions"]["handwashing_hygiene_ceiling"].as_float(),
            Some(40.)
        );
    }
}
