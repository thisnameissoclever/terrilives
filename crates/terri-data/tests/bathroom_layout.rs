use terri_data::{pack, Footprint};

#[test]
fn bathtub_quarter_turn_matches_its_collision_rectangle() {
    let pack = pack();
    let id = pack.find("bathtub").unwrap();
    let bathtub = pack.object(id);
    assert_eq!(bathtub.footprint, Footprint { width: 1, depth: 2 });
    let placement = pack.lot.placements.iter().find(|p| p.object == id).unwrap();
    assert_eq!((placement.x, placement.y), (14.0, 9.0));
    // Registered SW art extends along Y, matching the 1x2 collision strip.
    assert_eq!(placement.sprite, 1123);
    assert_eq!(
        bathtub.sprite, 1123,
        "non-authored tubs must match the rotated collision too"
    );
}
