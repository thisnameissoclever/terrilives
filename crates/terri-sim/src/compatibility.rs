//! Directional compatibility derived from authored activity preferences.
use std::collections::BTreeMap;
use terri_core::{Hobbies, Personality, Traits};
use terri_data::ContentPack;

pub(crate) type Preferences = BTreeMap<String, f32>;

pub(crate) fn preferences(
    pack: &ContentPack,
    personality: Option<&Personality>,
    traits: Option<&Traits>,
    hobbies: Option<&Hobbies>,
) -> Preferences {
    let mut weights: BTreeMap<String, (f32, usize)> = BTreeMap::new();
    if let Some(personality) = personality {
        for &(object, interaction, weight) in personality.dispositions() {
            let mut tags = pack.object(object).interactions[interaction as usize]
                .tags
                .clone();
            tags.sort();
            tags.dedup();
            for tag in tags {
                let row = weights.entry(tag).or_default();
                row.0 += weight;
                row.1 += 1;
            }
        }
    }
    let mut result: Preferences = weights
        .into_iter()
        .map(|(tag, (sum, count))| (tag, sum / count as f32))
        .collect();
    if let Some(traits) = traits {
        for &(index, _) in traits.entries() {
            let definition = &pack.traits[index as usize];
            if let terri_data::CompiledTraitKind::Disposition { score_multiplier } = definition.kind
            {
                *result.entry(definition.tag.clone()).or_insert(1.0) *= score_multiplier;
            }
        }
    }
    for value in result.values_mut() {
        *value -= 1.0;
    }
    if let Some(hobbies) = hobbies {
        let unique: std::collections::BTreeSet<_> = hobbies.0.iter().collect();
        for tag in unique {
            *result.entry(tag.clone()).or_default() += 0.5;
        }
    }
    result.retain(|tag, value| {
        *value = value.clamp(-1.0, 1.0);
        tag != crate::systems::interpersonal::PRIVATE_USE_TAG && *value != 0.0
    });
    result
}

pub(crate) fn between(subject: &Preferences, other: &Preferences) -> f32 {
    let denominator = subject
        .values()
        .map(|value| value.abs())
        .sum::<f32>()
        .max(1.0);
    let numerator: f32 = subject
        .iter()
        .map(|(tag, &mine)| {
            let theirs = other.get(tag).copied().unwrap_or(0.0);
            if mine < 0.0 && theirs < 0.0 {
                0.0
            } else {
                mine * theirs
            }
        })
        .sum();
    (numerator / denominator).clamp(-1.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_activity_tags_and_hobbies_count_once() {
        let mut pack = terri_data::pack().clone();
        let shelf = pack.find("bookshelf").unwrap();
        let chair = pack.find("reading_chair").unwrap();
        pack.objects[shelf.0 as usize].interactions[0].tags =
            vec!["reading".into(), "reading".into()];
        let personality = Personality::with_dispositions(
            [1.0; 7],
            [1.0; 7],
            vec![(shelf, 0, 0.0), (chair, 0, 2.0)],
        );
        assert_eq!(
            preferences(
                &pack,
                Some(&personality),
                None,
                Some(&Hobbies(vec!["reading".into(), "reading".into()]))
            )["reading"],
            0.5
        );
    }

    #[test]
    fn compatibility_is_directional_and_unrelated_interests_are_neutral() {
        let a = BTreeMap::from([("reading".into(), 1.0)]);
        let b = BTreeMap::from([("reading".into(), 1.0), ("exercise".into(), 1.0)]);
        assert_eq!(between(&a, &b), 1.0);
        assert_eq!(between(&b, &a), 0.5);
        assert_eq!(
            between(&a, &BTreeMap::from([("exercise".into(), 1.0)])),
            0.0
        );
        let dislikes = BTreeMap::from([("reading".into(), -1.0)]);
        assert_eq!(between(&a, &dislikes), -1.0);
        assert_eq!(between(&dislikes, &dislikes), 0.0);
    }

    #[test]
    fn preferences_average_objects_then_apply_disposition_and_hobby_without_conditions() {
        let pack = terri_data::pack();
        let shelf = pack.find("bookshelf").unwrap();
        let chair = pack.find("reading_chair").unwrap();
        let personality = Personality::with_dispositions(
            [1.0; 7],
            [1.0; 7],
            vec![(shelf, 0, 1.2), (chair, 0, 1.4)],
        );
        let bookworm = pack.traits.iter().position(|t| t.id == "bookworm").unwrap() as u32;
        let condition = pack
            .traits
            .iter()
            .position(|t| t.id == "low_spirits")
            .unwrap() as u32;
        let skill = pack
            .traits
            .iter()
            .position(|t| t.id == "slow_reader")
            .unwrap() as u32;
        let traits = Traits::from_entries(vec![(bookworm, 0.0), (condition, 1.0), (skill, 0.0)]);
        let profile = preferences(pack, Some(&personality), Some(&traits), None);
        assert!((profile.get("reading").copied().unwrap_or(0.0) - 0.755).abs() < 0.00001);
        assert!(
            !profile.contains_key("correspondence"),
            "condition tags are not personality preferences"
        );
        let with_hobby = preferences(
            pack,
            Some(&personality),
            Some(&traits),
            Some(&Hobbies(vec!["reading".into()])),
        );
        assert_eq!(with_hobby["reading"], 1.0);
    }
}
