use std::fs;
use terri_data::ContentPack;

macro_rules! parsed {
    ($path:expr) => {
        toml::from_str(&fs::read_to_string($path).unwrap()).unwrap()
    };
}

fn compile(lot: &str) -> ContentPack {
    let voice: terri_data::schema::VoiceFile = parsed!("content/voice.toml");
    let ticks = terri_data::pack().voice_clips.iter().map(|clip| clip.duration_ticks).collect();
    let mut result = terri_data::compile(
        parsed!("content/needs.toml"), parsed!("content/objects.toml"), parsed!(lot),
        parsed!("assets/sprites/atlas.toml"), parsed!("content/tuning.toml"),
        parsed!("content/personalities.toml"), parsed!("content/household.toml"),
        parsed!("content/social.toml"), parsed!("content/traits.toml"),
        parsed!("content/careers.toml"), parsed!("content/chains.toml"), voice, ticks,
        parsed!("content/skills.toml"),
    ).unwrap();
    result.books = terri_data::compile_books(parsed!("content/books.toml")).unwrap();
    result
}

fn main() {
    let old_bytes=fs::read(".local-build/p15-target/wasm32-unknown-unknown/release/build/terri-data-3721efb1e6b3d722/out/content_pack.postcard").unwrap();
    let (original,tail)=postcard::take_from_bytes::<ContentPack>(&old_bytes).unwrap();
    assert!(tail.is_empty());
    let incoming=compile(".local-build/v16-yard-lot-513.toml");
    let combined=compile("content/lot.toml");
    let incoming_bytes=postcard::to_allocvec(&incoming).unwrap();
    let combined_bytes=postcard::to_allocvec(&combined).unwrap();
    assert_eq!(combined_bytes,postcard::to_allocvec(terri_data::pack()).unwrap());
    assert_eq!(incoming.coverings.len(),3);
    assert_eq!(combined.coverings.len(),4);
    assert_eq!(&combined.coverings[..3],incoming.coverings.as_slice());
    let mut without_patio=combined.clone();
    assert_eq!(without_patio.coverings.pop().unwrap().name,"Outdoor patio");
    assert_eq!(postcard::to_allocvec(&without_patio).unwrap(),incoming_bytes);
    assert_eq!(original.objects.len(),30);
    assert_eq!(incoming.objects.len(),33);
    assert_eq!(incoming.objects[30..].iter().map(|o|o.id.as_str()).collect::<Vec<_>>(),["pool","pool_lounger","patio_umbrella"]);
    assert_eq!(postcard::to_allocvec(&incoming.objects[..30]).unwrap(),postcard::to_allocvec(&original.objects).unwrap());
    let old=terri_data::content_fingerprint(&original);
    let main=terri_data::content_fingerprint(&incoming);
    let patio=terri_data::content_fingerprint(&combined);
    assert_eq!(old,17481476517581295759);
    assert_eq!(main,5841475410324663844);
    assert_eq!(patio,main);
    fs::write(".local-build/v16-yard-production-513.postcard",incoming_bytes).unwrap();
    fs::write(".local-build/v16-yard-production-combined.postcard",combined_bytes).unwrap();
    println!("{{\"original\":{old},\"main513\":{main},\"combined_patio\":{patio},\"original_models\":30,\"current_models\":33,\"original_model_prefix_exact\":true,\"patio_only_pack_delta\":true,\"combined_matches_compiled_pack\":true}}");
}
