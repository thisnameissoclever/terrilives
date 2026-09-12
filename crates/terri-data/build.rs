//! Compiles content/*.toml into a postcard pack in OUT_DIR.
//!
//! Validation failures abort the build on purpose. A broken pack must not
//! be constructible, so it can never reach runtime. See [D9].

use std::path::PathBuf;
use std::{env, fs};

// The same modules the library and its tests use, included rather than
// copied. A second validator here would drift from the one the tests
// exercise, and the drift would be invisible until content that the
// tests accept aborted a build, or worse, until content the tests reject
// sailed through.
//
// `ContentPack::find` and `ContentPack::object` are runtime lookups that
// this build script never calls, so they are dead code here and live
// code in the library. The allow sits on the include rather than on the
// source, so the library keeps its own dead-code checking.
//
// Measured, not assumed: with this one allow removed, CI's clippy step
// fails with "methods `object` and `find` are never used". The other
// three modules need no allow; everything they declare is reached from
// `compile`, so an allow there would suppress a real signal.
#[path = "src/compile.rs"]
mod compile;
#[path = "src/error.rs"]
mod error;
#[allow(dead_code)]
#[path = "src/pack.rs"]
mod pack;
#[path = "src/schema.rs"]
mod schema;

/// Ticks per second. Must match `TICK_HZ` in `terri-core`, which this build
/// script cannot depend on without a cycle.
const TICK_HZ: u32 = 10;

/// Reads one voice clip's length in ticks straight out of its WAV header.
///
/// The length is NOT authored in `voice.toml`, because it already exists in
/// the file and a second copy would drift the first time a clip was re-cut.
/// Reading it here is what makes that impossible.
///
/// Only the header is parsed; the samples are never touched. What is needed
/// is the frame count, which is the data chunk's size divided by the size of
/// one frame.
///
/// A clip that is not a whole number of ticks aborts the build rather than
/// rounding. Rounding would leave audio and simulation disagreeing by a
/// fraction of a tick on every conversation, which is inaudible once and
/// obvious after twenty; `scripts/voice-clip-intake.cjs` pads clips to a tick
/// boundary precisely so this never fires on a properly prepared set.
fn voice_clip_ticks(path: &std::path::Path) -> u32 {
    let bytes = fs::read(path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let fail = |why: &str| -> ! { panic!("{}: {why}", path.display()) };

    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        fail("not a RIFF/WAVE file");
    }

    let u16_at = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let u32_at =
        |at: usize| u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);

    let mut channels = 0u32;
    let mut sample_rate = 0u32;
    let mut bits = 0u32;
    let mut data_len = 0u32;

    // Chunks are word aligned: an odd size is followed by one pad byte that
    // the size field does not count.
    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32_at(offset + 4) as usize;
        let body = offset + 8;
        if id == b"fmt " && body + 16 <= bytes.len() {
            channels = u16_at(body + 2) as u32;
            sample_rate = u32_at(body + 4);
            bits = u16_at(body + 14) as u32;
        } else if id == b"data" {
            data_len = size.min(bytes.len() - body) as u32;
        }
        offset = body + size + (size % 2);
    }

    if channels == 0 || sample_rate == 0 || bits == 0 {
        fail("no usable fmt chunk");
    }
    if !sample_rate.is_multiple_of(TICK_HZ) {
        fail("sample rate is not a whole number of frames per tick");
    }
    // Guarded rather than assumed. `bits / 8` truncates, so a 12-bit or
    // 20-bit file would compute a frame size one to two bytes short and
    // report a duration that is too long; below 8 bits it is zero, and the
    // division below would panic on it instead of reaching a message that
    // says what is wrong.
    if bits < 8 || !bits.is_multiple_of(8) {
        fail("sample bit depth is not a whole number of bytes");
    }

    let frame_bytes = channels * (bits / 8);
    let frames = data_len / frame_bytes;
    let frames_per_tick = sample_rate / TICK_HZ;
    if !frames.is_multiple_of(frames_per_tick) {
        panic!(
            "{}: {frames} frames is not a whole number of ticks ({frames_per_tick} frames each); \
             run scripts/voice-clip-intake.cjs to pad it to a tick boundary",
            path.display()
        );
    }

    frames / frames_per_tick
}

