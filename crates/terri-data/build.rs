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

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("..")
        .join("..")
        .join("content");

    let needs_path = root.join("needs.toml");
    let objects_path = root.join("objects.toml");

    // Without these, editing content does not trigger a rebuild and you
    // silently run the previous pack. The content lives outside this
    // package, so cargo's default "rerun when the package changes" does
    // not cover it and nothing else would notice the edit.
    println!("cargo:rerun-if-changed={}", needs_path.display());
    println!("cargo:rerun-if-changed={}", objects_path.display());

    let needs_src = fs::read_to_string(&needs_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", needs_path.display()));
    let objects_src = fs::read_to_string(&objects_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", objects_path.display()));

    let needs: schema::NeedsFile = toml::from_str(&needs_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", needs_path.display()));
    let objects: schema::ObjectsFile = toml::from_str(&objects_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", objects_path.display()));

    let pack =
        compile::compile(needs, objects).unwrap_or_else(|e| panic!("content is invalid: {e}"));

    let bytes = postcard::to_allocvec(&pack).expect("pack serialises");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("content_pack.postcard");
    fs::write(&out, bytes).expect("write pack");
}
