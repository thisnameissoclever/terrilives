//! Versioned appearance data and exact numeric values for character commands.
use bevy_ecs::prelude::Component;
use serde::{Deserialize, Serialize};

/// Command equality compares the exact saved f32 representation, including signed zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct F32Bits(pub u32);

impl F32Bits {
    pub fn new(value: f32) -> Option<Self> {
        value.is_finite().then_some(Self(value.to_bits()))
    }
    pub fn value(self) -> f32 {
        f32::from_bits(self.0)
    }
    pub fn is_finite(self) -> bool {
        self.value().is_finite()
    }
    pub fn in_range(self, low: f32, high: f32) -> bool {
        self.is_finite() && (low..=high).contains(&self.value())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BodyShape {
    pub height: u8,
    pub build: u8,
    pub shoulders: u8,
    pub hips: u8,
    pub torso: u8,
}

impl Default for BodyShape {
    fn default() -> Self {
        Self {
            height: 50,
            build: 50,
            shoulders: 50,
            hips: 50,
            torso: 50,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FaceShape {
    pub shape: String,
    pub cheeks: u8,
    pub jaw: u8,
    pub chin: u8,
    pub eyes: String,
    pub eye_size: u8,
    pub brows: String,
    pub brow_thickness: u8,
    pub nose: String,
    pub nose_width: u8,
    pub mouth: String,
    pub mouth_fullness: u8,
    pub ears: u8,
}

impl Default for FaceShape {
    fn default() -> Self {
        Self {
            shape: "oval".into(),
            cheeks: 50,
            jaw: 50,
            chin: 50,
            eyes: "almond".into(),
            eye_size: 50,
            brows: "soft".into(),
            brow_thickness: 50,
            nose: "straight".into(),
            nose_width: 50,
            mouth: "neutral".into(),
            mouth_fullness: 50,
            ears: 50,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppearanceColors {
    pub skin: [u8; 3],
    pub hair: [u8; 3],
    pub facial_hair: [u8; 3],
    pub eyes: [u8; 3],
    pub shirt: [u8; 3],
    pub trousers: [u8; 3],
    pub shoes: [u8; 3],
}

impl Default for AppearanceColors {
    fn default() -> Self {
        Self {
            skin: [190, 143, 107],
            hair: [101, 69, 46],
            facial_hair: [101, 69, 46],
            eyes: [102, 91, 69],
            shirt: [107, 159, 155],
            trousers: [57, 70, 80],
            shoes: [76, 64, 55],
        }
    }
}

/// Cosmetic state has no personality, ability or relationship implications.
#[derive(Component, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterAppearanceV1 {
    pub version: u8,
    pub presentation: String,
    pub body: BodyShape,
    pub face: FaceShape,
    pub colors: AppearanceColors,
    pub undertone: String,
    pub hairstyle: String,
    pub bald: bool,
    pub facial_hair: String,
    pub freckles: bool,
    pub freckle_density: u8,
    pub scar: String,
    pub top: String,
    pub sleeves: String,
    pub bottoms: String,
    pub footwear: String,
    pub glasses: bool,
    pub glasses_style: String,
    pub earrings: String,
}

impl Default for CharacterAppearanceV1 {
    fn default() -> Self {
        Self {
            version: 1,
            presentation: "masculine".into(),
            body: BodyShape::default(),
            face: FaceShape::default(),
            colors: AppearanceColors::default(),
            undertone: "neutral".into(),
            hairstyle: "curl".into(),
            bald: false,
            facial_hair: "none".into(),
            freckles: false,
            freckle_density: 50,
            scar: "none".into(),
            top: "overshirt".into(),
            sleeves: "rolled".into(),
            bottoms: "trousers".into(),
            footwear: "loafers".into(),
            glasses: false,
            glasses_style: "round".into(),
            earrings: "none".into(),
        }
    }
}

impl CharacterAppearanceV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.version != 1 {
            return Err("appearance.version");
        }
        let b = &self.body;
        let f = &self.face;
        if [b.height, b.build, b.shoulders, b.hips, b.torso]
            .iter()
            .any(|v| *v > 100)
        {
            return Err("appearance.body");
        }
        if [
            f.cheeks,
            f.jaw,
            f.chin,
            f.eye_size,
            f.brow_thickness,
            f.nose_width,
            f.mouth_fullness,
            f.ears,
        ]
        .iter()
        .any(|v| *v > 100)
        {
            return Err("appearance.face");
        }
        if self.freckle_density > 100 {
            return Err("appearance.freckle_density");
        }
        let choices: [(&str, &[&str], &str); 15] = [
            (
                &self.presentation,
                &["masculine", "feminine"],
                "appearance.presentation",
            ),
            (
                &f.shape,
                &["oval", "round", "angular"],
                "appearance.face.shape",
            ),
            (
                &f.eyes,
                &["almond", "round", "soft"],
                "appearance.face.eyes",
            ),
            (
                &f.brows,
                &["soft", "straight", "arched"],
                "appearance.face.brows",
            ),
            (
                &f.nose,
                &["straight", "button", "broad"],
                "appearance.face.nose",
            ),
            (
                &f.mouth,
                &["neutral", "upturned", "full"],
                "appearance.face.mouth",
            ),
            (
                &self.undertone,
                &["neutral", "warm", "cool"],
                "appearance.undertone",
            ),
            (
                &self.hairstyle,
                &["curl", "bob", "wave", "crop", "quiff"],
                "appearance.hairstyle",
            ),
            (
                &self.facial_hair,
                &["none", "stubble", "moustache", "beard"],
                "appearance.facial_hair",
            ),
            (&self.scar, &["none", "brow", "cheek"], "appearance.scar"),
            (
                &self.top,
                &["overshirt", "tshirt", "jacket"],
                "appearance.top",
            ),
            (
                &self.sleeves,
                &["rolled", "long", "short"],
                "appearance.sleeves",
            ),
            (&self.bottoms, &["trousers", "shorts"], "appearance.bottoms"),
            (
                &self.footwear,
                &["loafers", "laceups", "trainers"],
                "appearance.footwear",
            ),
            (
                &self.glasses_style,
                &["round", "rectangular"],
                "appearance.glasses_style",
            ),
        ];
        for (value, known, field) in choices {
            if !known.contains(&value) {
                return Err(field);
            }
        }
        if !["none", "studs", "hoops"].contains(&self.earrings.as_str()) {
            return Err("appearance.earrings");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appearance_accepts_all_slider_endpoints_and_rejects_unknown_assets() {
        for presentation in ["masculine", "feminine"] {
            for endpoint in [0, 50, 100] {
                let mut appearance = CharacterAppearanceV1 {
                    presentation: presentation.into(),
                    ..Default::default()
                };
                appearance.body.height = endpoint;
                appearance.body.build = endpoint;
                assert!(appearance.validate().is_ok());
            }
        }
        let mut appearance = CharacterAppearanceV1::default();
        appearance.body.height = 101;
        assert!(appearance.validate().is_err());
        appearance.body.height = 50;
        appearance.hairstyle = "missing-hair".into();
        assert!(appearance.validate().is_err());
        appearance.hairstyle = "curl".into();
        appearance.version = 2;
        assert!(appearance.validate().is_err());
    }

    #[test]
    fn exact_float_values_preserve_signed_zero_and_reject_non_finite_inputs() {
        for value in [-0.0_f32, 0.123_456_7, 0.5, 1.0, 1.5] {
            let encoded = F32Bits::new(value).unwrap();
            assert_eq!(encoded.value().to_bits(), value.to_bits());
            let bytes = postcard::to_allocvec(&encoded).unwrap();
            let decoded: F32Bits = postcard::from_bytes(&bytes).unwrap();
            assert_eq!(decoded, encoded);
        }
        for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert!(F32Bits::new(value).is_none());
            assert!(!F32Bits(value.to_bits()).is_finite());
        }
    }

    #[test]
    fn appearance_is_lossless_data_without_behavior_fields() {
        let mut appearance = CharacterAppearanceV1 {
            presentation: "feminine".into(),
            hairstyle: "quiff".into(),
            bald: true,
            facial_hair: "beard".into(),
            ..Default::default()
        };
        appearance.colors.skin = [12, 34, 56];
        appearance.face.jaw = 83;
        assert!(appearance.validate().is_ok());
        let bytes = postcard::to_allocvec(&appearance).unwrap();
        let restored: CharacterAppearanceV1 = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(restored, appearance);
    }
}
