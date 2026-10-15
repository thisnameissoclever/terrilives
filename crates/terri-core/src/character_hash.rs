//! Exact, length-delimited creator hashing, independent of allocation or host word size.
use crate::{appearance::*, character::*, command::CharacterCommand, FnvHasher};
fn text(h: &mut FnvHasher, value: &str) {
    h.write_u64(value.len() as u64);
    h.write_bytes(value.as_bytes());
}
fn number(h: &mut FnvHasher, value: u32) {
    h.write_u64(u64::from(value));
}
fn list<T>(h: &mut FnvHasher, values: &[T], item: impl Fn(&mut FnvHasher, &T)) {
    h.write_u64(values.len() as u64);
    for value in values {
        item(h, value);
    }
}
fn option<T>(h: &mut FnvHasher, value: &Option<T>, item: impl Fn(&mut FnvHasher, &T)) {
    h.write_bytes(&[u8::from(value.is_some())]);
    if let Some(value) = value {
        item(h, value);
    }
}
pub fn appearance(h: &mut FnvHasher, a: &CharacterAppearanceV1) {
    h.write_bytes(&[a.version]);
    text(h, &a.presentation);
    let b = &a.body;
    h.write_bytes(&[b.height, b.build, b.shoulders, b.hips, b.torso]);
    let f = &a.face;
    for value in [&f.shape, &f.eyes, &f.brows, &f.nose, &f.mouth] {
        text(h, value);
    }
    h.write_bytes(&[
        f.cheeks,
        f.jaw,
        f.chin,
        f.eye_size,
        f.brow_thickness,
        f.nose_width,
        f.mouth_fullness,
        f.ears,
    ]);
    let c = &a.colors;
    for color in [
        c.skin,
        c.hair,
        c.facial_hair,
        c.eyes,
        c.shirt,
        c.trousers,
        c.shoes,
    ] {
        h.write_bytes(&color);
    }
    for value in [
        &a.undertone,
        &a.hairstyle,
        &a.facial_hair,
        &a.scar,
        &a.top,
        &a.sleeves,
        &a.bottoms,
        &a.footwear,
        &a.glasses_style,
        &a.earrings,
    ] {
        text(h, value);
    }
    h.write_bytes(&[
        u8::from(a.bald),
        u8::from(a.freckles),
        a.freckle_density,
        u8::from(a.glasses),
    ]);
}
fn behavior(h: &mut FnvHasher, b: &CharacterBehaviorDraft) {
    h.write_bytes(&[b.shyness, b.self_preservation]);
    number(h, b.cleanliness.0);
    number(h, b.chronotype_offset_ticks as u32);
    for value in b.drain.iter().chain(b.recovery.iter()) {
        number(h, value.0);
    }
    list(h, &b.dispositions, |h, row| {
        text(h, &row.object);
        text(h, &row.action);
        number(h, row.weight.0);
    });
}
fn traits(h: &mut FnvHasher, rows: &[TraitDraft]) {
    list(h, rows, |h, row| {
        text(h, &row.id);
        number(h, row.state.0);
    });
}
fn affinities(h: &mut FnvHasher, rows: &[AffinityDraft]) {
    list(h, rows, |h, row| {
        text(h, &row.id);
        number(h, row.value.0);
    });
}
fn hobbies(h: &mut FnvHasher, rows: &[String]) {
    list(h, rows, |h, row| text(h, row));
}
fn skills(h: &mut FnvHasher, rows: &[SkillDraft]) {
    list(h, rows, |h, row| {
        text(h, &row.id);
        number(h, row.practice.0);
    });
}
fn ties(h: &mut FnvHasher, rows: &[(u32, Option<crate::layout::Relation>)]) {
    list(h, rows, |h, row| {
        number(h, row.0);
        option(h, &row.1, |h, relation| h.write_bytes(&[relation.code()]));
    });
}
pub fn draft(h: &mut FnvHasher, d: &CharacterDraftV1) {
    h.write_bytes(&[d.version]);
    text(h, &d.name);
    text(h, &d.pronouns);
    appearance(h, &d.appearance);
    behavior(h, &d.behavior);
    traits(h, &d.traits);
    affinities(h, &d.affinities);
    hobbies(h, &d.hobbies);
    skills(h, &d.skills);
    ties(h, &d.ties);
}
pub fn command(value: &CharacterCommand) -> u64 {
    let mut h = FnvHasher::default();
    match value {
        CharacterCommand::Create {
            request,
            draft: value,
        } => {
            h.write_bytes(&[0]);
            number(&mut h, *request);
            draft(&mut h, value);
        }
        CharacterCommand::Edit {
            request,
            sim,
            patch: p,
        } => {
            h.write_bytes(&[1]);
            number(&mut h, *request);
            number(&mut h, *sim);
            h.write_bytes(&[p.version]);
            option(&mut h, &p.name, |h, v| text(h, v));
            option(&mut h, &p.pronouns, |h, v| text(h, v));
            option(&mut h, &p.appearance, appearance);
            option(&mut h, &p.behavior, behavior);
            option(&mut h, &p.traits, |h, v| traits(h, v));
            option(&mut h, &p.affinities, |h, v| affinities(h, v));
            option(&mut h, &p.hobbies, |h, v| hobbies(h, v));
            option(&mut h, &p.skills, |h, v| skills(h, v));
            option(&mut h, &p.ties, |h, v| ties(h, v));
        }
    }
    h.finish()
}
