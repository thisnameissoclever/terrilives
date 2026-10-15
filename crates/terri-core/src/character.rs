//! Resolved creator values. Draft randomness and editor undo are not simulation data.
use crate::appearance::{CharacterAppearanceV1, F32Bits};
use crate::layout::Relation;
use crate::NEED_COUNT;
use bevy_ecs::prelude::Component;
use serde::{Deserialize, Serialize};

#[derive(Component, Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterPronouns(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterResult {
    pub request: u32,
    pub sim: Option<u32>,
    pub reason: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DispositionDraft {
    pub object: String,
    pub action: String,
    pub weight: F32Bits,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraitDraft {
    pub id: String,
    pub state: F32Bits,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillDraft {
    pub id: String,
    pub practice: F32Bits,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AffinityDraft {
    pub id: String,
    pub value: F32Bits,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterBehaviorDraft {
    pub shyness: u8,
    pub cleanliness: F32Bits,
    pub self_preservation: u8,
    pub chronotype_offset_ticks: i32,
    pub drain: [F32Bits; NEED_COUNT],
    pub recovery: [F32Bits; NEED_COUNT],
    pub dispositions: Vec<DispositionDraft>,
}

impl Default for CharacterBehaviorDraft {
    fn default() -> Self {
        Self {
            shyness: 50,
            cleanliness: F32Bits(0.5_f32.to_bits()),
            self_preservation: 50,
            chronotype_offset_ticks: 0,
            drain: [F32Bits(1_f32.to_bits()); NEED_COUNT],
            recovery: [F32Bits(1_f32.to_bits()); NEED_COUNT],
            dispositions: Vec::new(),
        }
    }
}

impl CharacterBehaviorDraft {
    /// Structural domains also permit valid historical values outside the new-draft controls.
    pub fn validate_structure(&self) -> Result<(), &'static str> {
        if !(1..=100).contains(&self.shyness) {
            return Err("behavior.shyness");
        }
        if self.self_preservation > 100 {
            return Err("behavior.self_preservation");
        }
        if !self.cleanliness.in_range(0.0, 1.0) {
            return Err("behavior.cleanliness");
        }
        if self.drain.iter().any(|v| !v.in_range(0.0, f32::MAX))
            || self
                .recovery
                .iter()
                .any(|v| !v.is_finite() || v.value() <= 0.0)
        {
            return Err("behavior.needs");
        }
        if self.dispositions.len() > 4096 {
            return Err("behavior.dispositions");
        }
        let mut keys = std::collections::BTreeSet::new();
        for route in &self.dispositions {
            if !identifier(&route.object)
                || !identifier(&route.action)
                || !route.weight.in_range(0.0, f32::MAX)
                || !keys.insert((&route.object, &route.action))
            {
                return Err("behavior.dispositions");
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterDraftV1 {
    pub version: u8,
    pub name: String,
    pub pronouns: String,
    pub appearance: CharacterAppearanceV1,
    pub behavior: CharacterBehaviorDraft,
    pub traits: Vec<TraitDraft>,
    pub affinities: Vec<AffinityDraft>,
    pub hobbies: Vec<String>,
    pub skills: Vec<SkillDraft>,
    pub ties: Vec<(u32, Option<Relation>)>,
}

impl CharacterDraftV1 {
    pub fn neutral(name: &str) -> Self {
        Self {
            version: 1,
            name: name.into(),
            pronouns: String::new(),
            appearance: CharacterAppearanceV1::default(),
            behavior: CharacterBehaviorDraft::default(),
            traits: Vec::new(),
            affinities: Vec::new(),
            hobbies: Vec::new(),
            skills: Vec::new(),
            ties: Vec::new(),
        }
    }
    pub fn validate_structure(&self) -> Result<(), &'static str> {
        if self.version != 1 {
            return Err("version");
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 256 {
            return Err("name");
        }
        if self.pronouns.chars().count() > 64 {
            return Err("pronouns");
        }
        self.appearance.validate()?;
        self.behavior.validate_structure()?;
        if !unique_ids(self.traits.iter().map(|v| v.id.as_str()))
            || self.traits.iter().any(|v| !v.state.in_range(0.0, f32::MAX))
        {
            return Err("traits");
        }
        if !unique_ids(self.affinities.iter().map(|v| v.id.as_str()))
            || self.affinities.iter().any(|v| !v.value.in_range(-1.0, 1.0))
        {
            return Err("affinities");
        }
        if !unique_ids(self.skills.iter().map(|v| v.id.as_str()))
            || self
                .skills
                .iter()
                .any(|v| !v.practice.in_range(0.0, f32::MAX))
        {
            return Err("skills");
        }
        if !unique_ids(self.hobbies.iter().map(String::as_str)) {
            return Err("hobbies");
        }
        let mut ties = std::collections::BTreeSet::new();
        if self.ties.len() > 1024 || self.ties.iter().any(|(id, _)| !ties.insert(id)) {
            return Err("ties");
        }
        Ok(())
    }
}

/// None preserves a field group exactly; Some is an explicit replacement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterPatchV1 {
    pub version: u8,
    pub name: Option<String>,
    pub pronouns: Option<String>,
    pub appearance: Option<CharacterAppearanceV1>,
    pub behavior: Option<CharacterBehaviorDraft>,
    pub traits: Option<Vec<TraitDraft>>,
    pub affinities: Option<Vec<AffinityDraft>>,
    pub hobbies: Option<Vec<String>>,
    pub skills: Option<Vec<SkillDraft>>,
    pub ties: Option<Vec<(u32, Option<Relation>)>>,
}

impl Default for CharacterPatchV1 {
    fn default() -> Self {
        Self {
            version: 1,
            name: None,
            pronouns: None,
            appearance: None,
            behavior: None,
            traits: None,
            affinities: None,
            hobbies: None,
            skills: None,
            ties: None,
        }
    }
}

impl CharacterPatchV1 {
    pub fn resolve(&self, original: &CharacterDraftV1) -> Result<CharacterDraftV1, &'static str> {
        if self.version != 1 {
            return Err("version");
        }
        let mut draft = original.clone();
        macro_rules! replace {
            ($field:ident) => {
                if let Some(value) = &self.$field {
                    draft.$field = value.clone();
                }
            };
        }
        replace!(name);
        replace!(pronouns);
        replace!(appearance);
        replace!(behavior);
        replace!(traits);
        replace!(affinities);
        replace!(hobbies);
        replace!(skills);
        replace!(ties);
        draft.validate_structure()?;
        Ok(draft)
    }
}

fn identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256
}
fn unique_ids<'a>(values: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = std::collections::BTreeSet::new();
    for value in values {
        if seen.len() >= 4096 || !identifier(value) || !seen.insert(value) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::appearance::F32Bits;

    #[test]
    fn draft_rejects_duplicate_routes_and_non_finite_behavior_before_application() {
        let mut draft = CharacterDraftV1::neutral("Mira");
        assert!(draft.validate_structure().is_ok());
        draft.behavior.drain[2] = F32Bits(f32::NAN.to_bits());
        assert!(draft.validate_structure().is_err());
        draft.behavior.drain[2] = F32Bits::new(1.0).unwrap();
        draft.behavior.recovery[3] = F32Bits::new(0.0).unwrap();
        assert!(draft.validate_structure().is_err());
        draft.behavior.recovery[3] = F32Bits::new(1.0).unwrap();
        let route = DispositionDraft {
            object: "armchair".into(),
            action: "read".into(),
            weight: F32Bits::new(1.0).unwrap(),
        };
        draft.behavior.dispositions = vec![route.clone(), route];
        assert!(draft.validate_structure().is_err());
    }

    #[test]
    fn wire_round_trip_keeps_custom_values_and_distinguishes_omitted_fields() {
        let mut draft = CharacterDraftV1::neutral("Mira");
        draft.behavior.cleanliness = F32Bits::new(0.731_234_6).unwrap();
        draft.behavior.drain[0] = F32Bits::new(0.123_456_7).unwrap();
        draft.skills.push(SkillDraft {
            id: "reading".into(),
            practice: F32Bits::new(0.317_234_6).unwrap(),
        });
        assert!(draft.validate_structure().is_ok());
        let bytes = postcard::to_allocvec(&draft).unwrap();
        assert_eq!(
            postcard::from_bytes::<CharacterDraftV1>(&bytes).unwrap(),
            draft
        );
        let patch = CharacterPatchV1 {
            name: Some("New name".into()),
            ..Default::default()
        };
        let restored: CharacterPatchV1 =
            postcard::from_bytes(&postcard::to_allocvec(&patch).unwrap()).unwrap();
        assert_eq!(restored, patch);
        assert!(restored.behavior.is_none());
        assert!(restored.appearance.is_none());
        assert!(restored.skills.is_none());
    }
}