fn main() {
    let workspace = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("..")
        .join("..");
    let root = workspace.join("content");

    let needs_path = root.join("needs.toml");
    let objects_path = root.join("objects.toml");
    let lot_path = root.join("lot.toml");
    // Every knob that governs the system, validated here like any other
    // content file so a malformed one aborts the build rather than
    // surfacing later as inexplicable behaviour. See [D-1].
    let tuning_path = root.join("tuning.toml");
    // Who lives on the lot and who they are - [H2], [H3]. Content like
    // everything else here, so a household member with a typo'd archetype
    // aborts the build rather than spawning a stranger.
    let personalities_path = root.join("personalities.toml");
    let household_path = root.join("household.toml");
    // What a sim advertises to other sims - [H4]/[H6]. Content like the
    // rest, so a talk that advertises a need nobody declared aborts the
    // build instead of scoring as nothing forever.
    let social_path = root.join("social.toml");
    let traits_path = root.join("traits.toml");
    // The jobs sims can hold - [E4]. Content like the rest, so a
    // household member with a typo'd career aborts the build.
    let careers_path = root.join("careers.toml");
    // The multi-step chains - [K1]. Content like the rest, so a chain
    // at a station nobody placed aborts the build.
    let chains_path = root.join("chains.toml");
    // Generated by assets/sprites/gen/build.py and committed, so it
    // is an input here exactly like the three authored files. Reading it
    // is what makes "this object's sprite exists" a build failure rather
    // than a blank quad at run time.
    let atlas_path = workspace.join("assets").join("sprites").join("atlas.toml");
    // The clips a conversation is built out of. Content like the rest, so a
    // clip listed here with no recording behind it aborts the build instead
    // of leaving a conversation that lasts no time and plays nothing.
    let voice_path = root.join("voice.toml");
    // Under `web/public` rather than `assets`, which is where every other
    // input lives, and deliberately: this is the directory the browser is
    // served from, so the bytes measured here are literally the bytes that
    // get played. A copy under `assets` would be a second source of truth
    // for a duration, and the pair would drift the first time one was
    // re-cut without the other.
    let voice_dir = workspace
        .join("web")
        .join("public")
        .join("audio")
        .join("voice");

    // Without these, editing content does not trigger a rebuild and you
    // silently run the previous pack. The content lives outside this
    // package, so cargo's default "rerun when the package changes" does
    // not cover it and nothing else would notice the edit.
    println!("cargo:rerun-if-changed={}", needs_path.display());
    println!("cargo:rerun-if-changed={}", objects_path.display());
    println!("cargo:rerun-if-changed={}", lot_path.display());
    println!("cargo:rerun-if-changed={}", tuning_path.display());
    println!("cargo:rerun-if-changed={}", personalities_path.display());
    println!("cargo:rerun-if-changed={}", household_path.display());
    println!("cargo:rerun-if-changed={}", social_path.display());
    println!("cargo:rerun-if-changed={}", traits_path.display());
    println!("cargo:rerun-if-changed={}", careers_path.display());
    println!("cargo:rerun-if-changed={}", chains_path.display());
    println!("cargo:rerun-if-changed={}", atlas_path.display());
    println!("cargo:rerun-if-changed={}", voice_path.display());
    // The recordings themselves are inputs, not just the file that lists
    // them: their lengths ARE the compiled durations, so re-cutting a clip
    // has to rebuild the pack.
    println!("cargo:rerun-if-changed={}", voice_dir.display());

    let needs_src = fs::read_to_string(&needs_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", needs_path.display()));
    let objects_src = fs::read_to_string(&objects_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", objects_path.display()));
    let lot_src = fs::read_to_string(&lot_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", lot_path.display()));
    let tuning_src = fs::read_to_string(&tuning_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", tuning_path.display()));
    let atlas_src = fs::read_to_string(&atlas_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", atlas_path.display()));
    let personalities_src = fs::read_to_string(&personalities_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", personalities_path.display()));
    let household_src = fs::read_to_string(&household_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", household_path.display()));
    let social_src = fs::read_to_string(&social_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", social_path.display()));
    let traits_src = fs::read_to_string(&traits_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", traits_path.display()));
    let careers_src = fs::read_to_string(&careers_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", careers_path.display()));
    let chains_src = fs::read_to_string(&chains_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", chains_path.display()));

    let needs: schema::NeedsFile = toml::from_str(&needs_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", needs_path.display()));
    let objects: schema::ObjectsFile = toml::from_str(&objects_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", objects_path.display()));
    let lot: schema::LotFile = toml::from_str(&lot_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", lot_path.display()));
    let atlas: schema::AtlasFile = toml::from_str(&atlas_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", atlas_path.display()));
    // A missing knob surfaces here rather than in `compile`, because
    // `TuningFile` defaults nothing: serde reports it by name, which is
    // what the author has to go and add.
    let tuning: schema::TuningFile = toml::from_str(&tuning_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", tuning_path.display()));
    let personalities: schema::PersonalitiesFile = toml::from_str(&personalities_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", personalities_path.display()));
    let household: schema::HouseholdFile = toml::from_str(&household_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", household_path.display()));
    let social: schema::SocialFile = toml::from_str(&social_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", social_path.display()));
    let traits: schema::TraitsFile = toml::from_str(&traits_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", traits_path.display()));
    let careers: schema::CareersFile = toml::from_str(&careers_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", careers_path.display()));
    let chains: schema::ChainsFile = toml::from_str(&chains_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", chains_path.display()));

    let voice_src = fs::read_to_string(&voice_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", voice_path.display()));
    let voice: schema::VoiceFile = toml::from_str(&voice_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", voice_path.display()));
    // Measured here, paired by position with the declarations. `compile`
    // takes the lengths rather than reading them because `terri-data` does
    // no file IO, which is also what lets a test state a clip length without
    // owning a recording.
    let voice_clip_ticks: Vec<u32> = voice
        .clip
        .iter()
        .map(|def| voice_clip_ticks(&voice_dir.join(format!("{}.wav", def.id))))
        .collect();

    let pack = compile::compile(
        needs,
        objects,
        lot,
        atlas,
        tuning,
        personalities,
        household,
        social,
        traits,
        careers,
        chains,
        voice,
        voice_clip_ticks,
    )
    .unwrap_or_else(|e| panic!("content is invalid: {e}"));

    let bytes = postcard::to_allocvec(&pack).expect("pack serialises");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("content_pack.postcard");
    fs::write(&out, bytes).expect("write pack");
}
